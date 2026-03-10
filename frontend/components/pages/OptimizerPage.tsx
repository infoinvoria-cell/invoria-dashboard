"use client";

import { startTransition, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeftRight,
  BarChart3,
  ChevronDown,
  ChevronUp,
  Database,
  Play,
  RefreshCw,
  Save,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type {
  MonteCarloSummary,
  OptimizerAssetId,
  OptimizerClusterSummary,
  OptimizerConfig,
  OptimizerParameterHeatmap,
  OptimizerParameterKey,
  OptimizerProgressSnapshot,
  OptimizerRunResponse,
  OptimizerRunStreamEvent,
  OptimizerRunSummary,
  OptimizerStoredRun,
  OptimizerStrategyResult,
  RangeSpec,
} from "@/lib/optimizer/types";
import { DEFAULT_OPTIMIZER_CONFIG, OPTIMIZER_FX_UNIVERSE } from "@/lib/server/optimizer/config";

type ApiState = {
  loading: boolean;
  error: string | null;
  response: OptimizerRunResponse | null;
  progress: OptimizerProgressSnapshot | null;
};

type HistoryState = {
  loading: boolean;
  error: string | null;
  items: OptimizerRunSummary[];
};

type RangeKey = keyof OptimizerConfig["broadRanges"];

type SectionKey =
  | "configuration"
  | "progress"
  | "results"
  | "stability"
  | "analysis"
  | "history";

const RANGE_ORDER: Array<{ key: RangeKey; label: string }> = [
  { key: "zoneLookback", label: "Zone Lookback" },
  { key: "valuationLength", label: "Valuation Length" },
  { key: "valuationThreshold", label: "Valuation Threshold" },
  { key: "seasonalityYears", label: "Seasonality Years" },
  { key: "holdDays", label: "Hold Days" },
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

function cardStyle() {
  return {
    background: "linear-gradient(180deg, rgba(10,9,7,0.96), rgba(6,6,5,0.94))",
    borderColor: "rgba(201, 170, 87, 0.28)",
    boxShadow: "0 22px 54px rgba(0,0,0,0.35), 0 0 36px rgba(201,170,87,0.08)",
  } as const;
}

function formatPct(value: number, digits = 2): string {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`;
}

function formatMetric(value: number, digits = 2): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "0.00";
}

function formatDateTime(value: string): string {
  if (!value) return "n/a";
  return new Date(value).toLocaleString("de-DE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatEta(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return "calculating";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

function expandRange(range: RangeSpec): number[] {
  const values: number[] = [];
  const decimals = range.step.toString().includes(".") ? range.step.toString().split(".")[1].length : 0;
  for (let current = range.min; current <= range.max + (range.step / 10); current += range.step) {
    values.push(Number(current.toFixed(decimals)));
  }
  return values;
}

function estimateBroadCandidates(config: OptimizerConfig): number {
  const zoneModes = config.toggles.allowNormalZones && config.toggles.allowStrongZones ? 3 : (config.toggles.allowNormalZones || config.toggles.allowStrongZones ? 1 : 0);
  const stopModes = 2;
  return RANGE_ORDER.reduce((product, entry) => product * Math.max(1, expandRange(config.broadRanges[entry.key]).length), Math.max(zoneModes, 1) * stopModes);
}

function paramLabel(key: OptimizerParameterKey): string {
  return RANGE_ORDER.find((entry) => entry.key === key)?.label ?? key;
}

function buildHeatColor(ratio: number): string {
  const stops = [
    { at: 0, rgb: [37, 99, 235] },
    { at: 0.33, rgb: [16, 185, 129] },
    { at: 0.66, rgb: [250, 204, 21] },
    { at: 1, rgb: [239, 68, 68] },
  ];
  const clamped = Math.max(0, Math.min(1, ratio));
  const upperIndex = stops.findIndex((stop) => clamped <= stop.at);
  const upper = stops[Math.max(1, upperIndex)];
  const lower = stops[Math.max(0, upperIndex - 1)];
  const span = Math.max(0.0001, upper.at - lower.at);
  const local = (clamped - lower.at) / span;
  const rgb = lower.rgb.map((value, index) => Math.round(value + ((upper.rgb[index] - value) * local)));
  return `rgb(${rgb.join(",")})`;
}

function computeDrawdownSeries(strategy: OptimizerStrategyResult | null): Array<{ t: string; drawdown: number }> {
  if (!strategy) return [];
  let peak = 1;
  return strategy.equityCurve.map((point) => {
    peak = Math.max(peak, point.equity);
    return {
      t: point.t,
      drawdown: peak > 0 ? ((point.equity - peak) / peak) : 0,
    };
  });
}

function computeTradeDistribution(strategy: OptimizerStrategyResult | null): Array<{ label: string; count: number }> {
  if (!strategy?.trades.length) return [];
  const bins = [
    { min: -1, max: -0.05, label: "< -5%" },
    { min: -0.05, max: -0.02, label: "-5% to -2%" },
    { min: -0.02, max: 0, label: "-2% to 0%" },
    { min: 0, max: 0.02, label: "0% to 2%" },
    { min: 0.02, max: 0.05, label: "2% to 5%" },
    { min: 0.05, max: 1, label: "> 5%" },
  ];
  return bins.map((bin) => ({
    label: bin.label,
    count: strategy.trades.filter((trade) => trade.returnPct >= bin.min && trade.returnPct < bin.max).length,
  }));
}

function monteCarloDistribution(summary: MonteCarloSummary | null | undefined) {
  return summary?.distributionBuckets ?? [];
}

function RangeEditor({ label, value, onChange }: { label: string; value: RangeSpec; onChange: (next: RangeSpec) => void }) {
  return (
    <div className="rounded-[18px] border border-white/10 bg-black/20 p-3">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300">{label}</div>
      <div className="grid grid-cols-3 gap-2">
        {(["min", "max", "step"] as const).map((field) => (
          <label key={field} className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{field}</span>
            <input
              type="number"
              step="0.1"
              value={value[field]}
              onChange={(event) => onChange({ ...value, [field]: Number(event.target.value) })}
              className="rounded-[12px] border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 outline-none transition focus:border-amber-300/50"
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function SectionCard({
  title,
  subtitle,
  open,
  onToggle,
  children,
}: {
  title: string;
  subtitle: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[28px] border p-5" style={cardStyle()}>
      <button type="button" onClick={onToggle} className="flex w-full items-start justify-between gap-4 text-left">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">{title}</div>
          <div className="mt-2 text-sm text-slate-300">{subtitle}</div>
        </div>
        <div className="rounded-[14px] border border-white/10 bg-white/5 p-2 text-slate-200">
          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </button>
      {open ? <div className="mt-5">{children}</div> : null}
    </section>
  );
}

function StrategyTable({
  label,
  results,
  selectedId,
  onSelect,
}: {
  label: string;
  results: OptimizerStrategyResult[];
  selectedId: string | null;
  onSelect: (strategyId: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-[22px] border border-white/10">
      <div className="border-b border-white/10 bg-black/30 px-4 py-3 text-sm font-semibold text-white">{label}</div>
      <div className="grid grid-cols-[72px_96px_96px_110px_120px_110px_92px_minmax(220px,1fr)] gap-3 border-b border-white/10 bg-black/20 px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
        <div>Rank</div>
        <div>Score</div>
        <div>Sharpe</div>
        <div>CAGR</div>
        <div>Max DD</div>
        <div>Profit F.</div>
        <div>Trades</div>
        <div>Parameters</div>
      </div>
      <div className="max-h-[360px] overflow-y-auto">
        {results.map((row) => (
          <button
            key={row.strategyId}
            type="button"
            onClick={() => onSelect(row.strategyId)}
            className={`grid w-full grid-cols-[72px_96px_96px_110px_120px_110px_92px_minmax(220px,1fr)] gap-3 border-b border-white/5 px-4 py-3 text-left transition hover:bg-white/5 ${selectedId === row.strategyId ? "bg-white/5" : ""}`}
          >
            <div className="text-sm font-semibold text-white">#{row.rank}</div>
            <div className="text-sm text-amber-200">{formatMetric(row.metrics.score)}</div>
            <div className="text-sm text-white">{formatMetric(row.metrics.sharpe)}</div>
            <div className="text-sm text-emerald-300">{formatPct(row.metrics.cagr)}</div>
            <div className="text-sm text-rose-300">{formatPct(-Math.abs(row.metrics.maxDrawdown))}</div>
            <div className="text-sm text-white">{formatMetric(row.metrics.profitFactor)}</div>
            <div className="text-sm text-white">{row.metrics.trades}</div>
            <div className="truncate text-xs text-slate-300">
              {row.params.zoneMode} | {row.params.stopMode} | val {row.params.valuationLength} | hold {row.params.holdDays}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function HeatmapPanel({
  heatmap,
  clusters,
  onSelectCluster,
}: {
  heatmap: OptimizerParameterHeatmap | null;
  clusters: OptimizerClusterSummary[];
  onSelectCluster: (clusterId: string | null) => void;
}) {
  if (!heatmap) {
    return <div className="grid min-h-[320px] place-items-center rounded-[22px] border border-dashed border-slate-300/60 bg-white/95 text-slate-500">No heatmap selected.</div>;
  }

  const scores = heatmap.cells.map((cell) => cell.smoothedScore);
  const minScore = Math.min(...scores, 0);
  const maxScore = Math.max(...scores, 1);
  const cellMap = new Map(heatmap.cells.map((cell) => [`${cell.x}|${cell.y}`, cell]));

  return (
    <div className="rounded-[22px] border border-slate-200 bg-white/95 p-4 text-slate-900">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">Heatmap: {paramLabel(heatmap.xKey)} vs {paramLabel(heatmap.yKey)}</div>
          <div className="mt-1 text-xs text-slate-600">Composite score surface with neighborhood smoothing. Click a cell to jump to the nearest stable cluster.</div>
        </div>
        <div className="rounded-[14px] border border-slate-200 px-3 py-2 text-xs text-slate-600">Stage {heatmap.stage}</div>
      </div>

      <div className="mb-4 h-3 rounded-full bg-[linear-gradient(90deg,#2563eb_0%,#10b981_35%,#facc15_68%,#ef4444_100%)]" />
      <div className="mb-4 flex items-center justify-between text-[11px] text-slate-500">
        <span>Low score {formatMetric(minScore)}</span>
        <span>Composite score legend</span>
        <span>High score {formatMetric(maxScore)}</span>
      </div>

      <div className="overflow-x-auto">
        <div className="grid min-w-[560px] gap-2" style={{ gridTemplateColumns: `112px repeat(${heatmap.xValues.length}, minmax(60px, 1fr))` }}>
          <div />
          {heatmap.xValues.map((value) => (
            <div key={`x-${value}`} className="text-center text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              {value}
            </div>
          ))}
          {heatmap.yValues.map((yValue) => (
            <div key={`row-${yValue}`} className="contents">
              <div className="flex items-center text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{yValue}</div>
              {heatmap.xValues.map((xValue) => {
                const cell = cellMap.get(`${xValue}|${yValue}`);
                if (!cell) {
                  return <div key={`${xValue}-${yValue}`} className="h-[58px] rounded-[14px] border border-dashed border-slate-200 bg-slate-50" />;
                }
                const ratio = (cell.smoothedScore - minScore) / Math.max(1e-9, maxScore - minScore);
                const cluster = clusters.find((item) => xValue >= item.xRange.min && xValue <= item.xRange.max && yValue >= item.yRange.min && yValue <= item.yRange.max);
                return (
                  <button
                    key={`${xValue}-${yValue}`}
                    type="button"
                    onClick={() => onSelectCluster(cluster?.clusterId ?? null)}
                    className="flex h-[58px] flex-col items-center justify-center rounded-[14px] border border-slate-200 px-1 text-center transition hover:border-slate-400"
                    style={{ background: buildHeatColor(ratio), color: ratio > 0.54 ? "#111827" : "#f8fafc" }}
                  >
                    <div className="text-[11px] font-semibold">{formatMetric(cell.score)}</div>
                    <div className="text-[9px] uppercase tracking-[0.12em] opacity-80">{cell.count} strat</div>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function HistoryTable({
  items,
  compareIds,
  onToggleCompare,
  onLoad,
  onDelete,
}: {
  items: OptimizerRunSummary[];
  compareIds: string[];
  onToggleCompare: (runId: string) => void;
  onLoad: (runId: string) => void;
  onDelete: (runId: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-[22px] border border-white/10">
      <div className="grid grid-cols-[64px_180px_120px_120px_120px_120px_120px_200px] gap-3 border-b border-white/10 bg-black/30 px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
        <div>Cmp</div>
        <div>Run ID</div>
        <div>Date</div>
        <div>Mode</div>
        <div>Assets</div>
        <div>Best Sharpe</div>
        <div>Best CAGR</div>
        <div>Actions</div>
      </div>
      <div className="max-h-[360px] overflow-y-auto">
        {items.map((item) => (
          <div key={item.runId} className="grid grid-cols-[64px_180px_120px_120px_120px_120px_120px_200px] gap-3 border-b border-white/5 px-4 py-3 text-sm text-slate-200">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={compareIds.includes(item.runId)} onChange={() => onToggleCompare(item.runId)} />
              <span className="text-xs text-slate-400">Compare</span>
            </label>
            <div className="truncate font-mono text-xs">{item.runId}</div>
            <div className="text-xs">{formatDateTime(item.updatedAt)}</div>
            <div className="text-xs uppercase text-slate-400">{item.mode}</div>
            <div className="text-xs">{item.assets.length}</div>
            <div>{formatMetric(item.bestSharpe)}</div>
            <div>{formatPct(item.bestCagr)}</div>
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
  const [selectedStrategyId, setSelectedStrategyId] = useState<string | null>(null);
  const [selectedHeatmapId, setSelectedHeatmapId] = useState<string | null>(null);
  const [selectedClusterId, setSelectedClusterId] = useState<string | null>(null);
  const [sections, setSections] = useState<Record<SectionKey, boolean>>(DEFAULT_SECTIONS);
  const [compareRunIds, setCompareRunIds] = useState<string[]>([]);

  const candidateEstimate = useMemo(() => estimateBroadCandidates(config), [config]);

  const strategyIndex = useMemo(() => {
    const entries = new Map<string, OptimizerStrategyResult>();
    for (const stage of apiState.response?.stageSummaries ?? []) {
      for (const strategy of stage.topStrategies) entries.set(strategy.strategyId, strategy);
    }
    for (const strategy of apiState.response?.topStrategies ?? []) entries.set(strategy.strategyId, strategy);
    for (const cluster of apiState.response?.stability.clusters ?? []) {
      entries.set(cluster.representativeStrategy.strategyId, cluster.representativeStrategy);
      for (const strategy of cluster.clusterStrategies) entries.set(strategy.strategyId, strategy);
    }
    return entries;
  }, [apiState.response]);

  const selectedStrategy = useMemo(() => {
    if (selectedStrategyId) {
      const explicit = strategyIndex.get(selectedStrategyId);
      if (explicit) return explicit;
    }
    return apiState.response?.topStrategies[0] ?? apiState.response?.stageSummaries[2]?.topStrategies[0] ?? null;
  }, [apiState.response, selectedStrategyId, strategyIndex]);

  const selectedHeatmap = useMemo(
    () => apiState.response?.stability.heatmaps.find((heatmap) => heatmap.id === selectedHeatmapId) ?? apiState.response?.stability.heatmaps[0] ?? null,
    [apiState.response, selectedHeatmapId],
  );

  const selectedCluster = useMemo(
    () => apiState.response?.stability.clusters.find((cluster) => cluster.clusterId === selectedClusterId) ?? apiState.response?.stability.clusters[0] ?? null,
    [apiState.response, selectedClusterId],
  );

  const compareRuns = useMemo(
    () => historyState.items.filter((item) => compareRunIds.includes(item.runId)).slice(0, 2),
    [compareRunIds, historyState.items],
  );

  const drawdownSeries = useMemo(() => computeDrawdownSeries(selectedStrategy), [selectedStrategy]);
  const tradeDistribution = useMemo(() => computeTradeDistribution(selectedStrategy), [selectedStrategy]);
  const monteCarloBuckets = useMemo(() => monteCarloDistribution(selectedStrategy?.monteCarlo), [selectedStrategy]);

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

  useEffect(() => {
    void loadHistory();
  }, []);

  async function runOptimizer() {
    setApiState((current) => ({ ...current, loading: true, error: null, progress: null }));
    try {
      const response = await fetch("/api/optimizer/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ config }),
      });
      if (!response.ok || !response.body) {
        throw new Error(`${response.status} ${response.statusText}`);
      }

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
            if (event.type === "progress") {
              setApiState((current) => ({ ...current, loading: true, progress: event.payload }));
            } else if (event.type === "result") {
              finalResult = event.payload;
              startTransition(() => {
                setApiState({ loading: false, error: null, response: event.payload, progress: null });
                setSelectedStrategyId(event.payload.topStrategies[0]?.strategyId ?? null);
                setSelectedHeatmapId(event.payload.stability.heatmaps[0]?.id ?? null);
                setSelectedClusterId(event.payload.stability.clusters[0]?.clusterId ?? null);
              });
            } else if (event.type === "error") {
              throw new Error(event.payload.message);
            }
          }
          lineBreak = buffer.indexOf("\n");
        }
      }

      if (!finalResult) {
        throw new Error("Optimizer finished without a result payload.");
      }

      await loadHistory();
    } catch (error) {
      setApiState((current) => ({
        ...current,
        loading: false,
        error: error instanceof Error ? error.message : "Optimizer run failed",
      }));
    }
  }

  async function saveCurrentRun() {
    const runId = apiState.response?.runId;
    if (!runId) return;
    await fetch("/api/optimizer/history", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId }),
    });
    await loadHistory();
  }

  async function loadRun(runId: string) {
    const response = await fetch(`/api/optimizer/history/${encodeURIComponent(runId)}`, { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json() as OptimizerStoredRun;
    if (!payload.result) return;
    setConfig(payload.config);
    setApiState({ loading: false, error: payload.error, response: payload.result, progress: null });
    setSelectedStrategyId(payload.result.topStrategies[0]?.strategyId ?? null);
    setSelectedHeatmapId(payload.result.stability.heatmaps[0]?.id ?? null);
    setSelectedClusterId(payload.result.stability.clusters[0]?.clusterId ?? null);
  }

  async function deleteRun(runId: string) {
    await fetch(`/api/optimizer/history/${encodeURIComponent(runId)}`, { method: "DELETE" });
    await loadHistory();
  }

  function toggleCompare(runId: string) {
    setCompareRunIds((current) => {
      if (current.includes(runId)) return current.filter((item) => item !== runId);
      return [...current, runId].slice(-2);
    });
  }

  function toggleSection(section: SectionKey) {
    setSections((current) => ({ ...current, [section]: !current[section] }));
  }

  return (
    <main className="ivq-terminal-page relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(180,148,72,0.16),transparent_32%),radial-gradient(circle_at_top_right,rgba(42,78,170,0.12),transparent_28%),linear-gradient(180deg,rgba(4,6,12,0.98),rgba(2,4,9,1))]" />
      </div>

      <div className="relative mx-auto flex max-w-[1760px] flex-col gap-5 text-slate-100">
        <section className="rounded-[28px] border p-6" style={cardStyle()}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Quant Research Environment</div>
              <h1 className="mt-3 text-3xl font-semibold text-white">Optimizer</h1>
              <p className="mt-3 max-w-[920px] text-sm leading-7 text-slate-300">
                Dukascopy-first multi-asset optimization with coverage validation, staged search, out-of-sample testing,
                Monte Carlo robustness, parameter stability heatmaps and persistent run history.
              </p>
            </div>
            <div className="grid gap-3 min-[920px]:grid-cols-3">
              <div className="rounded-[20px] border border-white/10 bg-black/20 px-4 py-3">
                <div className="text-[10px] uppercase tracking-[0.16em] text-slate-400">Stage 1 Grid</div>
                <div className="mt-2 text-2xl font-semibold text-white">{candidateEstimate.toLocaleString()}</div>
                <div className="mt-1 text-xs text-slate-500">raw combinations before batch trimming</div>
              </div>
              <div className="rounded-[20px] border border-white/10 bg-black/20 px-4 py-3">
                <div className="text-[10px] uppercase tracking-[0.16em] text-slate-400">Train / Test</div>
                <div className="mt-2 text-sm font-semibold text-white">2012-2019 / 2020-2025</div>
                <div className="mt-1 text-xs text-slate-500">daily logic on H1-derived candles</div>
              </div>
              <div className="rounded-[20px] border border-white/10 bg-black/20 px-4 py-3">
                <div className="text-[10px] uppercase tracking-[0.16em] text-slate-400">Run Storage</div>
                <div className="mt-2 text-2xl font-semibold text-white">{historyState.items.length}</div>
                <div className="mt-1 text-xs text-slate-500">temporary + saved optimization runs</div>
              </div>
            </div>
          </div>
        </section>

        <SectionCard
          title="Optimizer Configuration"
          subtitle="Data settings, train/test windows, strategy toggles and optimization ranges."
          open={sections.configuration}
          onToggle={() => toggleSection("configuration")}
        >
          <div className="grid gap-5">
            <div className="grid gap-5 min-[1320px]:grid-cols-[1.1fr_0.9fr]">
              <div className="grid gap-5">
                <div>
                  <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                    <Database size={14} />
                    Data Settings
                  </div>
                  <div className="grid gap-3 min-[900px]:grid-cols-[minmax(0,1fr)_220px_220px]">
                    <div className="rounded-[20px] border border-white/10 bg-black/20 p-4">
                      <div className="mb-3 text-sm font-semibold text-white">Asset Selection</div>
                      <div className="grid gap-2 min-[620px]:grid-cols-2">
                        {OPTIMIZER_FX_UNIVERSE.map((asset) => {
                          const checked = config.assets.includes(asset.assetId);
                          return (
                            <label key={asset.assetId} className="flex items-center gap-3 rounded-[14px] border border-white/10 px-3 py-2 text-sm text-slate-200">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(event) => {
                                  const nextAssets = event.target.checked
                                    ? [...config.assets, asset.assetId]
                                    : config.assets.filter((item) => item !== asset.assetId);
                                  setConfig((current) => ({ ...current, assets: nextAssets as OptimizerAssetId[] }));
                                }}
                              />
                              <span>{asset.label}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                    <label className="rounded-[20px] border border-white/10 bg-black/20 p-4">
                      <div className="mb-2 text-sm font-semibold text-white">Source</div>
                      <select
                        value={config.source}
                        onChange={(event) => setConfig((current) => ({ ...current, source: event.target.value as OptimizerConfig["source"] }))}
                        className="w-full rounded-[14px] border border-white/10 bg-slate-950/80 px-3 py-3 text-sm text-slate-100 outline-none"
                      >
                        <option value="dukascopy">Dukascopy</option>
                      </select>
                      <div className="mt-2 text-xs text-slate-500">Snapshots are used first when available.</div>
                    </label>
                    <div className="rounded-[20px] border border-white/10 bg-black/20 p-4">
                      <div className="mb-2 text-sm font-semibold text-white">Windows</div>
                      <div className="grid gap-2 text-sm text-slate-300">
                        <div>Train: 2012-01-01 to 2019-12-31</div>
                        <div>Out of sample: 2020-01-01 to 2025-12-31</div>
                        <div>Primary timeframe: D1 from H1 OHLC</div>
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                    <Settings2 size={14} />
                    Strategy Inputs
                  </div>
                  <div className="grid gap-3 min-[840px]:grid-cols-2">
                    {TOGGLE_FIELDS.map((toggle) => (
                      <label key={toggle.key} className="flex items-center gap-3 rounded-[16px] border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-200">
                        <input
                          type="checkbox"
                          checked={config.toggles[toggle.key]}
                          onChange={(event) =>
                            setConfig((current) => ({
                              ...current,
                              toggles: {
                                ...current.toggles,
                                [toggle.key]: event.target.checked,
                              },
                            }))
                          }
                        />
                        <span>{toggle.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
                  <ShieldCheck size={14} />
                  Optimization Ranges
                </div>
                <div className="grid gap-3 min-[840px]:grid-cols-2">
                  {RANGE_ORDER.map((entry) => (
                    <RangeEditor
                      key={entry.key}
                      label={entry.label}
                      value={config.broadRanges[entry.key]}
                      onChange={(next) =>
                        setConfig((current) => ({
                          ...current,
                          broadRanges: {
                            ...current.broadRanges,
                            [entry.key]: next,
                          },
                        }))
                      }
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={runOptimizer}
                disabled={apiState.loading || config.assets.length === 0}
                className="inline-flex items-center gap-2 rounded-[16px] border border-amber-300/40 bg-amber-200/10 px-5 py-3 text-sm font-semibold text-amber-100 transition hover:bg-amber-200/15 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {apiState.loading ? <RefreshCw size={16} className="animate-spin" /> : <Play size={16} />}
                Run Optimizer
              </button>
              <button
                type="button"
                onClick={() => setConfig(DEFAULT_OPTIMIZER_CONFIG)}
                className="inline-flex items-center gap-2 rounded-[16px] border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-slate-200 transition hover:bg-white/10"
              >
                <RefreshCw size={16} />
                Reset Defaults
              </button>
              <div className="text-sm text-slate-400">
                Raw grid estimate: <span className="font-semibold text-white">{candidateEstimate.toLocaleString()}</span>. Runtime uses batches of 500 evaluations to keep the interface responsive.
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Optimization Progress"
          subtitle="Live stage progress, warnings and data coverage diagnostics."
          open={sections.progress}
          onToggle={() => toggleSection("progress")}
        >
          <div className="grid gap-5 min-[1200px]:grid-cols-[0.92fr_1.08fr]">
            <div className="rounded-[22px] border border-white/10 bg-black/20 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
                <BarChart3 size={16} />
                Optimization Progress
              </div>
              <div className="rounded-full bg-white/10 p-1">
                <div
                  className="h-3 rounded-full bg-[linear-gradient(90deg,#2563eb,#10b981,#facc15,#ef4444)] transition-all"
                  style={{ width: `${apiState.progress?.percent ?? 0}%` }}
                />
              </div>
              <div className="mt-4 grid gap-3 min-[620px]:grid-cols-2">
                <div className="rounded-[16px] border border-white/10 px-4 py-3">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Current Stage</div>
                  <div className="mt-2 text-lg font-semibold text-white">{apiState.progress?.label ?? "Idle"}</div>
                </div>
                <div className="rounded-[16px] border border-white/10 px-4 py-3">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Progress</div>
                  <div className="mt-2 text-lg font-semibold text-white">
                    {apiState.progress ? `${apiState.progress.completed.toLocaleString()} / ${apiState.progress.total.toLocaleString()}` : "0 / 0"}
                  </div>
                </div>
                <div className="rounded-[16px] border border-white/10 px-4 py-3">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Completion</div>
                  <div className="mt-2 text-lg font-semibold text-white">{formatMetric((apiState.progress?.percent ?? 0), 1)}%</div>
                </div>
                <div className="rounded-[16px] border border-white/10 px-4 py-3">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">ETA</div>
                  <div className="mt-2 text-lg font-semibold text-white">{formatEta(apiState.progress?.etaSeconds ?? null)}</div>
                </div>
              </div>
              <div className="mt-4 rounded-[16px] border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-300">
                {apiState.progress?.message ?? "No run in progress."}
              </div>
              {apiState.error ? (
                <div className="mt-4 inline-flex items-center gap-2 rounded-[14px] border border-rose-400/30 bg-rose-400/10 px-4 py-2 text-sm text-rose-200">
                  <AlertTriangle size={15} />
                  {apiState.error}
                </div>
              ) : null}
            </div>

            <div className="grid gap-4">
              {apiState.response?.warnings.length ? (
                <div className="rounded-[22px] border border-amber-300/25 bg-amber-300/5 p-4">
                  <div className="mb-3 text-sm font-semibold text-amber-100">Runtime Warnings</div>
                  <div className="grid gap-2">
                    {apiState.response.warnings.map((warning) => (
                      <div key={warning} className="text-sm text-amber-100/90">{warning}</div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded-[22px] border border-white/10 bg-black/20 p-4 text-sm text-slate-400">
                  Warnings appear here when historical coverage is insufficient, no trades are generated or a parameter range is too restrictive.
                </div>
              )}

              <div className="rounded-[22px] border border-white/10 bg-black/20 p-4">
                <div className="mb-3 text-sm font-semibold text-white">Coverage Validator</div>
                <div className="grid grid-cols-[100px_100px_120px_100px_110px_120px_1fr] gap-3 border-b border-white/10 pb-3 text-[10px] uppercase tracking-[0.18em] text-slate-500">
                  <div>Asset</div>
                  <div>H1 Bars</div>
                  <div>D1 Coverage</div>
                  <div>Missing</div>
                  <div>Largest Gap</div>
                  <div>Source</div>
                  <div>Issues</div>
                </div>
                <div className="mt-2 grid gap-2">
                  {(apiState.response?.coverage ?? []).map((row) => (
                    <div key={row.assetId} className="grid grid-cols-[100px_100px_120px_100px_110px_120px_1fr] gap-3 rounded-[14px] border border-white/5 px-3 py-2 text-sm text-slate-200">
                      <div>{row.symbol}</div>
                      <div>{row.barsH1.toLocaleString()}</div>
                      <div>{(row.coverageRatioD1 * 100).toFixed(1)}%</div>
                      <div>{row.missingDaysD1}</div>
                      <div>{row.largestGapDays}d</div>
                      <div>{row.sourceUsed}</div>
                      <div className={row.issues.length ? "text-amber-200" : "text-emerald-300"}>{row.issues.join("; ") || "ok"}</div>
                    </div>
                  ))}
                  {!apiState.response?.coverage.length ? (
                    <div className="rounded-[14px] border border-dashed border-white/10 px-4 py-6 text-sm text-slate-400">Coverage appears here after a run starts.</div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </SectionCard>

        <SectionCard
          title="Results Section"
          subtitle="Stage 1 discovery, Stage 2 refinement, Stage 3 out-of-sample and portfolio-level outputs."
          open={sections.results}
          onToggle={() => toggleSection("results")}
        >
          {apiState.response ? (
            <div className="grid gap-5">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={saveCurrentRun}
                  className="inline-flex items-center gap-2 rounded-[16px] border border-amber-300/30 bg-amber-300/10 px-4 py-2 text-sm font-semibold text-amber-100"
                >
                  <Save size={15} />
                  Save Optimization Run
                </button>
                <div className="text-sm text-slate-400">Run ID: <span className="font-mono text-slate-200">{apiState.response.runId}</span></div>
              </div>

              <div className="grid gap-3 min-[1000px]:grid-cols-3">
                {apiState.response.stageSummaries.map((summary) => (
                  <div key={summary.stage} className="rounded-[20px] border border-white/10 bg-black/20 p-4">
                    <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{summary.label}</div>
                    <div className="mt-3 text-3xl font-semibold text-white">{summary.strategyCount}</div>
                    <div className="mt-2 text-sm text-slate-400">ranked candidates retained</div>
                  </div>
                ))}
              </div>

              {apiState.response.stageSummaries.map((summary) => (
                <StrategyTable
                  key={summary.stage}
                  label={summary.label}
                  results={summary.topStrategies}
                  selectedId={selectedStrategy?.strategyId ?? null}
                  onSelect={setSelectedStrategyId}
                />
              ))}
            </div>
          ) : (
            <div className="grid min-h-[220px] place-items-center rounded-[24px] border border-dashed border-white/10 bg-black/20 p-6 text-center text-slate-400">
              No optimizer run yet.
            </div>
          )}
        </SectionCard>

        <SectionCard
          title="Parameter Stability"
          subtitle="High-contrast heatmaps and cluster summaries to detect robust parameter regions, not just single peaks."
          open={sections.stability}
          onToggle={() => toggleSection("stability")}
        >
          {apiState.response ? (
            <div className="grid gap-5">
              <div className="flex flex-wrap gap-2">
                {apiState.response.stability.availablePairs.map((pair) => (
                  <button
                    key={pair.id}
                    type="button"
                    onClick={() => {
                      setSelectedHeatmapId(pair.id);
                      const cluster = apiState.response?.stability.clusters.find((item) => item.heatmapId === pair.id);
                      setSelectedClusterId(cluster?.clusterId ?? null);
                    }}
                    className={`rounded-[12px] border px-3 py-2 text-xs font-semibold transition ${selectedHeatmap?.id === pair.id ? "border-amber-300/40 bg-amber-300/10 text-amber-100" : "border-white/10 bg-white/5 text-slate-300"}`}
                  >
                    S{pair.stage}: {paramLabel(pair.xKey)} x {paramLabel(pair.yKey)}
                  </button>
                ))}
              </div>

              <div className="grid gap-5 min-[1180px]:grid-cols-[1.05fr_0.95fr]">
                <HeatmapPanel
                  heatmap={selectedHeatmap}
                  clusters={apiState.response.stability.clusters.filter((cluster) => cluster.heatmapId === (selectedHeatmap?.id ?? ""))}
                  onSelectCluster={(clusterId) => {
                    setSelectedClusterId(clusterId);
                    const cluster = apiState.response?.stability.clusters.find((item) => item.clusterId === clusterId);
                    if (cluster) setSelectedStrategyId(cluster.representativeStrategy.strategyId);
                  }}
                />

                <div className="grid gap-4">
                  <div className="overflow-hidden rounded-[22px] border border-white/10">
                    <div className="grid grid-cols-[110px_minmax(240px,1.2fr)_110px_110px_110px_110px_110px] gap-3 border-b border-white/10 bg-black/30 px-4 py-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                      <div>Cluster</div>
                      <div>Ranges</div>
                      <div>Sharpe</div>
                      <div>CAGR</div>
                      <div>Max DD</div>
                      <div>Count</div>
                      <div>Inspect</div>
                    </div>
                    <div className="max-h-[320px] overflow-y-auto">
                      {apiState.response.stability.clusters
                        .filter((cluster) => cluster.heatmapId === (selectedHeatmap?.id ?? cluster.heatmapId))
                        .map((cluster) => (
                          <div key={cluster.clusterId} className={`grid grid-cols-[110px_minmax(240px,1.2fr)_110px_110px_110px_110px_110px] gap-3 border-b border-white/5 px-4 py-3 ${selectedCluster?.clusterId === cluster.clusterId ? "bg-white/5" : ""}`}>
                            <button type="button" onClick={() => setSelectedClusterId(cluster.clusterId)} className="text-left text-sm font-semibold text-white">{cluster.clusterId}</button>
                            <div className="text-xs text-slate-300">
                              {paramLabel(cluster.xKey)} {cluster.xRange.min} - {cluster.xRange.max}
                              <br />
                              {paramLabel(cluster.yKey)} {cluster.yRange.min} - {cluster.yRange.max}
                            </div>
                            <div>{formatMetric(cluster.medianSharpe)}</div>
                            <div className="text-emerald-300">{formatPct(cluster.medianCagr)}</div>
                            <div className="text-rose-300">{formatPct(-cluster.maxDrawdown)}</div>
                            <div>{cluster.strategyCount}</div>
                            <button type="button" onClick={() => setSelectedStrategyId(cluster.representativeStrategy.strategyId)} className="rounded-[12px] border border-amber-300/30 bg-amber-300/10 px-3 py-1 text-xs font-semibold text-amber-100">Load</button>
                          </div>
                        ))}
                    </div>
                  </div>

                  {selectedCluster ? (
                    <div className="rounded-[22px] border border-white/10 bg-black/20 p-4">
                      <div className="text-sm font-semibold text-white">Selected Cluster</div>
                      <div className="mt-3 grid gap-3 min-[720px]:grid-cols-2">
                        <div className="rounded-[16px] border border-white/10 px-4 py-3">
                          <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Parameter Zone</div>
                          <div className="mt-2 text-sm text-slate-200">
                            {paramLabel(selectedCluster.xKey)} {selectedCluster.xRange.min} - {selectedCluster.xRange.max}
                            <br />
                            {paramLabel(selectedCluster.yKey)} {selectedCluster.yRange.min} - {selectedCluster.yRange.max}
                          </div>
                        </div>
                        <div className="rounded-[16px] border border-white/10 px-4 py-3">
                          <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Robustness Summary</div>
                          <div className="mt-2 text-sm text-slate-200">
                            Median Sharpe {formatMetric(selectedCluster.medianSharpe)} | Median CAGR {formatPct(selectedCluster.medianCagr)}
                            <br />
                            Worst Max DD {formatPct(-selectedCluster.maxDrawdown)} | {selectedCluster.strategyCount} strategies
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-[22px] border border-dashed border-white/10 bg-black/20 p-6 text-sm text-slate-400">Heatmaps and clusters appear after a completed run.</div>
          )}
        </SectionCard>

        <SectionCard
          title="Strategy Analysis"
          subtitle="Interactive equity, drawdown, trade distribution, Monte Carlo distribution and trade list."
          open={sections.analysis}
          onToggle={() => toggleSection("analysis")}
        >
          {selectedStrategy ? (
            <div className="grid gap-5">
              <div className="grid gap-3 min-[1100px]:grid-cols-6">
                {[
                  ["Score", formatMetric(selectedStrategy.metrics.score)],
                  ["Sharpe", formatMetric(selectedStrategy.metrics.sharpe)],
                  ["Profit Factor", formatMetric(selectedStrategy.metrics.profitFactor)],
                  ["CAGR", formatPct(selectedStrategy.metrics.cagr)],
                  ["Max DD", formatPct(-selectedStrategy.metrics.maxDrawdown)],
                  ["Trades", String(selectedStrategy.metrics.trades)],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-[18px] border border-white/10 bg-black/20 px-4 py-3">
                    <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{label}</div>
                    <div className="mt-2 text-xl font-semibold text-white">{value}</div>
                  </div>
                ))}
              </div>

              <div className="grid gap-5 min-[1320px]:grid-cols-2">
                <div className="rounded-[22px] border border-white/10 bg-black/20 p-4">
                  <div className="mb-3 text-sm font-semibold text-white">Equity Curve</div>
                  <div className="h-[280px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={selectedStrategy.equityCurve}>
                        <defs>
                          <linearGradient id="optimizerEquity" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="rgba(245, 223, 161, 0.75)" />
                            <stop offset="100%" stopColor="rgba(245, 223, 161, 0.02)" />
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                        <XAxis dataKey="t" tick={{ fill: "#94a3b8", fontSize: 10 }} tickFormatter={(value) => String(value).slice(0, 10)} />
                        <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} />
                        <Tooltip contentStyle={{ background: "#05070d", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14 }} />
                        <Area type="monotone" dataKey="equity" stroke="#f5dfa1" fill="url(#optimizerEquity)" strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="rounded-[22px] border border-white/10 bg-black/20 p-4">
                  <div className="mb-3 text-sm font-semibold text-white">Drawdown Curve</div>
                  <div className="h-[280px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={drawdownSeries}>
                        <defs>
                          <linearGradient id="optimizerDrawdown" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="rgba(248,113,113,0.7)" />
                            <stop offset="100%" stopColor="rgba(248,113,113,0.05)" />
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                        <XAxis dataKey="t" tick={{ fill: "#94a3b8", fontSize: 10 }} tickFormatter={(value) => String(value).slice(0, 10)} />
                        <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} tickFormatter={(value) => `${Math.round(Number(value) * 100)}%`} />
                        <Tooltip contentStyle={{ background: "#05070d", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14 }} />
                        <Area type="monotone" dataKey="drawdown" stroke="#f87171" fill="url(#optimizerDrawdown)" strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="rounded-[22px] border border-white/10 bg-black/20 p-4">
                  <div className="mb-3 text-sm font-semibold text-white">Trade Distribution</div>
                  <div className="h-[260px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={tradeDistribution}>
                        <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                        <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 10 }} />
                        <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} />
                        <Tooltip contentStyle={{ background: "#05070d", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14 }} />
                        <Bar dataKey="count" fill="#60a5fa" radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="rounded-[22px] border border-white/10 bg-black/20 p-4">
                  <div className="mb-3 text-sm font-semibold text-white">Monte Carlo Distribution</div>
                  <div className="h-[260px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={monteCarloBuckets}>
                        <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                        <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 10 }} interval={0} angle={-18} textAnchor="end" height={60} />
                        <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} />
                        <Tooltip contentStyle={{ background: "#05070d", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14 }} />
                        <Bar dataKey="count" fill="#34d399" radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              <div className="grid gap-5 min-[1320px]:grid-cols-[0.82fr_1.18fr]">
                <div className="rounded-[22px] border border-white/10 bg-black/20 p-4">
                  <div className="mb-3 text-sm font-semibold text-white">Monte Carlo Summary</div>
                  <div className="grid gap-3">
                    {selectedStrategy.monteCarlo ? (
                      [
                        ["Simulations", selectedStrategy.monteCarlo.simulations.toLocaleString()],
                        ["Worst Case DD", formatPct(-selectedStrategy.monteCarlo.worstCaseDrawdown)],
                        ["MC Sharpe", formatMetric(selectedStrategy.monteCarlo.monteCarloSharpe)],
                        ["Probability of Ruin", formatPct(selectedStrategy.monteCarlo.probabilityOfRuin)],
                        ["Return P05 / P50 / P95", `${formatPct(selectedStrategy.monteCarlo.returnDistribution.p05)} / ${formatPct(selectedStrategy.monteCarlo.returnDistribution.p50)} / ${formatPct(selectedStrategy.monteCarlo.returnDistribution.p95)}`],
                      ].map(([label, value]) => (
                        <div key={label} className="rounded-[16px] border border-white/10 px-4 py-3">
                          <div className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{label}</div>
                          <div className="mt-2 text-sm text-slate-100">{value}</div>
                        </div>
                      ))
                    ) : (
                      <div className="text-sm text-slate-400">No Monte Carlo output for the selected strategy.</div>
                    )}
                  </div>
                </div>

                <div className="rounded-[22px] border border-white/10 bg-black/20 p-4">
                  <div className="mb-3 text-sm font-semibold text-white">Trade List</div>
                  <div className="grid grid-cols-[90px_90px_100px_100px_100px_90px_110px] gap-3 border-b border-white/10 pb-3 text-[10px] uppercase tracking-[0.18em] text-slate-500">
                    <div>Asset</div>
                    <div>Dir</div>
                    <div>Entry</div>
                    <div>Exit</div>
                    <div>Return</div>
                    <div>Hold</div>
                    <div>Exit Type</div>
                  </div>
                  <div className="mt-2 max-h-[320px] overflow-y-auto">
                    {selectedStrategy.trades.slice(0, 120).map((trade, index) => (
                      <div key={`${trade.assetId}-${trade.entryDate}-${index}`} className="grid grid-cols-[90px_90px_100px_100px_100px_90px_110px] gap-3 border-b border-white/5 py-2 text-sm text-slate-200">
                        <div>{trade.assetId.replace("cross_", "").toUpperCase()}</div>
                        <div className={trade.direction === "long" ? "text-emerald-300" : "text-rose-300"}>{trade.direction}</div>
                        <div>{trade.entryDate.slice(0, 10)}</div>
                        <div>{trade.exitDate.slice(0, 10)}</div>
                        <div className={trade.returnPct >= 0 ? "text-emerald-300" : "text-rose-300"}>{formatPct(trade.returnPct)}</div>
                        <div>{trade.holdDays}d</div>
                        <div>{trade.takeProfitHit ? "target" : trade.stopHit ? "stop" : "time"}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-[22px] border border-dashed border-white/10 bg-black/20 p-6 text-sm text-slate-400">Run the optimizer or load a saved run to inspect strategy charts.</div>
          )}
        </SectionCard>

        <SectionCard
          title="Optimization History"
          subtitle="Temporary cache, saved runs, load/delete actions and quick run comparison."
          open={sections.history}
          onToggle={() => toggleSection("history")}
        >
          <div className="grid gap-5">
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={loadHistory} className="inline-flex items-center gap-2 rounded-[16px] border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200">
                <RefreshCw size={15} />
                Refresh History
              </button>
              <div className="text-sm text-slate-400">
                {historyState.loading ? "Loading history..." : `${historyState.items.length} stored optimizer runs`}
              </div>
              {historyState.error ? <div className="text-sm text-rose-300">{historyState.error}</div> : null}
            </div>

            <HistoryTable
              items={historyState.items}
              compareIds={compareRunIds}
              onToggleCompare={toggleCompare}
              onLoad={loadRun}
              onDelete={deleteRun}
            />

            <div className="rounded-[22px] border border-white/10 bg-black/20 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
                <ArrowLeftRight size={16} />
                Run Comparison
              </div>
              {compareRuns.length ? (
                <div className={`grid gap-4 ${compareRuns.length > 1 ? "min-[960px]:grid-cols-2" : ""}`}>
                  {compareRuns.map((run) => (
                    <div key={run.runId} className="rounded-[18px] border border-white/10 px-4 py-4">
                      <div className="text-xs uppercase tracking-[0.16em] text-slate-500">{run.mode} run</div>
                      <div className="mt-2 font-mono text-xs text-slate-300">{run.runId}</div>
                      <div className="mt-4 grid gap-2 text-sm text-slate-200">
                        <div>Date: {formatDateTime(run.updatedAt)}</div>
                        <div>Assets: {run.assets.length}</div>
                        <div>Strategies: {run.strategyCount}</div>
                        <div>Best Sharpe: {formatMetric(run.bestSharpe)}</div>
                        <div>Best CAGR: {formatPct(run.bestCagr)}</div>
                        <div>Status: {run.status}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-sm text-slate-400">Select up to two runs in the history table to compare them.</div>
              )}
            </div>
          </div>
        </SectionCard>
      </div>
    </main>
  );
}
