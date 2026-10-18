// Datum, Uhrzeit und Dauer

import { DAY, WEEKDAYS } from "./constants.js";

export function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / DAY + 1) / 7);
}

// "18.10.2026 14:05" (Format der Integrations-Sensoren) oder ISO-Zeitstempel
export function parseTime(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).getTime();
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

// Minuten → { v: "1:05", u: "h" } bzw. { v: "45", u: "min" }
export function hm(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  const total = Math.round(minutes);
  if (total < 60) return { v: String(total), u: "min" };
  return { v: `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`, u: "h" };
}

export function clock(ts) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function shortDate(ts) {
  if (!Number.isFinite(ts)) return "";
  const d = new Date(ts);
  return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
}

// "Heute", "Gestern", "Mi, 14.10." oder "3.9.2026"
export function relativeDay(ts) {
  const d = new Date(ts);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  const diff = Math.round((today - day) / DAY);
  if (diff === 0) return "Heute";
  if (diff === 1) return "Gestern";
  if (diff > 1 && diff < 7) return `${WEEKDAYS[d.getDay()]}, ${d.getDate()}.${d.getMonth() + 1}.`;
  return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
}

// "Mi, 14.10.2026 · 16:30"
export function weekdayDateTime(ts) {
  const d = new Date(ts);
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()} · ${clock(ts)}`;
}
