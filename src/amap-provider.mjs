import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIDENCE, SOURCE_TYPES, okResponse, errorResponse } from './schema.mjs';
import { loadUserConfig, nextTrain } from './metro-provider.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_ENV = path.join(PROJECT_ROOT, '.env');
const AMAP_DISTRICT = '北京';
const AMAP_CITY = '010';
const TRANSIT_URL = 'https://restapi.amap.com/v3/direction/transit/integrated';
const GEO_URL = 'https://restapi.amap.com/v3/geocode/geo';
const AROUND_URL = 'https://restapi.amap.com/v3/place/around';

function loadLocalEnv(envPath = DEFAULT_ENV) {
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index <= 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/gu, '');
    if (key && process.env[key] == null) process.env[key] = value;
  }
}

function amapKey() {
  // Environment variable wins; .env is local-development only and must not be committed.
  loadLocalEnv();
  return process.env.AMAP_KEY;
}

function source(limitations = []) {
  return {
    type: SOURCE_TYPES.ROUTE_PLANNING,
    name: '高德开放平台路径规划 WebService',
    confidence: CONFIDENCE.HIGH,
    freshness: new Date().toISOString(),
    source_url: 'https://lbs.amap.com/api/webservice/guide/api/direction',
    limitations: [
      '路线规划来自高德开放平台，不代表地铁实时到站',
      '一期只做地铁，不输出公交/打车主方案',
      '拥堵、临时管制、站内换乘耗时可能与现场不同',
      ...limitations,
    ],
  };
}

function splitLocation(location) {
  const [lon, lat] = String(location ?? '').split(',');
  return { lon: lon || '0', lat: lat || '0' };
}

function amapDeepLink(from, to, fromGeo = null, toGeo = null) {
  const origin = splitLocation(fromGeo?.location);
  const dest = splitLocation(toGeo?.location);
  const query = new URLSearchParams({
    sourceApplication: 'beijing-transit',
    slat: origin.lat,
    slon: origin.lon,
    sname: from,
    dlat: dest.lat,
    dlon: dest.lon,
    dname: to,
    dev: '0',
    t: '0',
  });
  return `https://uri.amap.com/navigation?${query.toString()}`;
}

async function fetchAmap(url, params) {
  const key = amapKey();
  if (!key) {
    const error = new Error('AMAP_KEY is not configured');
    error.code = 'AMAP_KEY_MISSING';
    throw error;
  }
  const query = new URLSearchParams({ ...params, key });
  const response = await fetch(`${url}?${query.toString()}`);
  if (!response.ok) {
    const error = new Error(`Amap HTTP ${response.status}`);
    error.code = 'AMAP_HTTP_ERROR';
    throw error;
  }
  const payload = await response.json();
  if (payload.status !== '1') {
    const error = new Error(payload.info || 'Amap API error');
    error.code = payload.infocode || 'AMAP_API_ERROR';
    error.payload = payload;
    throw error;
  }
  return payload;
}

function isLocation(value) {
  return /^-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?$/u.test(String(value ?? '').trim());
}

async function geocode(address) {
  if (isLocation(address)) return { location: address, name: address, formatted_address: address, source: 'coordinate' };
  const payload = await fetchAmap(GEO_URL, { address, city: AMAP_DISTRICT, output: 'JSON' });
  const item = payload.geocodes?.[0];
  if (!item?.location) {
    const error = new Error(`Amap geocode found no result: ${address}`);
    error.code = 'AMAP_GEOCODE_NOT_FOUND';
    throw error;
  }
  return {
    location: item.location,
    name: item.formatted_address || address,
    formatted_address: item.formatted_address || address,
    level: item.level ?? null,
    adcode: item.adcode ?? null,
    source: 'geocode',
  };
}

async function nearbySubwayStations(geo, limit = 3) {
  if (!geo?.location) return [];
  const payload = await fetchAmap(AROUND_URL, {
    location: geo.location,
    city: AMAP_CITY,
    types: '150500',
    radius: '5000',
    offset: String(limit),
    page: '1',
    extensions: 'base',
    output: 'JSON',
  });
  return (payload.pois ?? []).slice(0, limit).map((poi) => ({
    name: poi.name,
    distance_m: poi.distance != null ? Number(poi.distance) : null,
    address: poi.address || null,
    location: poi.location || null,
  }));
}

function formatNearby(items) {
  return items.map((item) => `${item.name}约${item.distance_m}m`).join('、') || '未找到';
}

