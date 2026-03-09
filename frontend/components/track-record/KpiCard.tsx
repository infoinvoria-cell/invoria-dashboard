"use client";

import type { ReactNode } from "react";

import type { TrackRecordTheme } from "@/components/track-record/metrics";
import Sparkline from "@/components/track-record/Sparkline";
import { getTrackRecordThemePalette } from "@/components/track-record/theme";

type Tone = "positive" | "negative" | "neutral" | "success";

type Props = {
  title: string;
  value: string;
  footer?: string;
  sparkline?: number[];
  score?: number;
  rating?: string;
  tone?: Tone;
  theme: TrackRecordTheme;
  children?: ReactNode;
};

export default function KpiCard({
  title,
  value,
  footer,
  sparkline,
  score,
  rating,
  tone = "neutral",
  theme,
  children,
}: Props) {
  const palette = getTrackRecordThemePalette(theme);
  const sparkColor = tone === "negative" ? palette.negative : tone === "success" ? palette.success : palette.accent;
  const hasCustomContent = Boolean(children);
  const hasSparklineLayout = Boolean(!hasCustomContent && sparkline && score == null);
  const labelColor = theme === "dark" ? palette.accent : palette.heading;
  const valueColor =
    tone === "negative"
      ? palette.negative
      : tone === "success"
        ? palette.success
        : tone === "positive"
          ? palette.positive
          : palette.heading;

  return (
    <article
      className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-[20px] border p-[18px] backdrop-blur-[20px]"
      style={{
        background: palette.panelBackground,
        borderColor: palette.panelBorder,
        boxShadow: palette.panelShadow,
      }}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            theme === "dark"
              ? "linear-gradient(135deg, rgba(255,255,255,0.06), transparent 34%), radial-gradient(280px 120px at 85% 0%, rgba(214,195,143,0.18), transparent 60%), linear-gradient(180deg, rgba(255,255,255,0.02), transparent 24%)"
              : "linear-gradient(135deg, rgba(255,255,255,0.06), transparent 34%), radial-gradient(280px 120px at 85% 0%, rgba(77,135,254,0.18), transparent 60%), linear-gradient(180deg, rgba(255,255,255,0.02), transparent 24%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-x-5 top-0 h-px"
        style={{ background: theme === "dark" ? "rgba(255,243,212,0.18)" : "rgba(218,232,255,0.16)" }}
      />

      <div className="relative z-[1] mb-1.5 flex items-start justify-between gap-2">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.2em]" style={{ color: labelColor }}>
            {title}
          </div>
          <div className="mt-2 text-[20px] font-semibold leading-none min-[769px]:text-[22px]" style={{ color: valueColor }}>
            {value}
          </div>
        </div>
        {rating ? (
          <div
            className="rounded-full border px-2 py-0.5 text-[8px] font-semibold uppercase tracking-[0.14em]"
            style={{
              borderColor: theme === "dark" ? "rgba(214,195,143,0.34)" : "rgba(111,165,255,0.34)",
              background: theme === "dark" ? "rgba(68,52,24,0.78)" : "rgba(17,45,108,0.78)",
              color: theme === "dark" ? "#fff3cf" : "#ffffff",
            }}
          >
            {rating}
          </div>
        ) : null}
      </div>

      <div className="relative z-[1] flex min-h-0 flex-1 flex-col overflow-visible">
        {children}

        {hasSparklineLayout ? (
          <div className="grid min-h-0 flex-1 grid-cols-1 items-center gap-3 min-[769px]:grid-cols-[minmax(0,1fr)_minmax(110px,0.92fr)]">
            <div className="min-w-0">
              <div className="text-[10px] leading-4" style={{ color: palette.muted }}>
                {footer}
              </div>
            </div>
            <div className="min-w-0">
              <Sparkline data={sparkline ?? []} color={sparkColor} negative={tone === "negative"} theme={theme} />
            </div>
          </div>
        ) : null}

        {!children && !hasSparklineLayout && sparkline ? (
          <Sparkline data={sparkline} color={sparkColor} negative={tone === "negative"} theme={theme} />
        ) : null}

        {score != null ? (
          <div className="mt-2 space-y-1">
            <div className="h-1.5 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.06)" }}>
              <div
                className="h-full rounded-full"
                style={{
                  width: `${score}%`,
                  background:
                    theme === "dark"
                      ? "linear-gradient(90deg, #a88a62 0%, #d6c38f 55%, #f8f0df 100%)"
                      : "linear-gradient(90deg, #4d87fe 0%, #8fb6ff 55%, #dce8ff 100%)",
                }}
              />
            </div>
            <div className="flex items-center justify-between gap-3 text-[9px] font-semibold uppercase tracking-[0.14em]">
              <span style={{ color: palette.heading }}>{rating}</span>
              <span style={{ color: palette.muted }}>{score}/100</span>
            </div>
          </div>
        ) : null}

        {footer && !hasSparklineLayout ? (
          <div className={hasCustomContent ? "mt-auto pt-1 text-[10px] leading-4" : "mt-1.5 text-[10px] leading-4"} style={{ color: palette.muted }}>
            {footer}
          </div>
        ) : null}
      </div>
    </article>
  );
}
