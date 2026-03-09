"use client";

import type { ClusterPoint, ScreenerTheme } from "@/components/screener/types";

type Props = {
  points: ClusterPoint[];
  progress: number;
  direction: "bullish" | "bearish";
  theme: ScreenerTheme;
};

function buildPath(points: ClusterPoint[], width: number, height: number, padding: number): string {
  if (points.length < 2) return "";
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 0.0001);
  return points
    .map((point, index) => {
      const x = padding + ((width - padding * 2) * index) / Math.max(points.length - 1, 1);
      const y = height - padding - (((point.value - min) / range) * (height - padding * 2));
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

export default function SeasonalityGraph({ points, progress, direction, theme }: Props) {
  const width = 92;
  const height = 34;
  const padding = 4;
  const stroke = direction === "bullish" ? (theme === "gold" ? "#d6c38f" : "#4d87fe") : "#e05656";
  const path = buildPath(points, width, height, padding);
  const markerX = padding + ((width - padding * 2) * progress);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-[34px] w-[92px] rounded-md">
      <rect x="0" y="0" width={width} height={height} rx="8" fill="rgba(255,255,255,0.02)" />
      {path ? <path d={path} fill="none" stroke={stroke} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /> : null}
      <line x1={markerX} x2={markerX} y1={4} y2={height - 4} stroke="rgba(255,255,255,0.38)" strokeDasharray="3 3" />
      <circle cx={markerX} cy={height / 2} r={2.5} fill={stroke} />
    </svg>
  );
}
