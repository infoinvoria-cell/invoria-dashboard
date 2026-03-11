import type { OhlcvPoint } from "@/types";

export type CandleIntegrityIssue =
  | "non_finite"
  | "non_positive"
  | "high_below_body"
  | "low_above_body"
  | "high_below_low"
  | "flat_range";

export type CandleIntegritySummary = {
  totalCandles: number;
  validCandles: number;
  rejectedCandles: number;
  invalidStructureCount: number;
  openEqualsCloseCount: number;
  flatRangeCount: number;
  openEqualsClosePct: number;
  flatRangePct: number;
  valid: boolean;
  warnings: string[];
};

export type StrictOhlcvPoint = OhlcvPoint & {
  issues?: CandleIntegrityIssue[];
};

const OPEN_EQUALS_CLOSE_WARN_PCT = 68;
const FLAT_RANGE_WARN_PCT = 3;

function finite(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function inspectOhlcvPoint(point: OhlcvPoint | null | undefined): {
  valid: boolean;
  point: StrictOhlcvPoint | null;
  issues: CandleIntegrityIssue[];
} {
  if (!point) {
    return { valid: false, point: null, issues: ["non_finite"] };
  }

  const open = finite(point.open);
  const high = finite(point.high);
  const low = finite(point.low);
  const close = finite(point.close);
  const volume = point.volume == null ? null : finite(point.volume);
  const issues: CandleIntegrityIssue[] = [];

  if (open == null || high == null || low == null || close == null) {
    issues.push("non_finite");
  } else {
    if (open <= 0 || high <= 0 || low <= 0 || close <= 0) issues.push("non_positive");
    if (high < Math.max(open, close)) issues.push("high_below_body");
    if (low > Math.min(open, close)) issues.push("low_above_body");
    if (high < low) issues.push("high_below_low");
    if (Math.abs(high - low) <= 1e-12) issues.push("flat_range");
  }

  if (issues.length || open == null || high == null || low == null || close == null) {
    return { valid: false, point: null, issues };
  }

  return {
    valid: true,
    point: {
      t: String(point.t),
      open,
      high,
      low,
      close,
      volume,
    },
    issues,
  };
}

export function filterValidOhlcvSeries(points: OhlcvPoint[] | null | undefined): StrictOhlcvPoint[] {
  if (!Array.isArray(points) || !points.length) return [];
  const deduped = new Map<string, StrictOhlcvPoint>();
  for (const point of points) {
    const inspected = inspectOhlcvPoint(point);
    if (!inspected.valid || !inspected.point) continue;
    deduped.set(inspected.point.t, inspected.point);
  }
  return Array.from(deduped.values()).sort((left, right) => new Date(left.t).getTime() - new Date(right.t).getTime());
}

export function analyzeOhlcvIntegrity(points: OhlcvPoint[] | null | undefined): CandleIntegritySummary {
  const rows = Array.isArray(points) ? points : [];
  let validCandles = 0;
  let invalidStructureCount = 0;
  let openEqualsCloseCount = 0;
  let flatRangeCount = 0;

  for (const point of rows) {
    const inspected = inspectOhlcvPoint(point);
    if (inspected.valid) {
      validCandles += 1;
      if (Math.abs(Number(point.open) - Number(point.close)) <= 1e-12) openEqualsCloseCount += 1;
      if (Math.abs(Number(point.high) - Number(point.low)) <= 1e-12) flatRangeCount += 1;
      continue;
    }

    if (inspected.issues.some((issue) => issue !== "non_finite" && issue !== "non_positive" && issue !== "flat_range")) {
      invalidStructureCount += 1;
    }
    if (inspected.issues.includes("flat_range")) flatRangeCount += 1;
  }

  const totalCandles = rows.length;
  const rejectedCandles = Math.max(0, totalCandles - validCandles);
  const openEqualsClosePct = totalCandles > 0 ? (openEqualsCloseCount / totalCandles) * 100 : 0;
  const flatRangePct = totalCandles > 0 ? (flatRangeCount / totalCandles) * 100 : 0;
  const warnings: string[] = [];

  if (invalidStructureCount > 0) {
    warnings.push(`Rejected ${invalidStructureCount} candles with invalid high/low construction.`);
  }
  if (openEqualsClosePct >= OPEN_EQUALS_CLOSE_WARN_PCT) {
    warnings.push(`Open equals close on ${openEqualsClosePct.toFixed(1)}% of candles.`);
  }
  if (flatRangePct >= FLAT_RANGE_WARN_PCT) {
    warnings.push(`Flat candles detected on ${flatRangePct.toFixed(1)}% of bars.`);
  }

  return {
    totalCandles,
    validCandles,
    rejectedCandles,
    invalidStructureCount,
    openEqualsCloseCount,
    flatRangeCount,
    openEqualsClosePct,
    flatRangePct,
    valid: invalidStructureCount === 0 && flatRangePct < FLAT_RANGE_WARN_PCT,
    warnings,
  };
}
