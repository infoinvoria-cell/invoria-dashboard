export const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export type MonthLabel = (typeof MONTH_LABELS)[number];
export type TradeDirection = "Long" | "Short";
export type TrackRecordTheme = "dark" | "blue";
export type MultiplierKey = "curve1x" | "curve2x" | "curve3x" | "curve4x" | "curve5x";
export type ChartViewMode = "regular" | "smooth" | "monthly" | "quarterly" | "yearly" | "warped";

export type TrackRecordTradeInput = {
  date: string;
  return_pct: number;
  trade_result?: number;
  trade_direction?: TradeDirection;
  source?: "historical" | "api";
};

export type StrategyDataPoint = {
  date: string;
  equity: number;
  return_pct: number;
  drawdown: number;
  trade_result: number;
  trade_direction: TradeDirection;
  source: "historical" | "api";
};

export type ChartPoint = {
  date: string;
  fullDate: string;
  curve1x: number;
  curve2x: number;
  curve3x: number;
  curve4x: number;
  curve5x: number;
};

export type PerformanceRow = {
  year: number;
  months: Record<MonthLabel, number | null>;
  total: number | null;
};

export type TradeCountByYear = {
  year: number;
  count: number;
};

export type Segment = {
  label: string;
  value: number;
  color: string;
};

export type TrackRecordModel = {
  strategyData: StrategyDataPoint[];
  chartData: ChartPoint[];
  performanceRows: PerformanceRow[];
  cumulativeReturn: number;
  annualAverageReturn: number;
  maxDrawdown: number;
  averageDrawdown: number;
  winRate: number;
  averageWinningTrade: number;
  trades: number;
  winningTrades: number;
  losingTrades: number;
  longTrades: number;
  shortTrades: number;
  longShortRatio: number;
  profitFactor: number;
  expectancy: number;
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  omegaRatio: number;
  tradeOutcomeSegments: Segment[];
  directionSegments: Segment[];
  tradesByYear: TradeCountByYear[];
  tradeBreakdownText: string;
  historicalStartDate: string | null;
  historicalEndDate: string | null;
  sparklineSeries: {
    cumulativeReturn: number[];
    rollingAnnualReturn: number[];
    drawdownDepth: number[];
    averageDrawdown: number[];
    rollingWinRate: number[];
    rollingAverageWin: number[];
  };
};

const START_EQUITY = 100_000;
const BUSINESS_DAYS_PER_YEAR = 252;
const CURVE_KEYS: MultiplierKey[] = ["curve1x", "curve2x", "curve3x", "curve4x", "curve5x"];

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function compound(returns: number[]): number {
  return returns.reduce((accumulator, current) => accumulator * (1 + current), 1) - 1;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = average(values);
  const variance = average(values.map((value) => (value - mean) ** 2));
  return Math.sqrt(variance);
}

function downsideDeviation(values: number[]): number {
  const downside = values.filter((value) => value < 0);
  if (downside.length === 0) return 0;
  const variance = average(downside.map((value) => value ** 2));
  return Math.sqrt(variance);
}

function annualizedReturn(totalReturn: number, periods: number): number {
  if (periods <= 0) return 0;
  return (1 + totalReturn) ** (BUSINESS_DAYS_PER_YEAR / periods) - 1;
}

function rollingMetric(values: number[], windowSize: number, reducer: (window: number[]) => number): number[] {
  return values.map((_, index) => {
    const startIndex = Math.max(0, index - windowSize + 1);
    return reducer(values.slice(startIndex, index + 1));
  });
}

function deriveDirection(seed: string, index: number): TradeDirection {
  let hash = 7;
  const value = `${seed}-${index}`;
  for (let cursor = 0; cursor < value.length; cursor += 1) {
    hash = (hash * 31 + value.charCodeAt(cursor)) % 100_003;
  }
  return hash % 100 < 51 ? "Long" : "Short";
}

function normalizeTradeInput(input: TrackRecordTradeInput, index: number): StrategyDataPoint | null {
  const parsedDate = new Date(input.date);
  if (Number.isNaN(parsedDate.getTime())) return null;

  const tradeReturn = Number(input.return_pct);
  if (!Number.isFinite(tradeReturn)) return null;

  return {
    date: parsedDate.toISOString(),
    equity: START_EQUITY,
    return_pct: round(tradeReturn, 4),
    drawdown: 0,
    trade_result: round(Number.isFinite(input.trade_result ?? Number.NaN) ? Number(input.trade_result) : tradeReturn, 4),
    trade_direction: input.trade_direction ?? deriveDirection(parsedDate.toISOString(), index),
    source: input.source ?? "historical",
  };
}

