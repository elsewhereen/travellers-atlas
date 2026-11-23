"use strict";
/*
 * SysGen: what a solar system is made of (system descriptor, planets, biomes), re-implemented from the game.
 * Exposes window.SysGen (browser) / module.exports (Node tests). Needs StarGen (lib/stargen.js).
 * Same rules as StarGen: float32 in the game's order, checked bit for bit against the game.
 * Work in progress: region info and the system descriptor so far.
 */
(function (root) {
  const SG = typeof module !== "undefined" && module.exports ? require("./stargen.js") : root.StarGen;
  const f = Math.fround;
  const MWC = 0x5A76F899n, M32 = 0xFFFFFFFFn;

  // A 32-bit MWC state (s0, s1) as two BigInts, stepped like the game's inline code.
  class Rng32 {
    constructor(s0, s1) { this.s0 = BigInt(s0) & M32; this.s1 = BigInt(s1) & M32; }
    static fromWord(w) {                         // seed from one 32-bit word, then one step
      w = BigInt(w) & M32;
      const r = new Rng32(w + (w === 0n ? 1n : 0n), (((w >> 16n) | (w << 16n)) & M32) ^ w);
      r.step();
      return r;
    }
    step() { const t = this.s0 * MWC + this.s1; this.s0 = t & M32; this.s1 = t >> 32n; return this.s0; }
    below(n) { return Number((this.s0 * BigInt(n)) >> 32n); }            // uses the current s0
    unit() { return f(Number(this.s0) * 2.3283064370807974e-10); }        // current s0 as [0,1)
  }

  // per-region numbers the system code uses (indices as the game's int array).
  function regionInfo(x, y, z) {
    const d = f(Math.floor(Math.sqrt(x * x + y * y + z * z)));
    const core = d < 8;
    const ri = { 26: core ? 0 : 1, 27: core ? 0 : 1, 28: core ? 0 : 120, 29: 0, 30: 65, 31: 1000 };
    if (d < 1440 && 8 < d) {
      let n = Math.trunc(f(f(f(d - 8) * 120) / 1440));
      n = Math.max(0, n);
      if (n > 0x77) n = 120;
      ri[29] = 120 - n;
    }
    return ri;
  }

  // Probability tables (runtime data, indexed by descriptor[4]).
  const P_ABANDONED = [0, 0.1, 0.1, 0, 0.35].map(f);
  const P_CONFLICT7 = [0, 0.4, 0.4, 0.95, 0.2].map(f);
  const P_PIRATE = [0.25, 0.15, 0.15, 0.5, 0.05].map(f);
  const TWO_MOONS_PCT = 33;

  // the small system descriptor. systemIndex as in the address (1-based).
  function systemDescriptor(x, y, z, systemIndex, galaxy = 0) {
    const key = SG.regionKey(x, y, z, galaxy);
    const idx0 = (systemIndex - 1) & 0xFFFF;
    let pos = idx0, block = key;
    if (idx0 !== 0 && idx0 > 7) { pos = (idx0 - 8) & 7; block = key + 1n + BigInt((idx0 - 8) >> 3); }
    const m = SG.regionMix(key, block);
    const word64 = [m.a, m.b, m.c, m.d][pos >> 1];
    const w = (pos & 1) ? word64 >> 32n : word64 & M32;
    const RI = regionInfo(x, y, z);
    const r = Rng32.fromWord(w);
    const d = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const b = { abandoned: false, pirate: false, b2c: false, b2d: false };
    let r8 = 0;
    if (idx0 < RI[28]) {
      const n = Number(r.s0 >> 30n) + 3;
      r.step();
      d[5] = 1; d[7] = n; d[8] = r.below(n) + 1;
    } else {
      if (r.below(100) < 30) { r.step(); r8 = r.below(3) + 1; d[4] = r8; }
      let ecx = 0, edx = r8, r9 = 0;
      let eax = idx0 - RI[28];
      if (RI[27] > 0 && eax >= 0 && eax < RI[27]) { d[6] = 2; ecx = 2; d[4] = 0; edx = 0; r9 = 2; }
      let r14 = ecx, r13 = edx; r8 = r9;
      if (RI[26] > 0) {
        eax -= RI[27];
        if (eax >= 0 && eax < RI[26] && idx0 < RI[31]) { d[6] = 1; r14 = 1; r8 = 1; d[4] = 0; r13 = 0; }
      }
      r.step();
      const n = r.below(6) + 1;
      d[7] = n;
      if (RI[29] < 10 && r14 === 0 && r13 === 0) { r.step(); d[8] = r.below(n + 1); } else d[8] = 0;
    }
    // (r8 === 1: the game also checks the player's purge state here; assumed false.)
    r.step(); d[1] = 1; d[0] = r.below(7);
    r.step();
    const u1 = r.unit();
    if (f(0.10000000149011612) > u1) d[1] = 2;
    else if (f(0.30000001192092896) > u1) d[1] = 0;
    // (The game raises wealth for systems the player has upgraded; assumed not.)
    r.step(); d[2] = r.below(3);
    r.step(); d[3] = r.below(3);
    if (idx0 < RI[29]) { r.step(); d[4] = r.below(3) + 1; }
    if (RI[31] <= idx0 && idx0 < RI[31] + RI[30]) d[4] = 4;
    r.step();
    b.abandoned = P_ABANDONED[d[4]] > r.unit();
    let esi;
    if (b.abandoned) { d[1] = 0; d[2] = 0; esi = 0; }
    else {
      r.step();
      if (P_CONFLICT7[d[4]] > r.unit()) d[3] = 7;
      esi = 0;
    }
    const left = 6 - d[7];
    let moons;
    if (left >= 1) {
      r.step();
      moons = (r.below(100) < TWO_MOONS_PCT && left >= 2) ? 2 : 1;
    } else moons = esi;
    d[10] = moons;
    if (d[4] === 4) {
      d[10] = d[7] + moons; d[7] = esi;
      r.step();
      if (r.below(100) < 15 || b.b2c) {
        b.b2c = true;
        r.step();
        b.b2d = r.below(100) < 0x42 || b.b2d;
      } else b.b2c = false;
    }
    if (b.b2d) { d[7] = esi; d[10] = 6; }
    if (!((d[4] === 0 && d[8] > 0) || b.abandoned || d[3] === 7)) {
      const u = f(Number((r.s0 * MWC + r.s1) & M32) * 2.3283064370807974e-10);
      if (P_PIRATE[d[4]] > u) { b.pirate = true; d[2] = 3; d[1] = 3; }
    }
    return { d, ...b, regionInfo: RI };
  }

  // the list of bodies. class 0..2 = planet size class, 3 = moon (parent = planet index), 4 = special.
  // Returns { desc, bodies: [{ cls, parent, seed }], planets, moons }.
  // The system code clamps the address to X/Z in [-2047, 2047] and Y in [-127, 127] first.
  const clampAddr = (x, y, z) => [Math.max(-2047, Math.min(2047, x)), Math.max(-127, Math.min(127, y)),
                                  Math.max(-2047, Math.min(2047, z))];
  function systemBodies(x, y, z, systemIndex, galaxy = 0) {
    [x, y, z] = clampAddr(x, y, z);
    const desc = systemDescriptor(x, y, z, systemIndex, galaxy);
    const d = desc.d;
    const ua = BigInt(x & 0xFFF) | (BigInt(z & 0xFFF) << 12n) | (BigInt(y & 0xFF) << 24n) |
               (BigInt(galaxy & 0xFF) << 32n) | (BigInt(systemIndex & 0xFFF) << 40n);
    const rng = new SG.Mwc(SG.fmix64(ua));
    const step = () => rng.step();
    const below = (lo, n) => Number((lo * BigInt(n)) >> 32n);
    const seedOf = (a, b) => SG.fmix64((b << 32n) | a);
    const bodies = [];
    const twoSteps = () => { const a = step(), b = step(); return seedOf(a, b); };
    let count = d[7];
    if (!desc.b2c && !desc.b2d) {
      let i = 0;
      while (i < count) {
        let next = i + 1;
        const cls = below(step(), 3);
        bodies.push({ cls, parent: -1 });
        if (cls === 0) {
          const room = Math.min(2, Math.max(0, count - next));
          let n = below(step(), room + 1);
          while (n > 0) {
            if (next === d[8] - 1) break;
            bodies.push({ cls: 3, parent: i });
            next++; n--;
          }
        }
        i = next;
      }
      for (let k = 0; k < count; k++) bodies[k].seed = twoSteps();
      const total = count + d[10];
      let l = bodies.length;
      i = l;
      while (l < total) {
        const lo1 = step();
        const cls = below(lo1, 3);
        const lo2 = step(), lo3 = step();
        bodies.push({ cls, parent: -1, seed: seedOf(lo2, lo3) });
        l++;
        let next = i + 1;
        if (cls === 0) {
          const room = Math.min(2, Math.max(0, total - next));
          let n = below(step(), room + 1);
          while (n > 0) {
            if (next === d[8] - 1) break;
            next++; l++; n--;
            bodies.push({ cls: 3, parent: i, seed: twoSteps() });
          }
        }
        i = next;
      }
      count = total;
    } else {
      count = d[10] - 1 + d[7];
      bodies.push({ cls: 4, parent: -1, seed: twoSteps() });
      for (let k = 0; k < count; k++) bodies.push({ cls: 3, parent: 0, seed: twoSteps() });
    }
    return { desc, bodies, planets: d[7], moons: d[10] };
  }

  // Biome tables (game data, read from the running game's generator object).
  const BT = {"galType":[4,4,2,4,4,4,1,4,4,3,4,1,4,4,2,4,4,4,3,4],"weights":[[2.0,1.0,1.0,1.0,1.0,1.0,2.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,2.0,0.5,1.0,0.5,1.0,1.0,0.5,0.0,0.0,0.0,0.0,0.0,1.0,1.0,0.0,0.0,0.0],[1.0,1.0,1.0,1.0,1.0,1.0,2.0,1.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,1.0,1.0,0.5,1.0,1.0,0.5,0.5,0.0,3.0,0.0,0.0,2.0,0.0,0.0,0.0,0.0],[1.0,1.0,1.0,1.0,1.0,1.0,2.0,2.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.5,1.0,0.5,1.0,1.0,0.5,0.5,0.0,0.0,3.0,0.0,1.0,1.0,0.0,0.0,0.0],[1.0,1.0,1.0,1.0,1.0,1.0,2.0,3.0,1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,1.0,1.0,0.5,1.0,1.0,0.5,0.5,3.0,0.0,0.0,0.0,0.0,2.0,0.0,0.0,0.0],[1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,0.6600000262260437,0.6600000262260437,0.6600000262260437,0.0,0.20000000298023224,0.20000000298023224,0.6600000262260437,0.0,0.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,0.6600000262260437,0.6600000262260437,0.6600000262260437,0.0,0.20000000298023224,0.20000000298023224,0.6600000262260437,0.0,0.0],[1.0,1.0,1.0,1.0,1.0,1.0,4.0,1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,1.0,0.5,1.0,0.5,1.0,1.0,0.5,0.0,1.0,1.0,1.0,0.0,1.0,1.0,0.0,0.0,0.0],[4.0,1.0,1.0,1.0,1.0,1.0,0.5,1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,4.0,0.5,1.0,0.5,1.0,1.0,0.5,0.5,1.0,1.0,1.0,0.0,1.0,1.0,0.0,0.0,0.0]],"deadToExotic":0.5,"listClass4":[0,1,2,3,4,5,6,7,8,9,10,12,13],"listMoon4":[0,1,2,3,4,5,6,7,8,9,10,12,13],"listType1":[1,2,3,4],"weirdSub":[3,4,5,6,7,8,9,10,11,12,13],"sub1":[[[1,0.5,1.0],[2,1.0,1.0],[20,0.3499999940395355,0.3499999940395355],[21,0.3499999940395355,0.3499999940395355],[22,0.4000000059604645,0.4000000059604645],[23,0.20000000298023224,0.20000000298023224],[19,0.20000000298023224,0.20000000298023224],[7,0.25,0.15000000596046448],[24,0.05000000074505806,0.15000000596046448],[15,0.20000000298023224,0.20000000298023224],[25,0.05000000074505806,0.800000011920929],[27,2.0,1.3300000429153442],[14,0.699999988079071,0.3499999940395355],[13,0.800000011920929,0.25],[3,0.699999988079071,0.10000000149011612]],[[1,0.5,1.0],[20,0.3499999940395355,0.3499999940395355],[21,0.3499999940395355,0.3499999940395355],[22,0.25,0.25],[23,0.5,0.15000000596046448],[24,0.15000000596046448,0.15000000596046448],[19,0.20000000298023224,0.20000000298023224],[27,2.0,1.3300000429153442],[3,0.800000011920929,0.05000000074505806],[7,1.100000023841858,0.0],[28,1.3300000429153442,0.0],[29,0.30000001192092896,0.0]],[[1,0.5,1.0],[20,0.30000001192092896,0.30000001192092896],[21,0.30000001192092896,0.30000001192092896],[18,0.30000001192092896,0.30000001192092896],[24,0.11999999731779099,0.11999999731779099],[26,0.0,0.5],[27,2.0,1.3300000429153442],[3,0.800000011920929,0.05000000074505806],[7,1.0,0.0],[28,1.3300000429153442,0.0]],[[1,0.5,1.0],[20,1.0,0.4000000059604645],[21,0.0,0.0],[22,0.699999988079071,0.699999988079071],[24,0.15000000596046448,0.15000000596046448],[17,0.20000000298023224,0.20000000298023224],[27,1.0,1.3300000429153442],[3,0.699999988079071,0.05000000074505806],[28,1.3300000429153442,0.0],[29,0.4000000059604645,0.0]],[[1,0.5,1.0],[2,1.0,1.0],[20,0.4000000059604645,0.4000000059604645],[21,0.5,0.5],[22,0.20000000298023224,0.20000000298023224],[17,0.15000000596046448,0.15000000596046448],[24,0.11999999731779099,0.11999999731779099],[27,2.0,1.3300000429153442],[3,0.8999999761581421,0.05000000074505806],[28,1.100000023841858,0.0],[29,0.30000001192092896,0.0]],[[1,0.5,1.0],[2,0.800000011920929,1.0],[20,0.5,0.5],[21,0.6499999761581421,0.6499999761581421],[22,0.20000000298023224,0.20000000298023224],[23,0.3499999940395355,0.3499999940395355],[24,0.11999999731779099,0.11999999731779099],[17,0.10000000149011612,0.10000000149011612],[27,2.0,1.3300000429153442],[13,0.800000011920929,0.30000001192092896],[3,0.800000011920929,0.05000000074505806],[7,0.800000011920929,0.0]],[[1,1.0,1.0],[20,0.6000000238418579,0.6000000238418579],[21,0.20000000298023224,0.20000000298023224],[17,0.20000000298023224,0.20000000298023224]],[[3,1.0,1.0],[4,1.0,1.0],[5,1.0,1.0],[6,1.0,1.0],[7,1.0,1.0],[8,1.0,1.0],[9,1.0,1.0],[10,1.0,1.0],[11,1.0,1.0],[12,1.0,1.0],[13,1.0,1.0]],[[14,1.0,1.0],[15,1.0,1.0],[16,1.0,1.0],[17,1.0,1.0],[18,1.0,1.0],[19,1.0,1.0]],[[14,1.0,1.0],[15,1.0,1.0],[16,1.0,1.0],[17,1.0,1.0],[18,1.0,1.0],[19,1.0,1.0]],[[14,1.0,1.0],[15,1.0,1.0],[16,1.0,1.0],[17,1.0,1.0],[18,1.0,1.0],[19,1.0,1.0]],[],[[1,1.0,1.0],[29,0.4000000059604645,0.0]],[[1,1.0,1.0],[29,0.10000000149011612,0.0]],[[1,1.0,1.0],[20,1.0,1.0],[21,1.0,1.0],[22,1.0,1.0],[23,1.0,1.0],[27,1.0,1.0]],[[1,1.0,1.0]],[]],"sub2":[[[1,1.0],[2,1.0],[20,0.3499999940395355],[21,0.3499999940395355],[22,0.4000000059604645],[23,0.20000000298023224],[19,0.20000000298023224],[7,0.20000000298023224],[24,0.2199999988079071],[15,0.20000000298023224],[25,0.800000011920929]],[[1,1.0],[20,0.3499999940395355],[21,0.3499999940395355],[22,0.25],[23,0.15000000596046448],[24,0.15000000596046448],[19,0.20000000298023224]],[[1,1.0],[20,0.30000001192092896],[21,0.30000001192092896],[18,0.30000001192092896],[24,0.11999999731779099],[26,0.5]],[[1,1.0],[20,0.4000000059604645],[21,0.0],[22,0.699999988079071],[24,0.15000000596046448],[17,0.20000000298023224]],[[1,1.0],[2,1.0],[20,0.4000000059604645],[21,0.5],[22,0.20000000298023224],[17,0.15000000596046448],[24,0.11999999731779099]],[[1,1.0],[2,1.0],[20,0.5],[21,0.6499999761581421],[22,0.20000000298023224],[23,0.3499999940395355],[24,0.11999999731779099],[17,0.10000000149011612]],[[1,1.0],[20,0.6000000238418579],[21,0.20000000298023224],[17,0.20000000298023224]],[[3,1.0],[4,1.0],[5,1.0],[6,1.0],[7,1.0],[8,1.0],[9,1.0],[10,1.0],[11,1.0],[12,1.0],[13,1.0]],[[14,1.0],[15,1.0],[16,1.0],[17,1.0],[18,1.0],[19,1.0]],[[14,1.0],[15,1.0],[16,1.0],[17,1.0],[18,1.0],[19,1.0]],[[14,1.0],[15,1.0],[16,1.0],[17,1.0],[18,1.0],[19,1.0]],[],[[1,1.0]],[[1,1.0]],[[1,1.0]],[],[]]};

  const INFESTED = 0x18;
  // Weighted pick over indices: the first idx with acc <= r <= acc + w[idx]; def when none.
  function pickIdx(list, W, r, def) {
    let acc = 0;
    for (const idx of list) {
      if (!(r < acc) && !(f(acc + W[idx]) < r)) return idx;
      acc = f(acc + W[idx]);
    }
    return def;
  }
  // Pick from [id, weight] entries: subtract weights until r < w.
  function pickEntry(entries, weightOf, r) {
    let k = 0;
    for (const e of entries) { const w = weightOf(e); if (r < w) break; k++; r = f(r - w); }
    return k;
  }

  // Biome and subtype of the first d[7] bodies.
  function systemBiomes(x, y, z, systemIndex, galaxy = 0) {
    [x, y, z] = clampAddr(x, y, z);
    const sb = systemBodies(x, y, z, systemIndex, galaxy);
    const d = sb.desc.d, bodies = sb.bodies;
    const ua = BigInt(x & 0xFFF) | (BigInt(z & 0xFFF) << 12n) | (BigInt(y & 0xFF) << 24n) |
               (BigInt(galaxy & 0xFF) << 32n) | (BigInt(systemIndex & 0xFFF) << 40n);
    const rng = new SG.Mwc(ua);
    // Steps used by the orbit code before this (measured: 120/120).
    const first = bodies.slice(0, d[7]);
    const parents = new Set(first.filter(b => b.cls === 3).map(b => b.parent));
    const pre = 2 + 3 * first.filter(b => b.cls !== 3).length + parents.size;
    for (let k = 0; k < pre; k++) rng.step();
    const galType = BT.galType[galaxy % 20];
    const d4 = d[4];
    let wi = d4;
    if (galType === 3 && d4 === 0) wi = 6; else if (galType === 1 && d4 === 0) wi = 5;
    const W = BT.weights[wi].map(f);
    const seqSum = idxs => idxs.reduce((a, i) => f(a + W[i]), 0);
    const sumType1 = seqSum(BT.listType1);
    const sumMoon4 = seqSum([...Array(BT.listMoon4.length).keys()]);
    const sumClass4 = seqSum([...Array(BT.listClass4.length).keys()]);
    const sumAll = seqSum([...Array(17).keys()]);
    const zeros = W.slice(0, 17).filter(v => v === 0).length;
    const sysType = (d[5] === 1 || (d[4] === 0 && d[8] !== 0)) ? 1 : (d[6] !== 0 ? 2 : 0);
    const out = bodies.map(b => ({ cls: b.cls, parent: b.parent, seed: b.seed, biome: null, subtype: null }));
    const count = d[7];
    let i = 0, guard = 0;
    while (i < count && guard++ < 10000) {
      const e = out[i];
      const type = (sysType === 1 || sysType === 3) && i === d[8] - 1 ? 1 : (sysType === 3 ? 2 : 0);
      let forced = false, biome;
      if (galType === 3 && type === 1) { forced = true; biome = 0; }
      else if (type === 1) { rng.step(); biome = pickIdx(BT.listType1, W, f(f(rng_unit(rng) * sumType1) + 0), 4); }
      else if (d4 === 4 && e.cls === 3) { rng.step(); biome = pickIdx(BT.listMoon4, W, f(f(rng_unit(rng) * sumMoon4) + 0), 6); }
      else {
        rng.step(); const u = rng_unit(rng);
        if (e.cls === 4) biome = pickIdx(BT.listClass4, W, f(f(sumClass4 * u) + 0), 6);
        else biome = pickIdx([...Array(17).keys()], W, f(f(sumAll * u) + 0), 0);
      }
      if (sb.desc.b2d && i === 0) biome = 15;
      e.biome = biome; e.type = type;
      const saved = [rng.s0, rng.s1];
      const flag6 = type === 1 && galType === 4;
      // Subtype, one draw.
      let subtype = 1;
      const s1 = BT.sub1[biome];
      if (s1.length > 0) {
        const wOf = en => (en[0] === INFESTED && flag6) ? 0 : f(d4 === 4 ? en[1] : en[2]);
        const total = s1.reduce((a, en) => f(a + wOf(en)), 0);
        rng.step();
        const k = pickEntry(s1, wOf, f(f(rng_unit(rng) * f(total - 0)) + 0));
        subtype = (s1[k] || s1[s1.length - 1])[0];
      }
      const s2 = BT.sub2[biome];
      if (d4 !== 4 && s2.length > 0) {
        const wOf = en => (en[0] === INFESTED && flag6) ? 0 : f(en[1]);
        const total = s2.reduce((a, en) => f(a + wOf(en)), 0);
        let t = saved[0] * 0x5A76F899n + saved[1];
        const u = f(Number(t & 0xFFFFFFFFn) * 2.3283064370807974e-10);
        const k = pickEntry(s2, wOf, f(f(u * f(total - 0)) + 0));
        if ((s2[k] || [0])[0] === INFESTED) subtype = INFESTED;
        else if (subtype === INFESTED) {
          const wOf2 = en => en[0] === INFESTED ? 0 : f(en[1]);
          const total2 = s2.reduce((a, en) => f(a + wOf2(en)), 0);
          t = (t & 0xFFFFFFFFn) * 0x5A76F899n + (t >> 32n);
          const u2 = f(Number(t & 0xFFFFFFFFn) * 2.3283064370807974e-10);
          const k2 = pickEntry(s2, wOf2, f(f(u2 * f(total2 - 0)) + 0));
          subtype = (s2[k2] || s2[s2.length - 1])[0];
        }
      }
      e.subtype = subtype;
      let differs = i === 0 || biome !== out[i - 1].biome;
      if (17 - zeros < 2) differs = true;
      let lonely = false;
      if (type === 1) { lonely = biome !== 6 && biome !== 7 && biome !== 15; if (BT.listType1.length === 1) differs = true; }
      else if (count === 1 && !sb.desc.b2d) lonely = true;
      const bad = biome === 6 || biome === 7 || biome === 14 || biome === 15;
      if ((forced || i === 0 || differs) && (!lonely || !bad)) i++;
    }
    // The extra bodies (d[10]): a copy of the generator skipped ahead, the second weight set (17..33).
    if (sb.moons > 0) {
      const er = new SG.Mwc(0n); er.s0 = rng.s0; er.s1 = rng.s1;
      er.step();
      const skip = Number(er.s0 % 11n) + 3;
      for (let k = 0; k < skip; k++) er.step();
      const W2 = W.slice(17, 34);
      const seq2 = n => [...Array(n).keys()].reduce((a, k) => f(a + W2[k]), 0);
      const sumMoon4b = seq2(BT.listMoon4.length), sumClass4b = seq2(BT.listClass4.length), sumAll2 = seq2(17);
      const subtract = (list, r) => { for (const idx of list) { if (r < W2[idx]) return idx; r = f(r - W2[idx]); } return 0; };
      for (let k = 0; k < sb.moons; k++) {
        const j = d[7] + k, e = out[j];
        if (!e) break;
        let biome;
        er.step(); const u = rng_unit(er);
        if (d4 === 4 && e.cls === 3) biome = subtract(BT.listMoon4, f(f(u * f(sumMoon4b - 0)) + 0));
        else if (e.cls === 4) biome = subtract(BT.listClass4, f(f(f(sumClass4b - 0) * u) + 0));
        else biome = subtract([...Array(17).keys()], f(f(f(sumAll2 - 0) * u) + 0));
        if (sb.desc.b2d && j === 0) biome = 15;
        e.biome = biome; e.type = sysType === 3 ? 2 : 0;
        const saved = [er.s0, er.s1];
        let subtype = 1;
        const s1 = BT.sub1[biome];
        if (s1.length > 0) {
          const wOf = en => f(d4 === 4 ? en[1] : en[2]);
          const total = s1.reduce((a, en) => f(a + wOf(en)), 0);
          er.step();
          const kk = pickEntry(s1, wOf, f(f(rng_unit(er) * f(total - 0)) + 0));
          subtype = (s1[kk] || s1[s1.length - 1])[0];
        }
        const s2 = BT.sub2[biome];
        if (d4 !== 4 && s2.length > 0) {
          const total = s2.reduce((a, en) => f(a + f(en[1])), 0);
          let t = saved[0] * 0x5A76F899n + saved[1];
          const kk = pickEntry(s2, en => f(en[1]), f(f(f(Number(t & 0xFFFFFFFFn) * 2.3283064370807974e-10) * f(total - 0)) + 0));
          if ((s2[kk] || [0])[0] === INFESTED) subtype = INFESTED;
          else if (subtype === INFESTED) {
            const wOf2 = en => en[0] === INFESTED ? 0 : f(en[1]);
            const total2 = s2.reduce((a, en) => f(a + wOf2(en)), 0);
            t = (t & 0xFFFFFFFFn) * 0x5A76F899n + (t >> 32n);
            const k2 = pickEntry(s2, wOf2, f(f(f(Number(t & 0xFFFFFFFFn) * 2.3283064370807974e-10) * f(total2 - 0)) + 0));
            subtype = (s2[k2] || s2[s2.length - 1])[0];
          }
        }
        e.subtype = subtype;
      }
    }
    // Dead planets may turn Exotic (own generator from the address).
    if (d4 !== 4) {
      const local = new SG.Mwc(ua);
      for (let k = 0; k < count; k++) {
        if (out[k].biome !== 6) continue;
        local.step();
        if (f(Number(local.s0) * 2.3283064370807974e-10) < f(BT.deadToExotic)) {
          out[k].biome = 7;
          local.step();
          out[k].subtype = BT.weirdSub[Number((local.s0 * BigInt(BT.weirdSub.length)) >> 32n)];
        }
      }
    }
    return { ...sb, galType, bodies: out, rng, d4 };
  }
  const rng_unit = r => f(Number(r.s0) * 2.3283064370807974e-10);
  // Life/creature/resource draws, then the sentinel level the planet shows (group 2):
  // 0 low, 1 high, 2 aggressive, 3 corrupted (= dissonant). Also the scrap draw u (scrap if u <= 0.2 on a scrap biome).
  function subseed(seed, k) {
    const r = new SG.Mwc(seed);
    let a, b;
    for (let i = 0; i <= k; i++) { a = r.step(); b = r.step(); }
    return SG.fmix64((b << 32n) | a);
  }
  function planetSentinels({ seed, biome, subtype, type, d4, index, galaxy }) {
    seed = typeof seed === "bigint" ? seed : BigInt(seed);
    const r = new SG.Mwc(subseed(seed, 0));
    if (type !== 1 && biome !== 6 && biome !== 15 && biome !== 14) r.step();     // life
    if (type !== 1 && biome !== 6 && biome !== 15 && biome !== 14) r.step();     // creatures
    r.step();                                                                     // resource level
    const S = [r.s0, r.s1];
    const local = new SG.Mwc(0n); local.s0 = S[0]; local.s1 = S[1];
    const u = () => { local.step(); return f(Number(local.s0) * 2.3283064370807974e-10); };
    let level;
    if (type === 1) level = f(0.550000011920929) <= u() ? 1 : 0;
    else if (d4 === 4 && index === 1) level = 3;
    else if (type === 2) level = 0;
    else if (f(0.12999999523162842) <= u()) level = f(0.550000011920929) <= u() ? 1 : 0;
    else level = 2;
    if (BT.galType[galaxy % 20] === 2 && type !== 1 && u() < f(0.25)) level = 2;
    if (biome === 15 && level > 1) level = 0;
    if (level === 2) {
      const t = local.s0 * 0x5A76F899n + local.s1;
      if (f(Number(t & 0xFFFFFFFFn) * 2.3283064370807974e-10) < f(0.25)) level = 3;
    }
    const sr = new SG.Mwc(0n); sr.s0 = S[0]; sr.s1 = S[1]; sr.step();
    // Building level (0x3528): scrap yards only exist on levels 2 and 3.
    const bl = type === 1 ? 3 : biome === 7 ? 4 : subtype === 0x18 ? 5 : biome === 14 ? 6 : biome === 15 ? 7 : biome === 6 ? 0 : 2;
    const scrapRoll = f(Number(sr.s0) * 2.3283064370807974e-10);
    return { level, scrapRoll, scrap: scrapRoll <= f(0.2) && (bl === 2 || bl === 3) };
  }


  // Sentinel level and scrap for every body of a systemBiomes() result. The game writes the galaxy number only into
  // the first `planets` entries (it loops to the planet count), so later bodies use galaxy 0's rules.
  const SENTINELS = ["low", "high", "aggressive", "corrupted"];
  function systemSentinels(sys, galaxy) {
    return sys.bodies.map((b, i) => {
      const r = planetSentinels({ seed: b.seed, biome: b.biome, subtype: b.subtype, type: b.type ?? 0, d4: sys.d4,
                                  index: i, galaxy: i < sys.planets ? galaxy : 0 });
      return { ...r, sentinels: SENTINELS[r.level], dissonant: r.level === 3 };
    });
  }

  const SysGen = { Rng32, regionInfo, systemDescriptor, systemBodies, systemBiomes, planetSentinels, systemSentinels,
                   clampAddr };
  if (typeof module !== "undefined" && module.exports) module.exports = SysGen;
  else root.SysGen = SysGen;
})(typeof window !== "undefined" ? window : globalThis);
