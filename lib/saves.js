"use strict";
/*
 * Saves: access to the player's NMS saves, shared by the whole site. Exposes window.Saves. Needs lib/saveformat.js.
 *
 * Nothing is uploaded: the browser only gets permission to read files locally.
 * A page can't open a typed path, so the folder is chosen once in a picker (or dropped on the page):
 *  - Chromium/Edge: File System Access API. The folder handle is kept in IndexedDB, so it's remembered between visits;
 *    after a browser restart the browser asks once more for read access (Saves.reconnect(), needs a click).
 *  - Firefox and others: a folder <input>; the files are known for this session only.
 * Single files can also be dropped (save*.hg, ideally with its mf_save*.hg); those last for this session.
 *
 *   Saves.state()            -> { status: "none" | "needs-permission" | "ready", folder, kind: "handle" | "session" }
 *   await Saves.choose()     -> pick a folder (call from a click)
 *   await Saves.useFolder(h) -> use a FileSystemDirectoryHandle (e.g. a dropped folder; remembered)
 *   Saves.useSessionFolder(name, files) -> use a folder's files for this session (e.g. dropped in Firefox)
 *   await Saves.reconnect()  -> re-grant access to the remembered folder (call from a click)
 *   await Saves.forget()
 *   Saves.addFiles(files)    -> add dropped files; returns the number of saves added
 *   await Saves.list()       -> entries, newest first:
 *        { id, name, slot, kind: "auto" | "manual", source: "folder" | "dropped", modified: Date, size,
 *          file: () => Promise<File>, manifest: () => Promise<File|null> }
 *   await Saves.meta(entry)  -> { name, summary, playTime, mode } (cached)
 *   await Saves.read(entry or name) -> ArrayBuffer of the save (still LZ4-compressed; SaveFormat.decompress)
 *   Saves.select(entry) / Saves.selected() -> the save the rest of the site works on
 *   Events on window: "saves:changed" (folder or dropped files), "saves:selected" (detail: entry)
 *
 * Slots: save.hg/save2.hg are slot 1 (auto/manual), save3.hg/save4.hg slot 2, and so on.
 */
