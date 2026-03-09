"use client";

import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { getMonteCarloPalette } from "@/components/monte-carlo/theme";
import type { MonteCarloTheme, WalkForwardPoint } from "@/components/monte-carlo/types";

type Props = {
  theme: MonteCarloTheme;
  data: WalkForwardPoint[];
  animationProgress: number;
};

export default function WalkForwardValidationPanel({ theme, data, animationProgress }: Props) {
  const palette = getMonteCarloPalette(theme);
  const visible = data.slice(0, Math.max(1, Math.round(data.length * Math.max(animationProgress, 0.12))));

  return (
    <section className="glass-panel rounded-[24px] border p-4 min-[769px]:p-5" style={{ background: palette.panelBackground, borderColor: palette.border, boxShadow: `0 18px 44px rgba(0,0,0,0.30), 0 0 28px ${palette.glow}` }}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="ivq-section-label">Walk-Forward Validation</div>
          <h2 className="text-lg font-semibold" style={{ color: palette.heading }}>
            In-Sample vs Out-of-Sample
          </h2>
        </div>
        <div className="text-[11px]" style={{ color: palette.muted }}>
          Performance stability chart
        </div>
      </div>

      <div className="h-[300px] rounded-[18px] border p-3" style={{ borderColor: palette.border, background: palette.panelBackgroundSoft }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={visible} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={palette.chartGrid} vertical={false} />
            <XAxis dataKey="segment" tick={{ fill: palette.muted, fontSize: 11 }} tickLine={false} axisLine={false} />
            <YAxis yAxisId="left" tick={{ fill: palette.muted, fontSize: 11 }} tickLine={false} axisLine={false} width={44} />
            <YAxis yAxisId="right" orientation="right" hide />
            <Tooltip contentStyle={{ background: theme === "dark" ? "#0d0b08" : "#071427", border: `1px solid ${palette.border}`, borderRadius: 14, color: palette.text }} />
            <Bar yAxisId="left" dataKey="degradation" fill={palette.negative} radius={[6, 6, 0, 0]} isAnimationActive={false} />
            <Line yAxisId="left" type="monotone" dataKey="trainReturn" stroke={palette.accentStrong} strokeWidth={2.1} dot={false} isAnimationActive={false} />
            <Line yAxisId="left" type="monotone" dataKey="testReturn" stroke={palette.accent} strokeWidth={2.1} dot={false} isAnimationActive={false} />
            <Line yAxisId="right" type="monotone" dataKey="stability" stroke={palette.positive} strokeWidth={1.8} dot={false} strokeDasharray="4 4" isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
