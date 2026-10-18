/*
 * eBike Stats Pro Card – Fahrstatistik
 *   type: custom:ebike-stats-pro-card
 * Liest alle Touren über den Websocket der Integration (bosch_ebike/list_activities)
 * und zeichnet saubere, skalierte Balkendiagramme mit Tooltips.
 *
 * Optional: metrics: [distance, elevation, rides, duration, speed, calories]
 *           legt fest, welche Reiter angezeigt werden (Reihenfolge wie angegeben).
 * Optional: show_totals: false blendet alle Summen über alle Bikes aus
 *           (Kennzahlen unten, Zahlen über den Balken, Summe im Tooltip).
 * Optional: legend_values: true zeigt in der Legende neben jedem Bike seine Summe im Zeitraum.
 */

import { PALETTE, MONTHS_SHORT, MONTHS_LONG, DAY } from "../shared/constants.js";
import { fmt, esc, niceScale } from "../shared/format.js";
import { isoWeek } from "../shared/time.js";
import { loadActivities } from "../shared/bosch.js";
import { registerCard } from "../shared/register.js";

const ESP_UNASSIGNED = "__none__";

const ESP_METRICS = {
  distance:  { label: "Distanz",    unit: "km",   digits: 0, tip: 1, sum: true,  icon: "mdi:map-marker-distance" },
  elevation: { label: "Höhenmeter", unit: "m",    digits: 0, tip: 0, sum: true,  icon: "mdi:image-filter-hdr" },
  rides:     { label: "Touren",     unit: "",     digits: 0, tip: 0, sum: true,  icon: "mdi:flag-checkered" },
  duration:  { label: "Fahrzeit",   unit: "h",    digits: 0, tip: 1, sum: true,  icon: "mdi:timer-outline" },
  speed:     { label: "Ø Tempo",    unit: "km/h", digits: 0, tip: 1, sum: false, icon: "mdi:speedometer" },
  calories:  { label: "Kalorien",   unit: "kcal", digits: 0, tip: 0, sum: true,  icon: "mdi:fire" },
};

const ESP_PERIODS = {
  week:  { label: "Wochen", unit: "Woche" },
  month: { label: "Monate", unit: "Monat" },
  year:  { label: "Jahre",  unit: "Jahr" },
};

function espDuration(a) {
  if (Number.isFinite(a.durationWithoutStops) && a.durationWithoutStops > 0) return a.durationWithoutStops;
  if (Number.isFinite(a.duration) && a.duration > 0) return a.duration;
  if (a.startTime && a.endTime) {
    const d = (Date.parse(a.endTime) - Date.parse(a.startTime)) / 1000;
    if (Number.isFinite(d) && d > 0) return d;
  }
  return 0;
}

function espEmptyAgg() { return { d: 0, e: 0, n: 0, t: 0, c: 0 }; }

function espAdd(target, src) {
  target.d += src.d; target.e += src.e; target.n += src.n; target.t += src.t; target.c += src.c;
  return target;
}

function espValue(metric, agg) {
  if (!agg) return metric === "speed" ? null : 0;
  switch (metric) {
    case "distance": return agg.d / 1000;
    case "elevation": return agg.e;
    case "rides": return agg.n;
    case "duration": return agg.t / 3600;
    case "calories": return agg.c;
    case "speed": return agg.t > 0 && agg.d > 0 ? (agg.d / 1000) / (agg.t / 3600) : null;
    default: return 0;
  }
}

class EbikeStatsProCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._acts = null;
    this._series = [];
    this._error = null;
    this._offset = 0;
    this._hover = -1;
    this._width = 0;
    this._bound = false;
  }

  static getStubConfig() {
    return { title: "Fahrstatistik" };
  }

  setConfig(config) {
    this._config = {
      title: "Fahrstatistik",
      metric: "distance",
      period: "month",
      stacked: true,
      height: 220,
      colors: {},
      names: {},
      hide_unassigned: false,
      show_totals: true,
      legend_values: false,
      refresh_minutes: 15,
      ...config,
    };
    const wanted = Array.isArray(this._config.metrics) ? this._config.metrics : Object.keys(ESP_METRICS);
    this._metrics = wanted.filter((m) => ESP_METRICS[m]);
    if (!this._metrics.length) this._metrics = Object.keys(ESP_METRICS);
    const saved = this._loadState();
    const pick = [saved.metric, this._config.metric].find((m) => this._metrics.includes(m));
    this._metric = pick || this._metrics[0];
    this._period = saved.period && ESP_PERIODS[saved.period] ? saved.period : this._config.period;
    this._stacked = typeof saved.stacked === "boolean" ? saved.stacked : this._config.stacked !== false;
    this._hidden = new Set(Array.isArray(saved.hidden) ? saved.hidden : []);
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

  /* ---------- persistence (per browser, only UI convenience) ---------- */
  _stateKey() { return `ebike-stats-pro:${this._config?.title || ""}`; }
  _loadState() {
    try { return JSON.parse(localStorage.getItem(this._stateKey()) || "{}") || {}; } catch (e) { return {}; }
  }
  _saveState() {
    try {
      localStorage.setItem(this._stateKey(), JSON.stringify({
        metric: this._metric, period: this._period, stacked: this._stacked, hidden: [...this._hidden],
      }));
    } catch (e) { /* ignore */ }
  }

  /* ---------------------------- data ---------------------------- */
  async _load() {
    try {
      const [instances, activities] = await loadActivities(this._hass);
      this._buildSeries(instances, activities);
      this._error = null;
    } catch (e) {
      this._error = e?.message || String(e);
    }
    this._render();
  }

  _buildSeries(instances, activities) {
    const cfg = this._config;
    const series = [];
    const known = new Set();
    let pi = 0;
    for (const inst of instances) {
      for (const bike of inst.bikes || []) {
        if (known.has(bike.id)) continue;
        known.add(bike.id);
        const label = bike.label || bike.id;
        series.push({
          id: bike.id,
          label,
          name: cfg.names[label] || cfg.names[bike.id] || label,
          color: cfg.colors[label] || cfg.colors[bike.id] || PALETTE[pi++ % PALETTE.length],
        });
      }
    }
    if (Array.isArray(cfg.order)) {
      const idx = (s) => {
        const i = cfg.order.findIndex((o) => o === s.label || o === s.name || o === s.id);
        return i < 0 ? 999 : i;
      };
      series.sort((a, b) => idx(a) - idx(b));
    }

    let hasUnassigned = false;
    this._acts = [];
    for (const a of activities) {
      const ts = Date.parse(a.startTime);
      if (!Number.isFinite(ts)) continue;
      let sid = a.bikeId && known.has(a.bikeId) ? a.bikeId : ESP_UNASSIGNED;
      if (sid === ESP_UNASSIGNED) {
        if (cfg.hide_unassigned) continue;
        hasUnassigned = true;
      }
      this._acts.push({
        ts, sid,
        agg: {
          d: Number(a.distance) || 0,
          e: Number(a.elevation?.gain) || 0,
          n: 1,
          t: espDuration(a),
          c: Number(a.caloriesBurned) || 0,
        },
      });
    }
    if (hasUnassigned) {
      series.push({ id: ESP_UNASSIGNED, label: "Nicht zugeordnet", name: "Nicht zugeordnet", color: "#9e9e9e" });
    }
    this._series = series;
    this._earliest = this._acts.reduce((m, a) => Math.min(m, a.ts), Infinity);
  }

  /* --------------------------- buckets --------------------------- */
  _buckets() {
    const now = new Date();
    const out = [];
    if (this._period === "month") {
      const y = now.getFullYear() - this._offset;
      for (let m = 0; m < 12; m++) {
        const start = new Date(y, m, 1).getTime();
        out.push({
          start, end: new Date(y, m + 1, 1).getTime(),
          short: MONTHS_SHORT[m], long: `${MONTHS_LONG[m]} ${y}`,
          future: start > now.getTime(),
        });
      }
      return { buckets: out, range: String(y) };
    }
    if (this._period === "week") {
      const dow = (now.getDay() + 6) % 7;
      const thisMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow);
      for (let i = 11; i >= 0; i--) {
        const s = new Date(thisMonday.getFullYear(), thisMonday.getMonth(),
          thisMonday.getDate() - (i + this._offset * 12) * 7);
        const e = new Date(s.getFullYear(), s.getMonth(), s.getDate() + 7);
        const last = new Date(e.getTime() - DAY);
        const kw = isoWeek(s);
        out.push({
          start: s.getTime(), end: e.getTime(),
          short: String(kw),
          long: `KW ${kw} · ${s.getDate()}.${s.getMonth() + 1}. – ${last.getDate()}.${last.getMonth() + 1}.${last.getFullYear()}`,
          future: s.getTime() > now.getTime(),
        });
      }
      const a = out[0], b = out[out.length - 1];
      return { buckets: out, range: `KW ${a.short} – KW ${b.short} · ${new Date(b.start).getFullYear()}` };
    }
    // years
    const cur = now.getFullYear();
    const first = Number.isFinite(this._earliest) ? new Date(this._earliest).getFullYear() : cur;
    const from = Math.max(first, cur - 11);
    for (let y = from; y <= cur; y++) {
      out.push({
        start: new Date(y, 0, 1).getTime(), end: new Date(y + 1, 0, 1).getTime(),
        short: String(y), long: String(y), future: false,
      });
    }
    return { buckets: out, range: from === cur ? String(cur) : `${from} – ${cur}` };
  }

  _aggregate() {
    const { buckets, range } = this._buckets();
    for (const b of buckets) b.agg = {};
    const lo = buckets[0].start, hi = buckets[buckets.length - 1].end;
    for (const a of this._acts || []) {
      if (a.ts < lo || a.ts >= hi) continue;
      const b = buckets.find((x) => a.ts >= x.start && a.ts < x.end);
      if (!b) continue;
      espAdd(b.agg[a.sid] || (b.agg[a.sid] = espEmptyAgg()), a.agg);
    }
    return { buckets, range };
  }

  _visibleSeries() {
    return this._series.filter((s) => !this._hidden.has(s.id));
  }

  /* --------------------------- render --------------------------- */
  _render() {
    if (!this._config) return;
    const root = this.shadowRoot;
    const cfg = this._config;
    const metric = ESP_METRICS[this._metric];
    const loading = this._acts === null && !this._error;
    const agg = this._acts ? this._aggregate() : null;
    this._agg = agg;

    const metricTabs = this._metrics.map((k) => [k, ESP_METRICS[k]]).map(([k, m]) => `
      <button class="tab ${k === this._metric ? "on" : ""}" data-metric="${k}">
        <ha-icon icon="${m.icon}"></ha-icon><span>${m.label}</span>
      </button>`).join("");

    const periodSeg = Object.entries(ESP_PERIODS).map(([k, p]) => `
      <button class="${k === this._period ? "on" : ""}" data-period="${k}">${p.label}</button>`).join("");

    const canPrev = agg && this._period !== "year" && Number.isFinite(this._earliest)
      && this._earliest < agg.buckets[0].start;
    const canNext = this._period !== "year" && this._offset > 0;
    const stackDisabled = !metric.sum;

    root.innerHTML = `
      <style>${this._css()}</style>
      <ha-card>
        <div class="head">
          <div class="title">${esc(cfg.title)}</div>
          <div class="seg">${periodSeg}</div>
        </div>
        <div class="tabs">${metricTabs}</div>
        <div class="bar">
          <button class="icon-btn" data-nav="-1" ${canPrev ? "" : "disabled"} aria-label="Zurück">
            <ha-icon icon="mdi:chevron-left"></ha-icon></button>
          <div class="range">${agg ? esc(agg.range) : ""}</div>
          <button class="icon-btn" data-nav="1" ${canNext ? "" : "disabled"} aria-label="Weiter">
            <ha-icon icon="mdi:chevron-right"></ha-icon></button>
          <div class="spacer"></div>
          ${stackDisabled ? "" : `<button class="toggle" data-stack
              title="${this._stacked ? "Nebeneinander anzeigen" : "Gestapelt anzeigen"}">
            <ha-icon icon="${this._stacked ? "mdi:chart-bar-stacked" : "mdi:chart-bar"}"></ha-icon>
            <span>${this._stacked ? "Gestapelt" : "Nebeneinander"}</span>
          </button>`}
        </div>
        <div class="chart">
          ${this._error ? `<div class="msg err">Fehler beim Laden: ${esc(this._error)}</div>`
            : loading ? `<div class="msg">Lade Touren …</div>` : ""}
          <svg class="plot"></svg>
          <div class="tip" hidden></div>
        </div>
        <div class="legend"></div>
        ${cfg.show_totals ? `<div class="kpis"></div>` : ""}
      </ha-card>`;

    this._bindOnce();
    const wrap = root.querySelector(".chart");
    this._width = Math.round(wrap.clientWidth) || this._width;
    if (agg) {
      this._drawChart();
      this._drawLegend();
      this._drawKpis();
    }
  }

  _bindOnce() {
    if (this._bound) return;
    this._bound = true;
    const root = this.shadowRoot;
    root.addEventListener("click", (ev) => {
      const t = ev.target.closest("button");
      if (!t || t.disabled) return;
      if (t.dataset.metric) { this._metric = t.dataset.metric; }
      else if (t.dataset.period) { this._period = t.dataset.period; this._offset = 0; }
      else if (t.dataset.nav) { this._offset = Math.max(0, this._offset - Number(t.dataset.nav)); }
      else if (t.hasAttribute("data-stack")) { this._stacked = !this._stacked; }
      else if (t.dataset.series) {
        const id = t.dataset.series;
        if (this._hidden.has(id)) this._hidden.delete(id); else this._hidden.add(id);
      } else return;
      this._hover = -1;
      this._saveState();
      this._render();
    });
    root.addEventListener("pointermove", (ev) => {
      const hit = ev.target.closest?.(".hit");
      if (hit) this._showTip(Number(hit.dataset.i));
    });
    root.addEventListener("pointerdown", (ev) => {
      const hit = ev.target.closest?.(".hit");
      if (hit) this._showTip(Number(hit.dataset.i));
      else if (!ev.target.closest?.(".tip")) this._hideTip();
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
    const agg = this._agg;
    if (!svg || !agg) return;
    const W = Math.max(260, this._width || root.querySelector(".chart").clientWidth || 360);
    const H = Math.max(140, Number(this._config.height) || 220);
    const metricKey = this._metric;
    const metric = ESP_METRICS[metricKey];
    const series = this._visibleSeries();
    const stacked = this._stacked && metric.sum;
    const buckets = agg.buckets;
    const n = buckets.length;

    const vals = buckets.map((b) => series.map((s) => espValue(metricKey, b.agg[s.id])));
    const totals = buckets.map((b) => {
      const all = espEmptyAgg();
      for (const s of series) if (b.agg[s.id]) espAdd(all, b.agg[s.id]);
      return espValue(metricKey, all);
    });
    let maxV = 0;
    vals.forEach((row, i) => {
      if (stacked) maxV = Math.max(maxV, row.reduce((a, v) => a + (v || 0), 0));
      else row.forEach((v) => { if (v) maxV = Math.max(maxV, v); });
      if (!metric.sum && totals[i]) maxV = Math.max(maxV, totals[i]);
    });
    const { max, step } = niceScale(maxV);
    const ticks = [];
    for (let v = 0; v <= max + step / 2; v += step) ticks.push(v);
    const tickDigits = step < 1 ? 1 : 0;
    const tickLabels = ticks.map((v) => fmt(v, tickDigits));
    const left = Math.round(10 + Math.max(...tickLabels.map((t) => t.length)) * 6.6);
    const right = 6, top = 14, bottom = 24;
    const plotW = W - left - right, plotH = H - top - bottom;
    const band = plotW / n;
    const y = (v) => top + plotH - (v / max) * plotH;
    const base = top + plotH;

    let out = "";
    // grid + y labels
    ticks.forEach((v, i) => {
      const yy = Math.round(y(v)) + 0.5;
      out += `<line class="${i === 0 ? "axis" : "grid"}" x1="${left}" x2="${W - right}" y1="${yy}" y2="${yy}"/>`;
      out += `<text class="ylab" x="${left - 7}" y="${yy + 3.5}" text-anchor="end">${tickLabels[i]}</text>`;
    });
    // highlight band (filled on hover)
    out += `<rect class="hl" x="0" y="${top - 6}" width="${band}" height="${plotH + 6}" rx="8" visibility="hidden"/>`;

    const defs = [];
    buckets.forEach((b, i) => {
      const cx = left + i * band + band / 2;
      if (stacked) {
        const total = vals[i].reduce((a, v) => a + (v || 0), 0);
        if (total > 0) {
          const bw = Math.min(band * 0.6, 40);
          const x0 = cx - bw / 2;
          const yt = y(total);
          const r = Math.min(5, bw / 3);
          defs.push(`<clipPath id="c${i}"><rect x="${x0}" y="${yt}" width="${bw}" height="${base - yt + r}" rx="${r}"/></clipPath>`);
          let acc = 0;
          out += `<g clip-path="url(#c${i})">`;
          series.forEach((s, k) => {
            const v = vals[i][k] || 0;
            if (v <= 0) return;
            const y1 = y(acc + v), y0 = y(acc);
            out += `<rect class="seg" x="${x0}" y="${y1}" width="${bw}" height="${Math.max(0.8, y0 - y1)}" fill="${s.color}"/>`;
            acc += v;
          });
          out += `</g>`;
          const lbl = fmt(total, metric.digits);
          if (this._config.show_totals && band >= lbl.length * 6.4 + 6) {
            out += `<text class="vlab" x="${cx}" y="${yt - 4}" text-anchor="middle">${lbl}</text>`;
          }
        }
      } else if (!metric.sum) {
        // Durchschnittswerte: ein Balken für den Gesamtschnitt, Punkte je Bike
        const t = totals[i];
        if (t && t > 0) {
          const bw = Math.min(band * 0.6, 40);
          const x0 = cx - bw / 2;
          const yt = y(t);
          const r = Math.min(5, bw / 3);
          defs.push(`<clipPath id="c${i}"><rect x="${x0}" y="${yt}" width="${bw}" height="${base - yt + r}" rx="${r}"/></clipPath>`);
          out += `<rect class="avgbar" clip-path="url(#c${i})" x="${x0}" y="${yt}" width="${bw}" height="${base - yt}"/>`;
          const lbl = fmt(t, 1);
          if (band >= lbl.length * 6.4 + 6) {
            out += `<text class="vlab" x="${cx}" y="${yt - 6}" text-anchor="middle">${lbl}</text>`;
          }
          series.forEach((s, j) => {
            const v = vals[i][j];
            if (!v || v <= 0) return;
            out += `<circle class="pt" cx="${cx}" cy="${y(v)}" r="4" fill="${s.color}"/>`;
          });
        }
      } else {
        const k = series.length || 1;
        const inner = Math.min(band * 0.84, k * 16);
        const bw = inner / k;
        series.forEach((s, j) => {
          const v = vals[i][j];
          if (!v || v <= 0) return;
          const x = cx - inner / 2 + j * bw + 0.75;
          const yt = y(v);
          const w = Math.max(1.5, bw - 1.5);
          const r = Math.min(3, w / 2);
          defs.push(`<clipPath id="c${i}_${j}"><rect x="${x}" y="${yt}" width="${w}" height="${base - yt + r}" rx="${r}"/></clipPath>`);
          out += `<rect class="seg" clip-path="url(#c${i}_${j})" x="${x}" y="${yt}" width="${w}" height="${base - yt}" fill="${s.color}"/>`;
        });
      }
      out += `<text class="xlab ${b.future ? "future" : ""}" x="${cx}" y="${H - 7}" text-anchor="middle">${esc(b.short)}</text>`;
    });
    // hit areas on top
    buckets.forEach((b, i) => {
      out += `<rect class="hit" data-i="${i}" x="${left + i * band}" y="0" width="${band}" height="${H}"/>`;
    });

    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("width", W);
    svg.setAttribute("height", H);
    svg.innerHTML = `<defs>${defs.join("")}</defs>${out}`;
    this._geom = { left, band, top, W };
    if (this._hover >= 0) this._showTip(this._hover);
  }

  _drawLegend() {
    const root = this.shadowRoot;
    const el = root.querySelector(".legend");
    if (!el) return;
    if (!this._series.length) { el.innerHTML = `<div class="muted">Keine Bikes gefunden</div>`; return; }
    const metricKey = this._metric;
    const metric = ESP_METRICS[metricKey];
    el.innerHTML = this._series.map((s) => {
      let val = "";
      if (this._config.legend_values) {
        const all = espEmptyAgg();
        for (const b of this._agg.buckets) if (b.agg[s.id]) espAdd(all, b.agg[s.id]);
        const v = espValue(metricKey, all);
        val = `<span class="val">${fmt(v, metric.sum ? metric.digits : metric.tip)}${metric.unit ? `&nbsp;${metric.unit}` : ""}</span>`;
      }
      const off = this._hidden.has(s.id);
      return `<button class="chip ${off ? "off" : ""}" data-series="${esc(s.id)}" title="${off ? "Einblenden" : "Ausblenden"}">
          <span class="dot" style="background:${s.color}"></span>
          <span class="name">${esc(s.name)}</span>
          ${val}
        </button>`;
    }).join("");
  }

  _drawKpis() {
    const root = this.shadowRoot;
    const el = root.querySelector(".kpis");
    if (!el) return;
    const metricKey = this._metric;
    const metric = ESP_METRICS[metricKey];
    const series = this._visibleSeries();
    const first = Number.isFinite(this._earliest) ? this._earliest : 0;
    const buckets = this._agg.buckets.filter((b) => !b.future && b.end > first);
    const periodUnit = ESP_PERIODS[this._period].unit;
    const all = espEmptyAgg();
    let best = null, bestV = -1;
    for (const b of buckets) {
      const ba = espEmptyAgg();
      for (const s of series) if (b.agg[s.id]) espAdd(ba, b.agg[s.id]);
      espAdd(all, ba);
      const v = espValue(metricKey, ba);
      if (v !== null && v > bestV && ba.n > 0) { bestV = v; best = b; }
    }
    const total = espValue(metricKey, all);
    const unit = metric.unit ? ` <small>${metric.unit}</small>` : "";
    const kpi = (label, value, sub = "") =>
      `<div class="kpi"><div class="kv">${value}</div><div class="kl">${label}${sub ? ` · ${sub}` : ""}</div></div>`;

    let html = "";
    if (metric.sum) {
      html += kpi("Gesamt", fmt(total, metric.tip) + unit);
      const avg = buckets.length ? total / buckets.length : 0;
      html += kpi(`Ø pro ${periodUnit}`, fmt(avg, metric.tip) + unit);
    } else {
      html += kpi("Ø gesamt", fmt(total, metric.tip) + unit);
      html += kpi("Touren", fmt(all.n));
    }
    const stem = metricKey === "speed" ? "Schnellste" : "Beste";
    const bestWord = stem + (this._period === "month" ? "r" : this._period === "year" ? "s" : "");
    const bestName = !best ? "" : this._period === "month"
      ? MONTHS_LONG[new Date(best.start).getMonth()]
      : this._period === "week" ? `KW ${best.short}` : best.short;
    html += kpi(best ? `${bestWord}: ${esc(bestName)}` : `${bestWord} ${periodUnit}`,
      best ? fmt(bestV, metric.tip) + unit : "–");
    el.innerHTML = html;
  }

  _showTip(i) {
    const root = this.shadowRoot;
    const tip = root.querySelector(".tip");
    const hl = root.querySelector("rect.hl");
    const agg = this._agg;
    if (!tip || !agg || !this._geom || i < 0 || i >= agg.buckets.length) return;
    this._hover = i;
    const { left, band, W } = this._geom;
    const b = agg.buckets[i];
    const metricKey = this._metric;
    const metric = ESP_METRICS[metricKey];
    const series = this._visibleSeries();
    const all = espEmptyAgg();
    const rows = [];
    for (const s of series) {
      const a = b.agg[s.id];
      if (!a || a.n === 0) continue;
      espAdd(all, a);
      rows.push({ s, v: espValue(metricKey, a), n: a.n });
    }
    rows.sort((p, q) => (q.v || 0) - (p.v || 0));
    const u = metric.unit ? ` ${metric.unit}` : "";
    const total = espValue(metricKey, all);
    tip.innerHTML = `
      <div class="tt">${esc(b.long)}</div>
      ${rows.length ? rows.map((r) => `
        <div class="tr"><span class="dot" style="background:${r.s.color}"></span>
          <span class="tn">${esc(r.s.name)}</span>
          <span class="tv">${fmt(r.v, metric.tip)}${u}</span></div>`).join("")
        : `<div class="muted">Keine Touren</div>`}
      ${this._config.show_totals && (rows.length > 1 || (rows.length && metricKey !== "rides")) ? `
        <div class="tsum"><span>${metric.sum ? "Summe" : "Ø gesamt"}</span>
          <span>${fmt(total, metric.tip)}${u}</span></div>` : ""}
      ${this._config.show_totals && rows.length && metricKey !== "rides" ? `<div class="tfoot">${fmt(all.n)} ${all.n === 1 ? "Tour" : "Touren"}</div>` : ""}`;
    tip.hidden = false;
    const cx = left + i * band + band / 2;
    const tw = tip.offsetWidth;
    let x = cx + band / 2 + 6;
    if (x + tw > W - 2) x = cx - band / 2 - 6 - tw;
    x = Math.max(2, Math.min(x, W - tw - 2));
    tip.style.left = `${x}px`;
    if (hl) {
      hl.setAttribute("x", left + i * band);
      hl.setAttribute("visibility", "visible");
    }
  }

  _hideTip() {
    this._hover = -1;
    const root = this.shadowRoot;
    const tip = root.querySelector(".tip");
    const hl = root.querySelector("rect.hl");
    if (tip) tip.hidden = true;
    if (hl) hl.setAttribute("visibility", "hidden");
  }

  _css() {
    const bg = this._config.background;
    return `
      :host { display: block; }
      ha-card {
        ${bg ? `background: ${bg};` : ""}
        border-radius: 16px; padding: 14px 14px 12px; overflow: hidden;
        color: var(--primary-text-color);
        --esp-sub: var(--secondary-text-color, #9e9e9e);
        --esp-line: rgba(127,127,127,.18);
        --esp-chip: rgba(127,127,127,.12);
        --esp-accent: var(--primary-color, #03a9f4);
      }
      button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; padding: 0; }
      button:disabled { opacity: .3; cursor: default; }
      .head { display: flex; align-items: center; gap: 10px; justify-content: space-between; flex-wrap: wrap; }
      .title { font-size: 17px; font-weight: 600; }
      .seg { display: inline-flex; background: var(--esp-chip); border-radius: 10px; padding: 3px; }
      .seg button { font-size: 12.5px; padding: 5px 10px; border-radius: 8px; color: var(--esp-sub); }
      .seg button.on { background: var(--esp-accent); color: #fff; font-weight: 600; }
      .tabs { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0 4px; }
      .tab { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; flex: none;
             font-size: 12.5px; padding: 6px 10px; border-radius: 999px; background: var(--esp-chip);
             color: var(--esp-sub); }
      .tab ha-icon { --mdc-icon-size: 15px; width: 15px; height: 15px; display: inline-flex; }
      .tab.on { background: color-mix(in srgb, var(--esp-accent) 22%, transparent);
                color: var(--primary-text-color); font-weight: 600;
                box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--esp-accent) 55%, transparent); }
      .bar { display: flex; align-items: center; gap: 4px; margin: 8px 0 2px; }
      .icon-btn { width: 30px; height: 30px; border-radius: 8px; display: inline-flex;
                  align-items: center; justify-content: center; }
      .icon-btn:not(:disabled):hover, .toggle:not(:disabled):hover { background: var(--esp-chip); }
      .icon-btn ha-icon { --mdc-icon-size: 20px; }
      .range { font-size: 13.5px; font-weight: 600; min-width: 46px; text-align: center; }
      .spacer { flex: 1; }
      .toggle { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--esp-sub);
                padding: 5px 8px; border-radius: 8px; }
      .toggle ha-icon { --mdc-icon-size: 16px; width: 16px; height: 16px; display: inline-flex; }
      .chart { position: relative; min-height: 140px; touch-action: pan-y; }
      .chart svg { display: block; overflow: visible; user-select: none; -webkit-user-select: none; }
      .msg { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
             font-size: 13px; color: var(--esp-sub); text-align: center; padding: 0 12px; }
      .msg.err { color: var(--error-color, #f44336); }
      line.grid { stroke: var(--esp-line); stroke-dasharray: 3 4; }
      line.axis { stroke: rgba(127,127,127,.4); }
      text { font-family: inherit; fill: var(--esp-sub); }
      text.ylab { font-size: 10.5px; font-variant-numeric: tabular-nums; }
      text.xlab { font-size: 11px; }
      text.xlab.future { opacity: .35; }
      text.vlab { font-size: 10px; font-weight: 600; fill: var(--primary-text-color); opacity: .8;
                  font-variant-numeric: tabular-nums; }
      rect.seg { stroke: ${bg || "var(--ha-card-background, var(--card-background-color, #1e1e1e))"}; stroke-width: 1; }
      rect.hl { fill: rgba(127,127,127,.12); }
      rect.avgbar { fill: rgba(127,127,127,.28); }
      circle.pt { stroke: ${bg || "var(--ha-card-background, var(--card-background-color, #1e1e1e))"}; stroke-width: 1.5; }
      rect.hit { fill: transparent; cursor: pointer; }
      .tip { position: absolute; top: 4px; z-index: 2; min-width: 150px; max-width: 230px; pointer-events: none;
             background: var(--esp-tip-bg, #2c2c2e); color: #fff; border-radius: 12px; padding: 9px 11px;
             box-shadow: 0 8px 24px rgba(0,0,0,.35); border: 1px solid rgba(255,255,255,.08);
             font-size: 12.5px; }
      .tt { font-weight: 600; margin-bottom: 6px; font-size: 12.5px; }
      .tr { display: flex; align-items: center; gap: 7px; line-height: 1.7; }
      .tn { flex: 1; opacity: .85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .tv { font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
      .tsum { display: flex; justify-content: space-between; gap: 10px; margin-top: 5px; padding-top: 5px;
              border-top: 1px solid rgba(255,255,255,.12); font-weight: 600; font-variant-numeric: tabular-nums; }
      .tfoot { margin-top: 2px; font-size: 11px; opacity: .6; }
      .dot { width: 9px; height: 9px; border-radius: 3px; flex: none; display: inline-block; }
      .legend { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
      .chip { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; padding: 5px 9px;
              border-radius: 999px; background: var(--esp-chip); transition: opacity .15s; }
      .chip .name { white-space: nowrap; }
      .chip .val { color: var(--esp-sub); font-variant-numeric: tabular-nums; white-space: nowrap; }
      .chip.off { opacity: .4; }
      .chip.off .dot { background: transparent !important; box-shadow: inset 0 0 0 1.5px var(--esp-sub); }
      .kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 12px; }
      .kpi { background: var(--esp-chip); border-radius: 12px; padding: 8px 10px; min-width: 0; }
      .kv { font-size: 18px; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap;
            overflow: hidden; text-overflow: ellipsis; }
      .kv small { font-size: 11px; font-weight: 500; color: var(--esp-sub); }
      .kl { font-size: 11px; color: var(--esp-sub); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .muted { color: var(--esp-sub); font-size: 12px; }
    `;
  }
}

registerCard("ebike-stats-pro-card", EbikeStatsProCard, "eBike Stats Pro",
  "Fahrstatistik mit Tooltips für die Bosch eBike Integration");
