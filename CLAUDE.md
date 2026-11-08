# Notes for Claude

## No live entities from ha-bosch-ebike

The cards must **never** use live entities of the ha-bosch-ebike integration, not even optionally or as a fallback.
Live entities are everything that only exists when a live source (ESP32/ESPHome bridge) is linked in the integration options:

- the linked live entities themselves (live state of charge / SoC, live odometer)
- "Geschätzte Reichweite (aktuell)" (`estimated_range_current`) and its `current_soc` attribute
- charge sessions and values derived from them: "Letzte Ladung: Energie", "Geladene Energie gesamt", "Ladeenergie (7/30/365 Tage)", "Restzeit bis 80 %/100 %", "Voraussichtlich fertig bei 80 %/100 %"

Do not offer a config option either that would pull in such values (e.g. a battery level via `soc_entity`).
Everything from the Bosch cloud (Bosch eBike Data Act API) may always be used: the integration's regular sensors and every websocket command that returns cloud data, e.g. `bosch_ebike/list_instances`, `bosch_ebike/list_activities` and `bosch_ebike/get_track` (track points of one ride from the activity details).
The only reason for the rule above is that the user doesn't run the ESP32 live bridge of the integration, so live values would always be missing.
If a request can only be implemented with live data, say so and ask instead of building it.
