"use strict";
/*
 * Card component (plain script so it works from file://). Exposes window.Card.
 *
 *   const el = Card.create({
 *     title: "Ketotsda V",
 *     subtitle: "Eojean-Sen IX · Dissonant",          // optional
 *     kind: "Lush Planet",                             // optional line above the list
 *     items: [{ icon: "plant", label: "Star Bulb", tone: "plant" }, ...],
 *     content: node or () => node,                     // optional free content, after the list
 *     actions: [{ key: "V", label: "View", hint: "…", onSelect: card => {...} }, ...],
 *     onClose: () => {...},
 *   });
 *   Card.popup(options, { x, y })   // shows a card at a point (centred without one), kept on screen;
 *                                   // returns a handle with close(). { still: true } skips the entry animation.
 *   Option width: CSS width in em (follows the card size), e.g. "32em".
 *
 * Icons: plant, signal, element, gas, warning, star, ship, sentinel, or raw SVG markup (string starting with "<").
 * Tones: plant, common, uncommon, rare, special, danger, info (default).
 */
(function () {
  const ICONS = {
    plant:   '<path d="M12 22V6M12 9c-3-1-4-3-4-5 3 0 4 2 4 5zm0 0c3-1 4-3 4-5-3 0-4 2-4 5zm0 5c-3-1-4.5-3-4.5-5.5 3 .3 4.5 2.5 4.5 5.5zm0 0c3-1 4.5-3 4.5-5.5-3 .3-4.5 2.5-4.5 5.5zm0 5c-3-1-4.5-3-4.5-5.5 3 .3 4.5 2.5 4.5 5.5zm0 0c3-1 4.5-3 4.5-5.5-3 .3-4.5 2.5-4.5 5.5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
    signal:  '<g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M3 9.5a13 13 0 0 1 18 0"/><path d="M6.5 13a8 8 0 0 1 11 0"/></g><circle cx="12" cy="17" r="2" fill="currentColor"/>',
    element: '<path d="M12 2l2.6 7.4L22 12l-7.4 2.6L12 22l-2.6-7.4L2 12l7.4-2.6z" fill="currentColor"/><path d="M12 7v10M7 12h10" stroke="#000" stroke-width="1.4"/>',
    gas:     '<g fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="14" r="5"/><circle cx="16" cy="9" r="4"/><circle cx="17" cy="17" r="2.5"/></g>',
    warning: '<path d="M12 3l10 18H2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 10v5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="18" r="1.3" fill="currentColor"/>',
    star:    '<circle cx="12" cy="12" r="4.5" fill="currentColor"/><g stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/></g>',
    ship:    '<path d="M12 2l3 9 7 4-7 1-3 6-3-6-7-1 7-4z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
    sentinel:'<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="3" fill="currentColor"/>',
  };

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function icon(name) {
    const span = el("span", "card__icon");
    const svg = name && name.trim().startsWith("<") ? name : ICONS[name] || ICONS.element;
    span.innerHTML = svg.startsWith("<svg") ? svg : `<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">${svg}</svg>`;
    return span;
  }

  // A random nebula colour for a header band (from the sky generator, if present). System cards use their star instead.
  function tint(head) {
    const t = window.Sky ? Sky.randomTint() : { nebula: [0.36, 0.4, 0.8], wisps: [0.6, 0.35, 0.8] };
    const mix = (c, share) => c.map((v, i) => Math.round(v * 255 * share + [16, 17, 28][i] * (1 - share))).join(",");
    head.style.background = `linear-gradient(100deg, rgba(${mix(t.nebula, 0.42)}, 0.92), rgba(${mix(t.wisps, 0.3)}, 0.9))`;
    head.style.borderBottomColor = `rgba(${t.nebula.map(v => Math.round(v * 255)).join(",")}, 0.6)`;
  }

  function create(o) {
    const card = el("article", "card");
    if (o.width) card.style.width = o.width;
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", o.title || "Card");

    const head = el("header", "card__head");
    if (o.tint !== false) tint(head);
    head.append(el("h2", "card__title", o.title || ""));
    if (o.subtitle) head.append(el("p", "card__subtitle", o.subtitle));
    if (o.onClose !== false) {
      const close = el("button", "card__close");
      close.setAttribute("aria-label", "Close");
      close.addEventListener("click", () => card.dispatchEvent(new CustomEvent("card:close")));
      head.append(close);
    }
    card.append(head);

    const body = el("div", "card__body");
    if (o.kind) body.append(el("p", "card__kind", o.kind));

    if (o.items && o.items.length) {
      const ul = el("ul", "card__items");
      for (const it of o.items) {
        const li = el("li", "card__item");
        if (it.tone) li.dataset.tone = it.tone;
        li.append(icon(it.icon), el("span", "card__item-label", it.label));
        if (it.title) li.title = it.title;
        ul.append(li);
      }
      body.append(ul);
    }

    if (o.content) body.append(typeof o.content === "function" ? o.content() : o.content);

    const keys = {};
    if (o.actions && o.actions.length) {
      const box = el("div", "card__actions");
      for (const a of o.actions) {
        const b = el("button", "card__action");
        b.type = "button";
        b.append(el("span", "card__key", a.key || ""), el("span", "card__label", a.label));
        if (a.hint) b.append(el("span", "card__hint", a.hint));
        if (a.disabled) b.disabled = true;
        const run = () => { if (!a.disabled && a.onSelect) a.onSelect(card); };
        b.addEventListener("click", run);
        if (a.key) keys[a.key.toLowerCase()] = run;
        box.append(b);
      }
      body.append(box);
    }
    card.append(body);

    card._keys = keys;
    card.addEventListener("card:close", () => o.onClose && o.onClose());
    return card;
  }

  let layer = null, current = null;

  function popup(o, at = {}) {
    if (current) current.close(true);
    if (!layer) { layer = el("div", "card-layer"); document.body.append(layer); }

    const card = create(o);
    card.classList.add("card--popup");
    if (at.still) card.classList.add("card--still");   // re-render in place, no entry animation
    layer.append(card);

    // Place next to the point, flipped/clamped so it stays on screen.
    const m = 16, r = card.getBoundingClientRect();
    let x = at.x ?? (innerWidth - r.width) / 2, y = at.y ?? (innerHeight - r.height) / 2;
    if (at.x != null) x += 14;
    if (at.y != null) y -= 20;
    if (x + r.width > innerWidth - m) x = (at.x != null ? at.x - 14 - r.width : innerWidth - m - r.width);
    x = Math.max(m, Math.min(x, innerWidth - m - r.width));
    y = Math.max(m, Math.min(y, innerHeight - m - r.height));
    card.style.left = x + "px";
    card.style.top = y + "px";

    function onKey(e) {
      if (e.key === "Escape") return handle.close();
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName || "")) return;   // typing, not a shortcut
      const run = card._keys[e.key.toLowerCase()];
      if (run && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); run(); }
    }
    function onDown(e) { if (!card.contains(e.target)) handle.close(); }

    const handle = {
      el: card,
      close(instant) {
        if (!card.isConnected) return;
        removeEventListener("keydown", onKey, true);
        removeEventListener("pointerdown", onDown, true);
        if (current === handle) current = null;
        if (instant) return card.remove();
        card.classList.add("card--closing");
        card.addEventListener("animationend", () => card.remove(), { once: true });
      },
    };
    card.addEventListener("card:close", () => handle.close());
    addEventListener("keydown", onKey, true);
    // Defer so the click that opened the card doesn't close it.
    setTimeout(() => addEventListener("pointerdown", onDown, true));
    current = handle;
    return handle;
  }

  // Usual paths, each with a copy button, folded into a <details> (open: start unfolded). rows: [where, path, after?].
  // The player pastes one into the browser's picker (Ctrl+L first on Linux).
  function paths(rows, picker, open) {
    const box = el("details", "card__paths");
    if (open) box.open = true;
    box.append(el("summary", null, "Usual places"));
    box.append(el("p", "card__note", `Copy one and paste it into the ${picker}; on Linux press Ctrl+L first.`));
    for (const [where, path, after] of rows) {
      const row = el("div", "card__path");
      const code = el("code", null, path);
      const btn = el("button", "card__copy", "Copy");
      btn.type = "button";
      btn.setAttribute("aria-label", `Copy the ${where} path`);
      btn.addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(path); btn.textContent = "Copied"; }
        catch {   // no clipboard access: select the text so Ctrl+C works
          const r = document.createRange(); r.selectNodeContents(code);
          const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
          btn.textContent = "Ctrl+C";
        }
        setTimeout(() => { btn.textContent = "Copy"; }, 1500);
      });
      row.append(el("span", "card__path-where", where + (after ? ` · ${after}` : "")), code, btn);
      box.append(row);
    }
    return box;
  }

  window.Card = { create, popup, tint, paths, icons: ICONS, close: () => current && current.close() };
})();
