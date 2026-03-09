"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { getMonteCarloPalette } from "@/components/monte-carlo/theme";
import type { HistogramBin, MonteCarloTheme, PortfolioAllocation, SimulationPathPoint } from "@/components/monte-carlo/types";

type Props = {
  theme: MonteCarloTheme;
  pathSeries: SimulationPathPoint[];
  allocations: PortfolioAllocation[];
  returnHistogram: HistogramBin[];
  drawdownHistogram: HistogramBin[];
  animationProgress: number;
};

function visiblePathSeries(pathSeries: SimulationPathPoint[], progress: number): SimulationPathPoint[] {
  const visible = Math.max(2, Math.round(pathSeries.length * Math.max(progress, 0.06)));
  return pathSeries.slice(0, visible);
}

function visibleHistogram(histogram: HistogramBin[], progress: number): HistogramBin[] {
  const visible = Math.max(2, Math.round(histogram.length * Math.max(progress, 0.12)));
  return histogram.slice(0, visible);
}

export default function PortfolioSimulationPanel({ theme, pathSeries, allocations, returnHistogram, drawdownHistogram, animationProgress }: Props) {
  const palette = getMonteCarloPalette(theme);

  return (
    <section className="glass-panel rounded-[24px] border p-4 min-[769px]:p-5" style={{ background: palette.panelBackground, borderColor: palette.border, boxShadow: `0 18px 44px rgba(0,0,0,0.30), 0 0 28px ${palette.glow}` }}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="ivq-section-label">Portfolio Monte Carlo</div>
          <h2 className="text-lg font-semibold" style={{ color: palette.heading }}>
            Korrelierte Multi-Asset-Simulation
          </h2>
        </div>
        <div className="rounded-full border px-3 py-1 text-[11px]" style={{ borderColor: palette.border, color: palette.muted }}>
          Probability cone
        </div>
      </div>

      <div className="mb-4 grid gap-3 min-[769px]:grid-cols-3">
        {allocations.map((allocation) => (
          <div key={allocation.label} className="rounded-[16px] border p-3" style={{ borderColor: palette.border, background: palette.panelBackgroundSoft }}>
            <div className="text-[10px] uppercase tracking-[0.16em]" style={{ color: palette.muted }}>
              {allocation.label}
            </div>
            <div className="mt-1 text-[20px] font-semibold" style={{ color: palette.heading }}>
              {(allocation.weight * 100).toFixed(0)}%
            </div>
            <div className="mt-2 text-[11px]" style={{ color: palette.muted }}>
              Return {(allocation.expectedReturn * 100).toFixed(1)}% | Vol {(allocation.volatility * 100).toFixed(1)}%
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 min-[769px]:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
        <div className="h-[300px] rounded-[18px] border p-3" style={{ borderColor: palette.border, background: palette.panelBackgroundSoft }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={visiblePathSeries(pathSeries, animationProgress)} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={`portfolioCone-${theme}`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={palette.accent} stopOpacity={0.34} />
                  <stop offset="100%" stopColor={palette.accent} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={palette.chartGrid} vertical={false} />
              <XAxis dataKey="label" tick={{ fill: palette.muted, fontSize: 11 }} minTickGap={28} tickLine={false} axisLine={false} />
              <YAxis tick={{ fill: palette.muted, fontSize: 11 }} tickLine={false} axisLine={false} width={42} />
              <Tooltip contentStyle={{ background: theme === "dark" ? "#0d0b08" : "#071427", border: `1px solid ${palette.border}`, borderRadius: 14, color: palette.text }} />
              <Area type="monotone" dataKey="p95" stroke="none" fill={`url(#portfolioCone-${theme})`} />
              <Area type="monotone" dataKey="p05" stroke="none" fill={theme === "dark" ? "rgba(8,7,6,0.94)" : "rgba(5,12,24,0.94)"} />
              <Area type="monotone" dataKey="median" stroke={palette.accentStrong} fill="none" strokeWidth={2.4} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="grid gap-4">
          <div className="h-[142px] rounded-[18px] border p-3" style={{ borderColor: palette.border, background: palette.panelBackgroundSoft }}>
            <div className="mb-2 text-[11px] uppercase tracking-[0.16em]" style={{ color: palette.muted }}>
              Portfolio Return Distribution
            </div>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={visibleHistogram(returnHistogram, animationProgress)} margin={{ top: 6, right: 0, left: -20, bottom: 0 }}>
                <Bar dataKey="count" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                  {visibleHistogram(returnHistogram, animationProgress).map((entry) => (
                    <Cell key={`${entry.label}-return`} fill={entry.midpoint >= 0 ? palette.accent : palette.negative} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="h-[142px] rounded-[18px] border p-3" style={{ borderColor: palette.border, background: palette.panelBackgroundSoft }}>
            <div className="mb-2 text-[11px] uppercase tracking-[0.16em]" style={{ color: palette.muted }}>
              Portfolio Drawdown Distribution
            </div>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={visibleHistogram(drawdownHistogram, animationProgress)} margin={{ top: 6, right: 0, left: -20, bottom: 0 }}>
                <Bar dataKey="count" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                  {visibleHistogram(drawdownHistogram, animationProgress).map((entry) => (
                    <Cell key={`${entry.label}-drawdown`} fill={palette.negative} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </section>
  );
}
