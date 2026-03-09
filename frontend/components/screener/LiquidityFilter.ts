import type { OhlcvPoint, TimeseriesResponse } from "@/types";
import type { ScreenerLiquidity } from "@/components/screener/types";

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

function rollingReturns(candles: OhlcvPoint[]): number[] {
  const values: number[] = [];
  for (let index = 1; index < candles.length; index += 1) {
    const previous = candles[index - 1].close;
    const current = candles[index].close;
    if (previous > 0 && current > 0) values.push(current / previous - 1);
  }
  return values;
}

export function computeLiquidityProfile(timeseries: TimeseriesResponse | null, threshold: number): ScreenerLiquidity {
  const candles = (timeseries?.ohlcv ?? []).slice(-120);
  if (candles.length < 30) {
    return {
      score: 0,
      averageDailyVolume: 0,
      spreadStability: 0,
      volatilityClustering: 0,
      passes: false,
    };
  }

  const averageDailyVolume = mean(candles.map((candle) => Number(candle.volume ?? 0)));
  const rangeRatios = candles.map((candle) => (candle.close > 0 ? (candle.high - candle.low) / candle.close : 0));
  const rangeStd = stdDev(rangeRatios);
  const spreadStability = clamp(100 - (rangeStd * 1800), 0, 100);

  const returns = rollingReturns(candles);
  const absReturns = returns.map((value) => Math.abs(value));
  const recentVol = stdDev(absReturns.slice(-20));
  const longVol = stdDev(absReturns);
  const clusteringRatio = longVol > 0 ? recentVol / longVol : 1;
  const volatilityClustering = clamp(100 - (Math.abs(clusteringRatio - 1) * 75), 0, 100);

  const volumeScore = clamp(Math.log10(Math.max(averageDailyVolume, 1)) * 18, 0, 100);
  const score = clamp((volumeScore * 0.5) + (spreadStability * 0.25) + (volatilityClustering * 0.25), 0, 100);

  return {
    score,
    averageDailyVolume,
    spreadStability,
    volatilityClustering,
    passes: score >= threshold,
  };
}
