import type {
  EquityPoint,
  OptimizerAssetId,
  OptimizerCandleIntegrityReport,
  OptimizerDebugAsset,
  OptimizerDebugSignal,
  OptimizerDebugZone,
  OptimizerPreviewResponse,
  OptimizerSeasonalityWindow,
  OptimizerStrategyResult,
  OptimizerStrategyValuationSummary,
  OptimizerTradeValidation,
  StrategyAssetMetrics,
  StrategyMetrics,
  StrategyParams,
  TradeRecord,
  ValuationMode,
  ValuationMultiPeriodLogic,
  ValuationPeriod,
  ValuationWeightProfile,
} from "@/lib/optimizer/types";
import { buildSupplyDemandZones } from "@/lib/screener/supplyDemand";
import type { PineZone } from "@/lib/screener/types";
import { buildValuationSeries } from "@/lib/screener/valuation";
import type { OptimizerAssetDataset, OptimizerDailyBar, OptimizerLoadedData, OptimizerReferenceSeries } from "@/lib/server/optimizer/data";

type SeasonalityPoint = {
  expectedReturn: number;
  direction: "long" | "short" | "neutral";
  samples: number;
};

type AssetBacktestResult = {
  assetId: OptimizerAssetId;
  trades: TradeRecord[];
  assetMetrics: StrategyAssetMetrics;
  equityCurve: EquityPoint[];
  debugAsset: OptimizerDebugAsset;
  valuation: OptimizerStrategyValuationSummary;
};

type ValuationSnapshot = {
  rawMean: number | null;
  combined: number | null;
  weightedCombined: number | null;
  compare1: number | null;
  compare2: number | null;
  compare3: number | null;
};

type ValuationSignalState = {
  longPass: boolean;
  shortPass: boolean;
  signalScore: number | null;
};

export type OptimizerStrategyEvaluation =
  | {
      status: "valid";
      result: Omit<OptimizerStrategyResult, "rank" | "stage" | "strategyId" | "monteCarlo">;
    }
  | {
      status: "invalid_trade_count";
      result: Omit<OptimizerStrategyResult, "rank" | "stage" | "strategyId" | "monteCarlo">;
    }
  | {
      status: "rejected";
      result: Omit<OptimizerStrategyResult, "rank" | "stage" | "strategyId" | "monteCarlo">;
    };

const MIN_TRADES_PER_ASSET = 20;
const MIN_TRADES_PER_YEAR = 8;
const VALUATION_THRESHOLD = 75;
const VALUATION_RESCALE_LENGTH = 100;
const seasonalityCache = new Map<string, SeasonalityPoint[]>();
const WEIGHT_PROFILES: Record<ValuationWeightProfile, { dxy: number; gold: number; us10y: number }> = {
  equal: { dxy: 1 / 3, gold: 1 / 3, us10y: 1 / 3 },
  macro: { dxy: 0.4, gold: 0.25, us10y: 0.35 },
  fx: { dxy: 0.5, gold: 0.2, us10y: 0.3 },
};

function isoDay(value: string): string {
  return new Date(value).toISOString().slice(0, 10);
}

function dayOfYear(value: string): number {
  const dt = new Date(value);
  const start = Date.UTC(dt.getUTCFullYear(), 0, 1);
  const current = Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
  return Math.floor((current - start) / 86_400_000) + 1;
}

function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function std(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const variance = mean(values.map((value) => (value - avg) ** 2));
  return Math.sqrt(variance);
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function toOhlcv(bars: OptimizerDailyBar[]) {
  return bars.map((bar) => ({
    t: bar.t,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: null,
  }));
}

function referenceSeriesToArray(series: OptimizerReferenceSeries): Array<{ t: string; close: number }> {
  return Array.from(series.closesByDate.entries())
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([day, close]) => ({ t: `${day}T00:00:00Z`, close }));
}

function computeAtr(bars: OptimizerDailyBar[], period: number): number[] {
  const out = new Array<number>(bars.length).fill(0);
  let running = 0;
  for (let i = 0; i < bars.length; i += 1) {
    const prevClose = i > 0 ? bars[i - 1].close : bars[i].close;
    const tr = Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - prevClose),
      Math.abs(bars[i].low - prevClose),
    );
    running += tr;
    if (i >= period) {
      const oldPrevClose = i - period > 0 ? bars[i - period - 1].close : bars[i - period].close;
      const oldTr = Math.max(
        bars[i - period].high - bars[i - period].low,
        Math.abs(bars[i - period].high - oldPrevClose),
        Math.abs(bars[i - period].low - oldPrevClose),
      );
      running -= oldTr;
    }
    out[i] = running / Math.min(period, i + 1);
  }
  return out;
}

