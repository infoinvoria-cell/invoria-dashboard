"use client";

import { useMemo } from "react";
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { PortfolioChartPoint, PortfolioLineMeta } from "@/components/edge-portfolio/metrics";
import type { TrackRecordTheme } from "@/components/track-record/metrics";
import { getTrackRecordThemePalette } from "@/components/track-record/theme";

type Props = {
  theme: TrackRecordTheme;
  chartData: PortfolioChartPoint[];
  overlayLines: PortfolioLineMeta[];
  animationProgress: number;
  isReplaying: boolean;
  onReplay: () => void;
};

function sliceVisible<T>(values: T[], progress: number): T[] {
  if (values.length === 0) return [];
  const visible = Math.max(2, Math.round(values.length * Math.max(progress, 0.03)));
  return values.slice(0, visible);
}

function formatSignedPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export default function PortfolioPerformanceChart({
  theme,
  chartData,
  overlayLines,
  animationProgress,
  isReplaying,
  onReplay,
}: Props) {
  const palette = getTrackRecordThemePalette(theme);
  const visibleData = useMemo(() => sliceVisible(chartData, animationProgress), [animationProgress, chartData]);

  return (
    <section
      className="relative flex min-h-0 flex-col overflow-hidden rounded-[24px] border px-4 pb-4 pt-3.5 backdrop-blur-[20px] min-[769px]:px-5 min-[769px]:pb-[18px] min-[769px]:pt-4"
      style={{ background: palette.panelBackgroundStrong, borderColor: palette.panelBorder, boxShadow: palette.panelShadow }}
    >
      <div className="mb-3 flex flex-col gap-3 min-[769px]:flex-row min-[769px]:items-center min-[769px]:justify-between">
        <div>
          <div className="text-[14px] font-semibold uppercase tracking-[0.22em]" style={{ color: palette.heading }}>
            Portfolio Performance
          </div>
          <div className="mt-1 text-[11px]" style={{ color: palette.muted }}>
            Combined equity curve with selected strategy overlays
          </div>
        </div>
        <button
          type="button"
          onClick={onReplay}
          className="h-8 rounded-full border px-3 text-[10px] font-semibold uppercase tracking-[0.16em]"
          style={{ borderColor: `${palette.accent}66`, background: `${palette.accent}12`, color: palette.heading }}
        >
          {isReplaying ? "Replaying..." : "Replay"}
        </button>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 xl:grid-rows-[minmax(0,1fr)_120px]">
        <div className="min-h-[320px] min-[769px]:min-h-[420px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={visibleData} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={palette.grid} strokeDasharray="2 8" vertical={false} />
              <XAxis dataKey="date" tick={{ fill: palette.muted, fontSize: 12 }} tickLine={false} axisLine={false} minTickGap={30} />
              <YAxis tick={{ fill: palette.muted, fontSize: 12 }} tickLine={false} axisLine={false} width={64} tickFormatter={(value) => `${Math.round(Number(value))}%`} />
              <Tooltip
                contentStyle={{ borderRadius: 14, border: `1px solid ${palette.panelBorder}`, background: "rgba(7,10,15,0.96)" }}
                formatter={(value, name) => [`${Number(value).toFixed(2)}%`, name]}
              />
              {overlayLines.map((line) => (
                <Line key={line.id} type="monotone" dataKey={line.id} name={line.name} stroke={line.color} strokeWidth={1.4} dot={false} isAnimationActive={false} opacity={0.72} />
              ))}
              <Line type="monotone" dataKey="portfolioReturn" name="Portfolio" stroke={palette.heading} strokeWidth={2.8} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="grid gap-3 min-[769px]:grid-cols-2">
          <div className="rounded-[18px] border p-3" style={{ borderColor: palette.panelBorder, background: "rgba(7,10,15,0.68)" }}>
            <div className="mb-2 text-[10px] uppercase tracking-[0.18em]" style={{ color: palette.muted }}>
              Drawdown Chart
            </div>
            <div className="h-[78px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={visibleData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                  <Area type="monotone" dataKey="drawdown" stroke={palette.negative} fill={palette.negative} fillOpacity={0.16} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-[18px] border p-3" style={{ borderColor: palette.panelBorder, background: "rgba(7,10,15,0.68)" }}>
            <div className="mb-2 text-[10px] uppercase tracking-[0.18em]" style={{ color: palette.muted }}>
              Equity Curve
            </div>
            <div className="h-[78px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={visibleData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                  <Area type="monotone" dataKey="equity" stroke={palette.accent} fill={palette.accent} fillOpacity={0.14} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-1 text-[10px]" style={{ color: palette.muted }}>
              {visibleData.length ? formatSignedPercent(Number(visibleData[visibleData.length - 1]?.portfolioReturn ?? 0)) : "--"}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
