// UI-Editor der Karten: Optionen über ha-form (Home Assistant), Bikes als eigene Liste
// mit Farbwahl und Reihenfolge. Jede Karte beschreibt ihre Abschnitte in defineEditor().
//
// Der Editor schreibt nur Optionen, die man im Editor ändert. Alles andere (z. B. 'suffixes'
// oder eigene Reihenfolgen in 'metrics') bleibt in der Konfiguration, wie es ist.

import { PALETTE } from "./constants.js";
import { esc, cssValue } from "./format.js";
import { integrationBikes, matchesBike, resolveBikeId } from "./bosch.js";

// Wert für "Automatisch" in Auswahllisten (entfernt die Option aus der Konfiguration)
export const AUTO = "__auto__";

// {key: Bezeichnung} → Optionen für den select-Selektor
export const options = (map) => Object.entries(map).map(([value, label]) => ({ value, label }));

// Bikes aus 'bikes' als Optionen für den Start-Bike, mit "Automatisch" an erster Stelle
export function bikeChoice(config, autoLabel) {
  const names = (config.bikes || []).map((b) => b?.name || b?.bike || b?.prefix).filter(Boolean);
  return [{ value: AUTO, label: autoLabel }, ...[...new Set(names)].map((n) => ({ value: n, label: n }))];
}

// Bausteine für die Abschnitte der Karten (ha-form-Schema)
export const F = {
  title: (std) => ({ name: "title", label: "Titel", helper: `Leer lassen für „${std}“`, selector: { text: {} } }),
  background: { name: "background", label: "Hintergrund",
    helper: "CSS-Farbe, Variable oder Verlauf, z. B. #1e1e1e; leer lassen für den Kartenhintergrund des Themes",
    selector: { text: {} } },
  refresh: { name: "refresh_minutes", label: "Touren neu laden alle",
    selector: { number: { min: 1, max: 1440, step: 1, mode: "box", unit_of_measurement: "min" } } },
  height: { name: "height", label: "Diagrammhöhe",
    selector: { number: { min: 100, max: 600, step: 10, mode: "box", unit_of_measurement: "px" } } },
  bool: (name, label, helper) => ({ name, label, helper, selector: { boolean: {} } }),
  select: (name, label, opts, helper) => ({ name, label, helper,
    selector: { select: { mode: "dropdown", options: Array.isArray(opts) ? opts : options(opts) } } }),
  multi: (name, label, map, helper) => ({ name, label, helper,
    selector: { select: { multiple: true, mode: "list", options: options(map) } } }),
  startBike: (config, autoLabel) => ({ name: "bike", label: "Start-Bike", auto: true,
    helper: "Danach merkt sich die Karte die Auswahl je Browser",
    selector: { select: { mode: "dropdown", options: bikeChoice(config, autoLabel) } } }),
};

// Start-Reiter: Auswahl aus den gewählten Reitern (sonst allen)
export function startTab(name, label, map, config, listKey) {
  const keys = (Array.isArray(config[listKey]) ? config[listKey] : Object.keys(map)).filter((k) => map[k]);
  const opts = (keys.length ? keys : Object.keys(map)).map((k) => ({ value: k, label: map[k] }));
  return { name, label, helper: "Danach merkt sich die Karte den zuletzt gewählten Reiter je Browser",
    selector: { select: { mode: "dropdown", options: opts } } };
}

// Pfade aus den Material Design Icons (wie in HA), damit die Knöpfe ohne ha-icon auskommen
const ICONS = {
  up: "M13,20H11V8L5.5,13.5L4.08,12.08L12,4.16L19.92,12.08L18.5,13.5L13,8V20Z",
  down: "M11,4H13V16L18.5,10.5L19.92,11.92L12,19.84L4.08,11.92L5.5,10.5L11,16V4Z",
  remove: "M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z",
  add: "M19,13H13V19H11V13H5V11H11V5H13V11H19V13Z",
  reset: "M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.41,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z",
};
const icon = (k) => `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="${ICONS[k]}"/></svg>`;

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fieldsOf = (schema) => schema.flatMap((s) => (s.type === "grid" ? fieldsOf(s.schema) : [s]));
const blank = (v) => v === undefined || v === null || v === "" || v === AUTO
  || (typeof v === "number" && !Number.isFinite(v));
