"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  FileUp,
  FolderOpen,
  Gauge,
  Loader2,
  Radar,
  RefreshCw,
  Upload,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type {
  RegimeAnalysisResponse,
  RegimeHeatmapCell,
  RegimeInputRow,
  TrafficLight,
} from "@/lib/regimes/types";

type OptimizerRunSummary = {
  runId: string;
};

type OptimizerStoredRun = {
  result: {
    topStrategies: Array<{
      strategyId: string;
      equityCurve: Array<{ t: string; equity: number }>;
    }>;
  } | null;
};

function cardStyle() {
  return {
    background: "linear-gradient(180deg, rgba(10,9,7,0.96), rgba(6,6,5,0.94))",
    borderColor: "rgba(201, 170, 87, 0.28)",
    boxShadow: "0 22px 54px rgba(0,0,0,0.35), 0 0 36px rgba(201,170,87,0.08)",
  } as const;
}

function panelClass() {
  return "rounded-[24px] border border-white/10 bg-black/20 p-4";
}

function formatPct(value: number, digits = 2): string {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`;
}

function formatMetric(value: number, digits = 2): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "0.00";
}

function lightClasses(light: TrafficLight): string {
  if (light === "green") return "border-emerald-400/30 bg-emerald-400/12 text-emerald-200";
  if (light === "yellow") return "border-amber-300/30 bg-amber-300/10 text-amber-100";
  return "border-rose-400/30 bg-rose-400/10 text-rose-200";
}

function trendOrder(label: string): number {
  if (label === "Bull") return 0;
  if (label === "Sideways") return 1;
  return 2;
}

function volatilityOrder(label: string): number {
  if (label === "Low Vol") return 0;
  if (label === "Medium Vol") return 1;
  return 2;
}

function heatColor(cells: RegimeHeatmapCell[], value: number): string {
  const min = Math.min(...cells.map((cell) => cell.sharpe), 0);
  const max = Math.max(...cells.map((cell) => cell.sharpe), 1);
  const ratio = Math.max(0, Math.min(1, (value - min) / Math.max(1e-9, max - min)));
  const stops = [
    { at: 0, rgb: [37, 99, 235] },
    { at: 0.33, rgb: [16, 185, 129] },
    { at: 0.66, rgb: [250, 204, 21] },
    { at: 1, rgb: [239, 68, 68] },
  ];
  const upperIndex = stops.findIndex((stop) => ratio <= stop.at);
  const upper = stops[Math.max(1, upperIndex)];
  const lower = stops[Math.max(0, upperIndex - 1)];
  const span = Math.max(0.0001, upper.at - lower.at);
  const local = (ratio - lower.at) / span;
  const rgb = lower.rgb.map((channel, index) => Math.round(channel + ((upper.rgb[index] - channel) * local)));
  return `rgb(${rgb.join(",")})`;
}

function parseCsv(text: string): RegimeInputRow[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  return lines.slice(1)
    .map((line) => {
      const [date, equity] = line.split(",");
      return { date, equity: Number(equity) };
    })
    .filter((row) => row.date && Number.isFinite(row.equity));
}

function parseDataset(fileName: string, text: string): RegimeInputRow[] {
  if (fileName.toLowerCase().endsWith(".json")) {
    try {
      const parsed = JSON.parse(text) as Array<{ date?: string; equity?: number }> | { rows?: Array<{ date?: string; equity?: number }> };
      const rows = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.rows) ? parsed.rows : []);
      return rows
        .map((row) => ({ date: String(row.date || ""), equity: Number(row.equity) }))
        .filter((row) => row.date && Number.isFinite(row.equity));
    } catch {
      return [];
    }
  }
  return parseCsv(text);
}

export default function RegimesPage() {
  const [analysis, setAnalysis] = useState<RegimeAnalysisResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState("Loading demo dataset and running regime analysis.");
  const [error, setError] = useState<string | null>(null);
  const [latestOptimizerRunId, setLatestOptimizerRunId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadAnalysis = async (init?: RequestInit, message = "Running regime analysis.") => {
    setLoading(true);
    setError(null);
    setProgress(message);
    try {
      const response = await fetch("/api/regimes/analyze", { cache: "no-store", ...init });
      if (!response.ok) throw new Error(`Failed to load regime analysis (${response.status}).`);
      const payload = await response.json() as RegimeAnalysisResponse;
      setAnalysis(payload);
      setProgress("Analysis complete.");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unknown regime analysis error.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAnalysis(undefined, "Loading default demo dataset.");
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/optimizer/history", { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json() as { items?: OptimizerRunSummary[] };
        setLatestOptimizerRunId(payload.items?.[0]?.runId ?? null);
      } catch {
        // ignore optional optimizer history lookup
      }
    })();
  }, []);

  const timelineSegments = useMemo(() => {
    if (!analysis?.timeline.length) return [];
    const segments: Array<{ start: number; end: number; label: string; color: string }> = [];
    let start = analysis.timeline[0].index;
    let label = analysis.timeline[0].combinedRegime;
    for (let index = 1; index < analysis.timeline.length; index += 1) {
      const point = analysis.timeline[index];
      if (point.combinedRegime !== label) {
        segments.push({
          start,
          end: analysis.timeline[index - 1].index,
          label,
          color: label.includes("Bull") ? "rgba(16,185,129,0.08)" : label.includes("Bear") ? "rgba(239,68,68,0.08)" : "rgba(245,158,11,0.08)",
        });
        start = point.index;
        label = point.combinedRegime;
      }
    }
    segments.push({
      start,
      end: analysis.timeline[analysis.timeline.length - 1].index,
      label,
      color: label.includes("Bull") ? "rgba(16,185,129,0.08)" : label.includes("Bear") ? "rgba(239,68,68,0.08)" : "rgba(245,158,11,0.08)",
    });
    return segments;
  }, [analysis]);

  const heatmapRows = useMemo(() => {
    if (!analysis) return [];
    return [...analysis.heatmap].sort((left, right) => {
      const trendDiff = trendOrder(left.trend) - trendOrder(right.trend);
      return trendDiff !== 0 ? trendDiff : volatilityOrder(left.volatility) - volatilityOrder(right.volatility);
    });
  }, [analysis]);

  const onUploadClick = () => fileInputRef.current?.click();

  const onFileSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const rows = parseDataset(file.name, await file.text());
    if (!rows.length) {
      setError("Uploaded file could not be parsed. Expected CSV columns date,equity or a JSON array of { date, equity }.");
      return;
    }
    await loadAnalysis({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceType: "upload", sourceName: file.name, rows }),
    }, `Uploading ${file.name} and running regime analysis.`);
    event.target.value = "";
  };

  const loadProjectTrackRecord = async () => {
    setLoading(true);
    setError(null);
    setProgress("Loading project track record.");
    try {
      const response = await fetch("/api/track-record/trades", { cache: "no-store" });
      if (!response.ok) throw new Error("Track record API unavailable.");
      const payload = await response.json() as { model?: { strategyData?: Array<{ date: string; equity: number }> } };
      const rows = (payload.model?.strategyData ?? []).map((item) => ({ date: item.date, equity: item.equity }));
      await loadAnalysis({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceType: "track-record", sourceName: "Project Track Record", rows }),
      }, "Running regime analysis for the project track record.");
    } catch (loadError) {
      setLoading(false);
      setError(loadError instanceof Error ? loadError.message : "Failed to load project track record.");
    }
  };

  const loadLatestOptimizerStrategy = async () => {
    if (!latestOptimizerRunId) {
      setError("No optimizer runs available yet.");
      return;
    }
    setLoading(true);
    setError(null);
    setProgress("Loading latest optimizer strategy.");
    try {
      const response = await fetch(`/api/optimizer/history/${latestOptimizerRunId}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Optimizer run could not be loaded.");
      const payload = await response.json() as OptimizerStoredRun;
      const strategy = payload.result?.topStrategies?.[0];
      if (!strategy?.equityCurve?.length) {
        throw new Error("Selected optimizer run does not contain a usable equity curve.");
      }
      const rows = strategy.equityCurve.map((point) => ({ date: point.t, equity: point.equity }));
      await loadAnalysis({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceType: "optimizer",
          sourceName: `Optimizer ${latestOptimizerRunId.slice(0, 8)} / ${strategy.strategyId}`,
          rows,
        }),
      }, "Running regime analysis for the latest optimizer strategy.");
    } catch (loadError) {
      setLoading(false);
      setError(loadError instanceof Error ? loadError.message : "Failed to load optimizer strategy.");
    }
  };

  return (
    <main className="ivq-terminal-page relative min-h-screen pb-10">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-4 pt-6 sm:px-6 lg:px-8">
        <section className="rounded-[30px] border p-6 sm:p-8" style={cardStyle()}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-4xl">
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Research Module</div>
              <h1 className="mt-3 text-3xl font-semibold tracking-[0.04em] text-white sm:text-4xl">Regimes</h1>
              <p className="mt-3 text-base text-slate-300">Analyze strategies, portfolios, and track records across market regimes.</p>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">This page helps identify where a strategy works, where it fails, and which market conditions currently dominate.</p>
            </div>
            <div className="max-w-[440px] rounded-[24px] border border-amber-200/15 bg-white/[0.03] p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Default Mode</div>
              <div className="mt-3 rounded-[18px] border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">
                Demo dataset loaded – upload your own track record or load strategies to run custom analysis.
              </div>
              <div className="mt-3 text-sm text-slate-400">{progress}</div>
              {error ? <div className="mt-3 rounded-[18px] border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">{error}</div> : null}
            </div>
          </div>
        </section>

        <section className="rounded-[28px] border p-5" style={cardStyle()}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Input Source Selection</div>
              <div className="mt-2 text-sm text-slate-300">Replace the default dataset with an uploaded file, the project track record, a saved optimizer strategy, or a portfolio equity curve.</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void loadAnalysis(undefined, "Reloading default demo dataset.")} className="rounded-[14px] border border-white/10 bg-white/5 px-4 py-2 text-sm text-white"><RefreshCw className="mr-2 inline h-4 w-4" />Demo Dataset</button>
              <button type="button" onClick={onUploadClick} className="rounded-[14px] border border-amber-300/30 bg-amber-300/10 px-4 py-2 text-sm text-amber-100"><Upload className="mr-2 inline h-4 w-4" />Upload Track Record</button>
              <button type="button" onClick={() => void loadProjectTrackRecord()} className="rounded-[14px] border border-white/10 bg-white/5 px-4 py-2 text-sm text-white"><FolderOpen className="mr-2 inline h-4 w-4" />Load Project Track Record</button>
              <button type="button" onClick={() => void loadLatestOptimizerStrategy()} className="rounded-[14px] border border-white/10 bg-white/5 px-4 py-2 text-sm text-white"><Radar className="mr-2 inline h-4 w-4" />Load Optimizer Strategy</button>
              <button type="button" onClick={onUploadClick} className="rounded-[14px] border border-white/10 bg-white/5 px-4 py-2 text-sm text-white"><FileUp className="mr-2 inline h-4 w-4" />Load Portfolio</button>
              <input ref={fileInputRef} type="file" accept=".csv,.json,text/csv,application/json" className="hidden" onChange={onFileSelected} />
            </div>
          </div>
          {analysis ? (
            <div className="mt-5 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
              <div className={panelClass()}>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Source Summary</div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {[
                    ["Source", analysis.source.name],
                    ["Type", analysis.source.type],
                    ["Date Range", analysis.source.dateRange],
                    ["Points", String(analysis.source.trades)],
                    ["Market", analysis.source.market],
                    ["Status", analysis.source.status],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-[18px] border border-white/10 bg-white/[0.03] px-4 py-3">
                      <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{label}</div>
                      <div className="mt-2 text-sm text-white">{value}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className={panelClass()}>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Guidance</div>
                <div className="mt-3 rounded-[18px] border border-white/10 bg-black/25 px-4 py-4 text-sm leading-6 text-slate-300">
                  High Sharpe in only one regime may indicate a fragile strategy. A stable strategy should perform reasonably across several regimes, not only during one market condition.
                </div>
              </div>
            </div>
          ) : null}
        </section>

        {loading && !analysis ? (
          <section className="rounded-[28px] border p-8" style={cardStyle()}>
            <div className="grid min-h-[240px] place-items-center text-center">
              <div>
                <Loader2 className="mx-auto h-8 w-8 animate-spin text-amber-200" />
                <div className="mt-4 text-lg font-semibold text-white">Running default regime analysis</div>
                <div className="mt-2 text-sm text-slate-400">{progress}</div>
              </div>
            </div>
          </section>
        ) : null}

        {analysis ? (
          <>
            <section className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
              <div className="rounded-[28px] border p-5" style={cardStyle()}>
                <div className="flex items-center gap-3">
                  <Gauge className="h-5 w-5 text-amber-200" />
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Current Regime Summary</div>
                    <div className="mt-1 text-sm text-slate-300">What is the current market regime?</div>
                  </div>
                </div>
                <div className="mt-5 grid gap-3 md:grid-cols-3">
                  {analysis.currentSummary.map((card) => (
                    <div key={card.label} className={`rounded-[20px] border px-4 py-4 ${lightClasses(card.light)}`}>
                      <div className="text-[10px] uppercase tracking-[0.18em] opacity-80">{card.label}</div>
                      <div className="mt-2 text-lg font-semibold">{card.value}</div>
                      <div className="mt-2 text-sm opacity-85">{card.detail}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 rounded-[18px] border border-white/10 bg-black/20 px-4 py-4 text-sm leading-6 text-slate-300">{analysis.interpretation}</div>
              </div>

              <div className="rounded-[28px] border p-5" style={cardStyle()}>
                <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Equity Curve</div>
                <div className="mt-2 text-sm text-slate-300">Full track record equity from the active dataset.</div>
                <div className="mt-4 h-[320px] rounded-[20px] border border-white/10 bg-black/20 p-3">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={analysis.equityCurve} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                      <XAxis dataKey="date" tickFormatter={(value) => String(value).slice(0, 7)} tick={{ fill: "#94a3b8", fontSize: 11 }} minTickGap={24} />
                      <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} />
                      <Tooltip contentStyle={{ background: "#05070d", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 14 }} />
                      <Line type="monotone" dataKey="equity" stroke="#f8fafc" strokeWidth={2.4} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </section>

            <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
              <div className="rounded-[28px] border p-5" style={cardStyle()}>
                <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Regime Timeline</div>
                <div className="mt-2 text-sm text-slate-300">Equity curve with colored background blocks for regime changes over time.</div>
                <div className="mt-4 h-[360px] rounded-[20px] border border-white/10 bg-black/20 p-3">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={analysis.timeline} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="regime-equity-fill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#fde68a" stopOpacity={0.45} />
                          <stop offset="100%" stopColor="#fde68a" stopOpacity={0.03} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                      {timelineSegments.map((segment) => (
                        <ReferenceArea key={`${segment.start}-${segment.end}`} x1={segment.start} x2={segment.end} fill={segment.color} fillOpacity={1} strokeOpacity={0} />
                      ))}
                      <XAxis dataKey="index" tickFormatter={(value) => String(analysis.timeline[Math.min(Number(value), analysis.timeline.length - 1)]?.date ?? "").slice(0, 7)} tick={{ fill: "#94a3b8", fontSize: 11 }} minTickGap={26} />
                      <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} />
                      <Tooltip
                        contentStyle={{ background: "#05070d", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 14 }}
                        labelFormatter={(value) => {
                          const point = analysis.timeline[Math.min(Number(value), analysis.timeline.length - 1)];
                          return `${point?.date.slice(0, 10)} | ${point?.combinedRegime}`;
                        }}
                      />
                      <Area type="monotone" dataKey="equity" stroke="#f8fafc" fill="url(#regime-equity-fill)" strokeWidth={2.4} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="rounded-[28px] border p-5" style={cardStyle()}>
                <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Regime Performance Table</div>
                <div className="mt-2 text-sm text-slate-300">Regime dependence matters because strong headline returns can hide weakness in stressed or unfavorable conditions.</div>
                <div className="mt-4 overflow-hidden rounded-[20px] border border-white/10">
                  <div className="grid grid-cols-[1.4fr_0.8fr_0.8fr_0.8fr_0.7fr] gap-3 border-b border-white/10 bg-black/25 px-4 py-3 text-[10px] uppercase tracking-[0.18em] text-slate-500">
                    <div>Regime</div>
                    <div>Return</div>
                    <div>Sharpe</div>
                    <div>Max DD</div>
                    <div>Count</div>
                  </div>
                  <div className="max-h-[320px] overflow-y-auto">
                    {analysis.regimeTable.map((row) => (
                      <div key={row.regime} className="grid grid-cols-[1.4fr_0.8fr_0.8fr_0.8fr_0.7fr] gap-3 border-b border-white/5 px-4 py-3 text-sm">
                        <div className="text-white">{row.regime}</div>
                        <div className={row.returnPct >= 0 ? "text-emerald-300" : "text-rose-300"}>{formatPct(row.returnPct)}</div>
                        <div className="text-slate-100">{formatMetric(row.sharpe)}</div>
                        <div className="text-rose-300">{formatPct(row.maxDrawdown)}</div>
                        <div className="text-slate-300">{row.tradeCount}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            <section className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
              <div className="rounded-[28px] border p-5" style={cardStyle()}>
                <div className="flex items-center gap-3">
                  <Radar className="h-5 w-5 text-amber-200" />
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Regime Heatmap</div>
                    <div className="mt-1 text-sm text-slate-300">Trend vs Volatility. Color represents Sharpe.</div>
                  </div>
                </div>
                <div className="mt-4 rounded-[20px] border border-slate-200 bg-white p-4 text-slate-900">
                  <div className="mb-3 h-3 rounded-full bg-[linear-gradient(90deg,#2563eb_0%,#10b981_35%,#facc15_68%,#ef4444_100%)]" />
                  <div className="mb-4 flex items-center justify-between text-[11px] text-slate-500">
                    <span>Low Sharpe</span>
                    <span>Sharpe legend</span>
                    <span>High Sharpe</span>
                  </div>
                  <div className="grid gap-2" style={{ gridTemplateColumns: "112px repeat(3, minmax(86px, 1fr))" }}>
                    <div />
                    {["Low Vol", "Medium Vol", "High Vol"].map((label) => (
                      <div key={label} className="text-center text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</div>
                    ))}
                    {["Bull", "Sideways", "Bear"].map((trend) => (
                      <div key={trend} className="contents">
                        <div className="flex items-center text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{trend}</div>
                        {["Low Vol", "Medium Vol", "High Vol"].map((volatility) => {
                          const cell = heatmapRows.find((item) => item.trend === trend && item.volatility === volatility);
                          return (
                            <div
                              key={`${trend}-${volatility}`}
                              title={cell ? `${trend} / ${volatility}: Sharpe ${formatMetric(cell.sharpe)}, Return ${formatPct(cell.returnPct)}, DD ${formatPct(cell.maxDrawdown)}` : "No data"}
                              className="flex h-[74px] flex-col items-center justify-center rounded-[16px] border border-slate-200 px-2 text-center"
                              style={{ background: heatColor(heatmapRows, cell?.sharpe ?? 0), color: "#0f172a" }}
                            >
                              <div className="text-sm font-semibold">{formatMetric(cell?.sharpe ?? 0)}</div>
                              <div className="text-[10px] uppercase tracking-[0.12em]">{cell?.tradeCount ?? 0} pts</div>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded-[28px] border p-5" style={cardStyle()}>
                <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Help Text</div>
                <div className="mt-2 text-sm text-slate-300">The page opens with a real demo dataset so you can immediately inspect regime behavior before loading custom inputs.</div>
                <div className="mt-4 grid gap-3">
                  {[
                    "High Sharpe in only one regime may indicate a fragile strategy.",
                    "A stable strategy should perform reasonably across several regimes, not only during one market condition.",
                    "Use the current regime panel to understand which strategy family may be favored today.",
                    "Upload your own equity curve or import an optimizer strategy to replace the demo analysis.",
                  ].map((item) => (
                    <div key={item} className="rounded-[18px] border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-300">{item}</div>
                  ))}
                </div>
              </div>
            </section>
          </>
        ) : null}

        {loading && analysis ? (
          <div className="fixed bottom-6 right-6 z-20 rounded-[18px] border border-amber-300/20 bg-black/85 px-4 py-3 text-sm text-amber-100 shadow-[0_16px_40px_rgba(0,0,0,0.35)]">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
            {progress}
          </div>
        ) : null}
      </div>
    </main>
  );
}
