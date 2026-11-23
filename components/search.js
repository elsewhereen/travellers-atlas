"use strict";
/*
 * Filter: find the nearest systems that have the resources you tick. Exposes window.Search.
 * A drawer docked at the top of the map behind a small centred "Filter" tab; open, it covers about 80 % of
 * the screen: resources with checkboxes on the left (2/3), the matching systems by distance on the right (1/3),
 * Reset / Apply filter / Close at the bottom. The list follows every tick; Apply closes the drawer and
 * highlights the matching systems on the map (the rest fade). The scope always applies: systems outside it
 * are nearly hidden and get no card. Reset goes back to the default, only visited systems.
 * Below the system choice, tabs as the station's shops in Almanac: planet resources, trade terminal (computed with
 * the game's shop generator, lib/shops.js), the exosuit, multi-tool, starship and exocraft merchants (same
 * generator) and the guild envoy (guild and goods from the address).
 * Where: visited systems, every system in the save, or every system within a radius (also ones the save
 * doesn't know; Atlas.nearby generates those).
 *
 *   Search.open()  Search.close()  Search.toggle()
 */
(function () {
  // What a body can offer (Atlas.planetOffers), grouped as in the game's colour language.
  const GROUPS = [
    { title: "Star metals", tone: "common", names: ["Copper", "Emeril", "Indium", "Cadmium", "Quartzite",
      "Activated Copper", "Activated Emeril", "Activated Indium", "Activated Cadmium", "Activated Quartzite"] },
    { title: "Biome", tone: "uncommon", names: ["Paraffinium", "Ammonia", "Phosphorus", "Uranium", "Dioxite",
      "Pyrite", "Rusted Metal", "Gold", "Faecium", "Basalt", "Lithium", "Crystallised Helium"] },
    { title: "Rare", tone: "rare", names: ["Sodium", "Magnetised Ferrite", "Cobalt", "Salt", "Silver"] },
    { title: "Plants", tone: "plant", names: ["Star Bulb", "Fungal Mould", "Solanium", "Gamma Root", "Frost Crystal",
      "Cactus Flesh", "Kelp Sac"] },
    { title: "Atmosphere Harvester", tone: "uncommon", names: ["Nitrogen", "Sulphurine", "Radon", "Oxygen", "Methane"] },
    { title: "Other", tone: "info", names: ["Salvageable Scrap", "Dissonance"] },
  ];
  // Trade terminal: computed from the address with the game's own shop generator (lib/shops.js, validated against
  // the game). Each economy sells its own five trade goods (gamedata TRA_*), cheapest first; wealth decides how many.
  // Pirate systems have a black market instead, with no local trade goods.
  const GOODS = [
    { economy: "Trading", names: ["Decrypted User Data", "Star Silk", "Comet Droplets", "Ion Sphere", "Teleport Coordinators"] },
    { economy: "Advanced Materials", names: ["Nanotube Crate", "Self-Repairing Heridium", "Optical Solvent", "5D Torus", "Superconducting Fibre"] },
    { economy: "Scientific", names: ["De-Scented Bottles", "Neutron Microscope", "Instability Injector", "Organic Piping", "Neural Duct"] },
    { economy: "Mining", names: ["Dirt", "Unrefined Pyrite Grease", "Bromide Salt", "Polychromatic Zirconium", "Re-latticed Arc Crystal"] },
    { economy: "Manufacturing", names: ["Enormous Metal Cog", "Non-Stick Piston", "Mesh Decouplers", "Holographic Crankshaft", "Vector Compressors"] },
    { economy: "Technology", names: ["Decommissioned Circuits", "Welding Soap", "Ion Capacitor", "Autonomous Positioning Unit", "Quantum Accelerator"] },
    { economy: "Power Generation", names: ["Spark Canister", "Industrial-Grade Battery", "Ohmic Gel", "Experimental Power Fluid", "Fusion Core"] },
  ];
  // The rest of what a terminal can offer (station terminal, then what only the black market has), by name.
  const byName = ids => [...new Set(ids.map(Shops.name))].sort((a, b) => a.localeCompare(b));
  const STATION = Shops.possible("SpaceStation"), BLACK = Shops.possible("PirateShop");
  const TERMINAL_GROUPS = [
    { title: "Products", tone: "info", names: byName(STATION.products) },
    { title: "Substances", tone: "uncommon", names: byName(STATION.substances) },
  ];
  const stationNames = new Set(TERMINAL_GROUPS.flatMap(g => g.names));
  TERMINAL_GROUPS.push({ title: "Black market (pirate systems)", tone: "danger",
    names: byName([...BLACK.products, ...BLACK.substances]).filter(n => !stationNames.has(n)) });
  const ALL_GOODS = new Set([...GOODS.flatMap(g => g.names), ...TERMINAL_GROUPS.flatMap(g => g.names)]);
  // Tech merchants at the station (same generator): one tab each, with one row of classes (C B A S) and the module
  // types. Ticked types must all be there, each in one of the ticked classes (any class when none is ticked).
  const TECH_TABS = { suit: "SuitTech", weapon: "WeaponTech", ship: "ShipTech", vehicle: "VehicleTech" };
  const CLASSES = ["C", "B", "A", "S"];
  const baseName = l => l.replace(/^[CBAS] /, "").replace(/^[CBAS]-Class Reactor$/, "Reactor");
  const TECH_TYPES = Object.fromEntries(Object.entries(TECH_TABS).map(([tab, kind]) =>
    [tab, [...new Set(Shops.possible(kind).products.map(id => baseName(Shops.label(id))))].sort((a, b) => a.localeCompare(b))]));
  const ALL_TECH = new Set(Object.entries(TECH_TYPES).flatMap(([tab, ts]) =>
    [...CLASSES.map(c => `${tab}:class:${c}`), ...ts.map(t => `${tab}:type:${t}`)]));
  // Guild envoy: guild (from the address) and its six goods; each slot needs some guild standing.
  const ENVOY_GUILDS = Object.values(Shops.GUILDS).map(g => g[1]);
  const ENVOY_ITEMS = Object.fromEntries(Object.values(Shops.GUILDS).map(([key, name]) =>
    [name, [...new Set(ShopData.repShops[key].flat().map(Shops.label))].sort((a, b) => a.localeCompare(b))]));
  for (const g of ENVOY_GUILDS) ALL_TECH.add(`envoy:guild:${g}`);
  for (const l of Object.values(ENVOY_ITEMS).flat()) ALL_TECH.add(`envoy:item:${l}`);
  // Pirate stations: one salvage merchant with "Suspicious" modules (PirateTech), instead of the tech merchants.
  const SALVAGE_ITEMS = [...new Set(Shops.possible("PirateTech").products.map(Shops.label))].sort((a, b) => a.localeCompare(b));
  for (const l of SALVAGE_ITEMS) ALL_TECH.add(`salvage:item:${l}`);
  function salvageMatch(s, f) {
    const items = f.tech.filter(k => k.startsWith("salvage:item:")).map(k => k.slice(13));
    if (!items.length) return [];
    const t = stationOf(s);
    if (!t || !t.salvage || !items.every(l => t.salvage.has(l))) return null;
    return [["Pirate station", items]];
  }
  function envoyMatch(s, f) {
    const pick = kind => f.tech.filter(k => k.startsWith(`envoy:${kind}:`)).map(k => k.slice(kind.length + 7));
    const guilds = pick("guild"), items = pick("item");
    if (!guilds.length && !items.length) return [];
    const t = stationOf(s);
    if (!t || !t.envoy) return null;
    if (guilds.length && !guilds.includes(t.envoy.guild)) return null;
    if (!items.every(l => t.envoy.items.has(l))) return null;
    return [[t.envoy.guild, items.map(l => `${l} (standing ${t.envoy.items.get(l)})`)]];
  }
  function techSel(f, tab) {
    const pick = kind => f.tech.filter(k => k.startsWith(`${tab}:${kind}:`)).map(k => k.slice(tab.length + kind.length + 2));
    return { classes: pick("class"), types: pick("type") };
  }
  const TAB_LABEL = { envoy: "Guild envoy", salvage: "Salvage merchant", suit: "Exosuit", weapon: "Multi-tool", ship: "Starship", vehicle: "Exocraft" };
  // The station of a system, worked out once per system: { terminal: { kind, names: Set }, suit: Set, … } or null.
  const stations = new Map();
  function stationOf(s) {
    if (stations.has(s.key)) return stations.get(s.key);
    let t = null;
    try {
      const galaxy = +String(s.key).split(":")[0] || 0;
      const r = Shops.station(s.region[0], s.region[1], s.region[2], s.index, galaxy);
      if (r) {
        t = { terminal: { kind: r.terminal.kind, names: new Set(r.terminal.items.map(Shops.name)) } };
        for (const tab of Object.keys(TECH_TABS)) t[tab] = new Set(r[tab] ? r[tab].items.map(Shops.label) : []);
        if (r.salvage) t.salvage = new Set(r.salvage.items.map(Shops.label));
        if (r.envoy) t.envoy = { guild: r.envoy.guild, items: new Map(r.envoy.items.map((id, i) => [Shops.label(id), r.envoy.levels[i]])) };
      }
    } catch { t = null; }
    stations.set(s.key, t);
    return t;
  }
  const terminalOf = s => { const t = stationOf(s); return t && t.terminal; };
  // What this system's merchant has for the tab's selection: [[what, labels]] (one entry per ticked type, or one for
  // the classes alone), or null when something is missing.
  function techMatch(s, tab, sel) {
    const t = stationOf(s);
    if (!t || !t[tab]) return null;
    const cls = l => l[0];
    const okClass = l => !sel.classes.length || sel.classes.includes(cls(l));
    const labels = [...t[tab]].filter(okClass);
    if (!sel.types.length) return labels.length ? [[`${sel.classes.join("/")} class`, labels]] : null;
    const out = [];
    for (const ty of sel.types) {
      const hit = labels.filter(l => baseName(l) === ty);
      if (!hit.length) return null;
      out.push([ty, hit]);
    }
    return out;
  }
  // A good at this system's terminal: "yes" or null.
  function sellsGood(s, name) {
    const t = terminalOf(s);
    return t && t.names.has(name) ? "yes" : null;
  }
  // The station's shops, as in Almanac, all worked out from the address.
  const TABS = [
    { id: "planet", label: "Planet resources" },
    { id: "terminal", label: "Trade terminal" },
    { id: "suit", label: "Exosuit" },
    { id: "weapon", label: "Multi-tool" },
    { id: "ship", label: "Starship" },
    { id: "vehicle", label: "Exocraft" },
    { id: "envoy", label: "Guild envoy" },
    { id: "salvage", label: "Pirate salvage" },
  ];
  const HOW = { plant: "plant", harvester: "harvester" };
  const TONE = { common: "common", uncommon: "uncommon", rare: "rare", plant: "plant", harvester: "uncommon",
                 scrap: "info", dissonance: "danger" };
  const STAR_COLOURS = { Yellow: "#ffcf6e", Red: "#ff7a5c", Green: "#7dffa8", Blue: "#9cc8ff", Purple: "#c79cff" };
  const SCOPES = [["visited", "Only visited"], ["save", "In save"], ["nearby", "Nearby"]];
  // Atlas.nearby covers the 27 regions around you, which always reaches at least 400 ly in every direction.
  const R_MIN = 1, R_MAX = 400, R_STEP = 10;
  const nf = new Intl.NumberFormat("en-GB");
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const MAX_ROWS = 100;

  const store = {
    get() { try { return JSON.parse(localStorage.getItem("atlas.filter") || "{}"); } catch { return {}; } },
    set(v) { try { localStorage.setItem("atlas.filter", JSON.stringify(v)); } catch { /* private mode */ } },
  };
  // System filters: within a group any ticked value matches; groups (and resources) must all match.
  const SYSTEM = [
    { key: "race", title: "Dominant lifeform", values: ["Gek", "Korvax", "Vy'keen", "Pirate", "Uninhabited"] },
    { key: "wealth", title: "Wealth", values: ["Low", "Medium", "High"] },
    { key: "conflict", title: "Conflict", values: ["Low", "Medium", "High"] },
    { key: "economy", title: "Economy", values: GOODS.map(g => g.economy) },
  ];
  function systemValues(s) {
    return {
      race: [s.race, s.pirate ? "Pirate" : null, s.race ? null : "Uninhabited"].filter(Boolean),
      wealth: [s.wealth], conflict: [s.conflict], economy: [s.economy],
    };
  }
  const systemOk = (s, f) => {
    const v = systemValues(s);
    return SYSTEM.every(g => !f[g.key].length || f[g.key].some(x => v[g.key].includes(x)));
  };
  const DEFAULT = { wanted: [], goods: [], tech: [], tab: "planet", scope: "visited", radius: 200, onePlanet: false,
                    race: [], wealth: [], conflict: [], economy: [] };
  function clean(v) {
    v = v || {};
    return {
      wanted: Array.isArray(v.wanted) ? v.wanted.filter(n => GROUPS.some(g => g.names.includes(n))) : [],
      goods: Array.isArray(v.goods) ? v.goods.filter(n => ALL_GOODS.has(n)) : [],
      tech: Array.isArray(v.tech) ? v.tech.filter(n => ALL_TECH.has(n)) : [],
      tab: TABS.some(t => t.id === v.tab) ? v.tab : DEFAULT.tab,
      scope: SCOPES.some(([id]) => id === v.scope) ? v.scope : DEFAULT.scope,
      radius: Number.isFinite(+v.radius) && v.radius !== null && v.radius !== ""
        ? Math.min(R_MAX, Math.max(R_MIN, Math.round(+v.radius))) : DEFAULT.radius,
      onePlanet: !!v.onePlanet,
      ...Object.fromEntries(SYSTEM.map(g => [g.key, Array.isArray(v[g.key]) ? v[g.key].filter(x => g.values.includes(x)) : []])),
    };
  }
  let state = clean(store.get());
  let root = null, els = {}, runId = 0, lastRun = "", running = Promise.resolve(), hitKeys = [], scopeKeys = [], mapFilter = false;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function build() {
    root = el("div", "search");
    root.setAttribute("aria-label", "Filter");

    const panel = el("section", "filter");
    const head = el("header", "filter__head");
    head.append(el("h2", "filter__title", "Filter"), el("p", "filter__sub", "Choose where to look and tick what you need; nearest systems first"));

    // Left: where + resources
    const left = el("div", "filter__left");
    const where = el("div", "filter__where");
    const scope = el("div", "filter__scope");
    for (const [id, label] of SCOPES) {
      const b = el("button", "filter__seg", label); b.type = "button"; b.dataset.scope = id;
      b.addEventListener("click", () => { state.scope = id; changed(); });
      scope.append(b);
    }
    // Radius: a slider and a number field kept in step; the search waits until the value settles.
    const radius = el("div", "filter__radius");
    const slider = el("input", "filter__slider");
    Object.assign(slider, { type: "range", min: R_STEP, max: R_MAX, step: R_STEP });
    slider.setAttribute("aria-label", "Radius in light years");
    const num = el("input", "filter__num");
    Object.assign(num, { type: "number", min: R_MIN, max: R_MAX, step: 1, inputMode: "numeric" });
    num.setAttribute("aria-label", "Radius in light years");
    const numBox = el("span", "filter__numbox"); numBox.append(num);   // frame drawn by the box, so cut corners keep their edge
    radius.append(el("span", "filter__within", "within"), slider, numBox, el("span", "filter__unit", "ly"));
    let settle = 0;
    const setRadius = (v, from) => {
      v = Math.min(R_MAX, Math.max(R_MIN, Math.round(+v || 0)));
      if (from !== slider) slider.value = v;
      if (from !== num) num.value = v;
      paintSlider();
      clearTimeout(settle);
      settle = setTimeout(() => { if (state.radius !== v) { state.radius = v; changed(); } }, 250);
    };
    const paintSlider = () => slider.style.setProperty("--fill", `${(slider.value - slider.min) / (slider.max - slider.min) * 100}%`);
    slider.addEventListener("input", () => setRadius(slider.value, slider));
    num.addEventListener("input", () => { if (num.value !== "") setRadius(num.value, num); });
    num.addEventListener("change", () => setRadius(num.value === "" ? state.radius : num.value, null));
    const one = el("label", "filter__check filter__one");
    const oneCb = el("input"); oneCb.type = "checkbox";
    oneCb.addEventListener("change", () => { state.onePlanet = oneCb.checked; changed(); });
    one.append(oneCb, el("span", null, "All on one planet"));
    // Spoiler note for In save / Nearby: kept in the layout (just hidden) for Only visited, so nothing jumps.
    const spoiler = el("p", "filter__spoiler");
    spoiler.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M12 3l10 18H2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 10v5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="18" r="1.3" fill="currentColor"/></svg>';
    spoiler.append(el("span", null, "Spoilers: In save and Nearby show planets, resources and sentinels of systems you haven't " +
      "visited. They are computed from each address, so you see things the game won't tell you until you get there."));
    where.append(scope, radius, spoiler);   // radius keeps its place even when hidden, so nothing jumps

    // System: lifeform, wealth, conflict
    const sysGroups = el("div", "filter__groups filter__groups--system");
    const sysBoxes = new Map();
    for (const g of SYSTEM) {
      const fs = el("fieldset", "filter__group");
      fs.dataset.tone = "info";
      fs.append(el("legend", null, g.title));
      for (const v of g.values) {
        const lab = el("label", "filter__check");
        const cb = el("input"); cb.type = "checkbox"; cb.value = v;
        cb.addEventListener("change", () => {
          state[g.key] = cb.checked ? [...state[g.key], v] : state[g.key].filter(x => x !== v);
          changed();
        });
        lab.append(cb, el("span", null, v));
        fs.append(lab);
        sysBoxes.set(g.key + ":" + v, cb);
      }
      sysGroups.append(fs);
    }
    const resHead = el("div", "filter__reshead");
    resHead.append(el("h3", null, "Resources"), one);   // "All on one planet" belongs to the resources

    const groups = el("div", "filter__groups");
    const boxes = new Map();
    for (const g of GROUPS) {
      const fs = el("fieldset", "filter__group");
      fs.dataset.tone = g.tone;
      fs.append(el("legend", null, g.title));
      for (const n of g.names) {
        const lab = el("label", "filter__check");
        const cb = el("input"); cb.type = "checkbox"; cb.value = n;
        cb.addEventListener("change", () => {
          state.wanted = cb.checked ? [...state.wanted, n] : state.wanted.filter(w => w !== n);
          changed();
        });
        lab.append(cb, el("span", null, n));
        fs.append(lab);
        boxes.set(n, cb);
      }
      groups.append(fs);
    }
    const sysHead = el("div", "filter__reshead"); sysHead.append(el("h3", null, "System"));

    // Tabs: what to look for. The system choice above applies to all of them; ticks in several tabs must all match.
    const tabBar = el("div", "filter__tabs");
    tabBar.setAttribute("role", "tablist");
    const tabs = new Map(), panels = new Map();
    for (const t of TABS) {
      const b = el("button", "filter__tabbtn"); b.type = "button";
      b.setAttribute("role", "tab"); b.id = `filter-tab-${t.id}`;
      b.append(el("span", null, t.label), el("span", "filter__tabcount"));
      b.addEventListener("click", () => { state.tab = t.id; store.set(state); sync(); });
      tabBar.append(b); tabs.set(t.id, b);
      const pnl = el("div", "filter__panel");
      pnl.setAttribute("role", "tabpanel"); pnl.setAttribute("aria-labelledby", b.id);
      panels.set(t.id, pnl);
    }
    panels.get("planet").append(resHead, groups);

    const goodGroups = el("div", "filter__groups"), termGroups = el("div", "filter__groups");
    const goodBoxes = new Map();
    for (const g of GOODS) {
      const fs = el("fieldset", "filter__group");
      fs.dataset.tone = "info";
      fs.append(el("legend", null, g.economy));
      g.names.forEach((n, i) => {
        const lab = el("label", "filter__check");
        const cb = el("input"); cb.type = "checkbox"; cb.value = n;
        cb.addEventListener("change", () => {
          state.goods = cb.checked ? [...state.goods, n] : state.goods.filter(w => w !== n);
          changed();
        });
        lab.append(cb, el("span", null, n), el("span", "filter__tier", `T${i + 1}`));
        fs.append(lab);
        goodBoxes.set(n, cb);
      });
      goodGroups.append(fs);
    }
    for (const g of TERMINAL_GROUPS) {
      const fs = el("fieldset", "filter__group");
      fs.dataset.tone = g.tone;
      fs.append(el("legend", null, g.title));
      for (const n of g.names) {
        const lab = el("label", "filter__check");
        const cb = el("input"); cb.type = "checkbox"; cb.value = n;
        cb.addEventListener("change", () => {
          state.goods = cb.checked ? [...state.goods, n] : state.goods.filter(w => w !== n);
          changed();
        });
        lab.append(cb, el("span", null, n));
        fs.append(lab);
        goodBoxes.set(n, cb);
      }
      termGroups.append(fs);
    }
    const termHead = el("div", "filter__reshead"); termHead.append(el("h3", null, "Local trade goods"));
    const termHead2 = el("div", "filter__reshead"); termHead2.append(el("h3", null, "Everything else at the terminal"));
    panels.get("terminal").append(termHead,
      el("p", "filter__note", "Worked out from each address with the game's own shop generator, the same way the game " +
        "stocks the station's trade terminal. Each economy sells its own five goods; wealth decides how far up the list. " +
        "Pirate systems have a black market instead. Assumes the game mode's usual restrictions (no Oxygen, Launch Fuel " +
        "and the like at the terminal), as in your save."),
      goodGroups, termHead2, termGroups);
    for (const [tab, types] of Object.entries(TECH_TYPES)) {
      const grid = el("div", "filter__groups");
      const box = (key, text, fs) => {
        const lab = el("label", "filter__check");
        const cb = el("input"); cb.type = "checkbox"; cb.value = key;
        cb.addEventListener("change", () => {
          state.tech = cb.checked ? [...state.tech, key] : state.tech.filter(w => w !== key);
          changed();
        });
        lab.append(cb, el("span", null, text));
        fs.append(lab);
        goodBoxes.set(key, cb);
      };
      const cfs = el("fieldset", "filter__group"); cfs.dataset.tone = "rare";
      cfs.append(el("legend", null, "Class"));
      for (const c of CLASSES) box(`${tab}:class:${c}`, c, cfs);
      const tfs = el("fieldset", "filter__group"); tfs.dataset.tone = "info";
      tfs.append(el("legend", null, "Module"));
      for (const t of types) box(`${tab}:type:${t}`, t, tfs);
      grid.append(cfs, tfs);
      const head = el("div", "filter__reshead"); head.append(el("h3", null, `${TAB_LABEL[tab]} merchant`));
      panels.get(tab).append(head,
        el("p", "filter__note", "Upgrade modules the station's merchant stocks, worked out from each address with the game's " +
          "own shop generator. Tick the classes you want and the modules; with no class ticked, any class counts. " +
          "Hazard, life support and underwater modules only come in B, A and S. Pirate stations have no tech merchants."), grid);
    }
    {
      const grid = el("div", "filter__groups");
      const box = (key, text, fs) => {
        const lab = el("label", "filter__check");
        const cb = el("input"); cb.type = "checkbox"; cb.value = key;
        cb.addEventListener("change", () => {
          state.tech = cb.checked ? [...state.tech, key] : state.tech.filter(w => w !== key);
          changed();
        });
        lab.append(cb, el("span", null, text));
        fs.append(lab);
        goodBoxes.set(key, cb);
      };
      const gfs = el("fieldset", "filter__group"); gfs.dataset.tone = "rare";
      gfs.append(el("legend", null, "Guild"));
      for (const g of ENVOY_GUILDS) box(`envoy:guild:${g}`, g, gfs);
      grid.append(gfs);
      for (const g of ENVOY_GUILDS) {
        const fs = el("fieldset", "filter__group"); fs.dataset.tone = "info";
        fs.append(el("legend", null, g));
        for (const l of ENVOY_ITEMS[g]) box(`envoy:item:${l}`, l, fs);
        grid.append(fs);
      }
      {
        const sg = el("div", "filter__groups");
        const fs = el("fieldset", "filter__group"); fs.dataset.tone = "danger";
        fs.append(el("legend", null, "Suspicious modules"));
        for (const l of SALVAGE_ITEMS) box(`salvage:item:${l}`, l, fs);
        sg.append(fs);
        const sh = el("div", "filter__reshead"); sh.append(el("h3", null, "Pirate salvage"));
        panels.get("salvage").append(sh,
          el("p", "filter__note", "Pirate stations have a salvage merchant instead of the tech merchants. It sells " +
            "\u201cSuspicious\u201d modules (procedural upgrades of unknown class), worked out from the address like the other shops."), sg);
      }
      const head = el("div", "filter__reshead"); head.append(el("h3", null, "Guild envoy"));
      panels.get("envoy").append(head,
        el("p", "filter__note", "Each station's envoy belongs to one guild, and the address decides which and the six goods " +
          "(one pick per slot from the guild's list). The slots unlock with guild standing 3, 4, 5, 6, 8 and 10. " +
          "Pirate stations have no envoy."), grid);
    }

    left.append(where, sysHead, sysGroups, tabBar, ...panels.values());

    // Right: results
    const right = el("div", "filter__right");
    const status = el("p", "filter__status");
    const results = el("ol", "filter__results");
    right.append(status, results);

    // Bottom: actions
    const foot = el("footer", "filter__foot");
    const pending = el("span", "filter__pending");
    const reset = el("button", "filter__btn", "Reset"); reset.type = "button";
    const apply = el("button", "filter__btn filter__btn--main", "Apply filter"); apply.type = "button";
    const close_ = el("button", "filter__btn", "Close filter"); close_.type = "button";
    reset.addEventListener("click", resetToDefault);
    // The scope is a filter too: with nothing ticked, Apply lights up every system in it.
    apply.addEventListener("click", async () => { await running; showOnMap(true); close(); });
    close_.addEventListener("click", close);
    foot.append(reset, apply, close_, pending);

    const main = el("div", "filter__main");
    main.append(left, right);
    panel.append(head, main, foot);

    const tab = el("button", "search__tab"); tab.type = "button";
    tab.setAttribute("aria-expanded", "false");
    tab.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M3 5h18l-7 8v6l-4-2v-4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
    const tabText = el("span", null, "Filter");
    tab.append(tabText);
    tab.addEventListener("click", toggle);

    root.append(panel, tab);
    document.body.append(root);

    // The active filter, in a small anonymous card at the bottom left while it is applied.
    const active = el("aside", "filter-active");
    active.setAttribute("aria-label", "Active filter");
    active.hidden = true;
    const aHead = el("div", "filter-active__head");
    aHead.append(el("span", "filter-active__label", "Active filter"), el("span", "filter-active__count"));
    const aBody = el("div", "filter-active__body");
    const aBtns = el("div", "filter-active__btns");
    const aReset = el("button", "filter__btn", "Reset"); aReset.type = "button";
    aReset.title = "Back to the default: only visited systems";
    const aEdit = el("button", "filter__btn", "Edit"); aEdit.type = "button";
    aReset.addEventListener("click", resetToDefault);
    aEdit.addEventListener("click", open);
    aBtns.append(aReset, aEdit);
    active.append(aHead, aBody, aBtns);
    document.body.append(active);

    els = { sysBoxes, goodBoxes, tabs, panels, tab, tabText, scope, radius, spoiler, slider, num, paintSlider, oneCb, boxes, status, results, pending, apply, active, aBody,
            aCount: aHead.lastChild };
    sync();
  }

  function sync() {
    for (const b of els.scope.querySelectorAll(".filter__seg")) b.setAttribute("aria-pressed", String(b.dataset.scope === state.scope));
    if (document.activeElement !== els.num) els.num.value = state.radius;
    els.slider.value = state.radius; els.paintSlider();
    const near = state.scope === "nearby";
    els.radius.classList.toggle("filter__radius--off", !near);
    els.slider.disabled = els.num.disabled = !near;
    els.spoiler.classList.toggle("filter__spoiler--off", state.scope === "visited");
    els.oneCb.checked = state.onePlanet;
    for (const [n, cb] of els.boxes) cb.checked = state.wanted.includes(n);
    for (const [n, cb] of els.goodBoxes) cb.checked = state.goods.includes(n) || state.tech.includes(n);
    const ticked = { planet: state.wanted.length, terminal: state.goods.length };
    for (const k of state.tech) { const t = k.slice(0, k.indexOf(":")); ticked[t] = (ticked[t] || 0) + 1; }
    for (const [id, b] of els.tabs) {
      const on = id === state.tab;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
      b.lastChild.textContent = ticked[id] ? String(ticked[id]) : "";
      els.panels.get(id).hidden = !on;
    }
    for (const [k, cb] of els.sysBoxes) { const [g, v] = [k.slice(0, k.indexOf(":")), k.slice(k.indexOf(":") + 1)]; cb.checked = state[g].includes(v); }
    const n = state.wanted.length + state.goods.length + state.tech.length;
    els.pending.textContent = n ? `${n} selected` : "";
  }
  function changed() { store.set(state); sync(); run(); }

  // Apply: light up the matching systems on the map and fade the rest; off: everything as normal.
  function showOnMap(on) {
    mapFilter = on;
    MapView.highlight(on ? new Set(hitKeys) : null, on ? new Set(scopeKeys) : null);
    const n = `${hitKeys.length} ${hitKeys.length === 1 ? "system" : "systems"}`;
    els.tabText.textContent = on ? `Filter · ${n}` : "Filter";
    els.tab.classList.toggle("search__tab--on", on);
    els.active.hidden = !on;
    if (on) {
      els.aCount.textContent = n;
      const f = state, rows = [];
      const scope = el("div", "filter-active__scope",
        f.scope === "visited" ? "Only visited" : f.scope === "save" ? "In save" : `Nearby · within ${f.radius} ly`);
      rows.push(scope);
      const sys = SYSTEM.filter(g => f[g.key].length)
        .map(g => g.key === "race" ? f.race.join(" / ") : `${f[g.key].join(" / ")} ${g.key}`);
      if (sys.length) rows.push(el("div", "filter-active__note", sys.join(" · ")));
      if (f.wanted.length) {
        const list = el("div", "filter-active__res");
        for (const w of f.wanted) {
          const g = GROUPS.find(x => x.names.includes(w));
          const sp = el("span", null, w); sp.dataset.tone = g ? g.tone : "info";
          list.append(sp);
        }
        rows.push(list);
        if (f.onePlanet) rows.push(el("div", "filter-active__note", "All on one planet"));
      }
      if (f.goods.length) {
        const list = el("div", "filter-active__res");
        for (const w of f.goods) { const sp = el("span", null, w); sp.dataset.tone = "info"; list.append(sp); }
        rows.push(el("div", "filter-active__note", "Trade terminal"), list);
      }
      if (f.tech.length) {
        const list = el("div", "filter-active__res");
        const sv = f.tech.filter(k => k.startsWith("salvage:")).map(k => k.slice(13));
        if (sv.length) { const sp = el("span", null, `Pirate salvage: ${sv.join(", ")}`); sp.dataset.tone = "danger"; list.append(sp); }
        const ev = f.tech.filter(k => k.startsWith("envoy:")).map(k => k.slice(k.indexOf(":", 6) + 1));
        if (ev.length) { const sp = el("span", null, `Guild envoy: ${ev.join(", ")}`); sp.dataset.tone = "info"; list.append(sp); }
        for (const tab of Object.keys(TECH_TABS)) {
          const sel = techSel(f, tab);
          if (!sel.classes.length && !sel.types.length) continue;
          const what = [sel.classes.join("/"), sel.types.join(", ") || "any module"].filter(Boolean).join(" ");
          const sp = el("span", null, `${TAB_LABEL[tab]}: ${what}`); sp.dataset.tone = "info"; list.append(sp);
        }
        rows.push(el("div", "filter-active__note", "Station merchants"), list);
      }
      els.aBody.replaceChildren(...rows);
    }
  }

  // Reset: the default filter (only visited systems, nothing ticked), applied to the map.
  async function resetToDefault() {
    state = clean(DEFAULT); store.set(state); sync();
    await run();
    showOnMap(true);
  }

  const signature = () => JSON.stringify(state) + (Atlas.data ? Atlas.data.current + Atlas.data.save.file : "");

  function run() { running = search(); return running; }
  async function search() {
    const id = ++runId;
    lastRun = signature();
    const d = Atlas.data, f = clean(state);
    hitKeys = []; scopeKeys = [];
    els.results.replaceChildren();
    if (!d) { els.status.textContent = "Open a save first."; return; }
    const here = d.systems.find(s => s.key === d.current);

    let systems;
    if (f.scope === "visited") systems = d.systems.filter(s => s.visited);
    else if (f.scope === "save") systems = d.systems;
    else {
      els.status.textContent = "Scanning the stars around you…";
      const near = await Atlas.nearby(f.radius, (i, n) => {
        if (id === runId) els.status.textContent = `Scanning the stars around you… ${Math.round(i / n * 100)} %`;
      });
      if (id !== runId) return;
      MapView.addSystems(near);
      systems = [...d.systems.filter(s => dist(s.pos, here.pos) <= f.radius), ...near];
    }

    scopeKeys = systems.map(s => s.key);
    const hits = [];
    const sysFilter = SYSTEM.some(g => f[g.key].length);
    for (const s of systems) {
      if (!systemOk(s, f)) continue;
      const per = f.wanted.map(() => []), planets = [];
      for (const p of s.planets || []) {
        const offers = Atlas.planetOffers(p);
        const found = f.wanted.map(w => offers.find(o => o.name === w));
        if (f.onePlanet) { if (found.every(Boolean)) planets.push(p); }
        else found.forEach((o, i) => { if (o) per[i].push({ p, o }); });
      }
      if (f.wanted.length && !(f.onePlanet ? planets.length : per.every(x => x.length))) continue;
      const goods = f.goods.map(w => sellsGood(s, w));
      if (goods.some(x => !x)) continue;
      const tech = [];
      let techOk = true;
      for (const tab of Object.keys(TECH_TABS)) {
        const sel = techSel(f, tab);
        if (!sel.classes.length && !sel.types.length) continue;
        const m = techMatch(s, tab, sel);
        if (!m) { techOk = false; break; }
        tech.push([tab, m]);
      }
      if (!techOk) continue;
      const env = envoyMatch(s, f);
      if (!env) continue;
      if (env.length) tech.push(["envoy", env]);
      const salv = salvageMatch(s, f);
      if (!salv) continue;
      if (salv.length) tech.push(["salvage", salv]);
      hits.push({ s, per, planets, goods, tech, d: dist(s.pos, here.pos) });
    }
    hits.sort((a, b) => a.d - b.d);
    hitKeys = hits.map(h => h.s.key);
    if (mapFilter) showOnMap(true);   // the map follows while a filter is applied

    const scopeText = f.scope === "visited" ? "visited systems" : f.scope === "save" ? "systems in the save"
                    : `systems within ${f.radius} ly`;
    const anyFilter = f.wanted.length || f.goods.length || f.tech.length || sysFilter;
    els.status.textContent = !anyFilter
      ? `${nf.format(hits.length)} ${scopeText}` + (hits.length > MAX_ROWS ? `, nearest ${MAX_ROWS} shown` : "") + ". Tick something to narrow it down."
      : hits.length
      ? `${hits.length} of ${nf.format(systems.length)} ${scopeText}` +
        (hits.length > MAX_ROWS ? `, nearest ${MAX_ROWS} shown` : "")
      : `None of ${nf.format(systems.length)} ${scopeText}.` + (f.scope !== "nearby" ? " Try Nearby." : "");
    els.results.replaceChildren(...hits.slice(0, MAX_ROWS).map(h => row(h, here, f)));
  }

  function row(h, here, f) {
    const { s } = h;
    const li = el("li");
    const b = el("button", "filter__row"); b.type = "button";
    const top = el("div", "filter__rtop");
    const dot = el("span", "filter__dot"); dot.style.background = STAR_COLOURS[s.star] || "#efe6cf";
    const tag = s.scope === "nearby" ? "not in save" : s.visited ? "visited" : "known";
    top.append(dot, el("span", "filter__name", s.name), el("span", "filter__tag", tag),
               el("span", "filter__ly", s.key === here.key ? "here" : `${nf.format(Math.round(h.d))} ly`));
    b.append(top);
    if (SYSTEM.some(g => f[g.key].length) || f.goods.length || f.tech.length) {
      const info = s.race ? `${s.pirate ? "Pirate · " : ""}${s.race} · ${s.wealth} wealth · ${s.conflict} conflict`
                          : (s.pirate ? "Pirate · " : "") + (s.abandoned ? "Abandoned" : "Uninhabited");
      b.append(el("div", "filter__sys", info));
    }
    const planetSpan = (p, how) => {
      const sp = el("span", "filter__planet", p.name + (HOW[how] ? ` (${HOW[how]})` : ""));
      sp.dataset.tone = TONE[how] || "info";
      return sp;
    };
    if (!f.wanted.length) { /* scope only: just the system */ }
    else if (f.onePlanet) {
      const line = el("div", "filter__line");
      line.append(...h.planets.map(p => planetSpan(p, "")));
      b.append(line);
    } else {
      f.wanted.forEach((w, i) => {
        const line = el("div", "filter__line");
        line.append(el("span", "filter__what", w), ...h.per[i].map(({ p, o }) => planetSpan(p, o.how)));
        b.append(line);
      });
    }
    f.goods.forEach((w, i) => {
      const line = el("div", "filter__line");
      const t = terminalOf(s);
      const sp = el("span", "filter__planet", t && t.kind === "PirateShop" ? "Black market" : "Trade terminal");
      sp.dataset.tone = t && t.kind === "PirateShop" ? "danger" : "info";
      line.append(el("span", "filter__what", w), sp);
      b.append(line);
    });
    for (const [tab, m] of h.tech) for (const [what, labels] of m) {
      const line = el("div", "filter__line");
      line.append(el("span", "filter__what", `${what} · ${TAB_LABEL[tab]}`), ...labels.map(l => {
        const sp = el("span", "filter__planet", l); sp.dataset.tone = "info"; return sp;
      }));
      b.append(line);
    }
    b.addEventListener("click", () => { close(); MapView.focus(s.key); });   // roll up so the system's card shows
    li.append(b);
    return li;
  }

  const isOpen = () => !!root && root.classList.contains("search--open");
  function open() {
    if (!root) build();
    if (!isOpen()) Card.tint(root.querySelector(".filter__head"));
    sync();
    root.classList.add("search--open");
    els.tab.setAttribute("aria-expanded", "true");
    if (signature() !== lastRun) run();     // reopening keeps the list and its scroll position
  }
  function close() {
    if (!root) return;
    root.classList.remove("search--open");
    els.tab.setAttribute("aria-expanded", "false");
    if (root.contains(document.activeElement)) document.activeElement.blur();
  }
  function toggle() { if (isOpen()) close(); else open(); }

  build();
  // The scope always applies: a freshly loaded map shows the remembered filter (by default only visited systems).
  addEventListener("atlas:loaded", async () => { mapFilter = true; await run(); showOnMap(true); });
  addEventListener("keydown", e => {
    if (document.body.dataset.view !== "map") return;
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName || "") &&
                   document.activeElement.type !== "checkbox";
    if (e.key === "/" && !typing) { e.preventDefault(); toggle(); }
    else if (e.key === "Escape" && isOpen()) close();
  });

  // For the loader: the radius to generate before the map opens, or 0.
  const preloadRadius = () => (state.scope === "nearby" ? state.radius : 0);

  window.Search = { open, close, toggle, run, preloadRadius };
})();
