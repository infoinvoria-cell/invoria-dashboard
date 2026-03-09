import { useEffect, useMemo, useRef } from "react";
import {
  AreaSeries,
  ColorType,
  CrosshairMode,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  createChart,
} from "lightweight-charts";

import type { SeasonalityResponse } from "../../../types";
import { getSeasonDirection, normalizedSeasonalityCurve, seasonTone } from "../../../lib/seasonality";

type Props = {
  payload: SeasonalityResponse | null;
  loopReplayTick?: number;
};

function dayTs(dayOffset: number): UTCTimestamp {
  const base = new Date();
  base.setUTCHours(0, 0, 0, 0);
  const next = base.getTime() + dayOffset * 86400000;
  return Math.floor(next / 1000) as UTCTimestamp;
}

function rgba(hex: string, alpha: number): string {
  const clean = String(hex || "").replace("#", "");
  const n = clean.length === 3
    ? clean.split("").map((c) => `${c}${c}`).join("")
    : clean.padEnd(6, "0").slice(0, 6);
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, alpha))})`;
}

function seasonFill(direction: "LONG" | "SHORT", tone: string) {
  // AreaSeries creates the desired "line glow + fade away" look.
  // Keep stronger color near the line, transparent away from it.
  if (direction === "LONG") {
    return {
      topColor: rgba(tone, 0.42),
      bottomColor: rgba(tone, 0.03),
    };
  }
  return {
    topColor: rgba(tone, 0.40),
    bottomColor: rgba(tone, 0.03),
  };
}

export default function SeasonalityChart({ payload, loopReplayTick = 0 }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const lineSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const fillSeriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const loopAnimFrameRef = useRef<number | null>(null);

  const direction = useMemo(() => getSeasonDirection(payload), [payload?.stats?.direction]);
  const tone = seasonTone(direction);
  const fills = useMemo(() => seasonFill(direction, tone), [direction, tone]);

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
      localization: {
        locale: "de-DE",
        dateFormat: "dd.MM.yyyy",
      },
      rightPriceScale: {
        borderColor: "rgba(109,132,160,0.35)",
        scaleMargins: {
          top: 0.1,
          bottom: 0.2,
        },
      },
      timeScale: {
        borderColor: "rgba(109,132,160,0.35)",
        fixLeftEdge: true,
        fixRightEdge: true,
        lockVisibleTimeRangeOnResize: true,
        rightOffset: 0,
        barSpacing: 15,
        minBarSpacing: 9,
        timeVisible: true,
        secondsVisible: false,
      },
      grid: {
        vertLines: { color: "rgba(0,0,0,0)" },
        horzLines: { color: "rgba(0,0,0,0)" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: "rgba(170,194,226,0.36)",
          width: 1,
          style: 0,
          labelBackgroundColor: "rgba(30,44,70,0.92)",
        },
        horzLine: {
          color: "rgba(170,194,226,0.36)",
          width: 1,
          style: 0,
          labelBackgroundColor: "rgba(30,44,70,0.92)",
        },
      },
      handleScroll: false,
      handleScale: false,
    });
    chartRef.current = chart;

    fillSeriesRef.current = chart.addSeries(AreaSeries, {
      topColor: fills.topColor,
      bottomColor: fills.bottomColor,
      lineColor: rgba(tone, 0),
      lineWidth: 1,
      lastValueVisible: false,
      priceLineVisible: false,
    });

    lineSeriesRef.current = chart.addSeries(LineSeries, {
      color: tone,
      lineWidth: 2,
      lastValueVisible: false,
      priceLineVisible: false,
    });

    return () => {
      chart.remove();
      chartRef.current = null;
      lineSeriesRef.current = null;
      fillSeriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    const lineSeries = lineSeriesRef.current;
    const fillSeries = fillSeriesRef.current;
    if (!chart || !lineSeries || !fillSeries) return;
    if (loopAnimFrameRef.current != null) {
      window.cancelAnimationFrame(loopAnimFrameRef.current);
      loopAnimFrameRef.current = null;
    }

    const curve = normalizedSeasonalityCurve(payload);
    const data = curve.map((row) => ({ time: dayTs(row.x), value: row.y }));

    const nextFills = seasonFill(direction, tone);
    fillSeries.applyOptions({
      topColor: nextFills.topColor,
      bottomColor: nextFills.bottomColor,
      lineColor: rgba(tone, 0),
    });
    lineSeries.applyOptions({ color: tone });

    if (loopReplayTick > 0 && data.length > 2) {
      const total = data.length;
      const startLen = 2;
      let shown = startLen;
      lineSeries.setData(data.slice(0, startLen));
      fillSeries.setData(data.slice(0, startLen));
      chart.timeScale().fitContent();

      const t0 = performance.now();
      const pointsPerSecond = 34;
      const animate = (now: number) => {
        const target = Math.max(
          startLen,
          Math.min(total, Math.floor(startLen + ((now - t0) / 1000) * pointsPerSecond)),
        );
        if (target !== shown) {
          shown = target;
          const next = data.slice(0, shown);
          lineSeries.setData(next);
          fillSeries.setData(next);
          chart.timeScale().fitContent();
        }
        if (shown < total) {
          loopAnimFrameRef.current = window.requestAnimationFrame(animate);
        } else {
          loopAnimFrameRef.current = null;
        }
      };
      loopAnimFrameRef.current = window.requestAnimationFrame(animate);
    } else {
      lineSeries.setData(data);
      fillSeries.setData(data);
      chart.timeScale().fitContent();
    }

    return () => {
      if (loopAnimFrameRef.current != null) {
        window.cancelAnimationFrame(loopAnimFrameRef.current);
        loopAnimFrameRef.current = null;
      }
    };
  }, [direction, loopReplayTick, payload, tone]);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <div ref={hostRef} className="h-full w-full overflow-hidden" />
    </div>
  );
}
