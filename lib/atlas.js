"use strict";
/*
 * Atlas: builds the site's picture of the player's universe from one save. Exposes window.Atlas.
 *
 *   Atlas.STEPS          -> [{ id, label }]   in order; the loader shows these
 *   await Atlas.build(entry, onStep)   onStep(id, "active" | "done" | "error", note?)
 *     -> data (also Atlas.data; event "atlas:loaded" on window)
 *     entry is a save (lib/saves.js) or { manual: true, log } with addresses the player typed in
 *     (components/manual.js; log = { galaxy, current: key, systems: [{ x, y, z, index, galaxy, calm }] }).
 *   await Atlas.preview(addr, galaxy)        -> one system from its address alone, or null if no star there
 *   await Atlas.findByName(text, addr, galaxy) -> systems whose original name contains text, in the 27 regions
 *                                                around addr, nearest first
 *
 * data = {
 *   save: { name, file, slot, summary, playTime },
 *   galaxy: { index, name },
 *   current: key of the system the player is in,
 *   systems: [{ key, region: [x,y,z], index, code, name, originalName, regionName,
 *               star: "Yellow"…, race, economy, wealth, conflict, abandoned, uncharted, pirate, blackHole,
 *               planetCount, moonCount, station, bases: [names], visited, discovered,
 *               pos: [x,y,z] ly from the galactic centre, coreLy,
 *               planets: [{ index, name, biome, variant, discovered, resources }], cluster }],
 *   clusters: [{ id, keys, anchor, visited }]   systems within CLUSTER_LY of each other; anchor = where the map points
 *   jumps: [{ from, to, ly }]                   history steps through a black hole into another cluster
 *   player, common                              the save's PlayerStateData and CommonStateData as read (for the sheet)
 * }
 *
 * Star positions come from lib/stargen.js, a re-implementation of the game's galaxy generator that matches it
 * bit for bit (checked against the game).
 */
