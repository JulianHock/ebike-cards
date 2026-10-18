/* =====================================================================
 * eBike Goal Card – persönliches Jahresziel je Bike
 *   type: custom:ebike-goal-card
 *   bikes: [{ name, prefix | bike, color, goal }]   (wie bei den anderen Karten)
 *     goal: Ziel in km für das laufende Jahr
 *   Oben wählt man das Bike aus; die Auswahl merkt sich die Karte je Browser.
 *   Optional: bike: Trekking        Start-Bike (Name aus 'bikes')
 *             show_last_year: false  blendet die Vorjahreslinie aus
 *               (ohne Touren im Vorjahr erscheint sie ohnehin nicht)
 *             height: 180
 * Liest alle Touren über den Websocket der Integration (bosch_ebike/list_activities)
 * und zeigt die kumulierten Kilometer des Jahres gegen die Ziellinie und das Vorjahr.
 * ===================================================================== */

import { PALETTE, MONTHS_SHORT, MONTHS_LONG, DAY } from "../shared/constants.js";
import { fmt, esc, niceScale } from "../shared/format.js";
import { loadActivities, allBikes, resolveBikeId } from "../shared/bosch.js";
import { registerCard } from "../shared/register.js";

// Tag im Jahr, 0-basiert (1. Januar = 0)
function egcDayIndex(ts, year) {
  const d = new Date(ts);
  return Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(year, 0, 1)) / DAY);
}

function egcDaysIn(year) {
  return Math.round((new Date(year + 1, 0, 1) - new Date(year, 0, 1)) / DAY);
}

// Kumulierte Kilometer je Tag eines Jahres
function egcCumulative(acts, year) {
  const n = egcDaysIn(year);
  const perDay = new Array(n).fill(0);
  for (const a of acts) {
    if (new Date(a.ts).getFullYear() !== year) continue;
    perDay[Math.min(n - 1, egcDayIndex(a.ts, year))] += a.km;
  }
  let sum = 0;
  return perDay.map((v) => (sum += v));
}

class EbikeGoalCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._data = null;
    this._error = null;
    this._width = 0;
    this._hover = -1;
    this._bound = false;
  }

  static getStubConfig() { return { title: "Jahresziel", bikes: [] }; }

  setConfig(config) {
    if (!Array.isArray(config.bikes) || !config.bikes.length) {
      throw new Error("Bitte unter 'bikes' mindestens ein Bike mit name, prefix und goal angeben");
    }
    const missing = config.bikes.filter((b) => !(Number(b.goal) > 0)).map((b) => b.name || b.prefix || b.bike);
    if (missing.length) {
      throw new Error(`Bitte für jedes Bike ein Jahresziel in km unter 'goal' angeben (fehlt bei: ${missing.join(", ")})`);
    }
    this._config = { title: "Jahresziel", show_last_year: true, height: 180, refresh_minutes: 15, ...config };
    const names = config.bikes.map((b) => b.name || b.prefix);
    let saved = null;
    try { saved = localStorage.getItem(`ebike-goal:${this._config.title}`); } catch (e) { /* ignore */ }
    this._sel = names.indexOf(saved);
    if (this._sel < 0) this._sel = Math.max(0, names.indexOf(config.bike));
    this._hover = -1;
    if (this._raw) this._aggregate(...this._raw);
    this._render();
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) this._load();
  }

  getCardSize() { return 7; }

  connectedCallback() {
    const mins = Math.max(1, Number(this._config?.refresh_minutes) || 15);
    this._timer = setInterval(() => this._hass && this._load(), mins * 60000);
    this._ro = new ResizeObserver(() => {
      const wrap = this.shadowRoot.querySelector(".chart");
      const w = wrap ? Math.round(wrap.clientWidth) : 0;
      if (w && Math.abs(w - this._width) > 2) { this._width = w; this._drawChart(); }
    });
    this._ro.observe(this);
  }

  disconnectedCallback() {
    clearInterval(this._timer);
    this._ro?.disconnect();
  }

  async _load() {
    try {
      this._raw = await loadActivities(this._hass);
      this._aggregate(...this._raw);
      this._error = null;
    } catch (e) {
      this._error = e?.message || String(e);
    }
    this._render();
  }

  _aggregate(instances, activities) {
    const year = new Date().getFullYear();
    const known = allBikes(instances);
    const today = egcDayIndex(Date.now(), year);
    this._data = this._config.bikes.map((cb) => {
      const id = resolveBikeId(cb, known);
      const acts = [];
      if (id) {
        for (const a of activities) {
          if (a.bikeId !== id) continue;
          const ts = Date.parse(a.startTime);
          if (Number.isFinite(ts)) acts.push({ ts, km: (Number(a.distance) || 0) / 1000 });
        }
      }
      return {
        id, year, today,
        goal: Number(cb.goal),
        cur: egcCumulative(acts, year),
        last: egcCumulative(acts, year - 1),
      };
    });
  }

  _bike() { return this._data?.[this._sel] || null; }

  _color(i = this._sel) {
    const b = this._config.bikes[i];
    return b?.color || PALETTE[i % PALETTE.length];
  }

  // Soll-Stand nach Tag 'idx' bei gleichmäßigem Tempo bis 31.12.
  _plan(d, idx) { return d.goal * (idx + 1) / d.cur.length; }

  // Vorjahr nur zeigen, wenn das Bike dort überhaupt gefahren ist
  _showLast(d) { return this._config.show_last_year !== false && d.last[d.last.length - 1] > 0; }

  _render() {
    if (!this._config) return;
    const cfg = this._config;
    const d = this._bike();
    const tabs = cfg.bikes.map((b, i) => `
      <button class="tab ${i === this._sel ? "on" : ""}" data-bike="${i}" style="--c:${this._color(i)}">
        <span class="dot"></span><span>${esc(b.name || b.prefix)}</span>
      </button>`).join("");

    let msg = "";
    if (this._error) msg = `<div class="msg err">Fehler beim Laden: ${esc(this._error)}</div>`;
    else if (!this._data) msg = `<div class="msg">Lade Touren …</div>`;
    else if (!d.id) msg = `<div class="msg">Bike nicht gefunden – bitte 'prefix' oder 'bike' prüfen</div>`;
    const ok = d && d.id && !this._error;

    let kpis = "";
    if (ok) {
      const done = d.cur[d.today];
      const diff = done - this._plan(d, d.today);
      const left = Math.max(0, d.goal - done);
      const weeksLeft = Math.max(1, (d.cur.length - 1 - d.today) / 7);
      const kpi = (label, value, cls = "") =>
        `<div class="kpi"><div class="kv ${cls}">${value}</div><div class="kl">${label}</div></div>`;
      kpis = kpi(`von ${fmt(d.goal)} km`, `${fmt(Math.min(999, (done / d.goal) * 100))}<small> %</small>`);
      if (left <= 0) {
        // Erster Tag, an dem die kumulierte Strecke das Ziel erreicht hat
        const hit = d.cur.findIndex((v) => v >= d.goal);
        const date = new Date(d.year, 0, 1 + hit);
        kpis += kpi("Ziel erreicht", `${date.getDate()}.${date.getMonth() + 1}.`, "good");
        kpis += kpi("über dem Ziel", `+${fmt(done - d.goal)}<small> km</small>`, "good");
      } else {
        kpis += kpi(diff >= 0 ? "vor Plan" : "hinter Plan",
          `${diff >= 0 ? "+" : "−"}${fmt(Math.abs(diff))}<small> km</small>`, diff >= 0 ? "good" : "bad");
        kpis += kpi("nötig je Woche", `${fmt(left / weeksLeft)}<small> km</small>`);
      }
    }

    this.shadowRoot.innerHTML = `
      <style>${this._css()}</style>
      <ha-card style="--c:${this._color()}">
        <div class="head">
          <div class="title">${esc(cfg.title)}</div>
          <div class="sub">${ok ? `${fmt(d.cur[d.today])} km · ` : ""}${d ? d.year : ""}</div>
        </div>
        <div class="tabs">${tabs}</div>
        <div class="chart">
          ${msg}
          <svg class="plot"></svg>
          <div class="tip" hidden></div>
        </div>
        ${ok ? `<div class="legend">
          <span><i class="ln cur"></i>${d.year}</span>
          <span><i class="ln goal"></i>Ziel</span>
          ${this._showLast(d) ? `<span><i class="ln last"></i>${d.year - 1}</span>` : ""}
        </div>
        <div class="kpis">${kpis}</div>` : ""}
      </ha-card>`;

    this._bindOnce();
    const wrap = this.shadowRoot.querySelector(".chart");
    this._width = Math.round(wrap.clientWidth) || this._width;
    if (ok) this._drawChart();
  }

  _bindOnce() {
    if (this._bound) return;
    this._bound = true;
    const root = this.shadowRoot;
    root.addEventListener("click", (ev) => {
      const t = ev.target.closest("button[data-bike]");
      if (!t) return;
      this._sel = Number(t.dataset.bike);
      this._hover = -1;
      const b = this._config.bikes[this._sel];
      try { localStorage.setItem(`ebike-goal:${this._config.title}`, b?.name || b?.prefix); } catch (e) { /* ignore */ }
      this._render();
    });
    const at = (ev) => {
      const svg = root.querySelector("svg.plot");
      if (!svg || !this._geom || !svg.contains(ev.target)) return -1;
      const { left, plotW, n } = this._geom;
      const x = ev.clientX - svg.getBoundingClientRect().left;
      return Math.max(0, Math.min(n - 1, Math.round(((x - left) / plotW) * (n - 1))));
    };
    root.addEventListener("pointermove", (ev) => { const i = at(ev); if (i >= 0) this._showTip(i); });
    root.addEventListener("pointerdown", (ev) => {
      if (ev.target.closest?.("button")) return;
      const i = at(ev);
      if (i >= 0) this._showTip(i); else this._hideTip();
    });
    root.addEventListener("pointerout", (ev) => {
      if (ev.pointerType !== "mouse") return;
      const chart = root.querySelector(".chart");
      if (chart && !chart.contains(ev.relatedTarget)) this._hideTip();
    });
  }

  _drawChart() {
    const root = this.shadowRoot;
    const svg = root.querySelector("svg.plot");
    const d = this._bike();
    if (!svg || !d || !d.id) return;
    const cfg = this._config;
    const W = Math.max(260, this._width || root.querySelector(".chart").clientWidth || 360);
    const H = Math.max(140, Number(cfg.height) || 180);
    const n = d.cur.length;
    const lastN = d.last.length;
    const showLast = this._showLast(d);
    const maxV = Math.max(d.goal, d.cur[d.today], showLast ? d.last[lastN - 1] : 0);
    const { max, step } = niceScale(maxV);
    const ticks = [];
    for (let v = 0; v <= max + step / 2; v += step) ticks.push(v);
    const tickLabels = ticks.map((v) => fmt(v));
    const left = Math.round(10 + Math.max(...tickLabels.map((t) => t.length)) * 6.6);
    const right = 8, top = 12, bottom = 24;
    const plotW = W - left - right, plotH = H - top - bottom;
    const x = (i) => left + (i / (n - 1)) * plotW;
    const y = (v) => top + plotH - (v / max) * plotH;
    const pts = (arr, upto) => arr.slice(0, upto + 1)
      .map((v, i) => `${x(Math.min(i, n - 1)).toFixed(1)},${y(v).toFixed(1)}`).join(" ");

    let out = "";
    ticks.forEach((v, i) => {
      const yy = Math.round(y(v)) + 0.5;
      out += `<line class="${i === 0 ? "axis" : "grid"}" x1="${left}" x2="${W - right}" y1="${yy}" y2="${yy}"/>`;
      out += `<text class="ylab" x="${left - 7}" y="${yy + 3.5}" text-anchor="end">${tickLabels[i]}</text>`;
    });
    // Monatsbeschriftung am Monatsanfang; wenn es eng wird, nur jeden zweiten Monat
    const every = plotW / 12 < 26 ? 2 : 1;
    for (let m = 0; m < 12; m += every) {
      const i = egcDayIndex(new Date(d.year, m, 1).getTime(), d.year);
      out += `<text class="xlab ${i > d.today ? "future" : ""}" x="${x(i)}" y="${H - 7}">${MONTHS_SHORT[m]}</text>`;
    }
    out += `<line class="goal" x1="${x(0)}" y1="${y(this._plan(d, 0))}" x2="${x(n - 1)}" y2="${y(d.goal)}"/>`;
    if (showLast) out += `<polyline class="last" points="${pts(d.last, lastN - 1)}"/>`;
    out += `<polyline class="cur" points="${pts(d.cur, d.today)}"/>`;
    out += `<circle class="now" cx="${x(d.today)}" cy="${y(d.cur[d.today])}" r="4"/>`;
    out += `<line class="hl" x1="0" x2="0" y1="${top}" y2="${top + plotH}" visibility="hidden"/>`;
    out += `<rect class="hit" x="${left}" y="0" width="${plotW}" height="${H}"/>`;

    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("width", W);
    svg.setAttribute("height", H);
    svg.innerHTML = out;
    this._geom = { left, plotW, n, x, W };
    if (this._hover >= 0) this._showTip(this._hover);
  }

  _showTip(i) {
    const root = this.shadowRoot;
    const tip = root.querySelector(".tip");
    const hl = root.querySelector("line.hl");
    const d = this._bike();
    if (!tip || !d || !this._geom) return;
    this._hover = i;
    const date = new Date(d.year, 0, 1 + i);
    const rows = [];
    if (i <= d.today) rows.push(["cur", String(d.year), d.cur[i]]);
    rows.push(["goal", "Ziel", this._plan(d, i)]);
    if (this._showLast(d)) rows.push(["last", String(d.year - 1), d.last[Math.min(i, d.last.length - 1)]]);
    tip.innerHTML = `
      <div class="tt">${date.getDate()}. ${MONTHS_LONG[date.getMonth()]}</div>
      ${rows.map(([cls, label, v]) => `
        <div class="tr"><i class="ln ${cls}"></i><span class="tn">${label}</span>
          <span class="tv">${fmt(v)} km</span></div>`).join("")}`;
    tip.hidden = false;
    const { x, W } = this._geom;
    const px = x(i);
    const tw = tip.offsetWidth;
    let left = px + 10;
    if (left + tw > W - 2) left = px - 10 - tw;
    tip.style.left = `${Math.max(2, left)}px`;
    if (hl) {
      hl.setAttribute("x1", px); hl.setAttribute("x2", px);
      hl.setAttribute("visibility", "visible");
    }
  }

  _hideTip() {
    this._hover = -1;
    const root = this.shadowRoot;
    const tip = root.querySelector(".tip");
    const hl = root.querySelector("line.hl");
    if (tip) tip.hidden = true;
    if (hl) hl.setAttribute("visibility", "hidden");
  }

  _css() {
    const bg = this._config.background;
    return `
      :host { display: block; }
      ha-card {
        ${bg ? `background: ${bg};` : ""}
        border-radius: 16px; padding: 14px 14px 14px; overflow: hidden;
        color: var(--primary-text-color);
        --sub: var(--secondary-text-color, #9e9e9e);
        --line: rgba(127,127,127,.18);
        --chip: rgba(127,127,127,.12);
      }
      button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; padding: 0; }
      .head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
      .title { font-size: 17px; font-weight: 600; }
      .sub { font-size: 13.5px; font-weight: 600; color: var(--sub); font-variant-numeric: tabular-nums; }
      .tabs { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0 12px; }
      .tab { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; flex: none;
             font-size: 12.5px; padding: 6px 10px; border-radius: 999px; background: var(--chip); color: var(--sub); }
      .tab.on { background: color-mix(in srgb, var(--c) 22%, transparent); color: var(--primary-text-color);
                font-weight: 600; box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--c) 60%, transparent); }
      .dot { width: 9px; height: 9px; border-radius: 3px; flex: none; display: inline-block; background: var(--c); }
      .chart { position: relative; min-height: 140px; touch-action: pan-y; }
      .chart svg { display: block; overflow: visible; user-select: none; -webkit-user-select: none; }
      .msg { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
             font-size: 13px; color: var(--sub); text-align: center; padding: 0 12px; }
      .msg.err { color: var(--error-color, #f44336); }
      line.grid { stroke: var(--line); stroke-dasharray: 3 4; }
      line.axis { stroke: rgba(127,127,127,.4); }
      text { font-family: inherit; fill: var(--sub); }
      text.ylab { font-size: 10.5px; font-variant-numeric: tabular-nums; }
      text.xlab { font-size: 11px; }
      text.xlab.future { opacity: .35; }
      polyline { fill: none; stroke-linejoin: round; stroke-linecap: round; }
      polyline.cur { stroke: var(--c); stroke-width: 2.5; }
      polyline.last { stroke: rgba(127,127,127,.55); stroke-width: 1.8; }
      line.goal { stroke: var(--sub); stroke-width: 1.5; stroke-dasharray: 5 5; }
      circle.now { fill: var(--c);
                   stroke: ${bg || "var(--ha-card-background, var(--card-background-color, #1e1e1e))"}; stroke-width: 2; }
      line.hl { stroke: rgba(127,127,127,.45); stroke-width: 1; }
      rect.hit { fill: transparent; cursor: crosshair; }
      .tip { position: absolute; top: 4px; z-index: 2; min-width: 140px; max-width: 230px; pointer-events: none;
             background: #2c2c2e; color: #fff; border-radius: 12px; padding: 9px 11px;
             box-shadow: 0 8px 24px rgba(0,0,0,.35); border: 1px solid rgba(255,255,255,.08); font-size: 12.5px; }
      .tt { font-weight: 600; margin-bottom: 6px; }
      .tr { display: flex; align-items: center; gap: 7px; line-height: 1.7; }
      .tn { flex: 1; opacity: .85; white-space: nowrap; }
      .tv { font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
      .ln { display: inline-block; width: 14px; height: 0; border-top: 2.5px solid var(--c); flex: none; border-radius: 2px; }
      .ln.goal { border-top: 1.5px dashed var(--sub); }
      .ln.last { border-top: 2px solid rgba(127,127,127,.55); }
      .legend { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 8px; font-size: 12px; color: var(--sub); }
      .legend span { display: inline-flex; align-items: center; gap: 6px; }
      .kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 12px; }
      .kpi { background: var(--chip); border-radius: 12px; padding: 8px 10px; min-width: 0; }
      .kv { font-size: 18px; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap;
            overflow: hidden; text-overflow: ellipsis; }
      .kv small { font-size: 11px; font-weight: 500; color: var(--sub); }
      .kv.good { color: var(--success-color, #4caf50); }
      .kv.bad { color: var(--warning-color, #ff9800); }
      .kl { font-size: 11px; color: var(--sub); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    `;
  }
}

registerCard("ebike-goal-card", EbikeGoalCard, "eBike Jahresziel",
  "Persönliches Jahresziel je Bike – kumulierte Kilometer gegen Ziel und Vorjahr");
