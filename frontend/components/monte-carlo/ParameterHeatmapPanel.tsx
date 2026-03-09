"use client";

import { useMemo } from "react";

import { getMonteCarloPalette } from "@/components/monte-carlo/theme";
import type { MonteCarloTheme, ParameterHeatmapPoint } from "@/components/monte-carlo/types";

type Props = {
  theme: MonteCarloTheme;
  performanceHeatmap: ParameterHeatmapPoint[];
  drawdownHeatmap: ParameterHeatmapPoint[];
  animationProgress: number;
};

function interpolateColor(low: string, high: string, ratio: number): string {
  const clamped = Math.max(0, Math.min(1, ratio));
  const parse = (value: string) => {
    const normalized = value.replace("#", "");
    const hex = normalized.length === 3 ? normalized.split("").map((char) => `${char}${char}`).join("") : normalized;
    return [0, 2, 4].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
  };
  const [lr, lg, lb] = parse(low);
  const [hr, hg, hb] = parse(high);
  const mix = (a: number, b: number) => Math.round(a + (b - a) * clamped);
  return `rgb(${mix(lr, hr)}, ${mix(lg, hg)}, ${mix(lb, hb)})`;
}

function Heatmap({
  data,
  theme,
  title,
  paletteTone,
  animationProgress,
}: {
  data: ParameterHeatmapPoint[];
  theme: MonteCarloTheme;
  title: string;
  paletteTone: "score" | "drawdown";
  animationProgress: number;
}) {
  const palette = getMonteCarloPalette(theme);
  const xLabels = useMemo(() => Array.from(new Set(data.map((item) => item.xLabel))), [data]);
  const yLabels = useMemo(() => Array.from(new Set(data.map((item) => item.yLabel))), [data]);
  const scoreValues = data.map((item) => (paletteTone === "score" ? item.score : item.drawdown * 100));
  const min = Math.min(...scoreValues);
  const max = Math.max(...scoreValues);
  const visibleCount = Math.max(1, Math.round(data.length * Math.max(animationProgress, 0.12)));
  const visibleKeys = new Set(data.slice(0, visibleCount).map((item) => `${item.xLabel}-${item.yLabel}`));

  return (
    <div className="rounded-[18px] border p-3" style={{ borderColor: palette.border, background: palette.panelBackgroundSoft }}>
      <div className="mb-3 text-[11px] uppercase tracking-[0.16em]" style={{ color: palette.muted }}>
        {title}
      </div>
      <div className="overflow-x-auto">
        <svg width={Math.max(360, xLabels.length * 64 + 80)} height={Math.max(240, yLabels.length * 42 + 58)}>
          {xLabels.map((label, index) => (
            <text key={label} x={84 + index * 64 + 22} y={20} fill={palette.muted} fontSize="10" textAnchor="middle">
              {label}
            </text>
          ))}
          {yLabels.map((label, index) => (
            <text key={label} x={12} y={52 + index * 42 + 18} fill={palette.muted} fontSize="10">
              {label}
            </text>
          ))}
          {data.map((item) => {
            const xIndex = xLabels.indexOf(item.xLabel);
            const yIndex = yLabels.indexOf(item.yLabel);
            const raw = paletteTone === "score" ? item.score : item.drawdown * 100;
            const ratio = max === min ? 0.5 : (raw - min) / (max - min);
            const fill = paletteTone === "score"
              ? interpolateColor(theme === "dark" ? "#3d2d12" : "#11306b", palette.accent, ratio)
              : interpolateColor(theme === "dark" ? "#2d0e0e" : "#451220", palette.negative, ratio);
            return (
              <g key={`${item.xLabel}-${item.yLabel}`}>
                <rect
                  x={62 + xIndex * 64}
                  y={30 + yIndex * 42}
                  width={52}
                  height={30}
                  rx={9}
                  fill={fill}
                  opacity={visibleKeys.has(`${item.xLabel}-${item.yLabel}`) ? 0.96 : 0.12}
                  stroke={palette.border}
                />
                <text x={88 + xIndex * 64} y={49 + yIndex * 42} fill="#ffffff" fontSize="10" textAnchor="middle">
                  {paletteTone === "score" ? item.score.toFixed(0) : `${(item.drawdown * 100).toFixed(1)}%`}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

export default function ParameterHeatmapPanel({ theme, performanceHeatmap, drawdownHeatmap, animationProgress }: Props) {
  const palette = getMonteCarloPalette(theme);

  return (
    <section className="glass-panel rounded-[24px] border p-4 min-[769px]:p-5" style={{ background: palette.panelBackground, borderColor: palette.border, boxShadow: `0 18px 44px rgba(0,0,0,0.30), 0 0 28px ${palette.glow}` }}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="ivq-section-label">Parameter Sensitivity Analysis</div>
          <h2 className="text-lg font-semibold" style={{ color: palette.heading }}>
            Performance- und Drawdown-Heatmaps
          </h2>
        </div>
      </div>

      <div className="grid gap-4 min-[769px]:grid-cols-2">
        <Heatmap data={performanceHeatmap} theme={theme} title="Stop Loss / Take Profit" paletteTone="score" animationProgress={animationProgress} />
        <Heatmap data={drawdownHeatmap} theme={theme} title="Lookback / Threshold" paletteTone="drawdown" animationProgress={animationProgress} />
      </div>
    </section>
  );
}
