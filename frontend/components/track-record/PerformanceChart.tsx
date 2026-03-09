"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type {
  ChartPoint,
  ChartViewMode,
  ComparisonAssetId,
  ComparisonKey,
  MultiplierKey,
  TrackRecordTheme,
} from "@/components/track-record/metrics";
import { formatSignedPercent, getChartDataForMode } from "@/components/track-record/metrics";
import { getTrackRecordThemePalette } from "@/components/track-record/theme";

const CURVES: Array<{ key: MultiplierKey; label: string }> = [
  { key: "curve1x", label: "1x" },
  { key: "curve2x", label: "2x" },
  { key: "curve3x", label: "3x" },
  { key: "curve4x", label: "4x" },
  { key: "curve5x", label: "5x" },
];

type ComparisonOption = {
  id: ComparisonAssetId;
  key: ComparisonKey;
  label: string;
  shortLabel: string;
  correlation: number;
  isLoaded: boolean;
  color?: string;
};

type Props = {
  chartData: ChartPoint[];
  activeMultipliers: number[];
  onMultiplierChange: (multipliers: number[]) => void;
  chartMode: ChartViewMode;
  onChartModeChange: (mode: ChartViewMode) => void;
  comparisonOptions?: ComparisonOption[];
  activeComparisons?: ComparisonAssetId[];
  onComparisonChange?: (comparisons: ComparisonAssetId[]) => void;
  theme: TrackRecordTheme;
  onRefreshData?: () => void;
  isRefreshing?: boolean;
};