function buildStrategyData(trades: TrackRecordTradeInput[]): StrategyDataPoint[] {
  const normalized = trades
    .map((trade, index) => normalizeTradeInput(trade, index))
    .filter((trade): trade is StrategyDataPoint => trade != null)
    .sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime());

  let equity = START_EQUITY;
  let peak = START_EQUITY;

  return normalized.map((trade) => {
    equity *= 1 + trade.return_pct / 100;
    peak = Math.max(peak, equity);
    const drawdown = (equity - peak) / peak;

    return {
      ...trade,
      equity: round(equity, 2),
      drawdown: round(drawdown, 6),
    };
  });
}

function getReturnsDecimal(strategyData: StrategyDataPoint[]): number[] {
  return strategyData.map((point) => point.return_pct / 100);
}

function getCumulativeReturnSeries(strategyData: StrategyDataPoint[]): number[] {
  if (strategyData.length === 0) return [];
  return strategyData.map((point) => point.equity / START_EQUITY - 1);
}

function buildChartData(strategyData: StrategyDataPoint[]): ChartPoint[] {
  const cumulativeReturns = getCumulativeReturnSeries(strategyData);

  return strategyData.map((point, index) => {
    const date = new Date(point.date);
    const baseReturnPercent = cumulativeReturns[index] * 100;

    return {
      date: date.toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
      fullDate: point.date,
      curve1x: round(baseReturnPercent, 2),
      curve2x: round(baseReturnPercent * 2, 2),
      curve3x: round(baseReturnPercent * 3, 2),
      curve4x: round(baseReturnPercent * 4, 2),
      curve5x: round(baseReturnPercent * 5, 2),
    };
  });
}

function formatChartLabel(date: Date, mode: ChartViewMode): string {
  if (mode === "yearly") {
    return String(date.getUTCFullYear());
  }

  if (mode === "quarterly") {
    const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
    return `Q${quarter} ${String(date.getUTCFullYear()).slice(-2)}`;
  }

  return date.toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
}

function buildPeriodStartPoint(chartData: ChartPoint[], mode: Extract<ChartViewMode, "monthly" | "quarterly" | "yearly">): ChartPoint {
  const firstPoint = chartData[0];
  const firstDate = new Date(firstPoint.fullDate);

  return {
    date: mode === "yearly" ? `Start ${String(firstDate.getUTCFullYear()).slice(-2)}` : "Start",
    fullDate: firstPoint.fullDate,
    curve1x: 0,
    curve2x: 0,
    curve3x: 0,
    curve4x: 0,
    curve5x: 0,
  };
}

function sampleChartDataByPeriod(chartData: ChartPoint[], mode: Extract<ChartViewMode, "monthly" | "quarterly" | "yearly">): ChartPoint[] {
  if (chartData.length === 0) return [];

  const buckets = new Map<string, ChartPoint>();

  chartData.forEach((point) => {
    const date = new Date(point.fullDate);
    const bucketKey =
      mode === "monthly"
        ? `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`
        : mode === "quarterly"
          ? `${date.getUTCFullYear()}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`
          : `${date.getUTCFullYear()}`;

    buckets.set(bucketKey, point);
  });

  const sampled = Array.from(buckets.values()).map((point) => {
    const date = new Date(point.fullDate);
    return {
      ...point,
      date: formatChartLabel(date, mode),
    };
  });

  return [buildPeriodStartPoint(chartData, mode), ...sampled];
}

function smoothChartData(chartData: ChartPoint[], windowSize = 5): ChartPoint[] {
  if (chartData.length <= 2) return chartData;

  return chartData.map((point, index) => {
    if (index === 0 || index === chartData.length - 1) {
      return point;
    }

    const startIndex = Math.max(0, index - windowSize + 1);
    const window = chartData.slice(startIndex, index + 1);
    const smoothedPoint = { ...point };

    CURVE_KEYS.forEach((key) => {
      smoothedPoint[key] = round(average(window.map((entry) => Number(entry[key]))), 2);
    });

    return smoothedPoint;
  });
}

function interpolateChartPoint(previous: ChartPoint, current: ChartPoint, fraction: number): ChartPoint {
  const interpolated: ChartPoint = {
    date: "",
    fullDate: current.fullDate,
    curve1x: 0,
    curve2x: 0,
    curve3x: 0,
    curve4x: 0,
    curve5x: 0,
  };

  CURVE_KEYS.forEach((key) => {
    interpolated[key] = round(Number(previous[key]) + (Number(current[key]) - Number(previous[key])) * fraction, 2);
  });

  return interpolated;
}

