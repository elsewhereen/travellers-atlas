"use strict";
/*
 * Resources: a planet's three mining substances and whether it has Salvageable Scrap, from its seed.
 * Exposes window.Resources. Ported from tools/planet_ressourcer.py (an independent re-implementation of the
 * algorithm; the tables are the game's numbers). Checked there against NMS Almanac: Uncommon 63/63, Rare 63/63,
 * Common 62/63; Extreme weather is wrong for about 2 in 91 planets.
 *
 *   Resources.compute({ seed, biome, star, startSystem, gasGiantSystem, startPlanet })
 *     -> { extreme, common, uncommon, rare, scrap, gas }   (names, e.g. "Copper"; gas = Atmosphere Harvester)
 *   seed: BigInt (or "0x…" string). biome: GcBiomeType index. star: 0 Yellow, 1 Green, 2 Blue, 3 Red, 4 Purple.
 */
(function () {
  const M32 = 0xFFFFFFFFn, M64 = (1n << 64n) - 1n, MWC = 0x5A76F899n;
  const f32 = Math.fround;

  const NAMES = {
    YELLOW2: "Copper", GREEN2: "Emeril", BLUE2: "Indium", RED2: "Cadmium", PURPLE2: "Quartzite",
    EX_YELLOW: "Activated Copper", EX_GREEN: "Activated Emeril", EX_BLUE: "Activated Indium",
    EX_RED: "Activated Cadmium", EX_PURPLE: "Activated Quartzite",
    LUSH1: "Paraffinium", TOXIC1: "Ammonia", HOT1: "Phosphorus", RADIO1: "Uranium", COLD1: "Dioxite",
    DUSTY1: "Pyrite", SPACEGUNK3: "Rusted Metal", ASTEROID2: "Gold", LAND3: "Magnetised Ferrite",
    PLANT_POOP: "Faecium", LAVA1: "Basalt", WATERWORLD1: "Lithium", GASGIANT1: "Crystallised Helium",
    GAS1: "Sulphurine", GAS2: "Radon", GAS3: "Nitrogen", GAS4: "Methane", OXYGEN: "Oxygen",
    CATALYST1: "Sodium", CAVE1: "Cobalt", WATER1: "Salt", ASTEROID1: "Silver",
  };
  // gcterrainglobals (stars in GcGalaxyStarTypes order, biomes in GcBiomeType order)
  const STAR_SUB = ["YELLOW2", "GREEN2", "BLUE2", "RED2", "PURPLE2"];
  const STAR_SUB_EXTREME = ["EX_YELLOW", "EX_GREEN", "EX_BLUE", "EX_RED", "EX_PURPLE"];
  const BIOME_SUB = ["LUSH1", "TOXIC1", "HOT1", "RADIO1", "COLD1", "DUSTY1", "SPACEGUNK3", "ASTEROID2", "HOT1",
                     "TOXIC1", "COLD1", "LAND3", "PLANT_POOP", "LAVA1", "WATERWORLD1", "GASGIANT1", "GAS1"];
  const RARE_SUB = ["CATALYST1", "LAND3", "CAVE1", "WATER1", "ASTEROID1"];
  // Atmosphere Harvester (gasharvester.entity): by biome; Dead/Test/All give nothing
  const HARVEST_GAS = ["GAS3", "GAS3", "GAS1", "GAS2", "GAS2", "GAS1", null, "OXYGEN", "GAS1", "GAS2", "GAS3", null,
                       "GAS3", "GAS1", "OXYGEN", "GAS4", null];
  // gcsolargenerationglobals
  const EXTREME_CHANCE = [0.2, 0.2, 0.6, 0.25, 0.33];
  const LUSH = 0, BARREN = 5, DEAD = 6, WEIRD = 7, SWAMP = 12, LAVA = 13, WATERWORLD = 14, GASGIANT = 15, ALL = 16;

  function fmix64(x) {
    x ^= x >> 33n; x = (x * 0x64DD81482CBD31D7n) & M64;
    x ^= x >> 33n; x = (x * 0xE36AA5C613612997n) & M64;
    return x ^ (x >> 33n);
  }

  // The game's random numbers: multiply-with-carry, seeded with the "ror init" from a 64-bit seed.
  class Rng {
    constructor(seed) {
      const lo = seed & M32, hi = seed >> 32n;
      this.s0 = (lo + (lo === 0n ? 1n : 0n)) & M32;
      this.s1 = ((((lo >> 16n) | (lo << 16n)) & M32) ^ hi ^ lo);
    }
    next() {
      const t = this.s0 * MWC + this.s1;
      this.s0 = t & M32; this.s1 = t >> 32n;
      return this.s0;
    }
    unit() { return f32(Number(this.next()) * 2 ** -32); }
  }

  function subseed(seed, k) {
    const r = new Rng(seed);
    let a, b;
    for (let i = 0; i <= k; i++) { a = r.next(); b = r.next(); }
    return fmix64((b << 32n) | a);
  }

  // The draw from sub-seed 0 that decides a scrap world (and, in a dissonant system, a dissonant planet).
  function scrapRoll(seed, biome, startPlanet) {
    const r = new Rng(subseed(seed, 0));
    if (!startPlanet && biome !== DEAD && biome !== WATERWORLD && biome !== GASGIANT) { r.next(); r.next(); }
    r.next();   // ResourceLevel
    return r.unit();
  }

  function compute({ seed, biome, star, startSystem = false, gasGiantSystem = false, startPlanet = false }) {
    seed = typeof seed === "bigint" ? seed : BigInt(seed);
    let r = new Rng(subseed(seed, 12));
    r.next();   // weather type
    let extreme = f32(EXTREME_CHANCE[star]) > r.unit();
    if (startSystem || (gasGiantSystem && biome !== GASGIANT) || biome === DEAD || biome === WEIRD) extreme = false;
    if (biome === GASGIANT) extreme = true;

    r = new Rng(subseed(seed, 19));
    const rare = RARE_SUB[Number((r.next() * BigInt(RARE_SUB.length)) >> 32n)];
    const u = r.unit();
    let unc;
    if (biome === LAVA) unc = BIOME_SUB[u < f32(0.33) ? LAVA : BARREN];
    else if (biome === SWAMP) unc = BIOME_SUB[u < f32(0.15) ? SWAMP : u < f32(0.33) ? ALL : u < f32(0.66) ? LUSH : SWAMP];
    else unc = BIOME_SUB[biome];
    const common = (extreme ? STAR_SUB_EXTREME : STAR_SUB)[star];
    // Infested planets never have scrap, but that subtype isn't in the save, so this can say yes for them.
    const scrap = biome !== DEAD && biome !== WEIRD && biome !== WATERWORLD && biome !== GASGIANT &&
                  scrapRoll(seed, biome, startPlanet) <= f32(0.2);
    const gas = HARVEST_GAS[biome];
    const n = id => (id ? NAMES[id] || id : null);
    return { extreme, common: n(common), uncommon: n(unc), rare: n(rare), scrap, gas: n(gas) };
  }

  // What can be said without the biome (planets not visited): the rare substance is exact; the common one is the
  // star's metal, Activated if the weather roll says Extreme (wrong only for Dead/Exotic/Gas Giant planets);
  // scrap assumes an ordinary living planet (Dead, Exotic, Waterworld, Gas Giant and Infested never have it).
  function partial({ seed, star, startSystem = false, gasGiantSystem = false }) {
    seed = typeof seed === "bigint" ? seed : BigInt(seed);
    let r = new Rng(subseed(seed, 12));
    r.next();
    const extreme = !startSystem && !gasGiantSystem && f32(EXTREME_CHANCE[star]) > r.unit();
    r = new Rng(subseed(seed, 19));
    const rare = RARE_SUB[Number((r.next() * BigInt(RARE_SUB.length)) >> 32n)];
    const scrapLikely = scrapRoll(seed, LUSH, false) <= f32(0.2);
    return { extreme, common: NAMES[(extreme ? STAR_SUB_EXTREME : STAR_SUB)[star]], rare: NAMES[rare], scrapLikely };
  }

  window.Resources = { compute, partial };
})();
