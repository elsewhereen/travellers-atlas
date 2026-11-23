"use strict";
/*
 * Optimize: a better layout for the technology in one inventory grid, by the game's bonus rules
 * (supercharged slots and adjacency, Sheet.techBonuses). Exposes window.Optimize. Needs lib/sheet.js.
 *
 *   Optimize.families(grid) -> [{ base, label, size, stats: [stat] }]   the tech families present (same BaseStat)
 *   Optimize.run(grid, { stat, multiSupercharged }) -> {
 *     grid,            the proposed grid (same shape; cells carry item, sc, moved)
 *     before, after,   Sheet.techBonuses totals (Map stat -> game value) for the current and the proposed layout
 *     moved,           number of items that change slot
 *     families, own    all families; the ones that contribute to `stat`
 *   }
 *
 * Method. Bonuses only pass between neighbours of the same family, so families are placed one at a time:
 *  1. The families that contribute to `stat` go first, together, on all usable slots. They maximise that
 *     stat; with multiSupercharged false they may use at most one supercharged slot between them.
 *  2. The other families follow, together, on the slots that are left, maximising the sum of their mean gain
 *     per stat (distance from neutral, 0 for added stats and 1 for multiplied ones, over the value without
 *     bonuses), so supercharged slots go where they help most.
 *  3. Everything else (broken tech, tech without a family, goods) goes back to its own slot when free, else to
 *     the nearest free slot.
 * Each phase is placed by hill climbing with restarts (moves and swaps, seeded RNG, so the same input gives the
 * same answer) on a fast evaluation of the same rules; a tiny bonus for staying put keeps moves few. The result is
 * re-checked with Sheet.techBonuses, which matches the game bit for bit.
 */
