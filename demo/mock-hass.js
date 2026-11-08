// Erfundene Testdaten für die Demo – ersetzt das hass-Objekt von Home Assistant

const BIKES = [
  { id: "bike-0001", label: "E-Bike Trekking", prefix: "e_bike_trekking" },
  { id: "bike-0002", label: "E-Bike MTB", prefix: "drive_unit_performance_line_cx", english: true },
];

// Deterministischer Zufall, damit die Demo bei jedem Laden gleich aussieht
let seed = 42;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function makeActivities() {
  const acts = [];
  const now = Date.now();
  for (let i = 0; i < 260; i++) {
    const bike = BIKES[i % 2];
    const start = now - Math.floor(rnd() * 730) * 86400000 - Math.floor(rnd() * 36000000);
    const km = 5 + rnd() * (bike.id === "bike-0002" ? 35 : 70);
    const secs = (km / (16 + rnd() * 10)) * 3600;
    const trick = bike.id === "bike-0002" && rnd() > 0.4;
    acts.push({
      id: `act-${i}`,
      bikeId: bike.id,
      title: ["Feierabendrunde", "Zur Arbeit", "Waldrunde", "Ausflug"][Math.floor(rnd() * 4)],
      startTime: new Date(start).toISOString(),
      endTime: new Date(start + secs * 1300).toISOString(),
      distance: km * 1000,
      durationWithoutStops: secs,
      elevation: (() => { const gain = km * (bike.id === "bike-0002" ? 25 : 6) * rnd(); return { gain, loss: gain * (0.9 + rnd() * 0.2) }; })(),
      caloriesBurned: km * 20 * rnd(),
      speed: { average: km / (secs / 3600), maximum: 25 + rnd() * 20 },
      trickCheck: trick ? {
        jumps: { amount: Math.floor(rnd() * 6), max_height_m: rnd() * 0.8, max_distance_m: rnd() * 4, max_duration_s: rnd() * 0.9 },
        wheelies: { amount: Math.floor(rnd() * 4), max_duration_s: rnd() * 6, max_distance_m: rnd() * 30, max_angle_deg: rnd() * 40 },
        manuals: { amount: Math.floor(rnd() * 3), max_duration_s: rnd() * 3, max_distance_m: rnd() * 10 },
        stoppies: { amount: Math.floor(rnd() * 2), max_duration_s: rnd() * 1.5, max_distance_m: rnd() * 3 },
      } : null,
    });
  }
  // eine Tour ohne Bike-Zuordnung
  acts.push({ startTime: new Date(now - 5 * 86400000).toISOString(), distance: 12000, durationWithoutStops: 2400 });
  return acts;
}

