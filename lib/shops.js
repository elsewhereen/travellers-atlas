/* Shop contents from a shop seed: a port of the game's trade generator (validated against the game itself).
 *
 * Shops.generate(seed, { kind, trading, wealth, pirate, gameMode }) → array of item ids.
 *   seed     BigInt, already fmix64'ed (Station.shopSeed)
 *   kind     "SpaceStation" (station trade terminal), "Shop" (planet/settlement market), "PirateShop" (black market)
 *   trading  economy class 0..6 (sysgen order), wealth 0..2 (pirate systems use 3)
 * Every drawn item costs one MWC step (its amount); only the draw count matters for the item list.
 */
(function (root) {
  const D = typeof module !== "undefined" && module.exports ? require("./shopdata.js") : root.ShopData;
  const MWC = 0x5A76F899, P32 = 4294967296;

  class Rng {                                     // MWC in plain Numbers (exact: every intermediate stays below 2^53)
    constructor(seed) {
      const lo = Number(seed & 0xFFFFFFFFn), hi = Number((seed >> 32n) & 0xFFFFFFFFn);
      this.s0 = lo === 0 ? 1 : lo;
      this.s1 = ((((lo >>> 16) | (lo << 16)) ^ hi ^ lo) >>> 0);
    }
    step() {
      const a = this.s0, pl = (a % 65536) * MWC, ph = Math.floor(a / 65536) * MWC;
      const low = (ph % 65536) * 65536 + pl + this.s1;
      this.s0 = low % P32;
      this.s1 = Math.floor(ph / 65536) + Math.floor(low / P32);
      return this.s0;
    }
    range(n) { return Math.floor(this.step() * n / P32); }                 // (u32 · n) >> 32, n small
    skip(n) { for (let i = 0; i < n; i++) this.step(); }
  }

  function shuffled(rng, n) {                     // Fisher–Yates from the back, j in [0, i]
    const a = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) { const j = rng.range(i + 1); const t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  const NEVER = new Set(D.neverOffered), NOTSOLD = new Set(D.notSold);
  const f32 = Math.fround;

  function generate(seed, opt) {
    const T = D.trade[opt.kind];
    const wealth = opt.pirate ? 3 : opt.wealth;
    const banned = new Set(opt.modeList || D.modeList);   // depends on the save's game-mode settings
    const sellable = id => !NOTSOLD.has(id) && !banned.has(id);
    const rng = new Rng(seed);
    const shop = [], inShop = new Set();
    const add = id => { shop.push(id); inShop.add(id); };

    const count = T.minItems + rng.range(T.maxItems - T.minItems + 1);
    const nP = T.alwaysProducts.length + T.optionalProducts.length;
    const nS = T.alwaysSubstances.length + T.optionalSubstances.length;
    const r10 = Math.min(nP, count);
    let prods = Math.min(Math.max(0, Math.trunc(f32(count * T.productPct))), r10);
    let subs = Math.min(Math.max(0, count - prods), nS);

    for (const id of T.alwaysProducts) {
      if (!D.productInfo[id]) continue;
      rng.step();
      prods--;
      if (NEVER.has(id) || !sellable(id) || inShop.has(id)) continue;
      add(id);
    }
    for (const id of T.alwaysSubstances) {
      if (!D.substanceExists[id]) continue;
      rng.step();
      subs--;
      if (NEVER.has(id) || !sellable(id) || inShop.has(id)) continue;
      add(id);
    }
    const op = shuffled(rng, T.optionalProducts.length);
    for (let k = 0; k < prods && k < op.length; k++) {
      const id = T.optionalProducts[op[k]];
      if (!D.productInfo[id] || inShop.has(id)) continue;
      rng.step();
      if (D.productInfo[id][0] === 8 || NEVER.has(id) || !sellable(id)) continue;
      add(id);
    }
    const flagged = opt.kind === "SpaceStation" || opt.kind === "Shop" || opt.kind === "PirateShop";
    if (flagged && opt.pirate) {                   // stolen goods in pirate systems
      const pg = shuffled(rng, D.pirateGoods.length);
      const n = T.minExtra[wealth] + rng.range(T.maxExtra[wealth] - T.minExtra[wealth] + 1);
      for (let k = 0; k < n && k < pg.length; k++) {
        const id = D.pirateGoods[pg[k]];
        if (!D.productInfo[id] || inShop.has(id)) continue;
        rng.step();
        add(id);
      }
    }
    // Local trade goods: one draw per table product not yet in the shop; the first `tiers` of the economy's category.
    let tiers = 0;
    if (flagged && !opt.pirate) tiers = T.minExtra[wealth] + rng.range(T.maxExtra[wealth] - T.minExtra[wealth] + 1);
    let draws = D.tableSize;
    for (const id of inShop) draws -= D.mult[id] || 0;
    const cat = D.sells[opt.trading];
    for (const id of D.tradeGoods[cat] || []) {
      if (tiers <= 0) break;
      if (inShop.has(id) || !sellable(id)) continue;
      add(id); tiers--;
      draws -= (D.mult[id] || 1) - 1;
    }
    rng.skip(draws);
    const os = shuffled(rng, T.optionalSubstances.length);
    for (let k = 0; k < subs && k < os.length; k++) {
      const id = T.optionalSubstances[os[k]];
      if (!D.substanceExists[id] || inShop.has(id)) continue;
      rng.step();
      if (NEVER.has(id) || !sellable(id)) continue;
      add(id);
    }
    return shop;
  }

  // The station's trade terminal from the address alone: system data (lib/sysgen.js) → station placement and the
  // terminal's seed (lib/station.js) → generate. Null for abandoned systems (no traders). Item ids; D.names has names.
  const node = typeof module !== "undefined" && module.exports;
  const SysGen = node ? require("./sysgen.js") : root.SysGen, Station = node ? require("./station.js") : root.Station;
  // All the station's shops: { pirate, terminal: {kind, items}, suit, weapon, ship, vehicle } (a pirate station has
  // a black market and one PirateTech merchant, given as `salvage`). The tech merchants stand at fixed places in the
  // station (LAYOUT.normal.techShops: suit, multi-tool, exocraft, starship); their stock comes from the same generator.
  const TECH = [["suit", "SuitTech"], ["weapon", "WeaponTech"], ["vehicle", "VehicleTech"], ["ship", "ShipTech"]];
  function station(x, y, z, index, galaxy = 0) {
    const desc = SysGen.systemDescriptor(x, y, z, index, galaxy);
    if (desc.abandoned) return null;
    const sb = SysGen.systemBodies(x, y, z, index, galaxy);
    const ua = (BigInt(index & 0xFFF) << 40n) | (BigInt(galaxy & 0xFF) << 32n) | (BigInt(y & 0xFF) << 24n) |
               (BigInt(z & 0xFFF) << 12n) | BigInt(x & 0xFFF);
    const pos = Station.planetPositions(ua, sb.bodies, sb.planets);
    const m = Station.matrix(Station.spawn(ua, sb.bodies.map((b, i) => ({ pos: pos[i], cls: b.cls }))));
    const pirate = desc.pirate, L = pirate ? Station.LAYOUT.pirate : Station.LAYOUT.normal;
    const opt = { trading: desc.d[0], wealth: desc.d[1], pirate };
    const shop = (kind, local) => ({ kind, items: generate(Station.shopSeed(m, local), { ...opt, kind }) });
    const out = { pirate, terminal: shop(pirate ? "PirateShop" : "SpaceStation", L.shop) };
    if (pirate) out.salvage = shop("PirateTech", L.techShops[0]);
    else {
      TECH.forEach(([k, kind], i) => { out[k] = shop(kind, L.techShops[i]); });
      out.envoy = envoy(ua);
    }
    return out;
  }
  // Guild envoy: the system seed (= the address) picks the guild, 3 + range(3), and a
  // fresh generator from the same seed picks one item per slot (ProductID or one of its AltIDs). Slot k needs the
  // guild standing in repLevels. Pirate stations have no envoy.
  const GUILDS = { 3: ["TradeGuild", "Merchants"], 4: ["WarriorGuild", "Mercenaries"], 5: ["ExplorerGuild", "Explorers"] };
  function envoy(ua) {
    const [key, guild] = GUILDS[3 + new Rng(ua).range(3)];
    const rng = new Rng(ua);
    const items = D.repShops[key].map(c => c[rng.range(c.length)]);
    return { kind: "GuildEnvoy", guild, items, levels: D.repLevels[key] };
  }
  const terminal = (x, y, z, index, galaxy = 0) => { const s = station(x, y, z, index, galaxy); return s && s.terminal; };
  // Display label: "B Shield", "C-Class Reactor", or the plain name.
  const label = id => {
    const n = (D.names[id] || id).replace(/ Module$/, ""), g = D.grade[id];
    return g && !id.startsWith("SHIP_CORE_") ? `${g} ${n}` : n;
  };
  const name = id => D.names[id] || id;
  // Everything a terminal of this kind can ever offer (for the filter's checkboxes), as ids.
  function possible(kind) {
    const T = D.trade[kind], banned = new Set(D.modeList);
    const ok = id => !NEVER.has(id) && !NOTSOLD.has(id) && !banned.has(id);
    const products = [...T.alwaysProducts, ...T.optionalProducts].filter(id => D.productInfo[id] && ok(id));
    const substances = [...T.alwaysSubstances, ...T.optionalSubstances].filter(id => D.substanceExists[id] && ok(id));
    if (kind === "PirateShop") products.push(...D.pirateGoods.filter(id => D.productInfo[id]));
    return { products: [...new Set(products)], substances: [...new Set(substances)] };
  }

  // Everything a guild envoy can offer, as ids.
  const envoyPossible = () => [...new Set(Object.values(D.repShops).flat(2))];
  const Shops = { generate, station, terminal, possible, envoyPossible, GUILDS, name, label, Rng };
  if (typeof module !== "undefined" && module.exports) module.exports = Shops; else root.Shops = Shops;
})(typeof window !== "undefined" ? window : globalThis);
