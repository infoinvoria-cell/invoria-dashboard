import type { MonteCarloSummary } from "@/lib/optimizer/types";

type MonteCarloOptions = {
  onProgress?: (completed: number, total: number) => void;
};

function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function std(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - avg) ** 2)));
}

function computeSharpe(returns: number[]): number {
  const sigma = std(returns);
  if (sigma === 0) return 0;
  return (mean(returns) / sigma) * Math.sqrt(252 / Math.max(1, returns.length / 8));
}

function maxDrawdown(curve: number[]): number {
  let peak = 1;
  let worst = 0;
  for (const point of curve) {
    peak = Math.max(peak, point);
    worst = Math.max(worst, peak > 0 ? (peak - point) / peak : 0);
  }
  return worst;
}

function quantile(values: number[], q: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * q)));
  return sorted[index];
}

function buildBuckets(values: number[], bucketCount = 12): MonteCarloSummary["distributionBuckets"] {
  if (!values.length) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const width = Math.max(1e-6, (max - min) / bucketCount);
  const buckets = Array.from({ length: bucketCount }, (_, index) => ({
    from: min + (index * width),
    to: index === bucketCount - 1 ? max : min + ((index + 1) * width),
    label: "",
    count: 0,
  }));
  for (const value of values) {
    const index = Math.min(bucketCount - 1, Math.max(0, Math.floor((value - min) / width)));
    buckets[index].count += 1;
  }
  return buckets.map((bucket) => ({
    ...bucket,
    label: `${(bucket.from * 100).toFixed(0)}% to ${(bucket.to * 100).toFixed(0)}%`,
  }));
}

function shuffle<T>(items: T[]): T[] {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function bootstrap(values: number[]): number[] {
  return values.map(() => values[Math.floor(Math.random() * values.length)]);
}

function randomizeReturns(values: number[]): number[] {
  const avg = mean(values);
  const sigma = std(values);
  return values.map(() => avg + ((Math.random() - 0.5) * 2 * sigma));
}

function mishuffle(values: number[]): number[] {
  return shuffle(values).map((value) => value + ((Math.random() - 0.5) * Math.abs(value) * 0.3));
}

function toEquityCurve(returns: number[]): number[] {
  const path: number[] = [];
  let equity = 1;
  for (const value of returns) {
    equity *= (1 + value);
    path.push(equity);
  }
  return path;
}

export function runMonteCarlo(tradeReturns: number[], simulations: number, options?: MonteCarloOptions): MonteCarloSummary {
  const samplePaths: number[][] = [];
  const endingReturns: number[] = [];
  const drawdowns: number[] = [];
  const sharpes: number[] = [];
  let ruined = 0;

  if (!tradeReturns.length) {
    return {
      simulations,
      worstCaseDrawdown: 0,
      monteCarloSharpe: 0,
      probabilityOfRuin: 0,
      returnDistribution: { p05: 0, p50: 0, p95: 0 },
      distributionBuckets: [],
      samplePaths: [],
    };
  }

  const modes = [shuffle, mishuffle, randomizeReturns, bootstrap];
  for (let i = 0; i < simulations; i += 1) {
    const series = modes[i % modes.length](tradeReturns);
    const curve = toEquityCurve(series);
    const finalReturn = curve.length ? curve[curve.length - 1] - 1 : 0;
    const dd = maxDrawdown(curve);
    const sharpe = computeSharpe(series);
    endingReturns.push(finalReturn);
    drawdowns.push(dd);
    sharpes.push(sharpe);
    if ((curve[curve.length - 1] ?? 1) < 0.7) ruined += 1;
    if (samplePaths.length < 10) {
      samplePaths.push(curve.slice(0, 120));
    }
    if ((i + 1) % 50 === 0 || i + 1 === simulations) {
      options?.onProgress?.(i + 1, simulations);
    }
  }

  return {
    simulations,
    worstCaseDrawdown: Math.max(...drawdowns),
    monteCarloSharpe: mean(sharpes),
    probabilityOfRuin: ruined / simulations,
    returnDistribution: {
      p05: quantile(endingReturns, 0.05),
      p50: quantile(endingReturns, 0.5),
      p95: quantile(endingReturns, 0.95),
    },
    distributionBuckets: buildBuckets(endingReturns),
    samplePaths,
  };
}
