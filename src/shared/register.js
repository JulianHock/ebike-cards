// Registriert ein Custom Element und trägt es in die Kartenauswahl des Dashboards ein

export function registerCard(type, cls, name, description) {
  if (!customElements.get(type)) customElements.define(type, cls);
  window.customCards = window.customCards || [];
  if (!window.customCards.find((c) => c.type === type)) {
    window.customCards.push({ type, name, description });
  }
}
