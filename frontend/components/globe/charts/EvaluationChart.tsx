import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ColorType,
  CrosshairMode,
  LineStyle,
  LineSeries,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
  createChart,
} from "lightweight-charts";

import type { EvaluationResponse } from "../../../types";

type Props = {
  payload: EvaluationResponse | null;
  mode?: "v10" | "v20";
  syncRange?: { visibleSpan: number; rightOffset: number } | null;
  loopReplayTick?: number;
};

type EvalLabel = {
  id: string;
  text: string;
  color: string;
  top: number;
};

type LineMeta = {
  id: string;
  code: string;
  lastValue: number;
  series: ISeriesApi<"Line">;
  color: string;
};

type ThresholdLine = {
  owner: ISeriesApi<"Line">;
  line: IPriceLine;
};

const HIGH_THRESHOLD = 75;
const LOW_THRESHOLD = -75;
const HIGH_COLOR = "#ff384c";
const LOW_COLOR = "#39ff40";

type SymbolCode = "COMB" | "XAU" | "USD" | "US10Y";
type SymbolMeta = { code: "XAU" | "USD" | "US10Y"; rank: number };

function toTs(value: string): UTCTimestamp {
  return Math.floor(new Date(value).getTime() / 1000) as UTCTimestamp;
}

function matchSymbol(row: { label?: string; id?: string; symbol?: string }): SymbolMeta | null {
  const l = `${String(row.label || "")} ${String(row.id || "")} ${String(row.symbol || "")}`.toLowerCase();
  if (l.includes("gold")) return { code: "XAU", rank: 1 };
  if (l.includes("dollar") || l.includes("dxy") || l.includes("usd")) return { code: "USD", rank: 2 };
  if (l.includes("10y") || l.includes("bond") || l.includes("anleihe")) return { code: "US10Y", rank: 3 };
  return null;
}

function colorForCode(code: SymbolCode): string {
  if (code === "COMB") return "#2962ff";
  if (code === "XAU") return "#ffeb3b";
  if (code === "USD") return "#4caf50";
  return "#ff6f8d";
}

function labelForCode(code: SymbolCode): string {
  if (code === "COMB") return "Combined";
  if (code === "XAU") return "Gold";
  if (code === "USD") return "Dollar";
  return "US10Y";
}

function stateForValue(value: number): "base" | "high" | "low" {
  if (value > HIGH_THRESHOLD) return "high";
  if (value < LOW_THRESHOLD) return "low";
  return "base";
}

function colorForState(state: "base" | "high" | "low", baseColor: string): string {
  if (state === "high") return HIGH_COLOR;
  if (state === "low") return LOW_COLOR;
  return baseColor;
}

function addSegmentedLineSeries(
  chart: IChartApi,
  points: Array<{ time: UTCTimestamp; value: number }>,
  baseColor: string,
  lineWidth: 1 | 2,
): { anchor: ISeriesApi<"Line"> | null; all: Array<ISeriesApi<"Line">> } {
  if (!points.length) return { anchor: null, all: [] };
  if (points.length === 1) {
    const single = chart.addSeries(LineSeries, {
      color: baseColor,
      lineWidth,
      lastValueVisible: false,
      priceLineVisible: false,
    });
    single.setData(points);
    return { anchor: single, all: [single] };
  }

  const all: Array<ISeriesApi<"Line">> = [];
  let anchor: ISeriesApi<"Line"> | null = null;
  let currentState = stateForValue(points[0].value);
  let segment: Array<{ time: UTCTimestamp; value: number }> = [points[0]];

  const flushSegment = (data: Array<{ time: UTCTimestamp; value: number }>, state: "base" | "high" | "low") => {
    if (data.length < 2) return;
    const width = state === "base" ? lineWidth : Math.max(2, lineWidth * 2);
    const segSeries = chart.addSeries(LineSeries, {
      color: colorForState(state, baseColor),
      lineWidth: width as 1 | 2 | 3 | 4,
      lastValueVisible: false,
      priceLineVisible: false,
    });
    segSeries.setData(data);
    all.push(segSeries);
    anchor = segSeries;
  };

  for (let i = 1; i < points.length; i += 1) {
    const point = points[i];
    const nextState = stateForValue(point.value);
    if (nextState === currentState) {
      segment.push(point);
      continue;
    }
    flushSegment([...segment, point], currentState);
    segment = [points[i - 1], point];
    currentState = nextState;
  }

  flushSegment(segment, currentState);

  if (!anchor) {
    const fallback = chart.addSeries(LineSeries, {
      color: baseColor,
      lineWidth,
      lastValueVisible: false,
      priceLineVisible: false,
    });
    fallback.setData(points);
    all.push(fallback);
    anchor = fallback;
  }
  return { anchor, all };
}

