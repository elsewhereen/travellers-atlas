"use strict";
/*
 * App: views and opening a save. Exposes window.App.
 *   App.open(entry)  -> loader, Atlas.build, then the map (entry: a save, or Manual.entry() for typed addresses)
 *   App.reload()     -> the open save again, re-read from disk (the newest version of the same file)
 *   App.view("home" | "map" | "sheet")
 * While the map is shown it checks, on focus and every 20 s, whether the game has written a newer version of
 * the open save, and offers a reload.
 */
(function () {
  let loading = false;
  let loaded = null;   // { name, source, modified } of the save on the map

  function view(name) {
    if ((name === "map" || name === "sheet") && !Atlas.data) name = "home";
    if (name === "sheet") { if (SheetView.show(Atlas.data)) return checkNewer(); name = "map"; }
    document.body.dataset.view = name;
    if (name === "home") dispatchEvent(new CustomEvent("saves:refresh"));
    if (name === "map") checkNewer();
  }

  async function open(entry) {
    if (loading || !entry) return;
    loading = true;
    const wasSheet = document.body.dataset.view === "sheet";
    let meta;
    if (entry.manual) meta = { name: "Entered by hand", summary: `${entry.log.systems.length} addresses` };
    else { Saves.select(entry); meta = await Saves.meta(entry).catch(() => ({})); }
    // A remembered Nearby filter: generate those systems while the loader shows, not after the map opens.
    const nearby = window.Search && Search.preloadRadius ? Search.preloadRadius() : 0;
    const l = Loader.show({
      title: meta.name || `Slot ${entry.slot}`,
      subtitle: meta.summary || entry.name,
      steps: Atlas.steps({ nearby }),
    });
    try {
      await Atlas.build(entry, (id, state, note) => l.set(id, state, note), { nearby });
      loaded = entry.manual ? { manual: true } : { name: entry.name, source: entry.source, modified: +entry.modified };
      hideNotice();
      Menu.enable("map", true);
      Menu.enable("search", true);
      Menu.enable("reload", true);
      Menu.enable("sheet", !!Atlas.data.player);
      view(wasSheet && Atlas.data.player ? "sheet" : "map");
      l.done();
    } catch (e) {
      console.error(e);
      l.fail(() => view(Atlas.data ? "map" : "home"));
    } finally {
      loading = false;
    }
  }

  // The newest entry for the save that is open (folder saves are re-listed from disk).
  async function current() {
    if (!loaded) return null;
    if (loaded.manual) return window.Manual ? Manual.entry() : null;
    const list = await Saves.list().catch(() => []);
    return list.find(e => e.name === loaded.name && e.source === loaded.source) || null;
  }

  async function reload() {
    const e = await current();
    if (e) return open(e);
  }

  // ---- "Your save has changed" notice on the map
  let notice = null;
  function showNotice(e) {
    if (!notice) {
      notice = document.createElement("div");
      notice.className = "save-notice";
      notice.setAttribute("role", "status");
      const text = document.createElement("span");
      const b = document.createElement("button");
      b.type = "button"; b.className = "filter__btn"; b.textContent = "Reload";
      b.addEventListener("click", reload);
      const x = document.createElement("button");
      x.type = "button"; x.className = "save-notice__x"; x.setAttribute("aria-label", "Dismiss"); x.textContent = "×";
      x.addEventListener("click", () => { if (loaded) loaded.dismissed = +notice.dataset.modified; hideNotice(); });
      notice.append(text, b, x);
      document.body.append(notice);
    }
    const mins = Math.max(0, Math.round((Date.now() - e.modified) / 60000));
    notice.firstChild.textContent = `The game has saved since you opened this (${mins ? mins + " min ago" : "just now"}).`;
    notice.dataset.modified = +e.modified;
    notice.hidden = false;
  }
  function hideNotice() { if (notice) notice.hidden = true; }

  async function checkNewer() {
    if (!loaded || loading || loaded.source !== "folder" || !/^(map|sheet)$/.test(document.body.dataset.view)) return;
    const e = await current();
    if (e && +e.modified > loaded.modified && +e.modified !== loaded.dismissed) showNotice(e);
  }
  addEventListener("focus", checkNewer);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) checkNewer(); });
  setInterval(() => { if (!document.hidden) checkNewer(); }, 20000);

  window.App = { open, reload, view };
})();