function buildSeasonalitySeries(assetId: string, bars: OptimizerDailyBar[], holdDays: number, years: number): SeasonalityPoint[] {
  const key = `${assetId}:${holdDays}:${years}:${bars[0]?.t ?? "none"}:${bars[bars.length - 1]?.t ?? "none"}`;
  const cached = seasonalityCache.get(key);
  if (cached) return cached;

  const out: SeasonalityPoint[] = bars.map(() => ({ expectedReturn: 0, direction: "neutral", samples: 0 }));
  for (let i = 0; i < bars.length - holdDays; i += 1) {
    const targetDay = dayOfYear(bars[i].t);
    const currentYear = new Date(bars[i].t).getUTCFullYear();
    const samples: number[] = [];
    for (let j = 0; j < i - holdDays; j += 1) {
      const sampleYear = new Date(bars[j].t).getUTCFullYear();
      if (sampleYear < currentYear - years || sampleYear >= currentYear) continue;
      if (dayOfYear(bars[j].t) !== targetDay) continue;
      const ret = (bars[j + holdDays].close / bars[j].close) - 1;
      if (Number.isFinite(ret)) samples.push(ret);
    }
    const avg = samples.length ? mean(samples) : 0;
    out[i] = {
      expectedReturn: avg,
      direction: avg > 0 ? "long" : avg < 0 ? "short" : "neutral",
      samples: samples.length,
    };
  }
  seasonalityCache.set(key, out);
  return out;
}

function buildEquityCurve(trades: TradeRecord[]): EquityPoint[] {
  let equity = 1;
  return trades.map((trade) => {
    equity *= (1 + trade.returnPct);
    return { t: trade.exitDate, equity };
  });
}

function computeMaxDrawdown(curve: EquityPoint[]): number {
  let peak = 1;
  let worst = 0;
  for (const point of curve) {
    peak = Math.max(peak, point.equity);
    worst = Math.max(worst, peak > 0 ? (peak - point.equity) / peak : 0);
  }
  return worst;
}

function computeCagr(curve: EquityPoint[]): number {
  if (!curve.length) return 0;
  const start = new Date(curve[0].t).getTime();
  const end = new Date(curve[curve.length - 1].t).getTime();
  const years = Math.max(1 / 252, (end - start) / (365.25 * 24 * 60 * 60 * 1000));
  const finalEquity = curve[curve.length - 1].equity;
  return finalEquity > 0 ? (finalEquity ** (1 / years)) - 1 : -1;
}

function computeProfitFactor(returns: number[]): number {
  const grossProfit = returns.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(returns.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));
  if (grossLoss === 0) return grossProfit > 0 ? grossProfit : 0;
  return grossProfit / grossLoss;
}

