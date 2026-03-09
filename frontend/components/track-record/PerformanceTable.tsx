"use client";

import { MONTH_LABELS, formatSignedPercent, type PerformanceRow, type TrackRecordTheme } from "@/components/track-record/metrics";
import { getTrackRecordThemePalette } from "@/components/track-record/theme";

type Props = {
  rows: PerformanceRow[];
  totalCumulativeReturn: number;
  activeMultiplier?: number;
  onMultiplierChange?: (multiplier: number) => void;
  theme: TrackRecordTheme;
};

export default function PerformanceTable({
  rows,
  totalCumulativeReturn,
  activeMultiplier,
  onMultiplierChange,
  theme,
}: Props) {
  const palette = getTrackRecordThemePalette(theme);
  const totalRowTone = totalCumulativeReturn >= 0 ? (theme === "blue" ? palette.success : palette.positive) : palette.negative;
  const isBlueTheme = theme === "blue";
  const headerBackground = isBlueTheme ? "rgba(7,18,35,0.18)" : palette.tableHeader;
  const rowBackground = isBlueTheme ? "rgba(0,0,0,0)" : "rgba(10,14,20,0.72)";
  const totalBackground = isBlueTheme ? "rgba(0,0,0,0)" : "rgba(7,10,15,0.8)";
  const displayMultiplier = Math.max(1, Number(activeMultiplier ?? 1));

  const scaleValue = (value: number | null): number | null => {
    if (value == null) return null;
    return value * displayMultiplier;
  };

  const toneStyle = (value: number | null): { color: string } => {
    if (value == null) return { color: palette.muted };
    if (value > 0) return { color: theme === "blue" ? palette.success : palette.positive };
    if (value < 0) return { color: palette.negative };
    return { color: palette.neutral };
  };

  return (
    <section
      className="relative overflow-hidden rounded-[24px] border p-3.5 backdrop-blur-[20px] min-[769px]:p-4"
      style={{
        background: palette.panelBackgroundStrong,
        borderColor: palette.panelBorder,
        boxShadow: palette.panelShadow,
      }}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            theme === "dark"
              ? "radial-gradient(900px 420px at 88% 92%, rgba(214,195,143,0.12), transparent 42%)"
              : "radial-gradient(900px 420px at 88% 92%, rgba(77,135,254,0.12), transparent 42%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-x-6 top-0 h-px"
        style={{ background: theme === "dark" ? "rgba(255,243,212,0.20)" : "rgba(218,232,255,0.18)" }}
      />

      <div className="relative z-[1] mb-2.5 flex flex-col items-start gap-2 min-[769px]:flex-row min-[769px]:items-center min-[769px]:justify-between">
        <div className="text-[15px] font-semibold uppercase tracking-[0.22em]" style={{ color: palette.heading }}>
          Performance Table
        </div>
        {onMultiplierChange ? (
          <div className="flex flex-wrap items-center gap-2">
            {[1, 2, 3, 4, 5].map((multiplier) => {
              const isActive = (activeMultiplier ?? 1) === multiplier;
              return (
                <button
                  key={multiplier}
                  type="button"
                  onClick={() => onMultiplierChange(multiplier)}
                  className="inline-flex h-7 min-w-[32px] items-center justify-center rounded-full border px-2 text-[11px] font-semibold transition"
                  style={{
                    borderColor: isActive ? `${palette.accent}88` : palette.panelBorder,
                    background: isActive ? `${palette.accent}10` : "rgba(6,10,16,0.42)",
                    color: isActive ? palette.heading : palette.muted,
                    boxShadow: isActive ? `0 0 8px ${palette.panelGlow}` : "none",
                  }}
                >
                  {multiplier}x
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      <div className="relative z-[1] overflow-x-auto">
        <table className="w-full min-w-0 max-w-full table-fixed border-separate border-spacing-y-1.5 text-left text-[9px] min-[769px]:text-[10px] xl:text-[11px]">
          <colgroup>
            <col className="w-[56px] min-[769px]:w-[64px]" />
            {MONTH_LABELS.map((month) => (
              <col key={month} />
            ))}
            <col className="w-[84px] min-[769px]:w-[96px]" />
          </colgroup>
          <thead>
            <tr>
              <th
                className="rounded-l-2xl border-y border-l px-1.5 py-2.5 text-[7px] uppercase tracking-[0.14em] min-[769px]:px-2 min-[769px]:text-[8px]"
                style={{ borderColor: palette.panelBorder, background: headerBackground, color: palette.muted }}
              >
                Year
              </th>
              {MONTH_LABELS.map((month) => (
                <th
                  key={month}
                  className="border-y px-0.5 py-2.5 text-center text-[7px] uppercase tracking-[0.12em] min-[769px]:px-1 min-[769px]:text-[8px]"
                  style={{ borderColor: palette.panelBorder, background: headerBackground, color: palette.muted }}
                >
                  {month}
                </th>
              ))}
              <th
                className="rounded-r-2xl border-y border-r px-1 py-2.5 text-center text-[7px] uppercase tracking-[0.12em] min-[769px]:px-1.5 min-[769px]:text-[8px]"
                style={{ borderColor: palette.panelBorder, background: headerBackground, color: palette.muted }}
              >
                Total
              </th>
            </tr>
          </thead>

          <tbody>
            {rows.map((row) => (
              <tr key={row.year}>
                <td
                  className="rounded-l-2xl border-y border-l px-1.5 py-3 text-[10px] font-semibold min-[769px]:px-2 min-[769px]:text-[12px]"
                  style={{ borderColor: palette.panelBorder, background: rowBackground, color: palette.heading }}
                >
                  {row.year}
                </td>
                {MONTH_LABELS.map((month) => {
                  const value = row.months[month];
                  return (
                    <td
                      key={`${row.year}-${month}`}
                  className="border-y px-0.5 py-3 text-center text-[9px] font-semibold min-[769px]:px-1 min-[769px]:text-[11px]"
                  style={{ borderColor: palette.panelBorder, background: rowBackground, ...toneStyle(scaleValue(value)) }}
                >
                  {value == null ? "--" : formatSignedPercent(scaleValue(value) ?? 0)}
                </td>
              );
            })}
            <td
              className="rounded-r-2xl border-y border-r px-1 py-3 text-center text-[9px] font-semibold min-[769px]:px-1.5 min-[769px]:text-[11px]"
              style={{ borderColor: palette.panelBorder, background: rowBackground, ...toneStyle(scaleValue(row.total)) }}
            >
              {row.total == null ? "--" : formatSignedPercent(scaleValue(row.total) ?? 0)}
            </td>
          </tr>
        ))}
            <tr>
              <td
                className="rounded-l-2xl border-y border-l px-1.5 py-3 font-semibold uppercase tracking-[0.06em] min-[769px]:px-2"
                style={{ borderColor: palette.panelBorder, background: totalBackground, color: palette.heading }}
              >
                Total Return
              </td>
              <td
                colSpan={11}
                className="border-y px-1 py-3 text-[7px] uppercase tracking-[0.06em] min-[769px]:px-1.5 min-[769px]:text-[8px] xl:text-[9px]"
                style={{ borderColor: palette.panelBorder, background: totalBackground, color: palette.muted }}
              >
                Cumulative Return · {displayMultiplier}x
              </td>
              <td
                className="rounded-r-2xl border-y border-r py-3 pl-2 pr-5 text-right font-semibold leading-none min-[769px]:pl-3 min-[769px]:pr-7"
                colSpan={2}
                style={{ borderColor: palette.panelBorder, background: totalBackground, color: totalRowTone }}
              >
                <span className="whitespace-nowrap text-[18px] min-[769px]:text-[22px] xl:text-[24px]">
                  {formatSignedPercent(totalCumulativeReturn * displayMultiplier)}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
