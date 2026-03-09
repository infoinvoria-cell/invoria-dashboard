import * as d3 from "d3";

import type {
  ConfidenceLevel,
  DatasetObservation,
  DatasetOption,
  DrawdownPoint,
  HistogramBin,
  ModelSummaryItem,
  OverfittingSummary,
  ParameterHeatmapPoint,
  PortfolioAllocation,
  RegimePoint,
  ResearchReport,
  RiskSurfacePoint,
  SimulationControls,
  SimulationPathPoint,
  SimulationResults,
  StressScenarioId,
  StressScenarioResult,
  VolatilityPoint,
  WalkForwardPoint,
} from "@/components/monte-carlo/types";

const TRADING_DAYS = 252;

const STRESS_SCENARIOS: Array<{
  id: StressScenarioId;
  label: string;
  description: string;
  shockDrift: number;
  volMultiplier: number;
  jump: number;
  duration: number;
}> = [
  { id: "gfc2008", label: "2008 Global Financial Crisis", description: "Tiefer Kreditstress mit langem Volatilitaetsregime.", shockDrift: -0.55, volMultiplier: 2.8, jump: -0.11, duration: 54 },
  { id: "covid2020", label: "COVID Crash 2020", description: "Schneller, steiler Schock mit hoher Mean-Reversion.", shockDrift: -0.72, volMultiplier: 2.3, jump: -0.13, duration: 24 },
  { id: "flash2010", label: "Flash Crash 2010", description: "Kurzfristiger Liquiditaetsschock mit abruptem Rebound.", shockDrift: -0.34, volMultiplier: 2, jump: -0.08, duration: 7 },
  { id: "dotcom", label: "Dot-Com Bubble Collapse", description: "Langer Bewertungsabbau mit gestrecktem Drawdown.", shockDrift: -0.43, volMultiplier: 1.9, jump: -0.06, duration: 72 },
  { id: "inflation", label: "High Inflation Shock", description: "Persistente Unsicherheit und erhoehte Volatilitaetscluster.", shockDrift: -0.26, volMultiplier: 1.7, jump: -0.04, duration: 63 },
];

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
  return index === 0 ? "T0" : `T+${index}`;
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
  const downsideDeviation = standardDeviation(downside.length > 1 ? downside : [0, ...downside]);
  if (downsideDeviation === 0) return 0;
  return (mean(returns) / downsideDeviation) * Math.sqrt(TRADING_DAYS);
}

