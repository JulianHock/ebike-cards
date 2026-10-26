# Notes for Claude

## No live entities from ha-bosch-ebike

The cards must **never** use live entities of the ha-bosch-ebike integration, not even optionally or as a fallback.
Live entities are everything that only exists when a live source (ESP32/ESPHome bridge) is linked in the integration options:

- the linked live entities themselves (live state of charge / SoC, live odometer)
- "Geschätzte Reichweite (aktuell)" (`estimated_range_current`) and its `current_soc` attribute
- charge sessions and values derived from them: "Letzte Ladung: Energie", "Geladene Energie gesamt", "Ladeenergie (7/30/365 Tage)", "Restzeit bis 80 %/100 %", "Voraussichtlich fertig bei 80 %/100 %"

Do not offer a config option either that would pull in such values (e.g. a battery level via `soc_entity`).
Only use data from the Bosch cloud: the integration's regular sensors and the websocket (`bosch_ebike/list_instances`, `bosch_ebike/list_activities`).
If a request can only be implemented with live data, say so and ask instead of building it.
