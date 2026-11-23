"use strict";
/*
 * ProcTech: the exact stats of a procedural upgrade module ("UP_SNSUIT#19801") from its id and seed, as the game
 * rolls them. Exposes window.ProcTech. A re-implementation of the game's procedural tech roll
 * (checked against the game).
 *
 *   ProcTech.roll(def, seed) -> { stats: [{ stat, value }], perfect }   in the game's order
 *     def = SheetData.items entry for the module ({ r: [[stat, min, max, curve, always]], m: [min, max], q, w })
 *     seed = the number after '#' (0..99999)
 *
 * How the game rolls (all arithmetic in float32 where the game uses floats):
 *  1. RNG: h = hash(seed); MWC state lo = h + (h == 0), carry = ror16(h) ^ h; two steps, except for modules
 *     whose template is Freighter tech or that are Biggs tech (def.z): they start from the unstepped state.
 *  2. Quality Illegal, Sentinel or Robot (4..6): one step; under 10 % it is a "perfect" roll.
 *  3. One step: number of stats = min + (max − min)·ease(u, w), rounded half away from zero (perfect: max).
 *  4. Stats marked AlwaysChoose come first in table order; the others are shuffled (Fisher–Yates from the end,
 *     one step each) and appended. Count = min(stats + always, available, 4).
 *  5. Each chosen stat: one step, value = min + (max − min)·ease(u, curve). A perfect roll takes one more step and
 *     uses 0.85 + 0.15·u instead (0.01 + 0.14·u for the curves where low is good).
 * The curve per GcWeightingCurve is a runtime table: [Linear, EaseInQuad, EaseInQuart, EaseInExpo, EaseOutQuad,
 * EaseOutQuart, EaseOutExpo]. The 10 % chance is a runtime global (10 in game version 7.x).
 */
(function (root) {
  const f = Math.fround;
  const A = 0x5A76F899;
  const CURVE_TYPE = [0, 16, 19, 25, 17, 20, 26];
  const PERFECT_PCT = 10;

  // MWC step on { lo, carry } (both uint32). 64-bit product split exactly without BigInt.
  function step(s) {
    const lo = s.lo >>> 0;
    const pl = (lo & 0xFFFF) * A, ph = (lo >>> 16) * A;          // lo·A = ph·2^16 + pl
    const low = (pl % 4294967296) + (ph % 65536) * 65536 + s.carry;
    const high = Math.floor(pl / 4294967296) + Math.floor(ph / 65536) + Math.floor(low / 4294967296);
    s.lo = low % 4294967296;
    s.carry = high >>> 0;
    return s.lo;
  }
  const mulHi = (x, n) => Math.floor(x * n / 4294967296);   // (x·n) >> 32 for x < 2^32, n small

  function init(seed, raw) {
    let h = seed >>> 0;
    h = (((h ^ 0x3d0000) >>> 16) ^ h) >>> 0;
    h = Math.imul(h, 9) >>> 0;
    h = Math.imul((h >>> 4) ^ h, 0x1b873593) >>> 0;
    h = ((h >>> 15) ^ h) >>> 0;
    const s = { lo: (h + (h === 0 ? 1 : 0)) >>> 0, carry: (((h >>> 16) | (h << 16)) ^ h) >>> 0 };
    if (!raw) { step(s); step(s); }   // the game only copies the stepped state for most modules
    return s;
  }

  // The game's ease for the curve types the weighting table uses.
  function ease(t, type) {
    switch (type) {
      case 0: return t;
      case 16: return f(t * t);
      case 17: return f(-f(f(t - 2) * t));
      case 19: { const t2 = f(t * t); return f(f(t * t2) * t); }
      case 20: { const a = f(t - 1); return f(f(f(f(a * a) * a) * f(1 - t)) + 1); }
      case 25: return t === 0 ? t : f(Math.pow(2, f(f(t - 1) * 10)));
      case 26: return t === 1 ? t : f(1 - f(Math.pow(2, f(t * -10))));
      default: return t;
    }
  }
  // cvtpd2ps(lo · c), c = the double 0x3DF0000000100000 ≈ 1/(2^32 − 1), not 2^-32
  const unit = lo => f(lo * 2.3283064370807974e-10);

  function roll(def, seed) {
    const s = init(seed, !!def.z);
    let perfect = false;
    if (def.q >= 4 && def.q <= 6) perfect = mulHi(step(s), 100) < PERFECT_PCT;
    let k = ease(unit(step(s)), CURVE_TYPE[def.w || 0]);
    if (perfect) k = 1;
    const [nmin, nmax] = def.m || [1, 1];
    const fn = f(f(f(f(nmax) - f(nmin)) * k) + f(nmin));
    const want = Math.trunc(f(fn + (fn < 0 ? -0.5 : 0.5)));

    const always = [], rest = [];
    for (const r of def.r || []) (r[4] ? always : rest).push(r);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = mulHi(step(s), i + 1);
      const tmp = rest[i]; rest[i] = rest[j]; rest[j] = tmp;
    }
    const list = always.concat(rest);
    const count = Math.min(want + always.length, list.length, 4);

    const stats = [];
    for (let i = 0; i < count; i++) {
      const [stat, min, max, curve] = list[i];
      let t = ease(unit(step(s)), CURVE_TYPE[curve || 0]);
      if (perfect) {
        const u = f(step(s) * 2.3283064370807974e-10);
        t = curve < 5 ? f(f(u * f(0.14999998)) + f(0.85)) : f(f(u * f(0.14)) + f(0.01));
      }
      stats.push({ stat, value: f(f(f(f(max) - f(min)) * t) + f(min)) });
    }
    return { stats, perfect };
  }

  root.ProcTech = { roll };
})(typeof window !== "undefined" ? window : globalThis);