(function () {
  const DB = "atlas", STORE = "kv", KEY = "saveFolder", SELECTED = "atlas.selectedSave";
  const SAVE_RE = /^save(\d*)\.hg$/i;
  const canPick = typeof window.showDirectoryPicker === "function";

  let handle = null;          // FileSystemDirectoryHandle (Chromium)
  let sessionFiles = null;    // File[] from <input webkitdirectory> or a dropped folder (this session only)
  let sessionName = null;
  let status = "none";
  let dropped = [];           // [{ file, manifest }]
  let selected = null;
  const metaCache = new Map();

  // --- tiny IndexedDB key/value store ---
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
  const kvGet = k => kv("readonly", s => s.get(k)).catch(() => undefined);
  const kvSet = (k, v) => kv("readwrite", s => s.put(v, k)).catch(() => {});
  const kvDel = k => kv("readwrite", s => s.delete(k)).catch(() => {});
  const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };

  function changed() { dispatchEvent(new CustomEvent("saves:changed", { detail: state() })); }

  function state() {
    if (handle) return { status, folder: handle.name, kind: "handle" };
    if (sessionFiles) return { status: "ready", folder: sessionName, kind: "session" };
    return { status: "none", folder: null, kind: null };
  }

  async function permission(h, ask) {
    const opts = { mode: "read" };
    if ((await h.queryPermission(opts)) === "granted") return true;
    return ask ? (await h.requestPermission(opts)) === "granted" : false;
  }

  async function init() {
    if (canPick) {
      const h = await kvGet(KEY);
      if (h) {
        handle = h;
        status = (await permission(h, false).catch(() => false)) ? "ready" : "needs-permission";
      }
    }
    changed();
  }

  function pickWithInput() {
    return new Promise(resolve => {
      const input = document.createElement("input");
      input.type = "file";
      input.webkitdirectory = true;
      input.multiple = true;
      input.addEventListener("change", () => resolve([...input.files]), { once: true });
      input.addEventListener("cancel", () => resolve(null), { once: true });
      input.click();
    });
  }

  async function useFolder(h) {
    handle = h; sessionFiles = null; status = "ready";
    metaCache.clear();
    await kvSet(KEY, h);
    changed();
    return state();
  }

  async function choose() {
    if (canPick) {
      let h;
      try { h = await window.showDirectoryPicker({ id: "nms-saves", mode: "read" }); }
      catch (e) { if (e.name === "AbortError") return state(); throw e; }
      return useFolder(h);
    }
    const files = await pickWithInput();
    if (!files) return state();
    const name = files.length ? files[0].webkitRelativePath.split("/")[0] : "(empty folder)";
    // only files directly in the chosen folder
    return useSessionFolder(name, files.filter(f => f.webkitRelativePath.split("/").length === 2));
  }

  // A folder known for this session only: its name and the files directly in it.
  function useSessionFolder(name, files) {
    handle = null; status = "none";
    sessionFiles = [...files]; sessionName = name;
    metaCache.clear();
    kvDel(KEY);
    changed();
    return state();
  }

  async function reconnect() {
    if (!handle) return state();
    status = (await permission(handle, true).catch(() => false)) ? "ready" : "needs-permission";
    changed();
    return state();
  }

  async function forget() {
    handle = null; sessionFiles = null; sessionName = null; status = "none";
    metaCache.clear();
    await kvDel(KEY);
    if (selected && selected.source === "folder") select(null);
    changed();
  }

  function describe(name) {
    const m = SAVE_RE.exec(name);
    if (!m) return null;
    const n = m[1] ? Number(m[1]) : 1;            // save.hg = 1, save2.hg = 2, ...
    return { slot: Math.ceil(n / 2), kind: n % 2 ? "auto" : "manual" };
  }

  function entry(source, file, d, manifest) {
    return {
      id: `${source}:${file.name}:${file.lastModified}`,
      name: file.name, ...d, source,
      modified: new Date(file.lastModified), size: file.size,
      file: async () => file, manifest,
    };
  }

  // Dropped files: saves, paired with their mf_ files when those come along. Returns the number of saves added.
  function addFiles(files) {
    files = [...files];
    const byName = new Map(files.map(f => [f.name.toLowerCase(), f]));
    let added = 0;
    for (const f of files) {
      if (!describe(f.name)) continue;
      const mf = byName.get("mf_" + f.name.toLowerCase()) || null;
      dropped = dropped.filter(x => !(x.file.name === f.name && x.file.lastModified === f.lastModified));
      dropped.push({ file: f, manifest: mf });
      added++;
    }
    if (added) changed();
    return added;
  }

  async function list() {
    const out = [];
    if (handle && status === "ready") {
      const mfs = new Map();
      const saves = [];
      for await (const [name, h] of handle.entries()) {
        if (h.kind !== "file") continue;
        if (/^mf_/i.test(name)) mfs.set(name.toLowerCase(), h);
        else if (describe(name)) saves.push([name, h]);
      }
      for (const [name, h] of saves) {
        const f = await h.getFile();
        const mf = mfs.get("mf_" + name.toLowerCase());
        const e = entry("folder", f, describe(name), async () => (mf ? mf.getFile() : null));
        e.file = () => h.getFile();
        out.push(e);
      }
    } else if (sessionFiles) {
      const top = sessionFiles;
      const byName = new Map(top.map(f => [f.name.toLowerCase(), f]));
      for (const f of top) {
        const d = describe(f.name);
        if (d) out.push(entry("folder", f, d, async () => byName.get("mf_" + f.name.toLowerCase()) || null));
      }
    }
    for (const x of dropped) out.push(entry("dropped", x.file, describe(x.file.name), async () => x.manifest));
    return out.sort((a, b) => b.modified - a.modified);
  }

  async function meta(e) {
    if (metaCache.has(e.id)) return metaCache.get(e.id);
    const p = (async () => {
      const number = SaveFormat.fileNumber(e.name);
      const mf = await e.manifest().catch(() => null);
      if (mf) {
        const m = SaveFormat.readManifest(await mf.arrayBuffer(), number);
        if (m) return m;
      }
      // No manifest: read name and play time from the save itself (the summary isn't in there).
      const s = SaveFormat.readSaveMeta(await (await e.file()).arrayBuffer());
      return { ...s, summary: "", mode: "" };
    })();
    metaCache.set(e.id, p);
    p.catch(() => metaCache.delete(e.id));
    return p;
  }

  async function read(e) {
    if (typeof e === "string") e = (await list()).find(x => x.name === e);
    if (!e) throw new Error("No such save file");
    return (await e.file()).arrayBuffer();
  }

  function select(e) {
    selected = e;
    lsSet(SELECTED, e && e.source === "folder" ? e.name : null);
    dispatchEvent(new CustomEvent("saves:selected", { detail: e }));
  }
  // The remembered choice (folder saves only), matched by file name.
  const rememberedName = () => lsGet(SELECTED);

  // Where the saves usually are: [where, path, after]. Steam adds a folder per account (st_ and the Steam ID), which we
  // can't know, so those paths stop at NMS. Windows' picker expands %APPDATA%; the Linux (GTK) picker takes ~.
  const PATHS = [
    ["Steam, Windows", "%APPDATA%\\HelloGames\\NMS", "then open the st_… folder"],
    ["GOG, Windows", "%APPDATA%\\HelloGames\\NMS\\DefaultUser"],
    ["Steam (Proton), Linux", "~/.local/share/Steam/steamapps/compatdata/275850/pfx/drive_c/users/steamuser/AppData/Roaming/HelloGames/NMS",
     "then open the st_… folder"],
    ["Heroic (GOG), Linux", "~/Games/Heroic/Prefixes/No Mans Sky/drive_c/users/steamuser/AppData/Roaming/HelloGames/NMS/DefaultUser"],
  ];

  window.Saves = { PATHS,
    state, choose, useFolder, useSessionFolder, reconnect, forget, addFiles, list, meta, read,
    select, selected: () => selected, rememberedName,
    canRemember: canPick, ready: init(),
  };
})();
