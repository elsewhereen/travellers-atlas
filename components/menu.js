"use strict";
/*
 * Burger menu. Exposes window.Menu. Needs card.css (colours, fonts) and card.js (icons).
 *
 *   Menu.init({
 *     title: "Traveller's Atlas", subtitle: "…",
 *     items:  [{ id, icon, label, hint, disabled, onSelect }],   // top of the panel
 *     footer: [{ id, icon, label, hint, onSelect }],             // pinned to the bottom (Settings)
 *   });
 *   Menu.open() / Menu.close() / Menu.toggle()
 *   Menu.badge(id, on)    // a small dot after an item's label, e.g. "settings need attention"
 *   Menu.enable(id, on)   // enable or disable an item
 */
(function () {
  const ICONS = {
    settings: '<g fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/><circle cx="12" cy="12" r="6.5"/></g>',
    saves: '<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 4h12l4 4v12H4z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/></g>',
    reload: '<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/></g>',
    search: '<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5.5 5.5"/></g>',
    address: '<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M7.5 13.5a4.5 4.5 0 0 1 9 0M12 4.5v4M8 16.5h8"/></g>',
    distance: '<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="5.5" cy="17.5" r="2.2"/><circle cx="18.5" cy="6.5" r="2.2"/><path d="M7.3 16l9.4-8" stroke-dasharray="2.2 2.4"/></g>',
    sheet: '<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 2.8l8 4.6v9.2l-8 4.6-8-4.6V7.4z"/><circle cx="12" cy="10" r="2.6"/><path d="M7.6 16.4a5 5 0 0 1 8.8 0"/></g>',
    map: '<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/></g>',
  };

  let root, items = {};

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function iconSpan(name) {
    const svg = ICONS[name] || (window.Card && Card.icons[name]) || name || "";
    const s = el("span", "card__icon");
    s.innerHTML = `<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">${svg}</svg>`;
    return s;
  }

  function item(it) {
    const b = el("button", "menu-item");
    b.type = "button";
    const label = el("span", "menu-item__label", it.label);
    b.append(iconSpan(it.icon), label);
    if (it.hint) b.append(el("span", "menu-item__hint", it.hint));
    if (it.disabled) b.disabled = true;
    b.addEventListener("click", () => { close(); it.onSelect && it.onSelect(); });
    if (it.id) items[it.id] = { button: b, label };
    return b;
  }

  function init(o) {
    root = document.body;
    const button = el("button", "menu-button");
    button.type = "button";
    button.setAttribute("aria-label", "Menu");
    button.setAttribute("aria-expanded", "false");
    button.append(el("span"), el("span"), el("span"));
    button.addEventListener("click", toggle);

    const panel = el("nav", "menu-panel");
    panel.setAttribute("aria-label", "Main menu");
    const head = el("header", "menu-panel__head");
    head.append(el("h1", "menu-panel__title", o.title || ""));
    if (o.subtitle) head.append(el("p", "menu-panel__subtitle", o.subtitle));
    const body = el("div", "menu-panel__body");
    const top = el("div", "menu-panel__group");
    (o.items || []).forEach(it => top.append(item(it)));
    const foot = el("div", "menu-panel__group menu-panel__group--footer");
    (o.footer || []).forEach(it => foot.append(item(it)));
    body.append(top, foot);
    panel.append(head, body);
    document.body.append(panel, button);

    addEventListener("keydown", e => { if (e.key === "Escape" && isOpen()) close(); });
    addEventListener("pointerdown", e => {
      if (isOpen() && !panel.contains(e.target) && !button.contains(e.target)) close();
    }, true);
    Menu.button = button;
  }

  const isOpen = () => root && root.classList.contains("menu-open");
  function open() { const h = root.querySelector(".menu-panel__head"); if (h && window.Card) Card.tint(h); root.classList.add("menu-open"); Menu.button.setAttribute("aria-expanded", "true"); }
  function close() { root.classList.remove("menu-open"); Menu.button && Menu.button.setAttribute("aria-expanded", "false"); }
  function toggle() { isOpen() ? close() : open(); }

  function badge(id, on) {
    const it = items[id];
    if (!it) return;
    let dot = it.label.querySelector(".menu-item__badge");
    if (on && !dot) it.label.append(el("span", "menu-item__badge"));
    if (!on && dot) dot.remove();
  }

  function enable(id, on) {
    const it = items[id];
    if (it) it.button.disabled = !on;
  }

  const Menu = { init, open, close, toggle, badge, enable, isOpen };
  window.Menu = Menu;
})();
