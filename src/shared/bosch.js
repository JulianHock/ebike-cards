// Zugriff auf die ha-bosch-ebike Integration

import { slug } from "./format.js";

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

// Bike-ID zu einem Eintrag aus 'bikes' der Kartenkonfiguration:
// über bike/id (Gerätename oder Bike-ID), sonst über den Entitäts-Präfix
export function resolveBikeId(cfgBike, bikes) {
  const keys = [cfgBike.bike, cfgBike.id].filter(Boolean).map((k) => String(k).trim().toLowerCase());
  let hit = bikes.find((b) => keys.includes(String(b.id).toLowerCase())
    || keys.includes(String(b.label || "").trim().toLowerCase()));
  if (!hit && cfgBike.prefix) {
    const p = slug(cfgBike.prefix);
    hit = bikes.find((b) => slug(b.label) === p);
  }
  return hit ? hit.id : null;
}
