"use strict";
/*
 * SheetView: the character sheet, a scrolling page over the still sky. Exposes window.SheetView.
 * Needs lib/sheet.js (the numbers).
 *
 *   SheetView.show(atlasData)   build the sheet from the open save and switch to it
 *
 * Written like a tabletop sheet: mostly text and tables, in clearly framed sections in a fixed order
 * (character, abilities, standing, titles, notes, starships, multi-tools, exosuit, freighter and fleet,
 * settlement, chronicle). Graphics: one thin bar per ship or tool stat (where the value sits inside the range
 * its class can roll, from the game's inventorytable), and each inventory drawn as its slot grid with the game's
 * icons (the player's own, lib/gameicons.js; labels without them); a slot's name, amount and stats show on hover or focus.
 */
(function () {
  const nf = new Intl.NumberFormat("en-GB");
  const nf1 = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fmt = (v, d = 0) => (d ? nf1 : nf).format(d ? v : Math.round(v));
  // Huge internal values (e.g. weapon range ~1.8e10) as 18.5B instead of exponent notation.
  const compact = new Intl.NumberFormat("en-GB", { notation: "compact", maximumSignificantDigits: 3 });
  const big = v => (v >= 1e6 ? nf1.format(v / 1e6) + "m" : v >= 1e4 ? nf1.format(v / 1e3) + "k" : nf.format(Math.round(v)));
  const CLASSES = ["C", "B", "A", "S"];

  let root = null;
  let tips = [];   // slot contents for the tooltip, by data-tip index (rebuilt on every render)
  let optGrids = [];   // grids with an Optimize button, by data-opt index

  // ---- Inventory grids ----------------------------------------------------------------------------------------

  // Without the player's game icons (lib/gameicons.js) a slot shows a short label instead: the chemical symbol
  // for substances, otherwise the name's initials.
  function iconLabel(it) {
    const d = it.data || {};
    if (d.y) return d.y;
    const w = String(it.name || "").replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter(Boolean);
    return (w.length > 1 ? w.slice(0, 3).map(x => x[0]).join("") : (w[0] || "?").slice(0, 2)).toUpperCase();
  }

  // Totals for one tech grid with the game's bonus rules (Sheet.techBonuses), folded away by default.
  function totalsTable(tb, tb0) {
    const rows = [...tb.totals.entries()]
      .filter(([stat, v]) => !(v === 0 || (v === 1 && tb0.totals.get(stat) === 1)))
      .map(([stat, v]) => {
        const v0 = tb0.totals.get(stat), gain = v0 ? (v / v0 - 1) * 100 : 0;
        const label = (SheetData.statDisplay[stat] || [stat.replace(/_/g, " ")])[0];
        const num = gameNum(v);
        return [label, `<tr><td>${esc(label)}</td><td class="num">${num}</td><td class="num dim">${gain > 0.05 ? "+" + gain.toFixed(1) + "%" : ""}</td></tr>`];
      }).sort((a, b) => a[0].localeCompare(b[0])).map(r => r[1]).join("");
    return rows ? `<details class="tech"><summary>Tech totals</summary>
      <table class="t t--tot"><thead><tr><th>Stat</th><th class="num">Game value</th><th class="num">From adjacency</th></tr></thead>
      <tbody>${rows}</tbody></table>
      <p class="fine">Base stats, supercharged slots and adjacency, as the game sums them. Values are the game's internal numbers.</p></details>` : "";
  }

  function invGrid(gr, title, view = {}) {
    const tb = gr.label === "Technology" || gr.label === "Slots" ? Sheet.techBonuses(gr) : null;
    const cells = gr.cells.map(c => {
      if (!c.valid) return `<span class="slot slot--void" aria-hidden="true"></span>`;
      const it = c.item, cl = ["slot"];
      if (c.sc) cl.push("slot--sc");
      if (c.broken) cl.push("slot--broken");
      if (!it) {
        tips.push({ empty: true, sc: c.sc, broken: c.broken });
        return `<span class="${cl.join(" ")} slot--empty" tabindex="0" data-tip="${tips.length - 1}" aria-label="Empty slot${c.sc ? ", supercharged" : ""}"></span>`;
      }
      if (it.damaged) cl.push("slot--damaged");
      if (c.moved) cl.push("slot--moved");
      if (tb && (tb.cells.get(c.x + "," + c.y) || {}).overLimit) cl.push("slot--over");
      tips.push(Object.assign({ sc: c.sc, bonus: tb && tb.cells.get(c.x + "," + c.y) }, it));
      const amt = it.type !== "Technology" && it.amount > 1 ? `<b>${big(it.amount)}</b>` : "";
      return `<span class="${cl.join(" ")}" tabindex="0" data-tip="${tips.length - 1}" aria-label="${esc(it.name)}">` +
             `<i class="ico ico--${(it.data && it.data.k) || "x"}" data-ab="${esc(iconLabel(it))}">` +
             (it.data && it.data.i != null ? `<canvas width="${SheetData.icons.cell}" height="${SheetData.icons.cell}" data-icon="${it.data.i}"></canvas>` : "") +
             `</i>${amt}</span>`;
    }).join("");
    let btn = "";
    if (tb && !view.preview && window.Optimize && Optimize.families(gr).length) {
      optGrids.push({ grid: gr, title: title || "" });
      btn = `<button type="button" class="opt-btn" data-opt="${optGrids.length - 1}">Optimize</button>`;
    }
    return `<div class="inv"><div class="inv__label">${esc(view.preview ? "Proposed layout" : gr.label)} <span>${gr.used}/${gr.total}</span>${btn}</div>
      <div class="inv__grid" style="--w:${gr.w}">${cells}</div>${tb && !view.preview ? totalsTable(tb, Sheet.techBonuses(gr, { noAdjacency: true })) : ""}</div>`;
  }

  function tipHtml(t) {
    if (t.empty) return `<p class="tip__name">Empty slot</p>${t.sc ? `<p class="tip__sc">Supercharged: tech placed here gets a bonus.</p>` : ""}${t.broken ? `<p class="tip__warn">Blocked by broken tech. Repair to use it.</p>` : ""}`;
    const d = t.data, kind = { s: "Substance", p: "Product", t: "Technology", u: "Upgrade module" }[d && d.k] || (t.type === "Technology" ? "Technology" : t.type || "");
    const out = [`<p class="tip__name">${esc(t.name)}</p>`,
      `<p class="tip__kind">${esc(d && d.t ? d.t : kind)}${t.seed ? ` · seed ${esc(t.seed)}` : ""}</p>`];
    if (t.type !== "Technology" && t.amount != null) out.push(`<p class="tip__amt">${fmt(t.amount)}${t.max ? ` / ${fmt(t.max)}` : ""}</p>`);
    if (d && d.up && d.s && d.s.length) {   // base tech values are internal; the game shows none
      out.push(`<table class="tip__stats">${d.s.map(([st, v]) => { const f = Sheet.formatStat(st, v, !!d.up);
        return `<tr><td>${esc(f.label)}</td><td>${esc(f.text)}</td></tr>`; }).join("")}</table>`);
    }
    const rolled = d && d.r && d.r.length && t.seed != null && t.id && !t.id.startsWith("CV_") && window.ProcTech
      ? ProcTech.roll(d, Number(t.seed)) : null;
    if (rolled) {
      const range = Object.fromEntries(d.r.map(r => [r[0], r]));
      out.push(`<table class="tip__stats">${rolled.stats.map(s => {
        const f = Sheet.formatStat(s.stat, s.value), r = range[s.stat];
        let lo = Sheet.formatStat(s.stat, r[1]), hi = Sheet.formatStat(s.stat, r[2]);
        if (Math.abs(lo.value) > Math.abs(hi.value)) [lo, hi] = [hi, lo];
        return `<tr><td>${esc(f.label)}</td><td>${esc(f.text)}</td><td class="dim">${r[1] === r[2] ? "" : `${esc(lo.text)} to ${esc(hi.text)}`}</td></tr>`;
      }).join("")}</table>`);
      if (rolled.perfect) out.push(`<p class="tip__sc">Perfect roll: every stat in the top of its range.</p>`);
    } else if (d && d.r && d.r.length) {
      const m = d.m ? (d.m[0] === d.m[1] ? `${d.m[0]}` : `${d.m[0]}–${d.m[1]}`) : "";
      out.push(`<p class="tip__note">Rolls ${m ? m + " of" : ""} these stats:</p>`);
      out.push(`<table class="tip__stats">${d.r.map(([st, a, b]) => {
        let fa = Sheet.formatStat(st, a), fb = Sheet.formatStat(st, b);
        if (Math.abs(fa.value) > Math.abs(fb.value)) [fa, fb] = [fb, fa];   // low to high as shown in the game
        return `<tr><td>${esc(fa.label)}</td><td>${a === b ? esc(fa.text) : `${esc(fa.text)} to ${esc(fb.text)}`}</td></tr>`; }).join("")}</table>`);
      out.push(`<p class="tip__note dim">The exact roll for this seed isn't computed yet; these are the possible ranges.</p>`);
    }
    const b = t.bonus, upg = d && (d.k === "u" || d.up);
    if (b && upg && b.stats.some(s => s.value !== s.base)) {
      out.push(`<p class="tip__note">In this slot:</p><table class="tip__stats">${b.stats.filter(s => s.value !== s.base).map(s => {
        const f = Sheet.formatStat(s.stat, s.value);
        return `<tr><td>${esc(f.label)}</td><td>${esc(f.text)}</td></tr>`; }).join("")}</table>`);
    }
    if (b && b.overLimit) out.push(`<p class="tip__warn">More than 3 upgrades of this kind in this inventory: none of them work (the game shows "!"). Remove one.</p>`);
    else if (b) {
      const why = [];
      if (t.sc) why.push("supercharged ×1.25");
      if (b.n0) why.push(`${b.n0} neighbour${b.n0 > 1 ? "s" : ""} of the same family`);
      if (b.n1) why.push("next to its core tech");
      if (why.length) out.push(`<p class="tip__sc">${esc(why.join(" · "))}.</p>`);
      else if (t.type === "Technology") out.push(`<p class="tip__note dim">No supercharge or adjacency bonus here.</p>`);
    } else if (t.sc) out.push(`<p class="tip__sc">In a supercharged slot.</p>`);
    if (t.damaged) out.push(`<p class="tip__warn">Damaged.</p>`);
    if (t.installing) out.push(`<p class="tip__warn">Not fully installed.</p>`);
    return out.join("");
  }

  // ---- Optimize card --------------------------------------------------------------------------------------------

  const statLabel = st => (SheetData.statDisplay[st] || [st.replace(/_/g, " ")])[0];
  // Internal counters (the game shows no name for them, e.g. Ship_PulseDrive = "has a pulse engine").
  const isNamed = st => statLabel(st) !== st.replace(/_/g, " ");
  const gameNum = v => Math.abs(v) >= 1e6 ? compact.format(v) : Math.abs(v) >= 100 ? fmt(v) : Math.abs(v) >= 10 ? fmt(v, 1)
    : v.toLocaleString("en-GB", { maximumFractionDigits: 3 });

  function openOptimizer(entry) {
    const fams = Optimize.families(entry.grid);
    const neutral = st => { const k = Sheet.rule(st)[1]; return k === 1 || k === 3 ? 1 : 0; };
    const before = Sheet.techBonuses(entry.grid).totals;
    // Stats worth optimising: present and away from neutral.
    const groups = fams.map(f => ({ f, stats: f.stats.filter(st => isNamed(st) && before.has(st) && Math.abs(before.get(st) - neutral(st)) > 1e-6) }))
      .filter(g => g.stats.length);
    const first = groups.find(g => g.stats.some(st => /Damage$/.test(st))) || groups[0];
    let stat = first ? (first.stats.find(st => /Damage$/.test(st)) || first.stats[0]) : null;
    let multi = false;

    const box = document.createElement("div");
    box.className = "opt";
    box.innerHTML = `<div class="opt__controls">
        <label for="opt-stat">Optimize for</label>
        <select id="opt-stat">${groups.map(g => `<optgroup label="${esc(g.f.label)}">${g.stats.map(st =>
          `<option value="${esc(st)}"${st === stat ? " selected" : ""}>${esc(statLabel(st))}</option>`).join("")}</optgroup>`).join("")}</select>
        <label class="opt__check"><input type="checkbox" id="opt-multi"> May use more than one supercharged slot</label>
      </div><div class="opt__result"></div>`;
    const out = box.querySelector(".opt__result");

    function update() {
      tips = tips.slice(0, entry.tipBase ?? (entry.tipBase = tips.length));
      const r = Optimize.run(entry.grid, { stat, multiSupercharged: multi });
      const b = r.before.get(stat), a = r.after.get(stat), z = neutral(stat);
      const pct = (x, y) => (Math.abs(y) > 1e-9 ? (x / y - 1) * 100 : 0);
      const better = (x, y, st) => (x - y) * Math.sign(y - neutral(st)) > 1e-9;
      const rows = [], seen = new Set([stat]);
      for (const f of r.families) for (const st of f.stats) {
        if (seen.has(st) || !isNamed(st)) continue; seen.add(st);
        const x = r.after.get(st), y = r.before.get(st);
        if (x === undefined || y === undefined || Math.fround(x) === Math.fround(y)) continue;
        const p = pct(x, y, st);
        if (Math.abs(p) < 0.05) continue;
        rows.push(`<tr><td>${esc(f.label)}</td><td>${esc(statLabel(st))}</td><td class="num">${gameNum(y)}</td><td class="num">${gameNum(x)}</td>
          <td class="num ${better(x, y, st) ? "up" : "down"}">${p > 0 ? "+" : ""}${p.toFixed(1)}%</td></tr>`);
      }
      const gainMain = pct(a, b, stat);
      out.innerHTML = `<p class="opt__main"><b>${esc(statLabel(stat))}</b> ${gameNum(b)} → <b>${gameNum(a)}</b>
          <span class="${gainMain > 0.05 ? "up" : "dim"}">${gainMain > 0.05 ? "+" + gainMain.toFixed(1) + "%" : "already optimal"}</span></p>
        <p class="fine">${r.moved} item${r.moved === 1 ? "" : "s"} change slot (outlined). Hover a slot for its value in the new place.
          Game values with supercharge and adjacency; the families that give ${esc(statLabel(stat))} are placed first, the rest after.</p>
        ${invGrid(r.grid, entry.title, { preview: true })}
        ${rows.length ? `<table class="t t--opt"><thead><tr><th>Family</th><th>Stat</th><th class="num">Now</th><th class="num">Proposed</th><th class="num">Change</th></tr></thead>
          <tbody>${rows.join("")}</tbody></table>` : ""}`;
    }
    update();
    box.querySelector("#opt-stat").addEventListener("change", e => { stat = e.target.value; update(); });
    box.querySelector("#opt-multi").addEventListener("change", e => { multi = e.target.checked; update(); });
    box.addEventListener("pointerover", e => { const c = e.target.closest("[data-tip]"); if (c) showTip(c); });
    box.addEventListener("pointerout", e => { if (e.target.closest("[data-tip]")) hideTip(); });
    box.addEventListener("focusin", e => { const c = e.target.closest("[data-tip]"); if (c) showTip(c); });
    box.addEventListener("focusout", hideTip);
    box.addEventListener("scroll", hideTip, { passive: true });
    Card.popup({ title: "Optimize modules", subtitle: `${entry.title} · ${entry.grid.label.toLowerCase()}`, content: box,
                 width: "46em", onClose: hideTip });
  }

  let tipEl = null;
  function showTip(cell) {
    const t = tips[+cell.dataset.tip];
    if (!t) return;
    if (!tipEl) { tipEl = document.createElement("div"); tipEl.className = "tip"; tipEl.setAttribute("role", "tooltip"); document.body.append(tipEl); }
    tipEl.innerHTML = tipHtml(t);
    tipEl.hidden = false;
    const r = cell.getBoundingClientRect(), tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
    let x = r.right + 8, y = r.top;
    if (x + tw > innerWidth - 8) x = r.left - tw - 8;
    if (x < 8) x = Math.max(8, Math.min(innerWidth - tw - 8, r.left));
    if (y + th > innerHeight - 8) y = Math.max(8, innerHeight - th - 8);
    tipEl.style.left = x + "px"; tipEl.style.top = y + "px";
  }
  function hideTip() { if (tipEl) tipEl.hidden = true; }

  const cls = c => `<span class="cls cls--${esc(c)}">${esc(c)}</span>`;
  const section = (id, title, body, aside = "") =>
    `<section class="sec" aria-labelledby="sh-${id}"><header class="sec__head"><h3 id="sh-${id}">${title}</h3>${aside ? `<span>${aside}</span>` : ""}</header>
      <div class="sec__body">${body}</div></section>`;

  // How good a roll is inside its own class range: 0..1 and a word for it.
  function grade(v, r) {
    if (!r || r[1] <= r[0]) return null;
    const t = Math.max(0, Math.min(1, (v - r[0]) / (r[1] - r[0])));
    return { t, word: t >= 0.9 ? "exceptional" : t >= 0.66 ? "strong" : t >= 0.33 ? "average" : "weak" };
  }

  // ---- Abilities ------------------------------------------------------------------------------------------------

  function abilities(m) {
    const boxes = m.abilities.map(a => `<div class="abox"><span class="abox__k">${esc(a.short)}</span>
      <span class="abox__v">${a.score}</span><span class="abox__m">${a.mod >= 0 ? "+" : "−"}${Math.abs(a.mod)}</span>
      <span class="abox__n">${esc(a.name)}</span></div>`).join("");
    const rows = m.abilities.map(a => `<tr><th scope="row">${esc(a.name)}</th><td class="rank">${esc(a.title)}</td>
      <td class="num">${Math.max(a.rank, 0)}/${a.ranks}</td><td>${fmt(a.value)} ${esc(a.what.toLowerCase())}</td>
      <td class="dim">${a.next ? `${fmt(a.nextMin - a.value)} to ${esc(a.next)}` : "top rank"}</td></tr>`).join("");
    return `<div class="aboxes">${boxes}</div>
      <table class="t"><thead><tr><th>Ability</th><th>Rank</th><th class="num">Level</th><th>Based on</th><th>Next</th></tr></thead>
      <tbody>${rows}</tbody></table>
      <p class="fine">Each ability is one of the game's ranked stats. Score = 3 + 1.7 × level, modifier as in D&amp;D.</p>`;
  }

  // ---- Standing and titles ---------------------------------------------------------------------------------------

  function standing(m) {
    const row = f => {
      const extra = [f.words != null ? `${fmt(f.words)} words` : "", f.seen ? `${fmt(f.seen)} systems` : "",
                     f.missions ? `${fmt(f.missions)} missions` : ""].filter(Boolean).join(", ");
      return `<tr${f.rank < 0 ? ' class="hostile"' : ""}><th scope="row">${esc(f.name)}</th><td class="rank">${esc(f.title)}</td>
        <td class="num">${f.rank}/${f.ranks}</td><td class="num">${fmt(f.value)}</td>
        <td class="dim">${f.next ? `${fmt(f.nextMin - f.value)} to ${esc(f.next)}` : "top rank"}</td><td class="dim">${esc(extra)}</td></tr>`;
    };
    const group = g => `<tbody><tr class="sub"><th colspan="6">${g}</th></tr>${m.factions.filter(f => f.group === g).map(row).join("")}</tbody>`;
    return `<table class="t"><thead><tr><th>Faction</th><th>Rank</th><th class="num">Level</th><th class="num">Standing</th><th>Next</th><th>Contact</th></tr></thead>
      ${group("Races")}${group("Guilds")}</table>`;
  }

  function titles(m) {
    const rows = m.titles.map(t => `<tr><th scope="row">${esc(t.label)}</th><td class="rank">${esc(t.title)}</td>
      <td class="num">${t.rank}/${t.ranks}</td><td class="num">${big(t.value)}</td>
      <td class="dim">${t.next ? `${big(t.nextMin - t.value)} to ${esc(t.next)}` : "top rank"}</td></tr>`).join("");
    return `<table class="t"><thead><tr><th>Category</th><th>Title</th><th class="num">Level</th><th class="num">Count</th><th>Next</th></tr></thead>
      <tbody>${rows}</tbody></table>`;
  }

  // ---- Gear: one block per ship, tool or freighter -------------------------------------------------------------

  function statTable(o) {
    if (!o.stats.length) return "";
    const rows = o.stats.map(s => {
      const r = s.range, gr = grade(s.value, r);
      const others = CLASSES.filter(c => s.all[c] && s.all[c][1] > 0).map(c => `${c} ${s.all[c][0]}–${s.all[c][1]}`).join(" · ");
      return `<tr title="${esc(others ? "Ranges: " + others : "")}"><th scope="row">${esc(s.label)}</th>
        <td class="num">${fmt(s.value, 1)}</td>
        <td class="num dim">${r ? `${r[0]}–${r[1]}` : "–"}</td>
        <td class="barcell">${gr ? `<span class="bar"><i style="width:${(gr.t * 100).toFixed(0)}%"></i></span>` : ""}</td>
        <td class="g g--${gr ? gr.word : "none"}">${gr ? `${Math.round(gr.t * 100)}% · ${gr.word}` : r ? "fixed" : "no roll"}</td></tr>`;
    }).join("");
    return `<table class="t t--stats"><thead><tr><th>Base stat</th><th class="num">Value</th><th class="num">${esc(o.class)}-class roll</th><th colspan="2">Place in range</th></tr></thead>
      <tbody>${rows}</tbody></table>`;
  }

  function slotText(o, kind) {
    const sr = o.slotRange, mu = o.maxUp || {}, parts = [];
    const one = (label, n, lo, hi, max) => `<b>${n}</b>${max ? `/${max}` : ""} ${label}` +
      (lo != null ? ` <span class="dim">(spawns ${lo}–${hi})</span>` : "");
    if (kind === "tool") parts.push(one("slots", o.slots, sr && sr.min, sr && sr.max));
    else {
      parts.push(one("general", o.slots, sr && sr.min, sr && sr.max, mu.general && mu.general[o.class]));
      if (o.techSlots != null) parts.push(one("tech", o.techSlots, sr && sr.tmin, sr && sr.tmax, mu.tech && mu.tech[o.class]));
    }
    if (o.supercharged) parts.push(`<b>${o.supercharged}</b> supercharged`);
    if (o.broken) parts.push(`<b>${o.broken}</b> broken`);
    return parts.join(" · ");
  }

  function gearBlock(o, kind, typeLabel) {
    const name = o.name || `Unnamed ${o.type.toLowerCase()}`;
    const tags = [o.active ? "equipped" : "", o.location ? `at ${esc(o.location)}` : ""].filter(Boolean).join(" · ");
    return `<article class="gear">
      <h4>${cls(o.class)} ${esc(name)} <small>${esc(o.class)}-class ${esc(typeLabel || o.type)}${tags ? ` · ${tags}` : ""}</small></h4>
      <p class="gear__slots">${slotText(o, kind)}</p>
      ${statTable(o)}
      ${o.grids && o.grids.length ? `<div class="invs">${o.grids.map(g => invGrid(g, name)).join("")}</div>` : ""}
    </article>`;
  }

  // ---- Notes the sheet makes itself --------------------------------------------------------------------------------

  function notes(m) {
    const out = [];
    const ship = m.ships.find(s => s.active);
    if (ship) {
      const best = ship.stats.map(s => [s, grade(s.value, s.range)]).filter(([, g]) => g).sort((a, b) => b[1].t - a[1].t)[0];
      if (best) out.push(`${esc(ship.name || ship.type)}'s ${best[0].label.toLowerCase()} is ${Math.round(best[1].t * 100)} % up its ${ship.class}-class range (${fmt(best[0].value, 1)} of ${best[0].range[1]}).`);
      const g = ship.maxUp && ship.maxUp.general && ship.maxUp.general[ship.class];
      if (g && ship.slots < g) out.push(`The ship can still grow by ${g - ship.slots} general slots before the class ${ship.class} cap of ${g}.`);
    }
    const tool = m.tools.find(t => t.active);
    if (tool) {
      const d = tool.stats.find(s => s.id === "WEAPON_DAMAGE"), gd = d && grade(d.value, d.range);
      if (gd && gd.t < 0.33) out.push(`The equipped multi-tool is ${tool.class}-class, but its damage roll is weak (${fmt(d.value, 1)} in ${d.range[0]}–${d.range[1]}).`);
    }
    const near = m.factions.filter(f => f.next && f.value > 0 && f.nextMin - f.value <= 3).map(f => `${f.name} (${f.nextMin - f.value} to ${f.next})`);
    if (near.length) out.push(`Close to a new rank: ${esc(near.join(", "))}.`);
    if (m.exosuit.cargo === 0) out.push("The exosuit has no cargo slots yet. Cargo slots hold larger stacks.");
    if (m.freighter) {
      const fl = m.freighter.stats.find(s => s.id === "FREI_FLEET"), gf = fl && grade(fl.value, fl.range);
      if (gf) out.push(`Freighter fleet coordination is ${gf.word} for class ${m.freighter.class} (${fmt(fl.value, 1)} in ${fl.range[0]}–${fl.range[1]}).`);
    }
    if (m.journey.next == null) out.push(`Journey milestones are complete. ${esc(m.journey.title)} is the last one.`);
    return out;
  }

  // ---- The page --------------------------------------------------------------------------------------------------

  function render(m, data) {
    const w = m.who;
    const place = [w.system, w.region].filter(Boolean).join(", ");
    const races = Object.entries(w.races).sort((a, b) => b[1] - a[1]).map(([r, n]) => `${esc(r)} ${n}`).join(", ");
    const kv = rows => `<dl class="kv">${rows.filter(Boolean).map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>`;
    const n = notes(m);
    const ex = m.exosuit;

    const character = kv([
      ["Milestone", `<span class="rank">${esc(m.journey.title)}</span> <span class="dim">(${m.journey.index + 1} of ${m.journey.of + 1}, ${m.journey.points} journey points${m.journey.next ? `, ${m.journey.next.points - m.journey.points} to ${esc(m.journey.next.title)}` : ""})</span>`],
      ["Location", `${esc(w.where)}${place ? `<br><span class="dim">${esc(place)}${w.coreLy ? `, ${fmt(w.coreLy)} ly to the core` : ""}</span>` : ""}`],
      ["Units", fmt(w.units)], ["Nanites", fmt(w.nanites)], ["Quicksilver", fmt(w.quicksilver)],
      ["Played", `${fmt(w.playHours, 1)} hours`],
      ["Mode", `${esc(w.mode)}${w.tutorial ? "" : ", no tutorial"}, ${esc(w.death === "ItemGrave" ? "items dropped on death" : w.death)}`],
      ["Known", `${w.knownTech} tech, ${w.knownProducts} products, ${w.refiner} refiner recipes`],
      ["Portal glyphs", `${w.glyphs} of 16`],
      races ? ["Systems by race", races] : null,
    ]);

    const fleet = m.frigates.length ? `<h4 class="h4">Fleet <small>${m.frigates.length} frigates</small></h4>
      <table class="t"><thead><tr><th>Frigate</th><th class="num">Combat</th><th class="num">Expl.</th><th class="num">Mining</th><th class="num">Dipl.</th>
        <th class="num">Runs</th><th class="num">Success</th><th>Traits</th></tr></thead><tbody>
      ${m.frigates.map(f => `<tr><th scope="row">${cls(f.class)} ${esc(f.name || `${f.race} ${f.role.toLowerCase()}`)}</th>
        <td class="num">${f.stats.Combat}</td><td class="num">${f.stats.Exploration}</td><td class="num">${f.stats.Mining}</td><td class="num">${f.stats.Diplomacy}</td>
        <td class="num">${f.expeditions}</td><td class="num">${f.successRate != null ? Math.round(f.successRate * 100) + "%" : "–"}</td>
        <td class="dim">${esc(f.traits.join(", "))}</td></tr>`).join("")}</tbody></table>` : "";

    const chron = `<div class="chron">${m.log.map(([g, rows]) => `<div><h4 class="h4">${esc(g)}</h4>${kv(rows.map(([l, v, u]) =>
      [esc(l), (u === "h" || u === "min" || u === "k u" ? fmt(v, 1) : u === "u" ? big(v) : fmt(v)) + (u && u !== "u" ? ` <span class="dim">${esc(u)}</span>` : "")]))}</div>`).join("")}</div>`;

    return `<div class="sheet__inner">
      <header class="top">
        <p class="top__eyebrow">Traveller · ${esc(data.galaxy.name)}</p>
        <h2 class="top__name">${esc(w.saveName || data.save.name || "Traveller")}</h2>
      </header>
      ${section("char", "Character", character)}
      ${section("ab", "Abilities", abilities(m))}
      ${section("st", "Standing", standing(m))}
      ${section("ti", "Titles", titles(m))}
      ${n.length ? section("no", "Notes", `<ul class="notes">${n.map(x => `<li>${x}</li>`).join("")}</ul>`) : ""}
      ${section("sh", "Starships", m.ships.map(s => gearBlock(s, "ship")).join(""), `${m.ships.length} owned`)}
      ${section("mt", "Multi-tools", m.tools.map(t => gearBlock(t, "tool", `${t.type} multi-tool`)).join(""), `${m.tools.length} owned`)}
      ${section("ex", "Exosuit", `<article class="gear"><h4>${cls(ex.class)} Exosuit <small>${esc(ex.class)}-class</small></h4>
        <p class="gear__slots"><b>${ex.slots}</b> general · <b>${ex.techSlots}</b> tech · <b>${ex.cargo}</b> cargo${ex.supercharged ? ` · <b>${ex.supercharged}</b> supercharged` : ""}</p>
        <div class="invs">${ex.grids.map(g => invGrid(g, "Exosuit")).join("")}</div></article>`)}
      ${m.freighter || fleet ? section("fr", "Freighter and fleet", (m.freighter ? gearBlock(m.freighter, "freighter") : "") + fleet) : ""}
      ${m.settlements.length ? section("se", "Settlement", m.settlements.map(s => `<article class="gear"><h4>${esc(s.name)}</h4>
        <p class="gear__slots">Overseer since ${s.claimed ? s.claimed.toISOString().slice(0, 10) : "?"} · <b>${s.judgements}</b> judgements · <b>${s.sentinelAttacks}</b> sentinel attacks · started with ${s.initialPop} settlers</p>
        ${s.perks.length ? `<p class="gear__tech"><span class="lbl">Perks</span> ${s.perks.map(esc).join(", ")}</p>` : ""}</article>`).join("")) : ""}
      ${section("ch", "Chronicle", chron)}
      <p class="fine sheet__src">From ${esc(data.save.file || data.save.name || "the save")}${data.save.modified ? `, saved ${new Date(data.save.modified).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}` : ""}.
        Base stats only; installed technology adds to them in the game. Ranges and ranks are the game's own tables.</p>
    </div>`;
  }

  function show(data) {
    if (!data || !data.player) return false;
    const m = Sheet.compute(data.player, data.common, data);
    if (!root) {
      root = document.createElement("section");
      root.className = "sheet";
      root.setAttribute("aria-label", "Character sheet");
      document.body.append(root);
      root.addEventListener("pointerover", e => { const c = e.target.closest("[data-tip]"); if (c) showTip(c); });
      root.addEventListener("pointerout", e => { if (e.target.closest("[data-tip]")) hideTip(); });
      root.addEventListener("focusin", e => { const c = e.target.closest("[data-tip]"); if (c) showTip(c); });
      root.addEventListener("focusout", hideTip);
      root.addEventListener("scroll", hideTip, { passive: true });
      root.addEventListener("click", e => { const b = e.target.closest("[data-opt]"); if (b) openOptimizer(optGrids[+b.dataset.opt]); });
    }
    tips = []; optGrids = [];
    root.innerHTML = render(m, data);
    root.scrollTop = 0;
    document.body.dataset.view = "sheet";
    return true;
  }

  window.SheetView = { show, _tipHtml: tipHtml };   // _tipHtml: for tests
})();
