import test from "node:test";
import assert from "node:assert/strict";
import { allBikes, deviceSensors, findBikeDevice, loadActivities, resolveBikeId } from "../src/shared/bosch.js";

const bikes = [{ id: "A1", label: "E-Bike Trekking" }, { id: "B2", label: "MTB" }];

test("loadActivities uses only the cloud websocket commands", async () => {
  const calls = [];
  const hass = { callWS: async ({ type }) => {
    calls.push(type);
    return type.endsWith("list_instances") ? { instances: [{ bikes }] } : { activities: [{ id: 1 }] };
  } };
  assert.deepEqual(await loadActivities(hass), [[{ bikes }], [{ id: 1 }]]);
  assert.deepEqual(calls.sort(), ["bosch_ebike/list_activities", "bosch_ebike/list_instances"]);
});

test("loadActivities copes with empty answers", async () => {
  assert.deepEqual(await loadActivities({ callWS: async () => null }), [[], []]);
});

test("allBikes flattens instances", () => {
  assert.deepEqual(allBikes([{ bikes: [bikes[0]] }, {}, { bikes: [bikes[1]] }]), bikes);
});

test("resolveBikeId matches ID, label and prefix", () => {
  assert.equal(resolveBikeId({ bike: "b2" }, bikes), "B2");
  assert.equal(resolveBikeId({ id: " mtb " }, bikes), "B2");
  assert.equal(resolveBikeId({ prefix: "e_bike_trekking" }, bikes), "A1");
  assert.equal(resolveBikeId({ bike: "unknown" }, bikes), null);
});

// Registry wie in hass.devices / hass.entities: ein deutsch und ein englisch angelegtes Bike
const hass = {
  devices: {
    d1: { id: "d1", name: "Performance Line CX", name_by_user: "E-Bike Trekking", identifiers: [["ha_bosch_ebike", "A1"]] },
    d2: { id: "d2", name: "MTB", name_by_user: null, identifiers: [["ha_bosch_ebike", "B2"]] },
    d3: { id: "d3", name: "MTB", name_by_user: null, identifiers: [["other", "x"]] },
  },
  entities: {
    "sensor.e_bike_trekking_kilometerstand": { device_id: "d1", platform: "ha_bosch_ebike", translation_key: "odometer" },
    "sensor.e_bike_trekking_akku_charge_cycles": { device_id: "d1", platform: "ha_bosch_ebike" },
    "sensor.drive_unit_cx_odometer": { device_id: "d2", platform: "ha_bosch_ebike", translation_key: "odometer" },
    "sensor.drive_unit_cx_total_rides": { device_id: "d2", platform: "ha_bosch_ebike", translation_key: "total_rides" },
    "binary_sensor.drive_unit_cx_x": { device_id: "d2", platform: "ha_bosch_ebike", translation_key: "x" },
  },
};

test("findBikeDevice matches device name, bike ID and prefix", () => {
  assert.equal(findBikeDevice(hass, { bike: "e-bike trekking" }), "d1");
  assert.equal(findBikeDevice(hass, { bike: "b2" }), "d2");
  assert.equal(findBikeDevice(hass, { bike: "MTB" }), "d2"); // d3 belongs to another integration
  assert.equal(findBikeDevice(hass, { prefix: "drive_unit_cx" }), "d2");
  assert.equal(findBikeDevice(hass, { bike: "unknown", prefix: "e_bike_trekking" }), "d1");
  assert.equal(findBikeDevice(hass, { bike: "unknown" }), null);
  assert.equal(findBikeDevice({}, { prefix: "e_bike_trekking" }), null);
});

test("findBikeDevice ignores ambiguous device names", () => {
  const twins = { devices: {
    d1: { id: "d1", name: "Performance Line CX", identifiers: [["ha_bosch_ebike", "A1"]] },
    d2: { id: "d2", name: "Performance Line CX", identifiers: [["ha_bosch_ebike", "B2"]] },
  } };
  assert.equal(findBikeDevice(twins, { bike: "Performance Line CX" }), null);
  assert.equal(findBikeDevice(twins, { bike: "B2" }), "d2");
});

test("deviceSensors lists sensors and translation keys of one device", () => {
  assert.deepEqual(deviceSensors(hass, "d2"), {
    ids: ["sensor.drive_unit_cx_odometer", "sensor.drive_unit_cx_total_rides"],
    byTk: { odometer: "sensor.drive_unit_cx_odometer", total_rides: "sensor.drive_unit_cx_total_rides" },
  });
  assert.deepEqual(deviceSensors(hass, null), { ids: [], byTk: {} });
});

test("resolveBikeId finds the bike through the prefix's device", () => {
  const renamed = [{ id: "A1", label: "Trekking" }, { id: "B2", label: "MTB" }];
  assert.equal(resolveBikeId({ prefix: "drive_unit_cx" }, renamed, hass), "B2");
  assert.equal(resolveBikeId({ prefix: "drive_unit_cx" }, renamed), null);
});
