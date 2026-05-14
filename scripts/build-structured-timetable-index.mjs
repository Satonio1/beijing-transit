#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const STRUCTURED_DIR = path.join(PROJECT_ROOT, 'data', 'metro', 'structured-timetables');
const VALIDATION_PATH = path.join(PROJECT_ROOT, 'data', 'metro', 'validation-report.json');
const OUTPUT_PATH = path.join(PROJECT_ROOT, 'data', 'metro', 'structured-timetable-index.json');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, '').trim();
}

function normalizeLine(value) {
  const raw = normalizeText(value);
  if (/^\d+$/u.test(raw)) return `${raw}号线`;
  if (/^\d+号$/u.test(raw)) return `${raw}线`;
  return raw;
}

function keyFor({ line, station, service_day }) {
  return [normalizeLine(line), normalizeText(station), service_day].join('|');
}

function officialScheduleDate(sourceUrl) {
  const match = String(sourceUrl ?? '').match(/\/(20\d{2}-\d{2}-\d{2})\//);
  return match?.[1] ?? null;
}

function scheduleVariant({ service_day, source_url }) {
  const raw = decodeURIComponent(String(source_url ?? ''));
  if (/工作日/u.test(raw)) return 'weekday_regular';
  if (/双休日|周末/u.test(raw)) return 'weekend_regular';
  if (/节假日/u.test(raw)) return 'holiday_special';
  if (/暑|夏/u.test(raw)) return 'summer_special';
  if (/寒|冬/u.test(raw)) return 'winter_special';
  if (/临时|延长|缩短|调整/u.test(raw)) return 'temporary_special';
  return service_day ? `${service_day}_regular` : 'unknown';
}

const validation = fs.existsSync(VALIDATION_PATH) ? readJson(VALIDATION_PATH) : null;
const validationByFile = new Map();
for (const item of validation?.results ?? validation?.files ?? []) {
  const file = item.file ?? item.path ?? item.structured_path;
  if (file) validationByFile.set(path.basename(file), item);
}

const entries = [];
for (const name of fs.readdirSync(STRUCTURED_DIR).filter((file) => file.endsWith('.json')).sort()) {
  const absolute = path.join(STRUCTURED_DIR, name);
  const timetable = readJson(absolute);
  const validationItem = validationByFile.get(name);
  entries.push({
    key: keyFor(timetable),
    line: timetable.line,
    station: timetable.station,
    direction: timetable.direction,
    service_day: timetable.service_day,
    times: timetable.times ?? [],
    confidence: timetable.confidence ?? 'medium',
    source_url: timetable.source_url ?? null,
    source_image: timetable.source_image ?? null,
    official_schedule_date: timetable.official_schedule_date ?? officialScheduleDate(timetable.source_url),
    schedule_variant: timetable.schedule_variant ?? scheduleVariant(timetable),
    structured_path: path.relative(PROJECT_ROOT, absolute),
    validation_status: validationItem?.status ?? null,
    validation_errors: validationItem?.errors ?? [],
    validation_warnings: validationItem?.warnings ?? [],
  });
}

const byKey = {};
for (const entry of entries) {
  byKey[entry.key] ??= [];
  byKey[entry.key].push(entry);
}

const output = {
  generated_at: new Date().toISOString(),
  schema_version: 'metro_timetable_index.v1',
  entry_count: entries.length,
  validation: validation ? {
    ok: validation.ok,
    file_count: validation.file_count,
    error_count: validation.error_count,
    warning_count: validation.warning_count,
    review_count: validation.review_count,
    status_counts: validation.status_counts,
  } : null,
  by_key: byKey,
};

fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ output: path.relative(PROJECT_ROOT, OUTPUT_PATH), entry_count: entries.length }, null, 2));
