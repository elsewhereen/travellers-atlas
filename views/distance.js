"use strict";
/*
 * DistanceView: two systems and where they are in the galaxy, nothing else. Exposes window.DistanceView.
 * Opens zoomed far out (the whole galaxy, core in the middle, rings every 100,000 ly) and can fly in to frame
 * just the two systems. Needs THREE, OrbitControls, CSS2DRenderer (loaded by Atlas.loadThree), Manual.glyphRow.
 *
 *   DistanceView.show(a, b, galaxyName)   a, b = { name, code, regionName, star, pos: [x,y,z] ly, coreLy }
 *   DistanceView.close()                  back to the map (or the front page without one)
 *
 * The distance is the straight line between the two positions, the same measure the galaxy map shows on hover
 * (checked: Eojean-Sen IX – Nihail III 111.0 ly in both).
 */
(function () {
  const STAR_COLOURS = { Yellow: "#ffcf6e", Red: "#ff7a5c", Green: "#7dffa8", Blue: "#9cc8ff", Purple: "#c79cff" };
  const colour = s => STAR_COLOURS[s.star] || "#efe6cf";
  const K = 1 / 1000;                 // scene units: 1 = 1,000 ly (keeps the camera's numbers sane at galaxy scale)
  const EDGE = 819;                   // the address space reaches ±2047 regions × 400 ly ≈ ±819,000 ly
  const nf = new Intl.NumberFormat("en-GB");
  const nf1 = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const fmtLy = ly => (ly < 1000 ? nf1.format(ly) : nf.format(Math.round(ly))) + " ly";

  let current = null;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function texture(size, draw) {
    const c = document.createElement("canvas"); c.width = c.height = size;
    draw(c.getContext("2d"), size);
    return new THREE.CanvasTexture(c);
  }
  const glowTex = () => texture(128, (x, n) => {
    const g = x.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.12, "rgba(255,255,255,1)");
    g.addColorStop(0.25, "rgba(255,255,255,0.4)"); g.addColorStop(0.5, "rgba(255,255,255,0.08)"); g.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = g; x.fillRect(0, 0, n, n);
  });
  // A soft disc for the galaxy's plane: bright towards the core, fading out to the edge.
  const discTex = () => texture(512, (x, n) => {
    const g = x.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    g.addColorStop(0, "rgba(230,215,255,0.55)"); g.addColorStop(0.08, "rgba(190,160,255,0.28)");
    g.addColorStop(0.35, "rgba(110,120,220,0.10)"); g.addColorStop(0.8, "rgba(70,90,180,0.04)"); g.addColorStop(1, "rgba(70,90,180,0)");
    x.fillStyle = g; x.fillRect(0, 0, n, n);
  });

  function show(a, b, galaxyName) {
    if (current) current.stop();
    const back = document.body.dataset.view === "distance" ? (current && current.back) : document.body.dataset.view;
    document.body.dataset.view = "distance";

    const A = new THREE.Vector3(...a.pos).multiplyScalar(K), B = new THREE.Vector3(...b.pos).multiplyScalar(K);
    const mid = A.clone().add(B).multiplyScalar(0.5);
    const ly = Math.hypot(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1], a.pos[2] - b.pos[2]);

    const root = el("section", "dist");
    root.setAttribute("aria-label", "Distance");
    const sceneEl = el("div", "dist__scene"), labelsEl = el("div", "dist__labels");
    root.append(sceneEl, labelsEl, panel());
    document.body.append(root);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, logarithmicDepthBuffer: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    sceneEl.append(renderer.domElement);
    const labelRenderer = new THREE.CSS2DRenderer({ element: labelsEl });
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 1e-4, 1e5);
    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !matchMedia("(prefers-reduced-motion: reduce)").matches;
    controls.minDistance = 0.002; controls.maxDistance = 6000; controls.zoomSpeed = 1.4;
    let needsRender = true;
    const invalidate = () => { needsRender = true; };
    controls.addEventListener("change", invalidate);

    const label = (node, pos) => { const o = new THREE.CSS2DObject(node); o.position.copy(pos); scene.add(o); return o; };
    const line = (pts, color, opacity, dashed) => {
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      const m = dashed
        ? new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize: 8, gapSize: 8, depthWrite: false })
        : new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
      const l = new THREE.Line(g, m);
      if (dashed) l.computeLineDistances();
      scene.add(l);
      return l;
    };

    // The galaxy: a faint disc, rings every 100,000 ly (labelled every 200,000, on the systems' side) and the core.
    const disc = new THREE.Mesh(new THREE.PlaneGeometry(EDGE * 2, EDGE * 2),
      new THREE.MeshBasicMaterial({ map: discTex(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    disc.rotation.x = -Math.PI / 2; scene.add(disc);
    const side = Math.atan2(mid.z, mid.x) + 0.35;   // ring labels a little beside the systems, not on top of them
    for (let r = 100; r <= 800; r += 100) {
      const pts = [];
      for (let i = 0; i <= 160; i++) { const t = i / 160 * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(t) * r, 0, Math.sin(t) * r)); }
      line(pts, 0x6f8fd8, r % 200 ? 0.1 : 0.2);
      if (r % 200 === 0) label(el("div", "lbl lbl--region", `${nf.format(r * 1000)} ly`), new THREE.Vector3(Math.cos(side) * r, 0, Math.sin(side) * r));
    }
    const glow = glowTex();
    const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xd9c8ff, transparent: true, depthWrite: false }));
    core.scale.setScalar(70); scene.add(core);
    const coreLbl = el("div", "lbl lbl--core");
    coreLbl.append(el("span", "lbl--core__name", "Galactic core"));
    label(coreLbl, new THREE.Vector3(0, 40, 0));

    // The two systems: a star of fixed screen size, a drop line to the galaxy's plane (height at a glance),
    // a faint line to the core, and the line between them with the distance in the middle.
    function system(s, P, role, cls) {
      const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: colour(s), transparent: true, depthWrite: false, sizeAttenuation: false }));
      m.scale.setScalar(0.045); m.position.copy(P); scene.add(m);
      const l = el("div", `lbl lbl--here dist__lbl ${cls}`);
      const t = el("span", "t", s.name); t.append(el("small", null, role)); l.append(t);
      label(l, P);
      line([P, new THREE.Vector3(P.x, 0, P.z)], 0x9fc4f0, 0.25);
      line([P, new THREE.Vector3(0, 0, 0)], 0xb48cff, 0.18, true);
    }
    system(a, A, "You are here", "dist__lbl--a");
    system(b, B, "Target", "dist__lbl--b");
    line([A, B], 0xffd696, 0.95);
    const dl = el("div", "dist__ly", fmtLy(ly));
    label(dl, mid);

    // Views. Galaxy: from beyond the systems, looking down across them to the core. Systems: the two framed.
    const outward = new THREE.Vector3(mid.x, 0, mid.z).normalize();
    if (!isFinite(outward.x)) outward.set(0, 0, 1);
    const views = {
      // Target between core and systems, seen from above on the systems' side and far enough out that the whole
      // disc (±819,000 ly) fits: the systems end up in the lower half, the core in the middle, the far edge on top.
      galaxy: (() => {
        const target = outward.clone().multiplyScalar(Math.min(mid.length(), EDGE) * 0.3);
        return { target, pos: target.clone().add(outward.clone().multiplyScalar(0.6).add(new THREE.Vector3(0, 0.8, 0)).multiplyScalar(2100)) };
      })(),
      systems: (() => {
        const span = Math.max(ly * K, 0.02);              // at least 20 ly across
        const d = span * 0.7 / Math.tan(THREE.MathUtils.degToRad(22.5));   // the pair fills about half the screen
        const dir = outward.clone().multiplyScalar(0.75).add(new THREE.Vector3(0, 0.66, 0)).normalize();
        return { target: mid.clone(), pos: mid.clone().add(dir.multiplyScalar(d)) };
      })(),
    };
    let fly = null;
    function go(name, instant) {
      const v = views[name];
      if (instant || !controls.enableDamping) {
        controls.target.copy(v.target); camera.position.copy(v.pos); controls.update(); invalidate();
        return;
      }
      const t0 = controls.target.clone(), p0 = camera.position.clone();
      const d0 = p0.distanceTo(t0), d1 = v.pos.distanceTo(v.target);
      const n0 = p0.clone().sub(t0).normalize(), n1 = v.pos.clone().sub(v.target).normalize();
      fly = { start: performance.now(), ms: 1400, step(u) {
        const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;   // ease in-out
        const d = d0 * Math.pow(d1 / d0, e);                                    // zoom evenly in log scale
        const w = Math.abs(d0 - d1) < 1e-9 ? e : (d0 - d) / (d0 - d1);          // the target moves with the zoom
        controls.target.copy(t0).lerp(v.target, w);
        camera.position.copy(controls.target).add(n0.clone().lerp(n1, e).normalize().multiplyScalar(d));
      } };
    }
    root.querySelector('[data-view-btn="galaxy"]').addEventListener("click", () => go("galaxy"));
    root.querySelector('[data-view-btn="systems"]').addEventListener("click", () => go("systems"));

    function resize() {
      const w = innerWidth, h = innerHeight;
      renderer.setSize(w, h); labelRenderer.setSize(w, h);
      camera.aspect = w / h; camera.updateProjectionMatrix(); invalidate();
    }
    addEventListener("resize", resize); resize();
    go("galaxy", true);

    let away = false;
    // The distance label sits between the two stars; far out they're a few pixels apart, so it would cover the
    // names. Hidden then (the panel has the number anyway).
    const pa = new THREE.Vector3(), pb = new THREE.Vector3();
    function placeLy() {
      pa.copy(A).project(camera); pb.copy(B).project(camera);
      const px = Math.hypot((pa.x - pb.x) * innerWidth / 2, (pa.y - pb.y) * innerHeight / 2);
      dl.style.visibility = px < 110 ? "hidden" : "";
    }

    renderer.setAnimationLoop(() => {
      if (document.body.dataset.view !== "distance") { away = true; return; }
      if (away) { away = false; invalidate(); }
      if (fly) {
        const u = Math.min(1, (performance.now() - fly.start) / fly.ms);
        fly.step(u); if (u >= 1) fly = null;
        invalidate();
      }
      controls.update();
      if (!needsRender) return;
      needsRender = false;
      placeLy();
      renderer.render(scene, camera); labelRenderer.render(scene, camera);
    });

    function onKey(e) {
      if (document.body.dataset.view !== "distance" || document.querySelector(".card--popup")) return;
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName || "")) return;
      if (e.key === "Escape") close();
    }
    addEventListener("keydown", onKey);

    current = {
      back,
      debug: () => ({ cam: camera.position.toArray(), target: controls.target.toArray(), fly: !!fly }),
      stop() {
        renderer.setAnimationLoop(null);
        removeEventListener("resize", resize);
        removeEventListener("keydown", onKey);
        renderer.dispose(); controls.dispose();
        root.remove();
      },
    };

    // The panel, top right: the distance, both systems with their glyphs, and the view buttons.
    function panel() {
      const p = el("div", "dist__panel");
      p.append(el("div", "dist__path", galaxyName || ""));
      p.append(el("div", "dist__big", fmtLy(ly)));
      const diff = b.coreLy - a.coreLy;
      p.append(el("div", "dist__sub", Math.abs(diff) < 1 ? "Both the same distance from the centre"
        : `Target is ${fmtLy(Math.abs(diff))} ${diff < 0 ? "closer to" : "farther from"} the centre`));
      for (const [s, role] of [[a, "From"], [b, "To"]]) {
        const r = el("div", "dist__sys");
        const head = el("div", "dist__sys-head");
        const dot = el("span", "dist__dot"); dot.style.background = dot.style.color = colour(s);
        head.append(el("span", "dist__role", role), dot, el("span", "dist__name", s.name));
        r.append(head);
        if (s.code) r.append(Manual.glyphRow(s.code, "glyphs--small"));
        r.append(el("div", "dist__facts", [s.regionName, `${nf.format(s.coreLy)} ly to the centre`].filter(Boolean).join(" · ")));
        p.append(r);
      }
      const btns = el("div", "dist__btns");
      const btn = (label, attr, fn) => {
        const x = el("button", "manual__btn", label); x.type = "button";
        if (attr) x.dataset.viewBtn = attr;
        if (fn) x.addEventListener("click", fn);
        btns.append(x);
      };
      btn("Galaxy", "galaxy");
      btn("Both systems", "systems");
      btn("New target", null, () => Distance.open());
      btn("Close", null, close);
      p.append(btns);
      return p;
    }
  }

  function close() {
    const back = current && current.back;
    if (current) { current.stop(); current = null; }
    App.view(back === "map" && Atlas.data ? "map" : "home");
  }

  window.DistanceView = { show, close, debug: () => current && current.debug() };
})();
