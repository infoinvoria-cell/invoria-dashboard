import type {
  EquityPoint,
  OptimizerAssetId,
  OptimizerStrategyResult,
  StrategyAssetMetrics,
  StrategyMetrics,
  StrategyParams,
  TradeRecord,
} from "@/lib/optimizer/types";
import type { OptimizerAssetDataset, OptimizerDailyBar, OptimizerReferenceSeries } from "@/lib/server/optimizer/data";

type Zone = {
  kind: "demand" | "supply";
  low: number;
  high: number;
  formedAt: number;
  broken: boolean;
  strong: boolean;
};

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
};

const seasonalityCache = new Map<string, SeasonalityPoint[]>();

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

function closesByDate(series: OptimizerReferenceSeries): Map<string, number> {
  return series.closesByDate;
}

function computeValuationSeries(
  bars: OptimizerDailyBar[],
  length: 10 | 20,
  references: { dxy: OptimizerReferenceSeries; gold: OptimizerReferenceSeries; us30y: OptimizerReferenceSeries },
): number[] {
  const referenceMaps = [closesByDate(references.dxy), closesByDate(references.gold), closesByDate(references.us30y)];
  const out = new Array<number>(bars.length).fill(0);
  const diffHistory: number[][] = [[], [], []];
  for (let i = 0; i < bars.length; i += 1) {
    if (i < length) {
      out[i] = 0;
      continue;
    }
    const assetReturn = (bars[i].close / bars[i - length].close) - 1;
    const day = isoDay(bars[i].t);
    const lengthDay = isoDay(bars[i - length].t);
    const normalizedValues: number[] = [];
    for (let r = 0; r < referenceMaps.length; r += 1) {
      const end = referenceMaps[r].get(day);
      const start = referenceMaps[r].get(lengthDay);
      if (!end || !start) continue;
      const diff = assetReturn - ((end / start) - 1);
      diffHistory[r].push(diff);
      const recent = diffHistory[r].slice(-100);
      const min = Math.min(...recent);
      const max = Math.max(...recent);
      const scaled = Math.abs(max - min) < 1e-9 ? 0 : (((diff - min) / (max - min)) * 200) - 100;
      normalizedValues.push(clamp(scaled, -100, 100));
    }
    out[i] = normalizedValues.length ? mean(normalizedValues) : 0;
  }
  return out;
}

