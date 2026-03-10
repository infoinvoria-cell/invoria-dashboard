import type { OhlcvPoint, TimeseriesResponse } from "@/types";

function toFinite(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function sanitizeOhlcvPoint(point: OhlcvPoint | null | undefined): OhlcvPoint | null {
  if (!point) return null;
  const open = toFinite(point.open);
  const highRaw = toFinite(point.high);
  const lowRaw = toFinite(point.low);
  const close = toFinite(point.close);
  if (open == null || highRaw == null || lowRaw == null || close == null) return null;
  if (open <= 0 || highRaw <= 0 || lowRaw <= 0 || close <= 0) return null;

  const high = Math.max(highRaw, open, close);
  const low = Math.min(lowRaw, open, close);
  if (high <= 0 || low <= 0) return null;
  const volume = point.volume == null ? null : toFinite(point.volume);
  return {
    t: String(point.t),
    open,
    high,
    low,
    close,
    volume,
  };
}

export function sanitizeOhlcvSeries(points: OhlcvPoint[] | null | undefined): OhlcvPoint[] {
  if (!Array.isArray(points) || points.length === 0) return [];
  const deduped = new Map<string, OhlcvPoint>();
  for (const point of points) {
    const sanitized = sanitizeOhlcvPoint(point);
    if (!sanitized) continue;
    deduped.set(sanitized.t, sanitized);
  }
  return Array.from(deduped.values()).sort((left, right) => new Date(left.t).getTime() - new Date(right.t).getTime());
}

export function sanitizeTimeseriesPayload(payload: TimeseriesResponse | null | undefined): TimeseriesResponse | null {
  if (!payload) return null;
  return {
    ...payload,
    ohlcv: sanitizeOhlcvSeries(payload.ohlcv),
  };
}
