"use strict";
/*
 * Station: where a system's space station sits and how it faces, re-implemented from the game.
 * Exposes window.Station (browser) / module.exports (Node tests).
 * Needs StarGen (lib/stargen.js). float32 in the game's order, checked against the game.
 *
 *   Station.spawn(ua, planets) → { position: [x, y, z], facing: [x, y, z], seed: BigInt }
 *     ua: the system's universal address (BigInt, planet 0); planets: [{ pos: [x, y, z], cls }] in the
 *     game's order (the first `count` are planets, then prime planets). cls: 0 L, 1 M, 2 S, 3 moon, 4 giant.
 */
(function (root) {
  const SG = typeof module !== "undefined" && module.exports ? require("./stargen.js") : root.StarGen;
  const f = Math.fround;
  const MWC = 0x5A76F899n, M32 = 0xFFFFFFFFn;
  const TWO_PI = f(6.2831854820251465), FLT_MAX = f(3.4028234663852886e+38), EPS = f(1.52587890625e-05);
  const RING = f(3000);                        // a value the game sets at runtime

  // A body's size by class (with the game's runtime flag set).
  const SIZE = [0x80, 0x60, 0x40, 0x10, 0x200];
  // The radius the system code uses: n, or p - 1 when n is a power of two (p = 2^ceil(log2 n)), times 32 * 32.
  function bodyRadius(cls) {
    const n = SIZE[cls] ?? 8;
    const p = 2 ** Math.ceil(Math.log2(n));
    return f(f((p - Math.max(1, p - n)) * 32) * 32);
  }

  class Rng {                                  // the generator's MWC, ror-initialised from a 64-bit seed
    constructor(seed) {
      const lo = seed & M32, hi = (seed >> 32n) & M32;
      this.s0 = (lo + (lo === 0n ? 1n : 0n)) & M32;
      this.s1 = ((((lo >> 16n) | (lo << 16n)) & M32) ^ hi ^ lo);
    }
    step() { const t = this.s0 * MWC + this.s1; this.s0 = t & M32; this.s1 = t >> 32n; return this.s0; }
    unit() { return f(Number(this.step()) * 2.3283064370807974e-10); }
  }

  const sq = v => [f(v[0] * v[0]), f(v[1] * v[1]), f(v[2] * v[2])];
  const dot3 = v => { const s = sq(v); return f(s[2] + f(s[1] + s[0])); };   // the game's SIMD horizontal sum
  const sub = (a, b) => [f(a[0] - b[0]), f(a[1] - b[1]), f(a[2] - b[2])];
  function norm(v) {
    const inv = f(1 / f(Math.sqrt(dot3(v))));
    return [f(v[0] * inv), f(v[1] * inv), f(v[2] * inv)];
  }
  const tiny = d => Math.abs(d[0]) <= EPS && Math.abs(d[1]) <= EPS && Math.abs(d[2]) <= EPS;

  // ---------------------------------------------------------------- planet positions
  // Values the game sets at runtime: the inclination limits and the outer distance.
  const G6A4 = f(524288), INC_MIN = f(-30), INC_MAX = f(30), MAX_DIST = f(1000000);
  const DEG = f(0.01745329238474369), RAD2DEG = f(57.295780181884766), HALF_PI = f(1.5707963705062866),
        PI = f(3.1415927410125732), INV32 = 2.3283064370807974e-10;
  const ACOS = [0.0007179649546742439, 0.004116097930818796, 0.011272900737822056, 0.02094927802681923,
                0.03268376365303993, 0.050625279545784, 0.08903469890356064, 0.21460144221782684].map(f);
  // The game's acos polynomial (sqrt(1 - |x|) * p(|x|), mirrored for x < 0).
  function acos(x) {
    const a = Math.abs(x);
    let p = f(f(a * ACOS[0]) - ACOS[1]);
    p = f(f(p * a) + ACOS[2]); p = f(f(p * a) - ACOS[3]); p = f(f(p * a) + ACOS[4]);
    p = f(f(p * a) - ACOS[5]); p = f(f(p * a) + ACOS[6]); p = f(f(p * a) - ACOS[7]);
    p = f(f(p * a) + HALF_PI);
    const r = f(f(Math.sqrt(f(1 - a))) * p);
    return x < 0 ? f(PI - r) : r;
  }
  // n points on a Fibonacci sphere, rotated by `seed` steps.
  const GOLDEN = f(f(3 - f(Math.sqrt(5))) * PI);
  function fibSphere(n, seed) {
    const off = f(2 / n), half = f(off * 0.5), out = [];
    for (let i = 0; i < n; i++) {
      const y = f(f(f(i * off) - 1) + half);
      const r = f(Math.sqrt(f(1 - f(y * y))));
      const phi = f(((i + seed) >>> 0) % n * GOLDEN);
      out.push([f(SG.cos(phi) * r), y, f(SG.sin(phi) * r)]);
    }
    return out;
  }

  // bodies: [{ cls, parent }] in the game's order (planets, then prime planets); returns [[x, y, z]] (whole numbers).
  function planetPositions(ua, bodies, planets) {
    const rng = new Rng(BigInt(ua));
    const total = bodies.length, primes = total - planets;
    const s = bodies.map(b => bodyRadius(b.cls));
    const pos = bodies.map(() => [0, 0, 0]);
    const moons = new Array(total).fill(0);
    let roots = 0;
    for (let i = 0; i < planets; i++) if (bodies[i].parent === -1) roots++;
    let accum = f(f(rng.unit() * 360) - 180);
    let dist = f(s[0] * 2);
    const step = f(360 / Math.max(1, roots - 1));
    const lo = f(step * 0.5), span = f(f(step * 1.5) - lo);

    function place(i, r) {                    // one planet; r: the RNG to use
      accum = f(accum + f(f(r.unit() * span) + lo));
      let c = f(f(f(G6A4 * 0.5) - f(s[i] + s[i])) > 0 ? f(f(G6A4 * 0.5) - f(s[i] + s[i])) : 0);
      c = f(c / dist);
      c = Math.min(1, Math.max(-1, Math.min(1, c)));
      const e = f(f(HALF_PI - acos(c)) * RAD2DEG);
      const hi = Math.min(e, INC_MAX), lo2 = Math.max(f(-e), INC_MIN);
      const inc = f(f(-f(f(r.unit() * f(hi - lo2)) + lo2)) * DEG);
      const az = f(accum * DEG);
      const ci = SG.cos(inc);
      const x = f(f(SG.sin(az) * ci) * dist), y = f(SG.sin(inc) * dist), z = f(f(SG.cos(az) * ci) * dist);
      pos[i] = [Math.floor(x), Math.floor(y), Math.floor(z)];
      if (roots > 0) {
        const s3 = f(s[i] * 3);
        const d = f(f(f(f(MAX_DIST - dist) / roots) - s3) * r.unit());
        dist = f(dist + f(f(d + s3) + s3));
      }
    }

    for (let i = 0; i < planets; i++) {
      if (bodies[i].cls === 3) moons[bodies[i].parent]++;
      else place(i, rng);
    }
    const lists = [];
    for (let p = 0; p < planets; p++) if (moons[p] > 0) lists[p] = fibSphere(moons[p], Number(rng.step()));
    if (roots > 0) rng.step();                 // picks the system's "special" planet (0x21cd), not needed here
    const local = new Rng(0n); local.s0 = rng.s0; local.s1 = rng.s1;    // prime planets use a copy
    for (let j = 0; j < primes; j++) {
      const i = planets + j;
      if (bodies[i].parent === -1) roots++;
      if (bodies[i].cls === 3) moons[bodies[i].parent]++;
      else place(i, local);
    }
    for (let p = planets; p < total; p++) if (moons[p] > 0) lists[p] = fibSphere(moons[p], Number(local.step()));
    for (let i = 0; i < total; i++) {
      if (bodies[i].cls !== 3) continue;
      const p = bodies[i].parent, d = lists[p][--moons[p]];
      const k = f(f(s[p] * 1.5) + f(s[i] + s[i]));
      pos[i] = [0, 1, 2].map(a => Math.floor(f(f(d[a] * k) + pos[p][a])));
    }
    return pos;
  }

  function spawn(ua, planets, count) {
    ua = BigInt(ua);
    const sr = new Rng(ua);
    const lo1 = sr.step(), lo2 = (lo1 * MWC + sr.s1) & M32;
    const seed = SG.fmix64((lo2 << 32n) | lo1);

    const rng = new Rng(ua);                   // re-seeds the generator from the address
    const u = rng.unit();
    const sign = (rng.step() & 1n) ? -1 : 1;   // the next step's low bit decides above or below
    const pos = [0, f(sign * f(f(u * 5000) + 5000)), 0];

    let best = -1, min = FLT_MAX;
    const scan = (from, to) => {
      for (let i = from; i < to; i++) {
        const d = dot3(sub(pos, planets[i].pos));
        if (min > d) { min = d; best = i; }
      }
    };
    count = count ?? planets.length;
    scan(0, count);
    if (best < 0) scan(count, planets.length);
    const P = planets[best].pos;

    const N = tiny(sub(pos, P)) ? [0, 0, 0] : norm(sub(P, pos));
    const A = norm([N[2], 0, f(-N[0])]);
    const B = [f(f(A[2] * N[1]) - f(A[1] * N[2])), f(f(A[0] * N[2]) - f(A[2] * N[0])), f(f(A[1] * N[0]) - f(A[0] * N[1]))];

    const R = bodyRadius(planets[best].cls);
    const u1 = rng.unit(), u2 = rng.unit();
    const t = f(1 - f(u1 + u1));
    const s = f(Math.sqrt(Math.max(0, f(1 - f(t * t)))));
    const phi = f(u2 * TWO_PI);
    const V = [f(SG.cos(phi) * s), t, f(SG.sin(phi) * s)];   // the game's own cos and sin
    const Q = [f(f(V[0] * R) + P[0]), f(f(V[1] * R) + P[1]), f(f(V[2] * R) + P[2])];

    const th = f(rng.unit() * TWO_PI);
    const ct = SG.cos(th), st = SG.sin(th);
    const W = [0, 1, 2].map(k => f(f(f(f(ct * A[k]) * RING) + pos[k]) + f(f(st * B[k]) * RING)));
    const facing = tiny(sub(W, Q)) ? [0, 0, 0] : norm(sub(Q, W));
    return { position: pos, facing, seed, nearest: best };
  }

  // ---------------------------------------------------------------- the station in the world
  // Rows right, up, forward (facing re-normalised), position. right = norm(Y × f), up = f × right.
  function matrix(sp) {
    const fw = norm(sp.facing);
    const r = norm([f(f(1 * fw[2]) - f(0 * fw[1])), f(f(0 * fw[0]) - f(0 * fw[2])), f(f(0 * fw[1]) - f(1 * fw[0]))]);
    const up = [f(f(r[2] * fw[1]) - f(r[1] * fw[2])), f(f(r[0] * fw[2]) - f(r[2] * fw[0])), f(f(r[1] * fw[0]) - f(r[0] * fw[1]))];
    return { right: r, up, forward: fw, position: sp.position };
  }
  // A point given in the station model's own coordinates, in the system.
  function toWorld(m, l) {
    return [0, 1, 2].map(k => f(f(f(f(l[0] * m.right[k]) + f(l[1] * m.up[k])) + f(l[2] * m.forward[k])) + m.position[k]));
  }

  // an object's seed from its rounded position (CityHash's Hash128to64 chain).
  const KMUL = 0x9DDFEA08EB382D69n, M64 = 0xFFFFFFFFFFFFFFFFn;
  const round = v => BigInt.asUintN(64, BigInt(Math.trunc(f(v + (v < 0 || Object.is(v, -0) ? -0.5 : 0.5)))));
  function positionSeed(p) {
    const X = round(p[0]), Y = round(p[1]), Z = round(p[2]);
    let a = ((Y ^ X) * KMUL) & M64;
    let d = (((a >> 47n) ^ a ^ X) * KMUL) & M64;
    const h = (((d >> 47n) ^ d) * KMUL) & M64;
    const c = ((Z ^ h) * KMUL) & M64;
    d = (((c >> 47n) ^ c ^ h) * KMUL) & M64;
    return (((d >> 47n) ^ d) * KMUL) & M64;
  }
  // The seed a shop generator gets for an interaction at a station-local point.
  const shopSeed = (m, local) => SG.fmix64(positionSeed(toWorld(m, local)));

  // Where things stand in the two station layouts (measured in the game, 2026-11-22; station-local, ±0.005).
  const LAYOUT = {
    normal: { shop: [-5.011, 1.875, -942.5], core: [0, 7.519, -965.046], guildEnvoy: [50.743, 6.1, -955.437],
              techShops: [[-20.398, 4.999, -942.5], [-9.713, 4.999, -942.5], [17.943, 4.999, -944.869], [11.969, 4.999, -940.452]] },
    pirate: { shop: [16.081, -122.98, -1334.96], core: [-0.355, -123.468, -1364.568], techShops: [[28.535, -121.195, -1317.637]] },
  };

  const Station = { spawn, bodyRadius, planetPositions, fibSphere, matrix, toWorld, positionSeed, shopSeed, LAYOUT };
  if (typeof module !== "undefined" && module.exports) module.exports = Station;
  else root.Station = Station;
})(typeof window !== "undefined" ? window : globalThis);
