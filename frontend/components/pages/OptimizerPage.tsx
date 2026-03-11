"use client";

import { startTransition, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Database,
  Eye,
  Play,
  RefreshCw,
  Save,
  Search,
  Settings2,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import OptimizerDebugChart from "@/components/optimizer/OptimizerDebugChart";
import type {
  MonteCarloSummary,
  OptimizerAssetId,
  OptimizerClusterSummary,
  OptimizerConfig,
  OptimizerParameterHeatmap,
  OptimizerParameterKey,
  OptimizerPreviewResponse,
  OptimizerProgressSnapshot,
  OptimizerRunResponse,
  OptimizerRunStreamEvent,
  OptimizerRunSummary,
  OptimizerStoredRun,
  OptimizerStrategyResult,
  RangeSpec,
  TradeRecord,
} from "@/lib/optimizer/types";
import { DEFAULT_OPTIMIZER_CONFIG, OPTIMIZER_FX_UNIVERSE } from "@/lib/server/optimizer/config";

type ApiState = { loading: boolean; error: string | null; response: OptimizerRunResponse | null; progress: OptimizerProgressSnapshot | null };
type HistoryState = { loading: boolean; error: string | null; items: OptimizerRunSummary[] };
type PreviewState = { loading: boolean; error: string | null; response: OptimizerPreviewResponse | null };
type RangeKey = keyof OptimizerConfig["broadRanges"];
type SectionKey = "configuration" | "progress" | "results" | "stability" | "analysis" | "history";

const RANGE_ORDER: Array<{ key: RangeKey; label: string; locked?: boolean }> = [
  { key: "zoneLookback", label: "Zone Lookback" },
  { key: "valuationThreshold", label: "Valuation Threshold", locked: true },
  { key: "seasonalityYears", label: "Seasonality Years" },
  { key: "holdDays", label: "Seasonality Hold Days" },
  { key: "atrPeriod", label: "ATR Period" },
  { key: "atrMultiplier", label: "ATR Multiplier" },
  { key: "fixedStopPct", label: "Fixed Stop %" },
  { key: "takeProfitRr", label: "Take Profit RR" },
  { key: "breakEvenRr", label: "Break Even RR" },
];

const TOGGLE_FIELDS: Array<{ key: keyof OptimizerConfig["toggles"]; label: string }> = [
  { key: "allowNormalZones", label: "Enable normal 3-candle zones" },
  { key: "allowStrongZones", label: "Enable strong gap zones" },
  { key: "requireCandleConfirmation", label: "Require bullish / bearish candle close" },
  { key: "requireValuation", label: "Require valuation filter" },
  { key: "requireSeasonality", label: "Require seasonality filter" },
  { key: "allowLong", label: "Allow long setups" },
  { key: "allowShort", label: "Allow short setups" },
];

const DEFAULT_SECTIONS: Record<SectionKey, boolean> = {
  configuration: true,
  progress: true,
  results: true,
  stability: true,
  analysis: true,
  history: true,
};
const PARAMETER_LABELS: Record<OptimizerParameterKey, string> = {
  zoneLookback: "Zone Lookback",
  valuationPrimaryPeriod: "Primary Valuation Period",
  valuationSecondaryPeriod: "Secondary Valuation Period",
  valuationModeIndex: "Valuation Mode",
  valuationMultiPeriodLogicIndex: "Multi-Period Logic",
  valuationWeightProfileIndex: "Reference Weight Profile",
  valuationThreshold: "Valuation Threshold",
  seasonalityYears: "Seasonality Years",
  holdDays: "Seasonality Hold Days",
  atrPeriod: "ATR Period",
  atrMultiplier: "ATR Multiplier",
  fixedStopPct: "Fixed Stop %",
  takeProfitRr: "Take Profit RR",
  breakEvenRr: "Break Even RR",
};
const VALUATION_MODE_ORDER = ["ANY_SINGLE", "TWO_OF_THREE", "ALL_THREE", "COMBINED", "WEIGHTED_COMBINED"] as const;
const VALUATION_MODE_LABELS = {
  ANY_SINGLE: "Any single",
  TWO_OF_THREE: "Two of three",
  ALL_THREE: "All three",
  COMBINED: "Combined",
  WEIGHTED_COMBINED: "Weighted",
} as const;
const MULTI_PERIOD_LOGIC_ORDER = ["SINGLE", "OR", "AND", "AGREEMENT"] as const;
const MULTI_PERIOD_LOGIC_LABELS = {
  SINGLE: "Single period",
  OR: "OR",
  AND: "AND",
  AGREEMENT: "Agreement",
} as const;
const WEIGHT_PROFILE_ORDER = ["equal", "macro", "fx"] as const;
const WEIGHT_PROFILE_LABELS = {
  equal: "Equal",
  macro: "Macro tilt",
  fx: "FX tilt",
} as const;
const VALUATION_PERIOD_OPTIONS = [10, 15, 20] as const;

function cardStyle() {
  return {
    background: "linear-gradient(180deg, rgba(10,9,7,0.96), rgba(6,6,5,0.94))",
    borderColor: "rgba(201, 170, 87, 0.28)",
    boxShadow: "0 22px 54px rgba(0,0,0,0.35), 0 0 36px rgba(201,170,87,0.08)",
  } as const;
}

const fmtPct = (value: number, digits = 2) => `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`;
const fmt = (value: number, digits = 2) => (Number.isFinite(value) ? value.toFixed(digits) : "0.00");
const fmtDateTime = (value: string) => (value ? new Date(value).toLocaleString("de-DE", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "n/a");
const fmtEta = (seconds: number | null) => (seconds == null || !Number.isFinite(seconds) ? "calculating" : seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`);
const paramLabel = (key: OptimizerParameterKey) => PARAMETER_LABELS[key] ?? key;

function formatParamValue(key: OptimizerParameterKey, value: number): string {
  switch (key) {
    case "valuationPrimaryPeriod":
    case "valuationSecondaryPeriod":
      return value <= 0 ? "None" : `${value}d`;
    case "valuationModeIndex":
      return VALUATION_MODE_LABELS[VALUATION_MODE_ORDER[Math.round(value)] ?? "ANY_SINGLE"];
    case "valuationMultiPeriodLogicIndex":
      return MULTI_PERIOD_LOGIC_LABELS[MULTI_PERIOD_LOGIC_ORDER[Math.round(value)] ?? "SINGLE"];
    case "valuationWeightProfileIndex":
      return WEIGHT_PROFILE_LABELS[WEIGHT_PROFILE_ORDER[Math.round(value)] ?? "equal"];
    case "fixedStopPct":
      return `${fmt(value, 2)}%`;
    default:
      return Number.isInteger(value) ? String(value) : fmt(value, 2);
  }
}

function formatParamRange(key: OptimizerParameterKey, min: number, max: number): string {
  const start = formatParamValue(key, min);
  const end = formatParamValue(key, max);
  return start === end ? start : `${start} -> ${end}`;
}

function shortValuationModeLabel(value: string | null): string {
  if (!value) return "n/a";
  switch (value) {
    case "ANY_SINGLE":
      return "any";
    case "TWO_OF_THREE":
      return "2of3";
    case "ALL_THREE":
      return "all3";
    case "COMBINED":
      return "comb";
    case "WEIGHTED_COMBINED":
      return "wcomb";
    default:
      return value.toLowerCase();
  }
}

function formatStrategyValuation(strategy: OptimizerStrategyResult): string {
  const primary = `v${strategy.valuation.primaryPeriod} ${shortValuationModeLabel(strategy.valuation.primaryMode)}`;
  if (strategy.valuation.multiPeriodLogic === "SINGLE" || !strategy.valuation.secondaryPeriod || !strategy.valuation.secondaryMode) {
    return `${primary} | ${WEIGHT_PROFILE_LABELS[strategy.valuation.weightProfile]}`;
  }
  const secondary = `v${strategy.valuation.secondaryPeriod} ${shortValuationModeLabel(strategy.valuation.secondaryMode)}`;
  return `${primary} + ${secondary} | ${MULTI_PERIOD_LOGIC_LABELS[strategy.valuation.multiPeriodLogic]} | ${WEIGHT_PROFILE_LABELS[strategy.valuation.weightProfile]}`;
}

function toggleSelection<T>(items: T[], value: T): T[] {
  return items.includes(value) ? items.filter((item) => item !== value) : [...items, value];
}

function expandRange(range: RangeSpec): number[] {
  const values: number[] = [];
  const decimals = range.step.toString().includes(".") ? range.step.toString().split(".")[1].length : 0;
  for (let current = range.min; current <= range.max + (range.step / 10); current += range.step) values.push(Number(current.toFixed(decimals)));
  return values;
}

function estimateBroadCandidates(config: OptimizerConfig): number {
  const zoneModes = config.toggles.allowNormalZones && config.toggles.allowStrongZones ? 3 : (config.toggles.allowNormalZones || config.toggles.allowStrongZones ? 1 : 0);
  const periods = [...config.valuationPeriods].sort((left, right) => left - right);
  const modes = Math.max(1, config.valuationModes.length);
  const weightProfiles = Math.max(1, config.valuationWeightProfiles.length);
  const multiPeriodLogics = config.valuationMultiPeriodLogics.filter((logic) => logic !== "SINGLE").length;
  const singleFamilies = periods.length * modes;
  const pairedFamilies = ((periods.length * Math.max(periods.length - 1, 0)) / 2) * modes * modes * Math.max(multiPeriodLogics, 0);
  const valuationFamilies = Math.max(1, (singleFamilies + pairedFamilies) * weightProfiles);
  return RANGE_ORDER.filter((entry) => !entry.locked).reduce((product, entry) => product * Math.max(1, expandRange(config.broadRanges[entry.key]).length), Math.max(zoneModes, 1) * 2 * valuationFamilies);
}

function buildHeatColor(ratio: number): string {
  const stops = [
    { at: 0, rgb: [29, 78, 216] },
    { at: 0.33, rgb: [34, 197, 94] },
    { at: 0.66, rgb: [250, 204, 21] },
    { at: 1, rgb: [239, 68, 68] },
  ];
  const clamped = Math.max(0, Math.min(1, ratio));
  const upperIndex = Math.max(1, stops.findIndex((stop) => clamped <= stop.at));
  const upper = stops[upperIndex];
  const lower = stops[upperIndex - 1];
  const span = Math.max(0.0001, upper.at - lower.at);
  const local = (clamped - lower.at) / span;
  const rgb = lower.rgb.map((value, index) => Math.round(value + ((upper.rgb[index] - value) * local)));
  return `rgb(${rgb.join(",")})`;
}

function drawdownSeries(strategy: OptimizerStrategyResult | null) {
  if (!strategy) return [];
  let peak = 1;
  return strategy.equityCurve.map((point) => {
    peak = Math.max(peak, point.equity);
    return { t: point.t, drawdown: peak > 0 ? ((point.equity - peak) / peak) : 0 };
  });
}

function tradeHistogram(strategy: OptimizerStrategyResult | null) {
  if (!strategy?.trades.length) return [];
  const bins = [
    { min: -1, max: -0.05, label: "< -5%" },
    { min: -0.05, max: -0.02, label: "-5% to -2%" },
    { min: -0.02, max: 0, label: "-2% to 0%" },
    { min: 0, max: 0.02, label: "0% to 2%" },
    { min: 0.02, max: 0.05, label: "2% to 5%" },
    { min: 0.05, max: 1, label: "> 5%" },
  ];
  return bins.map((bin) => ({ label: bin.label, count: strategy.trades.filter((trade) => trade.returnPct >= bin.min && trade.returnPct < bin.max).length }));
}

function monthlyReturns(strategy: OptimizerStrategyResult | null) {
  if (!strategy?.trades.length) return [];
  const bucket = new Map<string, number>();
  for (const trade of strategy.trades) {
    const key = trade.exitDate.slice(0, 7);
    bucket.set(key, (bucket.get(key) ?? 1) * (1 + trade.returnPct));
  }
  return Array.from(bucket.entries()).sort((left, right) => left[0].localeCompare(right[0])).map(([month, value]) => ({ month, returnPct: value - 1 }));
}

function mcDistribution(summary: MonteCarloSummary | null | undefined) {
  return summary?.distributionBuckets ?? [];
}

function mcPaths(summary: MonteCarloSummary | null | undefined) {
  if (!summary?.samplePaths?.length) return [];
  return summary.samplePaths.slice(0, 6).map((path, pathIndex) => path.map((value, step) => ({ step, value, path: `Path ${pathIndex + 1}` }))).flat();
}

function tradeKey(trade: TradeRecord, index: number) {
  return `${trade.assetId}:${trade.entryDate}:${trade.exitDate}:${index}`;
}

function groupWarnings(warnings: string[]): Array<{ label: string; items: string[] }> {
  const deduped = Array.from(new Set(warnings.map((warning) => String(warning || "").trim()).filter(Boolean)));
  const buckets = new Map<string, string[]>();
  const classify = (warning: string): string => {
    const probe = warning.toLowerCase();
    if (probe.includes("reference")) return "Missing references";
    if (probe.includes("warmup") || probe.includes("initial")) return "Warmup / initialization";
    if (probe.includes("candle")) return "Invalid candles";
    if (probe.includes("coverage") || probe.includes("gap") || probe.includes("fallback source")) return "Data coverage";
    return "General";
  };

  for (const warning of deduped) {
    const category = classify(warning);
    const list = buckets.get(category) ?? [];
    list.push(warning);
    buckets.set(category, list);
  }

  const order = ["Data coverage", "Warmup / initialization", "Invalid candles", "Missing references", "General"];
  return order
    .map((label) => ({ label, items: buckets.get(label) ?? [] }))
    .filter((group) => group.items.length);
}

function RangeEditor({ label, value, onChange, disabled = false }: { label: string; value: RangeSpec; onChange: (next: RangeSpec) => void; disabled?: boolean }) {
  return (
    <div className={`rounded-[18px] border p-3 ${disabled ? "border-amber-300/20 bg-amber-300/5" : "border-white/10 bg-black/20"}`}>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300">{label}</div>
      <div className="grid grid-cols-3 gap-2">
        {(["min", "max", "step"] as const).map((field) => (
          <label key={field} className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{field}</span>
            <input type="number" step="0.1" value={value[field]} disabled={disabled} onChange={(event) => onChange({ ...value, [field]: Number(event.target.value) })} className="rounded-[12px] border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 outline-none disabled:cursor-not-allowed disabled:opacity-70" />
          </label>
        ))}
      </div>
      {disabled ? <div className="mt-2 text-[11px] text-amber-200">Locked for research validity.</div> : null}
    </div>
  );
}

function SectionCard({ title, subtitle, open, onToggle, children }: { title: string; subtitle: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <section className="rounded-[28px] border p-5" style={cardStyle()}>
      <button type="button" onClick={onToggle} className="flex w-full items-start justify-between gap-4 text-left">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">{title}</div>
          <div className="mt-2 text-sm text-slate-300">{subtitle}</div>
        </div>
        <div className="rounded-[14px] border border-white/10 bg-white/5 p-2 text-slate-200">{open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</div>
      </button>
      {open ? <div className="mt-5">{children}</div> : null}
    </section>
  );
}

function StepRail({ preview, response, selected }: { preview: OptimizerPreviewResponse | null; response: OptimizerRunResponse | null; selected: OptimizerStrategyResult | null }) {
  const steps = [
    ["Step 1", "Verify market data", Boolean(preview?.previewAsset)],
    ["Step 2", "Configure parameters", true],
    ["Step 3", "Run optimizer", Boolean(response)],
    ["Step 4", "Analyze strategies", Boolean(selected)],
    ["Step 5", "Validate visually", Boolean(selected?.debugAssets.length)],
    ["Step 6", "Save run", Boolean(response?.runId)],
  ] as const;
  return (
    <div className="grid gap-3 min-[960px]:grid-cols-6">
      {steps.map(([title, label, complete]) => (
        <div key={title} className={`rounded-[20px] border px-4 py-4 ${complete ? "border-emerald-400/25 bg-emerald-400/8" : "border-white/10 bg-black/20"}`}>
          <div className="text-[10px] uppercase tracking-[0.18em] text-slate-400">{title}</div>
          <div className="mt-2 flex items-center gap-2 text-sm font-semibold text-white">{complete ? <CheckCircle2 size={15} className="text-emerald-300" /> : <Search size={15} className="text-slate-500" />}{label}</div>
        </div>
      ))}
    </div>
  );
}

function StrategyTable({ label, results, selectedId, onSelect }: { label: string; results: OptimizerStrategyResult[]; selectedId: string | null; onSelect: (id: string) => void }) {
  return (
    <div className="overflow-hidden rounded-[22px] border border-white/10">
      <div className="border-b border-white/10 bg-black/30 px-4 py-3 text-sm font-semibold text-white">{label}</div>
      <div className="grid grid-cols-[72px_92px_90px_110px_110px_110px_90px_120px_minmax(220px,1fr)] gap-3 border-b border-white/10 bg-black/20 px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
        <div>Rank</div><div>Score</div><div>Sharpe</div><div>CAGR</div><div>Max DD</div><div>Profit F.</div><div>Trades</div><div>Trades/Yr</div><div>Parameters</div>
      </div>
      <div className="max-h-[360px] overflow-y-auto">
        {results.map((row) => (
          <button key={row.strategyId} type="button" onClick={() => onSelect(row.strategyId)} className={`grid w-full grid-cols-[72px_92px_90px_110px_110px_110px_90px_120px_minmax(220px,1fr)] gap-3 border-b border-white/5 px-4 py-3 text-left transition hover:bg-white/5 ${selectedId === row.strategyId ? "bg-white/5" : ""}`}>
            <div className="text-sm font-semibold text-white">#{row.rank}</div>
            <div className="text-sm text-amber-200">{fmt(row.metrics.score)}</div>
            <div className="text-sm text-white">{fmt(row.metrics.sharpe)}</div>
            <div className="text-sm text-emerald-300">{fmtPct(row.metrics.cagr)}</div>
            <div className="text-sm text-rose-300">{fmtPct(-Math.abs(row.metrics.maxDrawdown))}</div>
            <div className="text-sm text-white">{fmt(row.metrics.profitFactor)}</div>
            <div className="text-sm text-white">{row.metrics.trades}</div>
            <div className="text-sm text-white">{fmt(row.validation.tradesPerYear, 1)}</div>
            <div className="text-xs text-slate-300">{row.params.zoneMode} | stop {row.params.stopMode} | lookback {row.params.zoneLookback} | hold {row.params.holdDays} | {formatStrategyValuation(row)}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function InvalidTable({ results, onSelect }: { results: OptimizerStrategyResult[]; onSelect: (id: string) => void }) {
  if (!results.length) return null;
  return (
    <div className="overflow-hidden rounded-[22px] border border-rose-400/20">
      <div className="border-b border-rose-400/20 bg-rose-400/8 px-4 py-3 text-sm font-semibold text-rose-100">Discarded Strategies</div>
      <div className="grid grid-cols-[90px_90px_120px_140px_1fr] gap-3 border-b border-white/10 bg-black/20 px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
        <div>Stage</div><div>Sharpe</div><div>Total Trades</div><div>Trades/Year</div><div>Reason</div>
      </div>
      <div className="max-h-[260px] overflow-y-auto">
        {results.map((row) => (
          <button key={row.strategyId} type="button" onClick={() => onSelect(row.strategyId)} className="grid w-full grid-cols-[90px_90px_120px_140px_1fr] gap-3 border-b border-white/5 px-4 py-3 text-left text-sm text-slate-200 transition hover:bg-white/5">
            <div>S{row.stage}</div><div>{fmt(row.metrics.sharpe)}</div><div>{row.validation.totalTrades}</div><div>{fmt(row.validation.tradesPerYear, 1)}</div><div className="text-rose-300">{row.validation.reason ?? "Invalid Strategy (Insufficient Trade Count)"}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function HeatmapPanel({ heatmap, clusters, onSelectCluster }: { heatmap: OptimizerParameterHeatmap | null; clusters: OptimizerClusterSummary[]; onSelectCluster: (id: string | null) => void }) {
  if (!heatmap) return <div className="grid min-h-[320px] place-items-center rounded-[22px] border border-dashed border-white/10 bg-black/20 text-slate-500">No heatmap selected.</div>;
  const scores = heatmap.cells.map((cell) => cell.smoothedScore);
  const minScore = Math.min(...scores, 0);
  const maxScore = Math.max(...scores, 1);
  const cellMap = new Map(heatmap.cells.map((cell) => [`${cell.x}|${cell.y}`, cell]));
  return (
    <div className="rounded-[22px] border border-white/10 bg-[#04060a] p-4 text-slate-100">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div><div className="text-sm font-semibold">Heatmap: {paramLabel(heatmap.xKey)} vs {paramLabel(heatmap.yKey)}</div><div className="mt-1 text-xs text-slate-400">Deep blue = bad, green = neutral, yellow = good, red = excellent.</div></div>
        <div className="rounded-[14px] border border-white/10 px-3 py-2 text-xs text-slate-400">Stage {heatmap.stage}</div>
      </div>
      <div className="mb-4 h-3 rounded-full bg-[linear-gradient(90deg,#1d4ed8_0%,#22c55e_35%,#facc15_68%,#ef4444_100%)]" />
      <div className="overflow-x-auto">
        <div className="grid min-w-[560px] gap-2" style={{ gridTemplateColumns: `112px repeat(${heatmap.xValues.length}, minmax(60px, 1fr))` }}>
          <div />
          {heatmap.xValues.map((value) => <div key={`x-${value}`} className="text-center text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{formatParamValue(heatmap.xKey, value)}</div>)}
          {heatmap.yValues.map((yValue) => (
            <div key={`row-${yValue}`} className="contents">
              <div className="flex items-center text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{formatParamValue(heatmap.yKey, yValue)}</div>
              {heatmap.xValues.map((xValue) => {
                const cell = cellMap.get(`${xValue}|${yValue}`);
                if (!cell) return <div key={`${xValue}-${yValue}`} className="h-[58px] rounded-[14px] border border-dashed border-white/10 bg-black/30" />;
                const ratio = (cell.smoothedScore - minScore) / Math.max(1e-9, maxScore - minScore);
                const cluster = clusters.find((item) => xValue >= item.xRange.min && xValue <= item.xRange.max && yValue >= item.yRange.min && yValue <= item.yRange.max);
                return <button key={`${xValue}-${yValue}`} type="button" title={`${paramLabel(heatmap.xKey)}: ${formatParamValue(heatmap.xKey, xValue)}\n${paramLabel(heatmap.yKey)}: ${formatParamValue(heatmap.yKey, yValue)}\nSharpe: ${fmt(cell.sharpe)}\nTrades: ${fmt(cell.trades, 0)}\nDrawdown: ${fmtPct(-cell.maxDrawdown)}`} onClick={() => onSelectCluster(cluster?.clusterId ?? null)} className="flex h-[58px] flex-col items-center justify-center rounded-[14px] px-1 text-center transition hover:brightness-110" style={{ background: buildHeatColor(ratio), color: ratio > 0.54 ? "#111827" : "#f8fafc", border: cluster ? "2px solid rgba(255,255,255,0.92)" : "1px solid rgba(255,255,255,0.12)", boxShadow: cluster ? "0 0 0 2px rgba(245,158,11,0.45)" : "none" }}><div className="text-[11px] font-semibold">{fmt(cell.score)}</div><div className="text-[9px] uppercase tracking-[0.12em] opacity-80">{fmt(cell.trades, 0)} tr</div></button>;
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function HistoryTable({ items, compareIds, onToggleCompare, onLoad, onDelete }: { items: OptimizerRunSummary[]; compareIds: string[]; onToggleCompare: (id: string) => void; onLoad: (id: string) => void; onDelete: (id: string) => void }) {
  return (
    <div className="overflow-hidden rounded-[22px] border border-white/10">
      <div className="grid grid-cols-[64px_180px_120px_120px_120px_120px_120px_200px] gap-3 border-b border-white/10 bg-black/30 px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
        <div>Cmp</div><div>Run ID</div><div>Date</div><div>Mode</div><div>Assets</div><div>Best Sharpe</div><div>Best CAGR</div><div>Actions</div>
      </div>
      <div className="max-h-[360px] overflow-y-auto">
        {items.map((item) => (
          <div key={item.runId} className="grid grid-cols-[64px_180px_120px_120px_120px_120px_120px_200px] gap-3 border-b border-white/5 px-4 py-3 text-sm text-slate-200">
            <label className="flex items-center gap-2"><input type="checkbox" checked={compareIds.includes(item.runId)} onChange={() => onToggleCompare(item.runId)} /><span className="text-xs text-slate-400">Compare</span></label>
            <div className="truncate font-mono text-xs">{item.runId}</div>
            <div className="text-xs">{fmtDateTime(item.updatedAt)}</div>
            <div className="text-xs uppercase text-slate-400">{item.mode}</div>
            <div className="text-xs">{item.assets.length}</div>
            <div>{fmt(item.bestSharpe)}</div>
            <div>{fmtPct(item.bestCagr)}</div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => onLoad(item.runId)} className="rounded-[12px] border border-amber-300/30 bg-amber-300/10 px-3 py-1 text-xs font-semibold text-amber-100">Load</button>
              <button type="button" onClick={() => onDelete(item.runId)} className="rounded-[12px] border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-slate-200">Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function OptimizerPage() {
  const [config, setConfig] = useState<OptimizerConfig>(DEFAULT_OPTIMIZER_CONFIG);
  const [apiState, setApiState] = useState<ApiState>({ loading: false, error: null, response: null, progress: null });
  const [historyState, setHistoryState] = useState<HistoryState>({ loading: true, error: null, items: [] });
  const [previewState, setPreviewState] = useState<PreviewState>({ loading: true, error: null, response: null });
  const [selectedStrategyId, setSelectedStrategyId] = useState<string | null>(null);
  const [selectedHeatmapId, setSelectedHeatmapId] = useState<string | null>(null);
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null);
  const [sections, setSections] = useState<Record<SectionKey, boolean>>(DEFAULT_SECTIONS);
  const [compareRunIds, setCompareRunIds] = useState<string[]>([]);
  const [previewAssetId, setPreviewAssetId] = useState<OptimizerAssetId>(DEFAULT_OPTIMIZER_CONFIG.assets[0]);
  const [analysisAssetId, setAnalysisAssetId] = useState<OptimizerAssetId | null>(null);
  const [selectedTradeId, setSelectedTradeId] = useState<string | null>(null);
  const [integrityConfirmed, setIntegrityConfirmed] = useState(false);

  const candidateEstimate = useMemo(() => estimateBroadCandidates(config), [config]);
  const strategyIndex = useMemo(() => {
    const map = new Map<string, OptimizerStrategyResult>();
    for (const stage of apiState.response?.stageSummaries ?? []) for (const strategy of stage.topStrategies) map.set(strategy.strategyId, strategy);
    for (const strategy of apiState.response?.topStrategies ?? []) map.set(strategy.strategyId, strategy);
    for (const strategy of apiState.response?.invalidStrategies ?? []) map.set(strategy.strategyId, strategy);
    for (const cluster of apiState.response?.stability.clusters ?? []) {
      map.set(cluster.representativeStrategy.strategyId, cluster.representativeStrategy);
      for (const strategy of cluster.clusterStrategies) map.set(strategy.strategyId, strategy);
    }
    return map;
  }, [apiState.response]);
  const selectedStrategy = useMemo(() => selectedStrategyId ? strategyIndex.get(selectedStrategyId) ?? null : apiState.response?.topStrategies[0] ?? apiState.response?.invalidStrategies[0] ?? null, [apiState.response, selectedStrategyId, strategyIndex]);
  const selectedHeatmap = useMemo(() => apiState.response?.stability.heatmaps.find((heatmap) => heatmap.id === selectedHeatmapId) ?? apiState.response?.stability.heatmaps[0] ?? null, [apiState.response, selectedHeatmapId]);
  const selectedCluster = useMemo(() => apiState.response?.stability.clusters.find((cluster) => cluster.clusterId === selectedClusterId) ?? apiState.response?.stability.clusters[0] ?? null, [apiState.response, selectedClusterId]);
  const compareRuns = useMemo(() => historyState.items.filter((item) => compareRunIds.includes(item.runId)).slice(0, 2), [compareRunIds, historyState.items]);
  const analysisAsset = useMemo(() => selectedStrategy?.debugAssets.find((asset) => asset.assetId === analysisAssetId) ?? selectedStrategy?.debugAssets[0] ?? null, [analysisAssetId, selectedStrategy]);
  const ddSeries = useMemo(() => drawdownSeries(selectedStrategy), [selectedStrategy]);
  const tradeDist = useMemo(() => tradeHistogram(selectedStrategy), [selectedStrategy]);
  const monthDist = useMemo(() => monthlyReturns(selectedStrategy), [selectedStrategy]);
  const mcDist = useMemo(() => mcDistribution(selectedStrategy?.monteCarlo), [selectedStrategy]);
  const mcPathData = useMemo(() => mcPaths(selectedStrategy?.monteCarlo), [selectedStrategy]);
  const groupedWarnings = useMemo(
    () => groupWarnings([...(previewState.response?.warnings ?? []), ...(apiState.response?.warnings ?? [])]),
    [apiState.response?.warnings, previewState.response?.warnings],
  );

  async function loadHistory() {
    setHistoryState((current) => ({ ...current, loading: true, error: null }));
    try {
      const response = await fetch("/api/optimizer/history", { cache: "no-store" });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const payload = await response.json() as { items: OptimizerRunSummary[] };
      setHistoryState({ loading: false, error: null, items: payload.items ?? [] });
    } catch (error) {
      setHistoryState({ loading: false, error: error instanceof Error ? error.message : "Failed to load history", items: [] });
    }
  }

  async function loadPreview() {
    if (!config.assets.length) return;
    setPreviewState((current) => ({ ...current, loading: true, error: null }));
    try {
      const response = await fetch("/api/optimizer/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ config, selectedAssetId: previewAssetId }) });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const payload = await response.json() as OptimizerPreviewResponse;
      setPreviewState({ loading: false, error: null, response: payload });
      setIntegrityConfirmed(!payload.requiresConfirmation);
    } catch (error) {
      setPreviewState({ loading: false, error: error instanceof Error ? error.message : "Failed to load preview", response: null });
    }
  }

  useEffect(() => { void loadHistory(); }, []);
  useEffect(() => {
    if (!config.assets.length) return;
    if (!config.assets.includes(previewAssetId)) {
      setPreviewAssetId(config.assets[0]);
      return;
    }
    void (async () => {
      setPreviewState((current) => ({ ...current, loading: true, error: null }));
      try {
        const response = await fetch("/api/optimizer/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ config, selectedAssetId: previewAssetId }) });
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        const payload = await response.json() as OptimizerPreviewResponse;
        setPreviewState({ loading: false, error: null, response: payload });
        setIntegrityConfirmed(!payload.requiresConfirmation);
      } catch (error) {
        setPreviewState({ loading: false, error: error instanceof Error ? error.message : "Failed to load preview", response: null });
      }
    })();
  }, [config, previewAssetId]);
  useEffect(() => {
    if (!selectedStrategy?.debugAssets.length) return;
    setAnalysisAssetId((current) => current && selectedStrategy.debugAssets.some((item) => item.assetId === current) ? current : selectedStrategy.debugAssets[0].assetId);
    setSelectedTradeId(null);
  }, [selectedStrategy]);

  async function runOptimizer() {
    if (!previewState.response) await loadPreview();
    if (previewState.response?.requiresConfirmation && !integrityConfirmed) {
      setApiState((current) => ({ ...current, error: "Invalid candle construction detected. Confirm the warning before running the optimizer." }));
      return;
    }
    setApiState((current) => ({ ...current, loading: true, error: null, progress: null }));
    try {
      const response = await fetch("/api/optimizer/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ config, allowInvalidCandleData: integrityConfirmed }) });
      if (!response.ok || !response.body) throw new Error(`${response.status} ${response.statusText}`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalResult: OptimizerRunResponse | null = null;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let lineBreak = buffer.indexOf("\n");
        while (lineBreak >= 0) {
          const line = buffer.slice(0, lineBreak).trim();
          buffer = buffer.slice(lineBreak + 1);
          if (line) {
            const event = JSON.parse(line) as OptimizerRunStreamEvent;
            if (event.type === "progress") setApiState((current) => ({ ...current, loading: true, progress: event.payload }));
            if (event.type === "result") {
              finalResult = event.payload;
              startTransition(() => {
                setApiState({ loading: false, error: null, response: event.payload, progress: null });
                setPreviewState((current) => ({ ...current, response: event.payload.preview ?? current.response }));
                setSelectedStrategyId(event.payload.topStrategies[0]?.strategyId ?? event.payload.invalidStrategies[0]?.strategyId ?? null);
                setSelectedHeatmapId(event.payload.stability.heatmaps[0]?.id ?? null);
                setSelectedClusterId(event.payload.stability.clusters[0]?.clusterId ?? null);
              });
            }
            if (event.type === "error") throw new Error(event.payload.message);
          }
          lineBreak = buffer.indexOf("\n");
        }
      }
      if (!finalResult) throw new Error("Optimizer finished without a result payload.");
      await loadHistory();
    } catch (error) {
      setApiState((current) => ({ ...current, loading: false, error: error instanceof Error ? error.message : "Optimizer run failed" }));
    }
  }

  async function saveCurrentRun() {
    const runId = apiState.response?.runId;
    if (!runId) return;
    await fetch("/api/optimizer/history", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId }) });
    await loadHistory();
  }

  async function loadRun(runId: string) {
    const response = await fetch(`/api/optimizer/history/${encodeURIComponent(runId)}`, { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json() as OptimizerStoredRun;
    if (!payload.result) return;
    setConfig(payload.config);
    setPreviewState({ loading: false, error: null, response: payload.result.preview });
    setApiState({ loading: false, error: payload.error, response: payload.result, progress: null });
    setSelectedStrategyId(payload.result.topStrategies[0]?.strategyId ?? payload.result.invalidStrategies[0]?.strategyId ?? null);
    setSelectedHeatmapId(payload.result.stability.heatmaps[0]?.id ?? null);
    setSelectedClusterId(payload.result.stability.clusters[0]?.clusterId ?? null);
  }

  async function deleteRun(runId: string) {
    await fetch(`/api/optimizer/history/${encodeURIComponent(runId)}`, { method: "DELETE" });
    await loadHistory();
  }

  const toggleCompare = (runId: string) => setCompareRunIds((current) => current.includes(runId) ? current.filter((item) => item !== runId) : [...current, runId].slice(-2));
  const toggleSection = (section: SectionKey) => setSections((current) => ({ ...current, [section]: !current[section] }));

  const preview = previewState.response;
  const previewAsset = preview?.previewAsset ?? null;
  const previewCoverage = preview?.coverage ?? [];
  const previewIntegrity = preview?.integrity ?? [];
  const needsIntegrityConfirmation = preview?.requiresConfirmation ?? false;

  return (
    <main className="ivq-terminal-page relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0" aria-hidden="true"><div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(180,148,72,0.16),transparent_32%),radial-gradient(circle_at_top_right,rgba(42,78,170,0.12),transparent_28%),linear-gradient(180deg,rgba(4,6,12,0.98),rgba(2,4,9,1))]" /></div>
      <div className="relative mx-auto flex max-w-[1760px] flex-col gap-5 text-slate-100">
        <section className="rounded-[28px] border p-6" style={cardStyle()}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Quant Research Environment</div>
              <h1 className="mt-3 text-3xl font-semibold text-white">Optimizer Validation Lab</h1>
              <p className="mt-3 max-w-[980px] text-sm leading-7 text-slate-300">Research-grade FX optimization with hard trade-count validation, strict candle-based signal logic, pre-run market-data inspection, visual strategy debugging and persistent run history.</p>
            </div>
            <div className="grid gap-3 min-[920px]:grid-cols-3">
              <div className="rounded-[20px] border border-white/10 bg-black/20 px-4 py-3"><div className="text-[10px] uppercase tracking-[0.16em] text-slate-400">Stage 1 Grid</div><div className="mt-2 text-2xl font-semibold text-white">{candidateEstimate.toLocaleString()}</div><div className="mt-1 text-xs text-slate-500">raw combinations before trimming</div></div>
              <div className="rounded-[20px] border border-white/10 bg-black/20 px-4 py-3"><div className="text-[10px] uppercase tracking-[0.16em] text-slate-400">Validation Gate</div><div className="mt-2 text-sm font-semibold text-white">{needsIntegrityConfirmation ? "Confirmation required" : "Ready to run"}</div><div className="mt-1 text-xs text-slate-500">candle integrity + trade minimums</div></div>
              <div className="rounded-[20px] border border-white/10 bg-black/20 px-4 py-3"><div className="text-[10px] uppercase tracking-[0.16em] text-slate-400">Run Storage</div><div className="mt-2 text-2xl font-semibold text-white">{historyState.items.length}</div><div className="mt-1 text-xs text-slate-500">temporary + saved runs</div></div>
            </div>
          </div>
          <div className="mt-5"><StepRail preview={preview} response={apiState.response} selected={selectedStrategy} /></div>
        </section>
        <SectionCard title="Optimizer Configuration" subtitle="Verify market data first, then configure the search space and only run after the integrity gate is understood." open={sections.configuration} onToggle={() => toggleSection("configuration")}>
          <div className="grid gap-5">
            <div className="grid gap-5 min-[1320px]:grid-cols-[1.08fr_0.92fr]">
              <div className="grid gap-5">
                <div>
                  <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400"><Database size={14} />Data Settings</div>
                  <div className="grid gap-3 min-[900px]:grid-cols-[minmax(0,1fr)_220px_220px]">
                    <div className="rounded-[20px] border border-white/10 bg-black/20 p-4">
                      <div className="mb-3 text-sm font-semibold text-white">Asset Selection</div>
                      <div className="grid gap-2 min-[620px]:grid-cols-2">
                        {OPTIMIZER_FX_UNIVERSE.map((asset) => {
                          const checked = config.assets.includes(asset.assetId);
                          return <label key={asset.assetId} className="flex items-center gap-3 rounded-[14px] border border-white/10 px-3 py-2 text-sm text-slate-200"><input type="checkbox" checked={checked} onChange={(event) => {
                            const nextAssets = event.target.checked ? [...config.assets, asset.assetId] : config.assets.filter((item) => item !== asset.assetId);
                            setConfig((current) => ({ ...current, assets: nextAssets as OptimizerAssetId[] }));
                            if (!event.target.checked && previewAssetId === asset.assetId && nextAssets.length) setPreviewAssetId(nextAssets[0] as OptimizerAssetId);
                          }} /><span>{asset.label}</span></label>;
                        })}
                      </div>
                    </div>
                    <label className="rounded-[20px] border border-white/10 bg-black/20 p-4">
                      <div className="mb-2 text-sm font-semibold text-white">Source</div>
                      <select value={config.source} onChange={(event) => setConfig((current) => ({ ...current, source: event.target.value as OptimizerConfig["source"] }))} className="w-full rounded-[14px] border border-white/10 bg-slate-950/80 px-3 py-3 text-sm text-slate-100 outline-none"><option value="dukascopy">Dukascopy</option></select>
                      <div className="mt-2 text-xs text-slate-500">Daily candles are aggregated from true H1 OHLC bars.</div>
                    </label>
                    <div className="rounded-[20px] border border-white/10 bg-black/20 p-4">
                      <div className="mb-2 text-sm font-semibold text-white">Windows</div>
                      <div className="grid gap-2 text-sm text-slate-300"><div>Train: 2012-01-01 to 2019-12-31</div><div>Out of sample: 2020-01-01 to 2025-12-31</div><div>Valuation gate: fixed +/-75 extremes across DXY, Gold and US 10Y</div></div>
                    </div>
                  </div>
                </div>
                <div>
                  <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400"><ShieldCheck size={14} />Valuation Framework</div>
                  <div className="grid gap-3 min-[980px]:grid-cols-2">
                    <div className="rounded-[20px] border border-white/10 bg-black/20 p-4">
                      <div className="mb-3 text-sm font-semibold text-white">Periods</div>
                      <div className="grid gap-2 min-[560px]:grid-cols-3">
                        {VALUATION_PERIOD_OPTIONS.map((period) => {
                          const active = config.valuationPeriods.includes(period);
                          return (
                            <button
                              key={period}
                              type="button"
                              onClick={() => setConfig((current) => {
                                const next = toggleSelection(current.valuationPeriods, period).sort((left, right) => left - right);
                                return next.length ? { ...current, valuationPeriods: next } : current;
                              })}
                              className={`rounded-[14px] border px-3 py-3 text-sm font-semibold transition ${active ? "border-amber-300/40 bg-amber-300/10 text-amber-100" : "border-white/10 bg-white/5 text-slate-300"}`}
                            >
                              {period}d
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="rounded-[20px] border border-white/10 bg-black/20 p-4">
                      <div className="mb-3 text-sm font-semibold text-white">Reference Weighting</div>
                      <div className="grid gap-2 min-[560px]:grid-cols-3">
                        {WEIGHT_PROFILE_ORDER.map((profile) => {
                          const active = config.valuationWeightProfiles.includes(profile);
                          return (
                            <button
                              key={profile}
                              type="button"
                              onClick={() => setConfig((current) => {
                                const next = toggleSelection(current.valuationWeightProfiles, profile);
                                return next.length ? { ...current, valuationWeightProfiles: next } : current;
                              })}
                              className={`rounded-[14px] border px-3 py-3 text-sm font-semibold transition ${active ? "border-amber-300/40 bg-amber-300/10 text-amber-100" : "border-white/10 bg-white/5 text-slate-300"}`}
                            >
                              {WEIGHT_PROFILE_LABELS[profile]}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="rounded-[20px] border border-white/10 bg-black/20 p-4">
                      <div className="mb-3 text-sm font-semibold text-white">Signal Modes</div>
                      <div className="grid gap-2 min-[560px]:grid-cols-2">
                        {VALUATION_MODE_ORDER.map((mode) => {
                          const active = config.valuationModes.includes(mode);
                          return (
                            <button
                              key={mode}
                              type="button"
                              onClick={() => setConfig((current) => {
                                const next = toggleSelection(current.valuationModes, mode);
                                return next.length ? { ...current, valuationModes: next } : current;
                              })}
                              className={`rounded-[14px] border px-3 py-3 text-sm font-semibold transition ${active ? "border-amber-300/40 bg-amber-300/10 text-amber-100" : "border-white/10 bg-white/5 text-slate-300"}`}
                            >
                              {VALUATION_MODE_LABELS[mode]}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="rounded-[20px] border border-white/10 bg-black/20 p-4">
                      <div className="mb-3 text-sm font-semibold text-white">Cross-Period Logic</div>
                      <div className="grid gap-2 min-[560px]:grid-cols-2">
                        {MULTI_PERIOD_LOGIC_ORDER.map((logic) => {
                          const active = config.valuationMultiPeriodLogics.includes(logic);
                          return (
                            <button
                              key={logic}
                              type="button"
                              onClick={() => setConfig((current) => {
                                const next = toggleSelection(current.valuationMultiPeriodLogics, logic);
                                return next.length ? { ...current, valuationMultiPeriodLogics: next } : current;
                              })}
                              className={`rounded-[14px] border px-3 py-3 text-sm font-semibold transition ${active ? "border-amber-300/40 bg-amber-300/10 text-amber-100" : "border-white/10 bg-white/5 text-slate-300"}`}
                            >
                              {MULTI_PERIOD_LOGIC_LABELS[logic]}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
                <div>
                  <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400"><Settings2 size={14} />Strategy Inputs</div>
                  <div className="grid gap-3 min-[840px]:grid-cols-2">
                    {TOGGLE_FIELDS.map((toggle) => <label key={toggle.key} className="flex items-center gap-3 rounded-[16px] border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-200"><input type="checkbox" checked={config.toggles[toggle.key]} onChange={(event) => setConfig((current) => ({ ...current, toggles: { ...current.toggles, [toggle.key]: event.target.checked } }))} /><span>{toggle.label}</span></label>)}
                  </div>
                </div>
              </div>
              <div>
                <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400"><ShieldCheck size={14} />Optimization Ranges</div>
                <div className="grid gap-3 min-[840px]:grid-cols-2">
                  {RANGE_ORDER.map((entry) => <RangeEditor key={entry.key} label={entry.label} value={config.broadRanges[entry.key]} disabled={entry.locked} onChange={(next) => setConfig((current) => ({ ...current, broadRanges: { ...current.broadRanges, [entry.key]: next } }))} />)}
                </div>
              </div>
            </div>

            <div className="rounded-[24px] border border-white/10 bg-black/20 p-4">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-white"><Eye size={16} />Market Data Preview</div>
                <div className="flex flex-wrap items-center gap-3">
                  <select value={previewAssetId} onChange={(event) => setPreviewAssetId(event.target.value as OptimizerAssetId)} className="rounded-[14px] border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 outline-none">
                    {config.assets.map((assetId) => <option key={assetId} value={assetId}>{OPTIMIZER_FX_UNIVERSE.find((item) => item.assetId === assetId)?.label ?? assetId}</option>)}
                  </select>
                  <button type="button" onClick={loadPreview} className="inline-flex items-center gap-2 rounded-[14px] border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200">{previewState.loading ? <RefreshCw size={15} className="animate-spin" /> : <RefreshCw size={15} />}Refresh Preview</button>
                </div>
              </div>
              {previewState.error ? <div className="mb-4 inline-flex items-center gap-2 rounded-[14px] border border-rose-400/30 bg-rose-400/10 px-4 py-2 text-sm text-rose-200"><AlertTriangle size={15} />{previewState.error}</div> : null}
              {needsIntegrityConfirmation ? <div className="mb-4 rounded-[18px] border border-amber-400/30 bg-amber-400/8 p-4"><div className="flex items-center gap-2 text-sm font-semibold text-amber-100"><ShieldAlert size={16} />Invalid candle construction detected.</div><div className="mt-2 text-sm text-amber-100/90">Review the preview and integrity table. The optimizer stays blocked until you explicitly confirm this warning.</div><label className="mt-3 flex items-center gap-3 text-sm text-amber-50"><input type="checkbox" checked={integrityConfirmed} onChange={(event) => setIntegrityConfirmed(event.target.checked)} />I reviewed the candle integrity warning and want to proceed anyway.</label></div> : null}
              <OptimizerDebugChart asset={previewAsset} />
              <div className="mt-5 grid gap-4 min-[1260px]:grid-cols-[0.88fr_1.12fr]">
                <div className="rounded-[20px] border border-white/10 bg-black/30 p-4">
                  <div className="mb-3 text-sm font-semibold text-white">Candle Integrity</div>
                  <div className="grid gap-2">
                    {previewIntegrity.map((item) => <div key={item.assetId} className="rounded-[14px] border border-white/5 px-3 py-3 text-sm text-slate-200"><div className="flex items-center justify-between gap-3"><div className="font-semibold">{item.symbol}</div><div className={item.isValid ? "text-emerald-300" : "text-amber-200"}>{item.isValid ? "valid" : "warning"}</div></div><div className="mt-2 grid gap-1 text-xs text-slate-400"><div>Open = Close ratio: {(item.openEqualsCloseRatio * 100).toFixed(2)}%</div><div>Flat range ratio: {(item.flatRangeRatio * 100).toFixed(2)}%</div><div>High/Low violations: {item.invalidHighLowCount}</div>{item.warnings.length ? <div className="text-amber-200">{item.warnings.join("; ")}</div> : <div className="text-emerald-300">No structural issues detected.</div>}</div></div>)}
                  </div>
                </div>
                <div className="rounded-[20px] border border-white/10 bg-black/30 p-4">
                  <div className="mb-3 text-sm font-semibold text-white">Coverage Snapshot</div>
                  <div className="grid grid-cols-[90px_90px_110px_90px_110px_1fr] gap-3 border-b border-white/10 pb-3 text-[10px] uppercase tracking-[0.18em] text-slate-500"><div>Asset</div><div>H1 Bars</div><div>D1 Coverage</div><div>Missing</div><div>Largest Gap</div><div>Issues</div></div>
                  <div className="mt-2 grid gap-2">
                    {previewCoverage.map((row) => <div key={row.assetId} className="grid grid-cols-[90px_90px_110px_90px_110px_1fr] gap-3 rounded-[14px] border border-white/5 px-3 py-2 text-sm text-slate-200"><div>{row.symbol}</div><div>{row.barsH1.toLocaleString()}</div><div>{(row.coverageRatioD1 * 100).toFixed(1)}%</div><div>{row.missingDaysD1}</div><div>{row.largestGapDays}d</div><div className={row.issues.length ? "text-amber-200" : "text-emerald-300"}>{row.issues.join("; ") || "ok"}</div></div>)}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={runOptimizer} disabled={apiState.loading || config.assets.length === 0 || (needsIntegrityConfirmation && !integrityConfirmed)} className="inline-flex items-center gap-2 rounded-[16px] border border-amber-300/40 bg-amber-200/10 px-5 py-3 text-sm font-semibold text-amber-100 transition hover:bg-amber-200/15 disabled:cursor-not-allowed disabled:opacity-50">{apiState.loading ? <RefreshCw size={16} className="animate-spin" /> : <Play size={16} />}Run Optimizer</button>
              <button type="button" onClick={() => { setConfig(DEFAULT_OPTIMIZER_CONFIG); setPreviewAssetId(DEFAULT_OPTIMIZER_CONFIG.assets[0]); }} className="inline-flex items-center gap-2 rounded-[16px] border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-slate-200 transition hover:bg-white/10"><RefreshCw size={16} />Reset Defaults</button>
              <div className="text-sm text-slate-400">Raw grid estimate: <span className="font-semibold text-white">{candidateEstimate.toLocaleString()}</span>. Only strategies with at least 20 trades per asset, 8 trades per year and total trades = assets x 20 survive ranking.</div>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Optimization Progress" subtitle="Live progress, runtime warnings, integrity state and coverage diagnostics." open={sections.progress} onToggle={() => toggleSection("progress")}>
          <div className="grid gap-5 min-[1200px]:grid-cols-[0.92fr_1.08fr]">
            <div className="rounded-[22px] border border-white/10 bg-black/20 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white"><BarChart3 size={16} />Optimization Progress</div>
              <div className="rounded-full bg-white/10 p-1"><div className="h-3 rounded-full bg-[linear-gradient(90deg,#2563eb,#10b981,#facc15,#ef4444)] transition-all" style={{ width: `${apiState.progress?.percent ?? 0}%` }} /></div>
              <div className="mt-4 grid gap-3 min-[620px]:grid-cols-2">
                <div className="rounded-[16px] border border-white/10 px-4 py-3"><div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Current Stage</div><div className="mt-2 text-lg font-semibold text-white">{apiState.progress?.label ?? "Idle"}</div></div>
                <div className="rounded-[16px] border border-white/10 px-4 py-3"><div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Progress</div><div className="mt-2 text-lg font-semibold text-white">{apiState.progress ? `${apiState.progress.completed.toLocaleString()} / ${apiState.progress.total.toLocaleString()}` : "0 / 0"}</div></div>
                <div className="rounded-[16px] border border-white/10 px-4 py-3"><div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Completion</div><div className="mt-2 text-lg font-semibold text-white">{fmt(apiState.progress?.percent ?? 0, 1)}%</div></div>
                <div className="rounded-[16px] border border-white/10 px-4 py-3"><div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">ETA</div><div className="mt-2 text-lg font-semibold text-white">{fmtEta(apiState.progress?.etaSeconds ?? null)}</div></div>
              </div>
              <div className="mt-4 rounded-[16px] border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-300">{apiState.progress?.message ?? "No run in progress."}</div>
              {apiState.error ? <div className="mt-4 inline-flex items-center gap-2 rounded-[14px] border border-rose-400/30 bg-rose-400/10 px-4 py-2 text-sm text-rose-200"><AlertTriangle size={15} />{apiState.error}</div> : null}
            </div>
            <div className="grid gap-4">
              {groupedWarnings.length ? (
                <div className="rounded-[22px] border border-amber-300/25 bg-amber-300/5 p-4">
                  <div className="mb-3 text-sm font-semibold text-amber-100">Runtime Warnings</div>
                  <div className="grid gap-3">
                    {groupedWarnings.map((group) => (
                      <div key={group.label} className="rounded-[16px] border border-white/10 bg-black/20 px-4 py-3">
                        <div className="text-[10px] uppercase tracking-[0.16em] text-amber-200">{group.label}</div>
                        <div className="mt-2 grid gap-2">
                          {group.items.map((warning) => (
                            <div key={`${group.label}-${warning}`} className="text-sm text-amber-100/90">{warning}</div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded-[22px] border border-white/10 bg-black/20 p-4 text-sm text-slate-400">
                  Warnings appear here when historical coverage is insufficient, candle integrity is questionable or no valid strategy survives the trade minimum rules.
                </div>
              )}
              <div className="rounded-[22px] border border-white/10 bg-black/20 p-4">
                <div className="mb-3 text-sm font-semibold text-white">Coverage Validator</div>
                <div className="grid grid-cols-[100px_100px_120px_100px_110px_120px_1fr] gap-3 border-b border-white/10 pb-3 text-[10px] uppercase tracking-[0.18em] text-slate-500"><div>Asset</div><div>H1 Bars</div><div>D1 Coverage</div><div>Missing</div><div>Largest Gap</div><div>Source</div><div>Issues</div></div>
                <div className="mt-2 grid gap-2">{(apiState.response?.coverage ?? previewCoverage).map((row) => <div key={row.assetId} className="grid grid-cols-[100px_100px_120px_100px_110px_120px_1fr] gap-3 rounded-[14px] border border-white/5 px-3 py-2 text-sm text-slate-200"><div>{row.symbol}</div><div>{row.barsH1.toLocaleString()}</div><div>{(row.coverageRatioD1 * 100).toFixed(1)}%</div><div>{row.missingDaysD1}</div><div>{row.largestGapDays}d</div><div>{row.sourceUsed}</div><div className={row.issues.length ? "text-amber-200" : "text-emerald-300"}>{row.issues.join("; ") || "ok"}</div></div>)}</div>
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Results Section" subtitle="Only valid strategies are ranked. Under-traded strategies are explicitly discarded and listed below." open={sections.results} onToggle={() => toggleSection("results")}>
          {apiState.response ? <div className="grid gap-5">
            <div className="flex flex-wrap items-center gap-3"><button type="button" onClick={saveCurrentRun} className="inline-flex items-center gap-2 rounded-[16px] border border-amber-300/30 bg-amber-300/10 px-4 py-2 text-sm font-semibold text-amber-100"><Save size={15} />Save Optimization Run</button><div className="text-sm text-slate-400">Run ID: <span className="font-mono text-slate-200">{apiState.response.runId}</span></div></div>
            <div className="grid gap-3 min-[1000px]:grid-cols-3">{apiState.response.stageSummaries.map((summary) => <div key={summary.stage} className="rounded-[20px] border border-white/10 bg-black/20 p-4"><div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{summary.label}</div><div className="mt-3 text-3xl font-semibold text-white">{summary.strategyCount}</div><div className="mt-2 text-sm text-slate-400">valid ranked candidates retained</div></div>)}</div>
            {apiState.response.stageSummaries.map((summary) => <StrategyTable key={summary.stage} label={summary.label} results={summary.topStrategies} selectedId={selectedStrategy?.strategyId ?? null} onSelect={setSelectedStrategyId} />)}
            <InvalidTable results={apiState.response.invalidStrategies} onSelect={setSelectedStrategyId} />
          </div> : <div className="grid min-h-[220px] place-items-center rounded-[24px] border border-dashed border-white/10 bg-black/20 p-6 text-center text-slate-400">No optimizer run yet.</div>}
        </SectionCard>

        <SectionCard title="Parameter Stability" subtitle="High-contrast heatmaps with cluster outlines and tooltips for robust regions, not isolated peaks." open={sections.stability} onToggle={() => toggleSection("stability")}>
          {apiState.response ? <div className="grid gap-5">
            <div className="flex flex-wrap gap-2">{apiState.response.stability.availablePairs.map((pair) => <button key={pair.id} type="button" onClick={() => { setSelectedHeatmapId(pair.id); const cluster = apiState.response?.stability.clusters.find((item) => item.heatmapId === pair.id); setSelectedClusterId(cluster?.clusterId ?? null); }} className={`rounded-[12px] border px-3 py-2 text-xs font-semibold transition ${selectedHeatmap?.id === pair.id ? "border-amber-300/40 bg-amber-300/10 text-amber-100" : "border-white/10 bg-white/5 text-slate-300"}`}>S{pair.stage}: {paramLabel(pair.xKey)} x {paramLabel(pair.yKey)}</button>)}</div>
            <div className="grid gap-5 min-[1180px]:grid-cols-[1.05fr_0.95fr]">
              <HeatmapPanel heatmap={selectedHeatmap} clusters={apiState.response.stability.clusters.filter((cluster) => cluster.heatmapId === (selectedHeatmap?.id ?? ""))} onSelectCluster={(clusterId) => { setSelectedClusterId(clusterId); const cluster = apiState.response?.stability.clusters.find((item) => item.clusterId === clusterId); if (cluster) setSelectedStrategyId(cluster.representativeStrategy.strategyId); }} />
              <div className="grid gap-4">
                <div className="overflow-hidden rounded-[22px] border border-white/10">
                  <div className="grid grid-cols-[110px_minmax(240px,1.2fr)_110px_110px_110px_110px_110px] gap-3 border-b border-white/10 bg-black/30 px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400"><div>Cluster</div><div>Ranges</div><div>Sharpe</div><div>CAGR</div><div>Max DD</div><div>Count</div><div>Inspect</div></div>
                  <div className="max-h-[320px] overflow-y-auto">{apiState.response.stability.clusters.filter((cluster) => cluster.heatmapId === (selectedHeatmap?.id ?? cluster.heatmapId)).map((cluster) => <div key={cluster.clusterId} className={`grid grid-cols-[110px_minmax(240px,1.2fr)_110px_110px_110px_110px_110px] gap-3 border-b border-white/5 px-4 py-3 ${selectedCluster?.clusterId === cluster.clusterId ? "bg-white/5" : ""}`}><button type="button" onClick={() => setSelectedClusterId(cluster.clusterId)} className="text-left text-sm font-semibold text-white">{cluster.clusterId}</button><div className="text-xs text-slate-300">{paramLabel(cluster.xKey)} {formatParamRange(cluster.xKey, cluster.xRange.min, cluster.xRange.max)}<br />{paramLabel(cluster.yKey)} {formatParamRange(cluster.yKey, cluster.yRange.min, cluster.yRange.max)}</div><div>{fmt(cluster.medianSharpe)}</div><div className="text-emerald-300">{fmtPct(cluster.medianCagr)}</div><div className="text-rose-300">{fmtPct(-cluster.maxDrawdown)}</div><div>{cluster.strategyCount}</div><button type="button" onClick={() => setSelectedStrategyId(cluster.representativeStrategy.strategyId)} className="rounded-[12px] border border-amber-300/30 bg-amber-300/10 px-3 py-1 text-xs font-semibold text-amber-100">Load</button></div>)}</div>
                </div>
                {selectedCluster ? <div className="rounded-[22px] border border-white/10 bg-black/20 p-4"><div className="text-sm font-semibold text-white">Selected Cluster</div><div className="mt-3 grid gap-3 min-[720px]:grid-cols-2"><div className="rounded-[16px] border border-white/10 px-4 py-3"><div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Parameter Zone</div><div className="mt-2 text-sm text-slate-200">{paramLabel(selectedCluster.xKey)} {formatParamRange(selectedCluster.xKey, selectedCluster.xRange.min, selectedCluster.xRange.max)}<br />{paramLabel(selectedCluster.yKey)} {formatParamRange(selectedCluster.yKey, selectedCluster.yRange.min, selectedCluster.yRange.max)}</div></div><div className="rounded-[16px] border border-white/10 px-4 py-3"><div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Robustness Summary</div><div className="mt-2 text-sm text-slate-200">Median Sharpe {fmt(selectedCluster.medianSharpe)} | Median CAGR {fmtPct(selectedCluster.medianCagr)}<br />Worst Max DD {fmtPct(-selectedCluster.maxDrawdown)} | {selectedCluster.strategyCount} strategies</div></div></div></div> : null}
              </div>
            </div>
          </div> : <div className="rounded-[22px] border border-dashed border-white/10 bg-black/20 p-6 text-sm text-slate-400">Heatmaps and clusters appear after a completed run.</div>}
        </SectionCard>
        <SectionCard title="Strategy Analysis" subtitle="Visual strategy validation with candle chart, trade history and labelled analytics." open={sections.analysis} onToggle={() => toggleSection("analysis")}>
          {selectedStrategy ? <div className="grid gap-5">
            <div className="grid gap-3 min-[1100px]:grid-cols-7">
              {[["Score", fmt(selectedStrategy.metrics.score)], ["Sharpe", fmt(selectedStrategy.metrics.sharpe)], ["Profit Factor", fmt(selectedStrategy.metrics.profitFactor)], ["CAGR", fmtPct(selectedStrategy.metrics.cagr)], ["Max DD", fmtPct(-selectedStrategy.metrics.maxDrawdown)], ["Trades", String(selectedStrategy.metrics.trades)], ["Validation", selectedStrategy.validation.isValid ? "Valid" : "Invalid"]].map(([label, value]) => <div key={label} className={`rounded-[18px] border px-4 py-3 ${label === "Validation" && !selectedStrategy.validation.isValid ? "border-rose-400/30 bg-rose-400/8" : "border-white/10 bg-black/20"}`}><div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{label}</div><div className={`mt-2 text-xl font-semibold ${label === "Validation" && !selectedStrategy.validation.isValid ? "text-rose-200" : "text-white"}`}>{value}</div></div>)}
            </div>
            {!selectedStrategy.validation.isValid ? <div className="rounded-[18px] border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">{selectedStrategy.validation.reason ?? "Invalid Strategy (Insufficient Trade Count)"}</div> : null}
            <div className="grid gap-3 min-[1100px]:grid-cols-4">
              <div className="rounded-[18px] border border-white/10 bg-black/20 px-4 py-3">
                <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Valuation Family</div>
                <div className="mt-2 text-sm font-semibold text-white">{formatStrategyValuation(selectedStrategy)}</div>
              </div>
              <div className="rounded-[18px] border border-white/10 bg-black/20 px-4 py-3">
                <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Signal Density</div>
                <div className="mt-2 text-sm font-semibold text-white">{fmtPct(selectedStrategy.valuation.signalDensity, 1)}</div>
              </div>
              <div className="rounded-[18px] border border-white/10 bg-black/20 px-4 py-3">
                <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Valuation Qualified</div>
                <div className="mt-2 text-sm font-semibold text-white">{selectedStrategy.valuation.qualifyingSignals} / {selectedStrategy.valuation.candidateSignals}</div>
              </div>
              <div className="rounded-[18px] border border-white/10 bg-black/20 px-4 py-3">
                <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Contribution</div>
                <div className={`mt-2 text-sm font-semibold ${selectedStrategy.valuation.contributionReturn >= 0 ? "text-emerald-300" : "text-rose-300"}`}>{fmtPct(selectedStrategy.valuation.contributionReturn)}</div>
              </div>
            </div>
            <div className="rounded-[22px] border border-white/10 bg-black/20 p-4">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-white"><Activity size={16} />Strategy Visualization</div>
                <div className="flex flex-wrap gap-2">{selectedStrategy.debugAssets.map((asset) => <button key={asset.assetId} type="button" onClick={() => setAnalysisAssetId(asset.assetId)} className={`rounded-[12px] border px-3 py-2 text-xs font-semibold ${analysisAsset?.assetId === asset.assetId ? "border-amber-300/40 bg-amber-300/10 text-amber-100" : "border-white/10 bg-white/5 text-slate-300"}`}>{asset.symbol}</button>)}</div>
              </div>
              <OptimizerDebugChart asset={analysisAsset} selectedTradeKey={selectedTradeId} />
            </div>
            <div className="grid gap-5 min-[1320px]:grid-cols-[0.82fr_1.18fr]">
              <div className="rounded-[22px] border border-white/10 bg-black/20 p-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white"><ShieldCheck size={16} />Trade Count Validation</div>
                <div className="grid gap-3">
                  <div className="rounded-[16px] border border-white/10 px-4 py-3 text-sm text-slate-200">Minimum per asset: {selectedStrategy.validation.minimumTradesPerAsset}</div>
                  <div className="rounded-[16px] border border-white/10 px-4 py-3 text-sm text-slate-200">Minimum total trades: {selectedStrategy.validation.minimumTotalTrades}</div>
                  <div className="rounded-[16px] border border-white/10 px-4 py-3 text-sm text-slate-200">Minimum trades/year: {selectedStrategy.validation.minimumTradesPerYear}</div>
                  {selectedStrategy.validation.assetTradeCounts.map((item) => <div key={item.assetId} className="rounded-[16px] border border-white/10 px-4 py-3 text-sm text-slate-200">{OPTIMIZER_FX_UNIVERSE.find((asset) => asset.assetId === item.assetId)?.label ?? item.assetId}: {item.trades} trades</div>)}
                </div>
              </div>
              <div className="rounded-[22px] border border-white/10 bg-black/20 p-4">
                <div className="mb-3 text-sm font-semibold text-white">Trade History</div>
                <div className="grid grid-cols-[90px_110px_110px_90px_100px_90px_110px] gap-3 border-b border-white/10 pb-3 text-[10px] uppercase tracking-[0.18em] text-slate-500"><div>Asset</div><div>Entry</div><div>Exit</div><div>Dir</div><div>Return</div><div>Hold</div><div>Exit Reason</div></div>
                <div className="mt-2 max-h-[340px] overflow-y-auto">
                  {selectedStrategy.trades.map((trade, index) => {
                    const key = tradeKey(trade, index);
                    const active = selectedTradeId === key;
                    return <button key={key} type="button" onClick={() => { setSelectedTradeId(key); setAnalysisAssetId(trade.assetId); }} className={`grid w-full grid-cols-[90px_110px_110px_90px_100px_90px_110px] gap-3 border-b border-white/5 py-2 text-left text-sm text-slate-200 ${active ? "bg-white/5" : ""}`}><div>{trade.assetId.replace("cross_", "").toUpperCase()}</div><div>{trade.entryDate.slice(0, 10)}</div><div>{trade.exitDate.slice(0, 10)}</div><div className={trade.direction === "long" ? "text-emerald-300" : "text-rose-300"}>{trade.direction}</div><div className={trade.returnPct >= 0 ? "text-emerald-300" : "text-rose-300"}>{fmtPct(trade.returnPct)}</div><div>{trade.holdDays}d</div><div>{trade.exitReason}</div></button>;
                  })}
                </div>
              </div>
            </div>
            <div className="grid gap-5 min-[1320px]:grid-cols-2">
              <div className="rounded-[22px] border border-white/10 bg-black/20 p-4"><div className="mb-3 text-sm font-semibold text-white">Equity Curve</div><div className="h-[280px]"><ResponsiveContainer width="100%" height="100%"><AreaChart data={selectedStrategy.equityCurve}><defs><linearGradient id="optimizerEquity" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="rgba(245,223,161,0.75)" /><stop offset="100%" stopColor="rgba(245,223,161,0.02)" /></linearGradient></defs><CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} /><XAxis dataKey="t" tick={{ fill: "#94a3b8", fontSize: 10 }} tickFormatter={(value) => String(value).slice(0, 10)} label={{ value: "Date", position: "insideBottom", offset: -4, fill: "#94a3b8", fontSize: 11 }} /><YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} label={{ value: "Equity", angle: -90, position: "insideLeft", fill: "#94a3b8", fontSize: 11 }} /><Tooltip contentStyle={{ background: "#05070d", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14 }} /><Legend /><Area name="Equity" type="monotone" dataKey="equity" stroke="#f5dfa1" fill="url(#optimizerEquity)" strokeWidth={2} /></AreaChart></ResponsiveContainer></div></div>
              <div className="rounded-[22px] border border-white/10 bg-black/20 p-4"><div className="mb-3 text-sm font-semibold text-white">Drawdown Curve</div><div className="h-[280px]"><ResponsiveContainer width="100%" height="100%"><AreaChart data={ddSeries}><defs><linearGradient id="optimizerDrawdown" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="rgba(248,113,113,0.7)" /><stop offset="100%" stopColor="rgba(248,113,113,0.05)" /></linearGradient></defs><CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} /><XAxis dataKey="t" tick={{ fill: "#94a3b8", fontSize: 10 }} tickFormatter={(value) => String(value).slice(0, 10)} label={{ value: "Date", position: "insideBottom", offset: -4, fill: "#94a3b8", fontSize: 11 }} /><YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} tickFormatter={(value) => `${Math.round(Number(value) * 100)}%`} label={{ value: "Drawdown", angle: -90, position: "insideLeft", fill: "#94a3b8", fontSize: 11 }} /><Tooltip contentStyle={{ background: "#05070d", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14 }} /><Legend /><Area name="Drawdown" type="monotone" dataKey="drawdown" stroke="#f87171" fill="url(#optimizerDrawdown)" strokeWidth={2} /></AreaChart></ResponsiveContainer></div></div>
              <div className="rounded-[22px] border border-white/10 bg-black/20 p-4"><div className="mb-3 text-sm font-semibold text-white">Trade Distribution Histogram</div><div className="h-[260px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={tradeDist}><CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} /><XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 10 }} label={{ value: "Return bucket", position: "insideBottom", offset: -4, fill: "#94a3b8", fontSize: 11 }} /><YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} label={{ value: "Trades", angle: -90, position: "insideLeft", fill: "#94a3b8", fontSize: 11 }} /><Tooltip contentStyle={{ background: "#05070d", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14 }} /><Legend /><Bar name="Trades" dataKey="count" fill="#60a5fa" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div></div>
              <div className="rounded-[22px] border border-white/10 bg-black/20 p-4"><div className="mb-3 text-sm font-semibold text-white">Monthly Return Distribution</div><div className="h-[260px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={monthDist}><CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} /><XAxis dataKey="month" tick={{ fill: "#94a3b8", fontSize: 10 }} tickFormatter={(value) => String(value).slice(2)} label={{ value: "Month", position: "insideBottom", offset: -4, fill: "#94a3b8", fontSize: 11 }} /><YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} tickFormatter={(value) => `${Math.round(Number(value) * 100)}%`} label={{ value: "Return", angle: -90, position: "insideLeft", fill: "#94a3b8", fontSize: 11 }} /><Tooltip contentStyle={{ background: "#05070d", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14 }} /><Legend /><Bar name="Monthly Return" dataKey="returnPct" fill="#facc15" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div></div>
              <div className="rounded-[22px] border border-white/10 bg-black/20 p-4"><div className="mb-3 text-sm font-semibold text-white">Monte Carlo Distribution</div><div className="h-[260px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={mcDist}><CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} /><XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 10 }} interval={0} angle={-18} textAnchor="end" height={60} label={{ value: "Return bucket", position: "insideBottom", offset: 12, fill: "#94a3b8", fontSize: 11 }} /><YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} label={{ value: "Simulations", angle: -90, position: "insideLeft", fill: "#94a3b8", fontSize: 11 }} /><Tooltip contentStyle={{ background: "#05070d", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14 }} /><Legend /><Bar name="Monte Carlo" dataKey="count" fill="#34d399" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div></div>
              <div className="rounded-[22px] border border-white/10 bg-black/20 p-4"><div className="mb-3 text-sm font-semibold text-white">Monte Carlo Sample Paths</div><div className="h-[260px]"><ResponsiveContainer width="100%" height="100%"><LineChart><CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} /><XAxis dataKey="step" tick={{ fill: "#94a3b8", fontSize: 10 }} label={{ value: "Step", position: "insideBottom", offset: -4, fill: "#94a3b8", fontSize: 11 }} /><YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} label={{ value: "Equity", angle: -90, position: "insideLeft", fill: "#94a3b8", fontSize: 11 }} /><Tooltip contentStyle={{ background: "#05070d", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14 }} /><Legend />{Array.from(new Set(mcPathData.map((item) => item.path))).map((path, index) => <Line key={path} type="monotone" dataKey="value" data={mcPathData.filter((item) => item.path === path)} name={path} stroke={["#60a5fa", "#facc15", "#34d399", "#f87171", "#c084fc", "#38bdf8"][index % 6]} dot={false} strokeWidth={1.5} />)}</LineChart></ResponsiveContainer></div></div>
            </div>
          </div> : <div className="rounded-[22px] border border-dashed border-white/10 bg-black/20 p-6 text-sm text-slate-400">Run the optimizer or load a saved run to inspect strategy charts.</div>}
        </SectionCard>

        <SectionCard title="Optimization History" subtitle="Persistent cache stores strategies, trades, charts, parameters and heatmaps for later reload." open={sections.history} onToggle={() => toggleSection("history")}>
          <div className="grid gap-5">
            <div className="flex flex-wrap items-center gap-3"><button type="button" onClick={loadHistory} className="inline-flex items-center gap-2 rounded-[16px] border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200"><RefreshCw size={15} />Refresh History</button><div className="text-sm text-slate-400">{historyState.loading ? "Loading history..." : `${historyState.items.length} stored optimizer runs`}</div>{historyState.error ? <div className="text-sm text-rose-300">{historyState.error}</div> : null}</div>
            <HistoryTable items={historyState.items} compareIds={compareRunIds} onToggleCompare={toggleCompare} onLoad={loadRun} onDelete={deleteRun} />
            <div className="rounded-[22px] border border-white/10 bg-black/20 p-4"><div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white"><ArrowLeftRight size={16} />Run Comparison</div>{compareRuns.length ? <div className={`grid gap-4 ${compareRuns.length > 1 ? "min-[960px]:grid-cols-2" : ""}`}>{compareRuns.map((run) => <div key={run.runId} className="rounded-[18px] border border-white/10 px-4 py-4"><div className="text-xs uppercase tracking-[0.16em] text-slate-500">{run.mode} run</div><div className="mt-2 font-mono text-xs text-slate-300">{run.runId}</div><div className="mt-4 grid gap-2 text-sm text-slate-200"><div>Date: {fmtDateTime(run.updatedAt)}</div><div>Assets: {run.assets.length}</div><div>Strategies: {run.strategyCount}</div><div>Best Sharpe: {fmt(run.bestSharpe)}</div><div>Best CAGR: {fmtPct(run.bestCagr)}</div><div>Status: {run.status}</div></div></div>)}</div> : <div className="text-sm text-slate-400">Select up to two runs in the history table to compare them.</div>}</div>
          </div>
        </SectionCard>
      </div>
    </main>
  );
}