function computeStability(curve: EquityPoint[]): number {
  if (curve.length < 3) return 0;
  const xs = curve.map((_, index) => index + 1);
  const ys = curve.map((point) => point.equity);
  const avgX = mean(xs);
  const avgY = mean(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i += 1) {
    num += (xs[i] - avgX) * (ys[i] - avgY);
    den += (xs[i] - avgX) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = avgY - (slope * avgX);
  const ssTot = ys.reduce((sum, value) => sum + ((value - avgY) ** 2), 0);
  const ssRes = ys.reduce((sum, value, index) => sum + ((value - (intercept + (slope * xs[index]))) ** 2), 0);
  return ssTot === 0 ? 0 : clamp(1 - (ssRes / ssTot), 0, 1);
}

function computeSharpe(returns: number[]): number {
  if (returns.length < 2) return 0;
  const sigma = std(returns);
  if (sigma === 0) return 0;
  return (mean(returns) / sigma) * Math.sqrt(252 / Math.max(1, mean(returns.map(() => 5))));
}

function metricsFromTrades(assetId: OptimizerAssetId, trades: TradeRecord[]): StrategyAssetMetrics & { equityCurve: EquityPoint[] } {
  const returns = trades.map((trade) => trade.returnPct);
  const equityCurve = buildEquityCurve(trades);
  return {
    assetId,
    sharpe: computeSharpe(returns),
    cagr: computeCagr(equityCurve),
    maxDrawdown: computeMaxDrawdown(equityCurve),
    profitFactor: computeProfitFactor(returns),
    trades: trades.length,
    winRate: trades.length ? trades.filter((trade) => trade.returnPct > 0).length / trades.length : 0,
    equityCurve,
  };
}

function toDebugZone(zone: PineZone): OptimizerDebugZone {
  return {
    id: zone.id,
    kind: zone.kind,
    strength: zone.strength,
    low: zone.low,
    high: zone.high,
    startIndex: zone.startIndex,
    endIndex: zone.endIndex,
    touched: zone.touched,
    broken: zone.broken,
    lastTouchedIndex: zone.lastTouchedIndex,
  };
}

function zoneTouched(bar: OptimizerDailyBar, zone: PineZone): boolean {
  return bar.high >= zone.low && bar.low <= zone.high;
}

function pulledBackIntoZone(previousBar: OptimizerDailyBar | null, zone: PineZone, direction: "long" | "short"): boolean {
  if (!previousBar) return false;
  return direction === "long"
    ? previousBar.close > zone.high
    : previousBar.close < zone.low;
}

function isZoneAllowed(zone: PineZone, params: StrategyParams, kind: "demand" | "supply"): boolean {
  if (zone.kind !== kind || zone.broken) return false;
  if (params.zoneMode === "both") return true;
  if (params.zoneMode === "strong") return zone.strength === "strong";
  return zone.strength === "normal";
}

function valuationSnapshotsByDate(
  points: ReturnType<typeof buildValuationSeries>,
  weightProfile: ValuationWeightProfile,
): Map<string, ValuationSnapshot> {
  const weights = WEIGHT_PROFILES[weightProfile] ?? WEIGHT_PROFILES.equal;
  return new Map(points.map((point) => {
    const raw = [point.compare1, point.compare2, point.compare3].filter((value): value is number => value != null && Number.isFinite(value));
    const weightedCombined =
      point.compare1 != null && point.compare2 != null && point.compare3 != null
        ? (
          (point.compare1 * weights.dxy)
          + (point.compare2 * weights.gold)
          + (point.compare3 * weights.us10y)
        )
        : null;
    return [
      isoDay(point.t),
      {
        rawMean: raw.length ? mean(raw) : null,
        combined: point.combined ?? null,
        weightedCombined: weightedCombined != null ? clamp(weightedCombined, -100, 100) : null,
        compare1: point.compare1 ?? null,
        compare2: point.compare2 ?? null,
        compare3: point.compare3 ?? null,
      },
    ];
  }));
}

function valuationModeSignal(snapshot: ValuationSnapshot | null | undefined, mode: ValuationMode): ValuationSignalState {
  if (!snapshot) return { longPass: false, shortPass: false, signalScore: null };
  const comparisons = [snapshot.compare1, snapshot.compare2, snapshot.compare3].filter((value): value is number => value != null && Number.isFinite(value));
  const longHits = comparisons.filter((value) => value < -VALUATION_THRESHOLD).length;
  const shortHits = comparisons.filter((value) => value > VALUATION_THRESHOLD).length;
  const combined = snapshot.combined;
  const weightedCombined = snapshot.weightedCombined;
  const directionalScore = mode === "WEIGHTED_COMBINED"
    ? weightedCombined
    : mode === "COMBINED"
      ? combined
      : snapshot.rawMean;

  switch (mode) {
    case "ANY_SINGLE":
      return { longPass: longHits >= 1, shortPass: shortHits >= 1, signalScore: directionalScore };
    case "TWO_OF_THREE":
      return { longPass: longHits >= 2, shortPass: shortHits >= 2, signalScore: directionalScore };
    case "ALL_THREE":
      return { longPass: longHits >= 3, shortPass: shortHits >= 3, signalScore: directionalScore };
    case "COMBINED":
      return {
        longPass: combined != null && combined < -VALUATION_THRESHOLD,
        shortPass: combined != null && combined > VALUATION_THRESHOLD,
        signalScore: combined,
      };
    case "WEIGHTED_COMBINED":
      return {
        longPass: weightedCombined != null && weightedCombined < -VALUATION_THRESHOLD,
        shortPass: weightedCombined != null && weightedCombined > VALUATION_THRESHOLD,
        signalScore: weightedCombined,
      };
    default:
      return { longPass: false, shortPass: false, signalScore: directionalScore };
  }
}

function combinePeriodSignals(
  primary: ValuationSignalState,
  secondary: ValuationSignalState | null,
  logic: ValuationMultiPeriodLogic,
): ValuationSignalState {
  if (!secondary || logic === "SINGLE") return primary;
  if (logic === "OR") {
    return {
      longPass: primary.longPass || secondary.longPass,
      shortPass: primary.shortPass || secondary.shortPass,
      signalScore: primary.signalScore ?? secondary.signalScore,
    };
  }
  if (logic === "AND") {
    return {
      longPass: primary.longPass && secondary.longPass,
      shortPass: primary.shortPass && secondary.shortPass,
      signalScore: primary.signalScore != null && secondary.signalScore != null
        ? (primary.signalScore + secondary.signalScore) / 2
        : primary.signalScore ?? secondary.signalScore,
    };
  }
  const primaryScore = primary.signalScore ?? 0;
  const secondaryScore = secondary.signalScore ?? 0;
  return {
    longPass: (primaryScore < 0 && secondaryScore < 0) && (primary.longPass || secondary.longPass),
    shortPass: (primaryScore > 0 && secondaryScore > 0) && (primary.shortPass || secondary.shortPass),
    signalScore: primary.signalScore != null && secondary.signalScore != null
      ? (primary.signalScore + secondary.signalScore) / 2
      : primary.signalScore ?? secondary.signalScore,
  };
}

function buildTradeValidation(assetResults: AssetBacktestResult[], startDate: string, endDate: string): OptimizerTradeValidation {
  const years = Math.max(1, (new Date(endDate).getTime() - new Date(startDate).getTime()) / (365.25 * 24 * 60 * 60 * 1000));
  const totalTrades = assetResults.reduce((sum, result) => sum + result.trades.length, 0);
  const minimumTotalTrades = assetResults.length * MIN_TRADES_PER_ASSET;
  const tradesPerYear = totalTrades / years;
  const assetTradeCounts = assetResults.map((result) => ({
    assetId: result.assetId,
    trades: result.trades.length,
    minimumRequired: MIN_TRADES_PER_ASSET,
  }));
  const underTradedAssets = assetTradeCounts.filter((item) => item.trades < item.minimumRequired);
  const totalInvalid = totalTrades < minimumTotalTrades;
  const yearlyInvalid = tradesPerYear < MIN_TRADES_PER_YEAR;
  const isValid = underTradedAssets.length === 0 && !totalInvalid && !yearlyInvalid;
  const reason = isValid
    ? null
    : "Invalid Strategy (Insufficient Trade Count)";

  return {
    isValid,
    reason,
    minimumTradesPerAsset: MIN_TRADES_PER_ASSET,
    minimumTotalTrades,
    minimumTradesPerYear: MIN_TRADES_PER_YEAR,
    totalTrades,
    tradesPerYear,
    assetTradeCounts,
  };
}

function compositeMetrics(results: AssetBacktestResult[]): StrategyMetrics {
  const assetMetrics = results.map((result) => result.assetMetrics);
  const allTrades = results.flatMap((result) => result.trades).sort((left, right) => left.exitDate.localeCompare(right.exitDate));
  const mergedCurve = buildEquityCurve(allTrades);
  const profitFactor = computeProfitFactor(allTrades.map((trade) => trade.returnPct));
  const sharpe = computeSharpe(allTrades.map((trade) => trade.returnPct));
  const cagr = computeCagr(mergedCurve);
  const maxDrawdown = computeMaxDrawdown(mergedCurve);
  const stability = computeStability(mergedCurve);
  const calmar = maxDrawdown > 0 ? cagr / maxDrawdown : cagr;
  const expectancy = allTrades.length ? mean(allTrades.map((trade) => trade.returnPct)) : 0;
  const medianAssetSharpe = median(assetMetrics.map((item) => item.sharpe));
  const portfolioSharpe = sharpe;
  const worstAssetSharpe = assetMetrics.length ? Math.min(...assetMetrics.map((item) => item.sharpe)) : 0;
  const score = (
    (sharpe * 0.30)
    + (calmar * 0.25)
    + (cagr * 0.20)
    + (profitFactor * 0.15)
    + (stability * 0.10)
    + (medianAssetSharpe * 0.18)
    + (portfolioSharpe * 0.10)
    - (Math.max(0, 1 - worstAssetSharpe) * 0.22)
  );
  return {
    score,
    sharpe,
    calmar,
    cagr,
    profitFactor,
    stability,
    maxDrawdown,
    trades: allTrades.length,
    winRate: allTrades.length ? allTrades.filter((trade) => trade.returnPct > 0).length / allTrades.length : 0,
    expectancy,
    medianAssetSharpe,
    portfolioSharpe,
    worstAssetSharpe,
  };
}

function previewParamsFromConfig(config: OptimizerPreviewResponse["config"]): StrategyParams {
  const zoneMode = config.toggles.allowNormalZones && config.toggles.allowStrongZones
    ? "both"
    : config.toggles.allowStrongZones
      ? "strong"
      : "normal";
  const primaryPeriod = (config.valuationPeriods[0] ?? 10) as ValuationPeriod;
  const secondaryPeriod = (config.valuationPeriods[1] ?? config.valuationPeriods[0] ?? null) as ValuationPeriod | null;
  const primaryMode = config.valuationModes[0] ?? "COMBINED";
  const secondaryMode = secondaryPeriod ? (config.valuationModes[1] ?? config.valuationModes[0] ?? "COMBINED") : null;

  return {
    zoneMode,
    zoneLookback: Math.max(3, Math.round(config.broadRanges.zoneLookback.min)),
    valuationPrimaryPeriod: primaryPeriod,
    valuationSecondaryPeriod: secondaryPeriod && secondaryPeriod !== primaryPeriod ? secondaryPeriod : null,
    valuationPrimaryMode: primaryMode,
    valuationSecondaryMode: secondaryPeriod && secondaryPeriod !== primaryPeriod ? secondaryMode : null,
    valuationMultiPeriodLogic: secondaryPeriod && secondaryPeriod !== primaryPeriod ? (config.valuationMultiPeriodLogics.find((logic) => logic !== "SINGLE") ?? "OR") : "SINGLE",
    valuationWeightProfile: config.valuationWeightProfiles[0] ?? "equal",
    valuationThreshold: VALUATION_THRESHOLD,
    seasonalityYears: Math.max(1, Math.round((config.broadRanges.seasonalityYears.min + config.broadRanges.seasonalityYears.max) / 2)),
    holdDays: Math.max(1, Math.round((config.broadRanges.holdDays.min + config.broadRanges.holdDays.max) / 2)),
    stopMode: "atr",
    atrPeriod: Math.max(2, Math.round((config.broadRanges.atrPeriod.min + config.broadRanges.atrPeriod.max) / 2)),
    atrMultiplier: config.broadRanges.atrMultiplier.min,
    fixedStopPct: config.broadRanges.fixedStopPct.min,
    takeProfitRr: Math.max(0.5, config.broadRanges.takeProfitRr.min),
    breakEvenRr: Math.max(0.25, config.broadRanges.breakEvenRr.min),
    requireCandleConfirmation: config.toggles.requireCandleConfirmation,
    requireValuation: true,
    requireSeasonality: true,
    allowLong: config.toggles.allowLong,
    allowShort: config.toggles.allowShort,
  };
}

function runAssetBacktest(
  dataset: OptimizerAssetDataset,
  params: StrategyParams,
  references: { dxy: OptimizerReferenceSeries; gold: OptimizerReferenceSeries; us10y: OptimizerReferenceSeries },
  integrity: OptimizerCandleIntegrityReport,
  startDate: string,
  endDate: string,
): AssetBacktestResult {
  const bars = dataset.barsD1.filter((bar) => bar.t >= startDate && bar.t <= endDate);
  const ohlcv = toOhlcv(bars);
  const zones = buildSupplyDemandZones(ohlcv, params.zoneLookback);
  const atr = computeAtr(bars, params.atrPeriod);
  const assetSeries = bars.map((bar) => ({ t: bar.t, close: bar.close }));
  const compare1 = referenceSeriesToArray(references.dxy);
  const compare2 = referenceSeriesToArray(references.gold);
  const compare3 = referenceSeriesToArray(references.us10y);
  const valuationPeriods = Array.from(new Set(
    [params.valuationPrimaryPeriod, params.valuationSecondaryPeriod].filter((value): value is ValuationPeriod => value != null),
  ));
  const valuationMaps = new Map<ValuationPeriod, Map<string, ValuationSnapshot>>();
  for (const period of valuationPeriods) {
    const valuationSeries = buildValuationSeries(assetSeries, compare1, compare2, compare3, period, VALUATION_RESCALE_LENGTH, VALUATION_THRESHOLD, -VALUATION_THRESHOLD, "combined");
    valuationMaps.set(period, valuationSnapshotsByDate(valuationSeries, params.valuationWeightProfile));
  }
  const primaryValuationMap = valuationMaps.get(params.valuationPrimaryPeriod) ?? new Map<string, ValuationSnapshot>();
  const secondaryValuationMap = params.valuationSecondaryPeriod != null
    ? (valuationMaps.get(params.valuationSecondaryPeriod) ?? new Map<string, ValuationSnapshot>())
    : null;
  const seasonality = buildSeasonalitySeries(dataset.assetId, bars, params.holdDays, params.seasonalityYears);

  const trades: TradeRecord[] = [];
  const signals: OptimizerDebugSignal[] = [];
  const seasonalityWindows: OptimizerSeasonalityWindow[] = [];
  let candidateSignalCount = 0;
  let qualifyingSignalCount = 0;
  const requiredSeasonalitySamples = Math.max(3, Math.min(5, params.seasonalityYears));
  const firstValuationIndex = bars.findIndex((candidate) => {
    const candidateDay = isoDay(candidate.t);
    return primaryValuationMap.get(candidateDay) != null
      && (secondaryValuationMap == null || secondaryValuationMap.get(candidateDay) != null);
  });
  const firstSeasonalityIndex = seasonality.findIndex((point) => point.samples >= requiredSeasonalitySamples);
  const startIndex = Math.max(
    params.zoneLookback + 3,
    Math.max(1, params.atrPeriod),
    firstValuationIndex >= 0 ? firstValuationIndex : bars.length,
    firstSeasonalityIndex >= 0 ? firstSeasonalityIndex : bars.length,
  );

  let index = startIndex;
  while (index < bars.length - Math.max(2, params.holdDays)) {
    const bar = bars[index];
    const previousBar = index > 0 ? bars[index - 1] : null;
    const barDay = isoDay(bar.t);
    const candleBull = bar.close > bar.open;
    const candleBear = bar.close < bar.open;
    const primarySnapshot = primaryValuationMap.get(barDay) ?? null;
    const secondarySnapshot = secondaryValuationMap?.get(barDay) ?? null;
    const primaryValuationSignal = valuationModeSignal(primarySnapshot, params.valuationPrimaryMode);
    const secondaryValuationSignal = secondarySnapshot && params.valuationSecondaryMode
      ? valuationModeSignal(secondarySnapshot, params.valuationSecondaryMode)
      : null;
    const valuationSignal = combinePeriodSignals(
      primaryValuationSignal,
      secondaryValuationSignal,
      params.valuationMultiPeriodLogic,
    );
    const valuationPassLong = valuationSignal.longPass;
    const valuationPassShort = valuationSignal.shortPass;
    const seasonPoint = seasonality[index] ?? { expectedReturn: 0, direction: "neutral" as const, samples: 0 };
    const seasonalityPassLong = seasonPoint.samples >= requiredSeasonalitySamples && seasonPoint.direction === "long";
    const seasonalityPassShort = seasonPoint.samples >= requiredSeasonalitySamples && seasonPoint.direction === "short";
    const activeZones = zones.filter((zone) => zone.startIndex < index && zone.endIndex >= index && !zone.broken);
    const activeDemandZones = activeZones.filter((zone) => (
      isZoneAllowed(zone, params, "demand")
      && zoneTouched(bar, zone)
      && pulledBackIntoZone(previousBar, zone, "long")
    ));
    const activeSupplyZones = activeZones.filter((zone) => (
      isZoneAllowed(zone, params, "supply")
      && zoneTouched(bar, zone)
      && pulledBackIntoZone(previousBar, zone, "short")
    ));
    const longZone = activeDemandZones.sort((left, right) => {
      if (left.strength !== right.strength) return left.strength === "strong" ? -1 : 1;
      return (right.lastTouchedIndex ?? -1) - (left.lastTouchedIndex ?? -1);
    })[0] ?? null;
    const shortZone = activeSupplyZones.sort((left, right) => {
      if (left.strength !== right.strength) return left.strength === "strong" ? -1 : 1;
      return (right.lastTouchedIndex ?? -1) - (left.lastTouchedIndex ?? -1);
    })[0] ?? null;
    const baseLongSignal =
      params.allowLong
      && Boolean(longZone)
      && (!params.requireCandleConfirmation || candleBull)
      && (!params.requireSeasonality || seasonalityPassLong);
    const baseShortSignal =
      params.allowShort
      && Boolean(shortZone)
      && (!params.requireCandleConfirmation || candleBear)
      && (!params.requireSeasonality || seasonalityPassShort);

    candidateSignalCount += (baseLongSignal ? 1 : 0) + (baseShortSignal ? 1 : 0);

    const longSignal =
      baseLongSignal
      && (!params.requireValuation || valuationPassLong)
      && primaryValuationSignal.signalScore != null;
    const shortSignal =
      baseShortSignal
      && (!params.requireValuation || valuationPassShort)
      && primaryValuationSignal.signalScore != null;

    if (!longSignal && !shortSignal) {
      index += 1;
      continue;
    }
    if (longSignal && shortSignal) {
      index += 1;
      continue;
    }

    qualifyingSignalCount += 1;
    const direction: "long" | "short" = longSignal ? "long" : "short";
    const activeZone = longSignal ? longZone : shortZone;
    const entryPrice = bar.close;
    const atrDistance = Math.max(atr[index], entryPrice * 0.002);
    const riskDistance = params.stopMode === "atr"
      ? atrDistance * params.atrMultiplier
      : entryPrice * (params.fixedStopPct / 100);
    const initialStop = direction === "long" ? entryPrice - riskDistance : entryPrice + riskDistance;
    const takeProfit = direction === "long"
      ? entryPrice + (riskDistance * params.takeProfitRr)
      : entryPrice - (riskDistance * params.takeProfitRr);

    signals.push({
      assetId: dataset.assetId,
      barIndex: index,
      time: bar.t,
      direction,
      zoneId: activeZone?.id ?? null,
      valuationScorePrimary: primaryValuationSignal.signalScore,
      valuationScoreSecondary: secondaryValuationSignal?.signalScore ?? null,
      valuationPass: direction === "long" ? valuationPassLong : valuationPassShort,
      seasonalityPass: direction === "long" ? seasonalityPassLong : seasonalityPassShort,
      seasonalityDirection: seasonPoint.direction,
      seasonalityScore: seasonPoint.expectedReturn,
      candleConfirmation: direction === "long" ? candleBull : candleBear,
    });
    seasonalityWindows.push({
      startIndex: index,
      endIndex: Math.min(bars.length - 1, index + params.holdDays),
      direction,
      score: seasonPoint.expectedReturn,
      holdDays: params.holdDays,
    });

    let stopPrice = initialStop;
    let exitPrice = bars[Math.min(bars.length - 1, index + params.holdDays)].close;
    let exitIndex = Math.min(bars.length - 1, index + params.holdDays);
    let stopHit = false;
    let takeProfitHit = false;
    let breakEvenTriggered = false;
    let exitReason: TradeRecord["exitReason"] = "time";

    for (let j = index + 1; j <= Math.min(bars.length - 1, index + params.holdDays); j += 1) {
      const nextBar = bars[j];
      const favorableMove = direction === "long" ? nextBar.high - entryPrice : entryPrice - nextBar.low;
      if (!breakEvenTriggered && favorableMove >= (riskDistance * params.breakEvenRr)) {
        stopPrice = entryPrice;
        breakEvenTriggered = true;
      }

      const stopTouched = direction === "long" ? nextBar.low <= stopPrice : nextBar.high >= stopPrice;
      const targetTouched = direction === "long" ? nextBar.high >= takeProfit : nextBar.low <= takeProfit;
      if (stopTouched) {
        exitPrice = stopPrice;
        exitIndex = j;
        stopHit = true;
        exitReason = "stop";
        break;
      }
      if (targetTouched) {
        exitPrice = takeProfit;
        exitIndex = j;
        takeProfitHit = true;
        exitReason = "target";
        break;
      }
      exitPrice = nextBar.close;
      exitIndex = j;
    }

    const returnPct = direction === "long"
      ? (exitPrice / entryPrice) - 1
      : (entryPrice / exitPrice) - 1;

    trades.push({
      assetId: dataset.assetId,
      direction,
      entryDate: bar.t,
      exitDate: bars[exitIndex].t,
      entryIndex: index,
      exitIndex,
      holdDays: Math.max(1, exitIndex - index),
      entryPrice,
      exitPrice,
      stopPrice: initialStop,
      takeProfitPrice: takeProfit,
      returnPct,
      stopHit,
      takeProfitHit,
      breakEvenTriggered,
      exitReason,
    });

    index = exitIndex + 1;
  }

  const metrics = metricsFromTrades(dataset.assetId, trades);
  const valuationWindows = bars.map((bar, barIndex) => {
    const barDay = isoDay(bar.t);
    const primarySignal = valuationModeSignal(primaryValuationMap.get(barDay) ?? null, params.valuationPrimaryMode);
    const secondarySignal = secondaryValuationMap && params.valuationSecondaryMode
      ? valuationModeSignal(secondaryValuationMap.get(barDay) ?? null, params.valuationSecondaryMode)
      : null;
    const combinedSignal = combinePeriodSignals(primarySignal, secondarySignal, params.valuationMultiPeriodLogic);
    return {
      barIndex,
      time: bar.t,
      valuationScorePrimary: primarySignal.signalScore,
      valuationScoreSecondary: secondarySignal?.signalScore ?? null,
      longPass: combinedSignal.longPass,
      shortPass: combinedSignal.shortPass,
    };
  });
  const contributionReturn = trades.reduce((sum, trade) => sum + trade.returnPct, 0);

  return {
    assetId: dataset.assetId,
    trades,
    equityCurve: metrics.equityCurve,
    assetMetrics: {
      assetId: dataset.assetId,
      sharpe: metrics.sharpe,
      cagr: metrics.cagr,
      maxDrawdown: metrics.maxDrawdown,
      profitFactor: metrics.profitFactor,
      trades: metrics.trades,
      winRate: metrics.winRate,
    },
    debugAsset: {
      assetId: dataset.assetId,
      symbol: dataset.symbol,
      candles: bars,
      zones: zones.map(toDebugZone),
      signals,
      valuationWindows,
      seasonalityWindows,
      trades,
      integrity,
    },
    valuation: {
      periods: valuationPeriods,
      primaryPeriod: params.valuationPrimaryPeriod,
      secondaryPeriod: params.valuationSecondaryPeriod,
      primaryMode: params.valuationPrimaryMode,
      secondaryMode: params.valuationSecondaryMode,
      multiPeriodLogic: params.valuationMultiPeriodLogic,
      weightProfile: params.valuationWeightProfile,
      threshold: VALUATION_THRESHOLD,
      signalDensity: bars.length ? qualifyingSignalCount / bars.length : 0,
      candidateSignals: candidateSignalCount,
      qualifyingSignals: qualifyingSignalCount,
      contributionReturn,
    },
  };
}

export function buildOptimizerPreview(
  config: OptimizerPreviewResponse["config"],
  data: OptimizerLoadedData,
  selectedAssetId: OptimizerAssetId,
): OptimizerPreviewResponse {
  const asset = data.assets.find((item) => item.assetId === selectedAssetId) ?? data.assets[0] ?? null;
  const integrityMap = new Map(data.integrity.map((item) => [item.assetId, item]));
  const previewAsset = asset
    ? runAssetBacktest(
        asset,
        previewParamsFromConfig(config),
        data.references,
        integrityMap.get(asset.assetId) ?? {
          assetId: asset.assetId,
          symbol: asset.symbol,
          candleCount: asset.barsD1.length,
          invalidHighLowCount: 0,
          flatRangeCount: 0,
          openEqualsCloseCount: 0,
          invalidHighLowRatio: 0,
          flatRangeRatio: 0,
          openEqualsCloseRatio: 0,
          warnings: [],
          isValid: true,
        },
        asset.barsD1[0]?.t ?? "2012-01-01T00:00:00Z",
        asset.barsD1[asset.barsD1.length - 1]?.t ?? "2025-12-31T00:00:00Z",
      ).debugAsset
    : null;

  return {
    generatedAt: new Date().toISOString(),
    config,
    coverage: data.coverage,
    integrity: data.integrity,
    selectedAssetId: asset?.assetId ?? selectedAssetId,
    previewAsset,
    warnings: data.warnings,
    requiresConfirmation: data.integrity.some((item) => !item.isValid),
  };
}

export function evaluateStrategyCandidate(
  params: StrategyParams,
  datasets: OptimizerAssetDataset[],
  references: { dxy: OptimizerReferenceSeries; gold: OptimizerReferenceSeries; us10y: OptimizerReferenceSeries },
  integrityReports: OptimizerCandleIntegrityReport[],
  startDate: string,
  endDate: string,
  options?: { enforceFilters?: boolean },
): OptimizerStrategyEvaluation {
  const integrityMap = new Map(integrityReports.map((item) => [item.assetId, item]));
  const assetResults = datasets.map((dataset) =>
    runAssetBacktest(
      dataset,
      {
        ...params,
        valuationThreshold: VALUATION_THRESHOLD,
        requireValuation: true,
        requireSeasonality: true,
      },
      references,
      integrityMap.get(dataset.assetId) ?? {
        assetId: dataset.assetId,
        symbol: dataset.symbol,
        candleCount: dataset.barsD1.length,
        invalidHighLowCount: 0,
        flatRangeCount: 0,
        openEqualsCloseCount: 0,
        invalidHighLowRatio: 0,
        flatRangeRatio: 0,
        openEqualsCloseRatio: 0,
        warnings: [],
        isValid: true,
      },
      startDate,
      endDate,
    ),
  );
  const validation = buildTradeValidation(assetResults, startDate, endDate);
  const metrics = compositeMetrics(assetResults);
  const result = {
    params: {
      ...params,
      valuationThreshold: VALUATION_THRESHOLD,
      requireValuation: true,
      requireSeasonality: true,
    },
    valuation: {
      periods: Array.from(new Set(assetResults.flatMap((item) => item.valuation.periods))),
      primaryPeriod: params.valuationPrimaryPeriod,
      secondaryPeriod: params.valuationSecondaryPeriod,
      primaryMode: params.valuationPrimaryMode,
      secondaryMode: params.valuationSecondaryMode,
      multiPeriodLogic: params.valuationMultiPeriodLogic,
      weightProfile: params.valuationWeightProfile,
      threshold: VALUATION_THRESHOLD,
      signalDensity: mean(assetResults.map((item) => item.valuation.signalDensity)),
      candidateSignals: assetResults.reduce((sum, item) => sum + item.valuation.candidateSignals, 0),
      qualifyingSignals: assetResults.reduce((sum, item) => sum + item.valuation.qualifyingSignals, 0),
      contributionReturn: assetResults.reduce((sum, item) => sum + item.valuation.contributionReturn, 0),
    },
    metrics,
    assetMetrics: assetResults.map((item) => item.assetMetrics),
    equityCurve: buildEquityCurve(assetResults.flatMap((item) => item.trades).sort((left, right) => left.exitDate.localeCompare(right.exitDate))),
    trades: assetResults.flatMap((item) => item.trades),
    validation,
    debugAssets: assetResults.map((item) => item.debugAsset),
  };

  if (!validation.isValid) {
    return {
      status: "invalid_trade_count",
      result,
    };
  }

  const enforceFilters = options?.enforceFilters ?? true;
  if (
    enforceFilters
    && (metrics.sharpe <= 1.2 || metrics.profitFactor <= 1.3 || metrics.maxDrawdown >= 0.35)
  ) {
    return {
      status: "rejected",
      result,
    };
  }

  return {
    status: "valid",
    result,
  };
}
