// Zahlen, Text und Skalen

export function fmt(v, digits = 0) {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  return v.toLocaleString("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function slug(s) {
  return String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

export function niceScale(maxValue) {
  if (!(maxValue > 0)) return { max: 1, step: 0.25 };
  const rough = maxValue / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  const step = nice * mag;
  return { max: Math.ceil(maxValue / step - 1e-9) * step, step };
}

// Nachkommastellen, die eine Schrittweite braucht: 50 → 0, 2,5 → 1, 0,25 → 2
export function stepDigits(step) {
  for (let d = 0; d < 4; d++) {
    const x = step * Math.pow(10, d);
    if (Math.abs(x - Math.round(x)) < 1e-6) return d;
  }
  return 3;
}
