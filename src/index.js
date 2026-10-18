/*
 * eBike Cards – Dashboard-Karten für die ha-bosch-ebike Integration
 *
 * Enthält: ebike-stats-pro-card, ebike-compare-card, ebike-tricks-card,
 *          ebike-last-ride-card, ebike-records-card
 *
 * Alle Karten übernehmen den Kartenhintergrund des aktiven Themes.
 * Optional: background: "#1e1e1e" setzt einen eigenen Hintergrund (jede CSS-Farbe).
 */

import "./cards/stats-pro-card.js";
import "./cards/compare-card.js";
import "./cards/tricks-card.js";
import "./cards/last-ride-card.js";
import "./cards/records-card.js";

// Wird beim Build aus package.json gesetzt
console.info(`%c EBIKE-CARDS %c v${__VERSION__} `, "background:#03a9f4;color:#fff", "");