export default function EvaluationChart({ payload, mode = "v20", syncRange = null, loopReplayTick = 0 }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRefs = useRef<Array<ISeriesApi<"Line">>>([]);
  const linesRef = useRef<LineMeta[]>([]);
  const thresholdLinesRef = useRef<ThresholdLine[]>([]);
  const updateLabelsRef = useRef<() => void>(() => {});
  const [labels, setLabels] = useState<EvalLabel[]>([]);

  const dataCount = useMemo(
    () =>
      Math.max(
        1,
        ...((payload?.series ?? []).map((row) =>
          row.points.reduce((acc, pt) => {
            const v = mode === "v10" ? (pt.v10 ?? pt.v20) : (pt.v20 ?? pt.v10);
            return acc + (v == null || Number.isNaN(v) ? 0 : 1);
          }, 0),
        )),
      ),
    [mode, payload],
  );

  const applySyncRange = useCallback(
    (chart: IChartApi) => {
      if (syncRange?.visibleSpan == null || syncRange?.rightOffset == null) {
        chart.timeScale().fitContent();
        return;
      }
      const span = Math.max(20, Math.min(220, Number(syncRange.visibleSpan)));
      const right = Math.max(0, Math.min(28, Number(syncRange.rightOffset)));
      const to = (dataCount - 1) + right;
      const from = Math.max(-5, to - span);
      chart.timeScale().setVisibleLogicalRange({ from, to });
    },
    [dataCount, syncRange],
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const chart = createChart(host, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#90a5c0",
        fontSize: 10,
        attributionLogo: false,
      },
      rightPriceScale: {
        borderColor: "rgba(109,132,160,0.35)",
        autoScale: true,
        scaleMargins: { top: 0.08, bottom: 0.12 },
        minimumWidth: 54,
      },
      timeScale: {
        borderColor: "rgba(109,132,160,0.35)",
        rightOffset: 12,
        barSpacing: 7.6,
      },
      grid: {
        vertLines: { color: "rgba(0,0,0,0)" },
        horzLines: { color: "rgba(0,0,0,0)" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: "rgba(170,194,226,0.38)",
          width: 1,
          style: 0,
          labelBackgroundColor: "rgba(30,44,70,0.92)",
        },
        horzLine: {
          color: "rgba(170,194,226,0.38)",
          width: 1,
          style: 0,
          labelBackgroundColor: "rgba(30,44,70,0.92)",
        },
      },
      handleScroll: false,
      handleScale: false,
      localization: {
        locale: "en-US",
      },
    });
    chartRef.current = chart;

    const updateLabels = () => {
      const c = chartRef.current;
      const hostEl = hostRef.current;
      if (!c || !hostEl) return;
      const h = hostEl.clientHeight || 1;

      const rows = linesRef.current
        .map((line) => {
          const y = line.series.priceToCoordinate(line.lastValue);
          if (y == null || !Number.isFinite(y)) return null;
          return {
            id: line.id,
            text: `${labelForCode(line.code as SymbolCode)} ${line.lastValue.toFixed(1)}`,
            color: line.color,
            y: Number(y),
          };
        })
        .filter((r): r is { id: string; text: string; color: string; y: number } => r !== null)
        .sort((a, b) => a.y - b.y);

      const minGap = 9;
      const out: EvalLabel[] = [];
      let prevY = -1000;
      for (const row of rows) {
        let y = row.y;
        if (y < 8) y = 8;
        if (y > h - 10) y = h - 10;
        if (y < prevY + minGap) y = prevY + minGap;
        if (y > h - 8) y = h - 8;
        prevY = y;
        out.push({
          id: row.id,
          text: row.text,
          color: row.color,
          top: y,
        });
      }
      setLabels(out);
    };
    updateLabelsRef.current = updateLabels;

    chart.timeScale().subscribeVisibleLogicalRangeChange(updateLabels);
    chart.timeScale().subscribeVisibleTimeRangeChange(updateLabels);
    const refreshTimer = window.setInterval(updateLabels, 120);
    const hostObserver = new ResizeObserver(() => updateLabels());
    hostObserver.observe(host);

    return () => {
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(updateLabels);
      chart.timeScale().unsubscribeVisibleTimeRangeChange(updateLabels);
      window.clearInterval(refreshTimer);
      hostObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRefs.current = [];
      linesRef.current = [];
      thresholdLinesRef.current = [];
      updateLabelsRef.current = () => {};
      setLabels([]);
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    let loopAnimFrame: number | null = null;

    for (const entry of thresholdLinesRef.current) {
      try {
        entry.owner.removePriceLine(entry.line);
      } catch (_err) {
        // no-op
      }
    }
    thresholdLinesRef.current = [];

    for (const series of seriesRefs.current) {
      try {
        chart.removeSeries(series);
      } catch (_err) {
        // no-op
      }
    }
    seriesRefs.current = [];
    linesRef.current = [];

    const used = new Set<string>();
    const outLines: Array<LineMeta & { rank: number }> = [];
    const loopTargets: Array<{
      series: ISeriesApi<"Line">;
      data: Array<{ time: UTCTimestamp; value: number }>;
      line: LineMeta & { rank: number };
    }> = [];
    const coreData = new Map<"XAU" | "USD" | "US10Y", Array<{ time: UTCTimestamp; value: number }>>();

    const loopVisibleSpan = Math.max(24, Math.min(220, Number(syncRange?.visibleSpan ?? 110)));

    for (let i = 0; i < (payload?.series ?? []).length; i += 1) {
      const row = payload!.series[i];
      const symbol = matchSymbol(row);
      if (!symbol || used.has(symbol.code)) continue;

      const points = row.points
        .map((pt) => {
          const v = mode === "v10" ? (pt.v10 ?? pt.v20) : (pt.v20 ?? pt.v10);
          if (v == null || Number.isNaN(v)) return null;
          return {
            time: toTs(pt.t),
            value: Number(v),
          };
        })
        .filter((pt): pt is { time: UTCTimestamp; value: number } => pt !== null);
      if (!points.length) continue;
      const pointsVisible = loopReplayTick > 0 ? points.slice(Math.max(0, points.length - loopVisibleSpan)) : points;
      if (!pointsVisible.length) continue;

      coreData.set(symbol.code, pointsVisible);
      used.add(symbol.code);

      const color = colorForCode(symbol.code);
      if (loopReplayTick > 0) {
        const simple = chart.addSeries(LineSeries, {
          color,
          lineWidth: 1,
          lastValueVisible: false,
          priceLineVisible: false,
        });
        const seed = pointsVisible.slice(0, Math.max(2, Math.min(3, pointsVisible.length)));
        simple.setData(seed);
        seriesRefs.current.push(simple);
        const line = {
          id: `${row.id}-${mode}`,
          code: symbol.code,
          rank: symbol.rank,
          lastValue: seed[seed.length - 1]?.value ?? pointsVisible[pointsVisible.length - 1].value,
          series: simple,
          color,
        };
        outLines.push(line);
        loopTargets.push({
          series: simple,
          data: pointsVisible,
          line,
        });
      } else {
        const segmented = addSegmentedLineSeries(chart, points, color, 1);
        if (!segmented.anchor) continue;
        seriesRefs.current.push(...segmented.all);
        outLines.push({
          id: `${row.id}-${mode}`,
          code: symbol.code,
          rank: symbol.rank,
            lastValue: pointsVisible[pointsVisible.length - 1].value,
            series: segmented.anchor,
            color,
          });
      }
    }

    const xau = coreData.get("XAU") ?? [];
    const usd = coreData.get("USD") ?? [];
    const us10 = coreData.get("US10Y") ?? [];
    if (xau.length && usd.length && us10.length) {
      const xMap = new Map<number, number>(xau.map((p) => [Number(p.time), Number(p.value)]));
      const uMap = new Map<number, number>(usd.map((p) => [Number(p.time), Number(p.value)]));
      const bMap = new Map<number, number>(us10.map((p) => [Number(p.time), Number(p.value)]));
      const keys = [...xMap.keys()]
        .filter((k) => uMap.has(k) && bMap.has(k))
        .sort((a, b) => a - b);
      const combinedPointsRaw = keys.map((k) => ({
        time: k as UTCTimestamp,
        value: (Number(xMap.get(k)) + Number(uMap.get(k)) + Number(bMap.get(k))) / 3,
      }));
      const combinedPoints = loopReplayTick > 0
        ? combinedPointsRaw.slice(Math.max(0, combinedPointsRaw.length - loopVisibleSpan))
        : combinedPointsRaw;
      if (combinedPoints.length) {
        const combinedColor = colorForCode("COMB");
        if (loopReplayTick > 0) {
          const simple = chart.addSeries(LineSeries, {
            color: combinedColor,
            lineWidth: 2,
            lastValueVisible: false,
            priceLineVisible: false,
          });
          const seed = combinedPoints.slice(0, Math.max(2, Math.min(3, combinedPoints.length)));
          simple.setData(seed);
          seriesRefs.current.push(simple);
          const line = {
            id: `combined-${mode}`,
            code: "COMB",
            rank: 0,
            lastValue: seed[seed.length - 1]?.value ?? combinedPoints[combinedPoints.length - 1].value,
            series: simple,
            color: combinedColor,
          };
          outLines.push(line);
          loopTargets.push({
            series: simple,
            data: combinedPoints,
            line,
          });
        } else {
          const segmented = addSegmentedLineSeries(chart, combinedPoints, combinedColor, 2);
          if (segmented.anchor) {
            seriesRefs.current.push(...segmented.all);
            outLines.push({
              id: `combined-${mode}`,
              code: "COMB",
              rank: 0,
              lastValue: combinedPoints[combinedPoints.length - 1].value,
              series: segmented.anchor,
              color: combinedColor,
            });
          }
        }
      }
    }

    outLines.sort((a, b) => a.rank - b.rank);
    linesRef.current = outLines;

    if (outLines.length) {
      const anchor = outLines[0].series;
      const high = anchor.createPriceLine({
        price: HIGH_THRESHOLD,
        color: "rgba(255,56,76,0.9)",
        lineStyle: LineStyle.Dashed,
        lineWidth: 1,
        axisLabelVisible: false,
        title: "",
      });
      const low = anchor.createPriceLine({
        price: LOW_THRESHOLD,
        color: "rgba(57,255,64,0.9)",
        lineStyle: LineStyle.Dashed,
        lineWidth: 1,
        axisLabelVisible: false,
        title: "",
      });
      thresholdLinesRef.current = [
        { owner: anchor, line: high },
        { owner: anchor, line: low },
      ];
    }

    if (loopReplayTick > 0 && loopTargets.length) {
      const total = Math.max(2, ...loopTargets.map((t) => t.data.length));
      const startLen = 2;
      let shown = startLen;
      const t0 = performance.now();
      const pointsPerSecond = 34;
      const animate = (now: number) => {
        const target = Math.max(
          startLen,
          Math.min(total, Math.floor(startLen + ((now - t0) / 1000) * pointsPerSecond)),
        );
        if (target !== shown) {
          shown = target;
          for (const t of loopTargets) {
            const nextLen = Math.min(t.data.length, shown);
            const next = t.data.slice(0, nextLen);
            t.series.setData(next);
            t.line.lastValue = next[next.length - 1]?.value ?? t.line.lastValue;
          }
          updateLabelsRef.current();
        }
        if (shown < total) {
          loopAnimFrame = window.requestAnimationFrame(animate);
        } else {
          loopAnimFrame = null;
        }
      };
      loopAnimFrame = window.requestAnimationFrame(animate);
    }

    applySyncRange(chart);

    // Enforce redraw so curves appear immediately without manual interaction.
    window.requestAnimationFrame(() => {
      applySyncRange(chart);
      window.requestAnimationFrame(() => {
        applySyncRange(chart);
        updateLabelsRef.current();
      });
    });

    return () => {
      if (loopAnimFrame != null) {
        window.cancelAnimationFrame(loopAnimFrame);
      }
    };
  }, [applySyncRange, loopReplayTick, mode, payload]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    applySyncRange(chart);
  }, [applySyncRange]);

  return (
    <div className="relative h-full w-full">
      <div ref={hostRef} className="h-full w-full" />
      <div className="pointer-events-none absolute inset-0 z-20">
        {labels.map((label) => (
          <div
            key={label.id}
            className="absolute rounded border px-1 py-[1px] text-[9px] font-semibold leading-none"
            style={{
              top: `${label.top}px`,
              right: "64px",
              transform: "translateY(-50%)",
              color: label.color,
              borderColor: `${label.color}66`,
              background: "rgba(7, 12, 22, 0.74)",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                position: "absolute",
                left: "-6px",
                top: "50%",
                transform: "translateY(-50%)",
                width: 0,
                height: 0,
                borderTop: "4px solid transparent",
                borderBottom: "4px solid transparent",
                borderRight: `6px solid ${label.color}`,
                filter: "drop-shadow(0 0 2px rgba(0,0,0,0.35))",
              }}
            />
            {label.text}
          </div>
        ))}
      </div>
    </div>
  );
}