// [deutsche Endung, englische Endung, translation_key, Wert je Bike]
// Das MTB hat englische Entitäts-IDs: die Karten finden es über Gerätename und translation_key
function sensorList(i) {
  const d = new Date(Date.now() - (i + 1) * 86400000);
  const dd = `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
  return [
    ["kilometerstand", "odometer", "odometer", 2400 + i * 1300],
    ["hohenmeter_gesamt", "total_elevation_gain", "total_elevation_gain", 18000 + i * 21000],
    ["touren_gesamt", "total_rides", "total_rides", 130 - i * 20],
    ["fahrzeit_gesamt", "total_ride_duration", "total_duration", 140 + i * 30],
    ["akku_charge_cycles", "battery_charge_cycles", "battery_charge_cycles", 48.5 + i * 22],
    ["kalorien_gesamt", "total_calories", "total_calories", 52000 + i * 9000],
    ["akku_wh_lifetime", "battery_wh_lifetime", "battery_wh_lifetime", 31000 + i * 26000],
    ["letzte_fahrt_startzeit", "last_ride_start_time", "last_ride_start_time", `${dd} 16:05`],
    ["letzte_fahrt_endzeit", "last_ride_end_time", "last_ride_end_time", `${dd} 17:42`],
    ["letzte_fahrt_titel", "last_ride_title", "last_ride_title", "Feierabendrunde"],
    ["letzte_fahrt_distanz", "last_ride_distance", "last_ride_distance", 28.4 - i * 9],
    ["letzte_fahrt_dauer", "last_ride_duration", "last_ride_duration", 81 - i * 20],
    ["letzte_fahrt_o_geschwindigkeit", "last_ride_avg_speed", "last_ride_avg_speed", 21.0],
    ["letzte_fahrt_max_geschwindigkeit", "last_ride_max_speed", "last_ride_max_speed", 34.2],
    ["letzte_fahrt_hohenmeter", "last_ride_elevation_gain", "last_ride_elevation_gain", 310 + i * 200],
    ["letzte_fahrt_hohenmeter_2", "last_ride_elevation_loss", "last_ride_elevation_loss", 305 + i * 200],
    ["last_ride_max_altitude", "last_ride_max_altitude", "last_ride_max_altitude", 438 + i * 120],
    ["letzte_fahrt_kalorien", "last_ride_calories", "last_ride_calories", 640],
    ["letzte_fahrt_o_trittfrequenz", "last_ride_avg_cadence", "last_ride_avg_cadence", 72],
    ["letzte_fahrt_max_trittfrequenz", "last_ride_max_cadence", "last_ride_max_cadence", 104],
    ["letzte_fahrt_o_leistung", "last_ride_avg_power", "last_ride_avg_power", 138],
    ["letzte_fahrt_max_leistung", "last_ride_max_power", "last_ride_max_power", 512],
    ["letzte_fahrt_sprunge", "last_ride_jumps", "last_ride_jumps", i ? 4 : 0],
    ["letzte_fahrt_wheelies", "last_ride_wheelies", "last_ride_wheelies", i ? 2 : 0],
  ];
}

function makeRegistry() {
  const states = {};
  const entities = {};
  const devices = {};
  BIKES.forEach((b, i) => {
    const device = `device-${i + 1}`;
    devices[device] = { id: device, name: "Performance Line CX", name_by_user: b.label,
      identifiers: [["ha_bosch_ebike", b.id]] };
    for (const [de, en, tk, value] of sensorList(i)) {
      const id = `sensor.${b.prefix}_${b.english ? en : de}`;
      states[id] = { entity_id: id, state: String(value), attributes: {} };
      entities[id] = { entity_id: id, device_id: device, platform: "ha_bosch_ebike", translation_key: tk };
    }
  });
  return { states, entities, devices };
}

const activities = makeActivities();

export const hass = {
  ...makeRegistry(),
  async callWS(msg) {
    if (msg.type === "bosch_ebike/list_instances") {
      return { instances: [{ bikes: BIKES.map(({ id, label }) => ({ id, label })) }] };
    }
    if (msg.type === "bosch_ebike/list_activities") return { activities };
    if (msg.type === "bosch_ebike/get_track") {
      // erfundener Track: 200 Punkte mit Höhe, Trittfrequenz und Leistung, kurz verzögert
      const n = Number(String(msg.activity_id).replace(/\D/g, "")) || 1;
      await new Promise((r) => setTimeout(r, 300));
      const track = Array.from({ length: 200 }, (_, i) => ({
        lat: 50, lon: 9, ele: 250 + 150 * Math.sin((i + n) / 30) + (n % 7) * 10,
        cadence: i % 10 === 0 ? 0 : 60 + ((i * 7 + n) % 40), power: i % 10 === 0 ? 0 : 90 + ((i * 13 + n) % 300),
      }));
      return { track };
    }
    throw new Error(`Unbekannter Websocket-Befehl: ${msg.type}`);
  },
};

export const bikes = [
  { name: "Trekking", prefix: "e_bike_trekking" },
  { name: "MTB", bike: "E-Bike MTB" },
];
