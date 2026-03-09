import type { HeatmapSeasonalityItem, OhlcvPoint, SeasonalityResponse, TimeseriesResponse } from "@/types";

export type SeasonalityPatternSummary = {
  label: string;
  fromLabel: string;
  toLabel: string;
  holdDays: number;
  hitRatePct: number;
  avgReturnPct: number;
  direction: "LONG" | "SHORT" | "NEUTRAL";
};

export type SeasonalityRiskStats = {
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdownPct: number;
  averageDrawdownPct: number;
};

const patternCache = new Map<string, { current: SeasonalityPatternSummary; next: SeasonalityPatternSummary }>();

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

function dayOfYear(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  return Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - start) / 86400000) + 1;
}

function formatMonthDay(value: number): string {
  const base = new Date(Date.UTC(2024, 0, 1));
  base.setUTCDate(value);
  return base.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function normalizeHitRatePct(value: number | null | undefined): number {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return 0;
  return raw > 1.5 ? clamp(raw, 0, 100) : clamp(raw * 100, 0, 100);
}

export function seasonalityPercent(item: HeatmapSeasonalityItem | null | undefined): number {
  if (!item) return 0;
  const explicit = Number(item.score);
  if (Number.isFinite(explicit) && explicit > 0) return clamp(explicit, 0, 100);
  return normalizeHitRatePct(item.hitRate);
}

export function seasonalityDirection(item: HeatmapSeasonalityItem | null | undefined): "LONG" | "SHORT" | "NEUTRAL" {
  const raw = String(item?.direction ?? "").toUpperCase();
  if (raw === "LONG") return "LONG";
  if (raw === "SHORT") return "SHORT";
  return "NEUTRAL";
}

export function seasonalityPatternLabel(item: HeatmapSeasonalityItem | null | undefined): string {
  if (!item) return "Kein Muster";
  const direction = seasonalityDirection(item);
  const hold = Number(item.bestHoldPeriod ?? 0);
  const expected = Number(item.expectedReturn ?? item.expectedValue ?? 0);
  return `${direction === "SHORT" ? "Short" : direction === "LONG" ? "Long" : "Neutral"} ${hold > 0 ? `${hold}T` : ""} ${Number.isFinite(expected) ? `${expected >= 0 ? "+" : ""}${expected.toFixed(1)}%` : ""}`.trim();
}

function buildFallbackPattern(
  fallback: HeatmapSeasonalityItem | null | undefined,
  offsetDays: number,
): SeasonalityPatternSummary {
  const direction = seasonalityDirection(fallback);
  const holdDays = clamp(Number(fallback?.bestHoldPeriod ?? 15), 5, 40);
  const avgReturnPct = Number(fallback?.expectedReturn ?? fallback?.expectedValue ?? 0);
  const hitRatePct = normalizeHitRatePct(fallback?.hitRate);
  const startDay = dayOfYear(new Date()) + offsetDays;
  const fromLabel = formatMonthDay(startDay);
  const toLabel = formatMonthDay(startDay + holdDays);
  return {
    label: `${fromLabel} - ${toLabel}`,
    fromLabel,
    toLabel,
    holdDays,
    hitRatePct,
    avgReturnPct,
    direction,
  };
}

type CandidatePattern = {
  score: number;
  pattern: SeasonalityPatternSummary;
};

function buildPatternCandidates(
  candles: OhlcvPoint[],
  startDayMin: number,
  startDayMax: number,
): CandidatePattern[] {
  if (candles.length < 120) return [];
  const grouped = new Map<number, OhlcvPoint[]>();
  const now = new Date();
  const cutoffYear = now.getUTCFullYear() - 6;
  for (const row of candles) {
    const date = new Date(row.t);
    if (date.getUTCFullYear() < cutoffYear) continue;
    const year = date.getUTCFullYear();
    const list = grouped.get(year) ?? [];
    list.push(row);
    grouped.set(year, list);
  }

  const holdMin = 10;
  const holdMax = 20;
  const candidates: CandidatePattern[] = [];

  for (let startDay = startDayMin; startDay <= startDayMax; startDay += 1) {
    for (let holdDays = holdMin; holdDays <= holdMax; holdDays += 1) {
      const sampleReturns: number[] = [];
      for (const rows of grouped.values()) {
        const startIndex = rows.findIndex((row) => dayOfYear(new Date(row.t)) >= startDay);
        if (startIndex < 0) continue;
        const endIndex = startIndex + holdDays;
        if (endIndex >= rows.length) continue;
        const startPrice = rows[startIndex].close;
        const endPrice = rows[endIndex].close;
        if (!(startPrice > 0) || !(endPrice > 0)) continue;
        sampleReturns.push((endPrice / startPrice - 1) * 100);
      }

      if (sampleReturns.length < 4) continue;
      const avgReturnPct = mean(sampleReturns);
      const direction = avgReturnPct >= 0 ? "LONG" : "SHORT";
      const hitRatePct = normalizeHitRatePct(
        direction === "LONG"
          ? sampleReturns.filter((value) => value > 0).length / sampleReturns.length
          : sampleReturns.filter((value) => value < 0).length / sampleReturns.length,
      );
      const fromLabel = formatMonthDay(startDay);
      const toLabel = formatMonthDay(startDay + holdDays);
      const pattern: SeasonalityPatternSummary = {
        label: `${fromLabel} - ${toLabel}`,
        fromLabel,
        toLabel,
        holdDays,
        hitRatePct,
        avgReturnPct,
        direction,
      };
      const score = (hitRatePct * 0.8) + Math.min(25, Math.abs(avgReturnPct) * 3) + sampleReturns.length;
      candidates.push({ score, pattern });
    }
  }

  return candidates.sort((left, right) => right.score - left.score);
}

export function buildSeasonalityPatterns(
  assetId: string,
  timeseries: TimeseriesResponse | null | undefined,
  fallback: HeatmapSeasonalityItem | null | undefined,
): { current: SeasonalityPatternSummary; next: SeasonalityPatternSummary } {
  const cacheKey = [
    assetId,
    String(timeseries?.updatedAt ?? ""),
    String(fallback?.bestHoldPeriod ?? ""),
    String(fallback?.expectedReturn ?? fallback?.expectedValue ?? ""),
    String(fallback?.hitRate ?? ""),
  ].join("|");
  const cached = patternCache.get(cacheKey);
  if (cached) return cached;

  const candles = Array.isArray(timeseries?.ohlcv) ? timeseries.ohlcv : [];
  const today = dayOfYear(new Date());
  const currentCandidates = buildPatternCandidates(candles, today - 6, today + 8);
  const current = currentCandidates[0]?.pattern ?? buildFallbackPattern(fallback, 0);

  const currentEnd = today + current.holdDays;
  const nextCandidates = buildPatternCandidates(candles, currentEnd - 3, currentEnd + 10);
  const next = nextCandidates[0]?.pattern ?? buildFallbackPattern(fallback, current.holdDays);

  const result = { current, next };
  patternCache.set(cacheKey, result);
  return result;
}

export function seasonalitySummary(payload: SeasonalityResponse | null | undefined, fallback: HeatmapSeasonalityItem | null | undefined) {
  if (payload?.stats) {
    const direction = String(payload.stats.direction ?? "LONG").toUpperCase() === "SHORT" ? "SHORT" as const : "LONG" as const;
    const hitRatePct = normalizeHitRatePct(payload.stats.hitRate);
    return {
      direction,
      score: hitRatePct,
      holdDays: Number(payload.stats.bestHorizonDays ?? payload.projectionDays ?? 0),
      hitRatePct,
      expectedReturn: Number(payload.stats.expectedValue ?? payload.stats.avgReturn20d ?? 0),
      samples: Number(payload.stats.samples ?? 0),
    };
  }
  const direction = seasonalityDirection(fallback) === "SHORT" ? "SHORT" as const : seasonalityDirection(fallback) === "LONG" ? "LONG" as const : "NEUTRAL" as const;
  const hitRatePct = normalizeHitRatePct(fallback?.hitRate);
  return {
    direction,
    score: seasonalityPercent(fallback),
    holdDays: Number(fallback?.bestHoldPeriod ?? 0),
    hitRatePct,
    expectedReturn: Number(fallback?.expectedReturn ?? fallback?.expectedValue ?? 0),
    samples: 0,
  };
}

export function seasonalityRiskStats(payload: SeasonalityResponse | null | undefined): SeasonalityRiskStats {
  const points = (payload?.curve ?? []).map((point) => Number(point.y)).filter(Number.isFinite);
  let peak = Number.NEGATIVE_INFINITY;
  const drawdowns: number[] = [];
  for (const point of points) {
    peak = Math.max(peak, point);
    drawdowns.push(point - peak);
  }
  const maxDrawdownPct = drawdowns.length ? Math.abs(Math.min(...drawdowns)) : 0;
  const averageDrawdownPct = drawdowns.length ? Math.abs(drawdowns.filter((value) => value < 0).reduce((sum, value) => sum + value, 0) / Math.max(1, drawdowns.filter((value) => value < 0).length)) : 0;
  return {
    sharpeRatio: Number(payload?.stats?.sharpeRatio ?? 0),
    sortinoRatio: Number(payload?.stats?.sortinoRatio ?? 0),
    maxDrawdownPct,
    averageDrawdownPct,
  };
}
