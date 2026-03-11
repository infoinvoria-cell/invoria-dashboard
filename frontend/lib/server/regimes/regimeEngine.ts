import { promises as fs } from "node:fs";
import path from "node:path";

import type {
  CurrentRegimeCard,
  RegimeAnalysisResponse,
  RegimeHeatmapCell,
  RegimeInputRow,
  RegimeMacro,
  RegimeMetricRow,
  RegimeSourceSummary,
  RegimeSourceType,
  RegimeTimelinePoint,
  RegimeTrend,
  RegimeVolatility,
  TrafficLight,
} from "@/lib/regimes/types";

function demoRoots(): string[] {
  const cwd = process.cwd();
  return Array.from(new Set([
    path.join(cwd, "data", "demo"),
    path.join(cwd, "frontend", "data", "demo"),
  ]));
}

function avg(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function std(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = avg(values);
  return Math.sqrt(avg(values.map((value) => (value - mean) ** 2)));
}

function quantile(values: number[], q: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.round((sorted.length - 1) * q)));
  return sorted[index];
}

function maxDrawdownFromReturns(returns: number[]): number {
  let equity = 1;
  let peak = 1;
  let maxDd = 0;
  for (const value of returns) {
    equity *= (1 + value);
    peak = Math.max(peak, equity);
    maxDd = Math.min(maxDd, (equity - peak) / peak);
  }
  return maxDd;
}

function classifyVolatility(value: number, low: number, high: number): RegimeVolatility {
  if (value <= low) return "Low Vol";
  if (value >= high) return "High Vol";
  return "Medium Vol";
}

function classifyTrend(priceToMa: number, slope: number): RegimeTrend {
  if (priceToMa > 0.015 && slope > 0.003) return "Bull";
  if (priceToMa < -0.015 && slope < -0.003) return "Bear";
  return "Sideways";
}

function classifyMacro(trend: RegimeTrend, volatility: RegimeVolatility): RegimeMacro {
  if (trend === "Bull" && volatility !== "High Vol") return "Risk On";
  if (trend === "Bear" || volatility === "High Vol") return "Risk Off";
  return "Neutral";
}

function lightFor(label: string, kind: "vol" | "trend" | "macro" | "fit"): TrafficLight {
  if (kind === "vol") {
    if (label === "Low Vol") return "green";
    if (label === "Medium Vol") return "yellow";
    return "red";
  }
  if (kind === "trend") {
    if (label === "Bull") return "green";
    if (label === "Sideways") return "yellow";
    return "red";
  }
  if (kind === "macro") {
    if (label === "Risk On") return "green";
    if (label === "Neutral") return "yellow";
    return "red";
  }
  if (label === "Favorable") return "green";
  if (label === "Mixed") return "yellow";
  return "red";
}

function formatPct(value: number): string {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
}

function normalizeRows(rows: RegimeInputRow[]): RegimeInputRow[] {
  return rows
    .map((row) => ({
      date: new Date(row.date).toISOString(),
      equity: Number(row.equity),
    }))
    .filter((row) => Number.isFinite(new Date(row.date).getTime()) && Number.isFinite(row.equity) && row.equity > 0)
    .sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime());
}

function buildTimeline(rows: RegimeInputRow[]): RegimeTimelinePoint[] {
  const normalized = normalizeRows(rows);
  if (normalized.length < 6) return [];

  const returns = normalized.map((row, index) => (
    index === 0 ? 0 : (row.equity / normalized[index - 1].equity) - 1
  ));
  const maWindow = 6;
  const volWindow = 6;
  const rollingVolSeries = normalized.map((_, index) => {
    const start = Math.max(1, index - volWindow + 1);
    return std(returns.slice(start, index + 1));
  });
  const lowVol = quantile(rollingVolSeries.slice(1), 0.33);
  const highVol = quantile(rollingVolSeries.slice(1), 0.66);

  return normalized.map((row, index) => {
    const start = Math.max(0, index - maWindow + 1);
    const ma = avg(normalized.slice(start, index + 1).map((item) => item.equity));
    const prevMa = avg(normalized.slice(Math.max(0, index - maWindow), Math.max(1, index)).map((item) => item.equity));
    const priceToMa = ma > 0 ? (row.equity / ma) - 1 : 0;
    const slope = prevMa > 0 ? (ma / prevMa) - 1 : 0;
    const volatilityRegime = classifyVolatility(rollingVolSeries[index], lowVol, highVol);
    const trendRegime = classifyTrend(priceToMa, slope);
    const macroRegime = classifyMacro(trendRegime, volatilityRegime);

    return {
      index,
      date: row.date,
      equity: row.equity,
      returnPct: returns[index],
      rollingVol: rollingVolSeries[index],
      trendSlope: slope,
      volatilityRegime,
      trendRegime,
      macroRegime,
      combinedRegime: `${trendRegime} | ${volatilityRegime}`,
    };
  });
}