function warpChartData(chartData: ChartPoint[]): ChartPoint[] {
  if (chartData.length <= 2) return chartData;

  const warped: ChartPoint[] = [{ ...chartData[0] }];
  let compressedFlatSegments = 0;

  for (let index = 1; index < chartData.length; index += 1) {
    const previous = chartData[index - 1];
    const current = chartData[index];
    const absDelta = Math.abs(current.curve1x - previous.curve1x);
    const isLastPoint = index === chartData.length - 1;

    if (absDelta < 0.28 && !isLastPoint) {
      compressedFlatSegments += 1;
      if (compressedFlatSegments % 4 !== 0) {
        continue;
      }
    } else {
      compressedFlatSegments = 0;
    }

    const stretchSteps = Math.min(Math.max(Math.round(absDelta / 2.4) + 1, 1), 6);

    for (let step = 1; step <= stretchSteps; step += 1) {
      const fraction = step / stretchSteps;
      const point = interpolateChartPoint(previous, current, fraction);
      point.date = step === stretchSteps ? current.date : "";
      warped.push(point);
    }
  }

  const lastOriginal = chartData[chartData.length - 1];
  const lastWarped = warped[warped.length - 1];
  if (lastWarped?.fullDate !== lastOriginal.fullDate) {
    warped.push({ ...lastOriginal });
  }

  return warped;
}

export function getChartDataForMode(chartData: ChartPoint[], mode: ChartViewMode): ChartPoint[] {
  switch (mode) {
    case "smooth":
      return smoothChartData(chartData);
    case "warped":
      return warpChartData(chartData);
    case "monthly":
      return sampleChartDataByPeriod(chartData, "monthly");
    case "quarterly":
      return sampleChartDataByPeriod(chartData, "quarterly");
    case "yearly":
      return sampleChartDataByPeriod(chartData, "yearly");
    case "regular":
    default:
      return chartData;
  }
}

function buildPerformanceRows(strategyData: StrategyDataPoint[]): PerformanceRow[] {
  const monthlyReturns = new Map<string, number[]>();

  strategyData.forEach((point) => {
    const date = new Date(point.date);
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    const existing = monthlyReturns.get(key) ?? [];
    existing.push(point.return_pct / 100);
    monthlyReturns.set(key, existing);
  });

  const years = Array.from(
    new Set(Array.from(monthlyReturns.keys()).map((key) => Number.parseInt(key.slice(0, 4), 10))),
  ).sort((left, right) => left - right);

  return years.map((year) => {
    const months = Object.fromEntries(MONTH_LABELS.map((month) => [month, null])) as Record<MonthLabel, number | null>;

    for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
      const key = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
      const returns = monthlyReturns.get(key);
      if (returns && returns.length > 0) {
        months[MONTH_LABELS[monthIndex]] = compound(returns);
      }
    }

    const realizedReturns = Object.values(months).filter((value): value is number => value != null);

    return {
      year,
      months,
      total: realizedReturns.length > 0 ? compound(realizedReturns) : null,
    };
  });
}

function getTradeCountsByYear(strategyData: StrategyDataPoint[]): TradeCountByYear[] {
  const counts = new Map<number, number>();

  strategyData.forEach((point) => {
    const year = new Date(point.date).getUTCFullYear();
    counts.set(year, (counts.get(year) ?? 0) + 1);
  });

  return Array.from(counts.entries())
    .map(([year, count]) => ({ year, count }))
    .sort((left, right) => left.year - right.year);
}

export function getRiskMetricScore(
  metric:
    | "profitFactor"
    | "expectancy"
    | "sharpeRatio"
    | "sortinoRatio"
    | "calmarRatio"
    | "omegaRatio",
  value: number,
): number {
  switch (metric) {
    case "profitFactor":
      return Math.round(clamp(35 + (value - 1) * 40, 0, 100));
    case "expectancy":
      return Math.round(clamp(30 + value * 18_000, 0, 100));
    case "sharpeRatio":
      return Math.round(clamp((value / 4.5) * 100, 0, 100));
    case "sortinoRatio":
      return Math.round(clamp((value / 6) * 100, 0, 100));
    case "calmarRatio":
      return Math.round(clamp((value / 4.5) * 100, 0, 100));
    case "omegaRatio":
      return Math.round(clamp(((value - 1) / 4) * 100, 0, 100));
    default:
      return 0;
  }
}

export function getMetricRating(score: number): string {
  if (score >= 90) return "ELITE";
  if (score >= 75) return "VERY STRONG";
  if (score >= 55) return "STRONG";
  return "BALANCED";
}

export function formatSignedPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

export function formatRatio(value: number): string {
  return value.toFixed(2);
}

