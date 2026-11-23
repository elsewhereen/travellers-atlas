"use strict";
/*
 * MapView: the 3D map of known space (three.js r147, vendored). Exposes window.MapView.
 * Based on tools/kort_template.html. Needs THREE, THREE.OrbitControls, THREE.CSS2DRenderer, Card.
 *
 *   await MapView.show(data)   // data from Atlas.build; replaces any earlier map and switches to the map view
 *   MapView.focus(key)         // select a system and fly to it
 */
(function () {
  const STAR_COLOURS = { Yellow: "#ffcf6e", Red: "#ff7a5c", Green: "#7dffa8", Blue: "#9cc8ff", Purple: "#c79cff" };
  const starColour = s => STAR_COLOURS[s.star] || "#efe6cf";
  const nf = new Intl.NumberFormat("en-GB");
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  // A swirl: the jump between clusters.
  const JUMP_ICON = '<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 12m-2 0a2 2 0 1 0 4 0a4 4 0 1 0-8 0a6 6 0 1 0 12 0a8 8 0 1 0-16 0"/></g>';
  const JUMP = 0xb48cff;

  // Badges after a system's name: the game's own icons once the player has loaded them (lib/gameicons.js:
  // Discoveries' pirate skull, the galaxy map's black hole), simple drawn ones until then (map.css).
  function badges(s) {
    const out = [];
    const add = (kind, alt) => {
      const i = el("span", `sys-badge sys-badge--${kind}`);
      i.setAttribute("role", "img"); i.setAttribute("aria-label", alt); i.title = alt; out.push(i);
    };
    if (s.blackHole) add("blackhole", "Black hole");
    if (s.pirate) add("pirate", "Pirate system");
    return out;
  }

  let current = null;   // { stop(), focus(key) }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function texture(draw) {
    const c = document.createElement("canvas"); c.width = c.height = 128;
    const x = c.getContext("2d"); x.scale(2, 2);   // drawn in 64-unit space at twice the resolution
    draw(x);
    return new THREE.CanvasTexture(c);
  }
  const glowTex = () => texture(x => {
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    // A crisp core with a faint, quickly fading haze, so close neighbours stay apart.
    g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.09, "rgba(255,255,255,1)");
    g.addColorStop(0.16, "rgba(255,255,255,0.55)"); g.addColorStop(0.3, "rgba(255,255,255,0.12)");
    g.addColorStop(0.55, "rgba(255,255,255,0.03)"); g.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  });
  const ringTex = () => texture(x => { x.strokeStyle = "#fff"; x.lineWidth = 1.2; x.beginPath(); x.arc(32, 32, 28, 0, Math.PI * 2); x.stroke(); });

  // Unique mining substances and plants across the system's bodies, in tone order (common, uncommon, rare, plant), then Salvageable Scrap.
  function systemResources(s) {
    const groups = [["common", new Set()], ["uncommon", new Set()], ["rare", new Set()], ["plant", new Set()], ["scrap", new Set()]];
    let unknown = 0;
    for (const p of s.planets) {
      const r = p.resources; if (!r) { unknown++; continue; }
      if (r.common) groups[0][1].add(r.common);
      if (r.partial) unknown++; else if (r.uncommon) groups[1][1].add(r.uncommon);
      if (r.rare) groups[2][1].add(r.rare);
      for (const o of Atlas.planetOffers(p)) {
        if (o.how === "plant") groups[3][1].add(o.name);
        else if (o.how === "scrap") groups[4][1].add(o.name);
      }
    }
    const box = el("div", "map-res");
    // Two columns of about equal length; a type is never split, and the order stays common → plant.
    const lists = groups.filter(([, set]) => set.size).map(([tone, set]) => [tone, [...set].sort()]);
    const total = lists.reduce((n, [, l]) => n + l.length, 0);
    let split = 0, best = Infinity, left = 0;
    for (let i = 0; i <= lists.length; i++) {
      const diff = Math.abs(total - 2 * left);
      if (diff < best) { best = diff; split = i; }
      if (i < lists.length) left += lists[i][1].length;
    }
    const row = el("div", "map-res__list");
    for (const part of [lists.slice(0, split), lists.slice(split)]) {
      const col = el("div", "map-res__col");
      for (const [tone, names] of part) for (const n of names) col.append(el("span", "map-res__" + tone, n));
      row.append(col);
    }
    box.append(el("h3", null, "Resources"), row);
    if (unknown) box.append(el("p", "map-res__note", `Biome resources unknown for ${unknown} ${unknown === 1 ? "body" : "bodies"}`));
    return box;
  }

  // The system view (views/system.js) listens for this.
  function goTo(s) { document.dispatchEvent(new CustomEvent("map:open-system", { detail: { key: s.key, system: s } })); }

  // Header tint: the star's colour mixed into the dark card ground, so white text stays readable.
  function headTint(hex, share = 0.36) {
    const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)), ground = [16, 17, 28];
    const m = c.map((v, i) => Math.round(v * share + ground[i] * (1 - share)));
    return { head: `rgba(${m.join(",")}, 0.9)`, edge: `rgba(${c.join(",")}, 0.55)` };
  }

  // The portal code to the clipboard; the button says so for a moment.
  function copyAddress(s, card) {
    const done = ok => {
      const b = card && card.querySelector(".map__copy .card__label");
      if (!b) return;
      b.textContent = ok ? "Copied" : "Copy failed";
      clearTimeout(b._t); b._t = setTimeout(() => { b.textContent = "Copy address"; }, 1500);
    };
    const fallback = () => {
      const t = document.createElement("textarea");
      t.value = s.code; t.style.position = "fixed"; t.style.opacity = "0";
      document.body.append(t); t.select();
      let ok = false; try { ok = document.execCommand("copy"); } catch { /* no clipboard */ }
      t.remove(); done(ok);
    };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(s.code).then(() => done(true), fallback);
    else fallback();
  }

  function systemCard(s, here, data) {
    const items = [];
    const isHere = s.key === here.key;
    items.push({ icon: "signal", label: isHere ? "You are here" : `${nf.format(Math.round(dist(s.pos, here.pos)))} ly from you`, tone: isHere ? "special" : null });
    if (s.race) items.push({ icon: "element", label: `${s.race} · ${s.economy} · ${s.wealth} wealth`, tone: "uncommon" });
    else items.push({ icon: "element", label: s.abandoned ? "Abandoned" : "Uninhabited" });
    if (s.conflict) items.push({ icon: "warning", label: `${s.conflict} conflict`, tone: s.conflict === "High" ? "danger" : null });
    if (s.pirate) items.push({ icon: "warning", label: "Pirate system", tone: "danger" });
    const dissonant = s.planets.filter(p => p.dissonant).length;
    if (dissonant) items.push({ icon: "sentinel", label: `Dissonant · ${dissonant} ${dissonant === 1 ? "planet" : "planets"}`, tone: "danger" });
    if (s.calmed) items.push({ icon: "sentinel", tone: "uncommon",
      label: `${s.calm === "start" ? "Your start system" : "Your first jump"}: the game removes dissonance and aggressive sentinels here`,
      title: s.planets.filter(p => p.calmed).map(p => `${p.name}: ${p.calmed.dissonant ? "dissonant" : p.calmed.sentinels} elsewhere`).join("\n") });
    if (s.station) items.push({ icon: "ship", label: s.station });
    for (const b of s.bases) items.push({ icon: "star", label: `Base: ${b}`, tone: "plant" });
    items.push({ icon: "star", label: `${nf.format(s.coreLy)} ly to the core` });
    const nameOf = k => (data.systems.find(x => x.key === k) || { name: "?" }).name;
    for (const j of data.jumps || []) {
      if (j.to === s.key) items.push({ icon: JUMP_ICON, tone: "special", label: `Black hole from ${nameOf(j.from)} · ${nf.format(j.ly)} ly` });
      if (j.from === s.key) items.push({ icon: JUMP_ICON, tone: "special", label: `Black hole to ${nameOf(j.to)} · ${nf.format(j.ly)} ly` });
    }
    const sub = [s.name !== s.originalName ? s.originalName : null, s.regionName].filter(Boolean).join(" · ");
    const card = Card.create({
      title: s.name,
      subtitle: sub,
      kind: `${s.star || "Unknown"} star · ${s.planetCount} planet${s.planetCount === 1 ? "" : "s"}` +
            (s.moonCount ? ` + ${s.moonCount} moon${s.moonCount === 1 ? "" : "s"}` : ""),
      items,
      content: s.planets.length ? systemResources(s) : null,
      actions: [{ key: "G", label: "Go to system", onSelect: () => goTo(s) },
                { key: "C", label: "Copy address", hint: s.code, onSelect: c => copyAddress(s, c) }],
      onClose: false, tint: false,
    }), t = headTint(starColour(s));
    card.style.setProperty("--card-head", t.head);
    card.style.setProperty("--card-head-edge", t.edge);
    card.querySelector(".card__title").append(...badges(s));
    const acts = card.querySelectorAll(".card__action");
    acts[acts.length - 1].classList.add("map__copy");
    return card;
  }

  async function show(data) {
    if (current) current.stop();
    document.body.dataset.view = "map";

    const here = data.systems.find(s => s.key === data.current);
    const origin = here.pos;
    const rel = s => [s.pos[0] - origin[0], s.pos[1] - origin[1], s.pos[2] - origin[2]];

    const root = el("section", "map");
    root.setAttribute("aria-label", "Map");
    const sceneEl = el("div", "map__scene"), labelsEl = el("div", "map__labels");
    // Location readout, top right (in the spirit of a ship HUD): galaxy › region, system, where in it, which save.
    const title = el("div", "map__where");
    const path = el("div", "map__where-path");
    path.append(el("span", null, data.galaxy.name), el("span", "map__where-sep", "›"), el("span", null, here.regionName));
    const sys = el("button", "map__where-system", here.name);
    sys.append(...badges(here));
    sys.type = "button"; sys.title = "Centre the map on your system";
    const dot = el("span", "map__where-star"); dot.style.background = dot.style.color = starColour(here); sys.prepend(dot);
    sys.addEventListener("click", () => { select(here, true); });
    title.append(path, sys);
    if (data.save.summary) title.append(el("div", "map__where-loc", data.save.summary));
    title.append(el("div", "map__where-save", data.save.manual
      ? `Entered by hand · ${data.save.count} ${data.save.count === 1 ? "system" : "systems"}`
      : `${data.save.name || "Unnamed save"} · Slot ${data.save.slot}`));
    const hover = el("div", "map__hover");
    root.append(sceneEl, labelsEl, title, hover);
    document.body.append(root);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    sceneEl.append(renderer.domElement);
    const labelRenderer = new THREE.CSS2DRenderer({ element: labelsEl });
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 1, 60000);
    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !matchMedia("(prefers-reduced-motion: reduce)").matches;
    // Draw only when something changed: the camera (incl. damping, which fires "change" until it settles) or the scene.
    let needsRender = true;
    const invalidate = () => { needsRender = true; };
    controls.addEventListener("change", invalidate);

    const glow = glowTex(), ring = ringTex();
    const R = data.regionLy;
    const isMain = s => s.visited || s.bases.length || s.key === data.current;
    const shown = () => true;   // every system in the save is drawn; known-only ones are fainter

    // Regions (400 ly cubes) around the shown systems: name in the middle, dashed edges.
    const regionObjs = new Map();
    for (const s of data.systems) {
      const k = s.region.join(",");
      if (regionObjs.has(k)) continue;
      const c = [s.region[0] * R - origin[0], s.region[1] * R - origin[1], s.region[2] * R - origin[2]];
      const l = el("div", "lbl lbl--region", s.regionName);
      const o = new THREE.CSS2DObject(l); o.position.set(...c); scene.add(o);
      regionObjs.set(k, [o]);
    }
    // Neighbouring cubes share edges; each edge is drawn once, or two offset dash patterns would look solid.
    const edgeMat = new THREE.LineDashedMaterial({ color: 0x4f8fe8, transparent: true, opacity: 0.3, dashSize: 8, gapSize: 8 });
    let edgeLines = null;
    function drawRegionEdges(regionKeys) {
      if (edgeLines) { scene.remove(edgeLines); edgeLines.geometry.dispose(); }
      const seen = new Set(), pts = [];
      // Corners in half-region steps (2r ± 1), so shared corners get identical integer keys.
      for (const k of regionKeys) {
        const r = k.split(",").map(Number);
        for (let a = 0; a < 3; a++) {
          const [b, c] = [0, 1, 2].filter(q => q !== a);
          for (const sb of [-1, 1]) for (const sc of [-1, 1]) {
            const p = [0, 0, 0], q = [0, 0, 0];
            p[a] = 2 * r[a] - 1; q[a] = 2 * r[a] + 1;
            p[b] = q[b] = 2 * r[b] + sb; p[c] = q[c] = 2 * r[c] + sc;
            const key = p.join(",") + "|" + q.join(",");
            if (seen.has(key)) continue;
            seen.add(key);
            for (const v of [p, q]) pts.push(v[0] * R / 2 - origin[0], v[1] * R / 2 - origin[1], v[2] * R / 2 - origin[2]);
          }
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      edgeLines = new THREE.LineSegments(g, edgeMat);
      edgeLines.computeLineDistances();                            // each edge starts its own dash pattern
      scene.add(edgeLines);
    }

    // Direction to the galactic core
    // A thin line that fades in from your system, three chevrons that always face the screen, and a label on a
    // small dark plate so it stays readable over the line and stars.
    const coreDir = new THREE.Vector3(-origin[0], -origin[1], -origin[2]).normalize();
    const chevrons = [];
    {
      const CORE = new THREE.Color(0xb48cff), R0 = 18, R1 = 236;
      const g = new THREE.BufferGeometry();
      const n = 24, pos = [], col = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n, r = R0 + (R1 - R0) * t;
        pos.push(coreDir.x * r, coreDir.y * r, coreDir.z * r);
        col.push(CORE.r, CORE.g, CORE.b, 0.08 + 0.62 * t * t);
      }
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(col, 4));
      scene.add(new THREE.Line(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false })));

      const chev = texture(x => {
        x.strokeStyle = "#fff"; x.lineWidth = 5; x.lineCap = "round"; x.lineJoin = "round";
        x.beginPath(); x.moveTo(22, 14); x.lineTo(42, 32); x.lineTo(22, 50); x.stroke();
      });
      [[196, 0.35], [214, 0.6], [232, 0.95]].forEach(([r, op]) => {
        const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: chev, color: CORE, transparent: true, opacity: op, depthWrite: false }));
        m.position.copy(coreDir.clone().multiplyScalar(r)); m.scale.setScalar(15);
        scene.add(m); chevrons.push(m);
      });

      const l = el("div", "lbl lbl--core");
      l.append(el("span", "lbl--core__name", "Galactic core"), el("span", "lbl--core__ly", `${nf.format(here.coreLy)} ly`));
      const o = new THREE.CSS2DObject(l); o.position.copy(coreDir.clone().multiplyScalar(262)); scene.add(o);
    }
    // Turn the chevrons to point along the line as seen on screen.
    const cv0 = new THREE.Vector3(), cv1 = new THREE.Vector3();
    function aimChevrons() {
      cv0.set(0, 0, 0).project(camera); cv1.copy(coreDir).multiplyScalar(236).project(camera);
      const ang = Math.atan2((cv1.y - cv0.y), (cv1.x - cv0.x) * camera.aspect);
      for (const m of chevrons) m.material.rotation = ang;
    }

    // Systems. Nearby ones (not in the save, added by search) are fainter and only labelled when selected.
    const sprites = [], objs = new Map(), labels = new Map(), byKey = new Map(), baseLook = new Map();
    let lit = null;       // Set of keys the filter lights up, or null
    let inScope = null;   // Set of keys in the filter's scope (Only visited / In save / Nearby), or null = all
    // Only what the filter lights up gets a card: out of scope or not matching = no hover, no click.
    const interactive = s => (!inScope || inScope.has(s.key)) && (!lit || lit.has(s.key));
    function addSystem(s) {
      const p = rel(s), main = isMain(s), isHere = s.key === data.current, near = s.scope === "nearby";
      byKey.set(s.key, s);
      const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: starColour(s), transparent: true, depthWrite: false, opacity: main ? 1 : near ? 0.4 : 0.55 }));
      m.position.set(...p); m.scale.setScalar(isHere ? 28 : main ? 18 : near ? 9 : 11); m.userData = s; scene.add(m); sprites.push(m);
      baseLook.set(m, { opacity: m.material.opacity, scale: m.scale.x });
      const list = [m];
      if (isHere || s.bases.length) {
        const rr = new THREE.Sprite(new THREE.SpriteMaterial({ map: ring, color: isHere ? 0xece4d6 : 0x8de86b, transparent: true, depthWrite: false, opacity: isHere ? 0.4 : 0.3 }));
        rr.position.set(...p); rr.scale.setScalar(isHere ? 22.5 : 19.5); scene.add(rr); list.push(rr);
        baseLook.set(rr, { opacity: rr.material.opacity, scale: rr.scale.x });
      }
      const l = el("div", "lbl" + (isHere ? " lbl--here" : main ? "" : near ? " lbl--nearby" : " lbl--known"));
      const t = el("span", "t", s.name); l.append(t);
      t.append(...badges(s));
      if (isHere) t.append(el("small", null, "YOU ARE HERE"));
      const o = new THREE.CSS2DObject(l); o.position.set(...p); scene.add(o); list.push(o);
      objs.set(s.key, list); labels.set(s.key, l);
      if (lit) look(s.key);
      invalidate();
    }
    // Filter look for one system. Out of scope: barely there. In scope but not a match: faint. Neither gets a card.
    // A match: brighter, larger and labelled.
    function look(key) {
      const scoped = !inScope || inScope.has(key);
      const on = scoped && (!lit || lit.has(key)), match = !!lit && on;
      for (const o of objs.get(key)) {
        const b = baseLook.get(o);
        if (b) {
          o.material.opacity = !scoped ? b.opacity * 0.08 : on ? (match ? Math.max(b.opacity, 0.9) : b.opacity) : b.opacity * 0.3;
          o.scale.setScalar(match && o === objs.get(key)[0] ? Math.max(b.scale, 14) : b.scale);
        } else if (o.element) {
          o.element.classList.toggle("lbl--out", !scoped);
          o.element.classList.toggle("lbl--dim", scoped && !on);
          o.element.classList.toggle("lbl--match", match);
        }
      }
    }
    function highlight(keys, scope) {
      lit = keys instanceof Set ? keys : null;
      inScope = scope instanceof Set ? scope : null;
      for (const k of objs.keys()) look(k);
      if (cardFor && !interactive(cardFor)) hideCard();
      invalidate();
    }
    data.systems.forEach(addSystem);
    if (data.nearby) data.nearby.forEach(addSystem);
    const selRing = new THREE.Sprite(new THREE.SpriteMaterial({ map: ring, color: 0x9fc4f0, transparent: true, depthWrite: false, opacity: 0.45 }));
    selRing.scale.setScalar(28.5); selRing.visible = false; scene.add(selRing);

    // Long jumps (wormholes and the like): a violet line out of each end that fades within a few thousand ly,
    // so it shows the way without crossing the whole map at full strength.
    {
      const col = new THREE.Color(JUMP);
      for (const j of data.jumps || []) {
        const a = byKey.get(j.from), b = byKey.get(j.to);
        if (!a || !b) continue;
        const pa = new THREE.Vector3(...rel(a)), pb = new THREE.Vector3(...rel(b)), len = pa.distanceTo(pb);
        const pos = [], c = [];
        const at = (t, alpha) => { const p = pa.clone().lerp(pb, t); pos.push(p.x, p.y, p.z); c.push(col.r, col.g, col.b, alpha); };
        // Distances from an end (ly) and the line's strength there.
        const ramp = [[12, 0.75], [400, 0.5], [1500, 0.25], [4000, 0.08]].filter(([r]) => r < len / 2);
        for (const [r, al] of ramp) at(r / len, al);
        at(0.5, 0.03);
        for (const [r, al] of ramp.slice().reverse()) at(1 - r / len, al);
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute("color", new THREE.Float32BufferAttribute(c, 4));
        scene.add(new THREE.Line(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false })));
      }
    }

    // Other clusters: a marker at the screen edge pointing to each one's anchor (or on it, when it's in view and
    // far away). Click it to fly there. Hidden for the cluster the camera is looking at.
    const far = [];
    for (const c of data.clusters || []) {
      const a = byKey.get(c.anchor);
      if (!a) continue;
      const b = el("button", "map__far");
      b.type = "button";
      const arrow = el("span", "map__far-arrow");
      const txt = el("span", "map__far-text");
      const name = el("span", "map__far-name", a.name);
      const info = el("span", "map__far-info");
      txt.append(name, info);
      b.append(arrow, txt);
      b.title = `Fly to ${a.name}`;
      // Fly back far enough to see the cluster's visited systems, not just the anchor.
      // The view centres on the middle of those systems; the anchor gets the selection and the card.
      const vis = [a, ...c.keys.map(k => byKey.get(k)).filter(s => s && s.visited && s !== a)];
      const mid = { pos: [0, 1, 2].map(i => vis.reduce((n, s) => n + s.pos[i], 0) / vis.length) };
      const reach = Math.max(0, ...vis.map(s => dist(s.pos, mid.pos)));
      const back = Math.min(6000, Math.max(320, reach * 2.4));
      b.addEventListener("click", () => { select(a, false); focusOn(mid, back); showCard(a); pinned = true; });
      b.hidden = true;
      root.append(b);
      far.push({ c, a, b, arrow, info, at: new THREE.Vector3(...rel(a)) });
    }
    const fv = new THREE.Vector3();
    function placeFar() {
      if (!far.length) return;
      const t = controls.target;
      // The cluster in view: the one whose anchor's cluster holds the system nearest the camera's target.
      let viewC = null, best = Infinity;
      for (const s of byKey.values()) {
        if (s.cluster == null) continue;
        const d = Math.hypot(s.pos[0] - origin[0] - t.x, s.pos[1] - origin[1] - t.y, s.pos[2] - origin[2] - t.z);
        if (d < best) { best = d; viewC = s.cluster; }
      }
      const w = innerWidth, h = innerHeight, m = 56;
      for (const f of far) {
        if (f.c.id === viewC) { f.b.hidden = true; continue; }
        f.b.hidden = false;
        // Anchor to anchor, so it matches the cards (the view's centre moves with the camera).
        const from = byKey.get(((data.clusters || [])[viewC] || {}).anchor);
        const ly = Math.round(from ? dist(f.a.pos, from.pos) : f.at.distanceTo(t));
        const isHere = f.a.key === data.current;
        f.info.textContent = `${isHere ? "You are here" : `${f.c.visited} visited`} · ${nf.format(ly)} ly`;
        fv.copy(f.at).project(camera);
        let x = fv.x, y = fv.y;
        const behind = fv.z > 1;
        if (behind) { x = -x; y = -y; }
        // From the centre toward the point, clamped to a box inset from the edges.
        const cx = w / 2, cy = h / 2;
        let dx = x * cx, dy = -y * cy;
        const onScreen = !behind && Math.abs(dx) <= cx - m && Math.abs(dy) <= cy - m;
        if (!onScreen) {
          const k = Math.min((cx - m) / Math.max(Math.abs(dx), 1e-6), (cy - m) / Math.max(Math.abs(dy), 1e-6));
          dx *= k; dy *= k;
        }
        f.arrow.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
        f.b.classList.toggle("map__far--left", dx > 0);    // label on the side facing the screen's middle
        f.b.style.transform = `translate(${Math.round(cx + dx)}px, ${Math.round(cy + dy)}px)`;
      }
    }


    function applyFilter() {
      const regs = new Set();
      for (const s of data.systems) {
        const v = shown(s);
        for (const o of objs.get(s.key)) o.visible = v;
        if (v) regs.add(s.region.join(","));
      }
      for (const [k, list] of regionObjs) for (const o of list) o.visible = regs.has(k);
      drawRegionEdges(regs);
      invalidate();
    }

    // Hover card: shown next to the star on the side with room; stays while the pointer is on it,
    // and stays put (pinned) after a click on the star until a click elsewhere or Escape.
    let cardFor = null, cardEl = null, pinned = false, hideTimer = 0;
    const v3 = new THREE.Vector3();
    function placeCard() {
      if (!cardEl || !cardFor) return;
      v3.set(...rel(cardFor)).project(camera);
      if (v3.z > 1) { cardEl.style.visibility = "hidden"; return; }   // behind the camera
      cardEl.style.visibility = "";
      const sx = (v3.x + 1) / 2 * innerWidth, sy = (1 - v3.y) / 2 * innerHeight;
      const w = cardEl.offsetWidth, h = cardEl.offsetHeight, m = 16, gap = 26;
      // The star's name sits to its right, so on that side the card goes past the name.
      const t = labels.get(cardFor.key)?.querySelector(".t");
      const right = sx + (t ? 14 + t.offsetWidth + 18 : gap);
      let x = right <= innerWidth - m - w ? right : sx - gap - w;
      if (x < m) x = Math.max(m, Math.min(right, innerWidth - m - w));
      const y = Math.max(m, Math.min(sy - h / 2, innerHeight - m - h));
      cardEl.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    }
    function showCard(s) {
      clearTimeout(hideTimer);
      if (cardFor === s && cardEl) return;
      cardFor = s;
      cardEl = systemCard(s, here, data);
      cardEl.classList.add("map__card");
      hover.replaceChildren(cardEl);
      placeCard();
    }
    function hideCard() {
      clearTimeout(hideTimer);
      cardFor = null; cardEl = null; pinned = false; hover.replaceChildren();
    }
    function hideSoon() { if (!pinned) { clearTimeout(hideTimer); hideTimer = setTimeout(hideCard, 250); } }
    hover.addEventListener("pointerenter", () => clearTimeout(hideTimer));
    hover.addEventListener("pointerleave", hideSoon);

    let selected = null;
    function select(s, fly) {
      selected = s;
      for (const [k, l] of labels) l.classList.toggle("lbl--sel", k === s.key);
      selRing.position.set(...rel(s)); selRing.visible = true;
      invalidate();
      if (fly) focusOn(s);
    }

    function focusOn(s, back = 320) {
      const p = new THREE.Vector3(...rel(s));
      const dir = camera.position.clone().sub(controls.target).normalize();
      controls.target.copy(p); camera.position.copy(p).add(dir.multiplyScalar(back)); controls.update();
    }

    // Hover for the card, click to select and pin it, double-click to centre
    // The star whose core is nearest the pointer on screen, within PICK_PX. Not the sprite quads: their faint
    // haze reaches far, and overlapping quads would always give the front one.
    const PICK_PX = 14, pv = new THREE.Vector3();
    function pick(ev) {
      const r = renderer.domElement.getBoundingClientRect();
      const mx = ev.clientX - r.left, my = ev.clientY - r.top;
      let best = null, bestD = PICK_PX * PICK_PX;
      for (const m of sprites) {
        if (!m.visible || !interactive(m.userData)) continue;
        pv.copy(m.position).project(camera);
        if (pv.z > 1 || pv.z < -1) continue;                       // behind the camera or clipped
        const dx = (pv.x + 1) / 2 * r.width - mx, dy = (1 - pv.y) / 2 * r.height - my, d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = m.userData; }
      }
      return best;
    }
    function addSystems(list) {
      let n = 0;
      for (const s of list) if (!objs.has(s.key)) { addSystem(s); n++; }
      return n;
    }
    let down = null;
    renderer.domElement.addEventListener("pointerdown", e => (down = [e.clientX, e.clientY]));
    renderer.domElement.addEventListener("pointerup", e => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
      const s = pick(e);
      if (s) { select(s, false); showCard(s); pinned = true; }
      else hideCard();
    });
    renderer.domElement.addEventListener("dblclick", e => { const s = pick(e); if (s) { select(s, true); showCard(s); pinned = true; } });
    let moveQueued = false, lastMove = null;
    renderer.domElement.addEventListener("pointermove", e => {
      lastMove = e;
      if (e.buttons || moveQueued) return;          // no hover while dragging the view
      moveQueued = true;
      requestAnimationFrame(() => {
        moveQueued = false;
        const s = pick(lastMove);
        renderer.domElement.style.cursor = s ? "pointer" : "";
        if (s) { if (!pinned || s === cardFor) showCard(s); }
        else hideSoon();
      });
    });
    renderer.domElement.addEventListener("pointerleave", hideSoon);
    function onKey(e) {
      if (document.body.dataset.view !== "map" || !cardEl) return;
      if (e.key === "Escape") hideCard();
      else if (e.ctrlKey || e.metaKey || e.altKey || !cardFor) return;
      else if (e.key.toLowerCase() === "g") goTo(cardFor);
      else if (e.key.toLowerCase() === "c") copyAddress(cardFor, cardEl);
    }
    addEventListener("keydown", onKey);

    function resize() {
      const w = innerWidth, h = innerHeight;
      renderer.setSize(w, h); labelRenderer.setSize(w, h);
      camera.aspect = w / h; camera.updateProjectionMatrix();
      invalidate();
    }
    addEventListener("resize", resize); resize();

    // Start close in on the current system, looking a little down and toward the core.
    const core = new THREE.Vector3(-origin[0], -origin[1], -origin[2]).normalize();
    camera.position.copy(core.clone().multiplyScalar(-0.8).add(new THREE.Vector3(0, 0.45, 0)).normalize().multiplyScalar(420));
    controls.target.set(0, 0, 0); controls.update();
    applyFilter();
    select(here, false);

    let away = false;   // back from the front page: draw once, the page may have been resized meanwhile
    renderer.setAnimationLoop(() => {
      if (document.body.dataset.view !== "map") { away = true; return; }
      if (away) { away = false; needsRender = true; }
      controls.update();                         // cheap; fires "change" while the view moves or damps
      if (!needsRender) return;
      needsRender = false;
      aimChevrons(); renderer.render(scene, camera); labelRenderer.render(scene, camera);
      placeCard(); placeFar();
    });

    current = {
      stop() {
        renderer.setAnimationLoop(null);
        removeEventListener("resize", resize);
        removeEventListener("keydown", onKey);
        // dispose() keeps the WebGL context; browsers allow about 16, then drop the oldest (the map or the sky).
        renderer.dispose(); renderer.forceContextLoss(); controls.dispose();
        root.remove();
      },
      focus(key) {
        const s = byKey.get(key); if (!s) return;
        select(s, true); showCard(s); pinned = true;
      },
      addSystems,
      highlight,
      pickAt: (x, y) => pick({ clientX: x, clientY: y }),   // for tests
    };
  }

  window.MapView = { show, focus: key => current && current.focus(key),
                     addSystems: list => (current ? current.addSystems(list) : 0),
                     highlight: (keys, scope) => current && current.highlight(keys, scope),
                     _pickAt: (x, y) => current && current.pickAt(x, y) };
})();
