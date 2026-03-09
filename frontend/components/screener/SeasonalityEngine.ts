import type {
  HeatmapCombinedItem,
  HeatmapSeasonalityItem,
  HeatmapSupplyDemandItem,
  HeatmapValuationItem,
  OhlcvPoint,
  TimeseriesResponse,
} from "@/types";
import type {
  ClusterPoint,
  ScreenerCluster,
  ScreenerRowData,
  ScreenerSupplyDemand,
  ScreenerValuation,
  SeasonalityControlValues,
} from "@/components/screener/types";
import { computeLiquidityProfile } from "@/components/screener/LiquidityFilter";
import { detectOrderBlock } from "@/components/screener/OrderBlockDetector";

const rowCache = new Map<string, ScreenerRowData>();

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

function stdDev(values: number[]): number {
  const avg = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - avg) ** 2)));
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

function normalizePercentScore(value: number, scale: number): number {
  return clamp(Math.abs(value) * scale, 0, 100);
}

function signalStrengthLabel(score: number): "Weak" | "Balanced" | "Strong" | "Elite" {
  if (score >= 82) return "Elite";
  if (score >= 68) return "Strong";
  if (score >= 50) return "Balanced";
  return "Weak";
}

function buildValuation(raw: number, probability: number): ScreenerValuation {
  const strength = normalizePercentScore(raw, 1.2);
  const combined = clamp((strength * 0.45) + (probability * 0.55), 0, 100);
  return {
    strength,
    probability,
    combined,
    raw,
  };
}

function buildSupplyDemand(
  row: HeatmapSupplyDemandItem | undefined,
  timeseries: TimeseriesResponse | null,
  variant: "base" | "plus",
): ScreenerSupplyDemand {
  const demandDistance = Number(timeseries?.indicators?.distanceToDemand ?? row?.distanceToDemandPct ?? NaN);
  const supplyDistance = Number(timeseries?.indicators?.distanceToSupply ?? row?.distanceToSupplyPct ?? NaN);
  const demandZones = timeseries?.supplyDemand?.demand ?? [];
  const supplyZones = timeseries?.supplyDemand?.supply ?? [];
  const zoneCount = demandZones.length + supplyZones.length;
  const demandValid = Number.isFinite(demandDistance);
  const supplyValid = Number.isFinite(supplyDistance);
  const tone =
    demandValid && (!supplyValid || demandDistance <= supplyDistance)
      ? "demand"
      : supplyValid
        ? "supply"
        : row?.status === "demand"
          ? "demand"
          : row?.status === "supply"
            ? "supply"
            : "neutral";
  const distancePct =
    tone === "demand"
      ? (demandValid ? demandDistance : Number(row?.distanceToDemandPct ?? null))
      : tone === "supply"
        ? (supplyValid ? supplyDistance : Number(row?.distanceToSupplyPct ?? null))
        : null;
  const baseScore = Number(row?.score ?? 50);
  const scoreBoost = variant === "plus" ? (zoneCount >= 3 ? 14 : zoneCount >= 2 ? 7 : 0) : 0;
  const score = clamp(baseScore + scoreBoost - ((distancePct ?? 6) * 4), 0, 100);
  const prefix =
    tone === "demand"
      ? "Demand"
      : tone === "supply"
        ? "Supply"
        : "Neutral";
  const suffix = distancePct == null ? "n/a" : `${distancePct.toFixed(1)}%`;
  return {
    label: variant === "plus" ? `${prefix}+ ${suffix}` : `${prefix} ${suffix}`,
    tone,
    score,
    distancePct: Number.isFinite(distancePct ?? NaN) ? distancePct : null,
    zoneCount,
  };
}

function computeSignal(item: HeatmapCombinedItem | undefined, seasonality: HeatmapSeasonalityItem | undefined): "bullish" | "bearish" | "neutral" {
  const seasonDirection = String(seasonality?.direction ?? "").toUpperCase();
  if (seasonDirection === "LONG") return "bullish";
  if (seasonDirection === "SHORT") return "bearish";
  const momentum = Number(item?.signed?.momentum ?? 0);
  if (momentum > 0.15) return "bullish";
  if (momentum < -0.15) return "bearish";
  return "neutral";
}

function computeAge(lastCandles: OhlcvPoint[], signal: "bullish" | "bearish" | "neutral"): number {
  if (!lastCandles.length || signal === "neutral") return 0;
  const candles = lastCandles.slice(-24);
  for (let index = candles.length - 1; index >= 0; index -= 1) {
    const row = candles[index];
    const bullish = row.close > row.open;
    const bearish = row.close < row.open;
    if ((signal === "bullish" && bullish) || (signal === "bearish" && bearish)) {
      return candles.length - 1 - index;
    }
  }
  return candles.length;
}

