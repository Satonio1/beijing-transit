---
name: beijing-transit
description: Beijing subway assistant guide for planned next-train queries, last-train risk, subway-only routing, and lightweight travel decisions based on structured official public timetable data.
---

# Beijing Transit

Read before use:

- `README.md`

## What this repository contains

- runtime code under `src/`
- structured timetable JSON data
- a query index
- minimal maintenance scripts

## Hard Rules

- Output subway as the primary plan only. Do not present bus segments as the main answer.
- `next-train` must use structured **official planned timetable** data only. Do not estimate from headways or intuition.
- Always state that planned timetable data is **not realtime arrival data**.
- Temporary delays, skip-stop operations, crowd control, closures, and emergency changes may not be reflected.
- Only use timetable entries with `validation_status=auto_validated` for user-facing answers. `needs_review` is QA-only.
- If there is no structured official planned timetable for a line / station / direction, do not invent a next-train answer.

## Disclaimer

- This guide is for travel assistance and reference only.
- Data may be incomplete, outdated, mismatched, or incorrectly structured.
- For time-sensitive trips, users should confirm with station signage, staff, official operator notices, or official apps/websites.

## Commands

```bash
node src/cli.mjs next-train --line 10 --station 亮马桥 --to 三元桥 --now 21:36
node src/cli.mjs last-train --line 10 --station 巴沟 --direction 内环 --now 22:20
node src/cli.mjs route --from 北京西站 --to 奥林匹克森林公园 --now 09:30
node src/cli.mjs decide --line 10 --from 巴沟 --direction 内环 --question "go now or wait" --now 21:40
```

## Maintenance

```bash
node scripts/build-structured-timetable-index.mjs
node scripts/validate-release-data.mjs
```
