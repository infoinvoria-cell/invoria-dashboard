import * as d3 from "d3";

import type {
  ConfidenceLevel,
  DatasetObservation,
  DatasetOption,
  DrawdownPoint,
  ModelSummaryItem,
  RegimePoint,
  ResearchReport,
  RiskSurfacePoint,
  SimulationControls,
  SimulationPathPoint,
  SimulationResults,
  VolatilityPoint,
} from "@/components/monte-carlo/types";

const TRADING_DAYS = 252;

function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function createNormal(rng: () => number): () => number {
  return () => {
    const u1 = Math.max(rng(), 1e-9);
    const u2 = Math.max(rng(), 1e-9);
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const variance = mean(values.map((value) => (value - avg) ** 2));
  return Math.sqrt(variance);
}

function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function zScoreForConfidence(level: ConfidenceLevel): number {
  if (level === 0.9) return 1.2815515655446004;
  if (level === 0.95) return 1.6448536269514722;
  return 2.3263478740408408;
}

function formatStepLabel(index: number): string {
  if (index === 0) return "T0";
  return `T+${index}`;
}

function buildCumulativeEquity(observations: DatasetObservation[]): Array<{ date: string; equity: number }> {
  let equity = 100;
  return observations.map((row) => {
    equity *= 1 + row.strategyReturn;
    return { date: row.date, equity };
  });
}

function maxDrawdownFromReturns(returns: number[]): number {
  let equity = 1;
  let peak = 1;
  let maxDrawdown = 0;
  for (const value of returns) {
    equity *= 1 + value;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.min(maxDrawdown, equity / peak - 1);
  }
  return Math.abs(maxDrawdown);
}

function annualizedReturn(returns: number[]): number {
  if (returns.length === 0) return 0;
  const compounded = returns.reduce((accumulator, value) => accumulator * (1 + value), 1);
  return Math.pow(compounded, TRADING_DAYS / returns.length) - 1;
}

function annualizedVolatility(returns: number[]): number {
  return standardDeviation(returns) * Math.sqrt(TRADING_DAYS);
}

function sharpeRatio(returns: number[]): number {
  const stdev = standardDeviation(returns);
  if (stdev === 0) return 0;
  return (mean(returns) / stdev) * Math.sqrt(TRADING_DAYS);
}

function sortinoRatio(returns: number[]): number {
  const downside = returns.filter((value) => value < 0);
  const downsideDeviation = standardDeviation(downside.length > 1 ? downside : [0, ...downside]) || 0;
  if (downsideDeviation === 0) return 0;
  return (mean(returns) / downsideDeviation) * Math.sqrt(TRADING_DAYS);
}

function buildRegimeSeries(returns: number[], dates: string[]): RegimePoint[] {
  const series: RegimePoint[] = [];
  for (let index = 0; index < returns.length; index += 1) {
    const slice = returns.slice(Math.max(0, index - 19), index + 1);
    const rollingMean = mean(slice);
    const rollingVol = standardDeviation(slice);
    const bullRaw = Math.exp((rollingMean - rollingVol * 0.35) * 180);
    const bearRaw = Math.exp((-rollingMean - rollingVol * 0.35) * 180);
    const neutralRaw = Math.exp((rollingVol * 0.35 - Math.abs(rollingMean)) * 120);
    const normalizer = bullRaw + bearRaw + neutralRaw;
    const bull = bullRaw / normalizer;
    const bear = bearRaw / normalizer;
    const neutral = neutralRaw / normalizer;
    const state = bull >= bear && bull >= neutral ? "Bull" : bear >= neutral ? "Bear" : "Neutral";
    series.push({
      date: dates[index],
      bull,
      bear,
      neutral,
      state,
    });
  }
  return series;
}

function buildGarchSeries(returns: number[], dates: string[]): VolatilityPoint[] {
  const variance = Math.max(standardDeviation(returns) ** 2, 1e-6);
  const alpha = 0.08;
  const beta = 0.89;
  const omega = variance * (1 - alpha - beta);
  let conditionalVariance = variance;

  return returns.map((value, index) => {
    conditionalVariance = omega + alpha * value * value + beta * conditionalVariance;
    const realized = annualizedVolatility(returns.slice(Math.max(0, index - 19), index + 1));
    return {
      date: dates[index],
      realized,
      garch: Math.sqrt(Math.max(conditionalVariance, 1e-9)) * Math.sqrt(TRADING_DAYS),
    };
  });
}

function buildBootstrapDrawdowns(returns: number[], runs: number, horizon: number): { drawdowns: number[]; terminalReturns: number[]; sharpes: number[] } {
  const rng = createRng(901);
  const drawdowns: number[] = [];
  const terminalReturns: number[] = [];
  const sharpes: number[] = [];

  for (let run = 0; run < runs; run += 1) {
    const sampled: number[] = [];
    for (let step = 0; step < horizon; step += 1) {
      sampled.push(returns[Math.floor(rng() * returns.length)] ?? 0);
    }
    terminalReturns.push(sampled.reduce((equity, value) => equity * (1 + value), 1) - 1);
    drawdowns.push(maxDrawdownFromReturns(sampled));
    sharpes.push(sharpeRatio(sampled));
  }

  return { drawdowns, terminalReturns, sharpes };
}

function buildDrawdownSeries(paths: number[][]): DrawdownPoint[] {
  if (paths.length === 0) return [];
  const horizon = paths[0].length;
  const drawdownGrid = Array.from({ length: horizon }, () => [] as number[]);

  for (const path of paths) {
    let peak = path[0];
    path.forEach((value, index) => {
      peak = Math.max(peak, value);
      drawdownGrid[index].push(value / peak - 1);
    });
  }

  return drawdownGrid.map((values, index) => ({
    step: index,
    median: Math.abs(quantile(values, 0.5)),
    p95Worst: Math.abs(quantile(values, 0.05)),
  }));
}

function buildHistogram(returns: number[], varThreshold: number, esThreshold: number) {
  const histogramBins = d3
    .bin<number, number>()
    .domain(d3.extent(returns) as [number, number])
    .thresholds(24)(returns);

  const maxCount = d3.max(histogramBins, (bin) => bin.length) ?? 1;
  return histogramBins.map((entry) => {
    const midpoint = ((entry.x0 ?? 0) + (entry.x1 ?? 0)) / 2;
    return {
      label: `${(midpoint * 100).toFixed(2)}%`,
      midpoint,
      count: entry.length,
      density: entry.length / maxCount,
      isVarTail: midpoint <= varThreshold,
      isExpectedShortfallTail: midpoint <= esThreshold,
    };
  });
}

function buildRiskSurface(baseReturn: number, baseVolatility: number, confidenceLevel: ConfidenceLevel): RiskSurfacePoint[] {
  const grid: RiskSurfacePoint[] = [];
  const volSteps = [0.08, 0.14, 0.2, 0.26, 0.32, 0.38];
  const driftSteps = [-0.02, 0.02, 0.06, 0.1, 0.14, 0.18];
  const z = zScoreForConfidence(confidenceLevel);

  driftSteps.forEach((drift) => {
    volSteps.forEach((volatility) => {
      const expectedReturn = drift;
      const cvar = Math.max(0, -(drift / TRADING_DAYS - (volatility / Math.sqrt(TRADING_DAYS)) * (z + 0.18)));
      const score = clamp(58 + expectedReturn * 160 - cvar * 180 - Math.abs(volatility - baseVolatility) * 50 + baseReturn * 18, 4, 99);
      grid.push({
        drift,
        volatility,
        score,
        expectedReturn,
        cvar,
      });
    });
  });

  return grid;
}

function buildModelCards(results: {
  valueAtRiskHistorical: number;
  expectedShortfallHistorical: number;
  pathSeries: SimulationPathPoint[];
  kellyFractionCapped: number;
  bayesianReturn: number;
  drawdownTail: number;
  sharpeMedian: number;
}): ModelSummaryItem[] {
  return [
    { id: "gbm", label: "GBM Fan", value: `${(results.pathSeries.at(-1)?.median ?? 100).toFixed(1)}`, tone: "accent" },
    { id: "var", label: "Historical VaR", value: `${(results.valueAtRiskHistorical * 100).toFixed(2)}%`, tone: "negative" },
    { id: "cvar", label: "Expected Shortfall", value: `${(results.expectedShortfallHistorical * 100).toFixed(2)}%`, tone: "negative" },
    { id: "kelly", label: "Kelly Size", value: `${(results.kellyFractionCapped * 100).toFixed(1)}%`, tone: "positive" },
    { id: "bayes", label: "Bayesian Mean", value: `${(results.bayesianReturn * 100).toFixed(2)}%`, tone: "accent" },
    { id: "dd", label: "Drawdown Tail", value: `${(results.drawdownTail * 100).toFixed(2)}%`, tone: "negative" },
    { id: "sharpe", label: "Sharpe Stability", value: results.sharpeMedian.toFixed(2), tone: "neutral" },
    { id: "hmm", label: "Regime Engine", value: "3-state", tone: "accent" },
  ];
}

export function parseCsvDataset(text: string, name = "Uploaded CSV"): DatasetOption {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) {
    throw new Error("CSV file must include headers and at least one data row.");
  }

  const headers = lines[0].split(",").map((value) => value.trim().toLowerCase());
  const rows: DatasetObservation[] = [];
  let previousClose = 100;

  for (const line of lines.slice(1)) {
    const values = line.split(",").map((value) => value.trim());
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    const close = Number(row.close || previousClose);
    const open = Number(row.open || close);
    const high = Number(row.high || Math.max(open, close));
    const low = Number(row.low || Math.min(open, close));
    const volume = Number(row.volume || 0);
    const signal = Number(row.signal || 0);
    const rawReturn = row.returns ? Number(row.returns) : previousClose === 0 ? 0 : close / previousClose - 1;
    const strategyReturn = row.strategy_return ? Number(row.strategy_return) : signal === 0 ? rawReturn : rawReturn * signal;
    previousClose = close;

    rows.push({
      date: row.date || new Date().toISOString().slice(0, 10),
      open,
      high,
      low,
      close,
      volume,
      returns: rawReturn,
      signal,
      strategyReturn,
    });
  }

  return {
    id: `csv-${Date.now()}`,
    name,
    description: "Uploaded CSV strategy file parsed into the simulation framework.",
    kind: "csv",
    observations: rows,
  };
}

