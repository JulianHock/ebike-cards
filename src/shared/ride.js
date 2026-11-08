// Darstellung einer einzelnen Tour – gemeinsam für "Letzte Tour" und "Tourauswahl"

import { MONTHS_LONG } from "./constants.js";
import { fmt, esc } from "./format.js";
import { hm, clock, weekdayDate } from "./time.js";

export const RIDE_FIELDS = ["duration", "pauses", "avg_speed", "max_speed", "up", "down", "max_alt",
  "avg_power", "max_power", "avg_cadence", "max_cadence", "calories", "tricks"];

// Bezeichnungen der Detailwerte für den UI-Editor (wie in der Kachel)
export const RIDE_FIELD_LABELS = {
  duration: "Dauer gesamt", pauses: "Pausen", avg_speed: "Ø Tempo", max_speed: "Max. Tempo",
  up: "Aufwärts", down: "Abwärts", max_alt: "Höchster Punkt", avg_power: "Ø Eigenleistung",
  max_power: "Max. Leistung", avg_cadence: "Ø Trittfrequenz", max_cadence: "Max. Trittfrequenz",
  calories: "Kalorien", tricks: "Tricks",
};

const TRICK_NAMES =[["jumps", "Jump", "Jumps"], ["wheelies", "Wheelie", "Wheelies"],
  ["manuals", "Manual", "Manuals"], ["stoppies", "Stoppie", "Stoppies"]];

// Tricks einer Tour: get(key) liefert die Anzahl je Trickart
export function rideTricks(get) {
  return TRICK_NAMES.map(([k, one, many]) => ({ c: get(k), one, many })).filter((t) => t.c > 0);
}

const num = (v) => {
  const n = Number(v);
  return v !== null && v !== undefined && v !== "" && Number.isFinite(n) ? n : null;
};

// Tour aus dem Websocket (bosch_ebike/list_activities) im Format, das rideTile erwartet.
// Trittfrequenz, Leistung und höchster Punkt fehlen dort, sie kommen aus trackStats.
export function activityToRide(a) {
  const start = Date.parse(a?.startTime);
  const end = Date.parse(a?.endTime);
  const s = Number.isFinite(start) ? start : null;
  const e = Number.isFinite(end) ? end : null;
  const dist = num(a?.distance);
  const secs = num(a?.durationWithoutStops);
  const tc = a?.trickCheck && typeof a.trickCheck === "object" ? a.trickCheck : {};
  return {
    found: true,
    start: s, end: e, hasTime: s !== null,
    total: s && e && e > s ? (e - s) / 60000 : null,
    ride: secs > 0 ? secs / 60 : null,
    title: typeof a?.title === "string" && a.title.trim() ? a.title.trim() : null,
    distance: dist === null ? null : dist / 1000,
    up: num(a?.elevation?.gain), down: num(a?.elevation?.loss), max_alt: null,
    avg_speed: num(a?.speed?.average), max_speed: num(a?.speed?.maximum),
    calories: num(a?.caloriesBurned),
    avg_cadence: null, max_cadence: null, avg_power: null, max_power: null,
    tricks: rideTricks((k) => num(tc[k]?.amount)),
  };
}

// Werte aus den Trackpunkten einer Tour (bosch_ebike/get_track: ele, cadence, power):
// höchster Punkt wie beim Sensor der Integration, Ø-Werte nur über Punkte mit Treten (> 0)
export function trackStats(points) {
  const vals = (k) => (Array.isArray(points) ? points : [])
    .map((p) => p?.[k]).filter((v) => typeof v === "number" && Number.isFinite(v));
  // reduce statt Math.max(...a): lange Tracks hätten zu viele Argumente
  const max = (a) => (a.length ? a.reduce((x, y) => (y > x ? y : x)) : null);
  const avg = (a) => { const pos = a.filter((v) => v > 0); return pos.length ? pos.reduce((x, y) => x + y, 0) / pos.length : null; };
  const cad = vals("cadence"), pow = vals("power");
  return {
    max_alt: max(vals("ele")),
    avg_cadence: avg(cad), max_cadence: max(cad),
    avg_power: avg(pow), max_power: max(pow),
  };
}

export const TRACK_FIELDS = ["max_alt", "avg_power", "max_power", "avg_cadence", "max_cadence"];

// Touren (mit start) nach Monat gruppiert, neueste zuerst
export function groupByMonth(rides) {
  const groups = [];
  for (const r of [...rides].sort((x, y) => y.start - x.start)) {
    const d = new Date(r.start);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) {
      g = { key, year: d.getFullYear(), month: MONTHS_LONG[d.getMonth()],
        label: `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`, rides: [], km: 0 };
      groups.push(g);
    }
    g.rides.push(r);
    g.km += r.distance || 0;
  }
  return groups;
}