function buildFallbackCluster(seasonality: HeatmapSeasonalityItem | undefined, offsetDays: number): ScreenerCluster {
  const direction = String(seasonality?.direction ?? "LONG").toUpperCase() === "SHORT" ? "bearish" : "bullish";
  const holdDays = clamp(Number(seasonality?.bestHoldPeriod ?? 15), 5, 40);
  const avgReturn = Number(seasonality?.expectedReturn ?? seasonality?.expectedValue ?? 0) / 100;
  const hitRate = clamp(Number(seasonality?.hitRate ?? 0.54), 0, 1);
  const curveValues = Array.isArray(seasonality?.curve) && seasonality.curve.length
    ? seasonality.curve
    : Array.from({ length: holdDays }, (_, index) => avgReturn * ((index + 1) / holdDays));
  const curve: ClusterPoint[] = curveValues.slice(0, holdDays).map((value, index) => ({
    step: index,
    value: Number(value) / 100,
  }));
  const start = dayOfYear(new Date()) + offsetDays;
  const fromLabel = formatMonthDay(start);
  const toLabel = formatMonthDay(start + holdDays);
  const confidence = clamp((hitRate * 55) + (Math.abs(avgReturn) * 2200), 0, 100);
  return {
    hitRate,
    avgReturn,
    fromLabel,
    toLabel,
    holdDays,
    confidence,
    direction,
    curve,
    samples: 10,
  };
}

type CandidateCluster = {
  score: number;
  cluster: ScreenerCluster;
};

function buildClusterCandidates(
  ohlcv: OhlcvPoint[],
  controls: SeasonalityControlValues,
  startDayMin: number,
  startDayMax: number,
): CandidateCluster[] {
  if (ohlcv.length < 120) return [];
  const now = new Date();
  const cutoffYear = now.getUTCFullYear() - controls.historicalYears;
  const grouped = new Map<number, OhlcvPoint[]>();
  for (const row of ohlcv) {
    const date = new Date(row.t);
    if (date.getUTCFullYear() < cutoffYear) continue;
    const year = date.getUTCFullYear();
    const list = grouped.get(year) ?? [];
    list.push(row);
    grouped.set(year, list);
  }

  const candidates: CandidateCluster[] = [];
  for (let startDay = startDayMin; startDay <= startDayMax; startDay += 1) {
    for (let holdDays = controls.seasonalityMinDays; holdDays <= controls.seasonalityMaxDays; holdDays += 1) {
      const sampleReturns: number[] = [];
      const samplePaths: number[][] = [];
      for (const rows of grouped.values()) {
        const startIndex = rows.findIndex((row) => dayOfYear(new Date(row.t)) >= startDay);
        if (startIndex < 0) continue;
        const endIndex = startIndex + holdDays;
        if (endIndex >= rows.length) continue;
        const startPrice = rows[startIndex].close;
        const endPrice = rows[endIndex].close;
        if (!(startPrice > 0) || !(endPrice > 0)) continue;
        const totalReturn = endPrice / startPrice - 1;
        sampleReturns.push(totalReturn);
        const curve: number[] = [];
        for (let step = 0; step <= holdDays; step += 1) {
          const currentPrice = rows[startIndex + step]?.close ?? startPrice;
          curve.push(currentPrice / startPrice - 1);
        }
        samplePaths.push(curve);
      }

      if (sampleReturns.length < Math.max(4, controls.historicalYears - 2)) continue;
      const avgReturn = mean(sampleReturns);
      const bullishHit = sampleReturns.filter((value) => value > 0).length / sampleReturns.length;
      const bearishHit = sampleReturns.filter((value) => value < 0).length / sampleReturns.length;
      const direction = avgReturn >= 0 ? "bullish" : "bearish";
      const hitRate = direction === "bullish" ? bullishHit : bearishHit;
      const curve: ClusterPoint[] = Array.from({ length: holdDays + 1 }, (_, step) => ({
        step,
        value: mean(samplePaths.map((path) => path[step] ?? path[path.length - 1] ?? 0)),
      }));
      const confidence = clamp((hitRate * 62) + (Math.abs(avgReturn) * 2500) + (sampleReturns.length * 1.5), 0, 100);
      const cluster: ScreenerCluster = {
        hitRate,
        avgReturn,
        fromLabel: formatMonthDay(startDay),
        toLabel: formatMonthDay(startDay + holdDays),
        holdDays,
        confidence,
        direction,
        curve,
        samples: sampleReturns.length,
      };
      const score = confidence + (Math.abs(avgReturn) * 1400);
      candidates.push({ score, cluster });
    }
  }

  return candidates.sort((left, right) => right.score - left.score);
}

