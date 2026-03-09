import type { HeatmapSeasonalityItem, OhlcvPoint, TimeseriesResponse } from "@/types";

import { sanitizeOhlcvSeries, sanitizeTimeseriesPayload } from "@/lib/ohlcv";
import {
  buildEvaluationPayloadFromValuation,
  buildValuationSeries,
} from "@/lib/screener/valuation";
import { buildSupplyDemandZones } from "@/lib/screener/supplyDemand";
import {
  buildSeasonalityPatterns,
  seasonalityDirection,
  seasonalityPercent,
} from "@/lib/screener/seasonality";
import type {
  PineBarDecision,
  PineScreenerRow,
  PineScreenerSettings,
  PineSignalState,
  PineZone,
  ScreenerSelectedAnalysis,
  ValuationSeriesPoint,
} from "@/lib/screener/types";

export type CompareSeriesMap = {
  compare1: Array<{ t: string; close: number }>;
  compare2: Array<{ t: string; close: number }>;
  compare3: Array<{ t: string; close: number }>;
  compareLabel1: string;
  compareLabel2: string;
  compareLabel3: string;
};

function normalizeDate(value: string): Date {
  return new Date(value);
}

function isAllowedWeekday(date: Date, settings: PineScreenerSettings): boolean {
  const day = date.getUTCDay();
  if (day === 1) return settings.weekdays.mon;
  if (day === 2) return settings.weekdays.tue;
  if (day === 3) return settings.weekdays.wed;
  if (day === 4) return settings.weekdays.thu;
  if (day === 5) return settings.weekdays.fri;
  return false;
}

function isAllowedMonth(date: Date, settings: PineScreenerSettings): boolean {
  const month = date.getUTCMonth();
  const keys = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"] as const;
  return settings.months[keys[month]];
}

function timeFilterPassed(date: Date, settings: PineScreenerSettings, timeframe: "D" | "W"): boolean {
  if (!settings.zeitfilter || timeframe !== "D") return true;
  const shiftedMs = date.getTime() + (settings.zeitzone * 60 * 60 * 1000);
  const shifted = new Date(shiftedMs);
  const minutes = shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
  const start = settings.startHour * 60 + settings.startMinute;
  const end = settings.endHour * 60 + settings.endMinute;
  if (end < start) return minutes >= start || minutes <= end;
  return minutes >= start && minutes <= end;
}

function isDojiExtreme(candle: OhlcvPoint): boolean {
  const range = Math.max(1e-9, candle.high - candle.low);
  const body = Math.abs(candle.close - candle.open);
  const upperWick = candle.high - Math.max(candle.open, candle.close);
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;
  const bodyRatio = body / range;
  const wickDominance = Math.max(upperWick, lowerWick) / range;
  return bodyRatio <= 0.18 || wickDominance >= 0.68;
}

function candlesEnoughAge(candles: OhlcvPoint[], settings: PineScreenerSettings, index: number): boolean {
  const current = normalizeDate(candles[index].t);
  const first = normalizeDate(candles[0].t);
  const requiredMs = Math.max(0, settings.yearsReq) * 365 * 24 * 60 * 60 * 1000;
  return current.getTime() - first.getTime() >= requiredMs;
}

function barSignalLabel(signal: PineScreenerRow["signal"]): string {
  if (signal === "long") return "Long";
  if (signal === "short") return "Short";
  if (signal === "recent-long") return "Recent Long";
  if (signal === "recent-short") return "Recent Short";
  return "Neutral";
}

function safeValue(value: number | null | undefined): number {
  return Number.isFinite(value) ? Number(value) : 0;
}

function valuationComponents(point: ValuationSeriesPoint | null): [number, number, number, number] {
  return [
    safeValue(point?.compare1),
    safeValue(point?.compare2),
    safeValue(point?.compare3),
    safeValue(point?.combined),
  ];
}

function signalDirectionLabel(signal: PineScreenerRow["signal"]): PineScreenerRow["signalDirection"] {
  if (signal === "long" || signal === "recent-long") return "LONG";
  if (signal === "short" || signal === "recent-short") return "SHORT";
  return "NONE";
}

function valuationMatchCount(point: ValuationSeriesPoint | null, direction: "LONG" | "SHORT"): number {
  if (!point) return 0;
  return direction === "LONG" ? point.longHits : point.shortHits;
}

function valuationThreshold(settings: PineScreenerSettings): number {
  return settings.valuationAgreementMode === "3of4" ? 3 : settings.valuationAgreementMode === "2of4" ? 2 : 1;
}

