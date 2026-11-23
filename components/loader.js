"use strict";
/*
 * Loader: shows a list of steps while work runs. Exposes window.Loader. Styled by loader.css (+ card.css).
 *
 *   const l = Loader.show({ title, subtitle, steps: [{ id, label }] });
 *   l.set(id, "active" | "done" | "error", note?)
 *   l.done()                       // fades out and removes itself
 *   l.fail(onClose)                // keeps it open with a Close action
 */
(function () {
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function show({ title, subtitle, steps }) {
    const root = el("div", "loader");
    root.setAttribute("role", "status");
    root.setAttribute("aria-live", "polite");
    const box = el("div", "loader__box");
    const head = el("header", "loader__head");
    if (window.Card) Card.tint(head);
    head.append(el("h2", "loader__title", title || "Loading"));
    if (subtitle) head.append(el("p", "loader__subtitle", subtitle));
    const ul = el("ul", "loader__steps");
    const rows = {};
    for (const s of steps) {
      const li = el("li", "loader__step");
      li.dataset.state = "waiting";
      const note = el("span", "loader__note", "");
      li.append(el("span", "loader__mark"), el("span", null, s.label), note);
      rows[s.id] = { li, note };
      ul.append(li);
    }
    box.append(head, ul);
    root.append(box);
    document.body.append(root);

    return {
      set(id, state, note) {
        const r = rows[id];
        if (!r) return;
        r.li.dataset.state = state;
        if (note != null) r.note.textContent = note;
      },
      done() {
        root.classList.add("loader--done");
        root.addEventListener("animationend", () => root.remove(), { once: true });
      },
      fail(onClose) {
        const acts = el("div", "loader__actions card__actions");
        const b = el("button", "card__action");
        b.type = "button";
        b.append(el("span", "card__key", "Esc"), el("span", "card__label", "Close"));
        const close = () => { removeEventListener("keydown", onKey); root.remove(); onClose && onClose(); };
        const onKey = e => { if (e.key === "Escape") close(); };
        b.addEventListener("click", close);
        addEventListener("keydown", onKey);
        acts.append(b);
        box.append(acts);
      },
    };
  }

  window.Loader = { show };
})();
