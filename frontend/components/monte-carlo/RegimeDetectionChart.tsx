"use client";

import { Info } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { getMonteCarloPalette } from "@/components/monte-carlo/theme";
import type { MonteCarloTheme, RegimePoint } from "@/components/monte-carlo/types";

type Props = {
  theme: MonteCarloTheme;
  regimeSeries: RegimePoint[];
  animationProgress: number;
};

export default function RegimeDetectionChart({ theme, regimeSeries, animationProgress }: Props) {
  const palette = getMonteCarloPalette(theme);
  const visibleSeries = regimeSeries.slice(0, Math.max(2, Math.round(regimeSeries.length * Math.max(0.05, animationProgress))));

  return (
    <section className="glass-panel rounded-[24px] border p-4 min-[769px]:p-5" style={{ background: palette.panelBackground, borderColor: palette.border, boxShadow: `0 18px 44px rgba(0,0,0,0.30), 0 0 28px ${palette.glow}` }}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="ivq-section-label">Regime Detection (HMM)</div>
          <h2 className="text-lg font-semibold" style={{ color: palette.heading }}>
            Hidden market regime probabilities
          </h2>
        </div>
        <span className="inline-flex items-center gap-2 text-[11px]" style={{ color: palette.muted }} title="Statistical model detecting hidden market regimes.">
          <Info size={13} /> HMM
        </span>
      </div>

      <div className="h-[290px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={visibleSeries} margin={{ top: 10, right: 10, bottom: 6, left: 0 }}>
            <CartesianGrid stroke={palette.chartGrid} vertical={false} />
            <XAxis dataKey="date" tick={{ fill: palette.muted, fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={40} />
            <YAxis tick={{ fill: palette.muted, fontSize: 10 }} tickFormatter={(value) => `${Math.round(value * 100)}%`} tickLine={false} axisLine={false} width={44} />
            <Tooltip
              contentStyle={{ borderRadius: 12, border: `1px solid ${palette.border}`, background: theme === "dark" ? "rgba(11,9,7,0.95)" : "rgba(9,18,38,0.95)" }}
              labelStyle={{ color: palette.heading }}
            />
            <Area type="monotone" dataKey="bull" stackId="1" stroke={palette.positive} fill={palette.positive} fillOpacity={0.45} isAnimationActive={false} />
            <Area type="monotone" dataKey="neutral" stackId="1" stroke={palette.accent} fill={palette.accent} fillOpacity={0.35} isAnimationActive={false} />
            <Area type="monotone" dataKey="bear" stackId="1" stroke={palette.negative} fill={palette.negative} fillOpacity={0.38} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