function valuationPassFromPoint(
  point: ValuationSeriesPoint | null,
  direction: "LONG" | "SHORT",
  settings: PineScreenerSettings,
): boolean {
  const threshold = valuationThreshold(settings);
  if (settings.valuationAgreementMode === "combined") {
    return direction === "LONG" ? Boolean(point?.longval) : Boolean(point?.shortval);
  }
  return valuationMatchCount(point, direction) >= threshold;
}

function valuationPassAcrossWindows(
  val10Point: ValuationSeriesPoint | null,
  val20Point: ValuationSeriesPoint | null,
  direction: "LONG" | "SHORT",
  settings: PineScreenerSettings,
): boolean {
  return valuationPassFromPoint(val10Point, direction, settings) || valuationPassFromPoint(val20Point, direction, settings);
}

function resolveValuationPhase(
  val10Point: ValuationSeriesPoint | null,
  val20Point: ValuationSeriesPoint | null,
): PineScreenerRow["valuationPhase"] {
  const val20Direction = valuationDirection(val20Point);
  const val10Direction = valuationDirection(val10Point);
  if (val20Direction === "LONG" || val20Direction === "SHORT") return val20Point?.phaseval ?? "NEUTRAL";
  if (val10Direction === "LONG" || val10Direction === "SHORT") return val10Point?.phaseval ?? "NEUTRAL";
  return val20Point?.phaseval ?? val10Point?.phaseval ?? "NEUTRAL";
}

function valuationDirection(point: ValuationSeriesPoint | null): "LONG" | "SHORT" | "NONE" {
  if (!point) return "NONE";
  if (point.longHits > 0 && point.shortHits === 0) return "LONG";
  if (point.shortHits > 0 && point.longHits === 0) return "SHORT";
  if (Boolean(point.longval) && !point.shortval) return "LONG";
  if (Boolean(point.shortval) && !point.longval) return "SHORT";
  return "NONE";
}

function signalStateFromBars(decisions: PineBarDecision[], lookback: number): PineSignalState {
  const lastIndex = decisions.length - 1;
  const current = decisions[lastIndex];
  const window = decisions.slice(Math.max(0, lastIndex - lookback), lastIndex + 1);
  const currentLong = current?.signal === "long";
  const currentShort = current?.signal === "short";
  const recentLong = window.some((row) => row.signal === "long");
  const recentShort = window.some((row) => row.signal === "short");
  const lastSignal = [...decisions].reverse().find((row) => row.signal !== "none") ?? null;
  const ageBars = lastSignal ? lastIndex - lastSignal.index : null;
  const currentDirection =
    currentLong ? "long"
      : currentShort ? "short"
        : recentLong ? "recent-long"
          : recentShort ? "recent-short"
            : "neutral";
  return {
    currentLong,
    recentLong,
    currentShort,
    recentShort,
    currentDirection,
    lastSignalIndex: lastSignal?.index ?? null,
    ageBars,
  };
}

function relevantZoneForDirection(zones: PineZone[], direction: "LONG" | "SHORT"): PineZone | null {
  const filtered = zones.filter((zone) => zone.active && (direction === "LONG" ? zone.kind === "demand" : zone.kind === "supply"));
  return filtered.sort((left, right) => {
    if (left.strength !== right.strength) return left.strength === "strong" ? -1 : 1;
    return (right.lastTouchedIndex ?? -1) - (left.lastTouchedIndex ?? -1);
  })[0] ?? null;
}

