import { MONTH_LABELS, type MonthLabel, type PerformanceRow, type TrackRecordTheme } from "@/components/track-record/metrics";
import type { EdgeStrategyDirection, EdgeStrategyDocument, EdgeStrategyTrade } from "@/lib/edgePortfolioStore";

export type StrategySummary = {
  id: string;
  name: string;
  asset: string;
  tradeCount: number;
  totalReturn: number;
  annualizedReturn: number;
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdown: number;
  profitFactor: number;
  winRate: number;
  expectancy: number;
  averageTrade: number;
  sparkline: number[];
};

export type PortfolioContributionRow = {
  label: string;
  [key: string]: string | number;
};

export type PortfolioContributionItem = {
  id: string;
  name: string;
  color: string;
  weightedReturn: number;
  riskShare: number;
  drawdownShare: number;
  weight: number;
};

export type CorrelationCell = {
  rowId: string;
  colId: string;
  rowLabel: string;
  colLabel: string;
  value: number;
};

export type TradeHistogramBin = {
  label: string;
  midpoint: number;
  count: number;
};

export type PortfolioChartPoint = {
  date: string;
  fullDate: string;
  portfolioReturn: number;
  equity: number;
  drawdown: number;
  [key: string]: string | number;
};

export type PortfolioLineMeta = {
  id: string;
  name: string;
  color: string;
};

export type PortfolioKpiItem = {
  title: string;
  value: string;
  footer: string;
  sparkline: number[];
  tone: "positive" | "negative" | "neutral" | "success";
  tooltip: string;
};

export type EdgePortfolioModel = {
  chartData: PortfolioChartPoint[];
  performanceRows: PerformanceRow[];
  totalCumulativeReturn: number;
  annualizedReturn: number;
  maxDrawdown: number;
  sharpeRatio: number;
  sortinoRatio: number;
  profitFactor: number;
  winRate: number;
  expectancy: number;
  averageTrade: number;
  totalTrades: number;
  averageDrawdown: number;
  overlayLines: PortfolioLineMeta[];
  kpis: PortfolioKpiItem[];
  contributionItems: PortfolioContributionItem[];
  monthlyContributionRows: PortfolioContributionRow[];
  correlationMatrix: CorrelationCell[];
  riskContributions: PortfolioContributionItem[];
  tradeHistogram: TradeHistogramBin[];
  tradesByDirection: Array<{ label: string; value: number; color: string }>;
  tradesByStrategy: Array<{ label: string; value: number; color: string }>;
};

const START_EQUITY = 100_000;
const BUSINESS_DAYS_PER_YEAR = 252;
const STRATEGY_COLORS = [
  "#d6c38f",
  "#8fb6ff",
  "#ff9f6b",
  "#5bd68c",
  "#ff6b88",
  "#9f8bff",
  "#7fd4d6",
  "#ffd76c",
];

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function compound(values: number[]): number {
  return values.reduce((accumulator, current) => accumulator * (1 + current), 1) - 1;
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = average(values);
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
}

function downsideDeviation(values: number[]): number {
  const downside = values.filter((value) => value < 0);
  if (downside.length === 0) return 0;
  return Math.sqrt(average(downside.map((value) => value ** 2)));
}

function annualizedReturn(totalReturn: number, periods: number): number {
  if (periods <= 0) return 0;
  return (1 + totalReturn) ** (BUSINESS_DAYS_PER_YEAR / periods) - 1;
}

function pearsonCorrelation(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length < 2) return 0;
  const leftMean = average(left);
  const rightMean = average(right);
  let numerator = 0;
  let leftSum = 0;
  let rightSum = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = left[index] - leftMean;
    const rightDelta = right[index] - rightMean;
    numerator += leftDelta * rightDelta;
    leftSum += leftDelta ** 2;
    rightSum += rightDelta ** 2;
  }

  const denominator = Math.sqrt(leftSum * rightSum);
  return denominator === 0 ? 0 : numerator / denominator;
}

