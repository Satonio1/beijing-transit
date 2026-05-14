import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIDENCE, SOURCE_TYPES, okResponse, errorResponse } from './schema.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_CACHE = path.join(PROJECT_ROOT, 'data', 'metro', 'metro-cache.json');
const DEFAULT_CONFIG = path.join(PROJECT_ROOT, 'config', 'routes.json');
const DEFAULT_TIMETABLE_INDEX = path.join(PROJECT_ROOT, 'data', 'metro', 'structured-timetable-index.json');
let timetableIndexCache = null;

function normalizeText(value) {
  return String(value ?? '')
    .replace(/\s+/g, '')
    .replace(/号线$/u, '号线')
    .replace(/站$/u, '')
    .trim();
}

function normalizeStationKey(value) {
  return normalizeText(value)
    .replace(/[（(].*?[）)]/gu, '')
    .replace(/方向$/u, '')
    .replace(/开往/u, '');
}

function normalizeLine(value) {
  const raw = normalizeText(value);
  if (!raw) return raw;
  if (/^\d+$/u.test(raw)) return `${raw}号线`;
  if (/^\d+号$/u.test(raw)) return `${raw}线`;
  return raw;
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function loadMetroCache(cachePath = DEFAULT_CACHE) {
  const cache = readJsonIfExists(cachePath);
  if (!cache) {
    throw new Error(`Metro cache not found: ${cachePath}. Run scripts/refresh-metro-data.mjs first.`);
  }
  return cache;
}

export function loadUserConfig(configPath = DEFAULT_CONFIG) {
  return readJsonIfExists(configPath) ?? { frequent_routes: {}, preferences: {} };
}

export function loadStructuredTimetableIndex(indexPath = DEFAULT_TIMETABLE_INDEX) {
  const mtimeMs = fs.existsSync(indexPath) ? fs.statSync(indexPath).mtimeMs : 0;
  if (timetableIndexCache?.path === indexPath && timetableIndexCache.mtimeMs === mtimeMs) return timetableIndexCache.index;
  const index = readJsonIfExists(indexPath) ?? { by_key: {}, entry_count: 0 };
  timetableIndexCache = { path: indexPath, mtimeMs, index };
  return index;
}

export function resolveLine(cache, lineInput) {
  const normalized = normalizeLine(lineInput);
  const line = cache.lines.find((item) => {
    const names = [item.name, ...(item.aliases ?? [])].map(normalizeLine);
    if (names.includes(normalized)) return true;
    if (/^\d+号线$/u.test(normalized) && names.some((name) => name.startsWith(normalized))) return true;
    if (normalized === '1号线' && names.includes('1号线八通线')) return true;
    return false;
  });
  return line ?? null;
}

export function resolveStation(line, stationInput) {
  const normalized = normalizeText(stationInput);
  return line.stations.find((station) => normalizeText(station.name) === normalized) ?? null;
}

function stationIndex(line, stationInput) {
  const normalized = normalizeStationKey(stationInput);
  return line.stations.findIndex((station) => normalizeStationKey(station.name) === normalized);
}

function directionTerminalIndex(line, direction) {
  const direct = stationIndex(line, direction?.terminal);
  if (direct >= 0) return direct;
  const directionName = normalizeStationKey(direction?.name);
  const candidates = line.stations
    .map((station, index) => ({ index, key: normalizeStationKey(station.name) }))
    .filter((item) => item.key && directionName.includes(item.key));
  if (candidates.length === 0) return -1;
  const terminalKey = normalizeStationKey(direction?.terminal);
  const terminalCandidate = candidates.find((item) => terminalKey && terminalKey.includes(item.key));
  return (terminalCandidate ?? candidates.at(-1)).index;
}

function directionForTargetStation(line, station, target) {
  const fromIndex = stationIndex(line, station.name);
  const toIndex = stationIndex(line, target);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return null;
  const targetSign = Math.sign(toIndex - fromIndex);
  return station.directions.find((item) => {
    const terminalIndex = directionTerminalIndex(line, item);
    return terminalIndex >= 0 && terminalIndex !== fromIndex && Math.sign(terminalIndex - fromIndex) === targetSign;
  }) ?? null;
}

function expectedNextStationForDirection(line, station, direction) {
  const fromIndex = stationIndex(line, station.name);
  const terminalIndex = directionTerminalIndex(line, direction);
  if (fromIndex < 0 || terminalIndex < 0 || terminalIndex === fromIndex) return null;
  const nextIndex = fromIndex + Math.sign(terminalIndex - fromIndex);
  return line.stations[nextIndex]?.name ?? null;
}

function directionMatches(direction, target, mode = 'direction') {
  const needle = normalizeStationKey(target);
  if (!needle) return true;
  if (/内环|外环/u.test(needle) && normalizeText(direction.name).includes(needle)) return true;
  if (normalizeStationKey(direction.terminal).includes(needle)) return true;
  if (direction.via?.some((value) => normalizeStationKey(value).includes(needle))) return true;
  // Avoid matching arbitrary station names against the full direction label:
  // labels like "清华东路西口—俸伯" contain both endpoints, and matching the
  // wrong endpoint can select the opposite direction.
  return mode !== 'to' && !/[一-龥]/u.test(needle) && normalizeText(direction.name).includes(needle);
}

export function resolveDirection(station, { direction, to, line } = {}) {
  if (!direction && !to) return station.directions.length === 1 ? station.directions[0] : null;
  if (line && to) return directionForTargetStation(line, station, to) ?? station.directions.find((item) => directionMatches(item, to, 'to')) ?? null;
  if (line && direction && !/内环|外环/u.test(String(direction))) return directionForTargetStation(line, station, direction) ?? station.directions.find((item) => directionMatches(item, direction, 'direction')) ?? null;
  if (direction) return station.directions.find((item) => directionMatches(item, direction, 'direction')) ?? null;
  return station.directions.find((item) => directionMatches(item, to, 'to')) ?? null;
}

function parseClockToMinutes(value) {
  if (!value || value === '——') return null;
  const match = String(value).match(/^(\d{1,2}):(\d{2})$/u);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour * 60 + minute;
}

function minutesToClock(minutes) {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  return `${hour}:${String(minute).padStart(2, '0')}`;
}

function parseNow(now = new Date()) {
  const date = parseNowDate(now);
  return date.getHours() * 60 + date.getMinutes();
}

function parseNowDate(now = new Date()) {
  if (typeof now === 'string') {
    const match = now.match(/^(\d{1,2}):(\d{2})$/u);
    if (match) {
      const date = new Date();
      date.setHours(Number(match[1]), Number(match[2]), 0, 0);
      return date;
    }
    const date = new Date(now);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return now instanceof Date ? now : new Date();
}

function serviceDayForNow(now) {
  const day = parseNowDate(now).getDay();
  return day === 0 || day === 6 ? 'weekend' : 'weekday';
}

function minutesUntil(target, now) {
  if (target == null) return null;
  let adjusted = target;
  // Last trains shortly after midnight belong to the current service day once daytime service has started.
  if (target < 180 && now >= 180) adjusted += 1440;
  return adjusted - now;
}

function pickLastTrain(direction) {
  const candidates = direction.last_trains ?? [];
  if (candidates.length === 0) return null;
  const full = candidates.find((item) => /全程|末车$/u.test(item.label)) ?? candidates[0];
  return full;
}

function structuredKey(line, station, serviceDay) {
  return [normalizeLine(line.name ?? line), normalizeText(station.name ?? station), serviceDay].join('|');
}

function structuredKeyCandidates(line, station, serviceDay) {
  const lineKey = normalizeLine(line.name ?? line);
  const stationRaw = normalizeText(station.name ?? station);
  const candidates = [stationRaw];
  if (stationRaw && !stationRaw.endsWith('站')) candidates.push(`${stationRaw}站`);
  return Array.from(new Set(candidates)).map((stationKey) => [lineKey, stationKey, serviceDay].join('|'));
}

function timetableDirectionTargets(timetable, station = null) {
  const raw = String(timetable?.direction ?? '');
  const stationKey = station ? normalizeStationKey(station.name ?? station) : normalizeStationKey(timetable?.station);
  const withoutSuffix = raw.replace(/方向$/u, '');
  const parts = withoutSuffix.split(/[-—－]/u).map(normalizeStationKey).filter(Boolean);
  if (parts.length >= 2) return parts.filter((part) => part !== stationKey);
  const single = normalizeStationKey(withoutSuffix);
  return single && single !== stationKey ? [single] : [];
}

function targetAlternatives(value) {
  const normalized = normalizeStationKey(value);
  return normalized
    .split(/[、,，/／]+/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function targetMatchesStation(target, stationName) {
  const targetKeys = targetAlternatives(target);
  const stationKeys = targetAlternatives(stationName);
  return targetKeys.some((targetKey) => stationKeys.some((stationKey) => targetKey === stationKey || targetKey.includes(stationKey) || stationKey.includes(targetKey)));
}

function timetableMatchesDirection(timetable, direction, line = null, station = null) {
  if (!direction) return true;
  const rawTimetableDirection = String(timetable.direction ?? '').replace(/\s+/g, '').trim();
  const targets = timetableDirectionTargets(timetable, station);
  const terminal = normalizeStationKey(direction.terminal);
  const directionName = normalizeStationKey(direction.name);
  if (terminal && targets.some((target) => targetMatchesStation(target, terminal))) return true;
  const expectedNext = line && station ? expectedNextStationForDirection(line, station, direction) : null;
  if (expectedNext && targets.some((target) => targetMatchesStation(target, expectedNext))) return true;
  if (directionName.includes('内环') && /苏州街|宋家庄|车道沟/u.test(rawTimetableDirection)) return true;
  if (directionName.includes('外环') && /火器营|车道沟|宋家庄|巴沟/u.test(rawTimetableDirection)) return true;
  return (direction.via ?? []).some((value) => targets.some((target) => targetMatchesStation(target, value)));
}

function isQueryableTimetable(timetable) {
  // Review candidates are kept on disk for QA, but should not answer user queries.
  return !timetable.validation_status || timetable.validation_status === 'auto_validated';
}

function findStructuredTimetable(cache, line, station, direction, now) {
  const serviceDay = serviceDayForNow(now);
  const index = loadStructuredTimetableIndex();
  const indexed = structuredKeyCandidates(line, station, serviceDay).flatMap((key) => index.by_key?.[key] ?? []);
  const indexedMatch = indexed.find((item) => isQueryableTimetable(item) && timetableMatchesDirection(item, direction, line, station));
  if (indexedMatch) return { ...indexedMatch, service_day: indexedMatch.service_day ?? serviceDay, index_generated_at: index.generated_at };

  const timetables = cache.structured_timetables ?? [];
  return timetables.find((item) => isQueryableTimetable(item)
    && normalizeLine(item.line) === normalizeLine(line.name)
    && normalizeText(item.station) === normalizeText(station.name)
    && item.service_day === serviceDay
    && timetableMatchesDirection(item, direction, line, station));
}

function pickBestTimetable(candidates, now) {
  if (candidates.length <= 1) return candidates[0] ?? null;
  const nowMinutes = parseNow(now);
  return candidates
    .map((item) => ({ item, planned: nextPlannedTime(item, nowMinutes) }))
    .sort((a, b) => {
      if (a.planned && b.planned) return a.planned.adjusted - b.planned.adjusted;
      if (a.planned) return -1;
      if (b.planned) return 1;
      return String(a.item.structured_path ?? '').localeCompare(String(b.item.structured_path ?? ''));
    })[0]?.item ?? candidates[0];
}

function findStructuredTimetableByQuery({ line: lineInput, station: stationInput, to, direction, now }) {
  const serviceDay = serviceDayForNow(now);
  const index = loadStructuredTimetableIndex();
  const lineKey = normalizeLine(lineInput);
  const stationKey = normalizeStationKey(stationInput);
  const allEntries = Object.values(index.by_key ?? {})
    .flat()
    .filter((item) => normalizeLine(item.line) === lineKey
      && normalizeStationKey(item.station) === stationKey
      && item.service_day === serviceDay);
  const entries = allEntries.filter(isQueryableTimetable);
  if (allEntries.length === 0) return { status: 'missing', entries: [] };

  const target = normalizeStationKey(to ?? direction);
  if (target) {
    const allMatched = allEntries.filter((item) => timetableDirectionTargets(item, stationInput).some((entryTarget) => targetMatchesStation(entryTarget, target)));
    const matched = allMatched.filter(isQueryableTimetable);
    if (matched.length >= 1) {
      const selected = pickBestTimetable(matched, now);
      return { status: 'matched', timetable: { ...selected, service_day: selected.service_day ?? serviceDay, index_generated_at: index.generated_at }, entries: matched };
    }
    if (allMatched.length > 0) return { status: 'unavailable', entries: allMatched };
    return { status: 'no_match', entries };
  }
  if (entries.length >= 1) {
    const selected = pickBestTimetable(entries, now);
    return { status: 'matched', timetable: { ...selected, service_day: selected.service_day ?? serviceDay, index_generated_at: index.generated_at }, entries };
  }
  return { status: 'missing', entries };
}

function structuredFallbackWarnings(entries) {
  return Array.from(new Set((entries ?? []).map((item) => item.direction).filter(Boolean)));
}

function nextTrainFromStructuredQuery({ line: lineInput, station: stationInput, to, direction, now, cache }) {
  const match = findStructuredTimetableByQuery({ line: lineInput, station: stationInput, to, direction, now });
  if (match.status === 'missing' || match.status === 'no_match') return null;
  if (match.status === 'unavailable') {
    return errorResponse({
      mode: 'subway',
      query: { line: lineInput, station: stationInput, to, direction },
      code: 'TIMETABLE_NOT_VALIDATED',
      message: `Structured timetable exists but is not validated for ${lineInput} ${stationInput}.`,
      source: source(cache),
      warnings: structuredFallbackWarnings(match.entries),
    });
  }
  if (match.status === 'ambiguous') {
    return errorResponse({
      mode: 'subway',
      query: { line: lineInput, station: stationInput, to, direction },
      code: 'DIRECTION_AMBIGUOUS',
      message: `Direction is ambiguous for ${lineInput} ${stationInput}.`,
      source: source(cache),
      warnings: structuredFallbackWarnings(match.entries),
    });
  }

  const nowMinutes = parseNow(now);
  const timetable = match.timetable;
  const planned = nextPlannedTime(timetable, nowMinutes);
  const summary = planned
    ? `${timetable.line} ${timetable.station} ${timetable.direction}：下一班计划 ${planned.time}，约 ${planned.adjusted - nowMinutes} 分钟后。`
    : `${timetable.line} ${timetable.station} ${timetable.direction}：今日该方向后续暂无计划班次。`;
  return okResponse({
    mode: 'subway',
    query: { line: timetable.line ?? lineInput, station: timetable.station ?? stationInput, to, direction: timetable.direction, now: now ?? null },
    result: {
      summary,
      eta_minutes: planned ? [planned.adjusted - nowMinutes, planned.adjusted - nowMinutes] : null,
      next_planned_time: planned?.time ?? null,
      first_train_time: null,
      last_train: null,
      minutes_until_last: null,
      last_train_risk: 'unknown',
      action: planned ? 'normal' : 'handoff_or_taxi',
      timetable: {
        service_day: timetable.service_day ?? null,
        structured_path: timetable.structured_path ?? null,
        validation_status: timetable.validation_status ?? null,
        source_url: timetable.source_url ?? null,
      },
    },
    source: source(cache, SOURCE_TYPES.OFFICIAL_TIMETABLE, CONFIDENCE.HIGH),
    warnings: planned
      ? ['计划时刻不等于实时到站；临时调整以现场为准。']
      : ['只有结构化官方计划时刻，缺少首末班缓存；请结合现场或官方信息确认。'],
  });
}

function nextPlannedTime(timetable, nowMinutes) {
  if (!timetable?.times?.length) return null;
  const candidates = timetable.times
    .map((item) => typeof item === 'string' ? item : item.time)
    .map((time) => ({ time, minutes: parseClockToMinutes(time) }))
    .filter((item) => item.minutes != null)
    .map((item) => {
      let adjusted = item.minutes;
      if (adjusted < 180 && nowMinutes > 720) adjusted += 1440;
      return { ...item, adjusted };
    })
    .filter((item) => item.adjusted >= nowMinutes)
    .sort((a, b) => a.adjusted - b.adjusted);
  return candidates[0] ?? null;
}

function source(cache, type = SOURCE_TYPES.OFFICIAL_TIMETABLE, confidence = CONFIDENCE.HIGH) {
  return {
    type,
    name: '北京地铁官网首末车/站点公开页面缓存',
    confidence,
    freshness: cache.fetched_at ?? null,
    source_url: cache.source_url ?? 'https://www.bjsubway.com/station/smcsj/',
    limitations: [
      '非实时到站数据',
      '临时延误、跳停、限流不会反映',
      '只有结构化官方计划时刻表存在时才返回下一班时间',
    ],
  };
}

export function nextTrain({ line: lineInput, station: stationInput, to, direction, now, cache = loadMetroCache() }) {
  const hasStationDirectionQuery = Boolean(to) || (direction && !/内环|外环/u.test(String(direction)));
  if (hasStationDirectionQuery) {
    const directStructured = nextTrainFromStructuredQuery({ line: lineInput, station: stationInput, to, direction, now, cache });
    if (directStructured) return directStructured;
  }

  const line = resolveLine(cache, lineInput);
  if (!line) {
    const fallback = nextTrainFromStructuredQuery({ line: lineInput, station: stationInput, to, direction, now, cache });
    return fallback ?? errorResponse({ mode: 'subway', query: { line: lineInput, station: stationInput, to, direction }, code: 'LINE_NOT_FOUND', message: `Unknown line: ${lineInput}` });
  }
  const station = resolveStation(line, stationInput);
  if (!station) {
    const fallback = nextTrainFromStructuredQuery({ line: lineInput, station: stationInput, to, direction, now, cache });
    return fallback ?? errorResponse({ mode: 'subway', query: { line: lineInput, station: stationInput, to, direction }, code: 'STATION_NOT_FOUND', message: `Unknown station on ${line.name}: ${stationInput}` });
  }
  const resolvedDirection = resolveDirection(station, { direction, to, line });
  if (!resolvedDirection) {
    const fallback = (to || direction) ? nextTrainFromStructuredQuery({ line: lineInput, station: stationInput, to, direction, now, cache }) : null;
    return fallback ?? errorResponse({
      mode: 'subway',
      query: { line: lineInput, station: stationInput, to, direction },
      code: 'DIRECTION_AMBIGUOUS',
      message: `Direction is ambiguous for ${line.name} ${station.name}.`,
      source: source(cache),
      warnings: station.directions.map((item) => item.name),
    });
  }

  const nowMinutes = parseNow(now);
  const first = parseClockToMinutes(resolvedDirection.first_train_time);
  const lastTrain = pickLastTrain(resolvedDirection);
  const last = parseClockToMinutes(lastTrain?.time);
  const untilFirst = minutesUntil(first, nowMinutes);
  const untilLast = minutesUntil(last, nowMinutes);
  const withinService = untilFirst != null && untilLast != null && untilFirst <= 0 && untilLast >= 0;
  const risk = untilLast == null ? 'unknown' : untilLast < 0 ? 'ended' : untilLast <= 20 ? 'high' : untilLast <= 45 ? 'medium' : 'none';
  const timetable = findStructuredTimetable(cache, line, station, resolvedDirection, now);
  const planned = nextPlannedTime(timetable, nowMinutes);

  if (withinService && !planned) {
    return okResponse({
      mode: 'subway',
      query: { line: line.name, station: station.name, to, direction: resolvedDirection.name, now: now ?? null },
      result: {
        summary: `${line.name} ${station.name} ${resolvedDirection.name}：仍在运营，但该站该方向还没有结构化计划时刻表，不能给下一班时间。`,
        eta_minutes: null,
        next_planned_time: null,
        first_train_time: resolvedDirection.first_train_time,
        last_train: lastTrain,
        minutes_until_last: untilLast,
        last_train_risk: risk,
        action: risk === 'high' ? 'go_now' : 'need_structured_timetable',
        schedule_images: station.schedule_images ?? [],
      },
      source: source(cache, SOURCE_TYPES.OFFICIAL_TIMETABLE, CONFIDENCE.HIGH),
      warnings: ['未使用发车间隔估算；需要先结构化官方计划时刻表图片/页面后才能推下一班。'],
    });
  }

  const summary = planned
    ? `${line.name} ${station.name} ${resolvedDirection.name}：下一班计划 ${planned.time}，约 ${planned.adjusted - nowMinutes} 分钟后。`
    : untilFirst != null && untilFirst > 0
      ? `${line.name} ${station.name} ${resolvedDirection.name}：尚未开始运营，首班 ${resolvedDirection.first_train_time}。`
      : `${line.name} ${station.name} ${resolvedDirection.name}：该方向末班可能已过。`;

  return okResponse({
    mode: 'subway',
    query: { line: line.name, station: station.name, to, direction: resolvedDirection.name, now: now ?? null },
    result: {
      summary,
      eta_minutes: planned ? [planned.adjusted - nowMinutes, planned.adjusted - nowMinutes] : null,
      next_planned_time: planned?.time ?? null,
      first_train_time: resolvedDirection.first_train_time,
      last_train: lastTrain,
      minutes_until_last: untilLast,
      last_train_risk: risk,
      action: risk === 'ended' ? 'handoff_or_taxi' : risk === 'high' ? 'go_now' : 'normal',
      timetable: timetable ? {
        service_day: timetable.service_day ?? null,
        structured_path: timetable.structured_path ?? null,
        validation_status: timetable.validation_status ?? null,
        source_url: timetable.source_url ?? null,
      } : null,
    },
    source: source(cache, SOURCE_TYPES.OFFICIAL_TIMETABLE, CONFIDENCE.HIGH),
    warnings: planned ? ['计划时刻不等于实时到站；临时调整以现场为准。'] : [],
  });
}

export function lastTrain({ line: lineInput, station: stationInput, to, direction, now, cache = loadMetroCache() }) {
  const line = resolveLine(cache, lineInput);
  if (!line) return errorResponse({ mode: 'subway', query: { line: lineInput, station: stationInput, to, direction }, code: 'LINE_NOT_FOUND', message: `Unknown line: ${lineInput}` });
  const station = resolveStation(line, stationInput);
  if (!station) return errorResponse({ mode: 'subway', query: { line: lineInput, station: stationInput, to, direction }, code: 'STATION_NOT_FOUND', message: `Unknown station on ${line.name}: ${stationInput}` });
  const resolvedDirection = resolveDirection(station, { direction, to, line });
  if (!resolvedDirection) return errorResponse({ mode: 'subway', query: { line: line.name, station: station.name, to, direction }, code: 'DIRECTION_AMBIGUOUS', message: 'Direction is ambiguous', source: source(cache), warnings: station.directions.map((item) => item.name) });

  const nowMinutes = parseNow(now);
  const lastTrainInfo = pickLastTrain(resolvedDirection);
  const untilLast = minutesUntil(parseClockToMinutes(lastTrainInfo?.time), nowMinutes);
  const risk = untilLast == null ? 'unknown' : untilLast < 0 ? 'ended' : untilLast <= 20 ? 'high' : untilLast <= 45 ? 'medium' : 'none';
  return okResponse({
    mode: 'subway',
    query: { line: line.name, station: station.name, to, direction: resolvedDirection.name, now: now ?? null },
    result: {
      summary: `${line.name} ${station.name} ${resolvedDirection.name}：首班 ${resolvedDirection.first_train_time}，末班 ${lastTrainInfo?.time ?? '未知'}。`,
      first_train_time: resolvedDirection.first_train_time,
      last_train: lastTrainInfo,
      minutes_until_last: untilLast,
      last_train_risk: risk,
      action: risk === 'ended' ? 'too_late' : risk === 'high' ? 'go_now' : 'ok',
    },
    source: source(cache),
    warnings: [],
  });
}

export function shortcut({ alias, now, cache = loadMetroCache(), config = loadUserConfig() }) {
  const route = config.frequent_routes?.[alias];
  if (!route) {
    return errorResponse({
      mode: 'decision',
      query: { alias, now: now ?? null },
      code: 'SHORTCUT_NOT_FOUND',
      message: `Shortcut not configured: ${alias}`,
      warnings: [`Configure it in ${path.relative(PROJECT_ROOT, DEFAULT_CONFIG)}`],
    });
  }
  return decide({ ...route, question: alias, now, cache, config });
}

export function decide({ line, station, from, to, direction, question, now, cache = loadMetroCache(), config = loadUserConfig() }) {
  const routeLine = line ?? config.defaults?.line ?? '10号线';
  const routeStation = station ?? from;
  const response = nextTrain({ line: routeLine, station: routeStation, to, direction, now, cache });
  if (!response.ok) return response;
  const risk = response.result.last_train_risk;
  let recommendation = '可以正常走。';
  if (risk === 'ended') recommendation = '这条地铁方案大概率不行，建议直接打开高德查实时替代路线或打车。';
  else if (risk === 'high') recommendation = '别等，建议现在就进站/换乘；如果还没到站，准备打车兜底。';
  else if (risk === 'medium') recommendation = '能走，但别绕路，优先按当前方案执行。';
  else if (response.result.next_planned_time) recommendation = `按官方计划时刻，下一班 ${response.result.next_planned_time}；赶时间再看现场/高德确认实时状态。`;
  else recommendation = '当前只有首末班数据，不能可靠判断下一班；如果赶时间，建议看现场屏幕或高德实时到站。';

  return okResponse({
    mode: 'decision',
    query: { line: routeLine, from: routeStation, to, direction, question, now: now ?? null },
    result: {
      summary: `${recommendation} ${response.result.summary}`,
      recommendation,
      transit: response.result,
      risk,
    },
    source: response.source,
    warnings: response.warnings,
  });
}
