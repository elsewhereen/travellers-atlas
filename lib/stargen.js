"use strict";
/*
 * StarGen: star positions inside a region, re-implemented in JavaScript.
 * Exposes window.StarGen (browser) / module.exports (Node, for tests).
 *
 * Everything is float32 arithmetic in the same order as the game, so results match bit for bit:
 * f(x) = Math.fround(x) after every single operation, and every constant that isn't exact in float32 written as f(c).
 * Integer maths uses BigInt (64-bit) or >>> 0 (32-bit).
 *
 * Main entry points:
 *   systemPosition(x, y, z, systemIndex, galaxy) -> { ly: [x, y, z] from the galactic centre, status }   (status 0 = ok)
 *   regionStars(x, y, z, galaxy) -> { stars: [{ index, pos }], beforeRandom }   (region units, ±50, 1 unit = 4 ly)
 *
 * Checked bit for bit against the game: every
 * building block, 106 whole regions in several galaxies (about 60,000 stars), and the index lookup incl. edge cases.
 */
(function (root) {
  const f = Math.fround;

  // ---------------------------------------------------------------- random numbers
  const M32 = 0xFFFFFFFFn, MWC = 0x5A76F899n;

  // Multiply-with-carry generator; state = (s0, s1) as BigInt, the same one the planet code uses.
  class Mwc {
    constructor(seed64) {          // "ror init" from a 64-bit seed
      const lo = seed64 & M32, hi = (seed64 >> 32n) & M32;
      this.s0 = (lo + (lo === 0n ? 1n : 0n)) & M32;
      this.s1 = ((((lo >> 16n) | (lo << 16n)) & M32) ^ hi ^ lo);
    }
    step() { const t = this.s0 * MWC + this.s1; this.s0 = t & M32; this.s1 = t >> 32n; return this.s0; }
    // float in [0,1): (float)((double)u * 2^-32)
    unit() { return f(Number(this.step()) * 2.3283064370807974e-10); }
    // integer in [0,n): (u * n) >> 32
    below(n) { return Number((this.step() * BigInt(n)) >> 32n); }
  }

  // Region seed mixing: Threefry-style rounds over the 64-bit region key (key schedule constant 0x1bd11bdaa9fc1a22).
  // x is the counter block (x = key for block 0, key + 1 + n for later blocks).
  // Returns the counter-RNG state the star placement uses: { key, a, b, c, d }.
  const M64 = (1n << 64n) - 1n;
  const ror = (x, n) => ((x >> BigInt(n)) | (x << BigInt(64 - n))) & M64;
  function regionMix(k, x = k) {
    k &= M64; x &= M64;
    const add = (...v) => v.reduce((s, y) => s + y, 0n) & M64;
    let u14 = ror(x, 7) ^ x;
    let u9 = k ^ 0x1bd11bdaa9fc1a22n;
    let u12 = ((x * 2n) & M64) ^ ror(x, 24);
    let u15 = ror(u14, 41) ^ add(u14, x);
    u14 = add(u12, u14, x);
    let u6 = add(x * 2n, u15);
    let u16 = ror(u15, 27) ^ u6;
    u15 = add(u16, u14);
    u14 = add(u9, 1n, ror(u12, 59) ^ u14);
    u12 = ror(u16, 39) ^ u15;
    u6 = add(u14, u6);
    u14 = ror(u14, 31) ^ u6;
    u15 = add(u14, u15);
    u6 = add(u12, u6);
    u14 = ror(u14, 18) ^ u15;
    u12 = ror(u12, 52) ^ u6;
    u15 = add(u12, u15);
    u6 = add(u14, u6);
    u12 = ror(u12, 6) ^ u15;
    u14 = ror(u14, 42) ^ u6;
    u6 = add(u12, u6);
    u12 = ror(u12, 32) ^ u6;
    u15 = add(u14, u15);
    u14 = add(k, 2n, ror(u14, 32) ^ u15);
    u15 = add(u12, u15);
    u12 = ror(u12, 50) ^ u15;
    u6 = add(u9, u14, u6);
    u14 = ror(u14, 48) ^ u6;
    u6 = add(u12, u6);
    u15 = add(u14, u15);
    u12 = ror(u12, 7) ^ u6;
    u14 = ror(u14, 12) ^ u15;
    u15 = add(u12, u15);
    u16 = ror(u12, 41) ^ u15;
    u6 = add(u14, u6);
    u14 = ror(u14, 24) ^ u6;
    u15 = add(u14, u15);
    u6 = add(u16, u6);
    u14 = add(ror(u14, 59) ^ u15, 3n);
    let c = add(u6, u14, k);
    u12 = ror(u14, 31) ^ c;
    u14 = add(ror(u16, 27) ^ u6, u9);
    u15 = add(u14, u15);
    u14 = ror(u14, 39) ^ u15;
    u15 = add(u12, u15);
    u6 = ror(u12, 18) ^ u15;
    c = add(u14, c);
    u14 = ror(u14, 52) ^ c;
    u15 = add(u14, u15);
    c = add(u6, c);
    u14 = ror(u14, 6) ^ u15;
    u6 = ror(u6, 42) ^ c;
    c = add(u14, c);
    u15 = add(u6, u15);
    u14 = add(ror(u14, 32) ^ c, k);
    u6 = add(ror(u6, 32) ^ u15, 4n);
    u15 = add(u9, u14, u15);
    u9 = ror(u14, 50) ^ u15;
    c = add(u6, c);
    u14 = ror(u6, 48) ^ c;
    u15 = add(u14, u15);
    c = add(u9, c);
    u14 = ror(u14, 12) ^ u15;
    u6 = ror(u9, 7) ^ c;
    u15 = add(u6, u15);
    c = add(u14, c);
    u6 = ror(u6, 41) ^ u15;
    u14 = ror(u14, 24) ^ c;
    c = add(u6, c);
    const b = ror(u6, 27) ^ c;
    u15 = add(u14, u15);
    const a = add(u15, k);
    const d = add(ror(u14, 59) ^ u15, 5n);
    return { key: k, a, b, c, d };
  }

  // The region key the generator is called with: X | Z<<12 | Y<<24 | galaxy<<32 (voxel coordinates, 12/12/8 bits).
  const regionKey = (x, y, z, galaxy = 0) =>
    BigInt(x & 0xFFF) | (BigInt(z & 0xFFF) << 12n) | (BigInt(y & 0xFF) << 24n) | (BigInt(galaxy) << 32n);

  function fmix64(x) {
    x ^= x >> 33n; x = (x * 0x64DD81482CBD31D7n) & M64;
    x ^= x >> 33n; x = (x * 0xE36AA5C613612997n) & M64;
    return x ^ (x >> 33n);
  }

  // Paul Hsieh's SuperFastHash over 8 bytes (two 32-bit words), starting from h.
  function superFastHash8(h, lo32, hi32) {
    h >>>= 0;
    for (const w of [lo32 >>> 0, hi32 >>> 0]) {
      h = (h + (w & 0xFFFF)) >>> 0;
      const tmp = (((w >>> 16) << 11) ^ h) >>> 0;
      h = ((h << 16) ^ tmp) >>> 0;
      h = (h + (h >>> 11)) >>> 0;
    }
    h = (h ^ (h << 3)) >>> 0; h = (h + (h >>> 5)) >>> 0;
    h = (h ^ (h << 4)) >>> 0; h = (h + (h >>> 17)) >>> 0;
    h = (h ^ (h << 25)) >>> 0; h = (h + (h >>> 6)) >>> 0;
    return h;
  }

  // the "arms" through a region. One point on each of the six faces, from a hash that the
  // neighbouring region shares (so arms continue across), plus a random centre point; links between points
  // become segments, in region units (±50). Returns [[ax, ay, az, aw, bx, by, bz, bw], …] in the game's order.
  function regionSegments(x, y, z, galaxy = 0) {
    // Face order: -Z, +Z, -Y, +Y, -X, +X. Each: the boundary coordinate and the other two (xor'ed).
    const faces = [[z - 1, x, y], [z, x, y], [y - 1, z, x], [y, z, x], [x - 1, z, y], [x, z, y]];
    const pts = [];
    for (let fi = 0; fi < 6; fi++) {
      const [b, o1, o2] = faces[fi];
      const xr = (o1 ^ o2) >>> 0;
      // The boundary value as 64 bits: b >= 0 -> sign-extended (b - 2^31); b < 0 -> (b - 2^31) & 0x7fffffff.
      const low = ((b | 0) - 0x80000000) | 0;
      const lo32 = b >= 0 ? low >>> 0 : (low & 0x7FFFFFFF) >>> 0;
      const hi32 = b >= 0 ? (low < 0 ? 0xFFFFFFFF : 0) : 0;
      const h = superFastHash8(xr, lo32, hi32);
      const r = new Mwc(BigInt(h));
      const u1 = r.unit(), u2 = r.unit();
      pts.push([[u1, u2, -1, 1], [u1, u2, 1, 1], [u1, -1, u2, 1], [u1, 1, u2, 1], [-1, u1, u2, 1], [1, u1, u2, 1]][fi]);
    }
    // Links: L[point][face] = linked point, -1 = own face, -2 = none.
    const L = pts.map((_, i) => { const row = [-2, -2, -2, -2, -2, -2]; row[i] = -1; return row; });
    const sub = (p, q) => [0, 1, 2].map(k => f(p[k] - q[k]));
    for (let a = 0; a < 5; a++) {
      for (let b = a + 1; b < 6; b++) {
        const d = sub(pts[a], pts[b]).map(v => f(v * v));
        const len2 = f(d[2] + f(d[1] + d[0]));
        const len = len2 === 0 ? 0 : f(Math.sqrt(len2));
        if (len <= 1) { L[a][b] = b; L[b][a] = a; }
      }
    }
    // Centre point from the region's own generator.
    const rr = new Mwc(fmix64(regionKey(x, y, z, galaxy)));
    const v1 = rr.unit(), v2 = rr.unit(), v3 = rr.unit();
    const c = pts.length;
    pts.push([f(v1 - 0.5), f(v2 - 0.5), f(v3 - 0.5), 1]);
    L.push([-2, -2, -2, -2, -2, -2]);
    for (let a = 0; a < 5; a++) {
      for (let b = a + 1; b < 6; b++) {
        if (L[a][b] === -2) { L[a][b] = c; L[c][a] = a; } else L[c][b] = a;
        if (L[b][a] === -2) { L[b][a] = c; L[c][b] = b; } else L[c][a] = b;
      }
    }
    // Unique undirected links from the six face points, in row/slot order.
    const seen = new Set(), segs = [];
    for (let p = 0; p < 6; p++) {
      for (let s = 0; s < 6; s++) {
        const q = L[p][s];
        if (q === -1) continue;
        if (q === -2) throw new Error("unlinked face point");
        const k1 = ((q << 16) | p) >>> 0, k2 = ((p << 16) | q) >>> 0;
        if (seen.has(k1) || seen.has(k2)) continue;
        segs.push([...pts[p].map(v => f(v * 50)), ...pts[q].map(v => f(v * 50))]);
        seen.add(k1); seen.add(k2);
      }
    }
    return segs;
  }

  // ---------------------------------------------------------------- the region generator
  // Settings the game uses for every region (galaxy-independent; read from its galaxy globals). Index = float slot.
  const S = {
    40: f(0.04), 41: f(0.004), 42: f(1), 43: f(0.01), 44: f(0.7), 45: f(0.85), 46: f(0.1),
    58: f(40), 59: f(170), 60: f(0.8), 61: f(1), 62: f(0.1), 63: f(0.6), 64: f(40), 65: f(140), 66: f(50), 67: f(100),
    68: f(0.6), 69: f(0.94), 76: f(0.55), 77: f(0.9), 78: f(1.25), 79: f(0.15), 82: f(4.000000953674316),
    91: f(15), 92: f(1), 93: f(0.68),
  };
  const K = {
    TENTH: f(0.10000000149011612), STEP: f(5.263157844543457), STEPU: f(0.05263157933950424),
    GRID0: f(-47.3684196472168), SQRT3_2: f(0.8660249710083008), EDGE: f(1.5399999618530273),
    TINY: f(2.3283064365386963e-10), PI: f(3.1415927410125732), HALF_PI: f(1.5707963705062866),
    TWO_PI: f(6.2831854820251465), PI3_2: f(4.71238899230957), MAXF: f(3.4028234663852886e+38), R12: f(1.2000000476837158),
  };
  // 4-lane helpers (index 0..3), every op rounded to float32 like SSE.
  const v4 = (a, b, c, d) => [f(a), f(b), f(c), f(d)];
  const add4 = (a, b) => a.map((v, k) => f(v + b[k]));
  const sub4 = (a, b) => a.map((v, k) => f(v - b[k]));
  const mul4 = (a, b) => a.map((v, k) => f(v * b[k]));
  const scale4 = (a, s) => a.map(v => f(v * s));
  const bcast = (a, k) => [a[k], a[k], a[k], a[k]];
  const hsum3 = q => f(q[2] + f(q[1] + q[0]));                         // z + (y + x)
  const len2 = a => hsum3(mul4(a, a));
  const shufC9 = a => [a[1], a[2], a[0], a[3]], shufD2 = a => [a[2], a[0], a[1], a[3]];
  // cross product the way the game writes it: shuf(a,c9)*shuf(b,d2) - shuf(a,d2)*shuf(b,c9)
  const cross4 = (a, b) => sub4(mul4(shufC9(a), shufD2(b)), mul4(shufD2(a), shufC9(b)));
  const UP = v4(0, 1, 0, 1), UP2 = v4(0, 0, 1, 1), ZW = v4(0, 0, 0, 1), XW = v4(1, 0, 0, 1), YZ0 = [0, 1];

  // 2D simplex noise (value only), Gustavson's constants, 8 gradients, x40.
  const G2D = [[-1, -1], [1, 0], [-1, 0], [1, 1], [-1, 1], [0, -1], [0, 1], [1, -1]];
  const F2 = f(0.3660253882408142), G2 = f(0.21132487058639526), G2x2 = f(0.4226497411727905);
  function simplex2(x, y) {
    const s = f(f(x + y) * F2);
    const xs = f(s + x), ys = f(s + y);
    let i = Math.trunc(xs), j = Math.trunc(ys);
    if (xs <= 0) i -= 1;                                                  // the game's fast floor (also at 0)
    if (ys <= 0) j -= 1;
    const t = f(f(i + j) * G2);
    const x0 = f(x - f(i - t)), y0 = f(y - f(j - t));
    const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
    const x1 = f(f(x0 - i1) + G2), y1 = f(f(y0 - j1) + G2);
    const x2 = f(f(x0 - 1) + G2x2), y2 = f(f(y0 - 1) + G2x2);
    const ii = i & 255, jj = j & 255;
    const corner = (px, py, g) => {
      const tt = f(f(0.5 - f(px * px)) - f(py * py));
      if (0 > tt) return 0;
      const t2 = f(tt * tt), t4 = f(t2 * t2);
      return f(f(f(G2D[g][1] * py) + f(G2D[g][0] * px)) * t4);
    };
    const n0 = corner(x0, y0, PERM[PERM[jj] + ii] & 7);
    const n1 = corner(x1, y1, PERM[PERM[jj + j1] + i1 + ii] & 7);
    const n2 = corner(x2, y2, PERM[PERM[jj + 1] + 1 + ii] & 7);
    return f(f(f(n1 + n0) + n2) * 40);
  }

  // Unit vector the game's way: d * (1/|d|), or d unchanged when |d| = 0. Returns [dir, len, len2].
  function normalise(d) {
    const l2 = len2(d);
    if (l2 === 0) return [d, 0, 0];
    const l = f(Math.sqrt(l2));
    return [scale4(d, f(1 / l)), l, l2];
  }
  // The two axes across a segment: a = dir x up (or dir x z if that's ~0), b = dir x a.
  function segmentAxes(dir) {
    let a = cross4(dir, UP);
    if (K.TINY > len2(a)) a = sub4(mul4(shufD2(UP2), shufC9(dir)), mul4(shufC9(UP2), shufD2(dir)));
    return [a, cross4(dir, a)];
  }

  /*
   * All stars of one region, in the game's list order: [{ index, pos: [x, y, z] }] in region units
   * (±50 around the region centre; 1 unit = 4 ly). index = the system index the game gives it.
   */
  function regionStars(x, y, z, galaxy = 0) {
    const out = { stars: [], beforeRandom: 0 };
    if (x * x + y * y + z * z < 64) return out;                      // the core: no stars
    const rng = new Mwc(regionKey(x, y, z, galaxy));
    const origin = v4(f(x * K.TENTH), f(y * K.TENTH), f(z * K.TENTH), 1);
    let index = 0;
    const addStar = (pos, draws) => {
      if (index > 0xffe) return;
      if (draws) rng.step();
      out.stars.push({ index, pos: [pos[0], pos[1], pos[2]] });
      index++;
    };
    // a point near a segment, pushed sideways along the two axes by up to 5 units.
    const nearSegment = (p, ax, scale) => {
      let r1 = f(f(rng.unit() * f(scale - 0)) + 0);
      let r2 = f(scale - r1);
      if (rng.step() & 1n) r1 = f(r1 * -1);
      if (rng.step() & 1n) r2 = f(r2 * -1);
      rng.step(); rng.step();                                           // star size/brightness
      return [0, 1, 2].map(k => f(f(f(r1 * ax[0][k]) + p[k]) + f(r2 * ax[1][k])));
    };

    rng.step();                                                         // colour
    const segs = regionSegments(x, y, z, galaxy).map(s => [s.slice(0, 4), s.slice(4, 8)]);
    const SEG_STARS = 122, RADIUS = 5;
    let walked = 0;
    if (f(0.7) > S[76]) {
      for (const [A, B] of segs) {
        const [dir, len] = normalise(sub4(B, A));
        const ax = segmentAxes(dir);
        const t0 = f(1 / f(len / 5)), range = f(f(1 / f(len / 10)) - t0);
        if (!(1 >= t0)) continue;
        let t = t0;
        do {
          let p;
          if (0 >= t) p = A;
          else if (t >= 1) p = B;
          else { const [dn, l] = normalise(sub4(B, A)); p = add4(A, scale4(dn, f(l * t))); }
          addStar(nearSegment(p, ax, RADIUS), false);
          walked++;
          t = f(t + f(f(rng.unit() * range) + t0));
        } while (1 >= t);
      }
      for (let n = walked; n < SEG_STARS; n++) {
        const [A, B] = segs[Number((rng.step() * BigInt(segs.length)) >> 32n)];
        const u = rng.unit();
        const d = sub4(B, A);
        const [dir] = normalise(d);
        const ax = segmentAxes(dir);
        let p;
        if (0 >= u) p = A;
        else if (u >= 1) p = B;
        else { const [dn, l] = normalise(d); p = add4(scale4(dn, f(l * u)), A); }
        addStar(nearSegment(p, ax, RADIUS), false);
      }
    }

    // Region-wide draws before the grid.
    const farGate = Number((rng.step() * 100n) >> 32n);
    const turn = (rng.step() & 1n) ? K.HALF_PI : K.PI;
    const span = (lo, hi) => { const u = rng.unit(); return f(f(u * f(hi - lo)) + lo); };
    const f964 = span(S[68], S[69]);
    const a1 = f(f(rng.unit() * K.TWO_PI) - K.PI), c1 = cos(a1), s1 = sin(a1);
    const a2 = f(f(rng.unit() * K.TWO_PI) - K.PI), c2 = cos(a2), s2 = sin(a2);
    const f95c = f(f(rng.unit() * K.PI3_2) + K.HALF_PI);
    const f96c = span(S[60], S[61]), f968 = span(S[62], S[63]);
    rng.step();                                                         // f974 (cloud size)
    const f960 = span(S[66], S[67]), f978 = span(S[64], S[65]);
    const R1a = v4(0, c1, f(-s1), 1), R1b = v4(0, s1, c1, 1);
    const M0 = v4(c2, f(-s2), 0, 1), M1 = v4(s2, c2, 0, 1);
    const farLimit = Math.trunc(S[91]);

    for (let i = 0; i < 19; i++) for (let j = 0; j < 19; j++) for (let k = 0; k < 19; k++) {
      const fi = f(i), fj = f(j), fk = f(k);
      const dc = sub4(v4(0.5, 0.5, 0.5, 1), v4(f(fi * K.STEPU), f(fj * K.STEPU), f(fk * K.STEPU), 1));
      let dlen = 0;
      if (!(dc[0] === 0 && dc[1] === 0 && dc[2] === 0)) { const q = len2(dc); dlen = q === 0 ? 0 : f(Math.sqrt(q)); }
      let edge = f(f(K.SQRT3_2 - dlen) * K.EDGE);
      edge = Math.min(1, Math.max(0, edge));
      let P = add4(add4(v4(f(fi * K.STEP), f(fj * K.STEP), f(fk * K.STEP), 1), ZW), v4(K.GRID0, K.GRID0, K.GRID0, 1));
      const nx = f(P[0] + origin[0]), ny = f(origin[1] + P[1]), nz = f(origin[2] + P[2]);
      const slope = slopeFbm(f(nx * S[79]), f(ny * S[79]), f(nz * S[79]), 4, S[78], S[77]);
      // Nearest point on any segment.
      let best = K.MAXF, bA = ZW, bB = ZW, bQ = ZW, bt = 0;
      for (const [A, B] of segs) {
        const ab = sub4(B, A), dot = hsum3(mul4(sub4(P, A), ab));
        let Q, t;
        if (0 >= dot) { Q = A; t = 0; }
        else { const l2 = len2(ab); if (dot >= l2) { Q = B; t = 1; } else { t = f(dot / l2); Q = add4(A, scale4(ab, t)); } }
        const dist = f(Math.sqrt(len2(sub4(Q, P))));
        if (best > dist) { best = dist; bA = A; bB = B; bQ = Q; bt = t; }
      }
      const ab = sub4(bB, bA);
      const dn = scale4(ab, f(1 / f(Math.sqrt(len2(ab)))));
      const perp = sub4(mul4(shufC9(dn), shufD2(UP)), mul4(shufD2(dn), shufC9(UP)));
      const wobble = f(simplex2(f(S[82] * bt), origin[0]) * f978);
      const diff = sub4(P, add4(mul4(perp, [wobble, wobble, wobble, wobble]), bQ));
      const dl = f(Math.sqrt(len2(diff)));
      if (!(slope > S[76])) continue;
      const v970 = f(f(ridgeFbm(f(f(-S[41]) * nz), f(S[41] * ny), f(f(-S[41]) * nx), 6, 2, 0.5) + 1) * 0.5);
      const v7 = f(f(simplex3(f(f(-S[42]) * nx), f(S[42] * nz), f(f(-S[42]) * ny)) + 1) * 0.5);
      const m = f(f(f(f(f96c - f968) * v7) + f968) * dl);
      P = sub4(P, mul4(scale4(diff, f(1 / dl)), [m, m, m, m]));
      if (farGate < farLimit && f964 > v970) {
        // Far star: rotate the cell outwards and move toward that point when it stays in the region.
        const k3 = Math.trunc(f(rng.unit() * 3));
        const inv = f(1 - edge);
        const ang = f(f(f(k3) * turn) + f(f(inv * K.PI) * S[92]));
        const cr = f(f(cos(ang) * inv) * f960), sr = f(f(sin(ang) * inv) * f960);
        const vv = [sr, 0, cr, 1];
        const row = (r, A0, A1, A2) => add4(add4(mul4(bcast(r, 1), A1), mul4(bcast(r, 0), A0)), mul4(bcast(r, 2), A2));
        const E0 = XW;
        const Q0 = row(E0, M0, M1, UP2), Q1 = row(R1a, M0, M1, UP2), Q2 = row(R1b, M0, M1, UP2);
        const Q3 = add4(row(ZW, M0, M1, UP2), ZW);
        const a3 = f(inv * f95c), c3 = cos(a3), s3 = sin(a3);
        const N0 = [c3, 0, s3, 1], N2 = [f(-s3), 0, c3, 1];
        const R0 = row(Q0, N0, UP, N2), Rr1 = row(Q1, N0, UP, N2), R2 = row(Q2, N0, UP, N2);
        const R3 = add4(row(Q3, N0, UP, N2), ZW);
        let w = add4(mul4(bcast(vv, 0), R0), ZW);
        w = add4(w, mul4(bcast(vv, 1), Rr1));
        w = add4(w, mul4(bcast(vv, 2), R2));
        w = add4(w, R3);
        if (w[0] > -50 && 50 > w[0] && w[1] > -50 && 50 > w[1] && w[2] > -50 && 50 > w[2]) {
          const [dir, len] = normalise(sub4(P, w));
          const lo = S[44], hi = f(f(S[46] * edge) + S[45]);
          const u = rng.unit();
          const mm = f(f(f(u * f(hi - lo)) + lo) * f(-len));
          P = add4(P, scale4(dir, mm));
        }
      }
      let thr = S[93];
      if (farGate < farLimit) thr = f(thr * K.R12);
      if (slope > thr) {
        rng.step();                                                     // odd/even picks the cloud variant
        addStar(P, true);
      }
    }

    // Gas clusters: they don't add stars, but use random numbers.
    const clusters = Number(rng.step() >> 31n) + 1;
    for (let c = 0; c < clusters; c++) {
      rng.step(); rng.step();
      const n = Number((rng.step() * 21n) >> 32n) + 4;
      for (let q = 0; q < n * 10; q++) rng.step();                   // 10 draws per cloud object
    }

    // Uniformly random stars, numbered from 1000.
    out.beforeRandom = out.stars.length;
    index = 1000;
    for (let n = 0; n < 65; n++) {
      rng.step();                                                       // size
      const uz = rng.unit(), uy = rng.unit(), ux = rng.unit();
      const c = u => f(f(f(f(u * K.STEP) * 19) + 0) + K.GRID0);
      addStar([c(ux), c(uy), c(uz)], true);
    }
    return out;
  }

  // system index (as in the address, from 1) -> star. Indices 1000..1065 are the random stars,
  // which follow straight after the others in the list. Returns { pos, status } (status 0 = ok, 2 = no such system).
  const cache = new Map();
  function regionCached(x, y, z, galaxy) {
    const key = `${galaxy}:${x},${y},${z}`;
    let r = cache.get(key);
    if (!r) {
      r = regionStars(x, y, z, galaxy);
      cache.set(key, r);
      if (cache.size > 64) cache.delete(cache.keys().next().value);
    }
    return r;
  }
  function systemStar(x, y, z, systemIndex, galaxy = 0) {
    const r = regionCached(x, y, z, galaxy);
    if (!systemIndex || !r.stars.length) return { pos: null, status: 2 };
    let i = Math.min(systemIndex, 0xFFF);
    if (r.beforeRandom < i && i >= 1000 && i <= 1065) i += r.beforeRandom - 1000;
    let status = 0;
    if (r.stars.length < i) { i = 1; status = 2; }
    return { pos: r.stars[i - 1].pos, status };
  }
  // Position in light years from the galactic centre: (region * 100 + local) * 4.
  function systemPosition(x, y, z, systemIndex, galaxy = 0) {
    const s = systemStar(x, y, z, systemIndex, galaxy);
    if (!s.pos) return null;
    const [px, py, pz] = s.pos;
    return { ly: [(x * 100 + px) * 4, (y * 100 + py) * 4, (z * 100 + pz) * 4], status: s.status };
  }

  // ---------------------------------------------------------------- sin / cos (the game's own polynomials)
  const C = {
    INV_2PI: f(0.15915493667125702), TWO_PI: f(6.2831854820251465), HALF_PI: f(1.5707963705062866),
    PI: f(3.1415927410125732),
  };
  function wrap(x) {                      // x - round(x / 2pi) * 2pi, rounding away from zero, then fold to ±pi/2
    const k = x < 0 ? f(f(x * C.INV_2PI) - 0.5) : f(f(x * C.INV_2PI) + 0.5);
    return f(x - f(Math.trunc(k) * C.TWO_PI));
  }
  function cos(x) {
    x = wrap(x);
    let sign = 1;
    if (x > C.HALF_PI) { sign = -1; x = f(C.PI - x); }
    else if (x < -C.HALF_PI) { sign = -1; x = f(-C.PI - x); }
    const x2 = f(x * x);
    let p = f(f(2.47604948526714e-05) - f(x2 * f(2.605161455448979e-07)));
    p = f(f(p * x2) - f(0.0013888378161936998));
    p = f(f(p * x2) + f(0.04166663810610771));
    p = f(f(p * x2) - 0.5);
    p = f(f(p * x2) + 1);
    return f(p * sign);
  }
  function sin(x) {
    x = wrap(x);
    if (x > C.HALF_PI) x = f(C.PI - x);
    else if (x < -C.HALF_PI) x = f(-C.PI - x);
    const x2 = f(x * x);
    let p = f(f(2.752155751295504e-06) - f(x2 * f(2.3828544470916313e-08)));
    p = f(f(p * x2) - f(0.00019840782624669373));
    p = f(f(p * x2) + f(0.008333330042660236));
    p = f(f(p * x2) - f(0.1666666716337204));
    p = f(f(p * x2) + 1);
    return f(p * x);
  }

  // ---------------------------------------------------------------- simplex noise (3D)
  // Ken Perlin's permutation, doubled, and the 16 classic gradients.
  const P0 = [151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225, 140, 36, 103, 30, 69, 142, 8, 99,
    37, 240, 21, 10, 23, 190, 6, 148, 247, 120, 234, 75, 0, 26, 197, 62, 94, 252, 219, 203, 117, 35, 11, 32, 57, 177,
    33, 88, 237, 149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175, 74, 165, 71, 134, 139, 48, 27, 166, 77, 146, 158,
    231, 83, 111, 229, 122, 60, 211, 133, 230, 220, 105, 92, 41, 55, 46, 245, 40, 244, 102, 143, 54, 65, 25, 63, 161, 1,
    216, 80, 73, 209, 76, 132, 187, 208, 89, 18, 169, 200, 196, 135, 130, 116, 188, 159, 86, 164, 100, 109, 198, 173,
    186, 3, 64, 52, 217, 226, 250, 124, 123, 5, 202, 38, 147, 118, 126, 255, 82, 85, 212, 207, 206, 59, 227, 47, 16, 58,
    17, 182, 189, 28, 42, 223, 183, 170, 213, 119, 248, 152, 2, 44, 154, 163, 70, 221, 153, 101, 155, 167, 43, 172, 9,
    129, 22, 39, 253, 19, 98, 108, 110, 79, 113, 224, 232, 178, 185, 112, 104, 218, 246, 97, 228, 251, 34, 242, 193,
    238, 210, 144, 12, 191, 179, 162, 241, 81, 51, 145, 235, 249, 14, 239, 107, 49, 192, 214, 31, 181, 199, 106, 157,
    184, 84, 204, 176, 115, 121, 50, 45, 127, 4, 150, 254, 138, 236, 205, 93, 222, 114, 67, 29, 24, 72, 243, 141, 128,
    195, 78, 66, 215, 61, 156, 180];
  const PERM = new Int32Array(520);
  for (let i = 0; i < 512; i++) PERM[i] = P0[i & 255];
  const GRAD = [[1, 0, 1], [0, 1, 1], [-1, 0, 1], [0, -1, 1], [1, 0, -1], [0, 1, -1], [-1, 0, -1], [0, -1, -1],
                [1, -1, 0], [1, 1, 0], [-1, 1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [0, 1, -1], [0, -1, -1]];
  const F3 = f(0.33333334), G3 = f(0.16666667), G3x2 = f(0.33333334), K06 = f(0.6);

  function floorf32(v) {                // (float)(int)v, minus 1 if that rounded up
    const t = f(Math.trunc(v));
    return v < t ? f(t - 1) : t;
  }

  // Shared part: skew, corners and the four contributions. Returns the pieces both variants need.
  function simplexCore(x, y, z) {
    const s = f(x + y);
    const xs = f(f(f(z + s) * F3) + x), ys = f(f(f(s + z) * F3) + y), zs = f(f(f(s + z) * F3) + z);
    const fi = floorf32(xs), fj = floorf32(ys), fk = floorf32(zs);
    const t0 = f(fj + fi);
    const x0 = f(x - f(fi - f(f(fk + t0) * G3)));
    const y0 = f(y - f(fj - f(f(t0 + fk) * G3)));
    const z0 = f(z - f(fk - f(f(t0 + fk) * G3)));
    // Corner order, as the game's branchless code decides it (ties included).
    const a = y0 < z0, b = z0 <= x0, c = x0 < z0, d = z0 <= y0, e = y0 <= x0;
    const i1 = +((b || d) && e), j1 = +(!a && !e), k1 = +(e ? (!b && !d) : a);
    const i2 = +((!c && !a) || e), j2 = +!(!d && e), k2 = +(e ? !d : (c || a));
    const x1 = f(f(x0 - i1) + G3), y1 = f(f(y0 - j1) + G3), z1 = f(f(z0 - k1) + G3);
    const x2 = f(f(x0 - i2) + G3x2), y2 = f(f(y0 - j2) + G3x2), z2 = f(f(z0 - k2) + G3x2);
    const x3 = f(f(x0 - 1) + 0.5), y3 = f(f(y0 - 1) + 0.5), z3 = f(f(z0 - 1) + 0.5);
    const i = fi & 255, j = fj & 255, k = fk & 255;   // (int)floor & 0xff (negative ints wrap the same way)
    const gi0 = PERM[PERM[PERM[k] + j] + i] & 15;
    const gi1 = PERM[i + i1 + PERM[j1 + PERM[k1 + k] + j]] & 15;
    const gi2 = PERM[i + i2 + PERM[j2 + PERM[k2 + k] + j]] & 15;
    const gi3 = PERM[PERM[PERM[k + 1] + j + 1] + i + 1] & 15;
    const tt = (px, py, pz) => { const t = f(f(f(K06 - f(px * px)) - f(py * py)) - f(pz * pz)); return t > 0 ? t : 0; };
    const dot = (g, px, py, pz) => f(f(f(GRAD[g][1] * py) + f(GRAD[g][0] * px)) + f(GRAD[g][2] * pz));
    return {
      p: [[x0, y0, z0], [x1, y1, z1], [x2, y2, z2], [x3, y3, z3]],
      g: [gi0, gi1, gi2, gi3],
      t: [tt(x0, y0, z0), tt(x1, y1, z1), tt(x2, y2, z2), tt(x3, y3, z3)],
      dot,
    };
  }

  // Sum of four lanes the way the SIMD code does it: (0+1) + (2+3).
  const hsum = v => f(f(v[0] + v[1]) + f(v[2] + v[3]));

  // plain 3D simplex, about -1..1. Each corner: dot(g, p) * t^4 (t^4 computed first).
  function simplex3(x, y, z) {
    const c = simplexCore(x, y, z);
    const n = c.t.map((t, q) => { const t2 = f(t * t); return f(c.dot(c.g[q], ...c.p[q]) * f(t2 * t2)); });
    return f(hsum(n) * 28);
  }

  // simplex value and its derivative (dx, dy, dz).
  function simplex3d(x, y, z) {
    const c = simplexCore(x, y, z);
    const t2 = c.t.map(t => f(t * t)), t3 = t2.map((v, q) => f(v * c.t[q])), t4 = t2.map(v => f(v * v));
    const dots = c.g.map((g, q) => c.dot(g, ...c.p[q]));
    const m = dots.map((dd, q) => f(dd * t3[q]));                  // dot * t^3
    const deriv = axis => {
      const s1 = hsum(m.map((v, q) => f(v * c.p[q][axis])));
      const s2 = hsum(c.g.map((g, q) => f(GRAD[g][axis] * t4[q])));
      return f(f(f(s1 * -8) + s2) * 28);
    };
    const value = f(hsum(dots.map((dd, q) => f(dd * t4[q]))) * 28);
    return { value, dx: deriv(0), dy: deriv(1), dz: deriv(2) };
  }

  // octaves of simplex, each pushed through a smootherstep; average weighted by gain.
  function ridgeFbm(x, y, z, octaves, lacunarity, gain) {
    let sum = 0, freq = 1, total = 0, amp = 1;
    lacunarity = f(lacunarity); gain = f(gain);
    for (let o = 0; o < octaves; o++) {
      const n = simplex3(f(freq * x), f(freq * y), f(freq * z));
      total = f(total + amp);
      let w = f(f(freq * f(0.01)) - 0);
      freq = f(freq * lacunarity);
      const a0 = f(f(n - 0) / w), b0 = f(f(-n - 0) / w);
      const a = Math.min(Math.max(a0, 0), 1), bb = Math.min(Math.max(b0, 0), 1);
      const ss = v => f(f(f(f(f(v * 6) - 15) * v) + 10) * f(f(v * v) * v));   // poly * v^3
      const v = f(f(ss(a) - ss(bb)) * amp);
      amp = f(amp * gain);
      sum = f(sum + v);
    }
    return f(sum / total);
  }

  // fbm where each octave is damped by the accumulated slope ("swiss"/derivative fbm), starts at 0.5.
  function slopeFbm(x, y, z, octaves, lacunarity, gain) {
    let out = 0.5, freq = 1, amp = 1, dx = 0, dy = 0, dz = 0;
    lacunarity = f(lacunarity); gain = f(gain);
    for (let o = 0; o < octaves; o++) {
      const r = simplex3d(f(freq * x), f(freq * y), f(freq * z));
      const v = f(r.value * amp);
      dx = f(r.dx + dx); dy = f(r.dy + dy); dz = f(r.dz + dz);
      freq = f(freq * lacunarity);
      amp = f(amp * gain);
      out = f(out + f(v / f(f(f(dz * dz) + f(f(dy * dy) + f(dx * dx))) + 1)));
    }
    return out;
  }

  // cellular noise with gradient, after Brian Sharpe's public GPU noise library
  // (FAST32_hash_3D + Cellular3D_Deriv). Returns [distance, dx, dy, dz], scaled like the game.
  const CELL = {
    INV_DOMAIN: f(0.014492753893136978), DOMAIN: 69, LIMIT: 67.5,
    LARGE: [f(635.2987060546875), f(682.3574829101562), f(668.926513671875)],
    ZINC: [f(48.500389099121094), f(65.29412078857422), f(63.934600830078125)],
    JITTER: f(0.1666666716337204),
  };
  function cellular3d(x, y, z) {
    const P = [x, y, z];
    const Pi = P.map(Math.floor).map(f);
    const Pf = P.map((v, k) => f(v - Pi[k]));
    const grid = Pi.map(v => f(v - f(f(Math.floor(f(v * CELL.INV_DOMAIN))) * CELL.DOMAIN)));
    const inc = grid.map(v => f(f(1 + v) * (v <= CELL.LIMIT ? 1 : 0)));
    const sq = v => f(v * v);
    const ax = sq(f(grid[0] + 50)), ay = sq(f(grid[1] + 161)), bx = sq(f(inc[0] + 50)), by = sq(f(inc[1] + 161));
    const Q = [f(ay * ax), f(ay * bx), f(by * ax), f(by * bx)];                // P.xzxz * P.yyww
    const lowMod = [0, 1, 2].map(k => f(1 / f(f(grid[2] * CELL.ZINC[k]) + CELL.LARGE[k])));
    const highMod = [0, 1, 2].map(k => f(1 / f(f(inc[2] * CELL.ZINC[k]) + CELL.LARGE[k])));
    const samples = m => Q.map(q => { const v = f(q * m); return f(f(f(v - f(Math.floor(v))) * 2) - 1); });
    const sign = v => (v < 0 || Object.is(v, -0)) ? -1 : 1;                   // (bits & 0xbf800000) | 0x3f800000
    const weight = (s, off) => f(f(f(f(f(s * s) * s) - sign(s)) * CELL.JITTER) + off);
    const OX = [0, 1, 0, 1], OY = [0, 0, 1, 1];
    const hx0 = samples(lowMod[0]), hx1 = samples(highMod[0]), hy0 = samples(lowMod[1]);
    const hy1 = samples(highMod[1]), hz0 = samples(lowMod[2]), hz1 = samples(highMod[2]);
    const dx1 = hx0.map((s, q) => f(Pf[0] - weight(s, OX[q])));
    const dy1 = hy0.map((s, q) => f(Pf[1] - weight(s, OY[q])));
    const dz1 = hz0.map(s => f(Pf[2] - f(f(f(f(s * s) * s) - sign(s)) * CELL.JITTER)));
    const dx2 = hx1.map((s, q) => f(Pf[0] - weight(s, OX[q])));
    const dy2 = hy1.map((s, q) => f(Pf[1] - weight(s, OY[q])));
    const dz2 = hz1.map(s => f(Pf[2] - weight(s, 1)));
    const dist = (dx, dy, dz) => dx.map((_, q) => f(f(f(dy[q] * dy[q]) + f(dx[q] * dx[q])) + f(dz[q] * dz[q])));
    const d1 = dist(dx1, dy1, dz1), d2 = dist(dx2, dy2, dz2);
    const pick = (d, dx, dy, dz, a, b) => (d[a] < d[b] ? [d[a], dx[a], dy[a], dz[a]] : [d[b], dx[b], dy[b], dz[b]]);
    const r1 = pick(d1, dx1, dy1, dz1, 0, 1), r2 = pick(d1, dx1, dy1, dz1, 2, 3);
    const r3 = pick(d2, dx2, dy2, dz2, 0, 1), r4 = pick(d2, dx2, dy2, dz2, 2, 3);
    const t1 = r1[0] < r2[0] ? r1 : r2, t2 = r3[0] < r4[0] ? r3 : r4;
    const r = t1[0] < t2[0] ? t1 : t2;
    return [f(f(r[0] * 1) * 0.75), f(f(r[1] * 2) * 0.75), f(f(r[2] * 2) * 0.75), f(f(r[3] * 2) * 0.75)];
  }

  // the game's easing curves by type. The galaxy generator only uses type 16 (and 4): t * t.
  function easeCurve(t, type) {
    if (type === 4 || type === 16) return f(t * t);
    throw new Error(`easeCurve type ${type} isn't ported`);
  }

  // a bounce-like easing curve on [0, 1.375].
  function bounceEase(v) {
    let t = f(v * f(0.72727275));
    t = t >= 0 ? t : 0;
    t = t <= 1 ? t : 1;
    if (t < f(0.36363637)) return f(f(f(f(t * 121) * t) * 0.0625));
    if (t < f(0.72727275)) return f(f(f(f(f(t * f(9.075)) * t) - f(t * f(9.9)))) + f(3.4));
    return 1;
  }

  const StarGen = { f, Mwc, sin, cos, simplex3, simplex3d, ridgeFbm, slopeFbm, bounceEase, floorf32, cellular3d, easeCurve, regionMix, regionKey, regionSegments, regionStars, regionCached, systemStar, systemPosition, simplex2, superFastHash8, fmix64, _simplexCore: simplexCore };
  if (typeof module !== "undefined" && module.exports) module.exports = StarGen;
  else root.StarGen = StarGen;
})(typeof window !== "undefined" ? window : globalThis);