function rollingMetric(values: number[], windowSize: number, reducer: (window: number[]) => number): number[] {
  return values.map((_, index) => {
    const startIndex = Math.max(0, index - windowSize + 1);
    return reducer(values.slice(startIndex, index + 1));
  });
}

function toneForValue(value: number): "positive" | "negative" | "neutral" {
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "neutral";
}

function formatSignedPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

function formatRatio(value: number): string {
  return value.toFixed(2);
}

function colorForIndex(index: number): string {
  return STRATEGY_COLORS[index % STRATEGY_COLORS.length];
}

function getTradeDirectionCounts(strategies: EdgeStrategyDocument[]): Record<EdgeStrategyDirection, number> {
  return strategies.reduce(
    (accumulator, strategy) => {
      strategy.trades.forEach((trade) => {
        accumulator[trade.direction] += 1;
      });
      return accumulator;
    },
    { Long: 0, Short: 0 },
  );
}

function buildEquityCurve(returns: number[]): { cumulative: number[]; drawdowns: number[] } {
  let equity = START_EQUITY;
  let peak = START_EQUITY;
  const cumulative: number[] = [];
  const drawdowns: number[] = [];

  returns.forEach((tradeReturn) => {
    equity *= 1 + tradeReturn;
    peak = Math.max(peak, equity);
    cumulative.push(equity / START_EQUITY - 1);
    drawdowns.push((equity - peak) / peak);
  });

  return { cumulative, drawdowns };
}

function summarizeTradeSeries(name: string, asset: string, trades: EdgeStrategyTrade[]): StrategySummary {
  const returns = trades.map((trade) => trade.tradeReturnPct / 100);
  const { cumulative, drawdowns } = buildEquityCurve(returns);
  const totalReturn = cumulative[cumulative.length - 1] ?? 0;
  const winners = returns.filter((value) => value > 0);
  const losers = returns.filter((value) => value < 0);
  const meanReturn = average(returns);
  const stdDev = standardDeviation(returns);
  const downsideStd = downsideDeviation(returns);
  const grossProfit = winners.reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(losers.reduce((sum, value) => sum + value, 0));
  const maxDrawdown = drawdowns.length > 0 ? Math.abs(Math.min(...drawdowns)) : 0;
  const winRate = returns.length > 0 ? winners.length / returns.length : 0;
  const averageWin = average(winners);
  const averageLoss = average(losers.map((value) => Math.abs(value)));

  return {
    id: name,
    name,
    asset,
    tradeCount: trades.length,
    totalReturn,
    annualizedReturn: annualizedReturn(totalReturn, returns.length),
    sharpeRatio: stdDev === 0 ? 0 : (meanReturn / stdDev) * Math.sqrt(BUSINESS_DAYS_PER_YEAR),
    sortinoRatio: downsideStd === 0 ? 0 : (meanReturn / downsideStd) * Math.sqrt(BUSINESS_DAYS_PER_YEAR),
    maxDrawdown,
    profitFactor: grossLoss === 0 ? 0 : grossProfit / grossLoss,
    winRate,
    expectancy: winRate * averageWin - (1 - winRate) * averageLoss,
    averageTrade: meanReturn,
    sparkline: cumulative.map((value) => value * 100),
  };
}

function buildPerformanceRowsFromReturns(dateReturns: Array<{ date: string; returnDecimal: number }>): PerformanceRow[] {
  const monthlyReturns = new Map<string, number[]>();

  dateReturns.forEach((point) => {
    const date = new Date(point.date);
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    const existing = monthlyReturns.get(key) ?? [];
    existing.push(point.returnDecimal);
    monthlyReturns.set(key, existing);
  });

  const years = Array.from(new Set(Array.from(monthlyReturns.keys()).map((key) => Number(key.slice(0, 4))))).sort(
    (left, right) => left - right,
  );

  return years.map((year) => {
    const months = Object.fromEntries(MONTH_LABELS.map((month) => [month, null])) as Record<MonthLabel, number | null>;
    for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
      const monthKey = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
      const values = monthlyReturns.get(monthKey);
      if (values?.length) {
        months[MONTH_LABELS[monthIndex]] = compound(values);
      }
    }

    const realized = Object.values(months).filter((value): value is number => value != null);
    return {
      year,
      months,
      total: realized.length ? compound(realized) : null,
    };
  });
}

