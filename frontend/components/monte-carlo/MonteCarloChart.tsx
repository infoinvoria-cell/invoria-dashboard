"use client";

import { Info } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { getMonteCarloPalette } from "@/components/monte-carlo/theme";
import type { MonteCarloTheme, SimulationPathPoint } from "@/components/monte-carlo/types";

type Props = {
  theme: MonteCarloTheme;
  pathSeries: SimulationPathPoint[];
};

export default function MonteCarloChart({ theme, pathSeries }: Props) {
  const palette = getMonteCarloPalette(theme);
  const chartData = pathSeries.map((point) => ({
    ...point,
    sample1: point.samples[0],
    sample2: point.samples[1],
    sample3: point.samples[2],
  }));

  return (
    <section className="glass-panel h-full min-h-[360px] rounded-[24px] border p-4 min-[769px]:p-5" style={{ background: palette.panelBackground, borderColor: palette.border, boxShadow: `0 18px 44px rgba(0,0,0,0.30), 0 0 30px ${palette.glow}` }}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="ivq-section-label">Monte Carlo Simulation Paths</div>
          <h2 className="text-lg font-semibold" style={{ color: palette.heading }}>
            GBM fan chart with regime-aware path simulation
          </h2>
        </div>
        <span className="inline-flex items-center gap-2 text-[11px]" style={{ color: palette.muted }} title="Standard stochastic process used to model asset price dynamics assuming log-normal returns.">
          <Info size={13} /> GBM
        </span>
      </div>

      <div className="grid h-[320px] gap-3 min-[769px]:grid-cols-[minmax(0,1.65fr)_minmax(200px,0.72fr)]">
        <div className="h-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 12, right: 12, bottom: 6, left: 0 }}>
              <defs>
                <linearGradient id="ivqMonteBand" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={palette.accent} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={palette.accent} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={palette.chartGrid} vertical={false} />
              <XAxis dataKey="label" tick={{ fill: palette.muted, fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={36} />
              <YAxis tick={{ fill: palette.muted, fontSize: 11 }} tickLine={false} axisLine={false} width={56} />
              <Tooltip
                cursor={{ stroke: palette.accent, strokeOpacity: 0.2 }}
                contentStyle={{ borderRadius: 12, border: `1px solid ${palette.border}`, background: theme === "dark" ? "rgba(11,9,7,0.95)" : "rgba(9,18,38,0.95)" }}
                labelStyle={{ color: palette.heading }}
              />
              <Area type="monotone" dataKey="p95" stroke="none" fill="url(#ivqMonteBand)" />
              <Area type="monotone" dataKey="p05" stroke="none" fill={theme === "dark" ? "rgba(4,4,4,0.96)" : "rgba(4,8,20,0.96)"} />
              <Line type="monotone" dataKey="median" stroke={palette.accentStrong} strokeWidth={2.4} dot={false} />
              <Line type="monotone" dataKey="mean" stroke={palette.accent} strokeWidth={1.4} strokeDasharray="4 4" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="h-full rounded-[18px] border p-3" style={{ borderColor: palette.border, background: palette.panelBackgroundSoft }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 4, bottom: 8, left: 4 }}>
              <CartesianGrid stroke={palette.chartGrid} vertical={false} />
              <XAxis dataKey="label" hide />
              <YAxis hide />
              <Line type="monotone" dataKey="sample1" stroke={palette.accentSoft} strokeWidth={1.4} dot={false} />
              <Line type="monotone" dataKey="sample2" stroke={palette.accent} strokeWidth={1.2} dot={false} />
              <Line type="monotone" dataKey="sample3" stroke={palette.negative} strokeWidth={1.1} dot={false} opacity={0.75} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
}
