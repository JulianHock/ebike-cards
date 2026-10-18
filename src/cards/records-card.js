/* =====================================================================
 * eBike Records Card – Bestwerte einer einzelnen Tour je Bike
 *   type: custom:ebike-records-card
 *   bikes: [{ name, prefix | bike, color }]   (wie bei den anderen Karten)
 *   Oben wählt man das Bike aus; die Auswahl merkt sich die Karte je Browser.
 *   Optional: bike: Trekking      Start-Bike (Name aus 'bikes')
 *             records: [...]      welche Kategorien erscheinen, Reihenfolge wie angegeben:
 *                                 [distance, up, ride_time, max_speed, avg_speed, calories]
 *             min_avg_km: 5       Mindeststrecke für "Schnellster Schnitt"
 * Liest alle Touren über den Websocket der Integration (bosch_ebike/list_activities).
 * Zu jedem Bestwert stehen Datum und Uhrzeit der Tour.
 * ===================================================================== */

import { PALETTE } from "../shared/constants.js";
import { fmt, esc } from "../shared/format.js";
import { hm, weekdayDateTime } from "../shared/time.js";
import { loadActivities, allBikes, resolveBikeId } from "../shared/bosch.js";
import { registerCard } from "../shared/register.js";

const ERC_RECORDS = {
  distance:      { label: "Längste Strecke",     unit: "km",   digits: 1, get: (a) => (Number(a.distance) || 0) / 1000 },
  up:            { label: "Meiste Höhenmeter",   unit: "m",    digits: 0, get: (a) => Number(a.elevation?.gain) },
  ride_time:     { label: "Längste Fahrzeit",    unit: "",     digits: 0, time: true,
                   get: (a) => Number(a.durationWithoutStops) / 60 },
  max_speed:     { label: "Höchsttempo",         unit: "km/h", digits: 1, get: (a) => Number(a.speed?.maximum) },
  avg_speed:     { label: "Schnellster Schnitt", unit: "km/h", digits: 1, minKm: true, get: (a) => Number(a.speed?.average) },
  calories:      { label: "Meiste Kalorien",     unit: "kcal", digits: 0, get: (a) => Number(a.caloriesBurned) },
};

class EbikeRecordsCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._stats = null;
    this._error = null;
    this._bound = false;
  }

  static getStubConfig() { return { title: "Bestwerte", bikes: [] }; }

  setConfig(config) {
    if (!Array.isArray(config.bikes) || !config.bikes.length) {
      throw new Error("Bitte unter 'bikes' mindestens ein Bike mit name und prefix (oder bike) angeben");
    }
    this._config = { title: "Bestwerte", min_avg_km: 5, refresh_minutes: 15, ...config };
    const wanted = Array.isArray(config.records) ? config.records : Object.keys(ERC_RECORDS);
    this._records = wanted.filter((r) => ERC_RECORDS[r]);
    if (!this._records.length) this._records = Object.keys(ERC_RECORDS);
    const names = config.bikes.map((b) => b.name || b.prefix);
    let saved = null;
    try { saved = localStorage.getItem(`ebike-records:${this._config.title}`); } catch (e) { /* ignore */ }
    this._sel = names.indexOf(saved);
    if (this._sel < 0) this._sel = Math.max(0, names.indexOf(config.bike));
    if (this._raw) this._aggregate(...this._raw);
    this._render();
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) this._load();
  }

  getCardSize() { return 6; }

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
    const minKm = Number(this._config.min_avg_km) || 0;
    this._stats = this._config.bikes.map((cb) => {
      const id = resolveBikeId(cb, bikes);
      const best = {};
      let count = 0;
      if (id) {
        for (const a of activities) {
          if (a.bikeId !== id) continue;
          const ts = Date.parse(a.startTime);
          if (!Number.isFinite(ts)) continue;
          count++;
          const km = (Number(a.distance) || 0) / 1000;
          for (const [k, def] of Object.entries(ERC_RECORDS)) {
            if (def.minKm && km < minKm) continue;
            const v = def.get(a);
            if (!Number.isFinite(v) || v <= 0) continue;
            if (!best[k] || v > best[k].v) best[k] = { v, ts };
          }
        }
      }
      return { id, best, count };
    });
  }

  _render() {
    if (!this._config) return;
    const cfg = this._config;
    const tabs = cfg.bikes.map((b, i) => `
      <button class="tab ${i === this._sel ? "on" : ""}" data-bike="${i}"
        style="--c:${b.color || PALETTE[i % PALETTE.length]}">
        <span class="dot"></span><span>${esc(b.name || b.prefix)}</span>
      </button>`).join("");

    let body;
    if (this._error) {
      body = `<div class="msg err">Fehler beim Laden: ${esc(this._error)}</div>`;
    } else if (!this._stats) {
      body = `<div class="msg">Lade Touren …</div>`;
    } else {
      const s = this._stats[this._sel];
      if (!s.id) {
        body = `<div class="msg">Bike nicht gefunden – bitte 'prefix' oder 'bike' prüfen</div>`;
      } else if (!s.count) {
        body = `<div class="msg">Noch keine Touren</div>`;
      } else {
        const tiles = this._records.filter((k) => s.best[k]).map((k) => {
          const def = ERC_RECORDS[k];
          const b = s.best[k];
          let val = fmt(b.v, def.digits), unit = def.unit;
          if (def.time) { const t = hm(b.v); val = t ? t.v : "–"; unit = t ? t.u : ""; }
          return `
            <div class="rec">
              <div class="rl">${def.label}</div>
              <div class="rv">${val}${unit ? `<small>${unit}</small>` : ""}</div>
              <div class="rw">${weekdayDateTime(b.ts)}</div>
            </div>`;
        }).join("");
        body = `<div class="grid">${tiles}</div>`;
      }
    }

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-card { ${cfg.background ? `background:${cfg.background};` : ""} border-radius: 16px;
          padding: 14px 14px 14px; color: var(--primary-text-color);
          --sub: var(--secondary-text-color, #9e9e9e); --chip: rgba(127,127,127,.12); }
        button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; padding: 0; }
        .title { font-size: 17px; font-weight: 600; }
        .tabs { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0 12px; }
        .tab { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; flex: none;
               font-size: 12.5px; padding: 6px 10px; border-radius: 999px; background: var(--chip); color: var(--sub); }
        .tab.on { background: color-mix(in srgb, var(--c) 22%, transparent); color: var(--primary-text-color);
                  font-weight: 600; box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--c) 60%, transparent); }
        .dot { width: 9px; height: 9px; border-radius: 3px; flex: none; display: inline-block; background: var(--c); }
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
        .rec { background: var(--chip); border-radius: 12px; padding: 8px 10px 9px; min-width: 0; }
        .rl { font-size: 11px; color: var(--sub); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .rv { font-size: 19px; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap;
              line-height: 1.25; margin-top: 1px; }
        .rv small { font-size: 11px; font-weight: 500; color: var(--sub); margin-left: 3px; }
        .rw { font-size: 11.5px; font-variant-numeric: tabular-nums; margin-top: 3px; white-space: nowrap;
              overflow: hidden; text-overflow: ellipsis; }
        .msg { color: var(--sub); font-size: 13px; text-align: center; padding: 20px 12px; }
        .msg.err { color: var(--error-color, #f44336); }
      </style>
      <ha-card>
        <div class="title">${esc(cfg.title)}</div>
        <div class="tabs">${tabs}</div>
        ${body}
      </ha-card>`;

    if (!this._bound) {
      this._bound = true;
      this.shadowRoot.addEventListener("click", (ev) => {
        const t = ev.target.closest("button[data-bike]");
        if (!t) return;
        this._sel = Number(t.dataset.bike);
        const b = this._config.bikes[this._sel];
        try { localStorage.setItem(`ebike-records:${this._config.title}`, b?.name || b?.prefix); } catch (e) { /* ignore */ }
        this._render();
      });
    }
  }
}

registerCard("ebike-records-card", EbikeRecordsCard, "eBike Bestwerte",
  "Die besten Einzelwerte einer Tour je Bike – mit Datum und Uhrzeit");