function cumulativeReturn(returns: number[]): number {
  return returns.reduce((equity, value) => equity * (1 + value), 1) - 1;
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

function buildCumulativeEquity(observations: DatasetObservation[]): Array<{ date: string; equity: number }> {
  let equity = 100;
  return observations.map((row) => {
    equity *= 1 + row.strategyReturn;
    return { date: row.date, equity };
  });
}

function buildHistogram(returns: number[], varThreshold: number, esThreshold: number): HistogramBin[] {
  const domain = d3.extent(returns) as [number, number];
  const histogramBins = d3.bin<number, number>().domain(domain).thresholds(24)(returns);
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

function buildGenericHistogram(values: number[], negativeThreshold = Number.NEGATIVE_INFINITY): HistogramBin[] {
  const domain = d3.extent(values) as [number, number];
  const histogramBins = d3.bin<number, number>().domain(domain).thresholds(20)(values);
  const maxCount = d3.max(histogramBins, (bin) => bin.length) ?? 1;
  return histogramBins.map((entry) => {
    const midpoint = ((entry.x0 ?? 0) + (entry.x1 ?? 0)) / 2;
    return {
      label: `${(midpoint * 100).toFixed(2)}%`,
      midpoint,
      count: entry.length,
      density: entry.length / maxCount,
      isVarTail: midpoint <= negativeThreshold,
      isExpectedShortfallTail: midpoint <= negativeThreshold,
    };
  });
}

function buildPathSeries(paths: number[][], samplePaths: number): SimulationPathPoint[] {
  if (!paths.length) return [];
  return Array.from({ length: paths[0].length }, (_, step) => {
    const values = paths.map((path) => path[step]);
    return {
      step,
      label: formatStepLabel(step),
      median: quantile(values, 0.5),
      p05: quantile(values, 0.05),
      p95: quantile(values, 0.95),
      mean: mean(values),
      samples: paths.slice(0, samplePaths).map((path) => path[step]),
    };
  });
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

function buildRegimeSeries(returns: number[], dates: string[]): RegimePoint[] {
  return returns.map((value, index) => {
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
    return { date: dates[index] ?? `T${index}`, bull, bear, neutral, state };
  });
}

function buildGarchSeries(returns: number[], dates: string[]): VolatilityPoint[] {
  const variance = Math.max(standardDeviation(returns) ** 2, 1e-6);
  const alpha = 0.08;
  const beta = 0.89;
  const omega = variance * (1 - alpha - beta);
  let conditionalVariance = variance;

  return returns.map((value, index) => {
    conditionalVariance = omega + alpha * value * value + beta * conditionalVariance;
    return {
      date: dates[index] ?? `T${index}`,
      realized: annualizedVolatility(returns.slice(Math.max(0, index - 19), index + 1)),
      garch: Math.sqrt(Math.max(conditionalVariance, 1e-9)) * Math.sqrt(TRADING_DAYS),
    };
  });
}

function buildBootstrapDrawdowns(returns: number[], runs: number, horizon: number): { drawdowns: number[]; terminalReturns: number[]; sharpes: number[]; paths: number[][] } {
  const rng = createRng(901);
  const drawdowns: number[] = [];
  const terminalReturns: number[] = [];
  const sharpes: number[] = [];
  const paths: number[][] = [];

  for (let run = 0; run < runs; run += 1) {
    const sampled: number[] = [];
    const path: number[] = [100];
    for (let step = 0; step < horizon; step += 1) {
      const sampledReturn = returns[Math.floor(rng() * returns.length)] ?? 0;
      sampled.push(sampledReturn);
      path.push(Math.max(15, path[path.length - 1] * (1 + sampledReturn)));
    }
    terminalReturns.push(cumulativeReturn(sampled));
    drawdowns.push(maxDrawdownFromReturns(sampled));
    sharpes.push(sharpeRatio(sampled));
    paths.push(path);
  }

  return { drawdowns, terminalReturns, sharpes, paths };
}

function buildRiskSurface(baseReturn: number, baseVolatility: number, confidenceLevel: ConfidenceLevel): RiskSurfacePoint[] {
  const grid: RiskSurfacePoint[] = [];
  const volSteps = [0.08, 0.14, 0.2, 0.26, 0.32, 0.38];
  const driftSteps = [-0.02, 0.02, 0.06, 0.1, 0.14, 0.18];
  const z = zScoreForConfidence(confidenceLevel);

  driftSteps.forEach((drift) => {
    volSteps.forEach((volatility) => {
      const cvar = Math.max(0, -(drift / TRADING_DAYS - (volatility / Math.sqrt(TRADING_DAYS)) * (z + 0.18)));
      const score = clamp(58 + drift * 160 - cvar * 180 - Math.abs(volatility - baseVolatility) * 50 + baseReturn * 18, 4, 99);
      grid.push({ drift, volatility, score, expectedReturn: drift, cvar });
    });
  });

  return grid;
}

function parsePortfolioWeights(controls: SimulationControls): number[] {
  const raw = [
    Math.max(0, controls.portfolioWeightA),
    Math.max(0, controls.portfolioWeightB),
    Math.max(0, controls.portfolioWeightC),
  ];
  const sum = raw.reduce((total, value) => total + value, 0);
  if (sum === 0) return [0.45, 0.35, 0.2];
  return raw.map((value) => value / sum);
}

function buildPortfolioAllocations(controls: SimulationControls, meanReturn: number, dailyVolatility: number): PortfolioAllocation[] {
  const weights = parsePortfolioWeights(controls);
  const returns = [controls.drift, controls.drift * 0.84, controls.drift * 0.62].map((value, index) => value + (index - 1) * 0.015);
  const vols = [
    controls.volatility,
    Math.max(0.06, controls.volatility * 0.76),
    Math.max(0.04, controls.volatility * 1.18),
  ];
  const fallbackReturn = meanReturn * TRADING_DAYS;
  const fallbackVol = dailyVolatility * Math.sqrt(TRADING_DAYS);

  return [
    { label: "Core", weight: weights[0], expectedReturn: returns[0] || fallbackReturn, volatility: vols[0] || fallbackVol },
    { label: "Defensive", weight: weights[1], expectedReturn: returns[1] || fallbackReturn * 0.84, volatility: vols[1] || fallbackVol * 0.76 },
    { label: "Opportunistic", weight: weights[2], expectedReturn: returns[2] || fallbackReturn * 0.62, volatility: vols[2] || fallbackVol * 1.18 },
  ];
}

function buildCorrelationMatrix(correlation: number): number[][] {
  const rho = clamp(correlation, -0.25, 0.95);
  return [
    [1, rho, rho * 0.82],
    [rho, 1, rho * 0.74],
    [rho * 0.82, rho * 0.74, 1],
  ];
}

function cholesky3(matrix: number[][]): number[][] {
  const lower = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];

  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column <= row; column += 1) {
      let sum = 0;
      for (let index = 0; index < column; index += 1) sum += lower[row][index] * lower[column][index];
      if (row === column) {
        lower[row][column] = Math.sqrt(Math.max(matrix[row][row] - sum, 1e-9));
      } else {
        lower[row][column] = (matrix[row][column] - sum) / lower[column][column];
      }
    }
  }

  return lower;
}