function buildHistogram(values: number[], binCount = 12): TradeHistogramBin[] {
  if (values.length === 0) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const width = max === min ? 1 : (max - min) / binCount;
  const bins = Array.from({ length: binCount }, (_, index) => ({
    label: `${(min + width * index) * 100 >= 0 ? "+" : ""}${((min + width * index) * 100).toFixed(1)}%`,
    midpoint: min + width * (index + 0.5),
    count: 0,
  }));

  values.forEach((value) => {
    const index = Math.min(binCount - 1, Math.max(0, Math.floor((value - min) / width)));
    bins[index].count += 1;
  });

  return bins;
}

function normalizeWeights(selectedIds: string[], weights: Record<string, number>): Record<string, number> {
  if (selectedIds.length === 0) return {};
  const raw = selectedIds.map((id) => Math.max(0, Number(weights[id] ?? 0)));
  const total = raw.reduce((sum, value) => sum + value, 0);
  if (total <= 0) {
    const equalWeight = 1 / selectedIds.length;
    return Object.fromEntries(selectedIds.map((id) => [id, equalWeight]));
  }
  return Object.fromEntries(selectedIds.map((id, index) => [id, raw[index] / total]));
}

export function buildStrategySummaries(strategies: EdgeStrategyDocument[]): StrategySummary[] {
  return strategies.map((strategy) => {
    const summary = summarizeTradeSeries(strategy.name, strategy.asset, strategy.trades);
    return {
      ...summary,
      id: strategy.id,
    };
  });
}