function buildSeasonalitySeries(assetId: string, bars: OptimizerDailyBar[], holdDays: number, years: number): SeasonalityPoint[] {
  const key = `${assetId}:${holdDays}:${years}`;
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

function updateZones(bars: OptimizerDailyBar[], index: number, zones: Zone[], lookback: number): Zone[] {
  if (index < Math.max(2, lookback)) return zones;
  const prev = bars[index - 1];
  const prev2 = bars[index - 2];
  const current = bars[index];
  const nextZones = zones.map((zone) => {
    if (zone.broken) return zone;
    if (zone.kind === "demand" && current.close < zone.low) return { ...zone, broken: true };
    if (zone.kind === "supply" && current.close > zone.high) return { ...zone, broken: true };
    return zone;
  });

  if (prev.low < prev2.low && prev.low < current.low) {
    nextZones.push({
      kind: "demand",
      low: prev.low,
      high: Math.max(prev.open, prev.close),
      formedAt: index - 1,
      broken: false,
      strong: false,
    });
  }
  if (prev.high > prev2.high && prev.high > current.high) {
    nextZones.push({
      kind: "supply",
      low: Math.min(prev.open, prev.close),
      high: prev.high,
      formedAt: index - 1,
      broken: false,
      strong: false,
    });
  }
  if (index >= 2) {
    const a = bars[index - 2];
    const c = bars[index];
    if (a.high < c.low) {
      nextZones.push({
        kind: "demand",
        low: a.high,
        high: c.low,
        formedAt: index,
        broken: false,
        strong: true,
      });
    }
    if (a.low > c.high) {
      nextZones.push({
        kind: "supply",
        low: c.high,
        high: a.low,
        formedAt: index,
        broken: false,
        strong: true,
      });
    }
  }
  return nextZones.filter((zone) => index - zone.formedAt <= Math.max(lookback * 8, 30));
}

function zoneTouch(bar: OptimizerDailyBar, zones: Zone[], kind: "demand" | "supply", strongOnly: boolean): boolean {
  return zones.some((zone) => {
    if (zone.kind !== kind || zone.broken) return false;
    if (strongOnly && !zone.strong) return false;
    if (!strongOnly && zone.strong) return false;
    if (kind === "demand") return bar.low <= zone.high && bar.close >= zone.low;
    return bar.high >= zone.low && bar.close <= zone.high;
  });
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

function metricsFromTrades(assetId: OptimizerAssetId, trades: TradeRecord[]): StrategyAssetMetrics & { equityCurve: EquityPoint[]; expectancy: number; stability: number } {
  const returns = trades.map((trade) => trade.returnPct);
  const equityCurve = buildEquityCurve(trades);
  const sharpe = computeSharpe(returns);
  const cagr = computeCagr(equityCurve);
  const maxDrawdown = computeMaxDrawdown(equityCurve);
  const profitFactor = computeProfitFactor(returns);
  const winRate = trades.length ? trades.filter((trade) => trade.returnPct > 0).length / trades.length : 0;
  const expectancy = trades.length ? mean(returns) : 0;
  const stability = computeStability(equityCurve);
  return {
    assetId,
    sharpe,
    cagr,
    maxDrawdown,
    profitFactor,
    trades: trades.length,
    winRate,
    equityCurve,
    expectancy,
    stability,
  };
}

function runAssetBacktest(
  dataset: OptimizerAssetDataset,
  params: StrategyParams,
  references: { dxy: OptimizerReferenceSeries; gold: OptimizerReferenceSeries; us30y: OptimizerReferenceSeries },
  startDate: string,
  endDate: string,
): AssetBacktestResult {
  const bars = dataset.barsD1.filter((bar) => bar.t >= startDate && bar.t <= endDate);
  const atr = computeAtr(bars, params.atrPeriod);
  const valuation = computeValuationSeries(bars, params.valuationLength, references);
  const seasonality = buildSeasonalitySeries(dataset.assetId, bars, params.holdDays, params.seasonalityYears);
  const trades: TradeRecord[] = [];
  let zones: Zone[] = [];
  let index = Math.max(params.zoneLookback + 2, params.valuationLength + 2);

  while (index < bars.length - Math.max(2, params.holdDays)) {
    zones = updateZones(bars, index, zones, params.zoneLookback);
    const bar = bars[index];
    const strongDemandTouch = zoneTouch(bar, zones, "demand", true);
    const strongSupplyTouch = zoneTouch(bar, zones, "supply", true);
    const normalDemandTouch = zoneTouch(bar, zones, "demand", false);
    const normalSupplyTouch = zoneTouch(bar, zones, "supply", false);

    const demandTouch = params.zoneMode === "strong"
      ? strongDemandTouch
      : params.zoneMode === "normal"
        ? normalDemandTouch
        : strongDemandTouch || normalDemandTouch;
    const supplyTouch = params.zoneMode === "strong"
      ? strongSupplyTouch
      : params.zoneMode === "normal"
        ? normalSupplyTouch
        : strongSupplyTouch || normalSupplyTouch;

    const candleBull = bar.close > bar.open;
    const candleBear = bar.close < bar.open;
    const season = seasonality[index] ?? { expectedReturn: 0, direction: "neutral" as const, samples: 0 };
    const valuationValue = valuation[index];

    const longSignal =
      params.allowLong
      && demandTouch
      && (!params.requireCandleConfirmation || candleBull)
      && (!params.requireValuation || valuationValue <= -Math.abs(params.valuationThreshold))
      && (!params.requireSeasonality || (season.samples >= 3 && season.direction === "long"));
    const shortSignal =
      params.allowShort
      && supplyTouch
      && (!params.requireCandleConfirmation || candleBear)
      && (!params.requireValuation || valuationValue >= Math.abs(params.valuationThreshold))
      && (!params.requireSeasonality || (season.samples >= 3 && season.direction === "short"));

    if (!longSignal && !shortSignal) {
      index += 1;
      continue;
    }
    if (longSignal && shortSignal) {
      index += 1;
      continue;
    }

    const direction: "long" | "short" = longSignal ? "long" : "short";
    const entryPrice = bar.close;
    const atrDistance = Math.max(atr[index], entryPrice * 0.002);
    const riskDistance = params.stopMode === "atr"
      ? atrDistance * params.atrMultiplier
      : entryPrice * (params.fixedStopPct / 100);
    const initialStop = direction === "long" ? entryPrice - riskDistance : entryPrice + riskDistance;
    const takeProfit = direction === "long"
      ? entryPrice + (riskDistance * params.takeProfitRr)
      : entryPrice - (riskDistance * params.takeProfitRr);

    let stopPrice = initialStop;
    let exitPrice = bars[Math.min(bars.length - 1, index + params.holdDays)].close;
    let exitIndex = Math.min(bars.length - 1, index + params.holdDays);
    let stopHit = false;
    let takeProfitHit = false;
    let breakEvenTriggered = false;

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
        break;
      }
      if (targetTouched) {
        exitPrice = takeProfit;
        exitIndex = j;
        takeProfitHit = true;
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
      holdDays: Math.max(1, exitIndex - index),
      entryPrice,
      exitPrice,
      returnPct,
      stopHit,
      takeProfitHit,
      breakEvenTriggered,
    });

    index = exitIndex + 1;
  }

  const metrics = metricsFromTrades(dataset.assetId, trades);
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
  };
}

