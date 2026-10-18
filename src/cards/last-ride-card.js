/* =====================================================================
 * eBike Last Ride Card – die letzte Tour jedes Bikes mit allen Werten
 *   type: custom:ebike-last-ride-card
 *   bikes: [{ name, prefix, color }]   (wie bei der Vergleichskarte)
 *   Oben wählt man das Bike aus; die Auswahl merkt sich die Karte je Browser.
 *   Ohne Auswahl startet sie beim Bike mit der neuesten Tour.
 *   Optional: bike: Trekking  Start-Bike (Name aus 'bikes')
 *             fields: [...]   welche Detailwerte erscheinen, z. B.
 *                             [duration, pauses, avg_speed, max_speed, up, down, max_alt,
 *                              avg_power, max_power, avg_cadence, max_cadence,
 *                              calories, tricks]
 *             show_title: false blendet den Tourtitel aus
 * Liest die "Letzte Fahrt"-Sensoren der Integration und aktualisiert sich
 * dadurch sofort, sobald eine neue Tour ankommt. Angezeigt werden nur Werte,
 * die Bosch direkt in der Tour liefert – keine Schätzungen der Integration
 * (Akkuverbrauch) und keine aus dem GPS-Track abgeleiteten Werte.
 * ===================================================================== */

import { PALETTE } from "../shared/constants.js";
import { fmt, esc } from "../shared/format.js";
import { parseTime, hm, clock, relativeDay } from "../shared/time.js";
import { registerCard } from "../shared/register.js";

const ELR_PLATFORM = "ha_bosch_ebike";
const ELR_SENSORS = {
  start:       { tk: "last_ride_start_time",      slug: "letzte_fahrt_startzeit" },
  end:         { tk: "last_ride_end_time",        slug: "letzte_fahrt_endzeit" },
  date:        { tk: "last_ride_date",            slug: "letzte_fahrt_datum" },
  title:       { tk: "last_ride_title",           slug: "letzte_fahrt_titel" },
  distance:    { tk: "last_ride_distance",        slug: "letzte_fahrt_distanz" },
  ride_time:   { tk: "last_ride_duration",        slug: "letzte_fahrt_dauer" },
  avg_speed:   { tk: "last_ride_avg_speed",       slug: "letzte_fahrt_o_geschwindigkeit" },
  max_speed:   { tk: "last_ride_max_speed",       slug: "letzte_fahrt_max_geschwindigkeit" },
  up:          { tk: "last_ride_elevation_gain",  slug: "letzte_fahrt_hohenmeter" },
  // Ohne translation_key in der Integration – wird über das Ende der Entitäts-ID gefunden
  max_alt:     { tk: null,                        slug: "last_ride_max_altitude" },
  down:        { tk: "last_ride_elevation_loss",  slug: "letzte_fahrt_hohenmeter_2" },
  calories:    { tk: "last_ride_calories",        slug: "letzte_fahrt_kalorien" },
  avg_cadence: { tk: "last_ride_avg_cadence",     slug: "letzte_fahrt_o_trittfrequenz" },
  max_cadence: { tk: "last_ride_max_cadence",     slug: "letzte_fahrt_max_trittfrequenz" },
  avg_power:   { tk: "last_ride_avg_power",       slug: "letzte_fahrt_o_leistung" },
  max_power:   { tk: "last_ride_max_power",       slug: "letzte_fahrt_max_leistung" },
  jumps:       { tk: "last_ride_jumps",           slug: "letzte_fahrt_sprunge" },
  wheelies:    { tk: "last_ride_wheelies",        slug: "letzte_fahrt_wheelies" },
  manuals:     { tk: "last_ride_manuals",         slug: "letzte_fahrt_manuals" },
  stoppies:    { tk: "last_ride_stoppies",        slug: "letzte_fahrt_stoppies" },
};
const ELR_FIELDS = ["duration", "pauses", "avg_speed", "max_speed", "up", "down", "max_alt",
  "avg_power", "max_power", "avg_cadence", "max_cadence", "calories", "tricks"];

class EbikeLastRideCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._sig = "";
    this._entsRef = null;
    this._map = [];
  }

  static getStubConfig() { return { title: "Letzte Tour", bikes: [] }; }

  setConfig(config) {
    if (!Array.isArray(config.bikes) || !config.bikes.length) {
      throw new Error("Bitte unter 'bikes' mindestens ein Bike mit name und prefix angeben");
    }
    this._config = { title: "Letzte Tour", show_title: true, ...config };
    const wanted = Array.isArray(config.fields) ? config.fields : ELR_FIELDS;
    this._fields = new Set(wanted.filter((f) => ELR_FIELDS.includes(f)));
    const names = config.bikes.map((b) => b.name || b.prefix);
    let saved = null;
    try { saved = localStorage.getItem(`ebike-last-ride:${this._config.title}`); } catch (e) { /* ignore */ }
    this._sel = names.indexOf(saved);
    if (this._sel < 0) this._sel = names.indexOf(config.bike);
    this._entsRef = null;
    this._sig = "";
    if (this._hass) this._update();
  }

  set hass(hass) {
    this._hass = hass;
    this._update();
  }

  getCardSize() { return 6; }

  _update() {
    if (!this._config || !this._hass) return;
    const ents = this._hass.entities || null;
    if (ents !== this._entsRef || !this._map.length) {
      this._entsRef = ents;
      this._map = this._config.bikes.map((b) => this._resolve(b.prefix));
    }
    const states = this._hass.states;
    const sig = this._map.map((m) => Object.values(m).map((eid) => states[eid]?.state).join(",")).join("|");
    if (sig !== this._sig) { this._sig = sig; this._render(); }
  }

  /* Findet die "Letzte Fahrt"-Sensoren eines Bikes: zuerst über das Geräte-
     Register (translation_key, unabhängig von Sprache und Umbenennungen),
     sonst über die üblichen deutschen Entitäts-IDs. */
  _resolve(prefix) {
    const out = {};
    if (!prefix) return out;
    const ents = this._hass.entities;
    if (ents) {
      const counts = {};
      for (const [eid, e] of Object.entries(ents)) {
        if (e?.device_id && e.platform === ELR_PLATFORM && eid.startsWith(`sensor.${prefix}_`)) {
          counts[e.device_id] = (counts[e.device_id] || 0) + 1;
        }
      }
      const dev = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
      if (dev) {
        const byTk = {};
        const devIds = [];
        for (const [eid, e] of Object.entries(ents)) {
          if (e?.device_id !== dev || !eid.startsWith("sensor.")) continue;
          devIds.push(eid);
          if (e.translation_key) byTk[e.translation_key] = eid;
        }
        for (const [k, d] of Object.entries(ELR_SENSORS)) {
          if (d.tk && byTk[d.tk]) out[k] = byTk[d.tk];
          else if (!d.tk) {
            const hit = devIds.find((eid) => eid.endsWith(`_${d.slug}`) || eid.match(new RegExp(`_${d.slug}_\\d+$`)));
            if (hit) out[k] = hit;
          }
        }
      }
    }
    for (const [k, d] of Object.entries(ELR_SENSORS)) {
      const eid = `sensor.${prefix}_${d.slug}`;
      if (!out[k] && this._hass.states[eid]) out[k] = eid;
    }
    return out;
  }

  _num(eid) {
    const s = eid && this._hass.states[eid];
    if (!s) return null;
    const v = parseFloat(s.state);
    return Number.isFinite(v) ? v : null;
  }

  _str(eid) {
    const s = eid && this._hass.states[eid];
    if (!s || ["unknown", "unavailable", "none", ""].includes(String(s.state).toLowerCase())) return null;
    return String(s.state);
  }

  _ride(map) {
    const n = (k) => this._num(map[k]);
    const start = parseTime(this._str(map.start)) ?? parseTime(this._str(map.date));
    const end = parseTime(this._str(map.end));
    const hasTime = !!this._str(map.start);
    const total = start && end && end > start ? (end - start) / 60000 : null;
    const ride = n("ride_time");
    return {
      found: Object.keys(map).length > 0,
      start, end, hasTime, total, ride,
      title: this._str(map.title),
      distance: n("distance"), up: n("up"), down: n("down"), max_alt: n("max_alt"),
      avg_speed: n("avg_speed"), max_speed: n("max_speed"),
      calories: n("calories"),
      avg_cadence: n("avg_cadence"), max_cadence: n("max_cadence"),
      avg_power: n("avg_power"), max_power: n("max_power"),
      tricks: [["jumps", "Jump", "Jumps"], ["wheelies", "Wheelie", "Wheelies"],
        ["manuals", "Manual", "Manuals"], ["stoppies", "Stoppie", "Stoppies"]]
        .map(([k, one, many]) => ({ c: n(k), one, many })).filter((t) => t.c > 0),
    };
  }

  _render() {
    const cfg = this._config;
    const F = this._fields;
    const rows = cfg.bikes.map((b, i) => ({
      name: b.name || b.prefix,
      color: b.color || PALETTE[i % PALETTE.length],
      r: this._ride(this._map[i] || {}),
      i,
    }));
    // Ohne gemerkte Auswahl startet die Karte beim Bike mit der neuesten Tour
    if (!(this._sel >= 0 && this._sel < rows.length)) {
      this._sel = rows.reduce((best, x) => ((x.r.start || 0) > (rows[best].r.start || 0) ? x.i : best), 0);
    }
    const tabs = rows.map(({ name, color, i }) => `
      <button class="tab ${i === this._sel ? "on" : ""}" data-bike="${i}" style="--c:${color}">
        <span class="dot"></span><span>${esc(name)}</span>
      </button>`).join("");

    const hero = (v, u, l) => `<div class="hero"><div class="hv">${v}${u ? `<small>${u}</small>` : ""}</div><div class="hl">${l}</div></div>`;
    const chip = (l, v, u = "", wide = false) =>
      `<div class="chip${wide ? " wide" : ""}"><span class="cl">${l}</span><span class="cv">${v}${u ? `<small>${u}</small>` : ""}</span></div>`;

    const tileFor = ({ color, r }) => {
      if (!r.found) {
        return `<div class="tile" style="--c:${color}">
          <div class="muted">Keine Sensoren gefunden – bitte 'prefix' prüfen</div></div>`;
      }
      if (!r.start && r.distance === null) {
        return `<div class="tile" style="--c:${color}"><div class="muted">Noch keine Tour</div></div>`;
      }
      const when = r.start
        ? `${relativeDay(r.start)}${r.hasTime ? ` · ${clock(r.start)}${r.end ? `–${clock(r.end)}` : ""}` : ""}`
        : "";
      const rt = hm(r.ride);
      const heroes = [
        hero(fmt(r.distance, 1), "km", "Strecke"),
        hero(rt ? rt.v : "–", rt ? rt.u : "", "Fahrzeit"),
        hero(fmt(r.up, 0), "m", "Höhenmeter"),
      ];

      const chips = [];
      const tt = hm(r.total);
      if (F.has("duration") && tt) chips.push(chip("Dauer gesamt", tt.v, tt.u));
      const pause = r.total && r.ride ? r.total - r.ride : null;
      const pt = hm(pause);
      if (F.has("pauses") && pt && pause >= 1) chips.push(chip("Pausen", pt.v, pt.u));
      if (F.has("avg_speed") && r.avg_speed !== null) chips.push(chip("Ø Tempo", fmt(r.avg_speed, 1), "km/h"));
      if (F.has("max_speed") && r.max_speed !== null) chips.push(chip("Max. Tempo", fmt(r.max_speed, 1), "km/h"));
      if (F.has("up") && r.up !== null) chips.push(chip("Aufwärts", fmt(r.up, 0), "m"));
      if (F.has("down") && r.down !== null) chips.push(chip("Abwärts", fmt(r.down, 0), "m"));
      if (F.has("max_alt") && r.max_alt !== null) chips.push(chip("Höchster Punkt", fmt(r.max_alt, 0), "m ü. NN"));
      if (F.has("avg_power") && r.avg_power > 0) chips.push(chip("Ø Eigenleistung", fmt(r.avg_power, 0), "W"));
      if (F.has("max_power") && r.max_power > 0) chips.push(chip("Max. Leistung", fmt(r.max_power, 0), "W"));
      if (F.has("avg_cadence") && r.avg_cadence > 0) chips.push(chip("Ø Trittfrequenz", fmt(r.avg_cadence, 0), "U/min"));
      if (F.has("max_cadence") && r.max_cadence > 0) chips.push(chip("Max. Trittfrequenz", fmt(r.max_cadence, 0), "U/min"));
      if (F.has("calories") && r.calories > 0) chips.push(chip("Kalorien", fmt(r.calories, 0), "kcal"));
      if (F.has("tricks") && r.tricks.length) {
        chips.push(chip("Tricks", r.tricks.map((t) => `${fmt(t.c)} ${t.c === 1 ? t.one : t.many}`).join(" · "), "", true));
      }

      return `
        <div class="tile" style="--c:${color}">
          <div class="top">
            <span class="when">${esc(when)}</span>
            ${cfg.show_title && r.title ? `<span class="rtitle">${esc(r.title)}</span>` : ""}
          </div>
          <div class="heroes" style="grid-template-columns:repeat(${heroes.length}, 1fr)">${heroes.join("")}</div>
          ${chips.length ? `<div class="chips">${chips.join("")}</div>` : ""}
        </div>`;
    };
    const tile = tileFor(rows[this._sel]);

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
        .tile { border-radius: 14px; padding: 10px 12px 12px; background: rgba(127,127,127,.07); }
        .top { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
        .dot { width: 9px; height: 9px; border-radius: 3px; flex: none; display: inline-block; background: var(--c); }
        .when { font-size: 13px; font-weight: 600; white-space: nowrap; font-variant-numeric: tabular-nums; flex: none; }
        .rtitle { font-size: 12.5px; color: var(--sub); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
                  min-width: 0; }
        .rtitle::before { content: "·"; margin-right: 8px; }
        .heroes { display: grid; gap: 6px; margin-top: 9px; }
        .hero { min-width: 0; }
        .hv { font-size: 19px; font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap;
              overflow: hidden; text-overflow: ellipsis; line-height: 1.2; }
        .hv small { font-size: 11px; font-weight: 500; color: var(--sub); margin-left: 3px; }
        .hl { font-size: 11px; color: var(--sub); }
        .chips { display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 6px; margin-top: 10px; }
        .chip { background: var(--chip); border-radius: 10px; padding: 5px 8px; min-width: 0;
                display: flex; flex-direction: column; }
        .chip.wide { grid-column: 1 / -1; }
        .cl { font-size: 10.5px; color: var(--sub); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .cv { font-size: 13.5px; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap;
              overflow: hidden; text-overflow: ellipsis; }
        .cv small { font-size: 10.5px; font-weight: 500; color: var(--sub); margin-left: 3px; }
        .muted { color: var(--sub); font-size: 12px; margin-top: 6px; }
      </style>
      <ha-card>
        <div class="title">${esc(cfg.title)}</div>
        <div class="tabs">${tabs}</div>
        ${tile}
      </ha-card>`;

    if (!this._bound) {
      this._bound = true;
      this.shadowRoot.addEventListener("click", (ev) => {
        const t = ev.target.closest("button[data-bike]");
        if (!t) return;
        this._sel = Number(t.dataset.bike);
        const name = this._config.bikes[this._sel]?.name || this._config.bikes[this._sel]?.prefix;
        try { localStorage.setItem(`ebike-last-ride:${this._config.title}`, name); } catch (e) { /* ignore */ }
        this._render();
      });
    }
  }
}

registerCard("ebike-last-ride-card", EbikeLastRideCard, "eBike Letzte Tour",
  "Die letzte Tour jedes Bikes mit Strecke, Zeiten, Höhenmetern und mehr");
