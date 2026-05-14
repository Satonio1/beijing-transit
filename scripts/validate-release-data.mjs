#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'data', 'metro');
const STRUCTURED_DIR = path.join(DATA_DIR, 'structured-timetables');
const INDEX_PATH = path.join(DATA_DIR, 'structured-timetable-index.json');
const REPORT_PATH = path.join(DATA_DIR, 'validation-report.json');
const CACHE_PATH = path.join(DATA_DIR, 'metro-cache.json');

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

const errors = [];
const warnings = [];
for (const required of [STRUCTURED_DIR, INDEX_PATH, REPORT_PATH, CACHE_PATH]) {
  if (!fs.existsSync(required)) errors.push(`missing required path: ${path.relative(PROJECT_ROOT, required)}`);
}
if (errors.length) {
  console.log(JSON.stringify({ ok: false, errors, warnings }, null, 2));
  process.exit(1);
}

const index = readJson(INDEX_PATH);
const report = readJson(REPORT_PATH);
const cache = readJson(CACHE_PATH);
const files = fs.readdirSync(STRUCTURED_DIR).filter((name) => name.endsWith('.json')).sort();

if (!Array.isArray(cache.lines) || cache.lines.length === 0) errors.push('metro-cache.json has no lines');
if (report.file_count !== files.length) errors.push(`validation-report file_count mismatch: ${report.file_count} != ${files.length}`);
if (index.entry_count !== files.length) errors.push(`structured-timetable-index entry_count mismatch: ${index.entry_count} != ${files.length}`);

const indexedPaths = new Set();
const statusCounts = {};
for (const [key, entries] of Object.entries(index.by_key ?? {})) {
  if (!Array.isArray(entries) || entries.length === 0) {
    errors.push(`index key has no entries: ${key}`);
    continue;
  }
  for (const entry of entries) {
    if (key !== keyFor(entry)) errors.push(`index key mismatch for ${entry.structured_path}: ${key}`);
    if (!entry.structured_path) errors.push(`missing structured_path under key ${key}`);
    else indexedPaths.add(entry.structured_path);
    const status = entry.validation_status ?? 'missing';
    statusCounts[status] = (statusCounts[status] ?? 0) + 1;
  }
}

for (const file of files) {
  const rel = `data/metro/structured-timetables/${file}`;
  if (!indexedPaths.has(rel)) errors.push(`not indexed: ${rel}`);
  try {
    const obj = readJson(path.join(STRUCTURED_DIR, file));
    for (const key of ['schema_version', 'line', 'station', 'direction', 'service_day', 'source_url', 'times']) {
      if (obj[key] == null) errors.push(`${file}: missing ${key}`);
    }
    if (obj.schema_version !== 'metro_timetable.v1') warnings.push(`${file}: unexpected schema_version ${obj.schema_version}`);
    if (!Array.isArray(obj.times) || obj.times.length === 0) errors.push(`${file}: empty times`);
  } catch (error) {
    errors.push(`${file}: json parse failed: ${error.message}`);
  }
}

const summary = {
  ok: errors.length === 0,
  file_count: files.length,
  index_entry_count: index.entry_count,
  validation_ok: report.ok,
  validation_error_count: report.error_count,
  validation_warning_count: report.warning_count,
  validation_review_count: report.review_count,
  indexed_status_counts: statusCounts,
  errors,
  warnings,
};
console.log(JSON.stringify(summary, null, 2));
process.exit(summary.ok ? 0 : 1);