const isMulti = (f) => !!f.selector?.select?.multiple;
const hex = (v) => (/^#[0-9a-f]{6}$/i.test(v) ? v : /^#[0-9a-f]{3}$/i.test(v)
  ? `#${v.slice(1).split("").map((c) => c + c).join("")}` : null);

// Neue Auswahl einer Mehrfachliste: bestehende Reihenfolge behalten, Neues hinten anfügen
function keepOrder(old, next) {
  return [...old.filter((x) => next.includes(x)), ...next.filter((x) => !old.includes(x))];
}

// ha-form wird im Frontend erst bei Bedarf geladen; der Editor der Entitäten-Karte bringt es mit
let formLoad;
function loadHaForm() {
  if (customElements.get("ha-form")) return Promise.resolve();
  formLoad ||= (async () => {
    try {
      const helpers = await window.loadCardHelpers?.();
      const card = await helpers?.createCardElement({ type: "entities", entities: [] });
      await card?.constructor?.getConfigElement?.();
    } catch (e) { /* ignore */ }
    await Promise.race([customElements.whenDefined("ha-form"), new Promise((r) => setTimeout(r, 3000))]);
  })();
  return formLoad;
}

const CSS = `
  :host { display: block; }
  .section + .section { margin-top: 20px; }
  .head { font-size: 15px; font-weight: 500; margin: 0 0 8px; color: var(--primary-text-color); }
  details > summary { cursor: pointer; list-style: none; display: flex; align-items: center; gap: 6px; }
  details > summary::-webkit-details-marker { display: none; }
  details > summary::before { content: ""; width: 0; height: 0; border-style: solid;
    border-width: 5px 0 5px 7px; border-color: transparent transparent transparent currentColor; transition: transform .15s; }
  details[open] > summary::before { transform: rotate(90deg); }
  details[open] > summary { margin-bottom: 12px; }
  .hint { font-size: 12.5px; color: var(--secondary-text-color); margin: 0 0 10px; line-height: 1.4; }
  .bike { border: 1px solid var(--divider-color, rgba(127,127,127,.3)); border-radius: 12px;
          padding: 8px 12px 12px; margin-bottom: 10px; }
  .bhead { display: flex; align-items: center; gap: 4px; margin-bottom: 8px; min-height: 36px; }
  .bname { flex: 1; min-width: 0; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
           margin-left: 6px; }
  .bname small { font-weight: 400; color: var(--secondary-text-color); margin-left: 6px; }
  .sw { position: relative; width: 26px; height: 26px; border-radius: 8px; flex: none; cursor: pointer;
        box-shadow: inset 0 0 0 1px rgba(127,127,127,.35); }
  .sw input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; border: 0; padding: 0; }
  button { font: inherit; color: var(--secondary-text-color); background: none; border: 0; cursor: pointer;
           width: 34px; height: 34px; border-radius: 50%; display: inline-flex; align-items: center;
           justify-content: center; padding: 0; flex: none; }
  button:hover:not(:disabled) { background: rgba(127,127,127,.15); color: var(--primary-text-color); }
  button:disabled { opacity: .35; cursor: default; }
  button[hidden] { display: none; }
  button.add { width: auto; height: 36px; border-radius: 18px; padding: 0 14px 0 10px; gap: 6px;
               color: var(--primary-color); font-weight: 500; }
`;

