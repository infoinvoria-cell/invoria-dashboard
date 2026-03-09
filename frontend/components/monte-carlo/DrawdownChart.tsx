"use client";

import { Info } from "lucide-react";
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

import { getMonteCarloPalette } from "@/components/monte-carlo/theme";
import type { DrawdownPoint, HistogramBin, MonteCarloTheme } from "@/components/monte-carlo/types";

type Props = {
  theme: MonteCarloTheme;
  drawdownSeries: DrawdownPoint[];
  drawdownHistogram: HistogramBin[];
  animationProgress: number;
};

function animatedSlice<T>(rows: T[], progress: number): T[] {
  if (!rows.length) return [];
  const visible = Math.max(2, Math.round(rows.length * Math.max(0.04, progress)));
  return rows.slice(0, visible);
}

export default function DrawdownChart({ theme, drawdownSeries, drawdownHistogram, animationProgress }: Props) {
  const palette = getMonteCarloPalette(theme);
  const visibleSeries = animatedSlice(drawdownSeries, animationProgress);
  const visibleHistogram = animatedSlice(drawdownHistogram, animationProgress);

  return (
    <section className="glass-panel rounded-[24px] border p-4 min-[769px]:p-5" style={{ background: palette.panelBackground, borderColor: palette.border, boxShadow: `0 18px 44px rgba(0,0,0,0.30), 0 0 28px ${palette.glow}` }}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="ivq-section-label">Drawdown Distribution</div>
          <h2 className="text-lg font-semibold" style={{ color: palette.heading }}>
            Bootstrap drawdown stress analysis
          </h2>
        </div>
        <span className="inline-flex items-center gap-2 text-[11px]" style={{ color: palette.muted }} title="Bootstrapping: Erzeugt alternative Szenarien durch zufaelliges Wiederverwenden historischer Renditen.">
          <Info size={13} /> Bootstrap
        </span>
      </div>

      <div className="grid gap-4 min-[769px]:grid-cols-[minmax(0,1.35fr)_minmax(240px,0.8fr)]">
        <div className="h-[290px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={visibleSeries} margin={{ top: 10, right: 10, bottom: 6, left: 0 }}>
              <CartesianGrid stroke={palette.chartGrid} vertical={false} />
              <XAxis dataKey="step" tick={{ fill: palette.muted, fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fill: palette.muted, fontSize: 10 }} tickFormatter={(value) => `${(value * 100).toFixed(0)}%`} tickLine={false} axisLine={false} width={44} />
              <Tooltip
                contentStyle={{ borderRadius: 12, border: `1px solid ${palette.border}`, background: theme === "dark" ? "rgba(11,9,7,0.95)" : "rgba(9,18,38,0.95)" }}
                labelStyle={{ color: palette.heading }}
              />
              <Area type="monotone" dataKey="p95Worst" stroke={palette.negative} fill={palette.negative} fillOpacity={0.2} isAnimationActive={false} />
              <Area type="monotone" dataKey="median" stroke={palette.accent} fill={palette.accent} fillOpacity={0.24} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="h-[290px] rounded-[18px] border p-3" style={{ borderColor: palette.border, background: palette.panelBackgroundSoft }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={visibleHistogram} margin={{ top: 6, right: 4, bottom: 6, left: 0 }}>
              <CartesianGrid stroke={palette.chartGrid} vertical={false} />
              <XAxis dataKey="label" tick={{ fill: palette.muted, fontSize: 9 }} tickLine={false} axisLine={false} minTickGap={18} />
              <YAxis hide />
              <Tooltip
                contentStyle={{ borderRadius: 12, border: `1px solid ${palette.border}`, background: theme === "dark" ? "rgba(11,9,7,0.95)" : "rgba(9,18,38,0.95)" }}
                labelStyle={{ color: palette.heading }}
              />
              <Bar dataKey="count" fill={palette.negative} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
}
