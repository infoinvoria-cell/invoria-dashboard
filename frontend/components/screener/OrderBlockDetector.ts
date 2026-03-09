import type { OhlcvPoint, SupplyDemandZone, TimeseriesResponse } from "@/types";
import type { ScreenerOrderBlock } from "@/components/screener/types";

type DetectedOrderBlock = ScreenerOrderBlock & {
  zone: SupplyDemandZone | null;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

function averageTrueRange(candles: OhlcvPoint[], lookback = 20): number {
  const sample = candles.slice(-lookback);
  if (!sample.length) return 0;
  return mean(sample.map((candle) => Math.max(candle.high - candle.low, Math.abs(candle.close - candle.open))));
}

export function detectOrderBlock(
  timeseries: TimeseriesResponse | null,
  signal: "bullish" | "bearish" | "neutral",
): DetectedOrderBlock {
  const candles = timeseries?.ohlcv ?? [];
  if (candles.length < 16 || signal === "neutral") {
    return {
      active: false,
      confirmed: false,
      direction: signal,
      label: "No block",
      low: null,
      high: null,
      proximityPct: null,
      start: null,
      end: null,
      zone: null,
    };
  }

  const atr = Math.max(averageTrueRange(candles), 0.0001);
  const latest = candles[candles.length - 1];
  let best: DetectedOrderBlock | null = null;

  for (let index = 5; index < candles.length - 2; index += 1) {
    const cluster = candles.slice(index - 4, index);
    const breakout = candles[index];
    const clusterHigh = Math.max(...cluster.map((row) => row.high));
    const clusterLow = Math.min(...cluster.map((row) => row.low));
    const clusterRange = clusterHigh - clusterLow;
    const clusterBodies = mean(cluster.map((row) => Math.abs(row.close - row.open)));
    const breakoutBody = Math.abs(breakout.close - breakout.open);
    const consolidation = clusterRange <= atr * 1.8 && clusterBodies <= atr * 0.7;
    const bullishBreakout = breakout.close > clusterHigh && breakoutBody >= atr * 1.15;
    const bearishBreakout = breakout.close < clusterLow && breakoutBody >= atr * 1.15;
    const direction = bullishBreakout ? "bullish" : bearishBreakout ? "bearish" : "neutral";
    if (!consolidation || direction === "neutral" || direction !== signal) continue;

    const low = clusterLow;
    const high = clusterHigh;
    const inside = latest.close >= low && latest.close <= high;
    const proximityPct = Math.abs(((latest.close - (low + high) / 2) / latest.close) * 100);
    const confirmed = inside || proximityPct <= 1.35;
    const candidate: DetectedOrderBlock = {
      active: inside,
      confirmed,
      direction,
      label: `${direction === "bullish" ? "Demand OB" : "Supply OB"} ${inside ? "active" : "tracked"}`,
      low,
      high,
      proximityPct,
      start: cluster[0]?.t ?? null,
      end: breakout.t,
      zone: cluster[0]?.t
        ? {
            start: cluster[0].t,
            end: breakout.t,
            low,
            high,
          }
        : null,
    };

    if (!best) {
      best = candidate;
      continue;
    }

    const candidateScore = (candidate.active ? 35 : 0) + (candidate.confirmed ? 25 : 0) + (100 - clamp(candidate.proximityPct ?? 100, 0, 100));
    const bestScore = (best.active ? 35 : 0) + (best.confirmed ? 25 : 0) + (100 - clamp(best.proximityPct ?? 100, 0, 100));
    if (candidateScore >= bestScore) best = candidate;
  }

  if (best) return best;

  return {
    active: false,
    confirmed: false,
    direction: signal,
    label: signal === "bullish" ? "Demand OB pending" : "Supply OB pending",
    low: null,
    high: null,
    proximityPct: null,
    start: null,
    end: null,
    zone: null,
  };
}

export function deriveSupportResistanceZones(timeseries: TimeseriesResponse | null): {
  demand: SupplyDemandZone[];
  supply: SupplyDemandZone[];
} {
  const candles = (timeseries?.ohlcv ?? []).slice(-80);
  if (candles.length < 12) return { demand: [], supply: [] };

  const lows = [...candles].sort((left, right) => left.low - right.low).slice(0, 2);
  const highs = [...candles].sort((left, right) => right.high - left.high).slice(0, 2);
  const mkZone = (row: OhlcvPoint, kind: "demand" | "supply"): SupplyDemandZone => {
    const pad = Math.max((row.high - row.low) * 0.22, row.close * 0.0025);
    return {
      start: candles[Math.max(0, candles.length - 24)]?.t ?? row.t,
      end: candles[candles.length - 1]?.t ?? row.t,
      low: kind === "demand" ? row.low - pad : row.high - pad,
      high: kind === "demand" ? row.low + pad : row.high + pad,
    };
  };

  return {
    demand: lows.map((row) => mkZone(row, "demand")),
    supply: highs.map((row) => mkZone(row, "supply")),
  };
}
