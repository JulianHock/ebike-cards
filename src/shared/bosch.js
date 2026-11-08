// Zugriff auf die ha-bosch-ebike Integration

import { slug } from "./format.js";

const PLATFORM = "ha_bosch_ebike";

// Alle Instanzen und Touren über den Websocket der Integration
export async function loadActivities(hass) {
  const [inst, acts] = await Promise.all([
    hass.callWS({ type: "bosch_ebike/list_instances" }),
    hass.callWS({ type: "bosch_ebike/list_activities" }),
  ]);
  return [inst?.instances || [], acts?.activities || []];
}

export function allBikes(instances) {
  const bikes = [];
  for (const inst of instances) for (const b of inst.bikes || []) bikes.push(b);
  return bikes;
}

const norm = (s) => String(s ?? "").trim().toLowerCase();
const bikeKeys = (cfgBike) => [cfgBike.bike, cfgBike.id].filter(Boolean).map(norm);
const boschIds = (device) => (device?.identifiers || []).filter(([d]) => d === PLATFORM).map(([, id]) => String(id));

// Geräte-ID (Geräte-Register) zu einem Eintrag aus 'bikes' der Kartenkonfiguration:
// über bike/id (Gerätename oder Bike-ID, nur bei eindeutigem Treffer), sonst über den Entitäts-Präfix
export function findBikeDevice(hass, cfgBike) {
  const keys = bikeKeys(cfgBike);
  if (keys.length) {
    const hits = Object.values(hass?.devices || {}).filter((d) => {
      const ids = boschIds(d);
      return ids.length && (ids.some((id) => keys.includes(norm(id))) || keys.includes(norm(d.name_by_user || d.name)));
    });
    if (hits.length === 1) return hits[0].id;
  }
  if (!cfgBike.prefix) return null;
  const counts = {};
  for (const [eid, e] of Object.entries(hass?.entities || {})) {
    if (e?.device_id && e.platform === PLATFORM && eid.startsWith(`sensor.${cfgBike.prefix}_`)) {
      counts[e.device_id] = (counts[e.device_id] || 0) + 1;
    }
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

// Sensoren eines Geräts: alle Entitäts-IDs und die Zuordnung translation_key → Entitäts-IDs
// (eine Liste, weil z. B. bei zwei Akkus beide Sensoren denselben translation_key tragen)
export function deviceSensors(hass, deviceId) {
  const ids = [];
  const byTk = {};
  if (!deviceId) return { ids, byTk };
  for (const [eid, e] of Object.entries(hass?.entities || {})) {
    if (e?.device_id !== deviceId || !eid.startsWith("sensor.")) continue;
    ids.push(eid);
    if (e.translation_key) (byTk[e.translation_key] ||= []).push(eid);
  }
  return { ids, byTk };
}

// Bikes der Integration für Editor und Kartenauswahl: id, label (aus der Integration) und
// name (Gerätename, wie er in HA angezeigt wird). Ohne Websocket über das Geräte-Register.
export async function integrationBikes(hass) {
  let list = [];
  try {
    list = allBikes((await hass.callWS({ type: "bosch_ebike/list_instances" }))?.instances || []);
  } catch (e) { /* Integration fehlt oder antwortet nicht */ }
  const devices = Object.values(hass?.devices || {}).filter((d) => boschIds(d).length);
  if (!list.length) list = devices.map((d) => ({ id: boschIds(d)[0], label: d.name_by_user || d.name }));
  const seen = new Set();
  return list.filter((b) => b?.id && !seen.has(String(b.id)) && seen.add(String(b.id))).map((b) => {
    const id = String(b.id);
    const dev = devices.find((d) => boschIds(d).includes(id));
    const label = b.label || id;
    return { id, label, name: dev?.name_by_user || dev?.name || label };
  });
}

// Bike-Liste für eine neu eingefügte Karte: alle Bikes der Integration
export async function stubBikes(hass, extra = {}) {
  return (await integrationBikes(hass)).map((b) => ({ name: b.name, bike: b.id, ...extra }));
}

// Eintrag aus 'bikes' passt zu einem Bike der Integration (über bike/id oder den Namen)
export function matchesBike(cfgBike, b) {
  const keys = bikeKeys(cfgBike || {});
  return keys.includes(norm(b.id)) || keys.includes(norm(b.label)) || keys.includes(norm(b.name));
}

// Bike-ID zu einem Eintrag aus 'bikes' der Kartenkonfiguration:
// über bike/id (Gerätename oder Bike-ID), sonst über den Entitäts-Präfix
export function resolveBikeId(cfgBike, bikes, hass) {
  const keys = bikeKeys(cfgBike);
  let hit = bikes.find((b) => keys.includes(norm(b.id)) || keys.includes(norm(b.label)));
  if (!hit && cfgBike.prefix) {
    const ids = boschIds(hass?.devices?.[findBikeDevice(hass, { prefix: cfgBike.prefix })]);
    const p = slug(cfgBike.prefix);
    hit = bikes.find((b) => ids.includes(String(b.id))) || bikes.find((b) => slug(b.label) === p);
  }
  return hit ? hit.id : null;
}
