// Erfundene Testdaten für die Demo – ersetzt das hass-Objekt von Home Assistant

const BIKES = [
  { id: "bike-0001", label: "E-Bike Trekking", prefix: "e_bike_trekking" },
  { id: "bike-0002", label: "E-Bike MTB", prefix: "e_bike_mtb" },
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
      bikeId: bike.id,
      title: ["Feierabendrunde", "Zur Arbeit", "Waldrunde", "Ausflug"][Math.floor(rnd() * 4)],
      startTime: new Date(start).toISOString(),
      endTime: new Date(start + secs * 1300).toISOString(),
      distance: km * 1000,
      durationWithoutStops: secs,
      elevation: { gain: km * (bike.id === "bike-0002" ? 25 : 6) * rnd() },
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

function makeStates() {
  const states = {};
  const set = (id, state, attributes = {}) => { states[id] = { entity_id: id, state: String(state), attributes }; };
  BIKES.forEach((b, i) => {
    const p = `sensor.${b.prefix}`;
    set(`${p}_kilometerstand`, 2400 + i * 1300);
    set(`${p}_hohenmeter_gesamt`, 18000 + i * 21000);
    set(`${p}_touren_gesamt`, 130 - i * 20);
    set(`${p}_fahrzeit_gesamt`, 140 + i * 30);
    set(`${p}_akku_charge_cycles`, 48.5 + i * 22);
    set(`${p}_kalorien_gesamt`, 52000 + i * 9000);
    set(`${p}_akku_wh_lifetime`, 31000 + i * 26000);
    const d = new Date(Date.now() - (i + 1) * 86400000);
    const dd = `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
    set(`${p}_letzte_fahrt_startzeit`, `${dd} 16:05`);
    set(`${p}_letzte_fahrt_endzeit`, `${dd} 17:42`);
    set(`${p}_letzte_fahrt_titel`, "Feierabendrunde");
    set(`${p}_letzte_fahrt_distanz`, 28.4 - i * 9);
    set(`${p}_letzte_fahrt_dauer`, 81 - i * 20);
    set(`${p}_letzte_fahrt_o_geschwindigkeit`, 21.0);
    set(`${p}_letzte_fahrt_max_geschwindigkeit`, 34.2);
    set(`${p}_letzte_fahrt_hohenmeter`, 310 + i * 200);
    set(`${p}_letzte_fahrt_hohenmeter_2`, 305 + i * 200);
    set(`${p}_letzte_fahrt_kalorien`, 640);
    set(`${p}_letzte_fahrt_o_trittfrequenz`, 72);
    set(`${p}_letzte_fahrt_max_trittfrequenz`, 104);
    set(`${p}_letzte_fahrt_o_leistung`, 138);
    set(`${p}_letzte_fahrt_max_leistung`, 512);
    set(`${p}_letzte_fahrt_sprunge`, i ? 4 : 0);
    set(`${p}_letzte_fahrt_wheelies`, i ? 2 : 0);
    const ranges = i ? { ECO: 104, "TOUR+": 81, eMTB: 63, TURBO: 47 } : { ECO: 128, TOUR: 96, SPORT: 72, TURBO: 55 };
    for (const [mode, km] of Object.entries(ranges)) {
      set(`${p}_reachable_range_${mode.toLowerCase().replace("+", "")}`, km, { assist_mode: mode });
    }
  });
  return states;
}

const activities = makeActivities();

export const hass = {
  states: makeStates(),
  entities: null,
  async callWS(msg) {
    if (msg.type === "bosch_ebike/list_instances") {
      return { instances: [{ bikes: BIKES.map(({ id, label }) => ({ id, label })) }] };
    }
    if (msg.type === "bosch_ebike/list_activities") return { activities };
    throw new Error(`Unbekannter Websocket-Befehl: ${msg.type}`);
  },
};

export const bikes = [
  { name: "Trekking", prefix: "e_bike_trekking" },
  { name: "MTB", prefix: "e_bike_mtb" },
];
