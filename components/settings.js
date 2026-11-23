"use strict";
/*
 * Settings pop-up (a Card) with two tabs: Saves (the save folder) and Icons (the game's icons).
 * Exposes window.Settings.open(tab?) with tab "saves" or "icons". Needs card.js, lib/saves.js and lib/gameicons.js.
 * Re-renders itself when either changes, staying on its tab.
 */
(function () {

  let handle = null;
  let tab = "saves";
  const TABS = [["saves", "Saves"], ["icons", "Icons"]];

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function field(label, value, tone) {
    const f = el("div", "card__field");
    const v = el("div", "card__field-value", value);
    if (tone) v.dataset.tone = tone;
    f.append(el("div", "card__field-label", label), v);
    return f;
  }

  function tabBar() {
    const bar = el("div", "card__tabs");
    bar.setAttribute("role", "tablist");
    for (const [id, label] of TABS) {
      const b = el("button", "card__tab", label);
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(id === tab));
      b.addEventListener("click", () => { if (tab !== id) { tab = id; render(true); } });
      bar.append(b);
    }
    return bar;
  }

  function savesContent(st, saves) {
    const box = el("div");
    if (st.status === "none") {
      box.append(field("Save folder", "Not chosen", "none"));
      const note = el("p", "card__note");
      note.append("Choose the folder that holds ", el("code", null, "save.hg"), ". It's ",
        el("code", null, "AppData/Roaming/HelloGames/NMS/"), " followed by ", el("code", null, "st_…"),
        " (Steam) or ", el("code", null, "DefaultUser"), " (GOG). On Linux it's inside the game's Proton/Wine prefix; ",
        "Ctrl+H shows hidden folders in the picker. Nothing leaves your computer.");
      box.append(note, Card.paths(Saves.PATHS, "folder picker", true));
    } else {
      box.append(field("Save folder", st.folder, st.status === "ready" ? "ok" : "warn"));
      if (st.status === "needs-permission") {
        box.append(el("p", "card__note", "The browser needs your OK to read this folder again after a restart."));
      } else if (saves && !saves.length) {
        box.append(el("p", "card__note", "There are no save files (save.hg …) in this folder. Is it the right one?"));
      }
      if (st.kind === "session") {
        box.append(el("p", "card__note", "This browser can't remember folders, so you'll need to choose it again next time. Chromium-based browsers remember it."));
      }
      box.append(Card.paths(Saves.PATHS, "folder picker", st.kind === "session"));
    }
    return box;
  }

  // The game's own icons, read from the player's install (lib/gameicons.js).
  function iconsContent(g) {
    const box = el("div");
    const name = el("code", null, GameIcons.PAK_NAME);
    if (g.status === "working") {
      box.append(field("Game icons", `Reading… ${g.done || 0} of ${g.total || "?"}`, "warn"));
    } else if (g.status === "ready" || g.status === "stale") {
      box.append(field("Game icons", `${g.count} icons from ${g.pak}`, g.status === "ready" ? "ok" : "warn"));
      if (g.status === "stale") box.append(el("p", "card__note", "This version of the app uses more icons. Load them again to get the new ones."));
    } else {
      box.append(field("Game icons", "Not loaded", "none"));
    }
    if (g.error) box.append(el("p", "card__note", g.error));
    if (g.status !== "ready" && g.status !== "working") {
      const note = el("p", "card__note");
      note.append("The app doesn't ship the game's art. To see the game's own icons, choose ", name,
        " in your game folder under ", el("code", null, "GAMEDATA/PCBANKS/"),
        ". The app reads the icons it needs from it and keeps them in this browser. Nothing leaves your computer.");
      box.append(note, Card.paths(GameIcons.PAK_PATHS, "file picker", true));
    }
    return box;
  }

  async function render(still) {
    const st = Saves.state(), g = GameIcons.state();
    const saves = tab === "saves" && st.status === "ready" ? await Saves.list().catch(() => []) : null;
    const actions = [];
    const body = el("div");
    body.append(tabBar());
    const panel = el("div", "card__tabpanel");
    panel.setAttribute("role", "tabpanel");
    if (tab === "saves") {
      panel.append(savesContent(st, saves));
      if (st.status === "needs-permission") {
        actions.push({ key: "G", label: "Grant access", hint: "Let the browser read the remembered folder", onSelect: () => Saves.reconnect() });
      }
      actions.push({ key: "F", label: st.status === "none" ? "Choose folder" : "Change folder",
                     hint: "Pick your No Man's Sky save folder", onSelect: () => Saves.choose() });
      if (st.status !== "none") {
        actions.push({ key: "X", label: "Forget folder", hint: "Stop using this folder", onSelect: () => Saves.forget() });
      }
    } else {
      panel.append(iconsContent(g));
      if (g.status !== "working") {
        actions.push({ key: "I", label: g.status === "none" ? "Load game icons" : "Reload game icons",
                       hint: `Pick ${GameIcons.PAK_NAME} from your game folder`, onSelect: () => GameIcons.choose() });
      }
      if (g.status === "ready" || g.status === "stale") {
        actions.push({ key: "R", label: "Remove icons", hint: "Delete the icons stored in this browser", onSelect: () => GameIcons.forget() });
      }
    }
    body.append(panel);
    handle = Card.popup({
      title: "Settings",
      subtitle: "Stored in this browser only",
      width: "32em",
      content: body,
      actions,
      onClose: () => { handle = null; },
    }, { still });
  }

  addEventListener("saves:changed", () => { if (handle && handle.el.isConnected) render(true); });
  addEventListener("gameicons:changed", () => { if (handle && handle.el.isConnected) render(true); });

  window.Settings = { open: t => { if (t) tab = t; render(false); } };
})();
