"use strict";
/*
 * GameIcons: the game's own icons, read from the player's own copy of No Man's Sky. Exposes window.GameIcons.
 *
 * The app ships no game art. The player picks GAMEDATA/PCBANKS/NMSARC.TexUI.pak from their install once; this reads
 * the textures it needs straight out of the pak (lib/hgpak.js, lib/dds.js, vendor/fzstd.js, loaded on demand), draws
 * them into sprites and keeps those in IndexedDB. Nothing leaves the computer. Without them the app shows plain
 * placeholders (CSS keys on html.game-icons).
 *
 * Item icons: any <canvas data-icon="n"> in the page gets icon n drawn into it (n is the place in SheetData.icons.paths;
 * the sprite has SheetData.icons.cols per row), also canvases added later. Not a CSS sprite: Firefox with GPU
 * rendering showed nothing for the 42×-scaled background.
 * Small sprites, as CSS custom properties on <html>:
 *   --glyphs-sprite  the 16 portal glyphs 0–F in one row
 *   --pirate-sprite, --blackhole-sprite  the map's badges
 *
 * Events: "gameicons:changed" with GameIcons.state() as detail.
 */
(function () {

  const DB = "nms-game-assets", STORE = "kv", KEY = "sprites-v1";
  const GLYPH_CELL = 96, BADGE_CELL = 64;
  const GLYPHS = [..."0123456789abcdef"].map(h => `textures/ui/frontend/icons/update3/portalsymbol.${h}.dds`);
  const BADGES = {
    pirate: "textures/ui/frontend/icons/discovery/system.conflictpirate.dds",   // Discoveries' pirate system
    blackhole: "textures/ui/frontend/icons/missions/gmap.blackhole.dds",        // the galaxy map's black hole
  };
  const PAK_NAME = "NMSARC.TexUI.pak", PAK_FILTER = ".TexUI.pak";
  // Where the pak usually is: [store, path]. "~" works in the Linux (GTK) picker's location bar (Ctrl+L).
  const PAK_PATHS = [
    ["Steam, Windows", "C:\\Program Files (x86)\\Steam\\steamapps\\common\\No Man's Sky\\GAMEDATA\\PCBANKS\\NMSARC.TexUI.pak"],
    ["GOG Galaxy, Windows", "C:\\Program Files (x86)\\GOG Galaxy\\Games\\No Man's Sky\\GAMEDATA\\PCBANKS\\NMSARC.TexUI.pak"],
    ["Steam, Linux", "~/.local/share/Steam/steamapps/common/No Man's Sky/GAMEDATA/PCBANKS/NMSARC.TexUI.pak"],
    ["Heroic (GOG), Linux", "~/Games/Heroic/No Man's Sky/GAMEDATA/PCBANKS/NMSARC.TexUI.pak"],
  ];

  let st = { status: "none" };      // none | ready | stale | working | error
  const urls = {};

  // --- IndexedDB, one record ---
  function db() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function kv(mode, fn) {
    const d = await db();
    return new Promise((res, rej) => {
      const tx = d.transaction(STORE, mode), req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => res(req && req.result);
      tx.onerror = () => rej(tx.error);
    });
  }

  function set(next) {
    st = next;
    dispatchEvent(new CustomEvent("gameicons:changed", { detail: state() }));
  }
  const state = () => Object.assign({}, st);

  // What this version of the app wants from the pak; a record built for another list is stale.
  function wanted() {
    const I = window.SheetData && SheetData.icons;
    const paths = I ? I.paths : [];
    let h = 0;
    for (const s of [...paths, ...GLYPHS, ...Object.values(BADGES)]) for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return { paths, cell: I ? I.cell : 64, cols: I ? I.cols : 1, rows: I ? I.rows : 1, key: (h >>> 0).toString(36) + "." + paths.length };
  }

  // ---- item icons into canvases ----
  let bitmap = null, observer = null;

  function paint(root) {
    if (!bitmap || !root.querySelectorAll) return;
    const I = SheetData.icons;
    const list = root.matches && root.matches("canvas[data-icon]") ? [root] : root.querySelectorAll("canvas[data-icon]");
    for (const c of list) {
      const n = +c.dataset.icon, ctx = c.getContext("2d");
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(bitmap, (n % I.cols) * I.cell, Math.floor(n / I.cols) * I.cell, I.cell, I.cell, 0, 0, c.width, c.height);
    }
  }

  function watch() {
    if (observer) return;
    observer = new MutationObserver(muts => {
      for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) paint(n);
    });
    observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
  }

  function apply(rec) {
    for (const k in urls) { URL.revokeObjectURL(urls[k]); delete urls[k]; }
    const root = document.documentElement;
    for (const k of ["glyphs", ...Object.keys(BADGES)]) root.style.removeProperty(`--${k}-sprite`);
    root.classList.remove("game-icons");
    if (bitmap && bitmap.close) bitmap.close();
    bitmap = null;
    if (!rec) return;
    createImageBitmap(rec.icons).then(b => { bitmap = b; paint(document); watch(); })
      .catch(e => console.error("GameIcons: couldn't decode the icon sprite", e));
    urls.glyphs = URL.createObjectURL(rec.glyphs);
    for (const [k, b] of Object.entries(rec.badges || {})) urls[k] = URL.createObjectURL(b);
    for (const [k, u] of Object.entries(urls)) root.style.setProperty(`--${k}-sprite`, `url("${u}")`);
    root.classList.add("game-icons");
  }

  async function init() {
    let rec;
    try { rec = await kv("readonly", s => s.get(KEY)); } catch { rec = null; }
    if (!rec) return set({ status: "none" });
    apply(rec);
    set({ status: rec.key === wanted().key ? "ready" : "stale", count: rec.count, date: rec.date, pak: rec.pak });
  }

  // --- extraction ---
  function loadScript(src) {
    return new Promise((res, rej) => {
      if (document.querySelector(`script[data-src="${src}"]`)) return res();
      const s = document.createElement("script");
      s.src = src; s.dataset.src = src;
      s.onload = res; s.onerror = () => rej(new Error(`Couldn't load ${src}`));
      document.head.append(s);
    });
  }

  function canvas(w, h) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    return c;
  }
  const toBlob = c => new Promise((res, rej) =>
    c.toBlob(b => b ? res(b) : c.toBlob(p => p ? res(p) : rej(new Error("Couldn't encode the sprite")), "image/png"), "image/webp", 0.85));

  // One texture, drawn into ctx at (x, y) scaled to size × size. False if the pak lacks it.
  async function draw(pak, path, ctx, x, y, size) {
    if (!pak.has(path)) return false;
    const info = DDS.info(await pak.read(path, 0, Math.min(148, pak.size(path))));
    const m = DDS.mipFor(info, size);
    const px = DDS.decode(info, await pak.read(path, m.offset, m.length), m.width, m.height);
    const tmp = canvas(m.width, m.height);
    tmp.getContext("2d").putImageData(new ImageData(px, m.width, m.height), 0, 0);
    ctx.drawImage(tmp, x, y, size, size);
    return true;
  }

  async function extract(file) {
    const w = wanted();
    if (!w.paths.length) throw new Error("The app's icon list is missing (lib/sheetdata.js)");
    set({ status: "working", done: 0, total: w.paths.length + GLYPHS.length });
    await loadScript("vendor/fzstd.js");
    await loadScript("lib/hgpak.js");
    await loadScript("lib/dds.js");
    const pak = await HGPak.open(file);
    if (!GLYPHS.every(p => pak.has(p))) throw new Error(`That pak doesn't hold the UI icons. Choose ${PAK_NAME}.`);

    const sheet = canvas(w.cols * w.cell, w.rows * w.cell), sctx = sheet.getContext("2d");
    sctx.imageSmoothingQuality = "high";
    let done = 0, count = 0, last = 0;
    const tick = () => {
      done++;
      if (Date.now() - last > 120) { last = Date.now(); set({ status: "working", done, total: st.total }); }
    };
    for (let n = 0; n < w.paths.length; n++) {
      try { if (await draw(pak, w.paths[n], sctx, (n % w.cols) * w.cell, Math.floor(n / w.cols) * w.cell, w.cell)) count++; }
      catch (e) { console.warn("GameIcons:", w.paths[n], e); }
      tick();
      if (n % 50 === 49) await new Promise(r => setTimeout(r));   // let the page repaint
    }
    const glyphs = canvas(GLYPH_CELL * 16, GLYPH_CELL), gctx = glyphs.getContext("2d");
    gctx.imageSmoothingQuality = "high";
    for (let i = 0; i < 16; i++) { await draw(pak, GLYPHS[i], gctx, i * GLYPH_CELL, 0, GLYPH_CELL); tick(); }
    const badges = {};
    for (const [k, p] of Object.entries(BADGES)) {
      const c = canvas(BADGE_CELL, BADGE_CELL), ctx = c.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      if (await draw(pak, p, ctx, 0, 0, BADGE_CELL).catch(() => false)) badges[k] = await toBlob(c);
    }
    const rec = {
      key: w.key, count, date: new Date().toISOString(), pak: file.name || PAK_NAME,
      icons: await toBlob(sheet), glyphs: await toBlob(glyphs), badges,
    };
    await kv("readwrite", s => s.put(rec, KEY)).catch(() => {});   // without IndexedDB they last until reload
    apply(rec);
    set({ status: "ready", count, date: rec.date, pak: rec.pak });
  }

  // Ask for the pak and read it. Resolves when done; errors land in state().
  function choose() {
    return new Promise(res => {
      const input = document.createElement("input");
      input.type = "file";
      // Pickers only filter by ending; of the ~100 paks in PCBANKS only this one ends in .TexUI.pak.
      input.accept = PAK_FILTER;
      input.onchange = async () => {
        const f = input.files && input.files[0];
        if (!f) return res();
        const before = st;
        try { await extract(f); }
        catch (e) { console.error(e); set(Object.assign({}, before.status === "working" ? { status: "none" } : before, { error: e.message })); }
        res();
      };
      input.click();
    });
  }

  async function forget() {
    await kv("readwrite", s => s.delete(KEY)).catch(() => {});
    apply(null);
    set({ status: "none" });
  }

  window.GameIcons = { init, choose, forget, state, paint, PAK_NAME, PAK_PATHS };
  init();
})();
