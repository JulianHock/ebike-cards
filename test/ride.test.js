import test from "node:test";
import assert from "node:assert/strict";
import { activityToRide, groupByMonth, rideTile, rideTricks, trackStats } from "../src/shared/ride.js";

const act = {
  id: "a1",
  title: " Feierabendrunde ",
  startTime: "2026-11-07T14:00:00Z",
  endTime: "2026-11-07T15:30:00Z",
  distance: 28400,
  durationWithoutStops: 4500,
  speed: { average: 22.7, maximum: 34.2 },
  elevation: { gain: 310, loss: 305 },
  caloriesBurned: 640,
  trickCheck: { jumps: { amount: 1 }, wheelies: { amount: 0 }, manuals: { amount: 3 } },
};

test("activityToRide converts the websocket fields", () => {
  const r = activityToRide(act);
  assert.equal(r.start, Date.parse(act.startTime));
  assert.equal(r.total, 90);
  assert.equal(r.ride, 75);
  assert.equal(r.title, "Feierabendrunde");
  assert.equal(r.distance, 28.4);
  assert.equal(r.up, 310);
  assert.equal(r.down, 305);
  assert.equal(r.avg_speed, 22.7);
  assert.equal(r.max_speed, 34.2);
  assert.equal(r.calories, 640);
  assert.equal(r.avg_power, null);
  assert.deepEqual(r.tricks.map((t) => [t.c, t.one]), [[1, "Jump"], [3, "Manual"]]);
});

test("activityToRide copes with missing values", () => {
  const r = activityToRide({ startTime: "x", caloriesBurned: null, title: "  " });
  assert.equal(r.start, null);
  assert.equal(r.total, null);
  assert.equal(r.ride, null);
  assert.equal(r.title, null);
  assert.equal(r.distance, null);
  assert.equal(r.calories, null);
  assert.deepEqual(r.tricks, []);
});

test("rideTricks skips tricks without count", () => {
  const counts = { jumps: 2, stoppies: null };
  assert.deepEqual(rideTricks((k) => counts[k]).map((t) => t.many), ["Jumps"]);
});

test("groupByMonth groups newest first and sums km", () => {
  const r = (y, m, d, km) => ({ start: new Date(y, m, d, 12).getTime(), distance: km });
  const groups = groupByMonth([r(2026, 9, 3, 10), r(2026, 10, 7, 20), r(2026, 10, 1, 5), r(2025, 10, 9, 1)]);
  assert.deepEqual(groups.map((g) => g.label), ["November 2026", "Oktober 2026", "November 2025"]);
  assert.deepEqual(groups.map((g) => [g.year, g.month]), [[2026, "November"], [2026, "Oktober"], [2025, "November"]]);
  assert.deepEqual(groups.map((g) => g.rides.length), [2, 1, 1]);
  assert.equal(groups[0].km, 25);
  assert.equal(groups[0].rides[0].distance, 20);
});

test("rideTile shows only available fields", () => {
  const html = rideTile({ color: "#fff", r: activityToRide(act), showTitle: true,
    fields: new Set(["avg_speed", "avg_power", "tricks"]) });
  assert.match(html, /Ø Tempo/);
  assert.doesNotMatch(html, /Eigenleistung/);
  assert.match(html, /1 Jump · 3 Manuals/);
  assert.match(html, /Feierabendrunde/);
});

test("trackStats takes max values and averages over pedaling points", () => {
  const t = trackStats([
    { ele: 300, cadence: 0, power: 0 },
    { ele: 433.4, cadence: 60, power: 100 },
    { ele: null, cadence: 80, power: 300 },
  ]);
  assert.deepEqual(t, { max_alt: 433.4, avg_cadence: 70, max_cadence: 80, avg_power: 200, max_power: 300 });
  assert.deepEqual(trackStats(undefined), { max_alt: null, avg_cadence: null, max_cadence: null, avg_power: null, max_power: null });
});

test("rideTile shows placeholders while track values load", () => {
  const html = rideTile({ color: "#fff", r: { ...activityToRide(act), pending: true }, showTitle: true,
    fields: new Set(["max_alt", "avg_cadence"]) });
  assert.match(html, /Höchster Punkt<\/span><span class="cv">…/);
  assert.match(html, /Ø Trittfrequenz/);
});

test("rideTile can leave out the date and title line", () => {
  const html = rideTile({ color: "#fff", r: activityToRide(act), showTitle: true, showHeader: false, fields: new Set() });
  assert.doesNotMatch(html, /class="top"/);
  assert.doesNotMatch(html, /Feierabendrunde/);
});