const CHART_MODE_OPTIONS: Array<{ value: ChartViewMode; label: string }> = [
  { value: "regular", label: "Regular" },
  { value: "warped", label: "Warped" },
  { value: "smooth", label: "Smooth" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
];

type ActiveLine = {
  id: string;
  dataKey: MultiplierKey | ComparisonKey;
  label: string;
  endLabel: string;
  stroke: string;
  width: number;
  glow: boolean;
  dashed?: boolean;
};

export default function PerformanceChart({
  chartData,
  activeMultipliers,
  onMultiplierChange,
  chartMode,
  onChartModeChange,
  comparisonOptions = [],
  activeComparisons = [],
  onComparisonChange,
  theme,
  onRefreshData,
  isRefreshing = false,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [compareMenuOpen, setCompareMenuOpen] = useState(false);
  const compareMenuRef = useRef<HTMLDivElement | null>(null);
  const palette = getTrackRecordThemePalette(theme);
  const visibleChartData = useMemo(() => getChartDataForMode(chartData, chartMode), [chartData, chartMode]);
  const sortedActiveMultipliers = useMemo(() => [...activeMultipliers].sort((left, right) => left - right), [activeMultipliers]);
  const sortedActiveComparisons = useMemo(
    () => comparisonOptions.filter((option) => activeComparisons.includes(option.id)),
    [activeComparisons, comparisonOptions],
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!compareMenuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!compareMenuRef.current) return;
      if (compareMenuRef.current.contains(event.target as Node)) return;
      setCompareMenuOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [compareMenuOpen]);

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

  const getComparisonStroke = (comparisonKey: ComparisonKey, fallbackColor?: string) =>
    fallbackColor
      || (comparisonKey === "compareSp500" ? palette.chart.compareSp500 : palette.chart.compareDax40);

  const activeLines = useMemo<ActiveLine[]>(() => {
    const multiplierLines = sortedActiveMultipliers.map((multiplier) => {
      const curveKey = `curve${multiplier}x` as MultiplierKey;
      return {
        id: curveKey,
        dataKey: curveKey,
        label: `${multiplier}x`,
        endLabel: `${multiplier}x`,
        stroke: getCurveStroke(curveKey),
        width: multiplier === 1 ? 2.6 : 2.3,
        glow: multiplier === 5,
      };
    });

    const comparisonLines = sortedActiveComparisons.map((comparison) => ({
      id: comparison.id,
      dataKey: comparison.key,
      label: `${comparison.label} (corr ${comparison.correlation.toFixed(2)})`,
      endLabel: comparison.label,
      stroke: getComparisonStroke(comparison.key, comparison.color),
      width: 2.05,
      glow: false,
      dashed: true,
    }));

    return [...multiplierLines, ...comparisonLines];
  }, [sortedActiveComparisons, sortedActiveMultipliers]);

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

  const toggleComparison = (comparisonId: ComparisonAssetId) => {
    if (!onComparisonChange) return;
    const isActive = activeComparisons.includes(comparisonId);
    const next = isActive
      ? activeComparisons.filter((value) => value !== comparisonId)
      : [...activeComparisons, comparisonId];
    onComparisonChange(next);
  };

  const createLastPointRenderer = (line: ActiveLine, labelOffsetIndex: number) => {
    function LastPointRenderer(props: any) {
      if (props.index !== visibleChartData.length - 1) return null;

      const cx = Number(props.cx);
      const cy = Number(props.cy);
      if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;

      const label = formatSignedPercent(Number(props.value ?? 0) / 100);
      const labelWidth = Math.max(54, label.length * 7 + 16);
      const verticalOffset = (labelOffsetIndex - (activeLines.length - 1) / 2) * 18;

      return (
        <g>
          <circle cx={cx} cy={cy} r={3.5} fill={line.stroke} stroke="rgba(5,8,12,0.95)" strokeWidth={1.5} />
          <g transform={`translate(${cx + 10}, ${cy - 13 + verticalOffset})`}>
            <rect
              width={labelWidth}
              height={24}
              rx={8}
              fill="rgba(6,10,16,0.88)"
              stroke={palette.panelBorder}
              filter={line.glow ? "url(#track-record-end-glow)" : undefined}
            />
            <text x={labelWidth / 2} y={15} textAnchor="middle" fill={line.stroke} fontSize={11} fontWeight={700}>
              {label}
            </text>
          </g>
        </g>
      );
    }

    return LastPointRenderer;
  };

  const activeComparisonLabels = sortedActiveComparisons.map((comparison) => comparison.label);
  const compareButtonLabel = activeComparisons.length === 0
    ? "Compare"
    : activeComparisons.length <= 2
      ? activeComparisonLabels.join(" + ")
      : `Compare ${activeComparisons.length}`;
  const chartLineType = chartMode === "monthly" || chartMode === "quarterly" || chartMode === "yearly" ? "linear" : "monotone";

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

          <div className="flex items-center gap-2">
            {comparisonOptions.map((comparison) => {
              const isActive = activeComparisons.includes(comparison.id);
              const comparisonColor = getComparisonStroke(comparison.key, comparison.color);
              return (
                <button
                  key={comparison.id}
                  type="button"
                  onClick={() => toggleComparison(comparison.id)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full border transition"
                  style={{
                    borderColor: isActive ? `${comparisonColor}88` : palette.panelBorder,
                    background: isActive ? `${comparisonColor}18` : "rgba(6,10,16,0.42)",
                    boxShadow: isActive ? `0 0 10px ${comparisonColor}20` : "none",
                  }}
                  title={`Toggle ${comparison.label}`}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                >
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: comparisonColor }} />
                </button>
              );
            })}
          </div>

          <div
            className="relative z-[30]"
            ref={compareMenuRef}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={compareMenuOpen}
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={() => setCompareMenuOpen((current) => !current)}
              className="relative z-[31] flex h-7 cursor-pointer items-center justify-center rounded-full border px-3 text-[10px] font-semibold uppercase tracking-[0.12em] transition"
              style={{
                borderColor: compareMenuOpen || activeComparisons.length > 0 ? `${palette.accent}88` : palette.panelBorder,
                background: compareMenuOpen || activeComparisons.length > 0 ? `${palette.accent}14` : "rgba(6,10,16,0.42)",
                color: activeComparisons.length > 0 ? palette.heading : palette.muted,
                boxShadow: compareMenuOpen || activeComparisons.length > 0 ? `0 0 10px ${palette.panelGlow}` : "none",
              }}
            >
              {compareButtonLabel}
            </button>
            {compareMenuOpen ? (
              <div
                className="absolute right-0 top-9 z-[40] min-w-[220px] rounded-[14px] border p-2 shadow-2xl"
                style={{ borderColor: palette.panelBorder, background: "rgba(6,10,16,0.96)" }}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
              >
                <div className="mb-1.5 px-1 text-[9px] font-semibold uppercase tracking-[0.14em]" style={{ color: palette.muted }}>
                  Compare Assets
                </div>
                {comparisonOptions.map((comparison) => {
                  const isActive = activeComparisons.includes(comparison.id);
                  const comparisonColor = getComparisonStroke(comparison.key, comparison.color);
                  return (
                    <button
                      key={comparison.id}
                      type="button"
                      aria-pressed={isActive}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                      }}
                      onClick={() => toggleComparison(comparison.id)}
                      className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-[10px] border px-2.5 py-2 text-left text-[11px] transition"
                      style={{
                        borderColor: isActive ? `${comparisonColor}88` : "transparent",
                        background: isActive ? `${comparisonColor}18` : "transparent",
                        color: isActive ? comparisonColor : palette.text,
                        opacity: comparison.isLoaded ? 1 : 0.78,
                        boxShadow: isActive ? `0 0 12px ${comparisonColor}22` : "none",
                      }}
                    >
                      <span className="inline-flex items-center gap-2">
                        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: comparisonColor }} />
                        <span>{comparison.label}</span>
                      </span>
                      <span className="inline-flex items-center gap-2">
                        <span style={{ color: isActive ? comparisonColor : palette.muted }}>
                          {comparison.isLoaded ? comparison.correlation.toFixed(2) : "Loading"}
                        </span>
                        <span
                          className="inline-flex min-w-[18px] items-center justify-center text-[12px] font-semibold"
                          style={{ color: isActive ? comparisonColor : palette.muted }}
                        >
                          {isActive ? "ON" : "+"}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>

          {onRefreshData ? (
            <button
              type="button"
              onClick={onRefreshData}
              className="inline-flex h-7 items-center justify-center rounded-full border px-3 text-[10px] font-semibold uppercase tracking-[0.12em] transition"
              style={{
                borderColor: palette.panelBorder,
                background: "rgba(6,10,16,0.42)",
                color: palette.muted,
              }}
            >
              {isRefreshing ? "Refreshing" : "Refresh"}
            </button>
          ) : null}

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
        {sortedActiveComparisons.length ? (
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.1em]">
            {sortedActiveComparisons.map((comparison) => {
              const comparisonColor = getComparisonStroke(comparison.key, comparison.color);
              return (
                <span
                  key={`${comparison.id}-legend`}
                  className="inline-flex items-center gap-2 rounded-full border px-2.5 py-1"
                  style={{
                    borderColor: `${comparisonColor}66`,
                    background: `${comparisonColor}12`,
                    color: comparisonColor,
                  }}
                >
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: comparisonColor }} />
                  <span>{comparison.label}</span>
                </span>
              );
            })}
          </div>
        ) : null}
        {mounted ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={visibleChartData} margin={{ top: 10, right: activeLines.length > 3 ? 132 : 92, left: 0, bottom: 2 }}>
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
                formatter={(value, name) => [formatSignedPercent(Number(value ?? 0) / 100), String(name ?? "")]}
              />
              {activeLines.map((line, activeIndex) => (
                <Line
                  key={line.id}
                  type={chartLineType}
                  dataKey={line.dataKey}
                  name={line.label}
                  stroke={line.stroke}
                  strokeWidth={line.width}
                  strokeOpacity={1}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray={line.dashed ? "7 5" : undefined}
                  dot={createLastPointRenderer(line, activeIndex)}
                  activeDot={{ r: 4, fill: line.stroke, stroke: "#0b0f14", strokeWidth: 2 }}
                  isAnimationActive={false}
                  connectNulls
                  style={
                    line.glow
                      ? {
                          filter:
                            theme === "dark"
                              ? "drop-shadow(0 0 10px rgba(245,212,123,0.48))"
                              : "drop-shadow(0 0 10px rgba(77,200,255,0.44))",
                        }
                      : undefined
                  }
                />
              ))}
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
