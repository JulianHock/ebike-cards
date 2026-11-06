import test from "node:test";
import assert from "node:assert/strict";
import { cssValue, esc, fmt, niceScale, slug, stepDigits } from "../src/shared/format.js";

test("fmt formats German numbers and marks missing values", () => {
  assert.equal(fmt(1234.5, 1), "1.234,5");
  assert.equal(fmt(2), "2");
  for (const v of [null, undefined, NaN, Infinity]) assert.equal(fmt(v), "–");
});

test("esc neutralises HTML", () => {
  assert.equal(esc(`<img src="x" onerror='y'>&`), "&lt;img src=&quot;x&quot; onerror=&#39;y&#39;&gt;&amp;");
  assert.equal(esc(null), "");
  assert.equal(esc(0), "0");
});

test("cssValue keeps colors, variables and gradients", () => {
  for (const v of ["#03a9f4", "red", "rgb(0, 0, 0)", "rgb(0 0 0 / 50%)", "hsl(200, 50%, 50%)",
    "var(--primary-color)", "var(--x, #fff)", "linear-gradient(90deg, #000 0%, #fff 100%)"]) {
    assert.equal(cssValue(v), v);
  }
  assert.equal(cssValue("  #fff  "), "#fff");
});

test("cssValue rejects everything that can leave the value", () => {
  for (const v of ["red;}</style><img src=x onerror=alert(1)>", `red" onclick="x`, "red; color: blue", "a{b}",
    "url(//example.com/x.png)", "URL (x.png)", "https://example.com", "\\72 ed"]) {
    assert.equal(cssValue(v), "");
  }
  for (const v of [null, undefined, ""]) assert.equal(cssValue(v), "");
});

test("slug normalises labels", () => {
  assert.equal(slug("E-Bike Größe"), "e_bike_grosse");
  assert.equal(slug("  --Ä!  "), "a");
  assert.equal(slug(null), "");
});

test("niceScale picks round steps", () => {
  assert.deepEqual(niceScale(0), { max: 1, step: 0.25 });
  assert.deepEqual(niceScale(-5), { max: 1, step: 0.25 });
  assert.deepEqual(niceScale(100), { max: 100, step: 25 });
  assert.deepEqual(niceScale(101), { max: 150, step: 50 });
});

test("stepDigits counts the decimals of a step", () => {
  assert.equal(stepDigits(50), 0);
  assert.equal(stepDigits(2.5), 1);
  assert.equal(stepDigits(0.25), 2);
});
