/* =====================================================================
 * eBike Range Card – aktuelle Restreichweite je Bike und Unterstützungsmodus
 *   type: custom:ebike-range-card
 *   bikes: [{ name, prefix, color }]   (wie bei der Vergleichskarte)
 *   Optional: modes: [Eco, Tour, eMTB, Turbo]   welche Modi erscheinen, Reihenfolge wie angegeben
 *             colors: { Eco: "#4caf50" }        eigene Farbe je Modus
 *             height: 170, show_scale: false
 * Liest die "Reachable Range <Modus>"-Sensoren der Integration (Attribut assist_mode).
 * Welche Modi es gibt, hängt vom Motor ab; die Karte zeigt alle, die bei
 * mindestens einem Bike vorkommen, von sparsam bis kräftig sortiert.
 * Ein Klick auf einen Modus in der Legende blendet ihn aus bzw. wieder ein.
 * ===================================================================== */

import { PALETTE } from "../shared/constants.js";
import { fmt, esc, niceScale, stepDigits } from "../shared/format.js";
import { registerCard } from "../shared/register.js";

// Anzeigereihenfolge und Farben (aus der gemeinsamen Palette): sparsam → kräftig
const ERG_MODES = [
  ["ECO", "#4caf50"], ["ECO+", "#8bc34a"], ["TOUR", "#03a9f4"], ["TOUR+", "#00bcd4"],
  ["AUTO", "#9c27b0"], ["SPORT", "#ffc107"], ["EMTB", "#ff9800"], ["EMTB+", "#e91e63"],
  ["EMTB-SHORTCRANK", "#e91e63"], ["SPRINT", "#e91e63"], ["TURBO", "#f44336"],
];
const ERG_OTHER = ["#3f51b5", "#9e9e9e"];

// Bosch liefert ECO/TOUR+/eMTB; angezeigt wird Eco/Tour+/eMTB
function ergLabel(mode) {
  const s = String(mode);
  return s === s.toUpperCase() ? s.charAt(0) + s.slice(1).toLowerCase() : s;
}

class EbikeRangeCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._sig = "";
    this._bound = false;
    this._hover = -1;
  }

  static getStubConfig() { return { title: "Reichweite", bikes: [] }; }

  setConfig(config) {
    if (!Array.isArray(config.bikes) || !config.bikes.length) {
      throw new Error("Bitte unter 'bikes' mindestens ein Bike mit name und prefix angeben");
    }
    this._config = { title: "Reichweite", height: 170, show_scale: true, colors: {}, ...config };
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(`ebike-range:${this._config.title}`) || "null"); } catch (e) { /* ignore */ }
    this._hidden = new Set(Array.isArray(saved) ? saved : []);
    this._sig = "";
    if (this._hass) this._render();
  }

  set hass(hass) {
    this._hass = hass;
    const sig = this._signature();
    if (sig !== this._sig) { this._sig = sig; this._render(); }
  }

  getCardSize() { return 5; }

  // Reichweite je Modus eines Bikes: { ECO: 92.5, TURBO: 41 }
  _ranges(prefix) {
    const out = {};
    if (!prefix) return out;
    for (const [id, s] of Object.entries(this._hass?.states || {})) {
      const mode = s.attributes?.assist_mode;
      if (!mode || !id.startsWith(`sensor.${prefix}_`)) continue;
      const v = parseFloat(s.state);
      if (Number.isFinite(v)) out[String(mode).toUpperCase()] = { v, label: ergLabel(mode) };
    }
    return out;
  }

  _signature() {
    if (!this._hass || !this._config) return "";
    return this._config.bikes.map((b) => JSON.stringify(this._ranges(b.prefix))).join("|");
  }

  // Alle vorkommenden Modi in Anzeigereihenfolge, mit Farbe
  _modes(rows) {
    const cfg = this._config;
    const found = new Map();
    for (const r of rows) for (const [k, m] of Object.entries(r.ranges)) if (!found.has(k)) found.set(k, m.label);
    let keys = [...found.keys()];
    const known = ERG_MODES.map(([k]) => k);
    if (Array.isArray(cfg.modes)) {
      const wanted = cfg.modes.map((m) => String(m).toUpperCase());
      keys = wanted.filter((k) => found.has(k));
    } else {
      const rank = (k) => (known.includes(k) ? known.indexOf(k) : 999);
      keys.sort((a, b) => rank(a) - rank(b));
    }
    let other = 0;
    return keys.map((k) => {
      const label = found.get(k);
      const own = cfg.colors[label] || cfg.colors[k] || cfg.colors[k.toLowerCase()];
      const def = ERG_MODES.find(([m]) => m === k);
      return { key: k, label, color: own || (def ? def[1] : ERG_OTHER[other++ % ERG_OTHER.length]) };
    });
  }

  _render() {
    if (!this._config || !this._hass) return;
    const cfg = this._config;
    const rows = cfg.bikes.map((b, i) => ({
      name: b.name || b.prefix,
      color: b.color || PALETTE[i % PALETTE.length],
      ranges: this._ranges(b.prefix),
    }));
    const modes = this._modes(rows);
    const shown = modes.filter((m) => !this._hidden.has(m.key));
    this._rows = rows;
    this._shown = shown;

    const max = Math.max(0, ...rows.flatMap((r) => shown.map((m) => r.ranges[m.key]?.v || 0)));
    const showScale = cfg.show_scale !== false;
    // Skala wie bei der Vergleichskarte: runde Obergrenze und Schrittweite (1/2/2,5/5 × 10^n)
    let top = max > 0 ? max / 0.82 : 1;
    const ticks = [];
    let tickDigits = 0;
    if (showScale) {
      const sc = niceScale(max);
      top = sc.max;
      tickDigits = stepDigits(sc.step);
      const n = Math.round(sc.max / sc.step);
      for (let i = 0; i <= n; i++) ticks.push(i * sc.step);
    }
    const pctOf = (v) => (v / top) * 100;
    const tickLabels = ticks.map((v) => fmt(v, tickDigits));
    const yw = showScale ? Math.round(4 + Math.max(...tickLabels.map((t) => t.length)) * 6.6) : 0;

    const legend = modes.map((m) => {
      const off = this._hidden.has(m.key);
      return `<button class="chip ${off ? "off" : ""}" data-mode="${esc(m.key)}" title="${off ? "Einblenden" : "Ausblenden"}">
          <span class="dot" style="background:${m.color}"></span><span>${esc(m.label)}</span>
        </button>`;
    }).join("");

    let body;
    if (!modes.length) {
      body = `<div class="msg">Keine Reichweiten-Sensoren gefunden – bitte 'prefix' prüfen</div>`;
    } else {
      const grid = ticks.map((v, i) => `
          <div class="gl ${i === 0 ? "base" : ""}" style="bottom:${pctOf(v)}%"></div>`).join("");
      const ylabs = ticks.map((v, i) => `
          <div class="yl" style="bottom:${pctOf(v)}%">${tickLabels[i]}</div>`).join("");
      // Werte erscheinen nicht über den Balken, sondern im Tooltip (Maus-Over / Antippen)
      const cols = rows.map((r, i) => {
        // Nur die Modi, die dieses Bike hat – ohne Lücken für fehlende
        const own = shown.filter((m) => r.ranges[m.key]);
        const bars = own.map((m) => {
          const v = r.ranges[m.key].v;
          const pct = top > 0 && v > 0 ? Math.max(2, pctOf(v)) : 0;
          return `<div class="bar" style="height:${pct}%;background:${m.color}"></div>`;
        }).join("");
        return `
            <div class="col" data-i="${i}">
              <div class="chl"></div>
              <div class="bars" style="width:min(86%, ${own.length * 18}px)">${bars}</div>
            </div>`;
      }).join("");
      const names = rows.map((r) => `
            <div class="cname"><span class="dot" style="background:${r.color}"></span>${esc(r.name).replace(/-/g, "&#8209;")}</div>`).join("");
      body = `
        <div class="vchart" style="--h:${Number(cfg.height) || 170}px;--yw:${yw}px">
          <div class="yax">${ylabs}</div>
          <div class="plot">${grid}<div class="cols">${cols}</div></div>
          <div></div>
          <div class="names">${names}</div>
          <div class="tip" hidden></div>
        </div>`;
    }

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-card { ${cfg.background ? `background:${cfg.background};` : ""} border-radius: 16px;
          padding: 14px 14px 16px; color: var(--primary-text-color);
          --sub: var(--secondary-text-color, #9e9e9e); --chip: rgba(127,127,127,.12); }
        button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; padding: 0; }
        .head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
        .title { font-size: 17px; font-weight: 600; }
        .unit { font-size: 12.5px; color: var(--sub); }
        .dot { width: 9px; height: 9px; border-radius: 3px; flex: none; display: inline-block; }
        .legend { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0 14px; }
        .chip { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; padding: 5px 9px;
                border-radius: 999px; background: var(--chip); transition: opacity .15s; white-space: nowrap; }
        .chip.off { opacity: .4; }
        .chip.off .dot { background: transparent !important; box-shadow: inset 0 0 0 1.5px var(--sub); }
        .vchart { position: relative; display: grid; grid-template-columns: var(--yw) 1fr; column-gap: 6px;
                  padding-top: 8px; touch-action: pan-y; user-select: none; -webkit-user-select: none; }
        .yax { position: relative; height: var(--h); }
        .yl { position: absolute; right: 0; transform: translateY(50%); font-size: 10.5px; line-height: 1;
              color: var(--sub); font-variant-numeric: tabular-nums; white-space: nowrap; }
        .plot { position: relative; height: var(--h); }
        .gl { position: absolute; left: 0; right: 0; height: 0; border-top: 1px dashed rgba(127,127,127,.22); }
        .gl.base { border-top: 1px solid rgba(127,127,127,.4); }
        .cols { position: absolute; inset: 0; display: flex; gap: 8px; }
        .col { position: relative; flex: 1 1 0; min-width: 0; cursor: pointer; }
        .bars { position: absolute; bottom: 0; top: 0; left: 50%; transform: translateX(-50%);
                display: flex; align-items: flex-end; gap: 3px; }
        .bar { flex: 1 1 0; min-width: 0; border-radius: 6px 6px 2px 2px;
               transition: height .6s cubic-bezier(.2,.8,.2,1); }
        .chl { position: absolute; left: 0; right: 0; top: -6px; bottom: 0; border-radius: 8px;
               background: rgba(127,127,127,.12); visibility: hidden; }
        .col.hover .chl { visibility: visible; }
        .names { display: flex; gap: 8px; }
        .cname { margin-top: 7px; font-size: 12px; line-height: 1.25; text-align: center; color: var(--sub);
                 overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1 1 0; min-width: 0; }
        .cname .dot { width: 7px; height: 7px; border-radius: 2px; margin-right: 5px; vertical-align: 1px; }
        .tip { position: absolute; top: 0; z-index: 2; min-width: 140px; max-width: 230px; pointer-events: none;
               background: #2c2c2e; color: #fff; border-radius: 12px; padding: 9px 11px;
               box-shadow: 0 8px 24px rgba(0,0,0,.35); border: 1px solid rgba(255,255,255,.08); font-size: 12.5px; }
        .tt { font-weight: 600; margin-bottom: 6px; display: flex; align-items: center; gap: 7px; }
        .tr { display: flex; align-items: center; gap: 7px; line-height: 1.7; }
        .tn { flex: 1; opacity: .85; white-space: nowrap; }
        .tv { font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .muted { opacity: .6; font-size: 12px; }
        .msg { color: var(--sub); font-size: 13px; text-align: center; padding: 24px 12px; }
      </style>
      <ha-card>
        <div class="head"><div class="title">${esc(cfg.title)}</div>
          ${modes.length ? `<div class="unit">in km</div>` : ""}</div>
        ${modes.length ? `<div class="legend">${legend}</div>` : ""}
        ${body}
      </ha-card>`;

    if (!this._bound) {
      this._bound = true;
      const root = this.shadowRoot;
      root.addEventListener("click", (ev) => {
        const t = ev.target.closest("button[data-mode]");
        if (!t) return;
        const k = t.dataset.mode;
        if (this._hidden.has(k)) this._hidden.delete(k); else this._hidden.add(k);
        try { localStorage.setItem(`ebike-range:${this._config.title}`, JSON.stringify([...this._hidden])); } catch (e) { /* ignore */ }
        this._render();
      });
      root.addEventListener("pointermove", (ev) => {
        const col = ev.target.closest?.(".col");
        if (col) this._showTip(Number(col.dataset.i));
      });
      root.addEventListener("pointerdown", (ev) => {
        const col = ev.target.closest?.(".col");
        if (col) this._showTip(Number(col.dataset.i));
        else this._hideTip();
      });
      root.addEventListener("pointerout", (ev) => {
        if (ev.pointerType !== "mouse") return;
        const chart = root.querySelector(".plot");
        if (chart && !chart.contains(ev.relatedTarget)) this._hideTip();
      });
    }
    // Ein offener Tooltip bleibt stehen, wenn neue Werte ankommen
    if (this._hover >= 0) this._showTip(this._hover);
  }

  _showTip(i) {
    const root = this.shadowRoot;
    const tip = root.querySelector(".tip");
    const wrap = root.querySelector(".vchart");
    const col = root.querySelector(`.col[data-i="${i}"]`);
    const r = this._rows?.[i];
    if (!tip || !wrap || !col || !r) return;
    this._hover = i;
    root.querySelectorAll(".col.hover").forEach((c) => c !== col && c.classList.remove("hover"));
    col.classList.add("hover");
    const rows = this._shown.filter((m) => r.ranges[m.key]);
    tip.innerHTML = `
      <div class="tt"><span class="dot" style="background:${r.color}"></span>${esc(r.name)}</div>
      ${rows.length ? rows.map((m) => `
        <div class="tr"><span class="dot" style="background:${m.color}"></span>
          <span class="tn">${esc(m.label)}</span>
          <span class="tv">${fmt(r.ranges[m.key].v, 0)} km</span></div>`).join("")
        : `<div class="muted">Keine Reichweite verfügbar</div>`}`;
    tip.hidden = false;
    const W = wrap.clientWidth;
    const wr = wrap.getBoundingClientRect();
    const cr = col.getBoundingClientRect();
    const tw = tip.offsetWidth;
    let x = cr.right - wr.left + 6;
    if (x + tw > W - 2) x = cr.left - wr.left - 6 - tw;
    x = Math.max(2, Math.min(x, W - tw - 2));
    tip.style.left = `${x}px`;
  }

  _hideTip() {
    this._hover = -1;
    const root = this.shadowRoot;
    const tip = root.querySelector(".tip");
    if (tip) tip.hidden = true;
    root.querySelectorAll(".col.hover").forEach((c) => c.classList.remove("hover"));
  }
}

registerCard("ebike-range-card", EbikeRangeCard, "eBike Reichweite",
  "Aktuelle Restreichweite je Bike und Unterstützungsmodus");