function multiplyLowerTriangular(matrix: number[][], vector: number[]): number[] {
  return matrix.map((row) => row.reduce((sum, value, columnIndex) => sum + value * (vector[columnIndex] ?? 0), 0));
}

function simulatePortfolioPaths(controls: SimulationControls, allocations: PortfolioAllocation[], pathCount: number, horizon: number): { paths: number[][]; terminalReturns: number[]; drawdowns: number[] } {
  const rng = createRng(777);
  const normal = createNormal(rng);
  const cholesky = cholesky3(buildCorrelationMatrix(controls.portfolioCorrelation));
  const dailyDrifts = allocations.map((item) => item.expectedReturn / TRADING_DAYS);
  const dailyVols = allocations.map((item) => item.volatility / Math.sqrt(TRADING_DAYS));
  const weights = allocations.map((item) => item.weight);
  const terminalReturns: number[] = [];
  const drawdowns: number[] = [];
  const paths: number[][] = [];

  for (let pathIndex = 0; pathIndex < pathCount; pathIndex += 1) {
    const path: number[] = [100];
    const pathReturns: number[] = [];
    for (let step = 1; step <= horizon; step += 1) {
      const correlated = multiplyLowerTriangular(cholesky, [normal(), normal(), normal()]);
      const portfolioReturn = allocations.reduce((sum, _item, assetIndex) => {
        const drift = dailyDrifts[assetIndex] ?? 0;
        const sigma = dailyVols[assetIndex] ?? 0;
        const assetReturn = Math.exp((drift - 0.5 * sigma * sigma) + sigma * correlated[assetIndex]) - 1;
        return sum + assetReturn * (weights[assetIndex] ?? 0);
      }, 0);
      pathReturns.push(portfolioReturn);
      path.push(Math.max(16, path[path.length - 1] * (1 + portfolioReturn)));
    }
    paths.push(path);
    terminalReturns.push(cumulativeReturn(pathReturns));
    drawdowns.push(maxDrawdownFromReturns(pathReturns));
  }

  return { paths, terminalReturns, drawdowns };
}