function buildDecisions(
  candles: OhlcvPoint[],
  zones: PineZone[],
  val10Points: ValuationSeriesPoint[],
  val20Points: ValuationSeriesPoint[],
  seasonalityItem: HeatmapSeasonalityItem | null,
  settings: PineScreenerSettings,
): PineBarDecision[] {
  const valuation10ByDate = new Map(val10Points.map((point) => [point.t.slice(0, 10), point]));
  const valuation20ByDate = new Map(val20Points.map((point) => [point.t.slice(0, 10), point]));
  const seasonDirection = seasonalityDirection(seasonalityItem);
  const seasonScore = seasonalityPercent(seasonalityItem);
  const decisions: PineBarDecision[] = [];
  let lastSignalIndex = -Infinity;

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    const dateKey = candle.t.slice(0, 10);
    const valuation10 = valuation10ByDate.get(dateKey) ?? null;
    const valuation20 = valuation20ByDate.get(dateKey) ?? null;
    const valuationPassLong = !settings.comactive || valuationPassAcrossWindows(valuation10, valuation20, "LONG", settings);
    const valuationPassShort = !settings.comactive || valuationPassAcrossWindows(valuation10, valuation20, "SHORT", settings);
    const activeZones = zones.filter((zone) => zone.startIndex <= index && zone.endIndex >= index && !zone.broken);
    const longZones = activeZones.filter((zone) => zone.kind === "demand" && ((zone.strength === "normal" && settings.sd) || (zone.strength === "strong" && settings.sd1)));
    const shortZones = activeZones.filter((zone) => zone.kind === "supply" && ((zone.strength === "normal" && settings.sd) || (zone.strength === "strong" && settings.sd1)));
    const zonePassLong = (!settings.sd && !settings.sd1) || longZones.length > 0;
    const zonePassShort = (!settings.sd && !settings.sd1) || shortZones.length > 0;
    const candlePassLong = !settings.candle || candle.close > candle.open;
    const candlePassShort = !settings.candle || candle.close < candle.open;
    const dojiBlocked = settings.dojiextrem && isDojiExtreme(candle);
    const parsed = normalizeDate(candle.t);
    const weekdayPassed = isAllowedWeekday(parsed, settings);
    const monthPassed = isAllowedMonth(parsed, settings);
    const timePassed = timeFilterPassed(parsed, settings, settings.timeframe);
    const agePassed = candlesEnoughAge(candles, settings, index);
    const seasonalityPassLong = seasonScore >= settings.seasonalityThreshold && seasonDirection === "LONG";
    const seasonalityPassShort = seasonScore >= settings.seasonalityThreshold && seasonDirection === "SHORT";
    const pausePassed = (index - lastSignalIndex) > settings.pauseBars;

    let signal: PineBarDecision["signal"] = "none";
    const longAllowed =
      settings.longg
      && valuationPassLong
      && zonePassLong
      && seasonalityPassLong
      && candlePassLong
      && !dojiBlocked
      && weekdayPassed
      && monthPassed
      && timePassed
      && agePassed
      && pausePassed;
    const shortAllowed =
      settings.shortt
      && valuationPassShort
      && zonePassShort
      && seasonalityPassShort
      && candlePassShort
      && !dojiBlocked
      && weekdayPassed
      && monthPassed
      && timePassed
      && agePassed
      && pausePassed;

    if (longAllowed && !shortAllowed) signal = "long";
    if (shortAllowed && !longAllowed) signal = "short";
    if (signal !== "none") lastSignalIndex = index;

    decisions.push({
      index,
      time: candle.t,
      allowedLong: longAllowed,
      allowedShort: shortAllowed,
      signal,
      seasonalityPass: seasonScore >= settings.seasonalityThreshold,
      valuationPassLong,
      valuationPassShort,
      zonePassLong,
      zonePassShort,
      candlePassLong,
      candlePassShort,
      dojiBlocked,
      timePassed,
      weekdayPassed,
      monthPassed,
      agePassed,
    });
  }

  return decisions;
}

export function buildSelectedAnalysis(
  assetId: string,
  timeseries: TimeseriesResponse | null,
  seasonality: ScreenerSelectedAnalysis["seasonality"],
  seasonalityHeatmap: HeatmapSeasonalityItem | null,
  compareSeries: CompareSeriesMap | null,
  settings: PineScreenerSettings,
): ScreenerSelectedAnalysis {
  const safeTimeseries = sanitizeTimeseriesPayload(timeseries);
  if (!safeTimeseries || !compareSeries) {
    return {
      timeseries: safeTimeseries,
      seasonality,
      seasonalityHeatmap,
      valuation: null,
      signals: null,
      decisions: [],
      zones: [],
    };
  }

  const assetSeries = safeTimeseries.ohlcv.map((row) => ({ t: row.t, close: row.close }));
  const val10Points = buildValuationSeries(assetSeries, compareSeries.compare1, compareSeries.compare2, compareSeries.compare3, 10, settings.rescaleLength, settings.top, settings.bottom, settings.valuationAgreementMode);
  const val20Points = buildValuationSeries(assetSeries, compareSeries.compare1, compareSeries.compare2, compareSeries.compare3, settings.length, settings.rescaleLength, settings.top, settings.bottom, settings.valuationAgreementMode);
  const evaluationPayload = buildEvaluationPayloadFromValuation(assetId, compareSeries.compareLabel1, compareSeries.compareLabel2, compareSeries.compareLabel3, val10Points, val20Points);
  const zones = buildSupplyDemandZones(safeTimeseries.ohlcv, settings.minBarsBeforeBox);
  const decisions = buildDecisions(safeTimeseries.ohlcv, zones, val10Points, val20Points, seasonalityHeatmap, settings);
  const signals = signalStateFromBars(decisions, settings.screenerLookback);

  return {
    timeseries: safeTimeseries,
    seasonality,
    seasonalityHeatmap,
    valuation: {
      evaluationPayload,
      val10Points,
      val20Points,
      activeVal10: val10Points.at(-1) ?? null,
      activeVal20: val20Points.at(-1) ?? null,
    },
    signals,
    decisions,
    zones,
  };
}

