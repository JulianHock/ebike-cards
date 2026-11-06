import test from "node:test";
import assert from "node:assert/strict";
import { clock, hm, isoWeek, parseTime, shortDate, weekdayDate, weekdayDateTime } from "../src/shared/time.js";

test("isoWeek follows ISO 8601 at year boundaries", () => {
  assert.equal(isoWeek(new Date(2026, 0, 1)), 1);
  assert.equal(isoWeek(new Date(2021, 0, 3)), 53);
  assert.equal(isoWeek(new Date(2024, 11, 30)), 1);
  assert.equal(isoWeek(new Date(2026, 5, 15)), 25);
});

test("parseTime reads the integration format", () => {
  assert.equal(parseTime("18.10.2026 14:05"), new Date(2026, 9, 18, 14, 5).getTime());
  assert.equal(parseTime("18.10.2026"), new Date(2026, 9, 18).getTime());
  assert.equal(parseTime("18.10.2026 14:05:09"), new Date(2026, 9, 18, 14, 5, 9).getTime());
});

test("parseTime reads ISO timestamps and rejects the rest", () => {
  assert.equal(parseTime("2026-10-18T12:05:00Z"), Date.UTC(2026, 9, 18, 12, 5));
  for (const v of [null, undefined, "", "unknown"]) assert.equal(parseTime(v), null);
});

test("hm splits minutes", () => {
  assert.deepEqual(hm(45), { v: "45", u: "min" });
  assert.deepEqual(hm(65), { v: "1:05", u: "h" });
  assert.deepEqual(hm(59.6), { v: "1:00", u: "h" });
  for (const v of [0, -1, NaN]) assert.equal(hm(v), null);
});

test("date helpers format local time", () => {
  const ts = new Date(2026, 9, 14, 16, 3).getTime();
  assert.equal(clock(ts), "16:03");
  assert.equal(shortDate(ts), "14.10.2026");
  assert.equal(weekdayDate(ts), "Mi, 14.10.26");
  assert.equal(weekdayDateTime(ts), "Mi, 14.10.2026 · 16:03");
  assert.equal(shortDate(NaN), "");
});
