"use strict";
/*
 * Manual: the atlas without a save file. Exposes window.Manual. For console players, or anyone who'd rather not
 * hand over their saves: type the portal glyphs (photo mode shows them) or the Signal Booster coordinates, and
 * the atlas computes everything else from the address. The list of typed addresses is kept in this browser.
 *
 *   Manual.open()       the "Enter address" pop-up (from the front page and the burger menu)
 *   Manual.entry()      -> { manual: true, log } for App.open / Atlas.build, or null with nothing entered
 *   Manual.homeBlock()  -> the front page's "No save?" section
 *   Manual.addressField(o), Manual.nameSearch(here, onPick), Manual.glyphRow(code)   building blocks, also for Distance
 *
 * log = { galaxy, current: key, systems: [{ x, y, z, index, galaxy, calm: null | "start" | "first jump", name, added }] }
 * Needs card.js, lib/atlas.js (preview, findByName), lib/app.js.
 */
(function () {
  const KEY = "atlas.manual";
  // The 16 portal glyphs in the game's order (0–F), by the names players use for them.
  const GLYPHS = ["Sunset", "Bird", "Face", "Diplo", "Eclipse", "Balloon", "Boat", "Bug",
                  "Dragonfly", "Galaxy", "Voxel", "Fish", "Tent", "Rocket", "Tree", "Atlas"];
  const nf = new Intl.NumberFormat("en-GB");

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // The game's own glyph images once the player has loaded them (lib/gameicons.js: one sprite, 0–F left to right);
  // until then the hex digit in a plain tile (manual.css).
  function glyph(i) {
    i = typeof i === "string" ? parseInt(i, 16) : i;
    const g = el("span", "glyph");
    g.style.backgroundPositionX = `${(i / 15) * 100}%`;
    g.dataset.hex = i.toString(16).toUpperCase();
    g.setAttribute("role", "img");
    g.setAttribute("aria-label", GLYPHS[i]);
    return g;
  }
  // A portal code as the row of glyphs players share.
  function glyphRow(code, cls) {
    const r = el("span", "glyphs" + (cls ? " " + cls : ""));
    r.title = code;
    for (const d of code) r.append(glyph(d));
    return r;
  }

  // ---- The stored list
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || "null");
      if (v && Array.isArray(v.systems)) return { galaxy: v.galaxy || 0, current: v.current || null, systems: v.systems };
    } catch { /* blocked storage */ }
    return { galaxy: 0, current: null, systems: [] };
  }
  function store(log) {
    try { localStorage.setItem(KEY, JSON.stringify(log)); } catch { /* private mode: lasts this visit */ }
    memo = log;
    dispatchEvent(new CustomEvent("manual:changed"));
  }
  let memo = null;
  const get = () => memo || (memo = load());
  const keyOf = a => `${a.galaxy || 0}:${a.x},${a.y},${a.z}:${a.index}`;

  function entry() {
    const log = get();
    if (!log.systems.length || !log.current) return null;
    return { manual: true, log, name: "manual" };
  }

  // ---- Parsing what the player types
  const signed = (v, bits) => (v >= 1 << (bits - 1) ? v - (1 << bits) : v);
  const hex = (v, w) => (v & ((1 << (w * 4)) - 1)).toString(16).toUpperCase().padStart(w, "0");
  const portal = a => `${hex(a.planet || 0, 1)}${hex(a.index, 3)}${hex(a.y, 2)}${hex(a.z, 3)}${hex(a.x, 3)}`;
  const booster = a => [a.x + 0x7FF, a.y + 0x7F, a.z + 0x7FF, a.index].map(v => hex(v, 4)).join(":");

  // A portal code (12 hex digits, P SSS YY ZZZ XXX) or Signal Booster coordinates (XXXX:YYYY:ZZZZ:SSSS).
  function parse(text) {
    const t = String(text || "").toUpperCase().replace(/[\s-]+/g, "");
    let m = t.match(/^([0-9A-F]{4}):([0-9A-F]{4}):([0-9A-F]{4}):([0-9A-F]{4})$/);
    if (m) {
      const [X, Y, Z, S] = m.slice(1).map(v => parseInt(v, 16));
      if (X > 0xFFF || Y > 0xFF || Z > 0xFFF || S > 0xFFF) return { error: "Those coordinates are out of range" };
      return { x: X - 0x7FF, y: Y - 0x7F, z: Z - 0x7FF, index: S, planet: 0, from: "booster" };
    }
    if (/^[0-9A-F]{12}$/.test(t)) {
      const n = (i, w) => parseInt(t.slice(i, i + w), 16);
      return { planet: n(0, 1), index: n(1, 3), y: signed(n(4, 2), 8), z: signed(n(6, 3), 12), x: signed(n(9, 3), 12),
               from: "portal" };
    }
    if (/^[0-9A-F]{0,11}$/.test(t)) return { partial: t.length };
    return { error: "Use 12 glyphs (0–F) or Signal Booster coordinates like 06A6:007C:011F:0202" };
  }

  // ---- An address field: galaxy, the typed line, 12 glyph slots, the glyph pad and a preview of the system.
  // Used by the "Enter address" pop-up and by "Distance to" (components/distance.js).
  //   const f = addressField({ galaxy, onChange(f), onEnter(f) });  f.el, f.addr, f.sys, f.setText(code), f.focus()
  function galaxySelect(value) {
    const s = el("select", "manual__select");
    for (let i = 0; i < 256; i++) {
      const o = el("option", null, `${i + 1}. ${Atlas.GALAXIES[i] || "Galaxy " + (i + 1)}`);
      o.value = String(i);
      s.append(o);
    }
    s.value = String(value || 0);
    return s;
  }
  function labelled(label, control, cls) {
    const w = el("label", "manual__field" + (cls ? " " + cls : ""));
    w.append(el("span", "card__field-label", label), control);
    return w;
  }

  // An input with the usual × at the right end; shown while there's text, clears it and keeps focus.
  function clearable(input, onClear, cls) {
    const w = el("span", "manual__clearable" + (cls ? " " + cls : ""));
    const x = el("button", "manual__clear", "×");
    x.type = "button"; x.title = "Clear"; x.setAttribute("aria-label", "Clear");
    const sync = () => { x.hidden = !input.value; };
    x.addEventListener("click", e => { e.preventDefault(); input.value = ""; sync(); onClear && onClear(); input.focus(); });
    input.addEventListener("input", sync);
    w._sync = sync;
    w.append(input, x);
    sync();
    return w;
  }

  function addressField(o = {}) {
    const f = { addr: null, sys: null, parsed: null, el: el("div", "manual__address") };
    let token = 0;

    const row = el("div", "manual__row");
    const galaxy = galaxySelect(o.galaxy);
    const input = el("input", "manual__input");
    Object.assign(input, { type: "text", spellcheck: false, autocomplete: "off",
      placeholder: "Glyphs, e.g. 0202FD920EA7, or 06A6:007C:011F:0202" });
    input.setAttribute("aria-label", "Portal glyphs or Signal Booster coordinates");
    const inputBox = clearable(input, () => update());
    row.append(labelled("Galaxy", galaxy), labelled(o.label || "Address", inputBox, "manual__grow"));

    const slots = el("div", "manual__slots");
    slots.setAttribute("aria-hidden", "true");
    const pad = el("div", "manual__pad");
    GLYPHS.forEach((name, i) => {
      const b = el("button", "manual__glyph");
      b.type = "button"; b.title = `Glyph ${i + 1}: ${name}`;
      b.append(glyph(i), el("span", "manual__glyph-name", `${hex(i, 1)} · ${name}`));
      b.addEventListener("click", () => typeGlyph(hex(i, 1)));
      pad.append(b);
    });
    const back = el("button", "manual__glyph manual__glyph--tool", "⌫");
    back.type = "button"; back.title = "Remove the last glyph";
    back.addEventListener("click", () => setText(cleanHex().slice(0, -1)));
    const clear = el("button", "manual__glyph manual__glyph--tool", "Clear");
    clear.type = "button";
    clear.addEventListener("click", () => setText(""));
    pad.append(back, clear);
    const preview = el("div", "manual__preview");
    f.el.append(row, slots, pad, preview);

    const cleanHex = () => input.value.toUpperCase().replace(/[^0-9A-F]/g, "");
    function setText(t, g) {
      if (g != null) galaxy.value = String(g);
      input.value = t; inputBox._sync(); update(); input.focus();
    }
    function typeGlyph(d) {
      const base = parse(input.value).from === "booster" ? "" : cleanHex();
      if (base.length < 12) setText(base + d);
    }
    function drawSlots(t) {
      slots.replaceChildren();
      for (let i = 0; i < 12; i++) {
        const s = el("span", "manual__slot" + (i < t.length ? " manual__slot--on" : ""));
        if (i < t.length) { const v = parseInt(t[i], 16); s.append(glyph(v)); s.title = `${t[i]} · ${GLYPHS[v]}`; }
        slots.append(s);
      }
    }
    async function update() {
      const my = ++token;
      const p = parse(input.value), g = +galaxy.value;
      f.addr = null; f.sys = null; f.parsed = p;
      drawSlots(p.from === "booster" ? portal(p) : cleanHex().slice(0, 12));
      preview.replaceChildren();
      preview.dataset.tone = "";
      const done = () => o.onChange && o.onChange(f);
      if (p.error) { preview.dataset.tone = "warn"; preview.append(el("span", null, p.error)); return done(); }
      if (p.partial != null) {
        preview.append(el("span", "manual__dim", p.partial ? `${12 - p.partial} more glyphs` : "Waiting for an address"));
        return done();
      }
      let s = null;
      try { s = await Atlas.preview(p, g); } catch (e) { console.warn(e); }
      if (my !== token) return;
      if (!s) {
        preview.dataset.tone = "warn";
        preview.append(el("span", null, "There's no star with that system number in this region. Check the 2nd–4th glyph."));
        return done();
      }
      f.addr = { x: p.x, y: p.y, z: p.z, index: p.index, galaxy: g };
      f.sys = s;
      preview.append(glyphRow(portal({ ...f.addr, planet: p.planet }), "glyphs--preview"),
        el("div", "manual__name", s.originalName),
        el("div", "manual__facts", [s.regionName, s.star && `${s.star} star`,
          s.abandoned ? "Abandoned" : s.uncharted ? "Uncharted" : s.race,
          s.pirate ? "Pirate" : s.economy, `${nf.format(s.coreLy)} ly to the centre`].filter(Boolean).join(" · ")),
        el("div", "manual__dim", `Portal ${portal(f.addr)} · Signal Booster ${booster(f.addr)}` +
          (p.planet ? ` · glyph 1 picks planet ${p.planet}` : "")),
        el("div", "manual__dim", "The game shows this name in the discovery menu unless someone has renamed the system."));
      done();
    }
    input.addEventListener("input", update);
    input.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); o.onEnter && o.onEnter(f); } });
    galaxy.addEventListener("change", update);
    Object.assign(f, { setText, update, focus: () => input.focus() });
    update();
    return f;
  }

  // ---- Find by name: names repeat across the galaxy, so only the 27 regions around one system.
  //   nameSearch(here, onPick(code, galaxy)) -> element; here = { x, y, z, index, galaxy, name }
  function nameSearch(here, onPick, title = "Find a nearby system by name") {
    const box = el("div", "manual__find");
    box.append(el("div", "card__field-label", title));
    const row = el("div", "manual__row");
    const q = el("input", "manual__input");
    Object.assign(q, { type: "text", spellcheck: false, autocomplete: "off", placeholder: `Name near ${here.name || "your system"}` });
    q.setAttribute("aria-label", "System name");
    const btn = el("button", "manual__btn", "Search");
    btn.type = "button";
    row.append(clearable(q, () => results.replaceChildren(), "manual__grow"), btn);
    const results = el("ul", "manual__results");
    box.append(row, results);
    const search = async () => {
      if (!q.value.trim()) return;
      btn.disabled = true;
      const status = el("li", "manual__dim", "Searching the 27 regions around you…");
      results.replaceChildren(status);
      let found = [];
      try {
        found = await Atlas.findByName(q.value, here, here.galaxy || 0, 30,
          (i, n) => { status.textContent = `Searching the 27 regions around you… ${Math.round(i / n * 100)} %`; });
      } catch (e) { console.warn(e); }
      btn.disabled = false;
      results.replaceChildren();
      if (!found.length) {
        results.append(el("li", "manual__dim", "No system by that name within about 400 ly. Original names only; renamed ones won't match."));
        return;
      }
      for (const r of found) {
        const li = el("li");
        const b = el("button", "manual__result");
        b.type = "button";
        b.append(el("span", "manual__result-name", r.name), glyphRow(r.code, "glyphs--small"),
                 el("span", "manual__dim", `${nf.format(Math.round(r.ly))} ly`));
        b.addEventListener("click", () => onPick(r.code, r.addr.galaxy));
        li.append(b);
        results.append(li);
      }
    };
    btn.addEventListener("click", search);
    q.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); search(); } });
    return box;
  }

  // ---- The "Enter address" pop-up
  let handle = null, ui = null;

  function content() {
    const log = get();
    const box = el("div", "manual");
    ui = {};

    const intro = el("p", "card__note");
    intro.append("Photo mode shows the glyphs of the system you're in, bottom left. Tap them in below, or type them as ",
      el("code", null, "0–F"), " (the order on the pad). Signal Booster coordinates work too. ",
      "Everything is computed from the address; nothing is sent anywhere.");
    box.append(intro);

    ui.field = addressField({
      galaxy: log.galaxy,
      onChange: f => {
        const known = f.addr && get().systems.find(a => keyOf(a) === keyOf(f.addr));
        if (known && ui.calm) ui.calm.value = known.calm || "";
        setGo(!!f.addr);
      },
      onEnter: go,
    });
    box.append(ui.field.el);

    // Start system / first jump: the game calms those, whatever the generator says.
    ui.calm = el("select", "manual__select");
    [["", "An ordinary system"], ["start", "My start system"], ["first jump", "My first jump"]].forEach(([v, t]) => {
      const o = el("option", null, t); o.value = v; ui.calm.append(o);
    });
    const calmRow = el("div", "manual__row");
    calmRow.append(labelled("This system is", ui.calm, "manual__grow"));
    box.append(calmRow);

    ui.findBox = el("div");
    box.append(ui.findBox);
    ui.list = el("div", "manual__list");
    box.append(ui.list);

    renderFind(); renderList();
    setTimeout(() => ui && ui.field.focus(), 50);
    return box;
  }

  function setGo(on) {
    if (!handle) return;
    const b = handle.el.querySelector('.card__action[data-act="go"]');
    if (b) b.disabled = !on;
  }

  function add(addr, sys, calm) {
    const log = get();
    if (log.galaxy !== addr.galaxy) log.galaxy = addr.galaxy;
    const key = keyOf(addr);
    if (calm) log.systems.forEach(a => { if (a.calm === calm && keyOf(a) !== key) a.calm = null; });
    let a = log.systems.find(x => keyOf(x) === key);
    if (!a) log.systems.push(a = { ...addr, added: Date.now() });
    a.calm = calm || null;
    a.name = sys.originalName;
    log.current = key;
    store(log);
  }

  function go() {
    const f = ui && ui.field;
    if (!f || !f.addr || !f.sys) return;
    add(f.addr, f.sys, ui.calm.value);
    if (handle) handle.close();
    App.open(entry());
  }

  function renderFind() {
    const log = get();
    const here = log.systems.find(a => keyOf(a) === log.current);
    ui.findBox.replaceChildren();
    if (!here) {
      const box = el("div", "manual__find");
      box.append(el("div", "card__field-label", "Find a nearby system by name"),
        el("p", "card__note", "Once you've entered one address, you can find systems within about " +
          "400 ly of it by their original name, e.g. one you can see on the galaxy map."));
      ui.findBox.append(box);
      return;
    }
    ui.findBox.append(nameSearch(here, (code, g) => ui.field.setText(code, g)));
  }

  function renderList() {
    const log = get();
    ui.list.replaceChildren();
    if (!log.systems.length) return;
    ui.list.append(el("div", "card__field-label", "Your systems"));
    const ul = el("ul", "manual__results");
    const sorted = log.systems.slice().sort((a, b) => (b.added || 0) - (a.added || 0));
    for (const a of sorted) {
      const key = keyOf(a), li = el("li", "manual__item");
      const b = el("button", "manual__result");
      b.type = "button"; b.title = "Make this your current system";
      const name = el("span", "manual__result-name", a.name || portal(a));
      if (key === log.current) name.append(el("span", "manual__tag", "here"));
      if (a.calm) name.append(el("span", "manual__tag manual__tag--dim", a.calm));
      b.append(name, glyphRow(portal(a), "glyphs--small"));
      b.addEventListener("click", () => {
        log.current = key; log.galaxy = a.galaxy || 0; store(log);
        if (handle) handle.close();
        App.open(entry());
      });
      const x = el("button", "manual__x", "×");
      x.type = "button"; x.title = "Remove from the list"; x.setAttribute("aria-label", `Remove ${a.name || portal(a)}`);
      x.addEventListener("click", () => {
        log.systems = log.systems.filter(s => keyOf(s) !== key);
        if (log.current === key) log.current = log.systems.length ? keyOf(log.systems[log.systems.length - 1]) : null;
        store(log);
        renderList(); renderFind();
      });
      li.append(b, x);
      ul.append(li);
    }
    ui.list.append(ul);
  }

  function open() {
    const has = !!entry();
    handle = Card.popup({
      title: "Enter address",
      subtitle: "No save needed",
      width: "40em",
      content: content(),
      actions: [
        { key: "G", label: "Go there", hint: "Add it to your list and show it on the map", onSelect: go },
        ...(has ? [{ key: "M", label: "Open map", hint: "Your typed-in systems", onSelect: () => { handle.close(); App.open(entry()); } }] : []),
      ],
      onClose: () => { handle = null; ui = null; },
    });
    const b = handle.el.querySelector(".card__action");
    if (b) b.dataset.act = "go";
    handle.el.classList.add("card--manual");
    setGo(!!(ui && ui.field.addr));
  }

  // ---- Front page: "No save?" below the save list
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  function ago(t) {
    const s = (Date.now() - t) / 1000;
    if (s < 60) return "just now";
    if (s < 3600) return rtf.format(-Math.round(s / 60), "minute");
    if (s < 86400) return rtf.format(-Math.round(s / 3600), "hour");
    return rtf.format(-Math.round(s / 86400), "day");
  }

  function homeBlock() {
    const box = el("div", "manual-home");
    const log = get();
    if (log.systems.length && log.current) {
      const here = log.systems.find(a => keyOf(a) === log.current);
      const b = el("button", "save");
      b.type = "button";
      const slot = el("span", "save__slot");
      slot.append(el("span", "save__slot-label", "Typed"), el("span", "save__slot-number", String(log.systems.length)),
                  el("span", "save__kind", log.systems.length === 1 ? "system" : "systems"));
      const main = el("span", "save__main");
      main.append(el("div", "save__name", "Entered by hand"),
                  el("div", "save__summary", here ? `In ${here.name || portal(here)}` : ""));
      const last = Math.max(...log.systems.map(a => a.added || 0));
      const side = el("span", "save__side");
      side.append(el("div", "save__date", last ? ago(last) : ""));
      b.append(slot, main, side);
      b.addEventListener("click", () => App.open(entry()));
      box.append(b);
    }
    const p = el("div", "manual-home__line");
    p.append(el("span", "manual-home__text", log.systems.length
      ? "Add the system you're in now, or one nearby by name."
      : "No save file, or playing on a console? Enter the portal glyphs of the system you're in."));
    const act = el("button", "card__action");
    act.type = "button"; act.dataset.key = "e";
    act.append(el("span", "card__key", "E"), el("span", "card__label", "Enter address"),
               el("span", "card__hint", "Type the portal glyphs or Signal Booster coordinates"));
    act.addEventListener("click", open);
    const acts = el("div", "card__actions");
    acts.append(act);
    p.append(acts);
    box.append(p);
    return box;
  }

  window.Manual = { open, entry, homeBlock, parse, portal, booster, glyph, glyphRow, addressField, nameSearch, keyOf };
})();
