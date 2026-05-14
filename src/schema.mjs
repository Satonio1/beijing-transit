export function okResponse({ mode, query, result, source, warnings = [] }) {
  return {
    ok: true,
    mode,
    query,
    result,
    source,
    warnings,
  };
}

export function errorResponse({ mode = 'unknown', query = {}, code, message, source = null, warnings = [] }) {
  return {
    ok: false,
    mode,
    query,
    error: { code, message },
    source,
    warnings,
  };
}

export const SOURCE_TYPES = Object.freeze({
  LIVE: 'live',
  OFFICIAL_TIMETABLE: 'official_timetable',
  SCHEDULE_ESTIMATE: 'schedule_estimate',
  HEADWAY_ESTIMATE: 'headway_estimate',
  ROUTE_PLANNING: 'route_planning',
  HANDOFF: 'handoff',
});

export const CONFIDENCE = Object.freeze({
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
});
