"use client";

import { Info } from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { getMonteCarloPalette } from "@/components/monte-carlo/theme";
import type { MonteCarloTheme, VolatilityPoint } from "@/components/monte-carlo/types";

type Props = {
  theme: MonteCarloTheme;
  volatilitySeries: VolatilityPoint[];
  animationProgress: number;
};

export default function VolatilityChart({ theme, volatilitySeries, animationProgress }: Props) {
  const palette = getMonteCarloPalette(theme);
  const visibleSeries = volatilitySeries.slice(0, Math.max(2, Math.round(volatilitySeries.length * Math.max(0.05, animationProgress))));

  return (
    <section className="glass-panel rounded-[24px] border p-4 min-[769px]:p-5" style={{ background: palette.panelBackground, borderColor: palette.border, boxShadow: `0 18px 44px rgba(0,0,0,0.30), 0 0 28px ${palette.glow}` }}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="ivq-section-label">Volatility Model (GARCH)</div>
          <h2 className="text-lg font-semibold" style={{ color: palette.heading }}>
            Time-varying volatility clustering
          </h2>
        </div>
        <span className="inline-flex items-center gap-2 text-[11px]" style={{ color: palette.muted }} title="Conditional volatility process used to estimate clustering and persistence in market variance.">
          <Info size={13} /> GARCH
        </span>
      </div>

      <div className="h-[290px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={visibleSeries} margin={{ top: 10, right: 10, bottom: 6, left: 0 }}>
            <CartesianGrid stroke={palette.chartGrid} vertical={false} />
            <XAxis dataKey="date" tick={{ fill: palette.muted, fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={40} />
            <YAxis tick={{ fill: palette.muted, fontSize: 10 }} tickFormatter={(value) => `${(value * 100).toFixed(0)}%`} tickLine={false} axisLine={false} width={48} />
            <Tooltip
              contentStyle={{ borderRadius: 12, border: `1px solid ${palette.border}`, background: theme === "dark" ? "rgba(11,9,7,0.95)" : "rgba(9,18,38,0.95)" }}
              labelStyle={{ color: palette.heading }}
            />
            <Legend />
            <Line type="monotone" dataKey="realized" stroke={palette.accentSoft} strokeWidth={1.8} dot={false} name="Realized" isAnimationActive={false} />
            <Line type="monotone" dataKey="garch" stroke={palette.accent} strokeWidth={2.3} dot={false} name="GARCH" isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