(function (root) {
  const F = Math.fround;

  function rng(seed) {   // mulberry32
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const key = (x, y) => x + "," + y;
  const neutral = kind => (kind === 1 || kind === 3 ? 1 : 0);

  // Usable cells and the modules in a grid.
  function prepare(grid) {
    const cells = grid.cells.filter(c => c.valid && !c.broken);
    const index = new Map(cells.map((c, i) => [key(c.x, c.y), i]));
    const nb = cells.map(c => [[-1, 0], [1, 0], [0, -1], [0, 1]].map(([dx, dy]) => index.get(key(c.x + dx, c.y + dy))).filter(i => i !== undefined));
    const sc = cells.map(c => c.sc);
    const mods = [], rest = [];
    const over = Sheet.overGroups(grid);   // over the group limit: they do nothing wherever they go
    cells.forEach((c, i) => {
      if (!c.item) return;
      const t = c.item.data && over.has(c.item.data.g) ? null : Sheet.techOf(c.item);
      if (t && t.base) mods.push({ item: c.item, home: i, base: t.base, stats: t.stats.map(s => ({ stat: s.stat, value: s.value, kind: Sheet.rule(s.stat)[1] })), t });
      else rest.push({ item: c.item, home: i });
    });
    // Broken (blocked) cells keep what they hold.
    const fixed = grid.cells.filter(c => c.valid && c.broken && c.item);
    return { cells, index, nb, sc, mods, rest, fixed };
  }

  function families(grid) {
    const { mods } = prepare(grid);
    const by = new Map();
    for (const m of mods) {
      if (!by.has(m.base)) by.set(m.base, []);
      by.get(m.base).push(m);
    }
    return [...by.entries()].map(([base, ms]) => {
      const core = ms.find(m => m.stats.some(s => s.stat === base));
      const stats = [];
      for (const m of ms) for (const s of m.stats) if (!stats.includes(s.stat)) stats.push(s.stat);
      // Name: the core tech, else the family's base (non-upgrade) tech, else the base stat's label.
      const plain = ms.find(m => m.item.data && m.item.data.k === "t" && !m.item.data.up);
      const label = core ? core.item.name : plain ? plain.item.name : ((SheetData.statDisplay[base] || [base.replace(/_/g, " ")])[0]);
      return { base, label, size: ms.length, stats, mods: ms };
    }).sort((a, b) => b.size - a.size);
  }

  // Fast evaluation of one family: totals per stat for positions pos[i] (cell index per module).
  function makeEval(ms, P) {
    const n = ms.length, B = SheetData.bonus, S = F(B.supercharge);
    const share = [], link = [];
    for (let i = 0; i < n; i++) {
      share.push([]); link.push([]);
      for (let j = 0; j < n; j++) {
        share[i].push(i !== j && Sheet.shareGroup(ms[j].t, ms[i].t));
        link[i].push(i !== j && Sheet.linked(ms[i].t, ms[j].t));
      }
    }
    return pos => {
      const at = new Map();
      pos.forEach((c, i) => at.set(c, i));
      const tot = new Map();
      for (let i = 0; i < n; i++) {
        let n0 = 0, n1 = 0;
        for (const c of P.nb[pos[i]]) {
          const j = at.get(c);
          if (j === undefined) continue;
          if (share[i][j] && !link[j][i] && !link[i][j]) n0++;
          if (link[i][j]) n1++;
        }
        const sc = P.sc[pos[i]];
        for (const s of ms[i].stats) {
          let v = s.value;
          const kind = s.kind;
          if (sc) {
            if (kind === 1) v = v < 1 ? F(v * F(1 / S)) : F(v * S);
            else if (kind === 3) v = v < 1 ? F(v * F(1 / S)) : v > 1 ? F(v + F(F(v - 1) * S)) : v;
            else v = F(v * S);
          }
          if (kind === 0 && v > 0) v = F(F(F(F(v * F(B.adjAdd[0])) * n0) + v) + F(F(v * F(B.adjAdd[1])) * n1));
          else if ((kind === 1 || kind === 3) && v > 1) v = F(F(F(F(v * F(B.adjMul[0])) * n0) + v) + F(F(v * F(B.adjMul[1])) * n1));
          const p = tot.get(s.stat);
          tot.set(s.stat, p === undefined ? v : kind === 1 || kind === 3 ? p * v : kind === 2 ? Math.max(p, v) : p + v);
        }
      }
      return tot;
    };
  }

  // Gain of a family's totals over its value without bonuses, signed: a stat that starts below neutral
  // (a cost or a time, e.g. 0.72) gains by going further down, and loses if a bonus pushes it past neutral.
  function gain(tot, base, only) {
    let g = 0;
    for (const [stat, v] of tot) {
      if (only && stat !== only) continue;
      const k = Sheet.rule(stat)[1], z = neutral(k), b0 = base.get(stat);
      const d0 = b0 - z;                      // the side of neutral the stat starts on is its good direction
      if (Math.abs(d0) > 1e-9) g += (v - z) / d0;
    }
    return g;
  }

  function baseTotals(ms) {
    const t = new Map();
    for (const m of ms) for (const s of m.stats) {
      const p = t.get(s.stat), k = s.kind;
      t.set(s.stat, p === undefined ? s.value : k === 1 || k === 3 ? p * s.value : k === 2 ? Math.max(p, s.value) : p + s.value);
    }
    return t;
  }

  // Place several families together on the free cells (Set of cell indices). Families only interact through
  // the cells they take, so the score is a sum over families, and only the families a move touches are
  // re-evaluated. opt.stat: maximise that stat first (weight 1000), the families' own gains break ties;
  // without it every family counts its mean gain per stat. opt.scLimit: most supercharged cells used in total.
  // Returns Map(module -> cell index), or null when they don't fit.
  function placeAll(fams, P, free, opt) {
    const ms = fams.flatMap(f => f.mods), n = ms.length, cellsArr = [...free];
    if (!n) return new Map();
    if (cellsArr.length < n) return null;
    const G = fams.map(f => ({ f, ev: makeEval(f.mods, P), base: baseTotals(f.mods), nstat: f.stats.length || 1 }));
    const gi = [], li = [];                       // module -> group index, index inside its group
    G.forEach((g, k) => g.f.mods.forEach((m, j) => { gi.push(k); li.push(j); }));
    const groupScore = (k, pos) => {
      const g = G[k], p = g.f.mods.map((m, j) => pos[ms.indexOf(m)]);
      const tot = g.ev(p);
      let s = opt.stat ? gain(tot, g.base, opt.stat) * 1000 + gain(tot, g.base) / g.nstat : gain(tot, g.base) / g.nstat;
      g.f.mods.forEach((m, j) => { if (p[j] === m.home) s += 1e-6; });   // fewer moves on ties
      return s;
    };
    // ms.indexOf is slow in the hot loop: give every module its index once.
    ms.forEach((m, i) => { m._i = i; });
    const groupScoreFast = (k, pos) => {
      const g = G[k], p = g.f.mods.map(m => pos[m._i]);
      const tot = g.ev(p);
      let s = opt.stat ? gain(tot, g.base, opt.stat) * 1000 + gain(tot, g.base) / g.nstat : gain(tot, g.base) / g.nstat;
      g.f.mods.forEach((m, j) => { if (p[j] === m.home) s += 1e-6; });
      return s;
    };
    const scCount = pos => pos.reduce((a, c) => a + (P.sc[c] ? 1 : 0), 0);
    const R = rng(0x5EED + n * 7919 + cellsArr.length);
    let best = null, bestS = -Infinity;
    const restarts = Math.min(30, 6 + n * 2), iters = 400 + n * 300;
    for (let r = 0; r < restarts; r++) {
      let pos;
      if (r === 0) {                                  // start from the current layout
        const used = new Set();
        pos = ms.map(m => (free.has(m.home) && !used.has(m.home) ? (used.add(m.home), m.home) : -1));
        for (let i = 0; i < n; i++) if (pos[i] < 0) { const c = cellsArr.find(c => !used.has(c)); used.add(c); pos[i] = c; }
      } else {
        const pick = cellsArr.slice();
        for (let i = pick.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [pick[i], pick[j]] = [pick[j], pick[i]]; }
        pos = pick.slice(0, n);
      }
      if (scCount(pos) > opt.scLimit) {               // keep the supercharge limit from the start
        const used = new Set(pos);
        for (let i = 0; i < n && scCount(pos) > opt.scLimit; i++) if (P.sc[pos[i]]) {
          const c = cellsArr.find(c => !used.has(c) && !P.sc[c]);
          if (c !== undefined) { used.delete(pos[i]); used.add(c); pos[i] = c; }
        }
        if (scCount(pos) > opt.scLimit) continue;
      }
      const gs = G.map((_, k) => groupScoreFast(k, pos));
      let cur = gs.reduce((a, b) => a + b, 0);
      for (let it = 0; it < iters; it++) {
        const next = pos.slice();
        const i = Math.floor(R() * n);
        let j = -1;
        if (R() < 0.35 && n > 1) {
          j = Math.floor(R() * n); if (i === j) continue;
          [next[i], next[j]] = [next[j], next[i]];
        } else {
          const occ = new Set(next);
          let cand;
          if (R() < 0.7) {                            // next to a module of the same family, usually
            const sib = G[gi[i]].f.mods, o = sib[Math.floor(R() * sib.length)];
            cand = P.nb[next[o._i]].filter(c => free.has(c) && !occ.has(c));
          }
          if (!cand || !cand.length) cand = cellsArr.filter(c => !occ.has(c));
          if (!cand.length) continue;
          next[i] = cand[Math.floor(R() * cand.length)];
        }
        if (scCount(next) > opt.scLimit) continue;
        const touched = j < 0 || gi[i] === gi[j] ? [gi[i]] : [gi[i], gi[j]];
        let s = cur;
        const ns = touched.map(k => groupScoreFast(k, next));
        touched.forEach((k, t) => { s += ns[t] - gs[k]; });
        if (s >= cur) { pos = next; cur = s; touched.forEach((k, t) => { gs[k] = ns[t]; }); }
      }
      if (cur > bestS) { bestS = cur; best = pos; }
    }
    if (!best) return null;
    return new Map(ms.map((m, i) => [m, best[i]]));
  }

  function run(grid, opt) {
    const P = prepare(grid);
    const fams = families(grid);
    const own = fams.filter(f => f.stats.includes(opt.stat));
    const rest = fams.filter(f => !own.includes(f));
    const free = new Set(P.cells.map((_, i) => i));
    const placed = new Map();   // cell index -> item
    const scTotal = P.sc.filter(Boolean).length;
    const phase = (group, o) => {
      const at = placeAll(group, P, free, o);
      if (!at) return;
      for (const [m, c] of at) { placed.set(c, m.item); free.delete(c); }
    };
    phase(own, { stat: opt.stat, scLimit: opt.multiSupercharged ? scTotal : Math.min(1, scTotal) });
    phase(rest, { stat: null, scLimit: scTotal });
    // Everything else: own slot when free, else the nearest free cell (Manhattan distance).
    const placedItems = new Set(placed.values());
    const others = [...P.rest, ...fams.flatMap(f => f.mods).filter(m => !placedItems.has(m.item))];
    for (const o of others) {
      let c = free.has(o.home) ? o.home : null;
      if (c === null) {
        const h = P.cells[o.home];
        let bd = Infinity;
        for (const f of free) { const q = P.cells[f], d = Math.abs(q.x - h.x) + Math.abs(q.y - h.y); if (d < bd) { bd = d; c = f; } }
      }
      if (c === null) continue;
      placed.set(c, o.item); free.delete(c);
    }
    const homeOf = new Map(P.cells.map((c, i) => [c.item, key(c.x, c.y)]).filter(([it]) => it));
    let moved = 0;
    const cells = grid.cells.map(c => {
      if (!c.valid || c.broken) return Object.assign({}, c, { moved: false });
      const i = P.index.get(key(c.x, c.y));
      const item = placed.get(i) || null;
      const m = !!item && homeOf.get(item) !== key(c.x, c.y);
      if (m) moved++;
      return Object.assign({}, c, { item, moved: m });
    });
    const out = Object.assign({}, grid, { cells });
    return { grid: out, before: Sheet.techBonuses(grid).totals, after: Sheet.techBonuses(out).totals,
             moved, families: fams, own };
  }

  root.Optimize = { run, families };
})(typeof window !== "undefined" ? window : globalThis);