export function buildSimulationResults(dataset: DatasetOption, controls: SimulationControls): SimulationResults {
  const returns = dataset.observations.map((row) => row.strategyReturn);
  const dates = dataset.observations.map((row) => row.date);
  const dailyMean = mean(returns);
  const dailyVolatility = standardDeviation(returns);
  const confidenceZ = zScoreForConfidence(controls.confidenceLevel);
  const drift = controls.drift / TRADING_DAYS;
  const sigma = controls.volatility / Math.sqrt(TRADING_DAYS);
  const horizon = controls.horizon;
  const rng = createRng(42);
  const normal = createNormal(rng);
  const regimeSeries = buildRegimeSeries(returns, dates);
  const transitionBias = mean(regimeSeries.map((row) => row.bull - row.bear));
  const pathCount = Math.max(controls.simulationCount, controls.samplePaths + 4);
  const rawPaths: number[][] = [];

  for (let pathIndex = 0; pathIndex < pathCount; pathIndex += 1) {
    const path: number[] = [100];
    for (let step = 1; step <= horizon; step += 1) {
      const regimeWeight = transitionBias * Math.sin(step / 14);
      const increment = Math.exp((drift + regimeWeight * 0.0007 - 0.5 * sigma * sigma) + sigma * normal()) - 1;
      path.push(Math.max(15, path[step - 1] * (1 + increment)));
    }
    rawPaths.push(path);
  }

  const pathSeries: SimulationPathPoint[] = Array.from({ length: horizon + 1 }, (_, step) => {
    const values = rawPaths.map((path) => path[step]);
    return {
      step,
      label: formatStepLabel(step),
      median: quantile(values, 0.5),
      p05: quantile(values, 0.05),
      p95: quantile(values, 0.95),
      mean: mean(values),
      samples: rawPaths.slice(0, controls.samplePaths).map((path) => path[step]),
    };
  });

  const historicalVarThreshold = quantile(returns, 1 - controls.confidenceLevel);
  const historicalTail = returns.filter((value) => value <= historicalVarThreshold);
  const historicalExpectedShortfall = Math.abs(mean(historicalTail.length ? historicalTail : [historicalVarThreshold]));
  const parametricVar = Math.max(0, -(dailyMean - confidenceZ * dailyVolatility));
  const parametricEs = Math.max(0, -(dailyMean - dailyVolatility * (confidenceZ + 0.35)));
  const bootstrap = buildBootstrapDrawdowns(returns, controls.bootstrapRuns, horizon);
  const histogram = buildHistogram(returns, historicalVarThreshold, -historicalExpectedShortfall);
  const volatilitySeries = buildGarchSeries(returns, dates);
  const drawdownSeries = buildDrawdownSeries(rawPaths.slice(0, Math.min(rawPaths.length, 260)));
  const wins = returns.filter((value) => value > 0);
  const losses = returns.filter((value) => value < 0);
  const winRate = wins.length / Math.max(returns.length, 1);
  const avgWin = mean(wins.length ? wins : [0]);
  const avgLoss = Math.abs(mean(losses.length ? losses : [0]));
  const payoffRatio = avgLoss === 0 ? 0 : avgWin / avgLoss;
  const rawKelly = payoffRatio === 0 ? 0 : winRate - (1 - winRate) / payoffRatio;
  const kellyFraction = clamp(rawKelly, -1, 1);
  const kellyFractionCapped = clamp(kellyFraction, 0, 0.35);
  const priorMean = 0.06;
  const priorVariance = 0.08 ** 2;
  const sampleMean = annualizedReturn(returns);
  const sampleVariance = (annualizedVolatility(returns) || 0.0001) ** 2;
  const posteriorWeight = sampleVariance / Math.max(sampleVariance + priorVariance, 1e-9);
  const bayesianReturn = priorMean * posteriorWeight + sampleMean * (1 - posteriorWeight);
  const maxDrawdown = maxDrawdownFromReturns(returns);
  const volatility = annualizedVolatility(returns);
  const expectedReturn = annualizedReturn(returns);
  const sharpe = sharpeRatio(returns);
  const sortino = sortinoRatio(returns);
  const dominantRegimeProbability = Math.max(...(regimeSeries.at(-1) ? [regimeSeries.at(-1)!.bull, regimeSeries.at(-1)!.bear, regimeSeries.at(-1)!.neutral] : [0]));
  const riskScore = clamp(
    65 + sharpe * 8 + sortino * 4 + bayesianReturn * 40 - maxDrawdown * 90 - historicalExpectedShortfall * 140,
    8,
    99,
  );
  const report: ResearchReport = {
    expectedReturn,
    volatility,
    maxDrawdown,
    valueAtRisk: Math.abs(historicalVarThreshold),
    expectedShortfall: historicalExpectedShortfall,
    sharpeRatio: sharpe,
    sortinoRatio: sortino,
    regimeProbability: dominantRegimeProbability,
    riskScore,
    profitProbability: bootstrap.terminalReturns.filter((value) => value > 0).length / Math.max(bootstrap.terminalReturns.length, 1),
    posteriorReturn: bayesianReturn,
  };

  return {
    dataset,
    controls,
    returns,
    cumulativeEquity: buildCumulativeEquity(dataset.observations),
    pathSeries,
    histogram,
    valueAtRiskHistorical: Math.abs(historicalVarThreshold),
    valueAtRiskParametric: parametricVar,
    expectedShortfallHistorical: historicalExpectedShortfall,
    expectedShortfallParametric: parametricEs,
    regimeSeries,
    volatilitySeries,
    drawdownSeries,
    riskSurface: buildRiskSurface(expectedReturn, volatility, controls.confidenceLevel),
    sharpeStability: bootstrap.sharpes,
    bootstrapTerminalReturns: bootstrap.terminalReturns,
    kellyFraction,
    kellyFractionCapped,
    payoffRatio,
    bayesianReturn,
    report,
    modelCards: buildModelCards({
      valueAtRiskHistorical: Math.abs(historicalVarThreshold),
      expectedShortfallHistorical: historicalExpectedShortfall,
      pathSeries,
      kellyFractionCapped,
      bayesianReturn,
      drawdownTail: quantile(bootstrap.drawdowns, 0.9),
      sharpeMedian: quantile(bootstrap.sharpes, 0.5),
    }),
  };
}