function buildStressScenarioResults(controls: SimulationControls, allocations: PortfolioAllocation[], basePathCount: number, horizon: number): StressScenarioResult[] {
  return STRESS_SCENARIOS.map((scenario, scenarioIndex) => {
    const rng = createRng(2900 + scenarioIndex);
    const normal = createNormal(rng);
    const cholesky = cholesky3(buildCorrelationMatrix(Math.min(0.98, controls.portfolioCorrelation + scenario.volMultiplier * 0.06)));
    const dailyDrifts = allocations.map((item) => item.expectedReturn / TRADING_DAYS);
    const dailyVols = allocations.map((item) => item.volatility / Math.sqrt(TRADING_DAYS));
    const weights = allocations.map((item) => item.weight);
    const paths: number[][] = [];
    const terminalReturns: number[] = [];
    const drawdowns: number[] = [];

    for (let pathIndex = 0; pathIndex < Math.min(basePathCount, 700); pathIndex += 1) {
      const path: number[] = [100];
      const pathReturns: number[] = [];
      for (let step = 1; step <= horizon; step += 1) {
        const correlated = multiplyLowerTriangular(cholesky, [normal(), normal(), normal()]);
        const stressActive = step <= scenario.duration;
        const portfolioReturn = allocations.reduce((sum, _item, assetIndex) => {
          const drift = dailyDrifts[assetIndex] ?? 0;
          const sigma = dailyVols[assetIndex] ?? 0;
          const stressedDrift = stressActive ? drift + scenario.shockDrift / TRADING_DAYS : drift;
          const stressedSigma = stressActive ? sigma * scenario.volMultiplier : sigma;
          const jump = stressActive && step === 1 ? scenario.jump : 0;
          const assetReturn = Math.exp((stressedDrift - 0.5 * stressedSigma * stressedSigma) + stressedSigma * correlated[assetIndex]) - 1 + jump;
          return sum + assetReturn * (weights[assetIndex] ?? 0);
        }, 0);
        pathReturns.push(portfolioReturn);
        path.push(Math.max(10, path[path.length - 1] * (1 + portfolioReturn)));
      }
      paths.push(path);
      terminalReturns.push(cumulativeReturn(pathReturns));
      drawdowns.push(maxDrawdownFromReturns(pathReturns));
    }

    return {
      id: scenario.id,
      label: scenario.label,
      description: scenario.description,
      severity: scenario.volMultiplier,
      pathSeries: buildPathSeries(paths, Math.min(controls.samplePaths, 5)),
      terminalReturn: mean(terminalReturns),
      maxDrawdown: mean(drawdowns),
      impact: Math.abs(mean(drawdowns) + Math.min(mean(terminalReturns), 0)),
    };
  });
}

function buildWalkForwardSeries(returns: number[], controls: SimulationControls): WalkForwardPoint[] {
  const trainWindow = clamp(Math.round(controls.walkForwardTrainWindow), 60, Math.max(60, returns.length - 20));
  const testWindow = clamp(Math.round(controls.walkForwardTestWindow), 20, Math.max(20, returns.length - 10));
  const points: WalkForwardPoint[] = [];
  let cursor = 0;
  let segmentIndex = 1;

  while (cursor + trainWindow + testWindow <= returns.length && segmentIndex <= 8) {
    const trainSlice = returns.slice(cursor, cursor + trainWindow);
    const testSlice = returns.slice(cursor + trainWindow, cursor + trainWindow + testWindow);
    const trainReturn = annualizedReturn(trainSlice);
    const testReturn = annualizedReturn(testSlice);
    const degradation = testReturn - trainReturn;
    const stability = clamp(68 + testReturn * 140 - Math.abs(degradation) * 90 - maxDrawdownFromReturns(testSlice) * 110, 5, 99);
    points.push({
      segment: `WF-${segmentIndex}`,
      trainReturn,
      testReturn,
      degradation,
      stability,
    });
    cursor += testWindow;
    segmentIndex += 1;
  }

  return points;
}

