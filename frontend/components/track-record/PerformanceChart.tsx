"use client";

import { useEffect, useMemo, useState } from "react";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { ChartPoint, ChartViewMode, MultiplierKey, TrackRecordTheme } from "@/components/track-record/metrics";
import { formatSignedPercent, getChartDataForMode } from "@/components/track-record/metrics";
import { getTrackRecordThemePalette } from "@/components/track-record/theme";

const CURVES: Array<{ key: MultiplierKey; label: string }> = [
  { key: "curve1x", label: "1x" },
  { key: "curve2x", label: "2x" },
  { key: "curve3x", label: "3x" },
  { key: "curve4x", label: "4x" },
  { key: "curve5x", label: "5x" },
];

type Props = {
  chartData: ChartPoint[];
  activeMultipliers: number[];
  onMultiplierChange: (multipliers: number[]) => void;
  chartMode: ChartViewMode;
  onChartModeChange: (mode: ChartViewMode) => void;
  theme: TrackRecordTheme;
};

const CHART_MODE_OPTIONS: Array<{ value: ChartViewMode; label: string }> = [
  { value: "regular", label: "Regular" },
  { value: "warped", label: "Warped" },
  { value: "smooth", label: "Smooth" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
];

export default function PerformanceChart({
  chartData,
  activeMultipliers,
  onMultiplierChange,
  chartMode,
  onChartModeChange,
  theme,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const palette = getTrackRecordThemePalette(theme);
  const visibleChartData = useMemo(() => getChartDataForMode(chartData, chartMode), [chartData, chartMode]);
  const sortedActiveMultipliers = useMemo(() => [...activeMultipliers].sort((left, right) => left - right), [activeMultipliers]);

  useEffect(() => {
    setMounted(true);
  }, []);

  const getCurveStroke = (curveKey: MultiplierKey) =>
    curveKey === "curve1x"
      ? palette.chart.curve1x
      : curveKey === "curve2x"
        ? palette.chart.curve2x
        : curveKey === "curve3x"
          ? palette.chart.curve3x
          : curveKey === "curve4x"
            ? palette.chart.curve4x
            : palette.chart.curve5x;

  const toggleMultiplier = (multiplier: number) => {
    const isActive = sortedActiveMultipliers.includes(multiplier);
    if (isActive && sortedActiveMultipliers.length === 1) {
      return;
    }

    const next = isActive
      ? sortedActiveMultipliers.filter((value) => value !== multiplier)
      : [...sortedActiveMultipliers, multiplier].sort((left, right) => left - right);

    onMultiplierChange(next);
  };

  const createLastPointRenderer = (curveKey: MultiplierKey, multiplier: number, labelOffsetIndex: number) => {
    function LastPointRenderer(props: any) {
      if (props.index !== visibleChartData.length - 1) return null;

      const cx = Number(props.cx);
      const cy = Number(props.cy);

      if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;

      const label = formatSignedPercent(Number(props.value ?? 0) / 100);
      const labelWidth = Math.max(54, label.length * 7 + 16);
      const verticalOffset = (labelOffsetIndex - (sortedActiveMultipliers.length - 1) / 2) * 18;
      const stroke = getCurveStroke(curveKey);

      return (
        <g>
          <circle cx={cx} cy={cy} r={3.5} fill={stroke} stroke="rgba(5,8,12,0.95)" strokeWidth={1.5} />
          <g transform={`translate(${cx + 10}, ${cy - 13 + verticalOffset})`}>
            <rect
              width={labelWidth}
              height={24}
              rx={8}
              fill="rgba(6,10,16,0.88)"
              stroke={palette.panelBorder}
              filter={multiplier === 5 ? "url(#track-record-end-glow)" : undefined}
            />
            <text x={labelWidth / 2} y={15} textAnchor="middle" fill={palette.heading} fontSize={11} fontWeight={700}>
              {label}
            </text>
          </g>
        </g>
      );
    }

    return LastPointRenderer;
  };

  return (
    <section
      className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-[24px] border px-4 pb-4 pt-3.5 backdrop-blur-[20px] min-[769px]:px-5 min-[769px]:pb-[18px] min-[769px]:pt-4"
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
              ? "radial-gradient(1200px 520px at 12% 8%, rgba(214,195,143,0.24), transparent 48%), linear-gradient(120deg, rgba(255,255,255,0.07), transparent 28%), linear-gradient(180deg, rgba(255,255,255,0.03), transparent 22%)"
              : "radial-gradient(1200px 520px at 12% 8%, rgba(77,135,254,0.24), transparent 48%), linear-gradient(120deg, rgba(255,255,255,0.07), transparent 28%), linear-gradient(180deg, rgba(255,255,255,0.03), transparent 22%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-x-6 top-0 h-px"
        style={{ background: theme === "dark" ? "rgba(255,243,212,0.20)" : "rgba(218,232,255,0.18)" }}
      />

      <div className="relative z-[1] mb-3 flex flex-col items-start gap-3 min-[769px]:flex-row min-[769px]:items-center min-[769px]:justify-between">
        <div className="text-[14px] font-semibold uppercase tracking-[0.22em] min-[769px]:text-[15px]" style={{ color: palette.heading }}>
          Performance Chart
        </div>

        <div className="flex w-full flex-wrap items-center gap-2 min-[769px]:w-auto min-[769px]:justify-end">
          <div
            className="rounded-full border px-2"
            style={{
              borderColor: palette.panelBorder,
              background: "rgba(6,10,16,0.38)",
            }}
          >
            <select
              aria-label="Chart mode"
              value={chartMode}
              onChange={(event) => onChartModeChange(event.target.value as ChartViewMode)}
              className="h-7 bg-transparent pr-4 text-[10px] font-semibold uppercase tracking-[0.12em] outline-none"
              style={{ color: palette.heading }}
            >
              {CHART_MODE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value} style={{ background: theme === "dark" ? "#0b0b0d" : "#071325" }}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {CURVES.map((curve, index) => {
            const multiplier = index + 1;
            const isActive = sortedActiveMultipliers.includes(multiplier);

            return (
              <button
                key={curve.key}
                type="button"
                onClick={() => toggleMultiplier(multiplier)}
                className="inline-flex h-7 min-w-[32px] items-center justify-center rounded-full border px-2 text-[11px] font-semibold transition"
                style={{
                  borderColor: isActive ? `${palette.accent}88` : palette.panelBorder,
                  background: isActive ? `${palette.accent}10` : "rgba(6,10,16,0.42)",
                  color: isActive ? palette.heading : palette.muted,
                  boxShadow: isActive ? `0 0 8px ${palette.panelGlow}` : "none",
                }}
              >
                {curve.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="relative z-[1] min-h-[320px] flex-1 min-[769px]:min-h-[420px]">
        {mounted ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={visibleChartData} margin={{ top: 10, right: 92, left: 0, bottom: 2 }}>
              <defs>
                <filter id="track-record-end-glow" x="-40%" y="-40%" width="180%" height="180%">
                  <feGaussianBlur stdDeviation="4" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              <CartesianGrid stroke={palette.grid} strokeDasharray="2 8" vertical={false} />
              <XAxis
                dataKey="date"
                minTickGap={28}
                tickMargin={14}
                stroke={palette.grid}
                tick={{ fill: palette.muted, fontSize: 12 }}
              />
              <YAxis
                width={68}
                tickMargin={10}
                stroke={palette.grid}
                tick={{ fill: palette.muted, fontSize: 12 }}
                tickFormatter={(value: number) => `${Math.round(value)}%`}
              />
              <Tooltip
                contentStyle={{
                  borderRadius: 16,
                  border: `1px solid ${palette.panelBorder}`,
                  background: "rgba(7,10,15,0.96)",
                  boxShadow: "0 20px 40px rgba(0,0,0,0.45)",
                }}
                labelStyle={{ color: palette.heading, fontWeight: 600 }}
                formatter={(value, name) => [
                  formatSignedPercent(Number(value ?? 0) / 100),
                  String(name ?? "").replace("curve", "").toLowerCase(),
                ]}
              />
              {sortedActiveMultipliers.map((multiplier, activeIndex) => {
                const curveKey = `curve${multiplier}x` as MultiplierKey;
                const stroke = getCurveStroke(curveKey);

                return (
                  <Line
                    key={curveKey}
                    type={chartMode === "monthly" || chartMode === "quarterly" || chartMode === "yearly" ? "linear" : "monotone"}
                    dataKey={curveKey}
                    name={`${multiplier}x`}
                    stroke={stroke}
                    strokeWidth={multiplier === 1 ? 2.6 : 2.3}
                    strokeOpacity={1}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    dot={createLastPointRenderer(curveKey, multiplier, activeIndex)}
                    activeDot={{ r: 4, fill: stroke, stroke: "#0b0f14", strokeWidth: 2 }}
                    isAnimationActive={false}
                    style={
                      multiplier === 5
                        ? {
                            filter:
                              theme === "dark"
                                ? "drop-shadow(0 0 10px rgba(245,212,123,0.48))"
                                : "drop-shadow(0 0 10px rgba(77,200,255,0.44))",
                          }
                        : undefined
                    }
                  />
                );
              })}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full rounded-[20px] border" style={{ borderColor: palette.panelBorder, background: "rgba(7,10,15,0.72)" }} />
        )}

        <div className="pointer-events-none absolute bottom-10 right-4 z-[2] min-[769px]:bottom-12 min-[769px]:right-5">
          <img src={palette.watermarkLogo} alt="" className="h-8 w-auto opacity-60 min-[769px]:h-10" />
        </div>
      </div>
    </section>
  );
}