function minutesFromSeconds(seconds) {
  const value = Number(seconds);
  return Number.isFinite(value) ? Math.round(value / 60) : null;
}

function meters(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function stepInstruction(step) {
  return step?.instruction || step?.name || step?.road || null;
}

function segmentSummaries(segment) {
  const summaries = [];
  if (segment.walking && Number(segment.walking.distance ?? 0) > 0) {
    summaries.push({
      type: 'walk',
      instruction: segment.walking.origin || segment.walking.destination ? '步行接驳' : '步行',
      distance_m: meters(segment.walking.distance),
      duration_min: minutesFromSeconds(segment.walking.duration),
      steps: (segment.walking.steps ?? []).map(stepInstruction).filter(Boolean).slice(0, 6),
    });
  }
  for (const busline of segment.bus?.buslines ?? []) {
    summaries.push({
      type: busline.type === '地铁线路' ? 'subway' : 'bus',
      line: busline.name ?? null,
      departure_stop: busline.departure_stop?.name ?? null,
      arrival_stop: busline.arrival_stop?.name ?? null,
      via_num: busline.via_num != null ? Number(busline.via_num) : null,
      distance_m: meters(busline.distance),
      duration_min: minutesFromSeconds(busline.duration),
    });
  }
  return summaries;
}

function normalizeTransit(route, fromGeo, toGeo, from, to) {
  const transits = route.transits ?? [];
  const transit = transits.find((item) => {
    const segments = (item.segments ?? []).flatMap(segmentSummaries).filter(Boolean);
    const rideSegments = segments.filter((segment) => segment.type === 'subway' || segment.type === 'bus');
    return rideSegments.length > 0 && rideSegments.every((segment) => segment.type === 'subway');
  });
  if (!transit) return null;
  const segments = (transit.segments ?? []).flatMap(segmentSummaries).filter(Boolean);
  return {
    origin: { input: from, ...fromGeo },
    destination: { input: to, ...toGeo },
    duration_min: minutesFromSeconds(transit.duration),
    walking_distance_m: meters(transit.walking_distance),
    distance_m: meters(transit.distance),
    cost_yuan: transit.cost ? Number(transit.cost) : null,
    segments,
    amap_deep_link: amapDeepLink(from, to, fromGeo, toGeo),
  };
}

function transitLines(plan) {
  return plan.segments
    .filter((item) => item.type === 'subway' || item.type === 'bus')
    .map((item) => item.line)
    .filter(Boolean);
}

function timetableHighlights(plan) {
  return plan.segments
    .filter((item) => item.type === 'subway' && item.timetable?.next_planned_time)
    .map((item) => {
      const prefix = item.timetable.query_time ? `约${item.timetable.query_time}到${item.departure_stop}，` : `${item.departure_stop} 上 `;
      return `${prefix}${subwayLineName(item.line)} 下一班 ${item.timetable.next_planned_time}`;
    });
}

function humanSummary(plan, from, to) {
  if (!plan) return `没有找到 ${from} 到 ${to} 的地铁-only 方案。`;
  const lines = transitLines(plan);
  const lineText = lines.length > 0 ? `，主要乘坐 ${lines.join(' -> ')}` : '';
  const timetableText = timetableHighlights(plan);
  const nextText = timetableText.length > 0 ? `；本地时刻表：${timetableText.join('，')}` : '';
  return `${from} -> ${to}：高德规划约 ${plan.duration_min ?? '未知'} 分钟${lineText}${nextText}。`;
}

function subwayLineName(value) {
  const match = String(value ?? '').match(/地铁([^线]+线)/u);
  if (!match) return null;
  return match[1];
}

function subwayTerminal(value) {
  const match = String(value ?? '').match(/\(([^()]+)--([^()]+)\)/u);
  return match?.[2] ?? null;
}

function parseClock(value) {
  const match = String(value ?? '').match(/^(\d{1,2}):(\d{2})$/u);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function minutesToClock(value) {
  const normalized = ((value % 1440) + 1440) % 1440;
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  return `${hour}:${String(minute).padStart(2, '0')}`;
}

function enrichSubwayTimetables(plan, now) {
  let cursor = parseClock(now);
  const config = loadUserConfig();
  const transferBuffer = Number(config.preferences?.transfer_buffer_minutes ?? 4);
  let previousWasSubway = false;
  return {
    ...plan,
    segments: plan.segments.map((segment, index, segments) => {
      if (cursor != null && segment.type !== 'subway' && segment.duration_min != null) {
        cursor += segment.duration_min;
        const hasLaterSubway = segments.slice(index + 1).some((item) => item.type === 'subway');
        const transfer_buffer_minutes = previousWasSubway && hasLaterSubway ? transferBuffer : 0;
        cursor += transfer_buffer_minutes;
        previousWasSubway = false;
        return { ...segment, transfer_buffer_minutes, estimated_arrival_time: minutesToClock(cursor) };
      }
      if (segment.type !== 'subway') return segment;
      const line = subwayLineName(segment.line);
      const to = subwayTerminal(segment.line) ?? segment.arrival_stop;
      if (!line || !segment.departure_stop || !to) return segment;
      const transfer_buffer_minutes = previousWasSubway ? transferBuffer : 0;
      if (cursor != null) cursor += transfer_buffer_minutes;
      const queryTime = cursor != null ? minutesToClock(cursor) : now;
      const timetable = nextTrain({ line, station: segment.departure_stop, to, now: queryTime });
      const enriched = {
        ...segment,
        transfer_buffer_minutes,
        timetable: timetable.ok ? {
          query_time: queryTime,
          next_planned_time: timetable.result.next_planned_time,
          eta_minutes: timetable.result.eta_minutes,
          last_train_risk: timetable.result.last_train_risk,
          validation_status: timetable.result.timetable?.validation_status ?? null,
          source: timetable.source,
          warnings: timetable.warnings,
        } : {
          query_time: queryTime,
          error: timetable.error,
          warnings: timetable.warnings,
        },
      };
      if (cursor != null) {
        const wait = timetable.ok && Array.isArray(timetable.result.eta_minutes) ? timetable.result.eta_minutes[0] : 0;
        // Amap segment.duration already includes the expected waiting time in its route plan.
        // We still expose our local next planned train, but do not add the wait again here.
        cursor += (segment.duration_min ?? 0);
        enriched.estimated_arrival_time = minutesToClock(cursor);
        previousWasSubway = true;
      }
      return enriched;
    }),
  };
}

export async function routeAmap({ from, to, now }) {
  if (!from || !to) return errorResponse({ mode: 'route', query: { from, to }, code: 'ROUTE_QUERY_INCOMPLETE', message: '`--from` and `--to` are required.' });
  try {
    const [fromGeo, toGeo] = await Promise.all([geocode(from), geocode(to)]);
    const payload = await fetchAmap(TRANSIT_URL, {
      origin: fromGeo.location,
      destination: toGeo.location,
      city: AMAP_CITY,
      cityd: AMAP_CITY,
      strategy: '0',
      output: 'JSON',
    });
    let plan = normalizeTransit(payload.route ?? {}, fromGeo, toGeo, from, to);
    if (plan) plan = enrichSubwayTimetables(plan, now);
    if (!plan) {
      const [originNearby, destinationNearby] = await Promise.all([nearbySubwayStations(fromGeo), nearbySubwayStations(toGeo)]);
      return errorResponse({
        mode: 'route',
        query: { from, to, now: now ?? null, provider: 'amap', constraint: 'subway_only' },
        code: 'SUBWAY_ONLY_ROUTE_NOT_FOUND',
        message: `一期只输出地铁-only 方案；高德没有返回 ${from} -> ${to} 的纯地铁候选。`,
        source: source(),
        warnings: [
          '可以改为指定起终点地铁站，或打开高德兜底查看公交/步行混合方案。',
          `起点附近地铁站：${formatNearby(originNearby)}`,
          `终点附近地铁站：${formatNearby(destinationNearby)}`,
          amapDeepLink(from, to, fromGeo, toGeo),
        ],
      });
    }
    return okResponse({
      mode: 'route',
      query: { from, to, now: now ?? null, provider: 'amap' },
      result: {
        summary: humanSummary(plan, from, to),
        plan,
      },
      source: source(),
      warnings: ['一期只输出地铁-only 方案；公交段会被过滤。高德路线规划不是实时地铁到站，下一班计划时刻需结合本地结构化时刻表。'],
    });
  } catch (error) {
    return errorResponse({
      mode: 'route',
      query: { from, to, now: now ?? null, provider: 'amap' },
      code: error.code || 'AMAP_ROUTE_ERROR',
      message: error.message,
      source: source(['高德 API 调用失败时仅可返回深链兜底']),
      warnings: [amapDeepLink(from, to)],
    });
  }
}