function buildSeasonalityClusters(
  timeseries: TimeseriesResponse | null,
  seasonalityFallback: HeatmapSeasonalityItem | undefined,
  controls: SeasonalityControlValues,
): { currentCluster: ScreenerCluster; nextCluster: ScreenerCluster; graphCurve: ClusterPoint[]; graphProgress: number } {
  const ohlcv = timeseries?.ohlcv ?? [];
  const today = dayOfYear(new Date());
  const currentCandidates = buildClusterCandidates(ohlcv, controls, today - 6, today + 8);
  const currentCluster = currentCandidates[0]?.cluster ?? buildFallbackCluster(seasonalityFallback, 0);
  const nextCandidates = buildClusterCandidates(ohlcv, controls, today + currentCluster.holdDays - 3, today + currentCluster.holdDays + 10);
  const nextCluster = nextCandidates[0]?.cluster ?? buildFallbackCluster(seasonalityFallback, currentCluster.holdDays);
  const graphCurve = currentCluster.curve;
  const graphProgress = clamp((timeseries?.ohlcv?.length ?? 0) > currentCluster.holdDays ? 1 : (ohlcv.length / Math.max(currentCluster.holdDays, 1)), 0, 1);
  return { currentCluster, nextCluster, graphCurve, graphProgress };
}

function detectVolatilityRegime(timeseries: TimeseriesResponse | null): "calm" | "neutral" | "stress" {
  const candles = timeseries?.ohlcv ?? [];
  if (candles.length < 30) return "neutral";
  const returns: number[] = [];
  for (let index = 1; index < candles.length; index += 1) {
    const previous = candles[index - 1].close;
    const current = candles[index].close;
    if (previous > 0 && current > 0) returns.push(current / previous - 1);
  }
  const realized = stdDev(returns.slice(-30));
  if (realized < 0.008) return "calm";
  if (realized > 0.018) return "stress";
  return "neutral";
}

function computeProbabilityScore(
  timeseries: TimeseriesResponse | null,
  signal: "bullish" | "bearish" | "neutral",
  holdDays: number,
  seasonalityHitRate: number,
  valuationBlend: number,
  orderBlockConfirmed: boolean,
): { score: number; similarSetups: number; volatilityRegime: "calm" | "neutral" | "stress" } {
  const candles = timeseries?.ohlcv ?? [];
  const regime = detectVolatilityRegime(timeseries);
  if (candles.length < holdDays + 40 || signal === "neutral") {
    return {
      score: clamp((seasonalityHitRate * 100 * 0.7) + (valuationBlend * 0.3), 0, 100),
      similarSetups: 0,
      volatilityRegime: regime,
    };
  }

  const realizedReturns: number[] = [];
  const recentRegimeFactor = regime === "calm" ? 0.55 : regime === "stress" ? 1.4 : 1;
  for (let index = 22; index < candles.length - holdDays; index += 1) {
    const row = candles[index];
    const prev = candles[index - 1];
    const rangePct = row.close > 0 ? (row.high - row.low) / row.close : 0;
    const volMatch = Math.abs(rangePct - (timeseries?.indicators?.atrPct ?? rangePct)) <= recentRegimeFactor * 0.03;
    const directionalMove = prev.close > 0 ? row.close / prev.close - 1 : 0;
    const sameDirection = signal === "bullish" ? directionalMove >= 0 : directionalMove <= 0;
    if (!volMatch || !sameDirection) continue;
    const start = row.close;
    const end = candles[index + holdDays]?.close ?? start;
    if (!(start > 0) || !(end > 0)) continue;
    realizedReturns.push(end / start - 1);
  }

  const successes = realizedReturns.filter((value) => (signal === "bullish" ? value > 0 : value < 0)).length;
  const historicalHitRate = successes / Math.max(realizedReturns.length, 1);
  const score = clamp(
    (historicalHitRate * 100 * 0.55)
      + (seasonalityHitRate * 100 * 0.25)
      + (valuationBlend * 0.12)
      + (orderBlockConfirmed ? 8 : 0),
    0,
    100,
  );

  return {
    score,
    similarSetups: realizedReturns.length,
    volatilityRegime: regime,
  };
}

function buildCacheKey(args: {
  assetId: string;
  updatedAt: string;
  valuationScore: number;
  seasonalityScore: number;
  supplyScore: number;
  controls: SeasonalityControlValues;
}): string {
  return [
    args.assetId,
    args.updatedAt,
    args.valuationScore.toFixed(2),
    args.seasonalityScore.toFixed(2),
    args.supplyScore.toFixed(2),
    args.controls.historicalYears,
    args.controls.seasonalityMinDays,
    args.controls.seasonalityMaxDays,
  ].join("|");
}

