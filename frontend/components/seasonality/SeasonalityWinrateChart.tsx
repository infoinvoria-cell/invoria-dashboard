"use client";

import { dayLabel, type SeasonalDayPoint } from "@/lib/seasonalityWorkbench";

type Props = {
  points: SeasonalDayPoint[];
  rangeStartDay: number;
  rangeEndDay: number;
  themeColor: string;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export default function SeasonalityWinrateChart({ points, rangeStartDay, rangeEndDay, themeColor }: Props) {
  const width = 960;
  const height = 150;
  const paddingLeft = 42;
  const paddingRight = 12;
  const paddingTop = 14;
  const paddingBottom = 24;
  const safePoints = points.slice(0, 366);

  if (safePoints.length < 2) {
    return <div className="h-[150px] w-full rounded-[14px] border border-white/8 bg-white/[0.03]" />;
  }

  const minX = 1;
  const maxX = 366;
  const minY = 0;
  const maxY = Math.max(55, ...safePoints.map((point) => point.winRate), 100);
  const usableWidth = width - paddingLeft - paddingRight;
  const usableHeight = height - paddingTop - paddingBottom;

  const xFor = (day: number) => paddingLeft + (((day - minX) / (maxX - minX)) * usableWidth);
  const yFor = (winRate: number) => paddingTop + (usableHeight - (((winRate - minY) / (maxY - minY)) * usableHeight));

  const rangeLeft = xFor(clamp(rangeStartDay, 1, 366));
  const rangeRight = xFor(clamp(rangeEndDay, 1, 366));

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full overflow-visible rounded-[14px]">
      <rect x="0" y="0" width={width} height={height} rx="14" fill="rgba(255,255,255,0.02)" />
      <rect
        x={Math.min(rangeLeft, rangeRight)}
        y="0"
        width={Math.max(4, Math.abs(rangeRight - rangeLeft))}
        height={height}
        fill={themeColor === "#d6c38f" ? "rgba(214,195,143,0.10)" : "rgba(77,135,254,0.12)"}
      />
      {[0, 25, 50, 75, 100].map((tick) => (
        <g key={tick}>
          <line
            x1={paddingLeft}
            y1={yFor(tick)}
            x2={width - paddingRight}
            y2={yFor(tick)}
            stroke="rgba(255,255,255,0.08)"
            strokeDasharray="4 6"
          />
          <text x={paddingLeft - 8} y={yFor(tick) + 3} fontSize="9" fill="#8ea2c2" textAnchor="end">
            {tick}%
          </text>
        </g>
      ))}
      {safePoints.map((point, index) => {
        if (index === 0) return null;
        const previous = safePoints[index - 1];
        return (
          <line
            key={`${previous.day}-${point.day}`}
            x1={xFor(previous.day)}
            y1={yFor(previous.winRate)}
            x2={xFor(point.day)}
            y2={yFor(point.winRate)}
            stroke={point.direction === "SHORT" ? "#ff5a67" : "#39ff40"}
            strokeWidth="2"
            strokeLinecap="round"
          />
        );
      })}
      <line x1={paddingLeft} y1={height - paddingBottom} x2={width - paddingRight} y2={height - paddingBottom} stroke="rgba(255,255,255,0.14)" strokeWidth="1" />
      {[1, 92, 183, 275, 366].map((day) => (
        <text
          key={day}
          x={xFor(day)}
          y={height - 6}
          fontSize="9"
          fill="#8ea2c2"
          textAnchor={day === 1 ? "start" : day === 366 ? "end" : "middle"}
        >
          {dayLabel(day)}
        </text>
      ))}
    </svg>
  );
}