const hero = (v, u, l) => `<div class="hero"><div class="hv">${v}${u ? `<small>${u}</small>` : ""}</div><div class="hl">${l}</div></div>`;
const chip = (l, v, u = "", wide = false) =>
  `<div class="chip${wide ? " wide" : ""}"><span class="cl">${l}</span><span class="cv">${v}${u ? `<small>${u}</small>` : ""}</span></div>`;

// Kachel einer Tour: Zeitpunkt und Titel (ohne showHeader nicht), drei große Werte,
// darunter die Detailwerte (fields)
export function rideTile({ color, r, fields, showTitle, showHeader = true }) {
  const F = fields;
  if (!r.found) {
    return `<div class="tile" style="--c:${color}">
      <div class="muted">Keine Sensoren gefunden – bitte 'prefix' oder 'bike' prüfen</div></div>`;
  }
  if (!r.start && r.distance === null) {
    return `<div class="tile" style="--c:${color}"><div class="muted">Noch keine Tour</div></div>`;
  }
  const when = r.start
    ? `${weekdayDate(r.start)}${r.hasTime ? ` · ${clock(r.start)}${r.end ? `–${clock(r.end)}` : ""}` : ""}`
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
  // r.pending: Trackwerte werden noch geladen, ihre Felder zeigen bis dahin "…"
  const wait = (k) => r.pending && F.has(k);
  if (wait("max_alt")) chips.push(chip("Höchster Punkt", "…"));
  else if (F.has("max_alt") && r.max_alt !== null) chips.push(chip("Höchster Punkt", fmt(r.max_alt, 0), "m ü. NN"));
  if (wait("avg_power")) chips.push(chip("Ø Eigenleistung", "…"));
  else if (F.has("avg_power") && r.avg_power > 0) chips.push(chip("Ø Eigenleistung", fmt(r.avg_power, 0), "W"));
  if (wait("max_power")) chips.push(chip("Max. Leistung", "…"));
  else if (F.has("max_power") && r.max_power > 0) chips.push(chip("Max. Leistung", fmt(r.max_power, 0), "W"));
  if (wait("avg_cadence")) chips.push(chip("Ø Trittfrequenz", "…"));
  else if (F.has("avg_cadence") && r.avg_cadence > 0) chips.push(chip("Ø Trittfrequenz", fmt(r.avg_cadence, 0), "U/min"));
  if (wait("max_cadence")) chips.push(chip("Max. Trittfrequenz", "…"));
  else if (F.has("max_cadence") && r.max_cadence > 0) chips.push(chip("Max. Trittfrequenz", fmt(r.max_cadence, 0), "U/min"));
  if (F.has("calories") && r.calories > 0) chips.push(chip("Kalorien", fmt(r.calories, 0), "kcal"));
  if (F.has("tricks") && r.tricks.length) {
    chips.push(chip("Tricks", r.tricks.map((t) => `${fmt(t.c)} ${t.c === 1 ? t.one : t.many}`).join(" · "), "", true));
  }

  return `
    <div class="tile" style="--c:${color}">
      ${showHeader ? `<div class="top">
        <span class="when">${esc(when)}</span>
        ${showTitle && r.title ? `<span class="rtitle">${esc(r.title)}</span>` : ""}
      </div>` : ""}
      <div class="heroes" style="grid-template-columns:repeat(${heroes.length}, 1fr)">${heroes.join("")}</div>
      ${chips.length ? `<div class="chips">${chips.join("")}</div>` : ""}
    </div>`;
}

// Styles der Karte mit Bike-Reitern und Tourkachel
export function rideCardCss(background) {
  return `
    :host { display: block; }
    ha-card { ${background ? `background:${background};` : ""} border-radius: 16px;
      padding: 14px 14px 14px; color: var(--primary-text-color);
      --sub: var(--secondary-text-color, #9e9e9e); --chip: rgba(127,127,127,.12); }
    button { font: inherit; color: inherit; background: none; border: 0; cursor: pointer; padding: 0; }
    .title { font-size: 17px; font-weight: 600; }
    .tabs { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0 12px; }
    .tab { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; flex: none;
           font-size: 12.5px; padding: 6px 10px; border-radius: 999px; background: var(--chip); color: var(--sub); }
    .tab.on { background: color-mix(in srgb, var(--c) 22%, transparent); color: var(--primary-text-color);
              font-weight: 600; box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--c) 60%, transparent); }
    .top { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
    .dot { width: 9px; height: 9px; border-radius: 3px; flex: none; display: inline-block; background: var(--c); }
    .when { font-size: 13px; font-weight: 600; white-space: nowrap; font-variant-numeric: tabular-nums; flex: none; }
    .rtitle { font-size: 12.5px; color: var(--sub); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
              min-width: 0; }
    .rtitle::before { content: "·"; margin-right: 8px; }
    .heroes { display: grid; gap: 6px; margin-top: 9px; padding: 0 5px; }
    .hero { min-width: 0; }
    .hero:nth-child(2) { text-align: center; }
    .hero:last-child { text-align: right; }
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
    .muted { color: var(--sub); font-size: 12px; margin-top: 6px; }`;
}