export function buildScreenerRowData(args: {
  assetId: string;
  name: string;
  symbol: string;
  category: string;
  assetGroup: string;
  aiScore: number;
  confidenceScore: number;
  momentum: number;
  combined: HeatmapCombinedItem | undefined;
  valuation: HeatmapValuationItem | undefined;
  seasonality: HeatmapSeasonalityItem | undefined;
  supplyDemand: HeatmapSupplyDemandItem | undefined;
  timeseries: TimeseriesResponse | null;
  controls: SeasonalityControlValues;
}): ScreenerRowData {
  const cacheKey = buildCacheKey({
    assetId: args.assetId,
    updatedAt: args.timeseries?.updatedAt ?? "none",
    valuationScore: Number(args.valuation?.score ?? 50),
    seasonalityScore: Number(args.seasonality?.score ?? 50),
    supplyScore: Number(args.supplyDemand?.score ?? 50),
    controls: args.controls,
  });
  const cached = rowCache.get(cacheKey);
  if (cached) return cached;

  const signal = computeSignal(args.combined, args.seasonality);
  const lastCandles = (args.timeseries?.ohlcv ?? []).slice(-5);
  const fullRecentCandles = (args.timeseries?.ohlcv ?? []).slice(-24);
  const age = computeAge(fullRecentCandles, signal);
  const latest = lastCandles[lastCandles.length - 1];
  const entryConfirmed =
    signal === "bullish"
      ? Boolean(latest && latest.close > latest.open)
      : signal === "bearish"
        ? Boolean(latest && latest.close < latest.open)
        : false;

  const seasonalityBundle = buildSeasonalityClusters(args.timeseries, args.seasonality, args.controls);
  const baseProbability = clamp((seasonalityBundle.currentCluster.hitRate * 100), 0, 100);
  const valuationScore = Number(args.valuation?.score ?? 50);
  const val20 = buildValuation(Number(args.valuation?.val20 ?? 0), clamp((baseProbability * 0.6) + (valuationScore * 0.4), 0, 100));
  const val10 = buildValuation(Number(args.valuation?.val10 ?? 0), clamp((baseProbability * 0.52) + (valuationScore * 0.48), 0, 100));
  const supplyDemand = buildSupplyDemand(args.supplyDemand, args.timeseries, "base");
  const supplyDemandPlus = buildSupplyDemand(args.supplyDemand, args.timeseries, "plus");
  const orderBlock = detectOrderBlock(args.timeseries, signal);
  const liquidity = computeLiquidityProfile(args.timeseries, 50);
  const valuationBlend = clamp((val20.combined * 0.5) + (val10.combined * 0.5), 0, 100);
  const probability = computeProbabilityScore(
    args.timeseries,
    signal,
    seasonalityBundle.currentCluster.holdDays,
    seasonalityBundle.currentCluster.hitRate,
    valuationBlend,
    orderBlock.confirmed,
  );
  const aiRankingScore = clamp(
    (valuationBlend * 0.34)
      + (seasonalityBundle.currentCluster.confidence * 0.26)
      + (clamp(100 - (age * 12), 0, 100) * 0.15)
      + ((orderBlock.confirmed ? 100 : 35) * 0.15)
      + (liquidity.score * 0.10),
    0,
    100,
  );
  const signalStrengthScore = clamp(
    (valuationBlend * 0.28)
      + (probability.score * 0.34)
      + (liquidity.score * 0.18)
      + ((orderBlock.confirmed ? 100 : orderBlock.active ? 72 : 32) * 0.20),
    0,
    100,
  );

  const row: ScreenerRowData = {
    assetId: args.assetId,
    name: args.name,
    symbol: args.symbol,
    category: args.category,
    assetGroup: args.assetGroup,
    signal,
    signalLabel: signal === "bullish" ? "Bullish" : signal === "bearish" ? "Bearish" : "Neutral",
    age,
    entryConfirmed,
    lastCandles,
    val20,
    val10,
    supplyDemand,
    supplyDemandPlus,
    currentCluster: seasonalityBundle.currentCluster,
    nextCluster: seasonalityBundle.nextCluster,
    graphCurve: seasonalityBundle.graphCurve,
    graphProgress: seasonalityBundle.graphProgress,
    orderBlock,
    probability,
    liquidity,
    signalStrength: {
      score: signalStrengthScore,
      label: signalStrengthLabel(signalStrengthScore),
    },
    aiRanking: {
      score: aiRankingScore,
      orderBlockWeight: orderBlock.confirmed ? 100 : orderBlock.active ? 70 : 25,
      seasonalityWeight: seasonalityBundle.currentCluster.confidence,
      valuationWeight: valuationBlend,
      ageWeight: clamp(100 - (age * 12), 0, 100),
    },
    aiScore: args.aiScore,
    confidenceScore: args.confidenceScore,
    momentum: args.momentum,
  };
  rowCache.set(cacheKey, row);
  return row;
}
