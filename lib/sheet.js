"use strict";
/*
 * Sheet: the player's character sheet, computed from one save. Exposes window.Sheet. Needs lib/sheetdata.js.
 *
 *   Sheet.compute(player, common, atlasData) -> model (see the return value at the bottom of compute)
 *
 * Everything comes from the save and the game's own tables (SheetData, built by tools/mk_sheetdata.py):
 * ranks and their titles (leveledstatstable), the stat ranges each class can roll (inventorytable) and names.
 * The six ability scores are the sheet's own formula: a game rank 0–10 becomes a score of 3–20.
 */
(function () {
  const D = window.SheetData;

  // A field by its real name, whether the save is obfuscated or not (some names have more than one key).
  function g(o, name) {
    if (o == null) return undefined;
    const k = D.keys[name];
    if (k) for (const x of Array.isArray(k) ? k : [k]) if (o[x] !== undefined) return o[x];
    return o[name];
  }
  const path = (o, ...names) => names.reduce((x, n) => g(x, n), o);
  const strip = id => String(id || "").replace(/^\^/, "");
  const first = o => (o && typeof o === "object" ? Object.values(o)[0] : o);
  const num = v => (typeof v === "string" ? Number(v) : v);

  // Item name; procedural upgrades ("UP_SNSUIT#19801") use their base id.
  function itemName(id) {
    const i = strip(id).split("#")[0];
    if (D.items[i]) return D.items[i].n;
    return /^[\x20-\x7e]+$/.test(i) ? i : "Upgrade module";
  }

  // One inventory as a grid: { label, w, h, cells: [{ x, y, valid, sc, broken, item }] } in row order.
  // item = { id, seed, name, amount, max, type, damaged, installing, data (SheetData.items entry or null) }.
  // Instance items (hashed ids in newer saves) have no readable id; they show as "Upgrade module".
  function grid(inv, label) {
    if (!inv) return null;
    const w = num(g(inv, "Width")) || 0, h = num(g(inv, "Height")) || 0;
    const key = (x, y) => x + "," + y;
    const valid = new Set((g(inv, "ValidSlotIndices") || []).map(i => key(num(g(i, "X")), num(g(i, "Y")))));
    if (!valid.size || !w || !h) return null;
    const sc = new Set(), broken = new Set();
    for (const s of g(inv, "SpecialSlots") || []) {
      const t = path(s, "Type", "InventorySpecialSlotType"), i = g(s, "Index"), k = key(num(g(i, "X")), num(g(i, "Y")));
      if (t === "TechBonus") sc.add(k); else if (t === "BlockedByBrokenTech") broken.add(k);
    }
    const items = new Map();
    let order = 0;
    for (const s of g(inv, "Slots") || []) {
      const i = g(s, "Index"), raw = strip(g(s, "Id"));
      const [base, seed] = raw.split("#");
      const readable = /^[\x20-\x7e]+$/.test(base);
      items.set(key(num(g(i, "X")), num(g(i, "Y"))), {
        id: readable ? base : null, seed: seed || null, name: itemName(raw),
        amount: num(g(s, "Amount")), max: num(g(s, "MaxAmount")), type: path(s, "Type", "InventoryType"),
        // DamageFactor only means broken for technology; on goods it is something else
        damaged: base.startsWith("SHIPSLOT_DMG") ||
                 (path(s, "Type", "InventoryType") === "Technology" && (num(g(s, "DamageFactor")) || 0) > 0),
        installing: g(s, "FullyInstalled") === false, data: readable ? D.items[base] || null : null,
        damage: num(g(s, "DamageFactor")) || 0, order: order++,   // the game sums in this order
      });
    }
    // Trim rows and columns with no valid slots at all
    let maxX = 0, maxY = 0;
    for (const k of valid) { const [x, y] = k.split(",").map(Number); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
    const cells = [];
    for (let y = 0; y <= Math.min(maxY, h - 1); y++) for (let x = 0; x <= Math.min(maxX, w - 1); x++) {
      const k = key(x, y);
      cells.push({ x, y, valid: valid.has(k), sc: sc.has(k), broken: broken.has(k), item: items.get(k) || null });
    }
    return { label, w: Math.min(maxX, w - 1) + 1, h: Math.min(maxY, h - 1) + 1, cells,
             used: [...items.keys()].filter(k => valid.has(k)).length, total: valid.size };
  }

  const cls = inv => path(inv, "Class", "InventoryClass") || "?";
  const slots = inv => (g(inv, "ValidSlotIndices") || []).length;
  const special = (inv, type) => (g(inv, "SpecialSlots") || [])
    .filter(s => path(s, "Type", "InventorySpecialSlotType") === type).length;

  function tech(...invs) {
    const out = [];
    for (const inv of invs) for (const s of g(inv, "Slots") || []) {
      if (path(s, "Type", "InventoryType") !== "Technology") continue;
      const id = strip(g(s, "Id"));
      if (id.startsWith("SHIPSLOT_DMG")) continue;
      const n = itemName(id);
      if (!out.includes(n)) out.push(n);
    }
    return out;
  }

  // Filename fragment -> [table type, name in the game, slot table prefix]
  const SHIP_TYPES = [["SENTINELSHIP", "Robot", "Interceptor", "Robot"], ["DROPSHIP", "Dropship", "Hauler", "Drp"],
    ["FIGHTER", "Fighter", "Fighter", "Fgt"], ["SCIENTIFIC", "Scientific", "Explorer", "Sci"],
    ["SHUTTLE", "Shuttle", "Shuttle", "Sh"], ["ROYAL", "Royal", "Exotic", "Roy"], ["S-CLASS", "Royal", "Exotic", "Roy"],
    ["BIOSHIP", "Alien", "Living Ship", "Alien"], ["SAILSHIP", "Sail", "Solar", "Sail"], ["CORVETTE", "Corvette", "Corvette", null]];
  const WEAPON_TYPES = [["SENTINEL", "Robot", "Sentinel"], ["ATLAS", "Atlas", "Atlantid"], ["STAFF", "Staff", "Staff"],
    ["ROYAL", "Royal", "Royal"], ["ALIEN", "Alien", "Alien"], ["PRISTINE", "Pristine", "Experimental"],
    ["RIFLE", "Rifle", "Rifle"], ["", "Pistol", "Pistol"]];
  const STAT_LABEL = { SHIP_DAMAGE: "Damage", SHIP_SHIELD: "Shield", SHIP_HYPERDRIVE: "Hyperdrive",
    SHIP_AGILE: "Maneuverability", WEAPON_DAMAGE: "Damage", WEAPON_MINING: "Mining", WEAPON_SCAN: "Scanning",
    FREI_HYPERDRIVE: "Hyperdrive", FREI_FLEET: "Fleet coordination" };
  const CLASSES = ["C", "B", "A", "S"];

  function stats(kind, type, inv, c) {
    const table = (D.ranges[kind] || {})[type] || {};
    return (g(inv, "BaseStatValues") || []).map(v => {
      const id = strip(g(v, "BaseStatID"));
      if (!STAT_LABEL[id]) return null;
      const all = {};
      for (const k of CLASSES) all[k] = (table[k] || {})[id] || null;
      return { id, label: STAT_LABEL[id], value: num(g(v, "Value")), range: all[c], all };
    }).filter(Boolean);
  }

  function slotRange(prefix) {
    if (!prefix) return null;
    const s = Object.entries(D.ranges.slots).filter(([k]) => k.startsWith(prefix));
    if (!s.length) return null;
    return { min: Math.min(...s.map(([, v]) => v.MinSlots)), max: Math.max(...s.map(([, v]) => v.MaxSlots)),
             tmin: Math.min(...s.map(([, v]) => v.MinTechSlots)), tmax: Math.max(...s.map(([, v]) => v.MaxTechSlots)) };
  }

  // A rank: the highest level whose threshold the value has reached. Rank 0 is the first level at or above 0;
  // the levels below it are the hostile ones.
  function level(stat, value) {
    const lv = (D.leveled.stats[stat] || {}).levels || [];
    value = value || 0;
    let idx = 0;
    lv.forEach((l, i) => { if (value >= l.min) idx = i; });
    const zero = Math.max(0, lv.findIndex(l => l.min >= 0));
    const cur = lv[idx], next = lv[idx + 1];
    return { value, title: cur ? cur.name : "", rank: idx - zero, ranks: lv.length - 1 - zero,
             min: cur ? cur.min : 0, next: next ? next.name : null, nextMin: next ? next.min : null,
             levels: lv.map(l => [l.name, l.min]) };
  }

  function compute(p, common, atlas) {
    const G = {};
    const groups = g(p, "Stats") || [];
    const glob = groups.find(x => strip(g(x, "GroupId")) === "GLOBAL_STATS") || groups[0];
    for (const s of g(glob, "Stats") || []) {
      const v = g(s, "Value");
      if (v && Object.keys(v).length) G[strip(g(s, "Id"))] = num(first(v));
    }
    const diff = g(p, "DifficultyState");
    const playTime = num(g(common, "TotalPlayTime")) || 0;

    // Systems from the atlas (it already knows names, regions and positions)
    const systems = atlas ? atlas.systems : [];
    const byKey = new Map(systems.map(s => [s.key, s]));
    const here = atlas && byKey.get(atlas.current);
    const visited = systems.filter(s => s.visited);
    const regions = new Set(visited.map(s => s.region.join(",")));
    const races = {};
    for (const s of visited) if (s.race) races[s.race] = (races[s.race] || 0) + 1;
    const systemAt = ua => {
      const ga = g(ua, "GalacticAddress");
      if (!ga || !atlas) return null;
      const key = `${g(ua, "RealityIndex") || 0}:${g(ga, "VoxelX")},${g(ga, "VoxelY")},${g(ga, "VoxelZ")}:${g(ga, "SolarSystemIndex")}`;
      return byKey.get(key) || null;
    };

    // ---- Ships
    const primary = num(g(p, "PrimaryShip"));
    const ships = [];
    (g(p, "ShipOwnership") || []).forEach((s, i) => {
      const fn = String(path(s, "Resource", "Filename") || "");
      if (!fn) return;
      const up = fn.toUpperCase().split("/").pop();
      const [type, label, pref] = (SHIP_TYPES.find(t => up.includes(t[0])) || [null, "Fighter", "Starship", "Fgt"]).slice(1);
      const inv = g(s, "Inventory"), techInv = g(s, "Inventory_TechOnly"), c = cls(inv);
      ships.push({
        name: g(s, "Name") || "", type: label, table: type, class: c, active: i === primary,
        seed: (path(s, "Resource", "Seed") || [])[1], slots: slots(inv), techSlots: slots(techInv),
        supercharged: special(techInv, "TechBonus") + special(inv, "TechBonus"),
        stats: stats("ship", type, inv, c), slotRange: slotRange(pref),
        maxUp: (D.ranges.max_upgrade[type] || {}), tech: tech(techInv, inv),
        grids: [grid(techInv, "Technology")].filter(Boolean),
      });
    });
    ships.sort((a, b) => b.active - a.active);

    // ---- Multi-tools
    const activeTool = num(g(p, "ActiveMultioolIndex"));
    const tools = [];
    (g(p, "Multitools") || []).forEach((m, i) => {
      const st = g(m, "Store");
      if (!slots(st)) return;
      const fn = String(path(m, "Resource", "Filename") || "").toUpperCase().split("/").pop();
      const [, type, label] = WEAPON_TYPES.find(t => fn.includes(t[0]));
      const c = cls(st);
      tools.push({
        name: g(m, "Name") || "", type: label, table: type, class: c, active: i === activeTool,
        seed: (g(m, "Seed") || [])[1], slots: slots(st), supercharged: special(st, "TechBonus"),
        broken: special(st, "BlockedByBrokenTech"), stats: stats("weapon", type, st, c),
        slotRange: slotRange("Weapon"), tech: tech(st), grids: [grid(st, "Slots")].filter(Boolean),
      });
    });
    tools.sort((a, b) => b.active - a.active);

    // ---- Exosuit
    const inv = g(p, "Inventory"), invT = g(p, "Inventory_TechOnly"), invC = g(p, "Inventory_Cargo");
    const exosuit = { class: cls(inv), slots: slots(inv), techSlots: slots(invT), cargo: slots(invC),
                      supercharged: special(invT, "TechBonus"), tech: tech(invT, inv),
                      grids: [grid(invT, "Technology")].filter(Boolean) };

    // ---- Freighter and frigates
    let freighter = null;
    const cf = g(p, "CurrentFreighter");
    if (g(cf, "Filename")) {
      const fi = g(p, "FreighterInventory"), ft = g(p, "FreighterInventory_TechOnly"), c = cls(fi);
      const tp = (g(p, "TeleportEndpoints") || []).find(t => g(t, "TeleporterType") === "Freighter");
      const at = systemAt(g(p, "FreighterUniverseAddress"));
      freighter = {
        name: g(p, "PlayerFreighterName") || (tp && g(tp, "Name")) || "",
        type: /PIRATE/i.test(g(cf, "Filename")) ? "Pirate Dreadnought" : "Freighter", class: c,
        slots: slots(fi), techSlots: slots(ft), supercharged: special(ft, "TechBonus"),
        stats: stats("ship", "Freighter", fi, c), slotRange: slotRange("Freighter"),
        maxUp: D.ranges.max_upgrade.Freighter || {}, seed: (g(cf, "Seed") || [])[1],
        location: at ? at.name : null, tech: tech(ft, fi),
        grids: [grid(ft, "Technology")].filter(Boolean),
      };
    }
    const FSTATS = ["Combat", "Exploration", "Mining", "Diplomacy"];
    const RACE = { Traders: "Gek", Warriors: "Vy'keen", Explorers: "Korvax" };
    const frigates = (g(p, "FleetFrigates") || []).map(f => {
      const st = g(f, "Stats") || [];
      const ok = num(g(f, "TotalNumberOfSuccessfulEvents")) || 0, fail = num(g(f, "TotalNumberOfFailedEvents")) || 0;
      return {
        name: g(f, "CustomName") || "", role: path(f, "FrigateClass", "FrigateClass"),
        class: path(f, "InventoryClass", "InventoryClass"),
        race: RACE[path(f, "Race", "AlienRace")] || path(f, "Race", "AlienRace"),
        expeditions: num(g(f, "TotalNumberOfExpeditions")) || 0, ok, fail,
        successRate: ok + fail ? ok / (ok + fail) : null, damaged: num(g(f, "NumberOfTimesDamaged")) || 0,
        stats: Object.fromEntries(FSTATS.map((n, i) => [n, st[i] || 0])),
        traits: (g(f, "TraitIDs") || []).map(strip).filter(Boolean).map(t => D.traits[t] || t),
      };
    });

    // ---- Settlements the player owns
    const uid = g((g(common, "UsedDiscoveryOwnersV2") || [])[0], "UID");
    const hist = new Map((g(p, "SettlementHistory") || []).map(h => [String(g(h, "SeedValue")), h]));
    const settlements = (g(p, "SettlementStatesV2") || [])
      .filter(s => uid && g(g(s, "Owner"), "UID") === uid)
      .map(s => {
        const h = hist.get(String(g(s, "SeedValue"))) || {};
        const claimed = num(g(h, "PlayerClaimedTime"));
        return {
          name: g(s, "Name"), claimed: claimed ? new Date(claimed * 1000) : null,
          judgements: num(g(h, "JudgementsSettled")) || 0, initialPop: num(g(h, "InitialPopulation")) || 0,
          sentinelAttacks: num(g(h, "SentinelAttackCount")) || 0,
          perks: (g(s, "Perks") || []).map(strip).filter(k => !k.startsWith("PROC_")).map(k => D.perks[k] || k),
        };
      });

    // ---- Ranks
    const jm = G.JM || 0, ms = D.leveled.journey;
    let mi = 0;
    ms.forEach((m, i) => { if (jm >= m.points) mi = i; });
    const journey = { points: jm, title: ms[mi].title, index: mi, of: ms.length - 1,
                      from: ms[mi].points, next: ms[mi + 1] || null };

    const FACTIONS = [
      ["Gek", "Races", "TRA_STANDING", "TWORDS_LEARNT", "TSEEN_SYSTEMS", "TDONE_MISSIONS"],
      ["Korvax", "Races", "EXP_STANDING", "EWORDS_LEARNT", "ESEEN_SYSTEMS", "EDONE_MISSIONS"],
      ["Vy'keen", "Races", "WAR_STANDING", "WWORDS_LEARNT", "WSEEN_SYSTEMS", "WDONE_MISSIONS"],
      ["Autophage", "Races", "BUI_STANDING", "BWORDS_LEARNT", null, "BDONE_MISSIONS"],
      ["Merchants Guild", "Guilds", "TGUILD_STAND", null, null, "TGDONE_MISSIONS"],
      ["Mercenaries Guild", "Guilds", "WGUILD_STAND", null, null, "WGDONE_MISSIONS"],
      ["Explorers Guild", "Guilds", "EGUILD_STAND", null, null, "EGDONE_MISSIONS"],
      ["Outlaws", "Guilds", "PIRATE_STAND", null, null, "PIRATE_MISSIONS"],
    ];
    const factions = FACTIONS.map(([name, group, st, words, seen, miss]) => Object.assign(level(st, G[st]), {
      name, group, words: words ? G[words] || 0 : null, seen: seen ? G[seen] || 0 : null, missions: G[miss] || 0,
    }));

    // Six abilities in the D&D order (STR DEX CON INT WIS CHA), each one of the game's own ranked stats.
    const ABILITIES = [
      ["Combat", "STR", "ENEMIES_KILLED", "Ships destroyed"],
      ["Navigation", "DEX", "DIST_WARP", "Warps"],
      ["Survival", "CON", "LONGEST_LIFE_EX", "Seconds survived in extreme hazard"],
      ["Xenology", "INT", "DISC_ALL_CREATU", "Planets with all fauna catalogued"],
      ["Lore", "WIS", "WORDS_LEARNT", "Words learnt"],
      ["Diplomacy", "CHA", "ALIENS_MET", "Aliens met"],
    ].map(([name, short, st, what]) => [name, short, st, G[st], what]);
    const abilities = ABILITIES.map(([name, short, st, v, what]) => {
      const l = level(st, v);
      const score = 3 + Math.round(Math.max(l.rank, 0) * 1.7);
      return Object.assign(l, { name, short, what, statTitle: (D.leveled.stats[st] || {}).title,
                                score, mod: Math.floor((score - 10) / 2) });
    });

    const TITLE_LABELS = { PIRATES_KILLED: "Pirates destroyed", BOUNTIES: "Bounties claimed", DISC_FLORA: "Flora discovered", RARE_SCANNED: "Rare scans",
      NANITES_EVER: "Nanites earned", SMUGGLE_VALUE: "Contraband sold", DRONE_SHARDS: "Sentinel shards",
      HEAD_REPAIRS: "Sentinel heads repaired", PROC_PRODS: "Salvaged artefacts", FPODS_BROKEN: "Freighter pods cracked" };
    const titles = ["DIST_WALKED", "MONEY", "SENTINEL_KILLS", "PIRATES_KILLED", "BOUNTIES", "DISC_FLORA", "RARE_SCANNED",
                    "NANITES_EVER", "SMUGGLE_VALUE", "DRONE_SHARDS", "HEAD_REPAIRS", "PROC_PRODS", "FPODS_BROKEN"]
      .map(st => Object.assign(level(st, st === "MONEY" && G.MONEY_EVER != null ? G.MONEY_EVER : G[st]), { id: st, label: TITLE_LABELS[st] || (D.leveled.stats[st] || {}).title || st }))
      .filter(t => t.levels.length);

    const v = k => G[k] || 0;
    const log = [
      ["Travel", [["Systems visited", visited.length], ["Regions", regions.size], ["Warps", v("DIST_WARP")],
                  ["Planets landed on", v("VISIT_PLANETS")], ["Flown", v("DIST_FLY") / 1000, "k u"],
                  ["Walked", v("DIST_WALKED") / 1000, "k u"], ["Times in space", v("TIMES_IN_SPACE")]]],
      ["Discovery", [["Planets", v("DISC_PLANETS")], ["Creatures", v("DISC_CREATURES")], ["Flora", v("DISC_FLORA")],
                     ["Minerals", v("DISC_MINERALS")], ["Waypoints", v("DISC_WAYPOINTS")], ["Words learnt", v("WORDS_LEARNT")]]],
      ["Combat", [["Ships destroyed", v("ENEMIES_KILLED")], ["Pirates", v("PIRATES_KILLED")],
                  ["Sentinels", v("SENTINEL_KILLS")], ["Sentinel drones", v("DRONES_KILLED")],
                  ["Space battles", v("SPACE_BATTLES")], ["Freighter battles won", v("PIR_FREI_WINS")],
                  ["Dissonance resonators", v("CORRUPT_PILLAR")], ["Shots fired", v("AMMO_FIRED")]]],
      ["Trade", [["Units earned", v("MONEY_EVER"), "u"], ["Biggest sale", v("BIG_SELLER"), "u"],
                 ["Nanites earned", v("NANITES_EVER")], ["Ships bought", v("SHIPS_BOUGHT")],
                 ["Sentinel ships claimed", v("SENT_SHIP_CLAIM")], ["Frigate expeditions", v("EXPEDITIONS")],
                 ["Items teleported", v("ITEMS_TELEPRT")]]],
      ["Survival", [["Longest life", v("LONGEST_LIFE") / 3600, "h"], ["Longest in extreme hazard", v("LONGEST_LIFE_EX") / 60, "min"],
                    ["Terrain excavated", v("EXCAVATED")], ["Asteroids mined", v("ASTEROIDS")],
                    ["Play sessions", v("PLAY_SESSIONS")]]],
    ];

    const settings = g(diff, "Settings");
    return {
      who: {
        saveName: g(common, "SaveName") || "", playHours: playTime / 3600,
        mode: path(diff, "Preset", "DifficultyPresetType"),
        death: path(settings, "DeathConsequences", "DeathConsequencesDifficulty"),
        tutorial: !!g(settings, "TutorialEnabled"),
        where: g(p, "SaveSummary") || "",
        galaxy: atlas ? atlas.galaxy.name : "", system: here ? here.name : null, region: here ? here.regionName : null,
        star: here ? here.star : null, race: here ? here.race : null, economy: here ? here.economy : null,
        coreLy: here ? here.coreLy : null, portal: here ? here.code : null,
        mission: strip(g(p, "CurrentMissionID")), glyphs: (Number(g(p, "KnownPortalRunes")) >>> 0).toString(2).split("1").length - 1,
        units: num(g(p, "Units")) >>> 0, nanites: num(g(p, "Nanites")), quicksilver: num(g(p, "Specials")),
        knownTech: (g(p, "KnownTech") || []).length, knownProducts: (g(p, "KnownProducts") || []).length,
        refiner: (g(p, "KnownRefinerRecipes") || []).length, races,
      },
      journey, abilities, factions, titles, log, ships, tools, exosuit, freighter, frigates, settlements,
    };
  }

  // A stat value as the game shows it (rules from gamedata/stat_display.json). Fixed base tech shows raw.
  function formatStat(stat, v, asUpgrade = true) {
    const [label, mode, sign, unit] = D.statDisplay[stat] || [stat.replace(/_/g, " "), "raw", "", ""];
    let n = v, pct = true;
    if (!asUpgrade || mode === "raw") { pct = false; }
    else if (mode === "pct") n = v * 100;
    else if (mode === "pct_minus1") n = (v - 1) * 100;
    else if (mode === "pct_one_minus") n = (1 - v) * 100;
    const r = Math.abs(n) >= 10 || Number.isInteger(n) ? Math.round(n * 10) / 10 : Math.round(n * 100) / 100;
    const s = pct ? (sign === "-" ? "−" : "+") : (sign === "+" && asUpgrade ? "+" : "");
    return { label, value: pct ? (sign === "-" ? -Math.abs(r) : Math.abs(r)) : r,
             text: `${s}${Math.abs(r).toLocaleString("en-GB")}${pct ? "%" : unit || ""}` };
  }

  // ---- Tech bonuses in one inventory, as the game computes them
  //  - A working tech (DamageFactor < 1) contributes each of its stats; procedural modules use their exact roll.
  //  - Supercharged slot: factor S = 1.25. Add/max stats v·S; multiply stats v·S (v/S when v < 1);
  //    type 3 v + (v − 1)·S above 1.
  //  - Adjacency: the four neighbours that are working tech of the same family (same BaseStat, or this one has none).
  //    n0 = neighbours sharing a stat group with this tech, unless one is the other's core; n1 = neighbours that are
  //    this module's core (one of its stat groups is a stat the neighbour has). Add stats (v > 0):
  //    v + v·0.06·n0 + v·0.05·n1; multiply stats (v > 1): v + v·0.04·n0 + v·0.03·n1.
  //  - Totals: add stats sum (from 0), multiply stats multiply (from 1), max stats take the largest.
  // Returns { cells: Map("x,y" -> { stats: [{ stat, base, value, sc, n0, n1 }] }), totals: Map(stat -> value) }.
  const F = Math.fround;
  const rule = stat => D.statRules[stat] || [stat, 0];
  function techOf(it) {
    if (!it || it.type !== "Technology" || !(it.damage < 1) || !it.data) return null;
    const d = it.data;
    let stats;
    if (d.k === "u") {
      if (it.seed == null || !window.ProcTech || (it.id || "").startsWith("CV_")) return null;
      stats = ProcTech.roll(d, Number(it.seed)).stats;
    } else stats = (d.s || []).map(([stat, value]) => ({ stat, value: F(value) }));
    return { base: d.b || null, stats };
  }
  const linked = (a, b) => a.stats.some(sa => b.stats.some(sb => rule(sa.stat)[0] === sb.stat));
  const shareGroup = (a, b) => a.stats.some(sa => b.stats.some(sb => rule(sa.stat)[0] === rule(sb.stat)[0]));

  // Groups with more than the allowed number of tech in this inventory.
  function overGroups(gr) {
    const n = new Map();
    for (const c of gr.cells) {
      const d = c.valid && c.item && c.item.type === "Technology" && c.item.data;
      if (d && d.g) n.set(d.g, (n.get(d.g) || 0) + 1);
    }
    return new Set([...n].filter(([, k]) => k > D.bonus.groupLimit).map(([g]) => g));
  }

  function techBonuses(gr, opts = {}) {
    const B = D.bonus, S = F(B.supercharge);
    const at = new Map(), cells = new Map(), totals = new Map();
    // More than groupLimit (3) tech of one Group in the inventory: none of that group works (checked in the
    // game: 4 shield upgrades leave only the core's 0.65 shield). They give and get no adjacency either.
    const over = overGroups(gr);
    for (const c of gr.cells) if (c.valid && c.item) {
      if (c.item.data && over.has(c.item.data.g)) { cells.set(c.x + "," + c.y, { stats: [], n0: 0, n1: 0, overLimit: true }); continue; }
      const t = techOf(c.item);
      if (t) at.set(c.x + "," + c.y, Object.assign(t, { x: c.x, y: c.y, sc: c.sc, order: c.item.order }));
    }
    const list = [...at.entries()].sort((a, b) => a[1].order - b[1].order);
    for (const [key, t] of list) {
      let n0 = 0, n1 = 0;
      if (!opts.noAdjacency) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const n = at.get((t.x + dx) + "," + (t.y + dy));
        if (!n || (t.base && t.base !== n.base)) continue;
        if (shareGroup(n, t) && !linked(n, t) && !linked(t, n)) n0++;
        if (linked(t, n)) n1++;
      }
      const out = [];
      for (const s of t.stats) {
        const kind = rule(s.stat)[1];
        let v = s.value;
        if (t.sc) {
          if (kind === 1) v = v < 1 ? F(v * F(1 / S)) : F(v * S);
          else if (kind === 3) v = v < 1 ? F(v * F(1 / S)) : v > 1 ? F(v + F(F(v - 1) * S)) : v;
          else v = F(v * S);
        }
        if (kind === 0 && v > 0) v = F(F(F(F(v * F(B.adjAdd[0])) * n0) + v) + F(F(v * F(B.adjAdd[1])) * n1));
        else if ((kind === 1 || kind === 3) && v > 1) v = F(F(F(F(v * F(B.adjMul[0])) * n0) + v) + F(F(v * F(B.adjMul[1])) * n1));
        out.push({ stat: s.stat, base: s.value, value: v, sc: t.sc, n0, n1 });
        const prev = totals.get(s.stat);
        totals.set(s.stat, prev === undefined ? (kind === 1 || kind === 3 ? F(1 * v) : kind === 2 ? v : F(0 + v))
          : kind === 1 || kind === 3 ? F(prev * v) : kind === 2 ? Math.max(prev, v) : F(prev + v));
      }
      cells.set(key, { stats: out, n0, n1 });
    }
    return { cells, totals };
  }

  window.Sheet = { compute, level, formatStat, techBonuses, rule, techOf, linked, shareGroup, overGroups };
})();