function buildRegimeTable(timeline: RegimeTimelinePoint[]): RegimeMetricRow[] {
  const buckets = new Map<string, RegimeTimelinePoint[]>();
  for (const point of timeline.slice(1)) {
    const bucket = buckets.get(point.combinedRegime) ?? [];
    bucket.push(point);
    buckets.set(point.combinedRegime, bucket);
  }

  return Array.from(buckets.entries())
    .map(([regime, points]) => {
      const returns = points.map((point) => point.returnPct);
      const totalReturn = returns.reduce((acc, value) => acc * (1 + value), 1) - 1;
      const sharpe = std(returns) > 0 ? (avg(returns) / std(returns)) * Math.sqrt(12) : 0;
      return {
        regime,
        returnPct: totalReturn,
        sharpe,
        maxDrawdown: maxDrawdownFromReturns(returns),
        tradeCount: points.length,
      };
    })
    .sort((left, right) => right.sharpe - left.sharpe);
}

function buildHeatmap(timeline: RegimeTimelinePoint[]): RegimeHeatmapCell[] {
  const trends: RegimeTrend[] = ["Bull", "Sideways", "Bear"];
  const vols: RegimeVolatility[] = ["Low Vol", "Medium Vol", "High Vol"];
  return trends.flatMap((trend) => vols.map((volatility) => {
    const points = timeline.slice(1).filter((point) => point.trendRegime === trend && point.volatilityRegime === volatility);
    const returns = points.map((point) => point.returnPct);
    return {
      trend,
      volatility,
      sharpe: std(returns) > 0 ? (avg(returns) / std(returns)) * Math.sqrt(12) : 0,
      returnPct: returns.reduce((acc, value) => acc * (1 + value), 1) - 1,
      maxDrawdown: maxDrawdownFromReturns(returns),
      tradeCount: points.length,
    };
  }));
}

function buildInterpretation(current: RegimeTimelinePoint): string {
  if (current.macroRegime === "Risk Off") {
    return "Current conditions suggest defensive positioning with elevated stress. Fragile mean-reversion profiles are less attractive than robust trend-following behavior.";
  }
  if (current.macroRegime === "Risk On") {
    return "Current conditions are constructive. Strategies that benefit from directional persistence and contained volatility are more likely to hold up.";
  }
  return "Current conditions are mixed. Favor strategies with stable regime behavior rather than those that rely on one narrow environment.";
}

function buildCurrentSummary(current: RegimeTimelinePoint): CurrentRegimeCard[] {
  const fit = current.macroRegime === "Risk On" ? "Favorable" : current.macroRegime === "Neutral" ? "Mixed" : "Unfavorable";
  return [
    {
      label: "Volatility Regime",
      value: current.volatilityRegime,
      light: lightFor(current.volatilityRegime, "vol"),
      detail: `Rolling volatility ${formatPct(current.rollingVol)} over the default 6-period window.`,
    },
    {
      label: "Trend Regime",
      value: current.trendRegime,
      light: lightFor(current.trendRegime, "trend"),
      detail: "Trend derived from price versus moving average and MA slope.",
    },
    {
      label: "Strategy Fit",
      value: fit,
      light: lightFor(fit, "fit"),
      detail: `Macro proxy currently reads ${current.macroRegime}.`,
    },
  ];
}

export async function loadDefaultRegimeRows(): Promise<RegimeInputRow[]> {
  for (const root of demoRoots()) {
    const filePath = path.join(root, "default_track_record.csv");
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const rows = raw
        .split(/\r?\n/)
        .slice(1)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [date, equity] = line.split(",");
          return { date, equity: Number(equity) };
        });
      if (rows.length) return normalizeRows(rows);
    } catch {
      // try next root
    }
  }
  throw new Error("Default regimes dataset not found.");
}

export function analyzeRegimeDataset(rows: RegimeInputRow[], sourceType: RegimeSourceType, sourceName: string): RegimeAnalysisResponse {
  const normalized = normalizeRows(rows);
  const timeline = buildTimeline(normalized);
  if (!timeline.length) {
    throw new Error("Not enough data points to compute regime analysis.");
  }

  const current = timeline[timeline.length - 1];
  const source: RegimeSourceSummary = {
    name: sourceName,
    type: sourceType,
    dateRange: `${normalized[0]?.date.slice(0, 10)} -> ${normalized[normalized.length - 1]?.date.slice(0, 10)}`,
    trades: Math.max(normalized.length - 1, 0),
    market: "Multi-year equity curve",
    status: "Ready",
    isDemo: sourceType === "demo",
  };

  return {
    source,
    interpretation: buildInterpretation(current),
    currentSummary: buildCurrentSummary(current),
    timeline,
    regimeTable: buildRegimeTable(timeline),
    heatmap: buildHeatmap(timeline),
    equityCurve: timeline.map((point) => ({
      date: point.date,
      equity: point.equity,
      returnPct: point.returnPct,
    })),
  };
}
