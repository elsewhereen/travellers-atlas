"use strict";
/*
 * SystemView: one solar system, in the spirit of the game's system view. Exposes window.SystemView.
 * The space station in the middle, each planet on its own orbit (the game's order and directions, from
 * Station.planetPositions) with its moons around it. Each body's name under it; hover a body for its card.
 * Nothing above the bodies: in the game's view those markers are deep-space signals (not shown yet).
 * Needs THREE, OrbitControls, CSS2DRenderer (loaded with the map), Card, Atlas, SysGen, Station.
 *
 *   SystemView.show(system, data)   system from Atlas.build (or a nearby one); switches to the "system" view
 *   SystemView.close()              back to the galaxy map
 *
 * Opened from the map's system card (G, "Go to system"), which sends "map:open-system".
 * Planets have no textures yet: a procedural surface coloured by biome, seeded by the planet's seed.
 */
(function () {
  const STAR_COLOURS = { Yellow: "#ffcf6e", Red: "#ff7a5c", Green: "#7dffa8", Blue: "#9cc8ff", Purple: "#c79cff" };
  const starColour = s => STAR_COLOURS[s.star] || "#efe6cf";
  const nf = new Intl.NumberFormat("en-GB");

  // Surface colours per biome: [low ground, high ground]. Unknown biome: grey.
  const BIOME_COLOURS = {
    Lush: ["#2f6b3a", "#9cc65e"], Toxic: ["#5e5f1a", "#cfc85a"], Scorched: ["#6e2f16", "#e28a48"],
    Irradiated: ["#2f5a22", "#cfee6a"], Frozen: ["#93aac0", "#f4f8ff"], Barren: ["#6e5a40", "#d2b88c"],
    Dead: ["#3e3e44", "#9a9aa2"], Exotic: ["#4e2a70", "#d890e6"], "Exotic (red)": ["#5e1a26", "#e86470"],
    "Exotic (green)": ["#1a5e42", "#6ae6b4"], "Exotic (blue)": ["#1a3470", "#6aaae6"], Swamp: ["#24402a", "#7a9a52"],
    Volcanic: ["#221614", "#d0462a"], Waterworld: ["#0f3566", "#4fa2d8"], "Gas Giant": ["#5e507e", "#e0c8a4"],
  };
  const UNKNOWN = ["#3a3d48", "#7a7f8c"];
  const coloursOf = p => BIOME_COLOURS[p.biome] || UNKNOWN;

  // The galaxy map's system view, from the game's gcgalaxyglobals (SolarSystemParameters, Camera): body radii,
  // orbits (first orbit, then a step per orbit, each a range), the system's tilt and the camera's field of view.
  // The game also turns the orbits (1–2.5 planets, 2–5 moons); here they stand still, to spare the GPU.
  // Body sizes: the proportions of the game's PlanetScales (gcuiglobals SolarSystemMapSettings: 0.6, 0.5, 0.4, 0.15,
  // 0.8), which fit screenshots of the view far better than SolarSystemParameters.PlanetRadii (14, 10, 6, 3, 24),
  // times SIZE, read from the same screenshots.
  const SIZE = 35;
  const RADIUS = { Large: 0.6 * SIZE, Medium: 0.5 * SIZE, Small: 0.4 * SIZE, Moon: 0.15 * SIZE, Giant: 0.8 * SIZE };
  const radiusOf = p => (p.biome === "Gas Giant" ? RADIUS.Giant : RADIUS[p.size] || 10);
  const PLANET_ORBIT = { first: [120, 160], step: [50, 70] }, MOON_ORBIT = { first: [15, 20], step: [15, 35] };
  const SYSTEM_TILT = 15, CAMERA_FOV = 90, NON_VISITED_ALPHA = 0.4;
  // Not from the game's data, read from screenshots of its view. The rings are a fixed frame (the same in every
  // system; they are not orbits): FRAME is the bright ring's radius in the same units as the orbits and radii above,
  // and the other rings are fractions of it. Planets lie on top of that, some beyond the bright ring. LIFT: each
  // body rests just above the plane (times its radius).
  const FRAME = 300, LIFT = 1.15, MAX_REACH = 1.25;
  const FRAME_THIN = [0.24, 0.4, 0.53, 0.66], FRAME_ARC = 0.8, FRAME_DASHED = 1.2;

  let current = null;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // ---- Seeded noise for the planets' surfaces
  const seed32 = p => (p.seed != null ? Number(BigInt.asUintN(32, BigInt(p.seed))) : (p.index * 2654435761) >>> 0);
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
  // Value noise on a lattice that wraps in x, so the texture has no seam around the sphere.
  function noise2(seed, cells) {
    const r = rng(seed), W = cells * 2, H = cells, g = new Float32Array(W * (H + 1));
    for (let i = 0; i < g.length; i++) g[i] = r();
    const s = t => t * t * (3 - 2 * t);
    return (u, v) => {   // u, v in 0..1
      const x = u * W, y = v * H, x0 = Math.floor(x), y0 = Math.min(H - 1, Math.floor(y));
      const fx = s(x - x0), fy = s(y - y0), xa = x0 % W, xb = (x0 + 1) % W;
      const a = g[y0 * W + xa], b = g[y0 * W + xb], c = g[(y0 + 1) * W + xa], d = g[(y0 + 1) * W + xb];
      return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
    };
  }
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

  function surface(p) {
    const W = 256, H = 128, c = document.createElement("canvas");
    c.width = W; c.height = H;
    const x = c.getContext("2d"), img = x.createImageData(W, H), d = img.data;
    const sd = seed32(p), [lo, hi] = coloursOf(p).map(hex);
    const oct = [noise2(sd, 3), noise2(sd ^ 0x9E37, 6), noise2(sd ^ 0x85EB, 12), noise2(sd ^ 0xC2B2, 24)];
    const fbm = (u, v) => oct[0](u, v) * 0.5 + oct[1](u, v) * 0.27 + oct[2](u, v) * 0.15 + oct[3](u, v) * 0.08;
    const gas = p.biome === "Gas Giant";
    for (let j = 0; j < H; j++) {
      const v = j / H;
      for (let i = 0; i < W; i++) {
        const u = i / W;
        let t;
        if (gas) t = 0.5 + 0.5 * Math.sin(v * 26 + fbm(u, v) * 5);                 // bands
        else { t = fbm(u, v); t = Math.min(1, Math.max(0, (t - 0.3) / 0.45)); }   // land patches
        const pole = Math.abs(v - 0.5) * 2;
        const ice = !gas && p.biome !== "Scorched" && p.biome !== "Volcanic" && pole > 0.86 ? (pole - 0.86) / 0.14 : 0;
        const k = (j * W + i) * 4;
        for (let ch = 0; ch < 3; ch++) {
          const col = lo[ch] + (hi[ch] - lo[ch]) * t;
          d[k + ch] = col + (235 - col) * ice * 0.7;
        }
        d[k + 3] = 255;
      }
    }
    x.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    return tex;
  }

  function glowTex(stops) {
    const c = document.createElement("canvas"); c.width = c.height = 256;
    const x = c.getContext("2d"), g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
    for (const [t, a] of stops) g.addColorStop(t, `rgba(255,255,255,${a})`);
    x.fillStyle = g; x.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(c);
  }

  // ---- Layout from the game's own positions (lib/station.js, the same code the station search uses).
  // The station sits at the system's origin (only lifted 5,000–10,000 u), so it is the middle, as in the game's view.
  // Each planet keeps its direction from there and its place in the order of distance; the distances themselves
  // are squeezed into even orbits, as the game's view does, or the outer planets would be specks. Moons keep their
  // direction from their planet. The star has no place in these coordinates: it is the light and the colour.
  function gamePositions(s) {
    try {
      const [x, y, z] = s.region, g = s.addr ? s.addr.galaxy || 0 : 0;
      const sb = SysGen.systemBodies(x, y, z, s.index, g);
      const ua = (BigInt(s.index & 0xFFF) << 40n) | (BigInt(g & 0xFF) << 32n) | (BigInt(y & 0xFF) << 24n) |
                 (BigInt(z & 0xFFF) << 12n) | BigInt(x & 0xFFF);
      return Station.planetPositions(ua, sb.bodies, sb.planets);   // [[x, y, z]] per body, index - 1
    } catch (e) { console.warn("planet positions", s.key, e); return []; }
  }
  function layout(s) {
    const real = gamePositions(s);
    const planets = [], moons = [];
    const known = new Set(s.planets.map(p => p.index));
    for (const p of s.planets) (p.parent != null && known.has(p.parent) ? moons : planets).push(p);
    const at = p => real[p.index - 1];
    // Nearest first; bodies without a position (beyond the generator's list) last.
    const far = p => (at(p) ? Math.hypot(at(p)[0], at(p)[2]) : Infinity);
    planets.sort((a, b) => far(a) - far(b) || a.index - b.index);
    const hasStation = !!(s.station || s.race || s.abandoned);
    const bodies = [];
    // Orbit sizes: the game's ranges, picked with a generator seeded by the system (the same every time).
    const rnd = rng(seed32(s.planets[0] || { index: s.index }) ^ s.index);
    const pickIn = ([lo, hi]) => lo + (hi - lo) * rnd();
    let r = 0;
    planets.forEach((p, i) => {
      const mine = moons.filter(m => m.parent === p.index);
      r += pickIn(i ? PLANET_ORBIT.step : PLANET_ORBIT.first);
      const q = at(p), a = q ? Math.atan2(q[2], q[0]) : i * 2.399963;
      const pos = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
      bodies.push({ p, pos, orbit: r, radius: radiusOf(p), real: q });
      let mr = 0;
      mine.forEach((m, k) => {
        const mq = at(m);
        mr += pickIn(k ? MOON_ORBIT.step : MOON_ORBIT.first);
        let ma = a + 1.2 + k * 2.3;
        if (mq && q && Math.hypot(mq[0] - q[0], mq[2] - q[2]) > 1) ma = Math.atan2(mq[2] - q[2], mq[0] - q[0]);
        const mpos = pos.clone().add(new THREE.Vector3(Math.cos(ma) * mr, 0, Math.sin(ma) * mr));
        bodies.push({ p: m, pos: mpos, orbit: mr, centre: pos.clone(), radius: radiusOf(m), moonOf: p, real: mq });
      });
    });
    // Many planets: the raw orbits reach far past the frame (six give about 1.5 × FRAME) and the outermost ends up
    // right in front of the camera. The game's screenshots never go past about 1.2, so squeeze the orbits to fit.
    const squeeze = r > FRAME * MAX_REACH ? FRAME * MAX_REACH / r : 1;
    if (squeeze < 1) for (const b of bodies) {
      if (b.centre) { const off = b.pos.clone().sub(b.centre); b.centre.multiplyScalar(squeeze); b.pos.copy(b.centre).add(off); }
      else { b.pos.multiplyScalar(squeeze); b.orbit *= squeeze; }
    }
    r = Math.min(r, FRAME * MAX_REACH);
    // Each body rests just above the plane, as in the game's view, so the rings pass under it and not through it.
    const station = hasStation ? { pos: new THREE.Vector3(), radius: 10 } : null;
    for (const b of station ? [...bodies, station] : bodies) b.pos.y += b.radius * LIFT;
    return { bodies, outer: r, station };
  }

  // ---- Cards
  function planetCard(b, s) {
    const p = b.p, r = p.resources || {}, items = [];
    const isMoon = !!b.moonOf;
    if (isMoon) items.push({ icon: "star", label: `Moon of ${b.moonOf.name}` });
    if (p.dissonant) items.push({ icon: "sentinel", label: "Dissonant · corrupted sentinels", tone: "danger" });
    else if (p.sentinels) items.push({ icon: "sentinel", label: `Sentinels: ${p.sentinels}`,
                                       tone: p.sentinels === "aggressive" ? "danger" : null });
    if (p.calmed) items.push({ icon: "sentinel", tone: "uncommon",
                               label: `Calm here: ${p.calmed.dissonant ? "dissonant" : p.calmed.sentinels} in the generator` });
    if (r.extreme) items.push({ icon: "warning", label: "Extreme weather", tone: "danger" });
    for (const o of Atlas.planetOffers(p)) {
      if (o.how === "dissonance") continue;
      if (o.how === "plant") items.push({ icon: "plant", label: o.name, tone: "plant" });
      else if (o.how === "harvester") items.push({ icon: "gas", label: `${o.name} (Atmosphere Harvester)` });
      else if (o.how === "scrap") items.push({ icon: "ship", label: o.name, tone: "special" });
      else items.push({ icon: "element", label: o.name, tone: o.how });
    }
    if (r.partial) items.push({ icon: "warning", label: "Biome unknown: visit it for the rest" });
    if (p.discovered) items.push({ icon: "signal", label: "Discovered" });
    const kind = [p.size && p.size !== "Moon" ? p.size : null, p.biome || "Unknown", isMoon ? "moon" : "planet"].filter(Boolean).join(" ");
    const card = Card.create({
      title: p.name, subtitle: p.name !== p.originalName && p.originalName ? p.originalName : s.name,
      kind, items, onClose: false, tint: false,
    });
    tintHead(card, coloursOf(p)[1]);
    return card;
  }
  function stationCard(s) {
    const items = [];
    if (s.race) items.push({ icon: "element", label: `${s.race} · ${s.economy} · ${s.wealth} wealth`, tone: "uncommon" });
    else items.push({ icon: "element", label: s.abandoned ? "Abandoned" : "Uninhabited" });
    if (s.conflict) items.push({ icon: "warning", label: `${s.conflict} conflict`, tone: s.conflict === "High" ? "danger" : null });
    if (s.pirate) items.push({ icon: "warning", label: "Pirate system", tone: "danger" });
    if (s.station) items.push({ icon: "signal", label: "Docked: a teleport destination", tone: "special" });
    const card = Card.create({ title: s.station || "Space Station", subtitle: s.name, kind: "Space station", items, onClose: false, tint: false });
    tintHead(card, "#e8c66a");
    return card;
  }
  function tintHead(card, hexCol, share = 0.34) {
    const c = hex(hexCol), ground = [16, 17, 28];
    const m = c.map((v, i) => Math.round(v * share + ground[i] * (1 - share)));
    card.style.setProperty("--card-head", `rgba(${m.join(",")}, 0.9)`);
    card.style.setProperty("--card-head-edge", `rgba(${c.join(",")}, 0.55)`);
  }

  // ---- The view
  function show(s, data) {
    if (!s) return;
    if (current) current.stop();
    document.body.dataset.view = "system";
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

    const root = el("section", "sysv");
    root.setAttribute("aria-label", `${s.name} system`);
    const sceneEl = el("div", "sysv__scene"), labelsEl = el("div", "sysv__labels");

    // Title, top centre, as in the game.
    const head = el("header", "sysv__head");
    head.append(el("h2", "sysv__title", `The ${s.name} System`));
    head.append(el("div", "sysv__sub", `${data.galaxy.name} Galaxy :: ${nf.format(s.coreLy)} ly from galactic core`));
    const facts = [s.star ? `${s.star} star` : null,
      s.race ? `${s.race} · ${s.economy} · ${s.wealth} wealth · ${s.conflict} conflict` : s.abandoned ? "Abandoned" : "Uninhabited",
      s.pirate ? "Pirate system" : null, s.blackHole ? "Black hole" : null,
      s.key === data.current ? "You are here" : null].filter(Boolean);
    head.append(el("div", "sysv__facts", facts.join(" · ")));

    // Back to the galaxy map, top left.
    const nav = el("nav", "sysv__nav");
    const back = el("button", "sysv__btn sysv__btn--back");
    back.type = "button"; back.title = "Back to the galaxy map (Esc)";
    back.append(el("span", "sysv__chev", "‹"), el("span", null, "Galaxy map"), el("kbd", null, "Esc"));
    back.addEventListener("click", close);
    const whole = el("button", "sysv__btn");
    whole.type = "button"; whole.title = "See the whole system (Home, or double-click)";
    whole.append(el("span", null, "Whole system"), el("kbd", null, "Home"));
    whole.addEventListener("click", () => overview());
    nav.append(back, whole);

    const hover = el("div", "sysv__hover");
    root.append(sceneEl, labelsEl, head, nav, hover);
    document.body.append(root);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    sceneEl.append(renderer.domElement);
    const labelRenderer = new THREE.CSS2DRenderer({ element: labelsEl });
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.5, 40000);
    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !reduced;
    controls.maxPolarAngle = Math.PI * 0.49;   // stay above the plane, as in the game
    controls.minDistance = 25;
    let needsRender = true;
    const invalidate = () => { needsRender = true; };
    controls.addEventListener("change", invalidate);

    const disposables = [];
    const keep = x => { disposables.push(x); return x; };
    const L = layout(s);
    controls.maxDistance = FRAME * 12;

    // The star: its light from one side, in its colour, and a faint haze in the middle.
    const sc = new THREE.Color(starColour(s));
    const sun = new THREE.DirectionalLight(sc.clone().lerp(new THREE.Color(0xffffff), 0.55), 1.4);
    sun.position.set(-1, 0.5, 0.6); scene.add(sun);
    scene.add(new THREE.AmbientLight(0x8890b0, 0.3));
    const glow = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: keep(glowTex([[0, 0.35], [0.2, 0.12], [0.5, 0.03], [1, 0]])), color: sc, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));
    glow.scale.setScalar(90); scene.add(glow);

    // The frame, flat in the plane: thin rings inside, a broken rust-coloured band, the bright ring, a dashed band
    // outside, and a line across the middle. Fixed size; it says nothing about the orbits.
    const flat = (inner, outer, color, opacity, from = 0, len = Math.PI * 2, additive = false) => {
      const m = new THREE.Mesh(keep(new THREE.RingGeometry(FRAME * inner, FRAME * outer, Math.max(8, Math.round(len * 40)), 1, from, len)),
        keep(new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false,
                                           blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending })));
      m.rotation.x = -Math.PI / 2; scene.add(m);
    };
    const line = (pts, color, opacity) => {
      const g = keep(new THREE.BufferGeometry().setFromPoints(pts));
      scene.add(new THREE.LineSegments(g, keep(new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }))));
    };
    const circle = (r, color, opacity) => {
      const pts = [];
      for (let i = 0; i < 160; i++) for (const k of [i, i + 1]) {
        const a = k / 160 * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
      }
      line(pts, color, opacity);
    };
    FRAME_THIN.forEach((f, i) => circle(FRAME * f, 0xcfd6ea, i ? 0.2 : 0.4));
    const deg = d => d * Math.PI / 180;
    for (const [a, b] of [[8, 150], [162, 250], [262, 352]]) flat(FRAME_ARC - 0.005, FRAME_ARC + 0.005, 0xa0583a, 0.5, deg(a), deg(b - a));
    flat(0.9975, 1.0025, 0xffffff, 0.75);                         // the bright ring
    flat(0.99, 1.01, 0xffffff, 0.08, 0, Math.PI * 2, true);    // its glow
    for (let a = 0; a < 360; a += 3) flat(FRAME_DASHED - 0.008, FRAME_DASHED + 0.008, 0xcfd6ea, 0.2, deg(a), deg(1.6));
    const X = f => new THREE.Vector3(FRAME * f, 0, 0);
    line([X(-FRAME_ARC), X(-FRAME_THIN[0]), X(FRAME_THIN[0]), X(FRAME_ARC)], 0xa0583a, 0.4);

    // Bodies, each with its name under it. No markers above them: in the game those are deep-space signals.
    const meshes = [], labels = new Map();
    const faint = p => !data.save.manual && !p.discovered;
    function addLabel(target, name, cls) {
      const l = el("div", "sysv-lbl " + cls);
      l.append(el("span", "sysv-lbl__t", name));
      l.addEventListener("pointerenter", () => hoverOn(target));
      l.addEventListener("pointerleave", () => hoverOn(null));
      const o = new THREE.CSS2DObject(l);
      o.position.copy(target.pos).sub(new THREE.Vector3(0, target.radius, 0));   // under the body
      scene.add(o);
      labels.set(target, l);
    }
    for (const b of L.bodies) {
      const tex = keep(surface(b.p));
      const mesh = new THREE.Mesh(keep(new THREE.SphereGeometry(b.radius, 48, 24)),
                                  keep(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, metalness: 0,
                                    // Not visited: faint, as in the game (only known from a save).
                                    ...(faint(b.p) ? { transparent: true, opacity: NON_VISITED_ALPHA } : {}) })));
      mesh.position.copy(b.pos);
      mesh.rotation.set(0.35, seed32(b.p) % 628 / 100, 0.1);
      mesh.userData = b;
      scene.add(mesh); meshes.push(mesh);
      if (b.p.biome === "Gas Giant") {
        const rg = keep(new THREE.RingGeometry(b.radius * 1.45, b.radius * 2.1, 64));
        const rm = new THREE.Mesh(rg, keep(new THREE.MeshBasicMaterial({ color: coloursOf(b.p)[1], transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false })));
        rm.rotation.x = -Math.PI / 2 + 0.35; rm.position.copy(b.pos); scene.add(rm);
      }
      addLabel(b, b.p.name, (b.centre ? "sysv-lbl--moon" : "") + (b.p.dissonant ? " sysv-lbl--danger" : ""));
    }
    if (L.station) {
      const st = L.station;
      const g = keep(new THREE.OctahedronGeometry(L.station.radius, 0));
      const m = new THREE.Mesh(g, keep(new THREE.MeshStandardMaterial({ color: 0xd9b45a, metalness: 0.7, roughness: 0.35, emissive: 0x3a2a08 })));
      m.scale.set(1, 1.35, 1); m.position.copy(st.pos); m.rotation.y = 0.6;
      st.station = true; m.userData = st;
      scene.add(m); meshes.push(m);
      addLabel(st, s.station || "Space Station", "sysv-lbl--station");
    }

    // Hover card: next to the body on the side with room; stays while the pointer is on the card.
    let cardFor = null, cardEl = null, hideTimer = 0;
    const v3 = new THREE.Vector3();
    function placeCard() {
      if (!cardEl || !cardFor) return;
      v3.copy(cardFor.pos).project(camera);
      if (v3.z > 1) { cardEl.style.visibility = "hidden"; return; }
      cardEl.style.visibility = "";
      const sx = (v3.x + 1) / 2 * innerWidth, sy = (1 - v3.y) / 2 * innerHeight;
      // The body's radius on screen, so the card clears it.
      const edge = v3.clone().set(0, 0, 0);
      edge.copy(cardFor.pos).add(camera.up.clone().multiplyScalar(cardFor.radius)).project(camera);
      const rpx = Math.abs((edge.y - v3.y) / 2 * innerHeight);
      const w = cardEl.offsetWidth, h = cardEl.offsetHeight, m = 16, gap = rpx + 18;
      let x = sx + gap <= innerWidth - m - w ? sx + gap : sx - gap - w;
      x = Math.max(m, Math.min(x, innerWidth - m - w));
      const y = Math.max(m, Math.min(sy - h / 2, innerHeight - m - h));
      cardEl.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    }
    function showCard(t) {
      clearTimeout(hideTimer);
      if (cardFor === t && cardEl) return;
      cardFor = t;
      cardEl = t.station ? stationCard(s) : planetCard(t, s);
      cardEl.classList.add("sysv__card");
      hover.replaceChildren(cardEl);
      for (const [k, l] of labels) l.classList.toggle("sysv-lbl--hover", k === t);
      placeCard();
    }
    function hideCard() {
      clearTimeout(hideTimer);
      cardFor = null; cardEl = null; hover.replaceChildren();
      for (const l of labels.values()) l.classList.remove("sysv-lbl--hover");
    }
    const hideSoon = () => { clearTimeout(hideTimer); hideTimer = setTimeout(hideCard, 250); };
    hover.addEventListener("pointerenter", () => clearTimeout(hideTimer));
    hover.addEventListener("pointerleave", hideSoon);
    function hoverOn(t) {
      renderer.domElement.style.cursor = t ? "default" : "";
      if (t) showCard(t); else hideSoon();
    }

    // Camera moves
    let fly = null;
    function moveTo(target, pos) {
      if (reduced) { controls.target.copy(target); camera.position.copy(pos); controls.update(); invalidate(); return; }
      const t0 = controls.target.clone(), p0 = camera.position.clone();
      fly = { start: performance.now(), ms: 900, step(u) {
        const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
        controls.target.copy(t0).lerp(target, e);
        camera.position.copy(p0).lerp(pos, e);
      } };
    }
    // The game tilts the system SYSTEM_TILT (15°) towards the camera; fitting three screenshots of its view gives
    // 17–18.5° in all, so the camera looks a little down as well. VIEW_ELEVATION is the fitted angle.
    const VIEW_ELEVATION = 18, tilt = THREE.MathUtils.degToRad(VIEW_ELEVATION);
    const viewDir = new THREE.Vector3(0, Math.sin(tilt), Math.cos(tilt));
    // Framing fitted to the game's view (screenshots of it): at the game's tilt and field of view the bright ring
    // fills about 80 % of the screen's width (then 4 wheel notches out), and the middle sits a little above the screen's centre (SHIFT, in
    // normalised screen units). The frame is fixed, so the camera only depends on the screen's shape.
    const SHIFT = 0.2;
    function overviewPos() {
      const R = FRAME, cam = camera.clone(), p = new THREE.Vector3();
      const fits = d => {
        cam.position.copy(viewDir).multiplyScalar(d); cam.lookAt(0, 0, 0); cam.updateMatrixWorld();
        for (let i = 0; i < 48; i++) {
          const a = i / 48 * Math.PI * 2;
          p.set(Math.cos(a) * R, 0, Math.sin(a) * R).project(cam);
          if (p.z > 1 || Math.abs(p.x) > 0.8 || p.y < -0.9) return false;   // cam has the view offset
        }
        return true;
      };
      let lo = FRAME * 0.3, hi = FRAME * 20;
      for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (fits(m)) hi = m; else lo = m; }
      // Compared side by side with the game, this needed 4 wheel notches out (OrbitControls: × 1/0.95 per notch).
      return viewDir.clone().multiplyScalar(hi * Math.pow(1 / 0.95, 4));
    }
    function overview(instant) {
      const pos = overviewPos();
      if (instant) { controls.target.set(0, 0, 0); camera.position.copy(pos); controls.update(); invalidate(); }
      else moveTo(new THREE.Vector3(), pos);
    }

    // Pointer: hover over the bodies themselves (the labels handle their own).
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
    function hit(e) {
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const h = ray.intersectObjects(meshes, false)[0];
      return h ? h.object.userData : null;
    }
    let moveQueued = false, lastMove = null;
    renderer.domElement.addEventListener("pointermove", e => {
      lastMove = e;
      if (e.buttons || moveQueued) return;          // no hover while dragging the view
      moveQueued = true;
      requestAnimationFrame(() => { moveQueued = false; hoverOn(hit(lastMove)); });
    });
    renderer.domElement.addEventListener("pointerleave", hideSoon);
    renderer.domElement.addEventListener("dblclick", () => overview());

    function onKey(e) {
      if (document.body.dataset.view !== "system" || document.querySelector(".card--popup")) return;
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName || "") || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "Escape" || e.key === "Backspace") close();
      else if (e.key === "Home") overview();
      else return;
      e.preventDefault();
    }
    addEventListener("keydown", onKey);

    function resize() {
      const w = innerWidth, h = innerHeight;
      renderer.setSize(w, h); labelRenderer.setSize(w, h);
      camera.aspect = w / h;
      // The game's 90° is across the screen (fitting the screenshot needs that); three.js takes the vertical angle.
      camera.fov = Math.min(CAMERA_FOV, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV / 2)) / camera.aspect)));
      camera.setViewOffset(w, h, 0, SHIFT * h / 2, w, h);   // the middle a little above the centre, as in the game
      invalidate();
    }
    addEventListener("resize", resize); resize();
    overview(true);
    // Come in from a little farther out, so opening the view feels like arriving.
    if (!reduced) { const end = camera.position.clone(); camera.position.multiplyScalar(1.6); moveTo(new THREE.Vector3(), end); }

    let away = false;
    renderer.setAnimationLoop(() => {
      if (document.body.dataset.view !== "system") { away = true; return; }
      if (away) { away = false; invalidate(); }
      if (fly) {
        const u = Math.min(1, (performance.now() - fly.start) / fly.ms);
        fly.step(u); if (u >= 1) fly = null;
        invalidate();
      }
      controls.update();
      if (!needsRender) return;
      needsRender = false;
      renderer.render(scene, camera); labelRenderer.render(scene, camera);
      placeCard();
    });

    current = {
      key: s.key,
      stop() {
        renderer.setAnimationLoop(null);
        removeEventListener("resize", resize);
        removeEventListener("keydown", onKey);
        for (const d of disposables) d.dispose();
        // dispose() keeps the WebGL context; browsers allow about 16, then drop the oldest (the map or the sky).
        renderer.dispose(); renderer.forceContextLoss(); controls.dispose();
        root.remove();
      },
    };
  }

  function close() {
    if (current) { current.stop(); current = null; }
    App.view(Atlas.data ? "map" : "home");
  }

  // From the map's system card (G).
  document.addEventListener("map:open-system", e => {
    const data = Atlas.data; if (!data) return;
    const key = e.detail && e.detail.key;
    const s = (e.detail && e.detail.system) || data.systems.find(x => x.key === key) || (data.nearby || []).find(x => x.key === key);
    show(s, data);
  });

  window.SystemView = { show, close };
})();
