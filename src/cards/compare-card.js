/* =====================================================================
 * eBike Compare Card – Rangliste der Absolutwerte je Bike
 *   type: custom:ebike-compare-card
 *   bikes: [{ name, prefix, color, short_name }]
 *     short_name: optional kürzerer Name unter den Säulen (vertikales Layout); der Tooltip zeigt weiter 'name'
 *   Reiter: odometer, elevation, rides, duration, cycles, calories,
 *           energy (kWh vom Akku abgegeben), efficiency (Ø Wh/km, sparsamstes zuerst)
 *   Optional: show_scale: false blendet die Skala (Achse + Hilfslinien) aus
 * ===================================================================== */

import { PALETTE } from "../shared/constants.js";
import { fmt, esc, niceScale, stepDigits } from "../shared/format.js";
import { registerCard } from "../shared/register.js";

const ECC_METRICS = {
  odometer:  { suffix: "kilometerstand",    label: "Kilometer",  unit: "km",   digits: 0, icon: "mdi:map-marker-distance" },
  elevation: { suffix: "hohenmeter_gesamt", label: "Höhenmeter", unit: "m",    digits: 0, icon: "mdi:image-filter-hdr" },
  rides:     { suffix: "touren_gesamt",     label: "Touren",     unit: "",     digits: 0, icon: "mdi:flag-checkered" },
  duration:  { suffix: "fahrzeit_gesamt",   label: "Fahrzeit",   unit: "h",    digits: 1, icon: "mdi:timer-outline" },
  cycles:    { suffix: "*_charge_cycles",   label: "Ladezyklen", unit: "",     digits: 1, icon: "mdi:battery-sync" },
  calories:  { suffix: "kalorien_gesamt",   label: "Kalorien",   unit: "kcal", digits: 0, icon: "mdi:fire" },
  // Vom Akku abgegebene Energie über seine Lebensdauer (Bosch-Zähler, in Wh) → kWh
  energy:    { suffix: "*_wh_lifetime",     label: "Energie",    unit: "kWh",  digits: 2, scale: 0.001, icon: "mdi:lightning-bolt" },
  // Energie gesamt / Kilometerstand – beides Zähler direkt vom Bike; kleiner ist sparsamer
  efficiency: { calc: true,                 label: "Verbrauch",  unit: "Wh/km", digits: 1, lower_better: true, icon: "mdi:gauge" },
};

class EbikeCompareCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._sig = "";
    this._bound = false;
    this._hover = -1;
  }

  static getStubConfig() { return { title: "Vergleich", bikes: [] }; }

  setConfig(config) {
    if (!Array.isArray(config.bikes) || !config.bikes.length) {
      throw new Error("Bitte unter 'bikes' mindestens ein Bike mit name und prefix angeben");
    }
    this._config = { title: "Vergleich", sort: true, layout: "vertical", height: 170, show_scale: true, ...config };
    const overrides = config.suffixes || {};
    this._defs = {};
    for (const [k, m] of Object.entries(ECC_METRICS)) {
      this._defs[k] = { ...m, suffix: overrides[k] || m.suffix };
    }
    const wanted = Array.isArray(config.metrics) ? config.metrics : Object.keys(ECC_METRICS);
    this._metrics = wanted.filter((m) => this._defs[m]);
    if (!this._metrics.length) this._metrics = Object.keys(ECC_METRICS);
    let saved = null;
    try { saved = localStorage.getItem(`ebike-compare:${this._config.title}`); } catch (e) { /* ignore */ }
    this._metric = this._metrics.includes(saved) ? saved
      : this._metrics.includes(config.metric) ? config.metric : this._metrics[0];
    this._sig = "";
    if (this._hass) this._render();
  }

  set hass(hass) {
    this._hass = hass;
    const sig = this._signature();
    if (sig !== this._sig) { this._sig = sig; this._render(); }
  }

  getCardSize() { return 2 + this._config.bikes.length; }

  _value(prefix, suffix) {
    const states = this._hass?.states || {};
    const ids = suffix.startsWith("*")
      ? Object.keys(states).filter((k) => k.startsWith(`sensor.${prefix}_`) && k.endsWith(suffix.slice(1)))
      : [`sensor.${prefix}_${suffix}`];
    let sum = 0, found = false;
    for (const id of ids) {
      const v = states[id] ? parseFloat(states[id].state) : NaN;
      if (Number.isFinite(v)) { sum += v; found = true; }
    }
    return found ? sum : null;
  }

  _metricValue(prefix, def) {
    if (def.calc) {
      const wh = this._value(prefix, this._defs.energy.suffix);
      const km = this._value(prefix, this._defs.odometer.suffix);
      return wh !== null && km > 0 ? wh / km : null;
    }
    const v = this._value(prefix, def.suffix);
    return v !== null && def.scale ? v * def.scale : v;
  }

  _signature() {
    if (!this._hass || !this._config) return "";
    const def = this._defs[this._metric];
    return this._metric + "|" + this._config.bikes.map((b) => this._metricValue(b.prefix, def)).join("|");
  }

  _render() {
    if (!this._config || !this._hass) return;
    const cfg = this._config;
    const def = this._defs[this._metric];
    const rows = cfg.bikes.map((b, i) => ({
      name: b.name || b.prefix,
      short: b.short_name || b.name || b.prefix,
      color: b.color || PALETTE[i % PALETTE.length],
      v: this._metricValue(b.prefix, def),
    }));
    if (cfg.sort !== false) {
      rows.sort(def.lower_better
        ? (a, b) => (a.v ?? Infinity) - (b.v ?? Infinity)
        : (a, b) => (b.v ?? -1) - (a.v ?? -1));
    }
    const max = Math.max(0, ...rows.map((r) => r.v || 0));
    const best = def.lower_better
      ? Math.min(...rows.map((r) => (r.v > 0 ? r.v : Infinity)))
      : max;
    const leader = best > 0 && Number.isFinite(best) ? rows.find((r) => r.v === best) : null;

    const ranked = rows.filter((r) => r.v !== null && Number.isFinite(r.v))
      .sort(def.lower_better ? (a, b) => a.v - b.v : (a, b) => b.v - a.v);
    this._rows = rows;
    this._ranked = ranked;

    const tabs = this._metrics.map((k) => `
      <button class="tab ${k === this._metric ? "on" : ""}" data-metric="${k}">
        <ha-icon icon="${this._defs[k].icon}"></ha-icon><span>${this._defs[k].label}</span>
      </button>`).join("");

    const vertical = cfg.layout !== "horizontal";
    const showScale = cfg.show_scale !== false;
    // Skala wie bei der Fahrstatistik: runde Obergrenze und Schrittweite (1/2/2,5/5 × 10^n)
    let top = max > 0 ? max / 0.82 : 1;
    let ticks = [];
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
    // Pokal beim Spitzenreiter nur auf Wunsch (show_leader: true)
    const trophy = cfg.show_leader ? `<ha-icon class="crown" icon="mdi:trophy" title="Platz 1"></ha-icon>` : "";
    let list;
    if (vertical) {
      const yw = showScale ? Math.round(4 + Math.max(...tickLabels.map((t) => t.length)) * 6.6) : 0;
      // Platz über der Achse: obere Achsbeschriftung, bei show_leader zusätzlich der Pokal
      const headroom = cfg.show_leader ? 24 : 8;
      const grid = ticks.map((v, i) => `
          <div class="gl ${i === 0 ? "base" : ""}" style="bottom:${pctOf(v)}%"></div>`).join("");
      const ylabs = ticks.map((v, i) => `
          <div class="yl" style="bottom:${pctOf(v)}%">${tickLabels[i]}</div>`).join("");
      // Werte erscheinen nicht über den Balken, sondern im Tooltip (Maus-Over / Antippen)
      const cols = rows.map((r, i) => {
        const pct = top > 0 && r.v > 0 ? Math.max(2, pctOf(r.v)) : 0;
        return `
            <div class="col" data-i="${i}">
              <div class="chl"></div>
              <div class="cfill" style="height:${pct}%;background:${r.color}"></div>
              ${r === leader && trophy ? `<div class="cval" style="bottom:calc(${pct}% + 4px)">${trophy}</div>` : ""}
            </div>`;
      }).join("");
      const names = rows.map((r) => `
            <div class="cname">${esc(r.short).replace(/-/g, "&#8209;")}</div>`).join("");
      list = `
        <div class="vchart" style="--h:${Number(cfg.height) || 170}px;--yw:${yw}px;padding-top:${headroom}px">
          <div class="yax">${ylabs}</div>
          <div class="plot">${grid}<div class="cols">${cols}</div></div>
          <div></div>
          <div class="names">${names}</div>
          <div class="tip" hidden></div>
        </div>`;
    } else {
      const marks = ticks.slice(1, -1).map((v) => `<i class="tm" style="left:${pctOf(v)}%"></i>`).join("");
      list = rows.map((r) => {
        const pct = top > 0 && r.v > 0 ? Math.max(1.5, pctOf(r.v)) : 0;
        return `
            <div class="row">
              <div class="line">
                <span class="name">${esc(r.name)}${r === leader ? trophy : ""}</span>
                <span class="val">${fmt(r.v, def.digits)}${r.v !== null && def.unit ? `<small>${def.unit}</small>` : ""}</span>
              </div>
              <div class="track">${marks}<div class="fill" style="width:${pct}%;background:${r.color}"></div></div>
            </div>`;
      }).join("");
      if (showScale) {
        list += `<div class="xax">${ticks.map((v, i) => `
            <span class="${i === 0 ? "first" : i === ticks.length - 1 ? "last" : ""}" style="left:${pctOf(v)}%">${tickLabels[i]}</span>`).join("")}</div>`;
      }
    }

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-card { ${cfg.background ? `background:${cfg.background};` : ""} border-radius: 16px;
          padding: 14px 14px 16px; color: var(--primary-text-color);
          --sub: var(--secondary-text-color, #9e9e9e); --chip: rgba(127,127,127,.12);
          --accent: var(--primary-color, #03a9f4); }
        button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; padding: 0; }
        .title { font-size: 17px; font-weight: 600; }
        .tabs { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0 14px; }
        .tab { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; flex: none;
               font-size: 12.5px; padding: 6px 10px; border-radius: 999px; background: var(--chip); color: var(--sub); }
        .tab ha-icon { --mdc-icon-size: 15px; width: 15px; height: 15px; display: inline-flex; }
        .tab.on { background: color-mix(in srgb, var(--accent) 22%, transparent); color: var(--primary-text-color);
                  font-weight: 600; box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 55%, transparent); }
        .list { display: flex; flex-direction: column; gap: 12px; }
        .line { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 5px; }
        .name { font-size: 14px; display: inline-flex; align-items: center; gap: 6px; min-width: 0;
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .crown { --mdc-icon-size: 15px; width: 15px; height: 15px; display: inline-flex; color: #ffc107; flex: none; }
        .val { font-size: 16px; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .val small { font-size: 11px; font-weight: 500; color: var(--sub); margin-left: 3px; }
        .track { position: relative; height: 10px; border-radius: 999px; background: rgba(127,127,127,.14); overflow: hidden; }
        .fill { position: relative; height: 100%; border-radius: 999px; transition: width .6s cubic-bezier(.2,.8,.2,1); }
        .tm { position: absolute; top: 0; bottom: 0; width: 1px; background: rgba(127,127,127,.3); }
        .xax { position: relative; height: 14px; margin-top: -4px; font-size: 10.5px; color: var(--sub);
               font-variant-numeric: tabular-nums; }
        .xax span { position: absolute; top: 0; transform: translateX(-50%); white-space: nowrap; }
        .xax span.first { transform: none; }
        .xax span.last { transform: translateX(-100%); }
        .head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
        .unit { font-size: 12.5px; color: var(--sub); }
        /* minmax(0, …): lange Bike-Namen dürfen die Spalte nicht über die Kartenbreite dehnen */
        .vchart { display: grid; grid-template-columns: var(--yw) minmax(0, 1fr); column-gap: 6px; }
        .yax { position: relative; height: var(--h); }
        .yl { position: absolute; right: 0; transform: translateY(50%); font-size: 10.5px; line-height: 1;
              color: var(--sub); font-variant-numeric: tabular-nums; white-space: nowrap; }
        .plot { position: relative; height: var(--h); }
        .gl { position: absolute; left: 0; right: 0; height: 0; border-top: 1px dashed rgba(127,127,127,.22); }
        .gl.base { border-top: 1px solid rgba(127,127,127,.4); }
        .cols { position: absolute; inset: 0; display: flex; gap: 8px; }
        .col { position: relative; flex: 1 1 0; min-width: 0; }
        .cfill { position: absolute; bottom: 0; left: 50%; transform: translateX(-50%); width: min(72%, 46px);
                 border-radius: 10px 10px 3px 3px; transition: height .6s cubic-bezier(.2,.8,.2,1); }
        .cval { position: absolute; left: 0; right: 0; text-align: center; font-size: 15px; font-weight: 700;
                font-variant-numeric: tabular-nums; white-space: nowrap; display: flex; flex-direction: column;
                align-items: center; gap: 1px; transition: bottom .6s cubic-bezier(.2,.8,.2,1); }
        .cval .crown { margin-bottom: 1px; }
        .col { cursor: pointer; }
        .chl { position: absolute; left: 0; right: 0; top: -6px; bottom: 0; border-radius: 8px;
               background: rgba(127,127,127,.12); visibility: hidden; }
        .col.hover .chl { visibility: visible; }
        .vchart { position: relative; touch-action: pan-y; user-select: none; -webkit-user-select: none; }
        .tip { position: absolute; top: 0; z-index: 2; min-width: 140px; max-width: 230px; pointer-events: none;
               background: #2c2c2e; color: #fff; border-radius: 12px; padding: 9px 11px;
               box-shadow: 0 8px 24px rgba(0,0,0,.35); border: 1px solid rgba(255,255,255,.08); font-size: 12.5px; }
        .tt { font-weight: 600; margin-bottom: 6px; display: flex; align-items: center; gap: 7px; }
        .tt .dot { width: 9px; height: 9px; border-radius: 3px; flex: none; }
        .tr { display: flex; justify-content: space-between; gap: 12px; line-height: 1.6; }
        .tn { opacity: .85; white-space: nowrap; }
        .tv { font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .tfoot { margin-top: 2px; font-size: 11px; opacity: .6; }
        .names { display: flex; gap: 8px; }
        .cname { margin-top: 7px; font-size: 12px; line-height: 1.25; text-align: center; color: var(--sub);
                 display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
                 overflow-wrap: break-word; hyphens: none; flex: 1 1 0; min-width: 0; }
      </style>
      <ha-card>
        <div class="head"><div class="title">${esc(cfg.title)}</div>
          ${(vertical || showScale) && def.unit ? `<div class="unit">in ${def.unit}</div>` : ""}</div>
        <div class="tabs">${tabs}</div>
        <div class="${vertical ? "" : "list"}">${list}</div>
      </ha-card>`;

    if (!this._bound) {
      this._bound = true;
      const root = this.shadowRoot;
      root.addEventListener("click", (ev) => {
        const t = ev.target.closest("button[data-metric]");
        if (!t) return;
        this._metric = t.dataset.metric;
        this._hover = -1;
        try { localStorage.setItem(`ebike-compare:${this._config.title}`, this._metric); } catch (e) { /* ignore */ }
        this._sig = this._signature();
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
    const def = this._defs[this._metric];
    const rank = this._ranked.indexOf(r);
    tip.innerHTML = `
      <div class="tt"><span class="dot" style="background:${r.color}"></span>${esc(r.name)}</div>
      <div class="tr"><span class="tn">${def.label}</span>
        <span class="tv">${fmt(r.v, def.digits)}${r.v !== null && def.unit ? ` ${def.unit}` : ""}</span></div>
      ${rank >= 0 && this._ranked.length > 1 ? `<div class="tfoot">Platz ${rank + 1} von ${this._ranked.length}</div>` : ""}`;
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

registerCard("ebike-compare-card", EbikeCompareCard, "eBike Vergleich",
  "Rangliste der Gesamtwerte je Bike");
