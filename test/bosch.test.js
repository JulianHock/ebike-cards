import test from "node:test";
import assert from "node:assert/strict";
import { allBikes, loadActivities, resolveBikeId } from "../src/shared/bosch.js";

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
