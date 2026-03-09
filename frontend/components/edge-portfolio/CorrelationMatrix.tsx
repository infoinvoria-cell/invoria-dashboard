"use client";

import type { CorrelationCell } from "@/components/edge-portfolio/metrics";
import type { TrackRecordTheme } from "@/components/track-record/metrics";
import { getTrackRecordThemePalette } from "@/components/track-record/theme";

type Props = {
  theme: TrackRecordTheme;
  matrix: CorrelationCell[];
};

function heatColor(value: number, theme: TrackRecordTheme): string {
  const clamped = Math.max(-1, Math.min(1, value));
  if (clamped < 0) {
    return theme === "dark" ? `rgba(224,86,86,${0.18 + Math.abs(clamped) * 0.72})` : `rgba(224,86,86,${0.18 + Math.abs(clamped) * 0.72})`;
  }
  return theme === "dark" ? `rgba(214,195,143,${0.16 + clamped * 0.74})` : `rgba(77,135,254,${0.16 + clamped * 0.74})`;
}

export default function CorrelationMatrix({ theme, matrix }: Props) {
  const palette = getTrackRecordThemePalette(theme);
  const labels = Array.from(new Set(matrix.map((cell) => cell.rowLabel)));

  return (
    <section
      className="relative overflow-hidden rounded-[24px] border p-3.5 backdrop-blur-[20px]"
      style={{ background: palette.panelBackgroundStrong, borderColor: palette.panelBorder, boxShadow: palette.panelShadow }}
    >
      <div className="mb-3">
        <div className="text-[12px] font-semibold uppercase tracking-[0.2em]" style={{ color: palette.heading }}>
          Correlation Matrix
        </div>
        <div className="mt-1 text-[11px]" style={{ color: palette.muted }}>
          Diversification heatmap between selected strategies
        </div>
      </div>

      {labels.length === 0 ? (
        <div className="grid min-h-[220px] place-items-center rounded-[18px] border text-sm" style={{ borderColor: palette.panelBorder, color: palette.muted }}>
          Select strategies to compute correlation.
        </div>
      ) : (
        <div className="overflow-auto">
          <svg width={Math.max(320, labels.length * 84 + 90)} height={Math.max(260, labels.length * 52 + 60)}>
            {labels.map((label, index) => (
              <text key={`${label}-x`} x={92 + index * 84 + 28} y={22} fill={palette.muted} fontSize="10" textAnchor="middle">
                {label}
              </text>
            ))}
            {labels.map((label, index) => (
              <text key={`${label}-y`} x={10} y={64 + index * 52 + 16} fill={palette.muted} fontSize="10">
                {label}
              </text>
            ))}
            {matrix.map((cell) => {
              const xIndex = labels.indexOf(cell.colLabel);
              const yIndex = labels.indexOf(cell.rowLabel);
              return (
                <g key={`${cell.rowId}-${cell.colId}`}>
                  <rect
                    x={66 + xIndex * 84}
                    y={40 + yIndex * 52}
                    width={56}
                    height={34}
                    rx={10}
                    fill={heatColor(cell.value, theme)}
                    stroke={palette.panelBorder}
                  />
                  <text x={94 + xIndex * 84} y={61 + yIndex * 52} textAnchor="middle" fill="#ffffff" fontSize="11" fontWeight={700}>
                    {cell.value.toFixed(2)}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      )}
    </section>
  );
}
