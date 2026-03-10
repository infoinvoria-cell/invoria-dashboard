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
  const height = 220;
  const paddingLeft = 46;
  const paddingRight = 14;
  const paddingTop = 18;
  const paddingBottom = 30;
  const safePoints = points.slice(0, 366);

  if (safePoints.length < 2) {
    return <div className="h-[220px] w-full rounded-[14px] border border-white/8 bg-white/[0.03]" />;
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
  const areaPath = [
    `M ${xFor(safePoints[0].day)} ${height - paddingBottom}`,
    ...safePoints.map((point) => `L ${xFor(point.day)} ${yFor(point.winRate)}`),
    `L ${xFor(safePoints[safePoints.length - 1].day)} ${height - paddingBottom}`,
    "Z",
  ].join(" ");
  const linePath = safePoints
    .map((point, index) => `${index === 0 ? "M" : "L"} ${xFor(point.day)} ${yFor(point.winRate)}`)
    .join(" ");
  const rangeMid = Math.round((rangeStartDay + rangeEndDay) / 2);
  const rangePoint = safePoints.find((point) => point.day >= rangeMid) ?? safePoints[safePoints.length - 1];

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
      <path d={areaPath} fill={themeColor === "#d6c38f" ? "rgba(214,195,143,0.18)" : "rgba(77,135,254,0.16)"} />
      <path d={linePath} fill="none" stroke={themeColor} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={xFor(rangePoint.day)} cy={yFor(rangePoint.winRate)} r="4" fill={themeColor} stroke="rgba(7,14,26,0.95)" strokeWidth="2" />
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
