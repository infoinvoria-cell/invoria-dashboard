"use client";

import type { TrackRecordTheme } from "@/components/track-record/metrics";
import { getTrackRecordThemePalette } from "@/components/track-record/theme";

export type DonutSegment = {
  label: string;
  value: number;
  color: string;
};

type Props = {
  segments: DonutSegment[];
  centerLabel?: string;
  centerValue?: string;
  theme: TrackRecordTheme;
};

export default function DonutChart({ segments, centerLabel, centerValue, theme }: Props) {
  const palette = getTrackRecordThemePalette(theme);
  const radius = 27;
  const strokeWidth = 9;
  const centerX = 42;
  const centerY = 33;
  const circumference = 2 * Math.PI * radius;
  const total = Math.max(
    1,
    segments.reduce((sum, segment) => sum + Math.max(0, Number(segment.value) || 0), 0),
  );
  let offset = 0;

  return (
    <svg viewBox="0 0 84 84" className="h-full w-full overflow-visible">
      <circle
        cx={centerX}
        cy={centerY}
        r={radius}
        fill="none"
        stroke={theme === "dark" ? "rgba(62,55,40,0.72)" : "rgba(51,65,85,0.45)"}
        strokeWidth={strokeWidth}
      />
      {segments.map((segment, index) => {
        const normalized = Math.max(0, Number(segment.value) || 0);
        const dash = (normalized / total) * circumference;
        const currentOffset = offset;
        offset += dash;
        return (
          <circle
            key={`${segment.label}-${index}`}
            cx={centerX}
            cy={centerY}
            r={radius}
            fill="none"
            stroke={segment.color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference - dash}`}
            strokeDashoffset={-currentOffset}
            transform={`rotate(-90 ${centerX} ${centerY})`}
          />
        );
      })}
      <circle cx={centerX} cy={centerY} r="17" fill={theme === "dark" ? "rgba(8,7,6,0.96)" : "rgba(7,10,15,0.92)"} />
      {centerValue ? (
        <text x={centerX} y={centerY - 3} textAnchor="middle" fontSize="11" fontWeight="800" fill={palette.heading}>
          {centerValue}
        </text>
      ) : null}
      {centerLabel ? (
        <text x={centerX} y={centerY + 9} textAnchor="middle" fontSize="5.6" fontWeight="700" fill={palette.muted}>
          {centerLabel}
        </text>
      ) : null}
    </svg>
  );
}
