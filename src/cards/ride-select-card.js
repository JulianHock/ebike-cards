/* =====================================================================
 * eBike Ride Select Card – eine beliebige Tour je Bike auswählen und anzeigen
 *   type: custom:ebike-ride-select-card
 *   bikes: [{ name, prefix | bike, color }]   (wie bei den anderen Karten)
 *   Oben wählt man das Bike aus, darunter links das Jahr und daneben (zwischen den Pfeilen) die Tour aus einer
 *   Liste, die nach Monaten gegliedert ist (neueste zuerst). Die Pfeile blättern
 *   eine Tour weiter, auch über den Jahreswechsel (das Jahr wechselt dann mit). Die Bike-Auswahl merkt sich die Karte je Browser, die Tour nicht:
 *   nach dem Laden steht sie auf der neuesten Tour.
 *   Optional: bike: Trekking  Start-Bike (Name aus 'bikes'); sonst das mit der neuesten Tour
 *             fields: [...]   welche Detailwerte erscheinen (wie bei "Letzte Tour"):
 *                             [duration, pauses, avg_speed, max_speed, up, down, max_alt,
 *                              avg_power, max_power, avg_cadence, max_cadence, calories, tricks]
 * Liest alle Touren über den Websocket der Integration (bosch_ebike/list_activities).
 * Höchster Punkt, Leistung und Trittfrequenz fehlen dort; die Karte holt sie für die
 * gewählte Tour aus deren Trackpunkten (bosch_ebike/get_track, Bosch-Cloud).
 * Die Kachel ist wie bei der Karte "Letzte Tour" aufgebaut, nur ohne die Zeile mit Datum
 * und Titel, weil beides schon in der Auswahlliste steht.
 * ===================================================================== */

import { PALETTE, WEEKDAYS } from "../shared/constants.js";
import { fmt, esc, cssValue } from "../shared/format.js";
import { loadActivities, allBikes, resolveBikeId } from "../shared/bosch.js";
import { RIDE_FIELDS, TRACK_FIELDS, activityToRide, trackStats, groupByMonth, rideTile, rideCardCss }
  from "../shared/ride.js";
import { registerCard } from "../shared/register.js";

const CHEVRON = (d) => `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="${d}"/></svg>`;
const LEFT = CHEVRON("M15.41 16.58 10.83 12l4.58-4.59L14 6l-6 6 6 6z");
const RIGHT = CHEVRON("M8.59 16.58 13.17 12 8.59 7.41 10 6l6 6-6 6z");
const DOWN = CHEVRON("M7.41 8.58 12 13.17l4.59-4.59L18 10l-6 6-6-6z");

// "Sa 07.11. · Feierabendrunde" (ohne Uhrzeit und Distanz, damit die Liste kurz bleibt)
function optionLabel(r) {
  const d = new Date(r.start);
  const pad = (n) => String(n).padStart(2, "0");
  const parts = [`${WEEKDAYS[d.getDay()]} ${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`];
  if (r.title) parts.push(r.title);
  return parts.join(" · ");
}

class EbikeRideSelectCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._stats = null;
    this._error = null;
    this._bound = false;
    this._pick = {};
    this._sig = "";
    this._tracks = new Map();   // Tour-Key:Distanz → Trackwerte | "loading" | "error"
  }

  static getStubConfig() { return { title: "Tourauswahl", bikes: [] }; }

  setConfig(config) {
    if (!Array.isArray(config.bikes) || !config.bikes.length) {
      throw new Error("Bitte unter 'bikes' mindestens ein Bike mit name und prefix (oder bike) angeben");
    }
    this._config = { title: "Tourauswahl", refresh_minutes: 15, ...config,
      background: cssValue(config.background) };
    const wanted = Array.isArray(config.fields) ? config.fields : RIDE_FIELDS;
    this._fields = new Set(wanted.filter((f) => RIDE_FIELDS.includes(f)));
    const names = config.bikes.map((b) => b.name || b.bike || b.prefix);
    let saved = null;
    try { saved = localStorage.getItem(`ebike-ride-select:${this._config.title}`); } catch (e) { /* ignore */ }
    this._sel = names.indexOf(saved);
    if (this._sel < 0) this._sel = names.indexOf(config.bike);
    this._pick = {};
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
  }

  disconnectedCallback() { clearInterval(this._timer); }

  async _load() {
    try {
      this._raw = await loadActivities(this._hass);
      this._error = null;
      // Beim regelmäßigen Nachladen nur neu zeichnen, wenn sich die Touren geändert haben,
      // damit eine geöffnete Auswahlliste nicht zugeht
      const acts = this._raw[1];
      const sig = `${acts.length}|${acts.map((a) => `${a.id}:${a.bikeId}:${a.distance}`).join(",")}`;
      if (sig === this._sig && this._stats) return;
      this._sig = sig;
      this._aggregate(...this._raw);
    } catch (e) {
      this._error = e?.message || String(e);
    }
    this._render();
  }

  _aggregate(instances, activities) {
    const bikes = allBikes(instances);
    this._stats = this._config.bikes.map((cb) => {
      const id = resolveBikeId(cb, bikes, this._hass);
      const rides = [];
      if (id) {
        for (const a of activities) {
          if (a.bikeId !== id) continue;
          const r = activityToRide(a);
          if (r.start === null) continue;
          rides.push({ ...r, key: String(a.id || a.startTime), id: a.id, account: a.accountId });
        }
      }
      rides.sort((x, y) => y.start - x.start);
      return { id, rides };
    });
    // Ohne gemerkte Auswahl startet die Karte beim Bike mit der neuesten Tour
    if (!(this._sel >= 0 && this._sel < this._stats.length)) {
      this._sel = this._stats.reduce((best, s, i) =>
        ((s.rides[0]?.start || 0) > (this._stats[best].rides[0]?.start || 0) ? i : best), 0);
    }
  }

  // Index der gewählten Tour (0 = neueste); eine nicht mehr vorhandene Tour fällt auf die neueste zurück
  _rideIndex(s) {
    const i = s.rides.findIndex((r) => r.key === this._pick[this._sel]);
    return i < 0 ? 0 : i;
  }

  // Trackwerte der Tour; null solange sie geladen werden (startet das Laden einmal je Tour)
  _track(r) {
    if (!r.id || ![...this._fields].some((f) => TRACK_FIELDS.includes(f))) return {};
    // Distanz im Schlüssel: lädt Bosch den Track einer Tour noch nach, ändert sie sich
    const key = `${r.key}:${r.distance}`;
    const t = this._tracks.get(key);
    if (t === "error") return {};
    if (t) return t === "loading" ? null : t;
    this._tracks.set(key, "loading");
    const msg = { type: "bosch_ebike/get_track", activity_id: String(r.id) };
    // Bei mehreren Bosch-Konten sucht die Integration ohne Konto im falschen
    if (r.account) msg.config_entry_id = r.account;
    this._hass.callWS(msg)
      .then((res) => this._tracks.set(key, trackStats(res?.track)))
      .catch(() => this._tracks.set(key, "error"))
      .then(() => {
        // nur neu zeichnen, wenn die Tour noch angezeigt wird
        const s = this._stats?.[this._sel];
        if (s?.rides[this._rideIndex(s)]?.key === r.key) this._render();
      });
    return null;
  }

  _render() {
    if (!this._config) return;
    const cfg = this._config;
    const sel = Math.max(0, this._sel);
    const colorOf = (i) => cssValue(cfg.bikes[i].color) || PALETTE[i % PALETTE.length];
    const tabs = cfg.bikes.map((b, i) => `
      <button class="tab ${this._stats && i === sel ? "on" : ""}" data-bike="${i}" style="--c:${colorOf(i)}">
        <span class="dot"></span><span>${esc(b.name || b.bike || b.prefix)}</span>
      </button>`).join("");

    let body;
    if (this._error) {
      body = `<div class="msg err">Fehler beim Laden: ${esc(this._error)}</div>`;
    } else if (!this._stats) {
      body = `<div class="msg">Lade Touren …</div>`;
    } else {
      const s = this._stats[sel];
      if (!s.id) {
        body = `<div class="msg">Bike nicht gefunden – bitte 'prefix' oder 'bike' prüfen</div>`;
      } else if (!s.rides.length) {
        body = `<div class="msg">Noch keine Touren</div>`;
      } else {
        const idx = this._rideIndex(s);
        const base = s.rides[idx];
        const t = this._track(base);
        const r = t ? { ...base, ...t } : { ...base, pending: true };
        // Jahre mit Touren (neueste zuerst); das gewählte Jahr ist das der gewählten Tour
        const year = new Date(base.start).getFullYear();
        const all = groupByMonth(s.rides);
        const years = [...new Set(all.map((g) => g.year))];
        const yearOpts = years.map((y) => {
          const n = all.filter((g) => g.year === y).reduce((x, g) => x + g.rides.length, 0);
          return `<option value="${y}"${y === year ? " selected" : ""}
            title="${n} ${n === 1 ? "Tour" : "Touren"}">${y}</option>`;
        }).join("");
        const groups = all.filter((g) => g.year === year).map((g) => {
          const label = `${g.month} · ${g.rides.length} ${g.rides.length === 1 ? "Tour" : "Touren"} · ${fmt(g.km, 0)} km`;
          const opts = g.rides.map((x) =>
            `<option value="${esc(x.key)}"${x === base ? " selected" : ""}>${esc(optionLabel(x))}</option>`).join("");
          return `<optgroup label="${esc(label)}">${opts}</optgroup>`;
        }).join("");
        body = `
          <div class="pick" style="--c:${colorOf(sel)}">
            <div class="sel yr">
              <select class="year" aria-label="Jahr auswählen">${yearOpts}</select>
              <span class="caret">${DOWN}</span>
            </div>
            <button class="nav" data-step="1" title="Ältere Tour" aria-label="Ältere Tour"
              ${idx >= s.rides.length - 1 ? "disabled" : ""}>${LEFT}</button>
            <div class="sel">
              <select class="ride" aria-label="Tour auswählen">${groups}</select>
              <span class="caret">${DOWN}</span>
            </div>
            <button class="nav" data-step="-1" title="Neuere Tour" aria-label="Neuere Tour"
              ${idx <= 0 ? "disabled" : ""}>${RIGHT}</button>
          </div>
          ${rideTile({ color: colorOf(sel), r, fields: this._fields, showHeader: false })}`;
      }
    }

    this.shadowRoot.innerHTML = `
      <style>${rideCardCss(cfg.background)}
        .sel.yr { flex: none; }
        select.year { flex: none; font-weight: 600; }
        .pick { display: flex; gap: 6px; margin: 0 0 6px; }
        .sel { position: relative; flex: 1; min-width: 0; display: flex; }
        select { flex: 1; min-width: 0; font: inherit; font-size: 13px; font-variant-numeric: tabular-nums;
                 color: var(--primary-text-color); background: var(--chip); border: 0; border-radius: 10px;
                 padding: 7px 30px 7px 10px; margin: 0; appearance: none; -webkit-appearance: none;
                 cursor: pointer; text-overflow: ellipsis; white-space: nowrap; overflow: hidden; }
        select:focus-visible, .nav:focus-visible { outline: 2px solid var(--c); outline-offset: 1px; }
        optgroup, option { background: var(--card-background-color, #1c1c1c); color: var(--primary-text-color); }
        optgroup { font-weight: 600; }
        option { font-weight: 400; }
        .caret { position: absolute; right: 7px; top: 50%; transform: translateY(-50%); display: flex;
                 color: var(--sub); pointer-events: none; }
        .nav { flex: none; width: 34px; display: grid; place-items: center; border-radius: 10px;
               background: var(--chip); color: var(--primary-text-color); }
        .nav:disabled { opacity: .35; cursor: default; }
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
        const tab = ev.target.closest("button[data-bike]");
        if (tab) {
          this._sel = Number(tab.dataset.bike);
          const b = this._config.bikes[this._sel];
          try { localStorage.setItem(`ebike-ride-select:${this._config.title}`, b?.name || b?.bike || b?.prefix); } catch (e) { /* ignore */ }
          this._render();
          return;
        }
        const s = this._stats?.[this._sel];
        const nav = ev.target.closest("button[data-step]");
        if (!nav || nav.disabled || !s?.rides.length) return;
        const i = Math.min(s.rides.length - 1, Math.max(0, this._rideIndex(s) + Number(nav.dataset.step)));
        this._pick[this._sel] = s.rides[i].key;
        this._render();
        this.shadowRoot.querySelector(`button[data-step="${nav.dataset.step}"]:not([disabled])`)?.focus();
      });
      this.shadowRoot.addEventListener("change", (ev) => {
        if (ev.target.tagName !== "SELECT") return;
        const s = this._stats?.[this._sel];
        if (!s) return;
        if (ev.target.classList.contains("year")) {
          // Jahr gewählt: neueste Tour dieses Jahres
          const hit = s.rides.find((r) => new Date(r.start).getFullYear() === Number(ev.target.value));
          if (hit) this._pick[this._sel] = hit.key;
        } else {
          this._pick[this._sel] = ev.target.value;
        }
        this._render();
      });
    }
  }
}

registerCard("ebike-ride-select-card", EbikeRideSelectCard, "eBike Tourauswahl",
  "Eine beliebige Tour je Bike auswählen – nach Jahr und Monat gegliedert, Aufbau wie \"Letzte Tour\"");