export function defineEditor(tag, opts) {
  if (customElements.get(tag)) return tag;
  const bikeOpts = opts.sections.find((s) => s.bikes)?.bikes || {};

  class EbikeCardEditor extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this._bikes = null;      // Bikes der Integration, sobald geladen
      this._struct = "";
    }

    setConfig(config) {
      this._config = { ...config };
      this._render();
    }

    set hass(hass) {
      const first = !this._hass;
      this._hass = hass;
      this.shadowRoot.querySelectorAll("ha-form").forEach((f) => { f.hass = hass; });
      if (first) {
        integrationBikes(hass).then((b) => { this._bikes = b; this._render(); });
      }
    }

    connectedCallback() {
      loadHaForm().then(() => { this._ready = true; this._render(); });
    }

    /* ---------- Daten ---------- */

    _defaults() {
      return typeof opts.defaults === "function" ? opts.defaults(this._config) : opts.defaults || {};
    }

    _ctx() { return { config: this._config, bikes: this._bikes || [] }; }

    // Was ha-form anzeigt: Wert aus der Konfiguration, sonst der Standard der Karte
    _formData(fields) {
      const def = this._defaults();
      const data = {};
      for (const f of fields) {
        const v = this._config[f.name] ?? def[f.name];
        data[f.name] = v === undefined && f.auto ? AUTO : v;
      }
      return data;
    }

    _set(config) {
      this._config = config;
      this.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }));
      this._render();
    }

    _formChanged(sec, value) {
      const fields = fieldsOf(sec.schema(this._ctx()));
      const shown = this._formData(fields);
      const cfg = { ...this._config };
      let changed = false;
      for (const f of fields) {
        let v = value[f.name];
        if (same(v, shown[f.name])) continue;
        if (isMulti(f)) {
          // Eine Mehrfachliste darf nicht leer werden (die Karte zeigt dann ohnehin alles)
          if (!Array.isArray(v) || !v.length) continue;
          v = keepOrder(Array.isArray(shown[f.name]) ? shown[f.name] : [], v);
        }
        if (blank(v)) delete cfg[f.name]; else cfg[f.name] = v;
        changed = true;
      }
      if (changed) this._set(cfg); else this._render();
    }

    /* ---------- Liste 'bikes' ---------- */

    _bikeLabel(id) {
      const b = (this._bikes || []).find((x) => x.id === id);
      return b ? b.name : null;
    }

    // Bike der Integration zu einem Eintrag
    // (auch wenn er über den Gerätenamen oder nur über den Entitäts-Präfix verweist)
    _bikeOf(row) {
      if (!row || !this._bikes) return null;
      const id = resolveBikeId(row, this._bikes, this._hass);
      return this._bikes.find((b) => matchesBike(row, b) || b.id === id) || null;
    }

    _bikeOptions(row) {
      const list = this._bikes || [];
      const names = list.map((b) => b.name);
      const opts = list.map((b) => ({
        value: b.id,
        label: names.filter((n) => n === b.name).length > 1 ? `${b.name} (${b.id})` : b.name,
      }));
      const v = row?.bike || row?.id;
      if (v && !this._bikeOf(row)) opts.push({ value: String(v), label: `${v} (nicht gefunden)` });
      return opts;
    }

    _bikeSchema(row, i) {
      const extra = bikeOpts.fields ? bikeOpts.fields(row, i) : [];
      const schema = [
        { type: "grid", name: "", schema: [
          { name: "name", label: "Name", selector: { text: {} } },
          { name: "bike", label: "Bike", selector: { select: { mode: "dropdown", options: this._bikeOptions(row) } } },
        ] },
        ...extra,
      ];
      if (row?.prefix !== undefined) {
        schema.push({ name: "prefix", label: "Entitäts-Präfix",
          helper: "Nur nötig, wenn das Bike nicht über die Auswahl gefunden wird", selector: { text: {} } });
      }
      return schema;
    }

    _bikeData(row, i) {
      const data = {};
      for (const f of fieldsOf(this._bikeSchema(row, i))) data[f.name] = row?.[f.name];
      // Ein Verweis über den Gerätenamen erscheint in der Auswahl als das passende Bike
      const hit = this._bikeOf(row);
      data.bike = hit ? hit.id : row?.bike ?? row?.id;
      return data;
    }

    _rowName(b) { return b?.name || b?.bike || b?.prefix || ""; }

    _bikeChanged(i, value) {
      const bikes = [...(this._config.bikes || [])];
      const old = bikes[i] || {};
      const shown = this._bikeData(old, i);
      const row = { ...old };
      for (const f of fieldsOf(this._bikeSchema(old, i))) {
        const v = value[f.name];
        if (same(v, shown[f.name])) continue;
        if (blank(v)) delete row[f.name]; else row[f.name] = v;
        if (f.name === "bike") delete row.id;
      }
      if (same(row, old)) return;
      // Neues Bike gewählt: den Namen mitnehmen, solange er noch der des alten Bikes war
      if (row.bike !== old.bike) {
        const prev = this._bikeOf(old)?.name;
        const next = this._bikeLabel(row.bike);
        if (next && (!old.name || old.name === prev)) row.name = next;
      }
      bikes[i] = row;
      const cfg = { ...this._config, bikes };
      // Start-Bike umbenennen, wenn es dieses Bike war
      if (cfg.bike && cfg.bike === this._rowName(old) && this._rowName(row) !== cfg.bike) cfg.bike = this._rowName(row);
      this._set(cfg);
    }

    _bikeAction(act, i) {
      const cfg = { ...this._config };
      const bikes = [...(cfg.bikes || [])];
      if (act === "add") {
        const free = (this._bikes || []).find((b) => !bikes.some((r) => this._bikeOf(r)?.id === b.id));
        bikes.push({ name: free ? free.name : `Bike ${bikes.length + 1}`, ...(free ? { bike: free.id } : {}),
          ...(bikeOpts.add || {}) });
      } else if (act === "remove") {
        const [gone] = bikes.splice(i, 1);
        if (cfg.bike && cfg.bike === this._rowName(gone)) delete cfg.bike;
      } else if (act === "up" && i > 0) {
        [bikes[i - 1], bikes[i]] = [bikes[i], bikes[i - 1]];
      } else if (act === "down" && i < bikes.length - 1) {
        [bikes[i + 1], bikes[i]] = [bikes[i], bikes[i + 1]];
      } else if (act === "reset-color") {
        bikes[i] = { ...bikes[i] };
        delete bikes[i].color;
      } else return;
      cfg.bikes = bikes;
      this._set(cfg);
    }

    _bikeColor(i, color) {
      const bikes = [...(this._config.bikes || [])];
      bikes[i] = { ...bikes[i], color };
      this._set({ ...this._config, bikes });
    }

    /* ---------- Bikes der Integration (Fahrstatistik: names, colors, order) ---------- */

    // Schlüssel in names/colors/order: wie bisher verwendet, sonst label (bei doppeltem label die ID)
    _seriesKey(b) {
      const { names = {}, colors = {} } = this._config;
      if (names[b.id] !== undefined || colors[b.id] !== undefined) return b.id;
      const dup = (this._bikes || []).filter((x) => x.label === b.label).length > 1;
      return dup ? b.id : b.label;
    }

    // Bikes in der Reihenfolge und mit den Farben, die die Karte verwendet
    _series() {
      const { names = {}, colors = {}, order } = this._config;
      let pi = 0;
      const list = (this._bikes || []).map((b) => {
        const own = cssValue(colors[b.label]) || cssValue(colors[b.id]);
        return { ...b, title: names[b.label] || names[b.id] || "", own,
          color: own || PALETTE[pi++ % PALETTE.length] };
      });
      if (Array.isArray(order)) {
        const idx = (s) => {
          const i = order.findIndex((o) => o === s.label || o === (s.title || s.label) || o === s.id);
          return i < 0 ? 999 : i;
        };
        list.sort((a, b) => idx(a) - idx(b));
      }
      return list;
    }

    _seriesMap(key, b, v) {
      const map = { ...(this._config[key] || {}) };
      const k = this._seriesKey(b);
      delete map[b.label];
      delete map[b.id];
      if (!blank(v)) map[k] = v;
      const cfg = { ...this._config };
      if (Object.keys(map).length) cfg[key] = map; else delete cfg[key];
      return cfg;
    }

    _seriesAction(act, i, value) {
      const list = this._series();
      const b = list[i];
      if (!b) return;
      if (act === "name") return this._set(this._seriesMap("names", b, value?.trim?.() ?? value));
      if (act === "color") return this._set(this._seriesMap("colors", b, value));
      if (act === "reset-color") return this._set(this._seriesMap("colors", b, null));
      const j = act === "up" ? i - 1 : act === "down" ? i + 1 : -1;
      if (j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
      this._set({ ...this._config, order: list.map((s) => this._seriesKey(s)) });
    }

    /* ---------- Darstellung ---------- */

    // Aufbau (Anzahl der Zeilen) ändert sich selten; sonst nur Werte aktualisieren,
    // damit Eingabefelder beim Tippen den Fokus behalten
    _structure() {
      return JSON.stringify([
        (this._config.bikes || []).length,
        this._bikes ? this._series().map((s) => s.id) : null,
      ]);
    }

    _render() {
      if (!this._ready || !this._config) return;
      const struct = this._structure();
      if (struct !== this._struct) { this._struct = struct; this._build(); }
      this._update();
    }

    _build() {
      const root = this.shadowRoot;
      const bikes = this._config.bikes || [];
      const html = opts.sections.map((sec, s) => {
        let body = "";
        if (sec.schema) body = `<ha-form data-sec="${s}"></ha-form>`;
        else if (sec.bikes) {
          body = bikes.map((_, i) => `
            <div class="bike">
              <div class="bhead">
                <label class="sw" title="Farbe"><input type="color" data-kind="bike" data-i="${i}"></label>
                <span class="bname"></span>
                <button data-kind="bike" data-act="reset-color" data-i="${i}" title="Standardfarbe">${icon("reset")}</button>
                <button data-kind="bike" data-act="up" data-i="${i}" title="Nach oben" ${i ? "" : "disabled"}>${icon("up")}</button>
                <button data-kind="bike" data-act="down" data-i="${i}" title="Nach unten" ${i < bikes.length - 1 ? "" : "disabled"}>${icon("down")}</button>
                <button data-kind="bike" data-act="remove" data-i="${i}" title="Entfernen">${icon("remove")}</button>
              </div>
              <ha-form data-bike="${i}"></ha-form>
            </div>`).join("") + `
            <button class="add" data-kind="bike" data-act="add">${icon("add")}<span>Bike hinzufügen</span></button>`;
        } else if (sec.series) {
          const list = this._bikes ? this._series() : [];
          body = !this._bikes ? `<p class="hint">Bikes werden geladen …</p>`
            : !list.length ? `<p class="hint">Keine Bikes in der Integration gefunden.</p>`
            : `<p class="hint">Die Bikes kommen aus der Integration. Hier lassen sich Anzeigename, Farbe und Reihenfolge ändern.</p>`
              + list.map((_, i) => `
            <div class="bike">
              <div class="bhead">
                <label class="sw" title="Farbe"><input type="color" data-kind="series" data-i="${i}"></label>
                <span class="bname"></span>
                <button data-kind="series" data-act="reset-color" data-i="${i}" title="Standardfarbe">${icon("reset")}</button>
                <button data-kind="series" data-act="up" data-i="${i}" title="Nach oben" ${i ? "" : "disabled"}>${icon("up")}</button>
                <button data-kind="series" data-act="down" data-i="${i}" title="Nach unten" ${i < list.length - 1 ? "" : "disabled"}>${icon("down")}</button>
              </div>
              <ha-form data-series="${i}"></ha-form>
            </div>`).join("");
        }
        const hint = sec.hint ? `<p class="hint">${esc(sec.hint)}</p>` : "";
        if (sec.collapsed) {
          return `<details class="section"><summary class="head">${esc(sec.title)}</summary>${hint}${body}</details>`;
        }
        return `<div class="section">${sec.title ? `<div class="head">${esc(sec.title)}</div>` : ""}${hint}${body}</div>`;
      }).join("");
      // offene Abschnitte bleiben beim Neuaufbau offen
      const open = [...root.querySelectorAll("details")].map((d) => d.open);
      root.innerHTML = `<style>${CSS}</style>${html}`;
      root.querySelectorAll("details").forEach((d, i) => { if (open[i]) d.open = true; });

      const label = (f) => f.label ?? f.name;
      const helper = (f) => f.helper;
      root.querySelectorAll("ha-form").forEach((form) => {
        form.computeLabel = label;
        form.computeHelper = helper;
        form.hass = this._hass;
        form.addEventListener("value-changed", (ev) => {
          ev.stopPropagation();
          const v = ev.detail.value;
          if (form.dataset.sec !== undefined) this._formChanged(opts.sections[form.dataset.sec], v);
          else if (form.dataset.bike !== undefined) this._bikeChanged(Number(form.dataset.bike), v);
          else if (form.dataset.series !== undefined) {
            const i = Number(form.dataset.series);
            if (v.name !== this._series()[i]?.title) this._seriesAction("name", i, v.name);
          }
        });
      });
      if (!this._bound) {
        this._bound = true;
        root.addEventListener("click", (ev) => {
          const btn = ev.target.closest("button[data-act]");
          if (!btn) return;
          const i = Number(btn.dataset.i);
          if (btn.dataset.kind === "series") this._seriesAction(btn.dataset.act, i);
          else this._bikeAction(btn.dataset.act, i);
        });
        root.addEventListener("change", (ev) => {
          const inp = ev.target.closest?.('input[type="color"]');
          if (!inp) return;
          const i = Number(inp.dataset.i);
          if (inp.dataset.kind === "series") this._seriesAction("color", i, inp.value);
          else this._bikeColor(i, inp.value);
        });
      }
    }

    _update() {
      const root = this.shadowRoot;
      const ctx = this._ctx();
      root.querySelectorAll("ha-form[data-sec]").forEach((form) => {
        const schema = opts.sections[form.dataset.sec].schema(ctx);
        if (!same(schema, form.schema)) form.schema = schema;
        form.data = this._formData(fieldsOf(schema));
      });
      const bikes = this._config.bikes || [];
      root.querySelectorAll("ha-form[data-bike]").forEach((form) => {
        const i = Number(form.dataset.bike);
        const schema = this._bikeSchema(bikes[i], i);
        if (!same(schema, form.schema)) form.schema = schema;
        form.data = this._bikeData(bikes[i], i);
        const color = cssValue(bikes[i]?.color);
        const head = form.previousElementSibling;
        this._head(head, color || PALETTE[i % PALETTE.length], !!color, this._rowName(bikes[i]) || `Bike ${i + 1}`);
      });
      const series = this._bikes ? this._series() : [];
      root.querySelectorAll("ha-form[data-series]").forEach((form) => {
        const s = series[Number(form.dataset.series)];
        if (!s) return;
        const schema = [{ name: "name", label: "Anzeigename", helper: `Leer lassen für „${s.label}“`, selector: { text: {} } }];
        if (!same(schema, form.schema)) form.schema = schema;
        form.data = { name: s.title };
        this._head(form.previousElementSibling, s.color, !!s.own, s.title || s.label, s.title ? s.label : "");
      });
    }

    _head(head, color, own, name, sub = "") {
      const sw = head.querySelector(".sw");
      sw.style.background = color;
      const inp = sw.querySelector("input");
      inp.value = hex(color) || "#03a9f4";
      head.querySelector(".bname").innerHTML = `${esc(name)}${sub ? `<small>${esc(sub)}</small>` : ""}`;
      head.querySelector('[data-act="reset-color"]').hidden = !own;
    }
  }

  customElements.define(tag, EbikeCardEditor);
  return tag;
}