function describeZoneState(
  zones: PineZone[],
  candles: OhlcvPoint[],
  strength: "normal" | "strong",
): {
  label: string;
  active: boolean;
  kind: "demand" | "supply" | "neutral";
} {
  const latest = candles.at(-1);
  if (!latest) return { label: "None", active: false, kind: "neutral" };
  const relevant = zones
    .filter((zone) => zone.strength === strength && zone.active)
    .sort((left, right) => {
      const leftDistance = Math.min(Math.abs(latest.close - left.low), Math.abs(latest.close - left.high));
      const rightDistance = Math.min(Math.abs(latest.close - right.low), Math.abs(latest.close - right.high));
      return leftDistance - rightDistance;
    })[0] ?? null;

  if (!relevant) return { label: "None", active: false, kind: "neutral" };
  const base = `${relevant.kind === "demand" ? "Demand" : "Supply"}`;
  if (relevant.inZone) return { label: `${base} In Zone`, active: true, kind: relevant.kind };
  if (relevant.touched) return { label: `${base} Touch`, active: true, kind: relevant.kind };
  return { label: `${base} Active`, active: true, kind: relevant.kind };
}

export function buildScreenerRow(
  assetId: string,
  name: string,
  symbol: string,
  category: string,
  assetGroup: string,
  timeseries: TimeseriesResponse | null,
  seasonalityItem: HeatmapSeasonalityItem | null,
  compareSeries: CompareSeriesMap | null,
  settings: PineScreenerSettings,
  selectedAssetId: string | null,
): PineScreenerRow | null {
  if (!timeseries || !compareSeries) return null;
  const analysis = buildSelectedAnalysis(assetId, timeseries, null, seasonalityItem, compareSeries, settings);
  const latestDecision = analysis.decisions.at(-1);
  const latestVal10 = analysis.valuation?.activeVal10 ?? null;
  const latestVal20 = analysis.valuation?.activeVal20 ?? null;
  const signalState = analysis.signals;
  if (!signalState || !latestDecision) return null;

  const seasonScore = seasonalityPercent(seasonalityItem);
  const seasonDirection = seasonalityDirection(seasonalityItem);
  const signalDirection = signalDirectionLabel(signalState.currentDirection);
  const relevantLongZone = relevantZoneForDirection(analysis.zones, "LONG");
  const relevantShortZone = relevantZoneForDirection(analysis.zones, "SHORT");
  const activeZone = signalState.currentDirection === "long" || signalState.currentDirection === "recent-long"
    ? relevantLongZone
    : signalState.currentDirection === "short" || signalState.currentDirection === "recent-short"
      ? relevantShortZone
      : relevantLongZone ?? relevantShortZone;

  const matchCount = signalDirection === "SHORT"
    ? Math.max(valuationMatchCount(latestVal10, "SHORT"), valuationMatchCount(latestVal20, "SHORT"))
    : signalDirection === "LONG"
      ? Math.max(valuationMatchCount(latestVal10, "LONG"), valuationMatchCount(latestVal20, "LONG"))
      : 0;
  const strongBias = activeZone?.strength === "strong" ? 16 : activeZone ? 8 : 0;
  const priority = Math.max(
    0,
    Math.min(
      100,
      (signalState.currentDirection === "long" || signalState.currentDirection === "short" ? 34 : signalState.currentDirection === "recent-long" || signalState.currentDirection === "recent-short" ? 18 : 0)
      + (matchCount * 11)
      + (seasonScore * 0.28)
      + strongBias
      + (activeZone?.touched ? 8 : 0),
    ),
  );

  const latestCandle = analysis.timeseries?.ohlcv.at(-1) ?? null;
  const candleConfirmed =
    signalDirection === "LONG" ? Boolean(latestCandle && latestCandle.close > latestCandle.open)
      : signalDirection === "SHORT" ? Boolean(latestCandle && latestCandle.close < latestCandle.open)
        : false;
  const normalZone = describeZoneState(analysis.zones, analysis.timeseries?.ohlcv ?? [], "normal");
  const strongZone = describeZoneState(analysis.zones, analysis.timeseries?.ohlcv ?? [], "strong");
  const patterns = buildSeasonalityPatterns(assetId, analysis.timeseries, seasonalityItem);
  const valuationGate =
    signalDirection === "LONG"
      ? valuationPassAcrossWindows(latestVal10, latestVal20, "LONG", settings)
      : signalDirection === "SHORT"
        ? valuationPassAcrossWindows(latestVal10, latestVal20, "SHORT", settings)
        : false;
  const zoneGate =
    signalDirection === "LONG" ? Boolean(relevantLongZone)
      : signalDirection === "SHORT" ? Boolean(relevantShortZone)
        : false;
  const entryConfirmed = valuationGate && zoneGate && candleConfirmed;
  const lookbackGate = signalState.currentDirection !== "neutral";
  const seasonalityGate = seasonScore >= settings.seasonalityThreshold;
  const passesSignalFilter = entryConfirmed && seasonalityGate && lookbackGate;
  const val10Direction = valuationDirection(latestVal10);
  const val20Direction = valuationDirection(latestVal20);

  return {
    assetId,
    name,
    symbol,
    category,
    assetGroup,
    signal: signalState.currentDirection,
    signalDirection,
    signalLabel: barSignalLabel(signalState.currentDirection),
    entryState: latestDecision.signal !== "none" ? "ACTIVE" : (signalState.currentDirection === "recent-long" || signalState.currentDirection === "recent-short") ? "RECENT" : "WAIT",
    entryConfirmed,
    priority,
    ageBars: signalState.ageBars,
    passesSignalFilter,
    seasonalityScore: seasonScore,
    seasonalityDirection: seasonDirection,
    val10Combined: safeValue(analysis.valuation?.activeVal10?.combined),
    val20Combined: safeValue(analysis.valuation?.activeVal20?.combined),
    val10Direction,
    val20Direction,
    val10MatchCount: Math.max(latestVal10?.longHits ?? 0, latestVal10?.shortHits ?? 0),
    val20MatchCount: Math.max(latestVal20?.longHits ?? 0, latestVal20?.shortHits ?? 0),
    val10Components: valuationComponents(latestVal10),
    val20Components: valuationComponents(latestVal20),
    valuationPhase: resolveValuationPhase(latestVal10, latestVal20),
    supplyDemandLabel: normalZone.label,
    supplyDemandStrongLabel: strongZone.label,
    supplyDemandStrength: activeZone?.strength ?? "none",
    supplyDemandDirection: activeZone?.kind ?? "neutral",
    hasNormalDemand: analysis.zones.some((zone) => zone.active && zone.kind === "demand" && zone.strength === "normal"),
    hasNormalSupply: analysis.zones.some((zone) => zone.active && zone.kind === "supply" && zone.strength === "normal"),
    hasStrongDemand: analysis.zones.some((zone) => zone.active && zone.kind === "demand" && zone.strength === "strong"),
    hasStrongSupply: analysis.zones.some((zone) => zone.active && zone.kind === "supply" && zone.strength === "strong"),
    currentPatternLabel: patterns.current.label,
    currentPatternHoldDays: patterns.current.holdDays,
    currentPatternHitRate: patterns.current.hitRatePct,
    currentPatternAvgReturn: patterns.current.avgReturnPct,
    nextPatternLabel: patterns.next.label,
    nextPatternHoldDays: patterns.next.holdDays,
    nextPatternHitRate: patterns.next.hitRatePct,
    nextPatternAvgReturn: patterns.next.avgReturnPct,
    seasonalityCurve: Array.isArray(seasonalityItem?.curve) ? seasonalityItem.curve.map((value) => safeValue(value)) : [],
    cpiAlignment: "neutral",
    ppiAlignment: "neutral",
    cotCommercialsAlignment: "neutral",
    riskAlignment: "neutral",
    lastCandles: sanitizeOhlcvSeries(analysis.timeseries?.ohlcv ?? []).slice(-5),
    selected: selectedAssetId === assetId,
    loading: false,
  };
}

export function zonesToTimeseriesPayload(timeseries: TimeseriesResponse, zones: PineZone[]): TimeseriesResponse {
  const safeTimeseries = sanitizeTimeseriesPayload(timeseries) ?? timeseries;
  const demand = zones
    .filter((zone) => zone.kind === "demand")
    .map((zone) => ({ start: zone.start, end: zone.active ? safeTimeseries.ohlcv.at(-1)?.t ?? zone.end : zone.end, low: zone.low, high: zone.high }));
  const supply = zones
    .filter((zone) => zone.kind === "supply")
    .map((zone) => ({ start: zone.start, end: zone.active ? safeTimeseries.ohlcv.at(-1)?.t ?? zone.end : zone.end, low: zone.low, high: zone.high }));

  return {
    ...safeTimeseries,
    supplyDemand: {
      demand,
      supply,
    },
  };
}
