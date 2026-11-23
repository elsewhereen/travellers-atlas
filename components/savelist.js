"use strict";
/*
 * SaveList: the front page's list of saves, newest first, plus drag & drop of save files or the save folder.
 * Exposes window.SaveList.mount(parent). Needs card.css/card.js, lib/saves.js, lib/saveformat.js.
 * Clicking a save opens it (App.open): loader, then the map.
 */
(function () {
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  function fmtDate(d) {
    const s = (Date.now() - d) / 1000;
    if (s < 60) return "just now";
    if (s < 3600) return rtf.format(-Math.round(s / 60), "minute");
    if (s < 86400) return rtf.format(-Math.round(s / 3600), "hour");
    if (s < 7 * 86400) return rtf.format(-Math.round(s / 86400), "day");
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  }
  const fullDate = d => d.toLocaleString("en-GB", { dateStyle: "full", timeStyle: "short" });
  function fmtPlay(sec) {
    if (sec == null) return "";
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
    return h ? `${h} h ${String(m).padStart(2, "0")} m played` : `${m} m played`;
  }

  // An action row in the card style, without a card around it.
  function action(key, label, hint, run) {
    const b = el("button", "card__action");
    b.type = "button";
    b.append(el("span", "card__key", key), el("span", "card__label", label));
    if (hint) b.append(el("span", "card__hint", hint));
    b.addEventListener("click", run);
    b.dataset.key = key.toLowerCase();
    return b;
  }

  let root, scroll, where, foot, renderToken = 0, message = "";

  function emptyState(st) {
    const box = el("div", "savelist__empty");
    const acts = el("div", "card__actions");
    if (st.status === "needs-permission") {
      box.append(el("h2", null, "Access needed"));
      box.append(el("p", null, `Your save folder (${st.folder}) is remembered, but after a restart the browser needs your OK to read it again.`));
      acts.append(action("G", "Grant access", "Let the browser read the folder", () => Saves.reconnect()));
    } else if (st.status === "ready") {
      box.append(el("h2", null, "No saves here"));
      box.append(el("p", null, `There are no save files (save.hg, save2.hg …) in ${st.folder}. Is it the right folder?`));
      acts.append(action("F", "Change folder", "Pick your No Man's Sky save folder", () => Saves.choose()));
    } else {
      box.append(el("h2", null, "Where are your saves?"));
      box.append(el("p", null, "Point the atlas to your No Man's Sky save folder in Settings, where the usual places are listed. " +
        "The files are only read here in your browser; nothing is uploaded."));
      acts.append(action("S", "Settings", "Choose your save folder", () => Settings.open("saves")));
    }
    box.append(acts);
    return box;
  }

  function row(e, selectedId) {
    const b = el("button", "save");
    b.type = "button";
    b.setAttribute("aria-pressed", String(e.id === selectedId));
    b.title = `${e.name} · saved ${fullDate(e.modified)}`;

    const slot = el("span", "save__slot");
    slot.append(el("span", "save__slot-label", "Slot"), el("span", "save__slot-number", String(e.slot)),
                el("span", "save__kind", e.kind));
    const main = el("span", "save__main");
    const name = el("div", "save__name", "…");
    const summary = el("div", "save__summary", "");
    main.append(name, summary);
    const side = el("span", "save__side");
    const time = el("div", "save__time", "");
    side.append(el("div", "save__date", fmtDate(e.modified)), time);
    b.append(slot, main, side);

    Saves.meta(e).then(m => {
      if (m.name) name.textContent = m.name;
      else { name.textContent = "Unnamed save"; name.classList.add("save__name--unnamed"); }
      if (e.source === "dropped") name.append(el("span", "save__tag", "dropped"));
      summary.textContent = m.summary || (e.source === "dropped" ? "Drop its mf_ file too to see where it is" : "");
      time.textContent = fmtPlay(m.playTime);
    }).catch(() => {
      name.textContent = e.name;
      summary.textContent = "Couldn't read this file";
    });

    b.addEventListener("click", () => App.open(e));
    return b;
  }

  async function render() {
    const token = ++renderToken;
    const st = Saves.state();
    const saves = await Saves.list().catch(() => []);
    if (token !== renderToken) return;

    // Restore the remembered choice once the folder is readable.
    let sel = Saves.selected();
    if (sel && !saves.some(x => x.id === sel.id)) sel = null;
    if (!sel) {
      const name = Saves.rememberedName();
      const again = name && saves.find(x => x.source === "folder" && x.name === name);
      if (again) { Saves.select(again); return; }    // re-renders via saves:selected
    }

    scroll.replaceChildren();
    where.textContent = st.folder ? `Folder: ${st.folder}` : "";
    if (!saves.length) {
      scroll.append(emptyState(st));
    } else {
      const ul = el("ul", "savelist__items");
      for (const e of saves) { const li = el("li"); li.append(row(e, sel && sel.id)); ul.append(li); }
      scroll.append(ul);
      if (st.status !== "ready" && st.status !== "none") scroll.append(emptyState(st));
    }
    if (window.Manual) scroll.append(Manual.homeBlock());   // no save: type the address instead
    foot.replaceChildren();
    if (message) foot.append(el("span", "savelist__message", message + " "));
    foot.append(saves.length || st.status === "ready"
      ? "Drop save files here to add them, or a folder to use it."
      : "…or drop a save file (save.hg with its mf_save.hg) or the whole folder anywhere on the page.");
  }

  function say(text) { message = text; render(); setTimeout(() => { if (message === text) { message = ""; render(); } }, 6000); }

  // The files directly in a dropped folder (FileSystemDirectoryEntry), not in subfolders.
  async function readDirEntry(dir) {
    const reader = dir.createReader(), all = [];
    for (;;) {
      const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
      if (!batch.length) break;
      all.push(...batch);
    }
    const files = all.filter(x => x.isFile);
    return Promise.all(files.map(f => new Promise((res, rej) => f.file(res, rej))));
  }

  function setupDrop() {
    const zone = el("div", "dropzone", "Drop save files or your save folder");
    document.body.append(zone);
    let depth = 0;
    const hasFiles = e => [...(e.dataTransfer?.types || [])].includes("Files");
    addEventListener("dragenter", e => { if (!hasFiles(e)) return; e.preventDefault(); depth++; zone.classList.add("dropzone--on"); });
    addEventListener("dragleave", e => { if (!hasFiles(e)) return; if (--depth <= 0) { depth = 0; zone.classList.remove("dropzone--on"); } });
    addEventListener("dragover", e => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } });
    addEventListener("drop", async e => {
      if (!hasFiles(e)) return;
      e.preventDefault(); depth = 0; zone.classList.remove("dropzone--on");
      // Everything must be taken from the DataTransfer before the first await; it's emptied after that.
      const items = [...e.dataTransfer.items].filter(i => i.kind === "file");
      const files = [...e.dataTransfer.files];
      const handles = items.map(i => (i.getAsFileSystemHandle ? i.getAsFileSystemHandle().catch(() => null) : null));
      const entries = items.map(i => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null));

      // A folder: Chromium gives a handle that can be remembered; other browsers an entry for this session.
      const dirHandle = (await Promise.all(handles)).find(h => h && h.kind === "directory");
      if (dirHandle) { await Saves.useFolder(dirHandle); say(`Using the folder ${dirHandle.name}.`); return; }
      const dirEntry = entries.find(x => x && x.isDirectory);
      if (dirEntry) {
        const found = await readDirEntry(dirEntry);
        Saves.useSessionFolder(dirEntry.name, found);
        say(`Using the folder ${dirEntry.name} for this visit (this browser can't remember it).`);
        return;
      }
      const n = Saves.addFiles(files);
      if (!n) say("No save files in that drop. Save files are named save.hg, save2.hg …");
      else {
        const newest = (await Saves.list()).find(x => x.source === "dropped");
        if (newest) App.open(newest);
      }
    });
  }

  function mount(parent = document.body) {
    root = el("section", "savelist");
    root.setAttribute("aria-label", "Saves");
    const head = el("div", "savelist__head");
    where = el("span", "savelist__where");
    const refresh = el("button", "savelist__refresh");
    refresh.type = "button"; refresh.title = "Refresh the list";
    refresh.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/></g></svg>';
    refresh.append(el("span", null, "Refresh"));
    refresh.addEventListener("click", () => { refresh.classList.add("savelist__refresh--spin"); render().finally(() => setTimeout(() => refresh.classList.remove("savelist__refresh--spin"), 400)); });
    head.append(el("h2", "savelist__heading", "Saves"), where, refresh);
    scroll = el("div", "savelist__scroll");
    foot = el("div", "savelist__foot");
    root.append(head, scroll, foot);
    parent.append(root);
    setupDrop();

    addEventListener("saves:changed", render);
    addEventListener("saves:selected", render);
    addEventListener("manual:changed", render);
    // New saves from the game: look again when the list is shown or the window comes back.
    addEventListener("saves:refresh", render);
    addEventListener("focus", () => { if (document.body.dataset.view === "home") render(); });
    document.addEventListener("visibilitychange", () => { if (!document.hidden && document.body.dataset.view === "home") render(); });
    // Keys for the empty state's actions, when no pop-up is open.
    addEventListener("keydown", e => {
      if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector(".card--popup")) return;
      const b = scroll.querySelector(`.card__action[data-key="${e.key.toLowerCase()}"]`);
      if (b) { e.preventDefault(); b.click(); }
    });
    Saves.ready.then(render);
    setInterval(() => { if (!document.hidden) render(); }, 60000);   // keep "x minutes ago" fresh, catch new saves
  }

  window.SaveList = { mount };
})();
