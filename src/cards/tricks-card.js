/* =====================================================================
 * eBike Tricks Card – Wheelie, Manual, Stoppie, Jump je Bike
 *   type: custom:ebike-tricks-card
 *   bikes: [{ name, prefix | bike, color }]
 *     prefix: Entitäts-Präfix wie bei der Vergleichskarte (e_bike_trekking)
 *     bike:   alternativ Gerätename oder Bike-ID aus der Integration
 *   Optional: trick: jump | wheelie | manual | stoppie  (Start-Reiter)
 *             tricks: [jump, wheelie, manual, stoppie]  (Reiter + Reihenfolge)
 *             sort: false behält die Reihenfolge aus 'bikes'
 *             show_leader: true markiert die Bestwerte mit einem Pokal
 * Die Werte werden über alle Touren aus dem Websocket summiert
 * (trickCheck je Tour), nicht nur aus der letzten Fahrt.
 * Unter jedem Bestwert steht die Fahrt, in der er erreicht wurde (Datum, Uhrzeit, Titel).
 * ===================================================================== */

import { PALETTE } from "../shared/constants.js";
import { fmt, esc } from "../shared/format.js";
import { clock, shortDate, weekdayDateTime } from "../shared/time.js";
import { loadActivities, allBikes, resolveBikeId } from "../shared/bosch.js";
import { registerCard } from "../shared/register.js";

const ETC_TRICKS = {
  jump:    { key: "jumps",    label: "Jump",    plural: "Jumps",    rot: -6,  lift: -4, stats: ["height", "dist", "dur"] },
  wheelie: { key: "wheelies", label: "Wheelie", plural: "Wheelies", rot: -24, lift: 0,  stats: ["dur", "dist", "angle"] },
  manual:  { key: "manuals",  label: "Manual",  plural: "Manuals",  rot: -12, lift: 0,  stats: ["dur", "dist", "angle"] },
  stoppie: { key: "stoppies", label: "Stoppie", plural: "Stoppies", rot: 22,  lift: 0,  stats: ["dur", "dist", "angle"] },
};

const ETC_STATS = {
  dur:    { field: "max_duration_s", label: "max. Dauer",  unit: "s", digits: 1, optional: false },
  dist:   { field: "max_distance_m", label: "max. Weite",  unit: "m", digits: 1, optional: false },
  height: { field: "max_height_m",   label: "max. Höhe",   unit: "m", digits: 2, optional: false },
  angle:  { field: "max_angle_deg",  label: "max. Winkel", unit: "°", digits: 0, optional: true },
};

class EbikeTricksCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._stats = null;
    this._error = null;
    this._bound = false;
  }

  static getStubConfig() { return { title: "Tricks", bikes: [] }; }

  setConfig(config) {
    if (!Array.isArray(config.bikes) || !config.bikes.length) {
      throw new Error("Bitte unter 'bikes' mindestens ein Bike mit name und prefix (oder bike) angeben");
    }
    this._config = { title: "Tricks", sort: true, refresh_minutes: 15, ...config };
    const wanted = Array.isArray(config.tricks) ? config.tricks : Object.keys(ETC_TRICKS);
    this._tricks = wanted.filter((t) => ETC_TRICKS[t]);
    if (!this._tricks.length) this._tricks = Object.keys(ETC_TRICKS);
    let saved = null;
    try { saved = localStorage.getItem(`ebike-tricks:${this._config.title}`); } catch (e) { /* ignore */ }
    this._trick = this._tricks.includes(saved) ? saved
      : this._tricks.includes(config.trick) ? config.trick : this._tricks[0];
    if (this._raw) this._aggregate(...this._raw);
    this._render();
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) this._load();
  }

  getCardSize() { return 2 + this._config.bikes.length * 2; }

  connectedCallback() {
    const mins = Math.max(1, Number(this._config?.refresh_minutes) || 15);
    this._timer = setInterval(() => this._hass && this._load(), mins * 60000);
  }

  disconnectedCallback() { clearInterval(this._timer); }

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
    const bikes = allBikes(instances);
    const stats = this._config.bikes.map((cb, i) => {
      const per = {};
      for (const t of Object.keys(ETC_TRICKS)) {
        per[t] = { n: 0, best: {} };
      }
      return {
        name: cb.name || cb.bike || cb.prefix,
        color: cb.color || PALETTE[i % PALETTE.length],
        id: resolveBikeId(cb, bikes),
        hasData: false,
        per,
        order: i,
      };
    });
    const byId = new Map(stats.filter((s) => s.id).map((s) => [s.id, s]));
    for (const a of activities) {
      const s = a.bikeId && byId.get(a.bikeId);
      const tc = a.trickCheck;
      if (!s || !tc || typeof tc !== "object") continue;
      s.hasData = true;
      const ts = Date.parse(a.startTime);
      for (const [t, def] of Object.entries(ETC_TRICKS)) {
        const e = tc[def.key];
        if (!e || !(Number(e.amount) > 0)) continue;
        const agg = s.per[t];
        agg.n += Number(e.amount);
        for (const sk of def.stats) {
          const v = Number(e[ETC_STATS[sk].field]);
          if (!Number.isFinite(v) || v <= 0) continue;
          if (!agg.best[sk] || v > agg.best[sk].v) agg.best[sk] = { v, ts, title: typeof a.title === "string" ? a.title.trim() : "" };
        }
      }
    }
    this._stats = stats;
  }

  _render() {
    if (!this._config) return;
    const cfg = this._config;
    const def = ETC_TRICKS[this._trick];

    const tabs = this._tricks.map((k) => {
      const t = ETC_TRICKS[k];
      return `
      <button class="tab ${k === this._trick ? "on" : ""}" data-trick="${k}">
        <ha-icon icon="mdi:bicycle" style="transform:translateY(${t.lift}px) rotate(${t.rot}deg)"></ha-icon><span>${t.label}</span>
      </button>`;
    }).join("");

    let body = "";
    if (this._error) {
      body = `<div class="msg err">Fehler beim Laden: ${esc(this._error)}</div>`;
    } else if (!this._stats) {
      body = `<div class="msg">Lade Touren …</div>`;
    } else {
      const rows = this._stats.map((s) => ({ s, a: s.per[this._trick] }));
      if (cfg.sort !== false) {
        rows.sort((p, q) => (q.s.hasData ? q.a.n : -1) - (p.s.hasData ? p.a.n : -1) || p.s.order - q.s.order);
      }
      const statKeys = def.stats.filter((sk) => !ETC_STATS[sk].optional
        || rows.some((r) => r.a.best[sk]));
      const recs = {};
      for (const sk of statKeys) recs[sk] = Math.max(0, ...rows.map((r) => r.a.best[sk]?.v || 0));
      const trophy = `<ha-icon class="crown" icon="mdi:trophy"></ha-icon>`;

      body = rows.map(({ s, a }) => {
        let detail;
        if (!s.id) {
          detail = `<div class="muted">Bike nicht gefunden – bitte 'prefix' oder 'bike' prüfen</div>`;
        } else if (!s.hasData) {
          detail = `<div class="muted">Keine Trick-Daten von Bosch</div>`;
        } else {
          detail = `<div class="bests" style="grid-template-columns:repeat(${statKeys.length}, 1fr)">${statKeys.map((sk) => {
            const st = ETC_STATS[sk];
            const b = a.best[sk];
            const rec = cfg.show_leader && b && b.v === recs[sk] && recs[sk] > 0;
            // Darunter die Fahrt, in der der Bestwert erreicht wurde (Datum, Uhrzeit, Tourtitel)
            const tip = b && Number.isFinite(b.ts) ? `${weekdayDateTime(b.ts)}${b.title ? ` · ${b.title}` : ""}` : "";
            return `<div class="best" ${tip ? `title="${esc(tip)}"` : ""}>
                <div class="bv">${b ? `${fmt(b.v, sk === "dur" && b.v < 1 ? 2 : st.digits)}<small>${st.unit === "°" ? "°" : `&nbsp;${st.unit}`}</small>` : "–"}${rec ? trophy : ""}</div>
                <div class="bl">${st.label}</div>
                ${tip ? `<div class="ride">
                  <div class="rd">${shortDate(b.ts)} · ${clock(b.ts)}</div>
                  ${b.title ? `<div class="rt">${esc(b.title)}</div>` : ""}
                </div>` : ""}
              </div>`;
          }).join("")}</div>`;
        }
        return `
          <div class="row">
            <div class="line">
              <span class="name"><span class="dot" style="background:${s.color}"></span>${esc(s.name)}</span>
              <span class="cnt">${s.hasData ? fmt(a.n) : "–"}${s.hasData ? `<small>${a.n === 1 ? def.label : def.plural}</small>` : ""}</span>
            </div>
            ${detail}
          </div>`;
      }).join("");
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
        .list { display: flex; flex-direction: column; gap: 16px; }
        .line { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
        .name { font-size: 14px; display: inline-flex; align-items: center; gap: 7px; min-width: 0;
                white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .dot { width: 9px; height: 9px; border-radius: 3px; flex: none; display: inline-block; }
        .cnt { font-size: 18px; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .cnt small { font-size: 11px; font-weight: 500; color: var(--sub); margin-left: 4px; }
        .bests { display: grid; gap: 6px; margin-top: 6px; }
        .best { background: var(--chip); border-radius: 10px; padding: 6px 8px; min-width: 0; }
        .bv { font-size: 14.5px; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap;
              display: flex; align-items: center; gap: 4px; overflow: hidden; }
        .bv small { font-size: 11px; font-weight: 500; color: var(--sub); }
        .bl { font-size: 11px; color: var(--sub); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .ride { margin-top: 4px; padding-top: 3px; border-top: 1px solid rgba(127,127,127,.15); }
        .rd, .rt { font-size: 9.5px; line-height: 1.3; color: var(--sub); white-space: nowrap; overflow: hidden;
                   text-overflow: ellipsis; }
        .rd { font-variant-numeric: tabular-nums; }
        .rt { opacity: .8; }
        .crown { --mdc-icon-size: 13px; width: 13px; height: 13px; display: inline-flex; color: #ffc107; flex: none; }
        .muted { color: var(--sub); font-size: 12px; margin-top: 6px; }
        .msg { color: var(--sub); font-size: 13px; text-align: center; padding: 24px 12px; }
        .msg.err { color: var(--error-color, #f44336); }
      </style>
      <ha-card>
        <div class="title">${esc(cfg.title)}</div>
        <div class="tabs">${tabs}</div>
        <div class="list">${body}</div>
      </ha-card>`;

    if (!this._bound) {
      this._bound = true;
      this.shadowRoot.addEventListener("click", (ev) => {
        const t = ev.target.closest("button[data-trick]");
        if (!t) return;
        this._trick = t.dataset.trick;
        try { localStorage.setItem(`ebike-tricks:${this._config.title}`, this._trick); } catch (e) { /* ignore */ }
        this._render();
      });
    }
  }
}

registerCard("ebike-tricks-card", EbikeTricksCard, "eBike Tricks",
  "Wheelies, Manuals, Stoppies und Jumps je Bike mit Bestwerten");
