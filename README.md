# eBike Cards

Dashboard-Karten für Home Assistant, die die Daten der [ha-bosch-ebike](https://github.com/Xunil99/ha-bosch-ebike) Integration darstellen.

| Karte | Typ | Datenquelle |
|---|---|---|
| Fahrstatistik | `custom:ebike-stats-pro-card` | alle Touren (Websocket) |
| Vergleich | `custom:ebike-compare-card` | Gesamt-Sensoren je Bike |
| Tricks | `custom:ebike-tricks-card` | alle Touren (Websocket) |
| Letzte Tour | `custom:ebike-last-ride-card` | „Letzte Fahrt“-Sensoren |
| Bestwerte | `custom:ebike-records-card` | alle Touren (Websocket) |

Alle Karten stecken in einer Datei (`ebike-cards.js`). In HA braucht man also nur eine Ressource.

## Installation über HACS

1. HACS → ⋮ → **Benutzerdefinierte Repositories**
   Repository: `https://github.com/JulianHock/ebike-cards`, Typ: **Dashboard**
2. „eBike Cards“ in HACS suchen und **herunterladen**
3. Browser neu laden (bei Bedarf den Cache leeren)

HACS trägt die Ressource `/hacsfiles/ebike-cards/ebike-cards.js` selbst ein, wenn die Dashboards im UI-Modus verwaltet werden.
Im YAML-Modus trägst du sie selbst ein:

```yaml
lovelace:
  resources:
    - url: /hacsfiles/ebike-cards/ebike-cards.js
      type: module
```

Updates erscheinen in HA unter **Einstellungen → Updates**, sobald ein neues Release veröffentlicht ist.

### Umstieg von der manuell kopierten Datei

Wenn die Karten bisher als einzelne Datei unter `/config/www/` lagen:

1. Unter **Einstellungen → Dashboards → ⋮ → Ressourcen** die alte Ressource (`/local/….js`) löschen
2. Die alte Datei aus `/config/www/` entfernen
3. Browser neu laden

Die Kartenkonfigurationen bleiben unverändert, denn die Kartentypen sind dieselben.

## Konfiguration

Für alle Karten gilt:

| Option | Bedeutung |
|---|---|
| `title` | Überschrift der Karte |
| `background` | eigener Hintergrund (jede CSS-Farbe); ohne Angabe gilt der Kartenhintergrund des Themes |

Die Karten merken sich die gewählten Reiter je Browser (localStorage, Schlüssel enthält den Titel).

Die Kartenkonfiguration kennt **Bikes** auf zwei Wegen:

- `prefix`: der Entitäts-Präfix der Sensoren, z. B. `e_bike_trekking` für `sensor.e_bike_trekking_kilometerstand`
- `bike`: alternativ der Gerätename oder die Bike-ID aus der Integration (nur Tricks und Bestwerte)

### Fahrstatistik

```yaml
type: custom:ebike-stats-pro-card
title: Fahrstatistik
period: month            # week | month | year
metric: distance         # Start-Reiter
metrics: [distance, elevation, rides, duration, speed, calories]
stacked: true
show_totals: true        # false blendet alle Summen über alle Bikes aus
height: 220
hide_unassigned: false   # Touren ohne Bike-Zuordnung ausblenden
names:  { "E-Bike Trekking": Trekking }
colors: { "E-Bike Trekking": "#03a9f4" }
order: [Trekking, MTB]
refresh_minutes: 15
```

Die Bikes kommen automatisch aus der Integration. `names`, `colors` und `order` verweisen auf das Label oder die ID eines Bikes.

### Vergleich

```yaml
type: custom:ebike-compare-card
title: Vergleich
bikes:
  - { name: Trekking, prefix: e_bike_trekking, color: "#03a9f4" }
  - { name: MTB, prefix: e_bike_mtb }
metrics: [odometer, elevation, rides, duration, cycles, calories, energy, efficiency]
layout: vertical         # vertical | horizontal
height: 170
sort: true
show_scale: true
show_leader: false       # Pokal beim Spitzenreiter
suffixes:                # optional: abweichende Sensor-Endungen
  odometer: kilometerstand
```

- `energy` ist die vom Akku abgegebene Energie in kWh.
- `efficiency` ist der Verbrauch in Wh/km; der sparsamste Wert steht zuerst.
- Eine Endung mit `*` (z. B. `*_charge_cycles`) summiert alle passenden Sensoren eines Bikes.

### Tricks

```yaml
type: custom:ebike-tricks-card
title: Tricks
bikes:
  - { name: MTB, prefix: e_bike_mtb }
trick: jump              # Start-Reiter
tricks: [jump, wheelie, manual, stoppie]
sort: true
show_leader: false
```

Die Karte summiert Wheelies, Manuals, Stoppies und Jumps über alle Touren. Unter jedem Bestwert steht die Tour, in der er erreicht wurde.

### Letzte Tour

```yaml
type: custom:ebike-last-ride-card
title: Letzte Tour
bikes:
  - { name: Trekking, prefix: e_bike_trekking }
  - { name: MTB, prefix: e_bike_mtb }
bike: Trekking           # Start-Bike; sonst das mit der neuesten Tour
show_title: true
fields: [duration, pauses, avg_speed, max_speed, up, down, max_alt,
         avg_power, max_power, avg_cadence, max_cadence, calories, tricks]
```

Die Karte findet die Sensoren über das Geräte-Register (`translation_key`), unabhängig von Sprache und Umbenennungen.
Fehlt der Eintrag dort, sucht sie über die üblichen deutschen Entitäts-IDs.

### Bestwerte

```yaml
type: custom:ebike-records-card
title: Bestwerte
bikes:
  - { name: Trekking, prefix: e_bike_trekking }
  - { name: MTB, prefix: e_bike_mtb }
bike: Trekking
records: [distance, up, ride_time, max_speed, avg_speed, calories]
min_avg_km: 5            # Mindeststrecke für "Schnellster Schnitt"
```

## Entwicklung

```
src/
  index.js              Einstiegspunkt, importiert alle Karten
  cards/*.js            je eine Datei pro Karte
  shared/*.js           gemeinsame Helfer (Formatierung, Zeit, Websocket, Registrierung)
demo/                   Testseite mit erfundenen Daten
build.mjs               esbuild → dist/ebike-cards.js
```

```bash
npm install
npm run build   # dist/ebike-cards.js bauen
npm run demo    # Demo unter http://localhost:8000/demo/, baut bei Änderungen neu
```

### Branches und Releases

- `main` enthält den veröffentlichten Stand. Releases entstehen nur von hier.
- `dev` ist der Arbeitsstand. CI baut jeden Push und prüft die HACS-Struktur.

Ein Release:

```bash
git checkout main && git merge dev
npm version minor            # oder patch / major: setzt Version, Commit und Tag
git push --follow-tags
```

Der Tag löst den Release-Workflow aus. Er baut `ebike-cards.js` und hängt die Datei an ein GitHub-Release.
Danach bietet HACS das Update an.

Für eine Testversion auf `dev`:

```bash
npm version prerelease --preid beta   # z. B. v1.16.0-beta.0
git push --follow-tags
```

Das erzeugt ein Pre-Release. In HACS siehst du es, wenn du beim Repository „Beta-Versionen anzeigen“ aktivierst.
