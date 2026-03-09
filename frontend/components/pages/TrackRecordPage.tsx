"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";
import { BarChart3 } from "lucide-react";

import SimpleLineChart from "@/components/charts/SimpleLineChart";
import { GlobeApi } from "@/lib/api";
import type { TrackRecordCurve, TrackRecordResponse } from "@/types";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDecimalPct(value: number): string {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

function formatPercentValue(value: number): string {
  return `${value.toFixed(1)}%`;
}

function formatCurrency(value: number): string {
  return `EUR ${value.toFixed(2)}`;
}

function cellTone(value: number | null): string {
  if (value == null) return "text-slate-500";
  if (value > 0) return "text-emerald-300";
  if (value < 0) return "text-rose-300";
  return "text-slate-300";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function annualStatus(value: number): string {
  if (value >= 0.2) return "Very strong";
  if (value >= 0.12) return "Strong";
  if (value >= 0.05) return "Positive";
  if (value >= 0) return "Stable";
  return "Negative";
}

type DonutSegment = {
  value: number;
  color: string;
};

function DonutGauge({
  segments,
  centerValue,
  centerLabel,
}: {
  segments: DonutSegment[];
  centerValue: string;
  centerLabel: string;
}) {
  const radius = 27;
  const strokeWidth = 9;
  const circumference = 2 * Math.PI * radius;
  const total = Math.max(
    1,
    segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0),
  );
  let offset = 0;

  return (
    <svg viewBox="0 0 84 84" className="h-full w-full overflow-visible">
      <circle cx="42" cy="36" r={radius} fill="none" stroke="rgba(51,65,85,0.45)" strokeWidth={strokeWidth} />
      {segments.map((segment, index) => {
        const normalized = Math.max(0, segment.value);
        const dash = (normalized / total) * circumference;
        const currentOffset = offset;
        offset += dash;
        return (
          <circle
            key={`${segment.color}-${index}`}
            cx="42"
            cy="36"
            r={radius}
            fill="none"
            stroke={segment.color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference - dash}`}
            strokeDashoffset={-currentOffset}
            transform="rotate(-90 42 36)"
          />
        );
      })}
      <circle cx="42" cy="36" r="17" fill="rgba(7,10,15,0.92)" />
      <text x="42" y="33" textAnchor="middle" fontSize="11" fontWeight="800" fill="#f8fafc">
        {centerValue}
      </text>
      <text x="42" y="45" textAnchor="middle" fontSize="5.6" fontWeight="700" fill="#94a3b8">
        {centerLabel}
      </text>
    </svg>
  );
}

function MetricCard({
  title,
  value,
  children,
}: {
  title: string;
  value: string;
  children: ReactNode;
}) {
  return (
    <article className="relative flex min-h-[182px] flex-col overflow-hidden rounded-[20px] border border-[#20304a] bg-[rgba(7,12,22,0.88)] p-[18px] shadow-[0_18px_40px_rgba(0,0,0,0.28)]">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.06),transparent_34%),radial-gradient(280px_120px_at_85%_0%,rgba(231,208,122,0.14),transparent_60%)]" />
      <div className="pointer-events-none absolute inset-x-5 top-0 h-px bg-[rgba(231,208,122,0.16)]" />
      <div className="relative z-[1] mb-2">
        <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#d8c78d]">{title}</div>
        <div className="mt-2 text-[22px] font-semibold leading-none text-slate-100">{value}</div>
      </div>
      <div className="relative z-[1] flex min-h-0 flex-1 flex-col">{children}</div>
    </article>
  );
}

export default function TrackRecordPage() {
  const [payload, setPayload] = useState<TrackRecordResponse | null>(null);
  const [selectedCurveId, setSelectedCurveId] = useState("1x");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    GlobeApi.getTrackRecord()
      .then((response) => {
        if (cancelled) return;
        setPayload(response);
        setSelectedCurveId(response.curves[0]?.id ?? "1x");
      })
      .catch(() => {
        if (!cancelled) setPayload(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedCurve = useMemo<TrackRecordCurve | null>(
    () => payload?.curves.find((curve) => curve.id === selectedCurveId) ?? payload?.curves[0] ?? null,
    [payload?.curves, selectedCurveId],
  );

  const chartPoints = useMemo(
    () => (selectedCurve?.points ?? []).map((point) => ({ t: point.t, value: point.value })),
    [selectedCurve?.points],
  );

  const recentMonths = useMemo(
    () => [...(payload?.monthlyReturns ?? [])].slice(-18).reverse(),
    [payload?.monthlyReturns],
  );

  const annualAverageReturn = payload?.metrics.annualAverageReturn ?? 0;
  const annualAverageFillPct = clamp((Math.abs(annualAverageReturn) / 0.3) * 100, 0, 100);
  const bestAnnualReturn = useMemo(
    () =>
      Math.max(
        Number.NEGATIVE_INFINITY,
        ...(payload?.performanceTable ?? []).map((row) => (row.total == null ? Number.NEGATIVE_INFINITY : row.total)),
      ),
    [payload?.performanceTable],
  );

  const winningTrades = payload?.metrics.winningTrades ?? 0;
  const losingTrades = payload?.metrics.losingTrades ?? 0;
  const longTrades = payload?.metrics.longTrades ?? 0;
  const shortTrades = payload?.metrics.shortTrades ?? 0;
  const longShortRatio = shortTrades > 0 ? longTrades / shortTrades : 0;

  return (
    <main className="ivq-terminal-page">
      <section className="glass-panel ivq-terminal-hero">
        <div>
          <div className="ivq-section-label">Track Record</div>
          <h1 className="ivq-terminal-title">Live performance, KPI diagnostics and yearly return matrix</h1>
          <p className="ivq-terminal-subtitle">
            Root dashboard view with the KPI cards fixed for full visibility and the right-side performance diagnostics aligned from the top.
          </p>
        </div>
        <div className="ivq-terminal-hero-meta">
          <div className="ivq-terminal-pill">
            {payload?.updatedAt ? `Updated ${new Date(payload.updatedAt).toLocaleString("de-DE")}` : "Waiting for data"}
          </div>
        </div>
      </section>

      <section className="glass-panel">
        <div className="ivq-section-label">Overview</div>
        <div className="ivq-stat-grid">
          <div className="ivq-stat-card">
            <span className="ivq-stat-label">Final Equity</span>
            <strong>{payload ? formatCurrency(payload.metrics.finalEquity) : "--"}</strong>
          </div>
          <div className="ivq-stat-card">
            <span className="ivq-stat-label">Total Return</span>
            <strong className={cellTone((payload?.metrics.totalReturnPct ?? 0) * 100)}>
              {payload ? formatDecimalPct(payload.metrics.totalReturnPct) : "--"}
            </strong>
          </div>
          <div className="ivq-stat-card">
            <span className="ivq-stat-label">Max Drawdown</span>
            <strong className="text-rose-300">{payload ? formatDecimalPct(payload.metrics.maxDrawdown) : "--"}</strong>
          </div>
          <div className="ivq-stat-card">
            <span className="ivq-stat-label">Sharpe</span>
            <strong>{payload?.metrics.sharpeRatio?.toFixed(2) ?? "--"}</strong>
          </div>
          <div className="ivq-stat-card">
            <span className="ivq-stat-label">Calmar</span>
            <strong>{payload?.metrics.calmarRatio?.toFixed(2) ?? "--"}</strong>
          </div>
        </div>
      </section>

      <div className="ivq-terminal-grid ivq-terminal-grid--track xl:items-start">
        <section className="glass-panel">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="ivq-section-label">Equity Curve</div>
              <div className="text-lg font-semibold text-slate-100">{selectedCurve?.label ?? "Curve"}</div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {(payload?.curves ?? []).map((curve) => (
                <button
                  key={curve.id}
                  type="button"
                  className={`ivq-segment-btn ${curve.id === selectedCurve?.id ? "is-active" : ""}`}
                  onClick={() => setSelectedCurveId(curve.id)}
                >
                  {curve.label}
                </button>
              ))}
            </div>
          </div>
          <div className="h-[440px]">
            {loading ? (
              <div className="grid h-full place-items-center text-sm text-slate-400">Loading performance curve...</div>
            ) : (
              <SimpleLineChart
                points={chartPoints}
                tone="#e7d07a"
                fillTone="rgba(231,208,122,0.16)"
                valueFormatter={(value) => `EUR ${value.toFixed(0)}`}
              />
            )}
          </div>
        </section>

        <aside className="grid gap-4 xl:self-start">
          <div className="grid grid-cols-1 gap-3 min-[820px]:grid-cols-2">
            <MetricCard title="Annual Avg Return" value={payload ? formatDecimalPct(annualAverageReturn) : "--"}>
              <div className="grid min-h-[116px] grid-cols-[minmax(0,1fr)_92px] items-start gap-3">
                <div className="min-w-0 space-y-2 pt-1">
                  <div className="text-[10px] leading-4 text-slate-400">
                    Compounded yearly average across the realized calendar years.
                  </div>
                  <div className="inline-flex rounded-full border border-[#5a4d25] bg-[rgba(231,208,122,0.10)] px-2 py-0.5 text-[8px] font-semibold uppercase tracking-[0.14em] text-[#f6e8bf]">
                    {annualStatus(annualAverageReturn)}
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[9px] leading-[1.2] text-slate-400">
                    <span>Best year</span>
                    <span className="text-slate-100">
                      {Number.isFinite(bestAnnualReturn) ? formatPercentValue(bestAnnualReturn) : "--"}
                    </span>
                    <span>Scale</span>
                    <span className="text-slate-100">0 to 30%</span>
                  </div>
                </div>
                <div className="flex min-h-[116px] items-start justify-end">
                  <div className="grid grid-cols-[auto_28px] items-start gap-2">
                    <div className="flex h-[108px] flex-col items-end justify-between pb-0.5 text-[9px] font-semibold text-slate-400">
                      <span>30%</span>
                      <span>15%</span>
                      <span>0%</span>
                    </div>
                    <div className="relative h-[108px] w-[28px] overflow-hidden rounded-full border border-[#22324d] bg-[rgba(255,255,255,0.04)]">
                      <div className="absolute inset-x-[4px] bottom-[35px] border-t border-dashed border-[rgba(231,208,122,0.24)]" />
                      <div
                        className="absolute inset-x-[4px] bottom-0 rounded-full"
                        style={{
                          height: `${annualAverageFillPct}%`,
                          background: annualAverageReturn >= 0
                            ? "linear-gradient(180deg, rgba(255,244,214,0.94) 0%, rgba(214,195,143,0.94) 42%, rgba(168,138,98,0.96) 100%)"
                            : "linear-gradient(180deg, rgba(255,170,170,0.92) 0%, rgba(224,86,86,0.96) 100%)",
                          boxShadow: annualAverageReturn >= 0 ? "0 0 18px rgba(214,195,143,0.28)" : "0 0 16px rgba(224,86,86,0.24)",
                        }}
                      />
                      <div
                        className="absolute left-1/2 top-2 -translate-x-1/2 rounded-full px-1.5 py-0.5 text-[8px] font-bold"
                        style={{
                          background: annualAverageReturn >= 0 ? "rgba(231,208,122,0.14)" : "rgba(248,113,113,0.14)",
                          color: annualAverageReturn >= 0 ? "#f6e8bf" : "#fecaca",
                        }}
                      >
                        {formatPercentValue(annualAverageReturn * 100)}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </MetricCard>

            <MetricCard title="Win Rate" value={payload ? formatPercentValue(payload.metrics.winRate * 100) : "--"}>
              <div className="grid min-h-[104px] grid-cols-[minmax(0,1fr)_80px] items-start gap-3 pt-1">
                <div className="min-w-0 space-y-1.5 text-[10px] leading-[1.2] text-slate-400">
                  <div>{winningTrades} winning trades</div>
                  <div>{losingTrades} losing trades</div>
                  <div className="pt-0.5 text-[9px] leading-[1.15] text-slate-100">
                    Strike rate {formatPercentValue((payload?.metrics.winRate ?? 0) * 100)}
                  </div>
                </div>
                <div className="h-[76px] w-[76px] justify-self-end self-start">
                  <DonutGauge
                    segments={[
                      { value: winningTrades, color: "#d6c38f" },
                      { value: losingTrades, color: "#334155" },
                    ]}
                    centerValue={payload ? formatPercentValue(payload.metrics.winRate * 100) : "--"}
                    centerLabel="Win"
                  />
                </div>
              </div>
            </MetricCard>

            <MetricCard title="Trades" value={String(payload?.metrics.trades ?? "--")}>
              <div className="grid min-h-[108px] grid-cols-[minmax(0,1fr)_80px] items-start gap-3 pt-1">
                <div className="min-w-0 space-y-0.5 text-[9px] leading-[1.08] text-slate-400">
                  {(payload?.tradesByYear ?? []).map((entry) => (
                    <div key={entry.year} className="grid grid-cols-[auto_1fr] items-baseline gap-x-2">
                      <span>{entry.year}</span>
                      <span className="justify-self-end font-semibold leading-none text-slate-100">{entry.count}</span>
                    </div>
                  ))}
                  <div className="pt-1 text-[9px] leading-[1.08]">
                    {winningTrades} winners / {losingTrades} losers
                  </div>
                </div>
                <div className="h-[76px] w-[76px] justify-self-end self-start">
                  <DonutGauge
                    segments={[
                      { value: winningTrades, color: "#d6c38f" },
                      { value: Math.max(0, payload?.metrics.trades ?? 0) - winningTrades, color: "#334155" },
                    ]}
                    centerValue={String(payload?.metrics.trades ?? "--")}
                    centerLabel="Trades"
                  />
                </div>
              </div>
            </MetricCard>

            <MetricCard title="Long / Short Ratio" value={`${longTrades} / ${shortTrades}`}>
              <div className="grid min-h-[104px] grid-cols-[minmax(0,1fr)_80px] items-start gap-3 pt-1">
                <div className="min-w-0 space-y-1 text-[10px] leading-[1.15]">
                  <div className="text-slate-300">
                    Long <span className="text-[#d6c38f]">{longTrades}</span>
                  </div>
                  <div className="text-slate-300">
                    Short <span className="text-[#b9ccff]">{shortTrades}</span>
                  </div>
                  <div className="pt-0.5 text-[9px] leading-[1.15] text-slate-400">
                    Ratio {Number.isFinite(longShortRatio) ? `${longShortRatio.toFixed(2)}x` : "--"}
                  </div>
                </div>
                <div className="h-[76px] w-[76px] justify-self-end self-start">
                  <DonutGauge
                    segments={[
                      { value: longTrades, color: "#d6c38f" },
                      { value: shortTrades, color: "#b9ccff" },
                    ]}
                    centerValue={`${longTrades}/${shortTrades}`}
                    centerLabel="L / S"
                  />
                </div>
              </div>
            </MetricCard>
          </div>

          <section className="glass-panel">
            <div className="mb-3 flex items-center gap-2">
              <BarChart3 size={14} className="text-slate-300" />
              <div className="ivq-section-label mb-0">Recent Months</div>
            </div>
            <div className="space-y-2">
              {recentMonths.map((row) => (
                <div key={`${row.year}-${row.month}`} className="ivq-list-row is-static">
                  <div>
                    <div className="text-sm font-semibold text-slate-100">
                      {MONTH_LABELS[row.month - 1]} {row.year}
                    </div>
                    <div className="text-[11px] text-slate-400">Monthly return</div>
                  </div>
                  <div className={`text-sm font-semibold ${cellTone(row.monthReturn * 100)}`}>
                    {formatDecimalPct(row.monthReturn)}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="glass-panel">
            <div className="ivq-section-label">Curve Snapshot</div>
            <div className="space-y-2">
              {(selectedCurve?.points ?? []).slice(-6).reverse().map((point) => (
                <div key={`${selectedCurve?.id}-${point.t}`} className="ivq-list-row is-static">
                  <div>
                    <div className="text-sm font-semibold text-slate-100">{new Date(point.t).toLocaleDateString("de-DE")}</div>
                    <div className="text-[11px] text-slate-400">{point.symbol ?? selectedCurve?.label}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold text-slate-100">{formatCurrency(point.value)}</div>
                    <div className={`text-[11px] ${cellTone((point.returnPct ?? 0) * 100)}`}>
                      {point.returnPct == null ? "--" : formatDecimalPct(point.returnPct)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>

      <div className="ivq-terminal-grid ivq-terminal-grid--track-bottom">
        <section className="glass-panel">
          <div className="ivq-section-label">Yearly Performance Table</div>
          <div className="ivq-data-table-wrap">
            <table className="ivq-data-table">
              <thead>
                <tr>
                  <th>Year</th>
                  {MONTH_LABELS.map((month) => <th key={month}>{month}</th>)}
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {(payload?.performanceTable ?? []).map((row) => (
                  <tr key={row.year}>
                    <td className="font-semibold text-slate-100">{row.year}</td>
                    {MONTH_LABELS.map((month) => (
                      <td key={`${row.year}-${month}`} className={cellTone(row.months[month])}>
                        {row.months[month] == null ? "-" : formatDecimalPct(row.months[month] ?? 0)}
                      </td>
                    ))}
                    <td className={cellTone(row.total)}>{row.total == null ? "-" : formatDecimalPct(row.total ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
