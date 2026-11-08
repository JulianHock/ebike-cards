/* =====================================================================
 * eBike Last Ride Card – die letzte Tour jedes Bikes mit allen Werten
 *   type: custom:ebike-last-ride-card
 *   bikes: [{ name, prefix | bike, color }]   (wie bei der Vergleichskarte)
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
import { esc, cssValue } from "../shared/format.js";
import { parseTime } from "../shared/time.js";
import { RIDE_FIELDS, RIDE_FIELD_LABELS, rideTricks, rideTile, rideCardCss } from "../shared/ride.js";
import { registerCard } from "../shared/register.js";
import { findBikeDevice, deviceSensors, stubBikes } from "../shared/bosch.js";
import { defineEditor, F } from "../shared/editor.js";

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
  // translation_key erst ab ha-bosch-ebike 1.19.65, davor über das Ende der Entitäts-ID
  max_alt:     { tk: "last_ride_max_altitude",    slug: "last_ride_max_altitude", end: true },
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

const ELR_EDITOR = defineEditor("ebike-last-ride-card-editor", {
  defaults: { show_title: true, fields: RIDE_FIELDS },
  sections: [
    { schema: () => [F.title("Letzte Tour")] },
    { title: "Bikes", bikes: {} },
    { title: "Anzeige", schema: ({ config }) => [
      F.startBike(config, "Automatisch (Bike mit der neuesten Tour)"),
      F.bool("show_title", "Tourtitel anzeigen"),
      F.multi("fields", "Detailwerte", RIDE_FIELD_LABELS),
    ] },
    { title: "Erweitert", collapsed: true, schema: () => [F.background] },
  ],
});

class EbikeLastRideCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._sig = "";
    this._refs = [];
    this._map = [];
  }

  static async getStubConfig(hass) { return { title: "Letzte Tour", bikes: await stubBikes(hass) }; }

  static getConfigElement() { return document.createElement(ELR_EDITOR); }

  setConfig(config) {
    if (!Array.isArray(config.bikes) || !config.bikes.length) {
      throw new Error("Bitte unter 'bikes' mindestens ein Bike mit name und prefix (oder bike) angeben");
    }
    this._config = { title: "Letzte Tour", show_title: true, ...config, background: cssValue(config.background) };
    const wanted = Array.isArray(config.fields) ? config.fields : RIDE_FIELDS;
    this._fields = new Set(wanted.filter((f) => RIDE_FIELDS.includes(f)));
    const names = config.bikes.map((b) => b.name || b.bike || b.prefix);
    let saved = null;
    try { saved = localStorage.getItem(`ebike-last-ride:${this._config.title}`); } catch (e) { /* ignore */ }
    this._sel = names.indexOf(saved);
    if (this._sel < 0) this._sel = names.indexOf(config.bike);
    this._map = [];
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
    const h = this._hass;
    if (!this._map.length || this._refs[0] !== h.entities || this._refs[1] !== h.devices) {
      this._refs = [h.entities, h.devices];
      this._map = this._config.bikes.map((b) => this._resolve(b));
    }
    const states = this._hass.states;
    const sig = this._map.map((m) => Object.values(m).map((eid) => states[eid]?.state).join(",")).join("|");
    if (sig !== this._sig) { this._sig = sig; this._render(); }
  }

  /* Findet die "Letzte Fahrt"-Sensoren eines Bikes: zuerst über das Gerät
     (translation_key, unabhängig von Sprache und Umbenennungen),
     sonst über die üblichen deutschen Entitäts-IDs. */
  _resolve(b) {
    const out = {};
    const { ids, byTk } = deviceSensors(this._hass, findBikeDevice(this._hass, b));
    for (const [k, d] of Object.entries(ELR_SENSORS)) {
      // translation_key, sonst (end) Ende der Entitäts-ID am Gerät, sonst prefix + deutsche Endung
      const hit = byTk[d.tk]?.[0]
        || (d.end && ids.find((eid) => eid.endsWith(`_${d.slug}`) || eid.match(new RegExp(`_${d.slug}_\\d+$`))));
      const eid = `sensor.${b.prefix}_${d.slug}`;
      if (hit) out[k] = hit;
      else if (b.prefix && this._hass.states[eid]) out[k] = eid;
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
      tricks: rideTricks(n),
    };
  }

  _render() {
    const cfg = this._config;
    const rows = cfg.bikes.map((b, i) => ({
      name: b.name || b.bike || b.prefix,
      color: cssValue(b.color) || PALETTE[i % PALETTE.length],
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

    const sel = rows[this._sel];
    const tile = rideTile({ color: sel.color, r: sel.r, fields: this._fields, showTitle: cfg.show_title });

    this.shadowRoot.innerHTML = `
      <style>${rideCardCss(cfg.background)}
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
        const b = this._config.bikes[this._sel];
        const name = b?.name || b?.bike || b?.prefix;
        try { localStorage.setItem(`ebike-last-ride:${this._config.title}`, name); } catch (e) { /* ignore */ }
        this._render();
      });
    }
  }
}

registerCard("ebike-last-ride-card", EbikeLastRideCard, "eBike Letzte Tour",
  "Die letzte Tour jedes Bikes mit Strecke, Zeiten, Höhenmetern und mehr");
