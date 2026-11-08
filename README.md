# eBike Cards

[![HACS Custom](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://hacs.xyz/docs/faq/custom_repositories/)
[![Home Assistant 2024.1+](https://img.shields.io/badge/Home%20Assistant-2024.1%2B-blue.svg)](https://www.home-assistant.io/)
[![Requires ha-bosch-ebike](https://img.shields.io/badge/Requires-ha--bosch--ebike-41BDF5.svg)](https://github.com/Xunil99/ha-bosch-ebike)
[![Open your Home Assistant instance and open this repository in the Marketplace.](https://my.home-assistant.io/badges/marketplace_repository.svg)](https://my.home-assistant.io/redirect/marketplace_repository/?owner=JulianHock&repository=ebike-cards&category=plugin)

Dashboard cards for Home Assistant that display the data of the [ha-bosch-ebike](https://github.com/Xunil99/ha-bosch-ebike) integration.

| Card | Type | Data source |
|---|---|---|
| Ride statistics | `custom:ebike-stats-pro-card` | all rides (websocket) |
| Comparison | `custom:ebike-compare-card` | total sensors per bike |
| Tricks | `custom:ebike-tricks-card` | all rides (websocket) |
| Last ride | `custom:ebike-last-ride-card` | "last ride" sensors |
| Ride selection | `custom:ebike-ride-select-card` | all rides (websocket) |
| Records | `custom:ebike-records-card` | all rides (websocket) |
| Annual goal | `custom:ebike-goal-card` | all rides (websocket) |

All cards live in a single file (`ebike-cards.js`), so HA only needs one resource.

The screenshots under [Configuration](#configuration) come from the demo and show made-up data. The card labels are in German.

## Installation via the Marketplace

Since Home Assistant 2026.11, the Marketplace is built in and replaces HACS.

The cards need the [ha-bosch-ebike](https://github.com/Xunil99/ha-bosch-ebike) integration. If it isn't installed yet, set it up first:

[![Open your Home Assistant instance and open the ha-bosch-ebike integration in the Marketplace.](https://my.home-assistant.io/badges/marketplace_repository.svg)](https://my.home-assistant.io/redirect/marketplace_repository/?owner=Xunil99&repository=ha-bosch-ebike&category=integration)

Then install the cards:

[![Open your Home Assistant instance and open this repository in the Marketplace.](https://my.home-assistant.io/badges/marketplace_repository.svg)](https://my.home-assistant.io/redirect/marketplace_repository/?owner=JulianHock&repository=ebike-cards&category=plugin)

The button opens the repository directly in your Marketplace. Without it:

1. **Settings → Marketplace → Add from link**
   GitHub link: `https://github.com/JulianHock/ebike-cards`, then **Add**
   (if asked for a type, choose **Dashboard**)
2. Open "eBike Cards" and select **Install**
3. Reload the browser (clear the cache if needed)

Adding a custom repository requires a GitHub connection, which the Marketplace asks for the first time.

The Marketplace adds the resource `/local/community/ebike-cards/ebike-cards.js` itself if your dashboards are managed in UI mode.
In YAML mode, add it yourself (the install dialog shows the exact path):

```yaml
lovelace:
  resources:
    - url: /local/community/ebike-cards/ebike-cards.js
      type: module
```

Updates appear in HA under **Settings → Updates** as soon as a new release is published.

### Alternative: HACS (Home Assistant 2026.10 and older)

1. HACS → ⋮ → **Custom repositories**
   Repository: `https://github.com/JulianHock/ebike-cards`, type: **Dashboard**
2. Search for "eBike Cards" in HACS and **download** it
3. Reload the browser

In YAML mode, the resource is `/hacsfiles/ebike-cards/ebike-cards.js`.
When you update to 2026.11, HACS migrates to the Marketplace automatically and the cards stay installed.
The old `/hacsfiles/` path keeps working; for YAML resources, a repair suggests switching to `/local/community/`.

### Switching from a manually copied file

If the cards used to be a single file in `/config/www/`:

1. Under **Settings → Dashboards → ⋮ → Resources**, delete the old resource (`/local/….js`)
2. Remove the old file from `/config/www/`
3. Reload the browser

Your card configurations stay as they are, because the card types are the same.

## Configuration

These options apply to all cards:

| Option | Meaning |
|---|---|
| `title` | Card heading |
| `background` | Custom background (any CSS color, variable or gradient; `url()` is ignored); defaults to the theme's card background |

The cards remember the selected tabs per browser (localStorage, the key includes the title).

Each entry in a card's `bikes` list identifies a bike in one of two ways:

- `bike`: the device name or the bike ID from the integration, e.g. `bike: E-Bike Trekking` (recommended)
- `prefix`: the entity prefix of its sensors, e.g. `e_bike_trekking` for `sensor.e_bike_trekking_kilometerstand`

If two bikes have the same device name (e.g. the same motor and not renamed), use the bike ID or `prefix`.
If you rename a device later, update `bike` as well.

The cards find the sensors through the device registry (`translation_key`).
The language of the entity IDs doesn't matter, and you can rename them.
For the battery values (`cycles`, `energy`, `efficiency`) and the highest point of the last ride, this needs ha-bosch-ebike 1.19.65 or newer.
With older versions, these entity IDs must keep their English ending (e.g. `_charge_cycles`).

Below the columns of the comparison, long names wrap onto two lines and are only truncated after that.
If there still isn't enough room, `short_name` sets a shorter name for the axis; the tooltip keeps showing `name`:

```yaml
  - { name: Erika E-MTB, short_name: Erika MTB, bike: E-MTB Erika }
```

### Ride statistics

<table><tr><td width="360">

![Ride statistics](docs/images/fahrstatistik.png)

</td></tr></table>

```yaml
type: custom:ebike-stats-pro-card
title: Fahrstatistik
period: month            # week | month | year
metric: distance         # initial tab
metrics: [distance, elevation, rides, duration, speed, calories]
stacked: true
show_totals: true        # false hides all totals across bikes
legend_values: false     # true shows each bike's total for the period in the legend
height: 220
hide_unassigned: false   # hide rides that aren't assigned to a bike
names:  { "E-Bike Trekking": Trekking }
colors: { "E-Bike Trekking": "#03a9f4" }
order: [Trekking, MTB]
refresh_minutes: 15
```

The bikes come from the integration automatically. `names`, `colors` and `order` refer to a bike's label or ID.

### Comparison

<table><tr><td width="360">

![Comparison](docs/images/vergleich.png)

</td></tr></table>

```yaml
type: custom:ebike-compare-card
title: Vergleich
bikes:
  - { name: Trekking, bike: E-Bike Trekking, color: "#03a9f4" }
  - { name: MTB, bike: E-Bike MTB }
metrics: [odometer, elevation, rides, duration, cycles, calories, energy, efficiency]
layout: vertical         # vertical | horizontal
height: 170
sort: true
show_scale: true
show_leader: false       # trophy for the leader
suffixes:                # optional: own entity ID endings, see below
  cycles: "*_charge_cycles"
```

- `energy` is the energy delivered by the battery in kWh.
- `efficiency` is the consumption in Wh/km; the most economical value comes first.
- A bike with several batteries shows their sum for `cycles` and `energy`.
- `suffixes` is only needed with ha-bosch-ebike older than 1.19.65 and renamed battery sensors. A suffix takes precedence over the `translation_key`; without `*` it needs `prefix`.
- A suffix with `*` (e.g. `*_charge_cycles`) adds up all matching sensors of a bike.

### Tricks

<table><tr><td width="360">

![Tricks](docs/images/tricks.png)

</td></tr></table>

```yaml
type: custom:ebike-tricks-card
title: Tricks
bikes:
  - { name: MTB, bike: E-Bike MTB }
trick: jump              # initial tab
tricks: [jump, wheelie, manual, stoppie]
sort: true
show_leader: false
```

The card adds up wheelies, manuals, stoppies and jumps across all rides. Each record shows the ride in which it was set.

### Last ride

<table><tr><td width="360">

![Last ride](docs/images/letzte-tour.png)

</td></tr></table>

```yaml
type: custom:ebike-last-ride-card
title: Letzte Tour
bikes:
  - { name: Trekking, bike: E-Bike Trekking }
  - { name: MTB, bike: E-Bike MTB }
bike: Trekking           # initial bike (its name); otherwise the one with the latest ride
show_title: true
fields: [duration, pauses, avg_speed, max_speed, up, down, max_alt,
         avg_power, max_power, avg_cadence, max_cadence, calories, tricks]
```

If the sensors aren't in the device registry, the card falls back to the usual German entity IDs (needs `prefix`).

### Ride selection

```yaml
type: custom:ebike-ride-select-card
title: Tourauswahl
bikes:
  - { name: Trekking, bike: E-Bike Trekking }
  - { name: MTB, bike: E-Bike MTB }
bike: Trekking           # initial bike (its name); otherwise the one with the latest ride
fields: [duration, pauses, avg_speed, max_speed, up, down, max_alt,
         avg_power, max_power, avg_cadence, max_cadence, calories, tricks]
refresh_minutes: 15
```

Like "Last ride", but you can pick any ride of the selected bike.
First pick the year in the small drop-down on the left, then the ride in the drop-down next to it: it lists that year's rides, newest first, grouped by month (with the number of rides and km per month).
The arrows step to the previous or next ride, also across the turn of the year.
Each ride in the drop-down shows its weekday, date and title; date and title aren't repeated above the values.
The card remembers the bike per browser and starts with the latest ride.
The ride list doesn't include the highest point, power and cadence. The card loads them for the selected ride from its track points (`bosch_ebike/get_track`), so they appear a moment later.
The averages only count points with pedaling and can differ slightly from the Bosch app.

### Records

<table><tr><td width="360">

![Records](docs/images/bestwerte.png)

</td></tr></table>

```yaml
type: custom:ebike-records-card
title: Bestwerte
bikes:
  - { name: Trekking, bike: E-Bike Trekking }
  - { name: MTB, bike: E-Bike MTB }
bike: Trekking           # initial bike (its name)
records: [distance, up, ride_time, max_speed, avg_speed, calories]
min_avg_km: 5            # minimum distance for "Schnellster Schnitt" (fastest average)
```

### Annual goal

<table><tr><td width="360">

![Annual goal](docs/images/jahresziel.png)

</td></tr></table>

```yaml
type: custom:ebike-goal-card
title: Jahresziel
bikes:
  - { name: Trekking, bike: E-Bike Trekking, goal: 3000 }   # goal: target in km for the current year
  - { name: MTB, bike: E-Bike MTB, goal: 1500 }
bike: Trekking           # initial bike (its name); otherwise the first one
show_last_year: true     # previous year as a gray line
height: 180
```

Each bike has its own goal. You pick the bike at the top, and the card remembers the selection per browser.
The chart shows the year's cumulative kilometers against the goal line (a steady pace until December 31) and the previous year.
Below it: the share of the goal, how far ahead of or behind plan you are, and the km per week needed for the rest of the year.

## Development

```
src/
  index.js              entry point, imports all cards
  cards/*.js            one file per card
  shared/*.js           shared helpers (formatting, time, websocket, registration)
demo/                   test page with made-up data
build.mjs               esbuild → dist/ebike-cards.js
```

```bash
npm install
npm run build   # build dist/ebike-cards.js
npm run demo    # demo at http://localhost:8000/demo/, rebuilds on changes
npm test        # unit tests
```

### Branches and releases

- `main` holds the published state. Final releases are only made from here; the release workflow rejects other tags.
- `dev` is the working state. CI builds every push and checks the repository structure (`hacs.json`, which the Marketplace requires too).

To make a release:

```bash
git checkout main && git merge dev
npm version minor            # or patch / major: sets the version, commit and tag
git push --follow-tags
```

The tag triggers the release workflow. It builds `ebike-cards.js` and attaches the file to a GitHub release.
The Marketplace (or HACS) then offers the update.

For a test version on `dev`:

```bash
npm version prerelease --preid beta   # e.g. v1.16.0-beta.0
git push --follow-tags
```

This creates a pre-release. To see it in the Marketplace, go to **Settings → Devices & services → Marketplace**, open the eBike Cards device, enable the **Pre-release** entity (disabled by default) and turn it on.
Alternatively, use **⋮ → Install another version** on the repository page. In HACS, enable "Show beta versions" for the repository.

## License

[MIT](LICENSE)
