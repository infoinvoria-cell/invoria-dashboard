"use client";

import { MONTH_LABELS, formatSignedPercent, type PerformanceRow, type TrackRecordTheme } from "@/components/track-record/metrics";
import { getTrackRecordThemePalette } from "@/components/track-record/theme";

type Props = {
  rows: PerformanceRow[];
  totalCumulativeReturn: number;
  theme: TrackRecordTheme;
};

export default function PerformanceTable({ rows, totalCumulativeReturn, theme }: Props) {
  const palette = getTrackRecordThemePalette(theme);
  const totalRowTone = totalCumulativeReturn >= 0 ? (theme === "blue" ? palette.success : palette.positive) : palette.negative;
  const isBlueTheme = theme === "blue";
  const headerBackground = isBlueTheme ? "rgba(7,18,35,0.18)" : palette.tableHeader;
  const rowBackground = isBlueTheme ? "rgba(0,0,0,0)" : "rgba(10,14,20,0.72)";
  const totalBackground = isBlueTheme ? "rgba(0,0,0,0)" : "rgba(7,10,15,0.8)";

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

      <div className="relative z-[1] mb-2.5 text-[15px] font-semibold uppercase tracking-[0.22em]" style={{ color: palette.heading }}>
        Performance Table
      </div>

      <div className="relative z-[1] overflow-x-auto overflow-y-hidden">
        <table className="min-w-[940px] table-fixed border-separate border-spacing-y-1 text-left text-[12px] min-[769px]:w-full min-[769px]:min-w-0">
          <colgroup>
            <col className="w-[74px]" />
            {MONTH_LABELS.map((month) => (
              <col key={month} />
            ))}
            <col className="w-[84px]" />
          </colgroup>
          <thead>
            <tr>
              <th
                className="rounded-l-2xl border-y border-l px-3 py-2 text-[9px] uppercase tracking-[0.2em]"
                style={{ borderColor: palette.panelBorder, background: headerBackground, color: palette.muted }}
              >
                Year
              </th>
              {MONTH_LABELS.map((month) => (
                <th
                  key={month}
                  className="border-y px-1.5 py-2 text-center text-[9px] uppercase tracking-[0.18em]"
                  style={{ borderColor: palette.panelBorder, background: headerBackground, color: palette.muted }}
                >
                  {month}
                </th>
              ))}
              <th
                className="rounded-r-2xl border-y border-r px-3 py-2 text-center text-[9px] uppercase tracking-[0.2em]"
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
                  className="rounded-l-2xl border-y border-l px-3 py-2.5 font-semibold"
                  style={{ borderColor: palette.panelBorder, background: rowBackground, color: palette.heading }}
                >
                  {row.year}
                </td>
                {MONTH_LABELS.map((month) => {
                  const value = row.months[month];
                  return (
                    <td
                      key={`${row.year}-${month}`}
                      className="border-y px-1.5 py-2.5 text-center font-medium"
                      style={{ borderColor: palette.panelBorder, background: rowBackground, ...toneStyle(value) }}
                    >
                      {value == null ? "--" : formatSignedPercent(value)}
                    </td>
                  );
                })}
                <td
                  className="rounded-r-2xl border-y border-r px-3 py-2.5 text-center font-semibold"
                  style={{ borderColor: palette.panelBorder, background: rowBackground, ...toneStyle(row.total) }}
                >
                  {row.total == null ? "--" : formatSignedPercent(row.total)}
                </td>
              </tr>
            ))}
            <tr>
              <td
                className="rounded-l-2xl border-y border-l px-3 py-2.5 font-semibold uppercase tracking-[0.12em]"
                style={{ borderColor: palette.panelBorder, background: totalBackground, color: palette.heading }}
              >
                Total Return
              </td>
              <td
                colSpan={12}
                className="border-y px-2 py-2.5 text-[9px] uppercase tracking-[0.14em]"
                style={{ borderColor: palette.panelBorder, background: totalBackground, color: palette.muted }}
              >
                Cumulative Track Record
              </td>
              <td
                className="rounded-r-2xl border-y border-r px-3 py-2.5 text-center text-[24px] font-semibold leading-none"
                colSpan={1}
                style={{ borderColor: palette.panelBorder, background: totalBackground, color: totalRowTone }}
              >
                <span className="whitespace-nowrap text-[18px] min-[769px]:text-[20px]">
                  {formatSignedPercent(totalCumulativeReturn)}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