function compositeMetrics(results: AssetBacktestResult[]): StrategyMetrics {
  const assetMetrics = results.map((result) => result.assetMetrics);
  const allTrades = results.flatMap((result) => result.trades);
  const mergedCurve = buildEquityCurve(allTrades.sort((left, right) => left.exitDate.localeCompare(right.exitDate)));
  const profitFactor = computeProfitFactor(allTrades.map((trade) => trade.returnPct));
  const sharpe = computeSharpe(allTrades.map((trade) => trade.returnPct));
  const cagr = computeCagr(mergedCurve);
  const maxDrawdown = computeMaxDrawdown(mergedCurve);
  const stability = computeStability(mergedCurve);
  const calmar = maxDrawdown > 0 ? cagr / maxDrawdown : cagr;
  const expectancy = allTrades.length ? mean(allTrades.map((trade) => trade.returnPct)) : 0;
  const medianAssetSharpe = median(assetMetrics.map((item) => item.sharpe));
  const portfolioSharpe = sharpe;
  const worstAssetSharpe = Math.min(...assetMetrics.map((item) => item.sharpe));
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

export function evaluateStrategyCandidate(
  params: StrategyParams,
  datasets: OptimizerAssetDataset[],
  references: { dxy: OptimizerReferenceSeries; gold: OptimizerReferenceSeries; us30y: OptimizerReferenceSeries },
  startDate: string,
  endDate: string,
  options?: { enforceFilters?: boolean },
): Omit<OptimizerStrategyResult, "rank" | "stage" | "strategyId" | "monteCarlo"> | null {
  const assetResults = datasets.map((dataset) => runAssetBacktest(dataset, params, references, startDate, endDate));
  const metrics = compositeMetrics(assetResults);
  const enforceFilters = options?.enforceFilters ?? true;
  if (
    enforceFilters
    && (metrics.trades <= 150 || metrics.sharpe <= 1.2 || metrics.profitFactor <= 1.3 || metrics.maxDrawdown >= 0.35)
  ) {
    return null;
  }
  return {
    params,
    metrics,
    assetMetrics: assetResults.map((result) => result.assetMetrics),
    equityCurve: buildEquityCurve(assetResults.flatMap((result) => result.trades).sort((left, right) => left.exitDate.localeCompare(right.exitDate))),
    trades: assetResults.flatMap((result) => result.trades),
  };
}