function shuffleValues(values: number[], rng: () => number): number[] {
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function buildOverfittingSummary(returns: number[], walkForwardSeries: WalkForwardPoint[]): { summary: OverfittingSummary; distribution: number[] } {
  const rng = createRng(1789);
  const randomSharpeSamples: number[] = [];
  for (let index = 0; index < 120; index += 1) {
    randomSharpeSamples.push(sharpeRatio(shuffleValues(returns, rng)));
  }

  const sampleSharpe = sharpeRatio(returns);
  const degradationMean = mean(walkForwardSeries.map((item) => item.degradation));
  const degradationVol = standardDeviation(walkForwardSeries.map((item) => item.degradation));
  const consistencyScore = walkForwardSeries.filter((item) => item.testReturn > 0).length / Math.max(walkForwardSeries.length, 1);
  const randomizedEdge = sampleSharpe - mean(randomSharpeSamples);
  const parameterStability = clamp(1 - degradationVol / 0.35, 0, 1);
  const riskScore = clamp(48 + Math.abs(Math.min(degradationMean, 0)) * 160 + (1 - consistencyScore) * 34 + (1 - parameterStability) * 38 - randomizedEdge * 12, 4, 99);
  const stabilityScore = clamp(82 - riskScore * 0.58 + randomizedEdge * 14 + consistencyScore * 18, 4, 99);

  return {
    distribution: randomSharpeSamples,
    summary: {
      riskScore,
      stabilityScore,
      randomizedEdge,
      consistencyScore: consistencyScore * 100,
      parameterStability: parameterStability * 100,
    },
  };
}

function buildParameterHeatmap(controls: SimulationControls, baseReturn: number, baseDrawdown: number): { performance: ParameterHeatmapPoint[]; drawdown: ParameterHeatmapPoint[] } {
  const stopLossStep = Math.max((controls.parameterStopLossMax - controls.parameterStopLossMin) / 4, 0.5);
  const takeProfitStep = Math.max((controls.parameterTakeProfitMax - controls.parameterTakeProfitMin) / 4, 0.5);
  const lookbackStep = Math.max((controls.parameterLookbackMax - controls.parameterLookbackMin) / 4, 1);
  const thresholdStep = Math.max((controls.parameterThresholdMax - controls.parameterThresholdMin) / 4, 0.05);
  const stopLossValues = d3.range(controls.parameterStopLossMin, controls.parameterStopLossMax + 0.001, stopLossStep);
  const takeProfitValues = d3.range(controls.parameterTakeProfitMin, controls.parameterTakeProfitMax + 0.001, takeProfitStep);
  const lookbackValues = d3.range(controls.parameterLookbackMin, controls.parameterLookbackMax + 0.001, lookbackStep);
  const thresholdValues = d3.range(controls.parameterThresholdMin, controls.parameterThresholdMax + 0.001, thresholdStep);
  const performance: ParameterHeatmapPoint[] = [];
  const drawdown: ParameterHeatmapPoint[] = [];

  stopLossValues.forEach((stopLoss) => {
    takeProfitValues.forEach((takeProfit) => {
      const edge = 1 - Math.abs(takeProfit / Math.max(stopLoss, 0.1) - 2.1) * 0.22;
      const score = clamp(55 + baseReturn * 130 + edge * 28 - baseDrawdown * 85, 4, 99);
      const dd = clamp(baseDrawdown + Math.abs(stopLoss - 6) * 0.007 + Math.max(0, 1.8 - takeProfit / Math.max(stopLoss, 0.1)) * 0.018, 0.01, 0.85);
      performance.push({
        xLabel: `${takeProfit.toFixed(1)}R`,
        yLabel: `${stopLoss.toFixed(1)}R`,
        xValue: takeProfit,
        yValue: stopLoss,
        score,
        drawdown: dd,
        robustness: clamp(score - dd * 85, 2, 99),
      });
    });
  });

  lookbackValues.forEach((lookback) => {
    thresholdValues.forEach((threshold) => {
      const trendFit = 1 - Math.abs(lookback - 34) / 40;
      const thresholdFit = 1 - Math.abs(threshold - 0.55) / 0.6;
      const dd = clamp(baseDrawdown + Math.abs(lookback - 30) * 0.003 + Math.abs(threshold - 0.55) * 0.08, 0.01, 0.9);
      const score = clamp(52 + baseReturn * 120 + trendFit * 20 + thresholdFit * 18 - dd * 86, 4, 99);
      drawdown.push({
        xLabel: `${lookback.toFixed(0)}d`,
        yLabel: threshold.toFixed(2),
        xValue: lookback,
        yValue: threshold,
        score,
        drawdown: dd,
        robustness: clamp(score - dd * 92, 1, 99),
      });
    });
  });

  return { performance, drawdown };
}

function buildModelCards(results: {
  valueAtRiskHistorical: number;
  expectedShortfallHistorical: number;
  pathSeries: SimulationPathPoint[];
  portfolioPathSeries: SimulationPathPoint[];
  kellyFractionCapped: number;
  bayesianReturn: number;
  drawdownTail: number;
  sharpeMedian: number;
  volatilitySeries: number[];
  drawdownSeries: number[];
  robustnessScore: number;
  overfittingRiskScore: number;
}): ModelSummaryItem[] {
  return [
    { id: "gbm", label: "GBM Fan", value: `${(results.pathSeries.at(-1)?.median ?? 100).toFixed(1)}`, tone: "accent", sparkline: results.pathSeries.map((item) => item.median) },
    { id: "portfolio", label: "Portfolio MC", value: `${(results.portfolioPathSeries.at(-1)?.median ?? 100).toFixed(1)}`, tone: "positive", sparkline: results.portfolioPathSeries.map((item) => item.median) },
    { id: "var", label: "Historical VaR", value: `${(results.valueAtRiskHistorical * 100).toFixed(2)}%`, tone: "negative", sparkline: results.pathSeries.map((item) => item.p05) },
    { id: "cvar", label: "Expected Shortfall", value: `${(results.expectedShortfallHistorical * 100).toFixed(2)}%`, tone: "negative", sparkline: results.drawdownSeries },
    { id: "kelly", label: "Kelly Size", value: `${(results.kellyFractionCapped * 100).toFixed(1)}%`, tone: "positive", sparkline: results.pathSeries.map((item) => item.mean) },
    { id: "bayes", label: "Bayesian Mean", value: `${(results.bayesianReturn * 100).toFixed(2)}%`, tone: "accent", sparkline: results.pathSeries.map((item) => item.p95) },
    { id: "dd", label: "Drawdown Tail", value: `${(results.drawdownTail * 100).toFixed(2)}%`, tone: "negative", sparkline: results.drawdownSeries },
    { id: "sharpe", label: "Sharpe Stability", value: results.sharpeMedian.toFixed(2), tone: "neutral", sparkline: results.volatilitySeries },
    { id: "robustness", label: "Robustness", value: `${results.robustnessScore.toFixed(0)}/100`, tone: "positive", sparkline: results.portfolioPathSeries.map((item) => item.p95) },
    { id: "overfit", label: "Overfitting Risk", value: `${results.overfittingRiskScore.toFixed(0)}/100`, tone: "negative", sparkline: results.portfolioPathSeries.map((item) => item.p05) },
  ];
}

export function deriveControlsFromDataset(dataset: DatasetOption, previous?: Partial<SimulationControls>): SimulationControls {
  const returns = dataset.observations.map((row) => row.strategyReturn);
  const meanReturn = mean(returns);
  const variance = returns.reduce((sum, value) => sum + (value - meanReturn) ** 2, 0) / Math.max(returns.length, 1);

  return {
    datasetId: dataset.id,
    simulationCount: previous?.simulationCount ?? 1000,
    horizon: previous?.horizon ?? 252,
    confidenceLevel: previous?.confidenceLevel ?? 0.95,
    drift: Number((meanReturn * TRADING_DAYS).toFixed(4)),
    volatility: Number((Math.max(standardDeviation(returns), Math.sqrt(variance)) * Math.sqrt(TRADING_DAYS)).toFixed(4)),
    bootstrapRuns: previous?.bootstrapRuns ?? 500,
    samplePaths: previous?.samplePaths ?? 6,
    portfolioWeightA: previous?.portfolioWeightA ?? 0.45,
    portfolioWeightB: previous?.portfolioWeightB ?? 0.35,
    portfolioWeightC: previous?.portfolioWeightC ?? 0.2,
    portfolioCorrelation: previous?.portfolioCorrelation ?? 0.38,
    stressScenario: previous?.stressScenario ?? "none",
    walkForwardTrainWindow: previous?.walkForwardTrainWindow ?? 126,
    walkForwardTestWindow: previous?.walkForwardTestWindow ?? 42,
    parameterStopLossMin: previous?.parameterStopLossMin ?? 2,
    parameterStopLossMax: previous?.parameterStopLossMax ?? 8,
    parameterTakeProfitMin: previous?.parameterTakeProfitMin ?? 1.5,
    parameterTakeProfitMax: previous?.parameterTakeProfitMax ?? 6,
    parameterLookbackMin: previous?.parameterLookbackMin ?? 10,
    parameterLookbackMax: previous?.parameterLookbackMax ?? 60,
    parameterThresholdMin: previous?.parameterThresholdMin ?? 0.2,
    parameterThresholdMax: previous?.parameterThresholdMax ?? 0.9,
  };
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

  const pathSeries = buildPathSeries(rawPaths, controls.samplePaths);
  const historicalVarThreshold = quantile(returns, 1 - controls.confidenceLevel);
  const historicalTail = returns.filter((value) => value <= historicalVarThreshold);
  const historicalExpectedShortfall = Math.abs(mean(historicalTail.length ? historicalTail : [historicalVarThreshold]));
  const parametricVar = Math.max(0, -(dailyMean - confidenceZ * dailyVolatility));
  const parametricEs = Math.max(0, -(dailyMean - dailyVolatility * (confidenceZ + 0.35)));
  const bootstrap = buildBootstrapDrawdowns(returns, controls.bootstrapRuns, horizon);
  const histogram = buildHistogram(returns, historicalVarThreshold, -historicalExpectedShortfall);
  const bootstrapPathSeries = buildPathSeries(bootstrap.paths.slice(0, Math.min(bootstrap.paths.length, 240)), controls.samplePaths);
  const volatilitySeries = buildGarchSeries(returns, dates);
  const drawdownSeries = buildDrawdownSeries(rawPaths.slice(0, Math.min(rawPaths.length, 260)));
  const drawdownHistogram = buildGenericHistogram(bootstrap.drawdowns.map((value) => -Math.abs(value)), -quantile(bootstrap.drawdowns.map((value) => Math.abs(value)), 0.9));
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

  const portfolioAllocations = buildPortfolioAllocations(controls, dailyMean, dailyVolatility);
  const portfolioSimulation = simulatePortfolioPaths(controls, portfolioAllocations, pathCount, horizon);
  const portfolioPathSeries = buildPathSeries(portfolioSimulation.paths, controls.samplePaths);
  const portfolioReturnHistogram = buildGenericHistogram(portfolioSimulation.terminalReturns, quantile(portfolioSimulation.terminalReturns, 0.1));
  const portfolioDrawdownHistogram = buildGenericHistogram(portfolioSimulation.drawdowns.map((value) => -value), -quantile(portfolioSimulation.drawdowns, 0.9));

  const stressScenarioResults = buildStressScenarioResults(controls, portfolioAllocations, pathCount, horizon);
  const selectedStressScenario = controls.stressScenario === "none"
    ? null
    : stressScenarioResults.find((item) => item.id === controls.stressScenario) ?? null;
  const walkForwardSeries = buildWalkForwardSeries(returns, controls);
  const overfitting = buildOverfittingSummary(returns, walkForwardSeries);
  const parameterHeatmaps = buildParameterHeatmap(controls, expectedReturn, maxDrawdown);
  const robustnessScore = clamp(
    62 + mean(walkForwardSeries.map((item) => item.stability)) * 0.22 + mean(parameterHeatmaps.performance.map((item) => item.robustness)) * 0.18 - overfitting.summary.riskScore * 0.24,
    6,
    99,
  );
  const riskScore = clamp(
    65 + sharpe * 8 + sortino * 4 + bayesianReturn * 40 - maxDrawdown * 90 - historicalExpectedShortfall * 140 - overfitting.summary.riskScore * 0.12,
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
    maxDrawdownProbability: portfolioSimulation.drawdowns.filter((value) => value >= maxDrawdown).length / Math.max(portfolioSimulation.drawdowns.length, 1),
    strategyRobustnessScore: robustnessScore,
    overfittingRiskScore: overfitting.summary.riskScore,
  };

  return {
    dataset,
    controls,
    returns,
    cumulativeEquity: buildCumulativeEquity(dataset.observations),
    pathSeries,
    bootstrapPathSeries,
    portfolioPathSeries,
    histogram,
    drawdownHistogram,
    portfolioReturnHistogram,
    portfolioDrawdownHistogram,
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
    metricSparklines: {
      expectedReturn: pathSeries.map((point) => point.mean),
      volatility: volatilitySeries.map((point) => point.garch),
      maxDrawdown: drawdownSeries.map((point) => point.p95Worst),
      sharpeRatio: bootstrap.sharpes.slice(0, 80),
      robustness: walkForwardSeries.map((point) => point.stability),
      overfitting: overfitting.distribution,
    },
    report,
    modelCards: buildModelCards({
      valueAtRiskHistorical: Math.abs(historicalVarThreshold),
      expectedShortfallHistorical: historicalExpectedShortfall,
      pathSeries,
      portfolioPathSeries,
      kellyFractionCapped,
      bayesianReturn,
      drawdownTail: quantile(bootstrap.drawdowns, 0.9),
      sharpeMedian: quantile(bootstrap.sharpes, 0.5),
      volatilitySeries: volatilitySeries.map((point) => point.garch),
      drawdownSeries: drawdownSeries.map((point) => point.p95Worst),
      robustnessScore,
      overfittingRiskScore: overfitting.summary.riskScore,
    }),
    portfolioAllocations,
    stressScenarioResults: selectedStressScenario ? [selectedStressScenario, ...stressScenarioResults.filter((item) => item.id !== selectedStressScenario.id)] : stressScenarioResults,
    walkForwardSeries,
    overfittingSummary: overfitting.summary,
    overfittingDistribution: overfitting.distribution,
    parameterHeatmap: parameterHeatmaps.performance,
    parameterDrawdownHeatmap: parameterHeatmaps.drawdown,
  };
}