(function () {
  // Obfuscated save keys (as the save files store them) for the fields we read.
  const K = {
    BaseContext: "vLc", ExpeditionContext: "2YS", ActiveContext: "XTp", PlayerStateData: "6f=",
    UniverseAddress: "yhJ", GalacticAddress: "oZw", RealityIndex: "Iis", VoxelX: "dZj", VoxelY: "IyE",
    VoxelZ: "uXE", SolarSystemIndex: "vby", PlanetIndex: "jsv", VisitedSystems: "nwS", TeleportEndpoints: "nlG",
    Name: "NKm", TeleporterType: "iAF", PersistentPlayerBases: "F?0", BaseType: "peI", PersistentBaseTypes: "DPp",
    DiscoveryManagerData: "fDu", "DiscoveryData-v1": "ETO", Store: "OsQ", Record: "?fB", Available: "brV",
    DD: "8P3", UA: "5L6",
    DT: "<Dn", VP: "bEr", DM: "q9a", CN: "q5u", OWS: "ksu", LID: "f5Q", TS: "3I1",
    CommonStateData: "<h0", SaveName: "Pk4", TotalPlayTime: "Lg8",
  };
  // Read a field whether the save is obfuscated or not.
  const g = (o, name) => (o == null ? undefined : o[K[name]] !== undefined ? o[K[name]] : o[name]);
  const path = (o, ...names) => names.reduce((x, n) => g(x, n), o);

  const BIOMES = ["Lush", "Toxic", "Scorched", "Irradiated", "Frozen", "Barren", "Dead", "Exotic", "Exotic (red)",
                  "Exotic (green)", "Exotic (blue)", "Test", "Swamp", "Volcanic", "Waterworld", "Gas Giant"];
  const STARS = ["Yellow", "Green", "Blue", "Red", "Purple"];
  const SIZES = ["Large", "Medium", "Small", "Moon", "Giant"];
  const RACES = { 1: "Gek", 2: "Korvax", 3: "Vy'keen" };
  const ECONOMIES = ["Trading", "Advanced Materials", "Scientific", "Mining", "Manufacturing", "Technology", "Power Generation"];
  const LEVELS = ["Low", "Medium", "High"];
  const GALAXIES = ["Euclid", "Hilbert Dimension", "Calypso", "Hesperius Dimension", "Hyades", "Ickjamatew",
                    "Budullangr", "Kikolgallr", "Eltiensleen", "Eissentam"];
  const REGION_LY = 400;

  const STEPS = [
    { id: "read", label: "Loading player" },
    { id: "systems", label: "Finding visited systems" },
    { id: "generate", label: "Calculating systems" },
    { id: "place", label: "Placing stars" },
    { id: "planets", label: "Calculating planets" },
    { id: "resources", label: "Calculating resources" },
    { id: "draw", label: "Drawing 3D map" },
  ];

  // A short pause so the loader can repaint between steps (setTimeout, not rAF: rAF stalls in hidden tabs).
  const frame = () => new Promise(r => setTimeout(r, 16));

  function loadScript(src) {
    return new Promise((res, rej) => {
      if (document.querySelector(`script[data-src="${src}"]`)) return res();
      const s = document.createElement("script");
      s.src = src; s.dataset.src = src;
      s.onload = res; s.onerror = () => rej(new Error(`Couldn't load ${src}`));
      document.head.append(s);
    });
  }

  // Integers above 2^53 lose their low bits in JSON.parse; keep long ones as strings and read them with BigInt.
  function parseSave(text) {
    return JSON.parse(text.replace(/([:\[,])(-?\d{16,})(?=[,\]}])/g, '$1"$2"'));
  }
  const big = v => (typeof v === "bigint" ? v : typeof v === "number" ? BigInt(v) : BigInt(String(v)));
  const signed = (v, bits) => (v >= 1 << (bits - 1) ? v - (1 << bits) : v);

  // Packed address: X | Z<<12 | Y<<24 | galaxy<<32 | system<<40 | planet<<52
  function unpackUA(ua) {
    const v = big(ua);
    const n = s => Number((v >> BigInt(s)) & 0xFFFFn);   // mask before Number(): the full value is up to 56 bits
    return { x: signed(n(0) & 0xFFF, 12), z: signed(n(12) & 0xFFF, 12), y: signed(n(24) & 0xFF, 8),
             galaxy: n(32) & 0xFF, index: n(40) & 0xFFF, planet: n(52) & 0xF };
  }
  function fromGalactic(ua) {
    const ga = g(ua, "GalacticAddress");
    return { x: g(ga, "VoxelX"), y: g(ga, "VoxelY"), z: g(ga, "VoxelZ"), index: g(ga, "SolarSystemIndex"),
             planet: g(ga, "PlanetIndex") || 0, galaxy: g(ua, "RealityIndex") || 0 };
  }
  const keyOf = a => `${a.galaxy}:${a.x},${a.y},${a.z}:${a.index}`;
  const hex = (v, w) => (v & ((1 << (w * 4)) - 1)).toString(16).toUpperCase().padStart(w, "0");
  // Portal code: P SSS YY ZZZ XXX
  const portal = (a, planet = 0) => `${hex(planet, 1)}${hex(a.index, 3)}${hex(a.y, 2)}${hex(a.z, 3)}${hex(a.x, 3)}`;

  // ---- One system: attributes, position, bodies, resources. Used for the save's systems and for nearby ones.

  function describe(s, galaxy) {
    const code = portal(s.addr);
    const pc = BigInt("0x" + code);
    const a = NmsCore.systemAttributes(pc, galaxy);
    s.code = code;
    s.originalName = NmsCore.systemName(pc, galaxy, NMS_LETTER_MAP);
    s.regionName = NmsCore.regionName(pc, galaxy, NMS_LETTER_MAP);
    s.starIndex = a.star_type < STARS.length ? a.star_type : null;
    s.star = s.starIndex != null ? STARS[s.starIndex] : null;
    s.gasGiantSystem = !!a.gas_giant;
    s.planetCount = a.planet_count;
    s.moonCount = a.prime_planet_count;
    s.abandoned = !!a.abandoned; s.uncharted = !!a.uncharted; s.pirate = !!a.pirate;
    s.blackHole = s.index === 0x79;   // every region's black hole is system 0x79 (Fandom: Black Hole)
    const empty = s.abandoned || s.uncharted || !a.dominant_race;
    s.race = empty ? null : RACES[a.dominant_race] || null;
    s.economy = empty ? null : ECONOMIES[a.economy_type - 1] || null;
    s.wealth = empty ? null : LEVELS[a.wealth - 1] || null;
    s.conflict = empty ? null : LEVELS[a.conflict_level - 1] || null;
    s.name = s.discoveredName || s.originalName;
  }

  // Exact position from the galaxy generator (lib/stargen.js). False if the index isn't a real system.
  function place(s, galaxy) {
    const [x, y, z] = s.region;
    const p = StarGen.systemPosition(x, y, z, s.index, galaxy);
    const ok = !!(p && p.status === 0);
    s.pos = ok ? p.ly : [x * REGION_LY, y * REGION_LY, z * REGION_LY];   // else the region centre
    s.coreLy = Math.round(Math.hypot(...s.pos));
    return ok;
  }

  // Every body from the game's own solar-system generator (lib/sysgen.js); the save adds names and visits.
  function makePlanets(s, galaxy) {
    let n = 0;
    s.planets = [];
    let gen = null;
    try { gen = SysGen.systemBiomes(s.region[0], s.region[1], s.region[2], s.index, galaxy); }
    catch (e) { console.warn("sysgen", s.key, e); }
    const bodies = gen ? gen.bodies.slice(0, 6) : [];
    let sent = [];
    try { if (gen) sent = SysGen.systemSentinels(gen, galaxy); }
    catch (e) { console.warn("sentinels", s.key, e); }
    if (gen) {
      s.planetCount = bodies.filter(b => b.cls !== 3).length;
      s.moonCount = bodies.filter(b => b.cls === 3).length;
    }
    const found = s.planetsFound || new Map();
    const indices = new Set(bodies.map((_, i) => i + 1));
    for (const i of found.keys()) indices.add(i);
    for (const i of [...indices].sort((a, b) => a - b)) {
      const f = found.get(i), b = bodies[i - 1];
      let generated = null;
      try { generated = NmsCore.planetName(BigInt("0x" + portal(s.addr, i)), galaxy, NMS_LETTER_MAP); }
      catch { /* index beyond the system's planets */ }
      const biome = f && f.biomeRaw != null ? f.biomeRaw & 0xFFFF : b ? b.biome : null;
      s.planets.push({
        index: i, name: (f && f.name) || generated || `Planet ${i}`, originalName: generated,
        discovered: !!f, seed: f && f.seed != null ? f.seed : b ? b.seed : null,
        biomeIndex: biome, biome: biome != null ? BIOMES[biome] || `Type ${biome}` : null,
        subtype: b ? b.subtype : null, size: b ? SIZES[b.cls] : null,
        variant: f && f.biomeRaw != null ? f.biomeRaw >>> 16 !== 0 : false,
        sentinels: sent[i - 1] ? sent[i - 1].sentinels : null,
        scrapGen: sent[i - 1] && (!f || f.biomeRaw == null || (f.biomeRaw & 0xFFFF) === b.biome) ? sent[i - 1].scrap : null,
        dissonant: sent[i - 1] ? sent[i - 1].dissonant : false,
      });
      n++;
    }
    delete s.planetsFound;
    return n;
  }

  // first: the player's first own planet discovery (its system is the start system), or null.
  function computeResources(s, first) {
    let n = 0;
    for (const p of s.planets) {
      if (p.seed == null || s.starIndex == null) continue;
      const startSystem = !!first && first.key === s.key;
      if (p.biomeIndex == null) {          // not visited: what can be said without the biome
        p.resources = { ...Resources.partial({ seed: p.seed, star: s.starIndex, startSystem, gasGiantSystem: s.gasGiantSystem }), partial: true };
        n++;
        continue;
      }
      const gasGiantSystem = s.planets.some(q => q.biomeIndex === 15) || s.gasGiantSystem;
      p.resources = Resources.compute({
        seed: p.seed, biome: p.biomeIndex, star: s.starIndex,
        startSystem, gasGiantSystem,
        startPlanet: !!first && first.key === s.key && first.planet === p.index,
      });
      // Scrap: the game's own roll from lib/sysgen.js (knows the planet type and building level; 224/224 against
      // the game). Resources.compute only guesses, and is kept for the start planet, which skips the life draws.
      const startPlanet = !!first && first.key === s.key && first.planet === p.index;
      if (p.scrapGen != null && !startPlanet) p.resources.scrap = p.scrapGen;
      else if (p.subtype === 24) p.resources.scrap = false;   // Infested planets never have scrap
      n++;
    }
    return n;
  }

  // ---- Resources a body offers, for search: [{ name, how }]
  // The biome's plant, as the scanner lists it (Swamp and Volcanic use their base biome's plant).
  const PLANTS = { Lush: "Star Bulb", Toxic: "Fungal Mould", Scorched: "Solanium", Irradiated: "Gamma Root",
                   Frozen: "Frost Crystal", Barren: "Cactus Flesh", Swamp: "Star Bulb", Volcanic: "Solanium",
                   Waterworld: "Kelp Sac" };
  function planetOffers(p) {
    const r = p.resources, out = [];
    if (!r) return out;
    if (r.common) out.push({ name: r.common, how: "common" });
    if (r.uncommon && !r.partial) out.push({ name: r.uncommon, how: "uncommon" });
    if (r.rare) out.push({ name: r.rare, how: "rare" });
    const plant = PLANTS[p.biome];
    if (plant) out.push({ name: plant, how: "plant" });
    if (r.gas) out.push({ name: r.gas, how: "harvester" });
    if (r.scrap) out.push({ name: "Salvageable Scrap", how: "scrap" });
    if (p.dissonant) out.push({ name: "Dissonance", how: "dissonance" });
    return out;
  }

  const loadThree = () => loadScript("vendor/three.min.js")
    .then(() => loadScript("vendor/OrbitControls.js")).then(() => loadScript("vendor/CSS2DRenderer.js"));
  const loadCore = () => loadScript("vendor/nms-core.js").then(() => loadScript("vendor/nms-letter-map.js"));

  // One system from its address alone (no save): name, region, star, race … and its exact position.
  async function preview(addr, galaxy = 0) {
    await loadCore();
    const a = { x: addr.x, y: addr.y, z: addr.z, index: addr.index, galaxy, planet: 0 };
    const s = { key: keyOf(a), region: [a.x, a.y, a.z], index: a.index, addr: a };
    describe(s, galaxy);
    if (!place(s, galaxy)) return null;
    delete s.addr;
    return s;
  }

  // Systems in the 27 regions around addr whose original name contains text (case and accents ignored).
  // Exact matches first, then by distance. Names repeat across the galaxy, so the search has to stay local.
  async function findByName(text, addr, galaxy = 0, limit = 30, onProgress = () => {}) {
    await loadCore();
    const norm = t => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
    const q = norm(text);
    if (!q) return [];
    const c = StarGen.systemPosition(addr.x, addr.y, addr.z, addr.index, galaxy);
    const here = c ? c.ly : [addr.x * REGION_LY, addr.y * REGION_LY, addr.z * REGION_LY];
    const out = [];
    let done = 0;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const x = addr.x + dx, y = addr.y + dy, z = addr.z + dz;
      onProgress(done++, 27);
      if (y < -128 || y > 127) continue;
      const r = StarGen.regionCached(x, y, z, galaxy);   // kept, so a second search nearby is instant
      r.stars.forEach((st, j) => {
        const index = j < r.beforeRandom ? j + 1 : j + 1001 - r.beforeRandom;
        const a = { x, y, z, index, galaxy, planet: 0 };
        const name = NmsCore.systemName(BigInt("0x" + portal(a)), galaxy, NMS_LETTER_MAP);
        const n = norm(name);
        if (!n.includes(q)) return;
        const pos = [(x * 100 + st.pos[0]) * 4, (y * 100 + st.pos[1]) * 4, (z * 100 + st.pos[2]) * 4];
        out.push({ addr: a, name, exact: n === q, code: portal(a),
                   ly: Math.hypot(pos[0] - here[0], pos[1] - here[1], pos[2] - here[2]) });
      });
      await frame();
    }
    out.sort((a, b) => (b.exact - a.exact) || a.ly - b.ly);
    return out.slice(0, limit);
  }

  // ---- Systems near the player that the save doesn't know: every star of the 27 regions around the current
  // one (enough for a radius up to 400 ly), generated like the save's own. Cached per save in data.nearby.
  async function nearby(radius, onProgress = () => {}, data = Atlas.data) {
    if (!data) return [];
    const here = data.systems.find(s => s.key === data.current);
    const galaxy = data.galaxy.index;
    const known = new Set(data.systems.map(s => s.key));
    if (data.nearbyRadius < radius) {
      const [X, Y, Z] = here.region;
      let done = 0;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const x = X + dx, y = Y + dy, z = Z + dz;
        onProgress(done++, 27);
        await frame();
        const r = StarGen.regionStars(x, y, z, galaxy);
        r.stars.forEach((st, j) => {
          // Star list index -> system index: the ordinary stars count from 1, the random ones from 1001.
          const index = j < r.beforeRandom ? j + 1 : j + 1001 - r.beforeRandom;
          const a = { x, y, z, index, galaxy, planet: 0 };
          const key = keyOf(a);
          if (known.has(key) || data.nearby.has(key)) return;
          const pos = [(x * 100 + st.pos[0]) * 4, (y * 100 + st.pos[1]) * 4, (z * 100 + st.pos[2]) * 4];
          const d = Math.hypot(pos[0] - here.pos[0], pos[1] - here.pos[1], pos[2] - here.pos[2]);
          if (d > radius) return;
          const s = { key, region: [x, y, z], index, addr: a, bases: [], visited: false, discovered: false, scope: "nearby" };
          try {
            describe(s, galaxy);
            s.pos = pos; s.coreLy = Math.round(Math.hypot(...pos));
            makePlanets(s, galaxy);
            computeResources(s, null);
            delete s.addr;
            data.nearby.set(key, s);
          } catch (e) { console.warn("nearby", key, e); }
        });
      }
      onProgress(27, 27);
      data.nearbyRadius = radius;
    }
    return [...data.nearby.values()].filter(s => Math.hypot(s.pos[0] - here.pos[0], s.pos[1] - here.pos[1], s.pos[2] - here.pos[2]) <= radius);
  }

  // ---- Clusters and long jumps. A wormhole, black hole or station teleport can put the player hundreds of
  // thousands of ly from the rest of their systems; the map shows each cluster at its true scale and points to
  // the others. Cluster = systems linked by steps of at most CLUSTER_LY (single linkage). Jump = two systems
  // in a row in the visit history (trail) that lie in different clusters.
  const CLUSTER_LY = 5000;
  function clusters(systems, trail, current) {
    const d = (a, b) => Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1], a.pos[2] - b.pos[2]);
    const id = new Map(), list = [];
    for (const s0 of systems) {
      if (id.has(s0.key)) continue;
      const c = { id: list.length, keys: [] };
      list.push(c);
      id.set(s0.key, c.id);
      const stack = [s0];
      while (stack.length) {
        const a = stack.pop();
        c.keys.push(a.key);
        for (const b of systems) if (!id.has(b.key) && d(a, b) <= CLUSTER_LY) { id.set(b.key, c.id); stack.push(b); }
      }
    }
    for (const s of systems) s.cluster = id.get(s.key);
    // Each cluster's anchor, where the map points: you, else where you last were in it, else a base, else any.
    const last = new Map();
    trail.forEach((k, i) => last.set(k, i));
    const byKey = new Map(systems.map(s => [s.key, s]));
    for (const c of list) {
      const inTrail = c.keys.filter(k => last.has(k)).sort((a, b) => last.get(b) - last.get(a));
      c.anchor = c.keys.includes(current) ? current : inTrail[0]
        || c.keys.find(k => byKey.get(k).bases.length) || c.keys[0];
      c.visited = c.keys.filter(k => byKey.get(k).visited).length;
    }
    const jumps = [], seen = new Set();
    for (let i = 1; i < trail.length; i++) {
      const from = trail[i - 1], to = trail[i];
      if (!byKey.has(from) || !byKey.has(to) || id.get(from) === id.get(to) || seen.has(from + ">" + to)) continue;
      seen.add(from + ">" + to);
      // Only black holes: a station teleport home is also a step between clusters, but not worth a line.
      if (!byKey.get(from).blackHole) continue;
      jumps.push({ from, to, ly: Math.round(d(byKey.get(from), byKey.get(to))) });
    }
    return { clusters: list, jumps, clusterLy: CLUSTER_LY };
  }

  // The loader's steps; "nearby" only when the map will open with a Nearby filter (opts.nearby = radius).
  function steps(opts = {}) {
    const list = STEPS.slice();
    if (opts.nearby > 0) list.splice(list.length - 1, 0, { id: "nearby", label: "Scanning nearby stars" });
    return list;
  }

  async function build(entry, onStep = () => {}, opts = {}) {
    const ctx = {};
    let current;
    const run = async (id, fn) => {
      current = id;
      onStep(id, "active");
      await frame();
      const note = await fn();
      onStep(id, "done", note);
      await frame();
    };

    try {
      if (entry.manual) await run("read", async () => {
        ctx.log = entry.log;
        ctx.meta = { name: "Entered by hand", summary: "" };
        return `${entry.log.systems.length} addresses`;
      });
      else await run("read", async () => {
        const text = SaveFormat.decompress(await Saves.read(entry));
        ctx.root = parseSave(text);
        const active = g(ctx.root, "ActiveContext");
        ctx.game = g(ctx.root, active === "Season" ? "ExpeditionContext" : "BaseContext") || ctx.root;
        ctx.player = g(ctx.game, "PlayerStateData") || g(ctx.root, "PlayerStateData");
        if (!ctx.player) throw new Error("This doesn't look like a No Man's Sky save");
        ctx.meta = await Saves.meta(entry).catch(() => ({}));
        return `${(text.length / 1048576).toFixed(1)} MB`;
      });

      if (entry.manual) await run("systems", async () => {
        const log = ctx.log;
        ctx.galaxy = log.galaxy || 0;
        const systems = ctx.systems = new Map();
        ctx.visitOrder = []; ctx.ownPlanets = []; ctx.calm = [];
        for (const a of log.systems) {
          if ((a.galaxy || 0) !== ctx.galaxy) continue;
          const addr = { x: a.x, y: a.y, z: a.z, index: a.index, galaxy: ctx.galaxy, planet: 0 };
          const key = keyOf(addr);
          if (systems.has(key)) continue;
          systems.set(key, { key, region: [a.x, a.y, a.z], index: a.index, addr, bases: [], visited: true,
                             discovered: false, planetsFound: new Map() });
          if (a.calm) ctx.calm.push([a.calm, key]);
        }
        if (!systems.has(log.current)) throw new Error("The current system isn't in this galaxy's list");
        ctx.current = log.current;
        return `${systems.size} systems`;
      });
      else await run("systems", async () => {
        const here = fromGalactic(g(ctx.player, "UniverseAddress"));
        ctx.galaxy = here.galaxy;
        const systems = ctx.systems = new Map();
        const add = (a, how) => {
          if (a.galaxy !== ctx.galaxy) return null;
          const key = keyOf(a);
          let s = systems.get(key);
          if (!s) systems.set(key, s = { key, region: [a.x, a.y, a.z], index: a.index, addr: a, bases: [],
                                          visited: false, discovered: false, planetsFound: new Map() });
          if (how) s[how] = true;
          return s;
        };
        ctx.current = add(here, "visited").key;
        ctx.visitOrder = [];                                        // oldest first (the save keeps the history)
        ctx.trail = [];                                             // the same, with every return (for jumps)
        for (const v of g(ctx.player, "VisitedSystems") || []) {    // X | Y<<12 | Z<<20 | system<<32
          const n = Number(v);
          const s = add({ x: signed(n & 0xFFF, 12), y: signed(Math.floor(n / 4096) & 0xFF, 8),
                z: signed(Math.floor(n / 2 ** 20) & 0xFFF, 12), index: Math.floor(n / 2 ** 32) & 0xFFF,
                galaxy: ctx.galaxy }, "visited");
          if (s && !ctx.visitOrder.includes(s.key)) ctx.visitOrder.push(s.key);
          if (s && ctx.trail[ctx.trail.length - 1] !== s.key) ctx.trail.push(s.key);
        }
        for (const t of g(ctx.player, "TeleportEndpoints") || []) {
          const s = add(fromGalactic(g(t, "UniverseAddress")), "visited");
          if (s && g(t, "TeleporterType") === "Spacestation") s.station = g(t, "Name");
        }
        for (const b of g(ctx.player, "PersistentPlayerBases") || []) {
          const type = path(b, "BaseType", "PersistentBaseTypes");
          const ua = g(b, "GalacticAddress");
          if (!ua || type === "FreighterBase") continue;
          const s = add(unpackUA(ua));
          if (s) s.bases.push(g(b, "Name") || "Base");
        }
        // Discoveries: systems and planets the player has seen (their own and other players').
        // Store holds uploaded/received records; Available the player's own ones not uploaded yet.
        const dd = path(ctx.root, "DiscoveryManagerData", "DiscoveryData-v1");
        const records = [...(path(dd, "Store", "Record") || []),
                         ...(g(dd, "Available") || []).filter(r => r && typeof r === "object")];
        ctx.ownPlanets = [];
        for (const r of records) {
          const dd = g(r, "DD"), type = g(dd, "DT");
          if (type !== "SolarSystem" && type !== "Planet") continue;
          const a = unpackUA(g(dd, "UA"));
          const s = add(a, "discovered");
          if (!s) continue;
          const name = path(r, "DM", "CN");
          if (type === "SolarSystem") { if (name) s.discoveredName = name; continue; }
          const vp = g(dd, "VP") || [];
          const biomeRaw = vp[1] != null ? Number(big(vp[1]) & 0xFFFFFFFFn) : null;
          s.planetsFound.set(a.planet, { seed: vp[0] != null ? big(vp[0]) : null, biomeRaw, name });
          const ows = g(r, "OWS");
          if (g(ows, "LID")) ctx.ownPlanets.push({ key: s.key, planet: a.planet, ts: Number(g(ows, "TS") || 0) });
        }
        const n = [...systems.values()];
        return `${n.filter(s => s.visited).length} visited, ${n.length} known`;
      });

      await run("generate", async () => {
        await loadCore();
        let i = 0;
        for (const s of ctx.systems.values()) {
          describe(s, ctx.galaxy);
          if (++i % 25 === 0) await frame();
        }
        return `${ctx.systems.size} systems`;
      });

      await run("place", async () => {
        // Exact positions from the galaxy generator (lib/stargen.js), one region at a time.
        const byRegion = new Map();
        for (const s of ctx.systems.values()) {
          const k = s.region.join(",");
          if (!byRegion.has(k)) byRegion.set(k, []);
          byRegion.get(k).push(s);
        }
        let missing = 0;
        for (const list of byRegion.values()) {
          for (const s of list) {
            if (!place(s, ctx.galaxy)) missing++;
          }
          await frame();
        }
        return `${byRegion.size} regions` + (missing ? `, ${missing} without a star` : "");
      });

      await run("planets", async () => {
        // Every body from the game's own solar-system generator (lib/sysgen.js); the save adds names and visits.
        let n = 0, i = 0;
        for (const s of ctx.systems.values()) {
          n += makePlanets(s, ctx.galaxy);
          if (++i % 10 === 0) await frame();
        }
        return `${n} planets and moons`;
      });

      await run("resources", async () => {
        // The start planet is the player's first own planet discovery; its system is the start system.
        const first = ctx.ownPlanets.sort((a, b) => a.ts - b.ts)[0];
        let n = 0;
        for (const s of ctx.systems.values()) n += computeResources(s, first);

        // The game calms the start system and the first jump for this player: no dissonance and no aggressive
        // sentinels there, whatever the generator says. Start = first system in the visit history (else the
        // first own discovery); first jump = the next one.
        const order = ctx.visitOrder.length ? ctx.visitOrder.slice()
          : [...new Set(ctx.ownPlanets.sort((a, b) => a.ts - b.ts).map(o => o.key))];
        if (!order.length && first) order.push(first.key);
        // Typed-in addresses: the player says which system was the start and which the first jump.
        const calm = ctx.calm || [["start", order[0]], ["first jump", order[1]]];
        calm.forEach(([why, key]) => {
          const s = key && ctx.systems.get(key);
          if (!s) return;
          s.calm = why;
          s.calmed = 0;
          for (const p of s.planets) {
            if (p.dissonant || p.sentinels === "aggressive" || p.sentinels === "corrupted") {
              p.calmed = { dissonant: p.dissonant, sentinels: p.sentinels };
              p.dissonant = false; p.sentinels = "low"; s.calmed++;   // seen in game: Remote / Intermittent
            }
          }
        });
        return `${n} planets`;
      });

      const systems = [...ctx.systems.values()];
      for (const s of systems) s.scope = s.visited ? "visited" : "known";
      for (const s of systems) { delete s.addr; delete s.discoveredName; }
      const data = {
        save: entry.manual ? { manual: true, file: "manual", name: "Entered by hand", summary: "", count: systems.length } : { file: entry.name, slot: entry.slot, name: ctx.meta.name || "", summary: ctx.meta.summary || "",
                playTime: ctx.meta.playTime, modified: entry.modified },
        galaxy: { index: ctx.galaxy, name: GALAXIES[ctx.galaxy] || `Galaxy ${ctx.galaxy + 1}` },
        current: ctx.current, systems, regionLy: REGION_LY, nearby: new Map(), nearbyRadius: 0,
        // The raw player and common state, for the character sheet (lib/sheet.js); null for typed addresses.
        player: ctx.player || null, common: ctx.root ? g(ctx.root, "CommonStateData") || null : null,
      };
      Object.assign(data, clusters(systems, ctx.trail || [], ctx.current));

      if (opts.nearby > 0) await run("nearby", async () => {
        const list = await nearby(opts.nearby, (i, n) => onStep("nearby", "active", `${Math.round(i / n * 100)} %`), data);
        return `${list.length} systems within ${opts.nearby} ly`;
      });

      await run("draw", async () => {
        await loadThree();
        await MapView.show(data);
        return "";
      });

      Atlas.data = data;
      dispatchEvent(new CustomEvent("atlas:loaded", { detail: data }));
      return data;
    } catch (e) {
      onStep(current, "error", e.message || String(e));
      throw e;
    }
  }

  const Atlas = { STEPS, steps, build, data: null, portal, nearby, planetOffers, preview, findByName, keyOf, GALAXIES, loadThree };
  window.Atlas = Atlas;
})();
