"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { getMonteCarloPalette } from "@/components/monte-carlo/theme";
import type { MonteCarloTheme, OverfittingSummary } from "@/components/monte-carlo/types";

type Props = {
  theme: MonteCarloTheme;
  summary: OverfittingSummary;
  distribution: number[];
  animationProgress: number;
};

function toSeries(values: number[], progress: number) {
  const visible = Math.max(8, Math.round(values.length * Math.max(progress, 0.12)));
  return values.slice(0, visible).map((value, index) => ({ index, value }));
}

export default function OverfittingDetectionPanel({ theme, summary, distribution, animationProgress }: Props) {
  const palette = getMonteCarloPalette(theme);

  return (
    <section className="glass-panel rounded-[24px] border p-4 min-[769px]:p-5" style={{ background: palette.panelBackground, borderColor: palette.border, boxShadow: `0 18px 44px rgba(0,0,0,0.30), 0 0 28px ${palette.glow}` }}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="ivq-section-label">Strategy Overfitting Detection</div>
          <h2 className="text-lg font-semibold" style={{ color: palette.heading }}>
            Stabilitaet und Randomized Signal Testing
          </h2>
        </div>
        <div className="rounded-full border px-3 py-1 text-[11px]" style={{ borderColor: palette.border, color: palette.heading }}>
          Risk {summary.riskScore.toFixed(0)}/100
        </div>
      </div>

      <div className="grid gap-3 min-[769px]:grid-cols-4">
        {[
          ["Overfitting Risk", `${summary.riskScore.toFixed(0)}/100`, palette.negative],
          ["Stability Score", `${summary.stabilityScore.toFixed(0)}/100`, palette.positive],
          ["Randomized Edge", summary.randomizedEdge.toFixed(2), palette.accent],
          ["Consistency", `${summary.consistencyScore.toFixed(0)}%`, palette.accentStrong],
        ].map(([label, value, tone]) => (
          <div key={label} className="rounded-[16px] border p-3" style={{ borderColor: palette.border, background: palette.panelBackgroundSoft }}>
            <div className="text-[10px] uppercase tracking-[0.16em]" style={{ color: palette.muted }}>
              {label}
            </div>
            <div className="mt-1 text-[20px] font-semibold" style={{ color: tone }}>
              {value}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 h-[228px] rounded-[18px] border p-3" style={{ borderColor: palette.border, background: palette.panelBackgroundSoft }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={toSeries(distribution, animationProgress)} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={palette.chartGrid} vertical={false} />
            <XAxis dataKey="index" tick={{ fill: palette.muted, fontSize: 11 }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fill: palette.muted, fontSize: 11 }} tickLine={false} axisLine={false} width={44} />
            <Tooltip contentStyle={{ background: theme === "dark" ? "#0d0b08" : "#071427", border: `1px solid ${palette.border}`, borderRadius: 14, color: palette.text }} />
            <Area type="monotone" dataKey="value" stroke={palette.negative} fill={palette.negative} fillOpacity={0.2} strokeWidth={2.1} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