export function buildEdgePortfolioModel(
  strategies: EdgeStrategyDocument[],
  selectedIds: string[],
  rawWeights: Record<string, number>,
  theme: TrackRecordTheme,
): EdgePortfolioModel {
  const selectedStrategies = strategies.filter((strategy) => selectedIds.includes(strategy.id));
  const normalizedWeights = normalizeWeights(selectedIds, rawWeights);
  const overlayLines = selectedStrategies.map((strategy, index) => ({
    id: strategy.id,
    name: strategy.name,
    color: colorForIndex(index),
  }));

  if (selectedStrategies.length === 0) {
    return {
      chartData: [],
      performanceRows: [],
      totalCumulativeReturn: 0,
      annualizedReturn: 0,
      maxDrawdown: 0,
      sharpeRatio: 0,
      sortinoRatio: 0,
      profitFactor: 0,
      winRate: 0,
      expectancy: 0,
      averageTrade: 0,
      totalTrades: 0,
      averageDrawdown: 0,
      overlayLines,
      kpis: [],
      contributionItems: [],
      monthlyContributionRows: [],
      correlationMatrix: [],
      riskContributions: [],
      tradeHistogram: [],
      tradesByDirection: [],
      tradesByStrategy: [],
    };
  }

  const returnsByStrategy = new Map<string, Map<string, number>>();
  const unionDates = new Set<string>();
  const contributionsByMonth = new Map<string, Record<string, number>>();
  const strategySummaries = buildStrategySummaries(selectedStrategies);

  selectedStrategies.forEach((strategy) => {
    const dateMap = new Map<string, number[]>();
    strategy.trades.forEach((trade) => {
      const key = new Date(trade.timestamp).toISOString();
      const existing = dateMap.get(key) ?? [];
      existing.push(trade.tradeReturnPct / 100);
      dateMap.set(key, existing);
      unionDates.add(key);
    });

    const compoundedByDate = new Map<string, number>();
    Array.from(dateMap.entries()).forEach(([date, values]) => {
      const combined = compound(values);
      compoundedByDate.set(date, combined);
      const monthKey = date.slice(0, 7);
      const monthRow = contributionsByMonth.get(monthKey) ?? {};
      monthRow[strategy.id] = (monthRow[strategy.id] ?? 0) + combined * (normalizedWeights[strategy.id] ?? 0);
      contributionsByMonth.set(monthKey, monthRow);
    });
    returnsByStrategy.set(strategy.id, compoundedByDate);
  });

  const sortedDates = Array.from(unionDates).sort((left, right) => new Date(left).getTime() - new Date(right).getTime());
  const strategyEquities = Object.fromEntries(selectedStrategies.map((strategy) => [strategy.id, START_EQUITY]));
  const chartData: PortfolioChartPoint[] = [];
  const dateReturns: Array<{ date: string; returnDecimal: number }> = [];
  const portfolioReturns: number[] = [];
  let portfolioEquity = START_EQUITY;
  let portfolioPeak = START_EQUITY;

  sortedDates.forEach((date) => {
    let portfolioReturn = 0;
    const chartPoint: PortfolioChartPoint = {
      date: new Date(date).toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
      fullDate: date,
      portfolioReturn: 0,
      equity: 0,
      drawdown: 0,
    };

    selectedStrategies.forEach((strategy) => {
      const strategyReturn = returnsByStrategy.get(strategy.id)?.get(date) ?? 0;
      strategyEquities[strategy.id] *= 1 + strategyReturn;
      chartPoint[strategy.id] = round(((strategyEquities[strategy.id] / START_EQUITY) - 1) * 100, 2);
      portfolioReturn += strategyReturn * (normalizedWeights[strategy.id] ?? 0);
    });

    portfolioEquity *= 1 + portfolioReturn;
    portfolioPeak = Math.max(portfolioPeak, portfolioEquity);
    const cumulativeReturn = portfolioEquity / START_EQUITY - 1;
    const drawdown = (portfolioEquity - portfolioPeak) / portfolioPeak;

    chartPoint.portfolioReturn = round(cumulativeReturn * 100, 2);
    chartPoint.equity = round(portfolioEquity, 2);
    chartPoint.drawdown = round(Math.abs(drawdown) * 100, 2);

    chartData.push(chartPoint);
    portfolioReturns.push(portfolioReturn);
    dateReturns.push({ date, returnDecimal: portfolioReturn });
  });

  const performanceRows = buildPerformanceRowsFromReturns(dateReturns);
  const totalCumulativeReturn = chartData.length ? portfolioEquity / START_EQUITY - 1 : 0;
  const drawdowns = chartData.map((point) => Number(point.drawdown) / 100);
  const maxDrawdown = drawdowns.length ? Math.max(...drawdowns) : 0;
  const averageDrawdown = average(drawdowns.filter((value) => value > 0));
  const winners = portfolioReturns.filter((value) => value > 0);
  const losers = portfolioReturns.filter((value) => value < 0);
  const grossProfit = winners.reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(losers.reduce((sum, value) => sum + value, 0));
  const meanReturn = average(portfolioReturns);
  const stdDev = standardDeviation(portfolioReturns);
  const downsideStd = downsideDeviation(portfolioReturns);
  const winRate = portfolioReturns.length ? winners.length / portfolioReturns.length : 0;
  const averageWin = average(winners);
  const averageLoss = average(losers.map((value) => Math.abs(value)));
  const expectancy = winRate * averageWin - (1 - winRate) * averageLoss;
  const annualized = annualizedReturn(totalCumulativeReturn, portfolioReturns.length);

  const contributionItems = selectedStrategies.map((strategy, index) => {
    const strategySummary = strategySummaries.find((item) => item.id === strategy.id);
    const strategyReturns = strategy.trades.map((trade) => trade.tradeReturnPct / 100);
    return {
      id: strategy.id,
      name: strategy.name,
      color: colorForIndex(index),
      weightedReturn: (strategySummary?.totalReturn ?? 0) * (normalizedWeights[strategy.id] ?? 0),
      riskShare: (standardDeviation(strategyReturns) || 0) * (normalizedWeights[strategy.id] ?? 0),
      drawdownShare:
        average(strategyReturns.filter((value) => value < 0).map((value) => Math.abs(value))) *
        (normalizedWeights[strategy.id] ?? 0),
      weight: normalizedWeights[strategy.id] ?? 0,
    };
  });

  const totalRiskShare = contributionItems.reduce((sum, item) => sum + item.riskShare, 0) || 1;
  const totalDrawdownShare = contributionItems.reduce((sum, item) => sum + item.drawdownShare, 0) || 1;
  const normalizedContributionItems = contributionItems.map((item) => ({
    ...item,
    riskShare: item.riskShare / totalRiskShare,
    drawdownShare: item.drawdownShare / totalDrawdownShare,
  }));

  const monthlyContributionRows = Array.from(contributionsByMonth.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([month, values]) => ({
      label: new Date(`${month}-01T00:00:00.000Z`).toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
      ...Object.fromEntries(selectedStrategies.map((strategy) => [strategy.id, round((values[strategy.id] ?? 0) * 100, 2)])),
    }));

  const correlationMatrix = selectedStrategies.flatMap((rowStrategy) =>
    selectedStrategies.map((colStrategy) => {
      const rowReturns = sortedDates.map((date) => returnsByStrategy.get(rowStrategy.id)?.get(date) ?? 0);
      const colReturns = sortedDates.map((date) => returnsByStrategy.get(colStrategy.id)?.get(date) ?? 0);
      return {
        rowId: rowStrategy.id,
        colId: colStrategy.id,
        rowLabel: rowStrategy.name,
        colLabel: colStrategy.name,
        value: round(pearsonCorrelation(rowReturns, colReturns), 4),
      };
    }),
  );

  const directionCounts = getTradeDirectionCounts(selectedStrategies);
  const tradesByDirection = [
    { label: "Long", value: directionCounts.Long, color: theme === "dark" ? "#d6c38f" : "#4d87fe" },
    { label: "Short", value: directionCounts.Short, color: theme === "dark" ? "#dfe8ff" : "#b8d0ff" },
  ];

  const tradesByStrategy = selectedStrategies.map((strategy, index) => ({
    label: strategy.name,
    value: strategy.trades.length,
    color: colorForIndex(index),
  }));

  const cumulativeSeries = chartData.map((point) => Number(point.portfolioReturn));
  const kpis: PortfolioKpiItem[] = [
    {
      title: "Total Return",
      value: formatSignedPercent(totalCumulativeReturn),
      footer: "Combined selected strategies",
      sparkline: cumulativeSeries,
      tone: toneForValue(totalCumulativeReturn),
      tooltip: "Gesamtrendite des gewichteten Strategie-Portfolios.",
    },
    {
      title: "Annualized Return",
      value: formatSignedPercent(annualized),
      footer: "Annualized portfolio growth",
      sparkline: rollingMetric(cumulativeSeries, 21, average),
      tone: toneForValue(annualized),
      tooltip: "Auf Jahresbasis hochgerechnete Rendite des Portfolios.",
    },
    {
      title: "Max Drawdown",
      value: formatSignedPercent(-maxDrawdown),
      footer: "Largest peak-to-trough decline",
      sparkline: chartData.map((point) => Number(point.drawdown)),
      tone: "negative",
      tooltip: "Groesster historischer Kapitalrueckgang vom Hoch zum Tief.",
    },
    {
      title: "Sharpe Ratio",
      value: formatRatio(stdDev === 0 ? 0 : (meanReturn / stdDev) * Math.sqrt(BUSINESS_DAYS_PER_YEAR)),
      footer: "Risk-adjusted return",
      sparkline: rollingMetric(portfolioReturns, 20, average).map((value) => value * 100),
      tone: "positive",
      tooltip: "Misst das Risiko-bereinigte Verhaeltnis von Rendite zu Volatilitaet.",
    },
    {
      title: "Sortino Ratio",
      value: formatRatio(downsideStd === 0 ? 0 : (meanReturn / downsideStd) * Math.sqrt(BUSINESS_DAYS_PER_YEAR)),
      footer: "Downside adjusted return",
      sparkline: rollingMetric(
        portfolioReturns.map((value) => Math.max(0, value)),
        20,
        average,
      ).map((value) => value * 100),
      tone: "positive",
      tooltip: "Bewertet Rendite nur relativ zum negativen Risiko.",
    },
    {
      title: "Profit Factor",
      value: formatRatio(grossLoss === 0 ? 0 : grossProfit / grossLoss),
      footer: "Gross profit versus gross loss",
      sparkline: rollingMetric(portfolioReturns, 24, (window) => {
        const windowWins = window.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
        const windowLosses = Math.abs(window.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));
        return windowLosses === 0 ? 0 : (windowWins / windowLosses) * 100;
      }),
      tone: "positive",
      tooltip: "Verhaeltnis von Bruttogewinnen zu Bruttoverlusten.",
    },
    {
      title: "Win Rate",
      value: formatSignedPercent(winRate).replace("+", ""),
      footer: "Winning trade frequency",
      sparkline: rollingMetric(
        portfolioReturns.map((value) => (value > 0 ? 1 : 0)),
        25,
        average,
      ).map((value) => value * 100),
      tone: "success",
      tooltip: "Anteil der profitablen Trades oder Portfolio-Events.",
    },
    {
      title: "Expectancy",
      value: formatSignedPercent(expectancy),
      footer: "Expected edge per trade",
      sparkline: rollingMetric(portfolioReturns, 20, average).map((value) => value * 100),
      tone: toneForValue(expectancy),
      tooltip: "Durchschnittlicher erwarteter Gewinn pro Trade.",
    },
    {
      title: "Average Trade",
      value: formatSignedPercent(meanReturn),
      footer: "Mean weighted trade return",
      sparkline: rollingMetric(portfolioReturns, 18, average).map((value) => value * 100),
      tone: toneForValue(meanReturn),
      tooltip: "Durchschnittliche gewichtete Rendite pro Portfolio-Trade.",
    },
    {
      title: "Total Trades",
      value: String(selectedStrategies.reduce((sum, strategy) => sum + strategy.trades.length, 0)),
      footer: "Trades across selected strategies",
      sparkline: selectedStrategies.map((strategy) => strategy.trades.length),
      tone: "neutral",
      tooltip: "Gesamtzahl aller Trades in den ausgewaehlten Strategien.",
    },
  ];

  return {
    chartData,
    performanceRows,
    totalCumulativeReturn,
    annualizedReturn: annualized,
    maxDrawdown,
    sharpeRatio: stdDev === 0 ? 0 : (meanReturn / stdDev) * Math.sqrt(BUSINESS_DAYS_PER_YEAR),
    sortinoRatio: downsideStd === 0 ? 0 : (meanReturn / downsideStd) * Math.sqrt(BUSINESS_DAYS_PER_YEAR),
    profitFactor: grossLoss === 0 ? 0 : grossProfit / grossLoss,
    winRate,
    expectancy,
    averageTrade: meanReturn,
    totalTrades: selectedStrategies.reduce((sum, strategy) => sum + strategy.trades.length, 0),
    averageDrawdown,
    overlayLines,
    kpis,
    contributionItems: normalizedContributionItems,
    monthlyContributionRows,
    correlationMatrix,
    riskContributions: normalizedContributionItems,
    tradeHistogram: buildHistogram(portfolioReturns),
    tradesByDirection,
    tradesByStrategy,
  };
}