export function buildTrackRecordModel(trades: TrackRecordTradeInput[]): TrackRecordModel {
  const strategyData = buildStrategyData(trades);
  const returns = getReturnsDecimal(strategyData);
  const cumulativeReturnSeries = getCumulativeReturnSeries(strategyData);
  const performanceRows = buildPerformanceRows(strategyData);

  const cumulativeReturn = strategyData.length > 0 ? strategyData[strategyData.length - 1].equity / START_EQUITY - 1 : 0;
  const realizedYearReturns = performanceRows
    .map((row) => row.total)
    .filter((value): value is number => value != null);
  const annualAverageReturn = average(realizedYearReturns);

  const drawdowns = strategyData.map((point) => point.drawdown);
  const negativeDrawdowns = drawdowns.filter((value) => value < 0).map((value) => Math.abs(value));
  const maxDrawdown = drawdowns.length > 0 ? Math.abs(Math.min(...drawdowns)) : 0;
  const averageDrawdown = average(negativeDrawdowns);

  const winningTrades = strategyData.filter((point) => point.trade_result > 0);
  const losingTrades = strategyData.filter((point) => point.trade_result < 0);
  const winRate = strategyData.length > 0 ? winningTrades.length / strategyData.length : 0;
  const averageWinningTrade = average(winningTrades.map((point) => point.trade_result / 100));

  const grossProfit = winningTrades.reduce((sum, point) => sum + point.trade_result / 100, 0);
  const grossLoss = Math.abs(losingTrades.reduce((sum, point) => sum + point.trade_result / 100, 0));
  const profitFactor = grossLoss === 0 ? 0 : grossProfit / grossLoss;

  const averageWin = average(winningTrades.map((point) => point.trade_result / 100));
  const averageLoss = average(losingTrades.map((point) => Math.abs(point.trade_result / 100)));
  const lossRate = 1 - winRate;
  const expectancy = winRate * averageWin - lossRate * averageLoss;

  const meanReturn = average(returns);
  const stdDev = standardDeviation(returns);
  const downsideStd = downsideDeviation(returns);
  const sharpeRatio = stdDev === 0 ? 0 : (meanReturn / stdDev) * Math.sqrt(BUSINESS_DAYS_PER_YEAR);
  const sortinoRatio = downsideStd === 0 ? 0 : (meanReturn / downsideStd) * Math.sqrt(BUSINESS_DAYS_PER_YEAR);
  const calmarRatio = maxDrawdown === 0 ? 0 : annualizedReturn(cumulativeReturn, returns.length) / maxDrawdown;
  const omegaRatio =
    grossLoss === 0 ? 0 : returns.filter((value) => value > 0).reduce((sum, value) => sum + value, 0) / grossLoss;

  const longTrades = strategyData.filter((point) => point.trade_direction === "Long").length;
  const shortTrades = strategyData.filter((point) => point.trade_direction === "Short").length;
  const longShortRatio = shortTrades === 0 ? 0 : longTrades / shortTrades;
  const historicalDates = strategyData.filter((point) => point.source === "historical").map((point) => point.date);

  return {
    strategyData,
    chartData: buildChartData(strategyData),
    performanceRows,
    cumulativeReturn,
    annualAverageReturn,
    maxDrawdown,
    averageDrawdown,
    winRate,
    averageWinningTrade,
    trades: strategyData.length,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    longTrades,
    shortTrades,
    longShortRatio,
    profitFactor,
    expectancy,
    sharpeRatio,
    sortinoRatio,
    calmarRatio,
    omegaRatio,
    tradeOutcomeSegments: [
      { label: "Winning", value: winningTrades.length, color: "#d6c38f" },
      { label: "Losing", value: losingTrades.length, color: "#3a4250" },
    ],
    directionSegments: [
      { label: "Long", value: longTrades, color: "#d6c38f" },
      { label: "Short", value: shortTrades, color: "#dfe8ff" },
    ],
    tradesByYear: getTradeCountsByYear(strategyData),
    tradeBreakdownText: `${winningTrades.length} winners / ${losingTrades.length} losers`,
    historicalStartDate: historicalDates[0] ?? null,
    historicalEndDate: historicalDates[historicalDates.length - 1] ?? null,
    sparklineSeries: {
      cumulativeReturn: cumulativeReturnSeries.map((value) => value * 100),
      rollingAnnualReturn: rollingMetric(cumulativeReturnSeries, 42, (window) =>
        annualizedReturn(window[window.length - 1], window.length) * 100,
      ),
      drawdownDepth: drawdowns.map((value) => Math.abs(value) * 100),
      averageDrawdown: rollingMetric(
        drawdowns.map((value) => Math.abs(value)),
        30,
        (window) => average(window) * 100,
      ),
      rollingWinRate: rollingMetric(
        strategyData.map((point) => (point.trade_result > 0 ? 1 : 0)),
        30,
        average,
      ).map((value) => value * 100),
      rollingAverageWin: rollingMetric(
        strategyData.map((point) => point.trade_result / 100),
        25,
        (window) => average(window.filter((value) => value > 0)) * 100,
      ),
    },
  };
}
