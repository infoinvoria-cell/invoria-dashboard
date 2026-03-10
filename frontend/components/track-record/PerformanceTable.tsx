"use client";

import { useEffect, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";

import { MONTH_LABELS, formatSignedPercent, type PerformanceRow, type TrackRecordTheme } from "@/components/track-record/metrics";
import { getTrackRecordThemePalette } from "@/components/track-record/theme";

type Props = {
  rows: PerformanceRow[];
  totalCumulativeReturn: number;
  activeMultiplier?: number;
  onMultiplierChange?: (multiplier: number) => void;
  theme: TrackRecordTheme;
};

function formatCompactSignedPercent(value: number): string {
  const pct = Number(value) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

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
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(max-width: 768px)");
    const legacyMedia = media as MediaQueryList & {
      addListener?: (listener: (event: MediaQueryListEvent) => void) => void;
      removeListener?: (listener: (event: MediaQueryListEvent) => void) => void;
    };
    const apply = (matches: boolean) => {
      setIsMobileViewport(matches);
      if (!matches) {
        setIsExpanded(false);
      }
    };

    apply(media.matches);
    const onChange = (event: MediaQueryListEvent) => apply(event.matches);
    if ("addEventListener" in media) {
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    }
    legacyMedia.addListener?.(onChange);
    return () => legacyMedia.removeListener?.(onChange);
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!isExpanded) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isExpanded]);

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

  const monthCellLabel = (value: number | null) => {
    if (value == null) return "--";
    const scaled = scaleValue(value) ?? 0;
    return isMobileViewport ? formatCompactSignedPercent(scaled) : formatSignedPercent(scaled);
  };

  const renderTableCard = (expanded = false) => (
    <section
      className={`relative overflow-hidden rounded-[24px] border p-3.5 backdrop-blur-[20px] min-[769px]:p-4 ${expanded ? "min-h-[calc(100dvh-24px)]" : ""}`}
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
        <div className="flex w-full flex-wrap items-center justify-between gap-2 min-[769px]:w-auto min-[769px]:justify-end">
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
          ) : <div />}
          {isMobileViewport ? (
            <button
              type="button"
              onClick={() => setIsExpanded((current) => !current)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border transition"
              style={{
                borderColor: expanded ? `${palette.accent}88` : palette.panelBorder,
                background: expanded ? `${palette.accent}14` : "rgba(6,10,16,0.42)",
                color: expanded ? palette.heading : palette.muted,
                boxShadow: expanded ? `0 0 10px ${palette.panelGlow}` : "none",
              }}
              aria-label={expanded ? "Close table fullscreen" : "Open table fullscreen"}
              title={expanded ? "Close table fullscreen" : "Open table fullscreen"}
            >
              {expanded ? <Minimize2 size={14} strokeWidth={1.8} /> : <Maximize2 size={14} strokeWidth={1.8} />}
            </button>
          ) : null}
        </div>
      </div>

      {isMobileViewport && !expanded ? (
        <div className="relative z-[1] mb-2 text-[9px] font-medium uppercase tracking-[0.12em]" style={{ color: palette.muted }}>
          Swipe table horizontally or open fullscreen for landscape view.
        </div>
      ) : null}

      <div className="relative z-[1] overflow-x-auto overscroll-x-contain pb-1">
        <table className="min-w-[620px] w-full table-fixed border-separate border-spacing-y-1.5 text-left tabular-nums min-[769px]:min-w-0 min-[769px]:text-[10px] xl:text-[11px]">
          <colgroup>
            <col className="w-[56px] min-[769px]:w-[64px]" />
            {MONTH_LABELS.map((month) => (
              <col key={month} className="w-[42px] min-[769px]:w-auto" />
            ))}
            <col className="w-[92px] min-[769px]:w-[96px]" />
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
                  className="border-y px-0.5 py-2.5 text-center text-[6.5px] uppercase tracking-[0.1em] min-[769px]:px-1 min-[769px]:text-[8px]"
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
                      className="border-y px-[2px] py-3 text-center text-[7px] font-semibold whitespace-nowrap min-[769px]:px-1 min-[769px]:text-[11px]"
                      style={{ borderColor: palette.panelBorder, background: rowBackground, ...toneStyle(scaleValue(value)) }}
                    >
                      {monthCellLabel(value)}
                    </td>
                  );
                })}
                <td
                  className="rounded-r-2xl border-y border-r px-1 py-3 text-center text-[10px] font-semibold whitespace-nowrap min-[769px]:px-1.5 min-[769px]:text-[11px]"
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
                Cumulative Return - {displayMultiplier}x
              </td>
              <td
                className="rounded-r-2xl border-y border-r py-3 pl-2 pr-5 text-right font-semibold leading-none min-[769px]:pl-3 min-[769px]:pr-7"
                style={{ borderColor: palette.panelBorder, background: totalBackground, color: totalRowTone }}
              >
                <span className="whitespace-nowrap text-[19px] font-semibold min-[769px]:text-[22px] xl:text-[24px]">
                  {formatSignedPercent(totalCumulativeReturn * displayMultiplier)}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );

  return (
    <>
      {renderTableCard(false)}
      {isExpanded ? (
        <div
          className="fixed inset-0 z-[120] overflow-auto bg-[rgba(4,6,10,0.94)] p-3"
          style={{
            paddingTop: "max(12px, env(safe-area-inset-top))",
            paddingBottom: "max(12px, env(safe-area-inset-bottom))",
          }}
        >
          {renderTableCard(true)}
        </div>
      ) : null}
    </>
  );
}
