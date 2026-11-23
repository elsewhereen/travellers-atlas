"use strict";
/*
 * Distance: the "Distance to" pop-up from the burger menu. Exposes window.Distance.open().
 * From = the system you're in (the open save or map, else your typed-in list). To = an address typed with the
 * glyph pad, or found by name near you. "Show" opens DistanceView: just the two, far out in the galaxy.
 * The last target is remembered in this browser. Needs card.js, components/manual.js, lib/atlas.js, views/distance.js.
 */
(function () {
  const KEY = "atlas.distance.to";
  const nf = new Intl.NumberFormat("en-GB");
  const nf1 = new Intl.NumberFormat("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const fmtLy = ly => (ly < 1000 ? nf1.format(ly) : nf.format(Math.round(ly))) + " ly";
  let handle = null;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // The system you're in, as { name, code, regionName, star, pos, coreLy, x, y, z, index, galaxy, galaxyName }.
  async function here() {
    const d = Atlas.data;
    if (d) {
      const s = d.systems.find(x => x.key === d.current);
      if (s) return info(s, d.galaxy.index, s.name);
    }
    const e = Manual.entry();
    if (e) {
      const a = e.log.systems.find(x => Manual.keyOf(x) === e.log.current);
      const s = a && await Atlas.preview(a, a.galaxy || 0);
      if (s) return info(s, a.galaxy || 0, a.name || s.name);
    }
    return null;
  }
  function info(s, galaxy, name) {
    return { name: name || s.originalName, code: s.code, regionName: s.regionName, star: s.star, pos: s.pos,
             coreLy: s.coreLy, x: s.region[0], y: s.region[1], z: s.region[2], index: s.index, galaxy,
             galaxyName: Atlas.GALAXIES[galaxy] || `Galaxy ${galaxy + 1}` };
  }

  const remembered = () => { try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; } };
  const remember = v => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private mode */ } };

  async function open() {
    const from = await here();
    if (!from) {
      handle = Card.popup({
        title: "Distance to", subtitle: "From where you are",
        width: "30em",
        content: el("p", "card__note", "Open a save, or enter the address of the system you're in, first. " +
          "The distance is measured from there."),
        actions: [{ key: "E", label: "Enter address", hint: "Type the glyphs of your system", onSelect: () => Manual.open() }],
        onClose: () => { handle = null; },
      });
      return;
    }

    let field = null;
    const box = el("div", "manual");
    const fromRow = el("div", "dist-from");
    fromRow.append(el("span", "card__field-label", "From"), el("span", "dist-from__name", from.name));
    if (from.code) fromRow.append(Manual.glyphRow(from.code, "glyphs--small"));
    box.append(fromRow);

    const result = el("div", "dist-result");
    const update = f => {
      result.replaceChildren();
      const ok = !!f.sys && f.addr.galaxy === from.galaxy;
      setShow(ok);
      if (!f.sys) return;
      if (f.addr.galaxy !== from.galaxy) {
        result.dataset.tone = "warn";
        result.append(el("span", null, `That's in another galaxy than ${from.name}; distances only work within one.`));
        return;
      }
      result.dataset.tone = "";
      const ly = Math.hypot(f.sys.pos[0] - from.pos[0], f.sys.pos[1] - from.pos[1], f.sys.pos[2] - from.pos[2]);
      result.append(el("span", "dist-result__ly", fmtLy(ly)), el("span", "manual__dim", ` from ${from.name} to ${f.sys.originalName}`));
    };
    field = Manual.addressField({ label: "To", galaxy: from.galaxy, onChange: update, onEnter: () => show() });
    box.append(field.el, result, Manual.nameSearch(from, (code, g) => field.setText(code, g), "Or find one near you by name"));

    function show() {
      if (!field.sys || field.addr.galaxy !== from.galaxy) return;
      remember({ code: Manual.portal(field.addr), galaxy: field.addr.galaxy });
      const to = info(field.sys, field.addr.galaxy, field.sys.originalName);
      if (handle) handle.close();
      Atlas.loadThree().then(() => DistanceView.show(from, to, from.galaxyName));
    }
    function setShow(on) {
      const b = handle && handle.el.querySelector('.card__action[data-act="show"]');
      if (b) b.disabled = !on;
    }

    handle = Card.popup({
      title: "Distance to",
      subtitle: `From ${from.name}`,
      width: "40em",
      content: box,
      actions: [{ key: "S", label: "Show", hint: "Both systems and where they are in the galaxy", onSelect: show }],
      onClose: () => { handle = null; },
    });
    handle.el.classList.add("card--manual");
    const b = handle.el.querySelector(".card__action");
    if (b) b.dataset.act = "show";
    const last = remembered();
    if (last && last.galaxy === from.galaxy) field.setText(last.code, last.galaxy);
    else setShow(false);
    setTimeout(() => field.focus(), 50);
  }

  window.Distance = { open };
})();
