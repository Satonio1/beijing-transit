# Beijing Transit

[中文说明](./README.zh-CN.md)

Beijing Transit is a reusable Node.js CLI and public data bundle for Beijing subway travel assistance. It uses **official public planned timetable data** to answer planned next-train and last-train questions, and it can use Amap WebService for address/POI route planning when configured.

Public repository: https://github.com/Satonio1/beijing-transit

> This project returns **planned timetable data**, not realtime arrival data.

## What it can do

### Works offline with bundled data

- Query the planned next train for a Beijing subway station and direction.
- Query first/last-train information and last-train risk.
- Give lightweight subway travel decisions such as whether to go now or wait.
- Use the bundled structured timetable JSON and query index.

### Requires Amap API key

Address / POI route planning requires an Amap WebService key (`AMAP_KEY`). Without it, these commands are unavailable:

- `route --from <place> --to <place>`
- address / POI geocoding
- subway-only route planning between public places
- Amap fallback navigation links

The core timetable commands (`next-train`, `last-train`, `decide`) still work without `AMAP_KEY`.

## Repository layout

- `SKILL.md` — assistant usage guide
- `src/` — runtime code
- `data/metro/structured-timetables/` — structured timetable JSON
- `data/metro/structured-timetable-index.json` — query index
- `data/metro/metro-cache.json` — station / line / first-last-train cache
- `data/metro/validation-report.json` — validation snapshot
- `scripts/build-structured-timetable-index.mjs`
- `scripts/validate-release-data.mjs`
- `.env.example`

## Quick start

Requirements: Node.js `>=20`.

```bash
npm run build:index
npm run validate:data
```

## Usage examples

### Planned next train

```bash
node src/cli.mjs next-train --line 10 --station 亮马桥 --to 三元桥 --now 21:36
```

### Last-train risk

```bash
node src/cli.mjs last-train --line 10 --station 巴沟 --direction 内环 --now 22:20
```

### Decision helper

```bash
node src/cli.mjs decide --line 10 --from 巴沟 --direction 内环 --question "go now or wait" --now 21:40
```

### Subway-only route planning with public places

First configure Amap:

```bash
cp .env.example .env
# fill AMAP_KEY in .env
```

Then run:

```bash
node src/cli.mjs route --from 北京西站 --to 奥林匹克森林公园 --now 09:30
node src/cli.mjs route --from 北京南站 --to 国家图书馆 --now 14:00
```

## Amap configuration

Create `.env` from `.env.example`:

```bash
cp .env.example .env
```

Then set:

```text
AMAP_KEY=your_amap_webservice_key
```

The key is only used locally. Do not commit `.env`.

## Disclaimer

- This repository is for **travel assistance and reference**, not for safety-critical or operational decisions.
- Data may be incomplete, outdated, mismatched, or incorrectly structured.
- Planned timetable data is **not** realtime arrival data.
- Temporary delays, skip-stop operations, crowd control, closures, or emergency changes may not be reflected here.
- For time-sensitive trips, always confirm with station signage, staff, official operator notices, or official apps/websites.
- The project is provided **as is**, with no guarantee of accuracy, completeness, or fitness for a particular purpose.

## Data sources

Primary public sources used by this project:

- Beijing Subway public pages: `bjsubway.com`
- Beijing MTR public pages / APIs: `mtr.bj.cn`
- Beijing Municipal Rail Operation Administration public pages: `bjmoa.cn`
- Amap WebService: used only for POI geocoding / subway-only routing / fallback links when configured

Notes:

- `next-train` uses structured **official planned timetable** data only.
- Amap is **not** used as a realtime subway-arrival source.
- If no structured official planned timetable exists for a line / station / direction, the project should not invent a next-train answer.

## Validation

```bash
npm run build:index
npm run validate:data
```

Validation checks that structured JSON parses correctly, the query index matches the bundled files, required files exist, and the validation report is consistent with the data.

## License / source notice

This repository distributes **structured results**, not the raw timetable images by default.

When reusing or redistributing data, keep source attribution and follow the terms of the original public sources.
