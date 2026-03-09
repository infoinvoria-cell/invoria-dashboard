"use client";

import { useEffect, useRef } from "react";
import {
  CandlestickData,
  ColorType,
  IChartApi,
  LineData,
  UTCTimestamp,
  createChart,
} from "lightweight-charts";

type CandlePoint = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

type LinePoint = {
  time: string;
  value: number;
};

type ChartProps = {
  candles?: CandlePoint[];
  line?: LinePoint[];
};

function toUtcTimestamp(value: string): UTCTimestamp {
  return Math.floor(new Date(value).getTime() / 1000) as UTCTimestamp;
}

export default function Chart({ candles = [], line = [] }: ChartProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!rootRef.current) return;

    const chart: IChartApi = createChart(rootRef.current, {
      width: rootRef.current.clientWidth,
      height: 300,
      layout: {
        background: { type: ColorType.Solid, color: "rgba(0,0,0,0)" },
        textColor: "#8ca4cf",
      },
      grid: {
        vertLines: { color: "rgba(120,160,255,0.08)" },
        horzLines: { color: "rgba(120,160,255,0.08)" },
      },
      rightPriceScale: {
        borderColor: "rgba(120,160,255,0.18)",
      },
      timeScale: {
        borderColor: "rgba(120,160,255,0.18)",
      },
      crosshair: {
        vertLine: { color: "rgba(122,170,255,0.26)" },
        horzLine: { color: "rgba(122,170,255,0.26)" },
      },
    });

    if (candles.length > 0) {
      const series = (chart as any).addCandlestickSeries({
        upColor: "#4d87fe",
        downColor: "#c5d7ff",
        wickUpColor: "#4d87fe",
        wickDownColor: "#c5d7ff",
        borderVisible: false,
      });

      const candleData: CandlestickData<UTCTimestamp>[] = candles
        .filter((item) => Number.isFinite(item.open) && Number.isFinite(item.high) && Number.isFinite(item.low) && Number.isFinite(item.close))
        .map((item) => ({
          time: toUtcTimestamp(item.time),
          open: item.open,
          high: item.high,
          low: item.low,
          close: item.close,
        }));

      series.setData(candleData);
    } else if (line.length > 0) {
      const series = (chart as any).addLineSeries({
        color: "#4d87fe",
        lineWidth: 2,
      });

      const lineData: LineData<UTCTimestamp>[] = line
        .filter((item) => Number.isFinite(item.value))
        .map((item) => ({
          time: toUtcTimestamp(item.time),
          value: item.value,
        }));

      series.setData(lineData);
    }

    chart.timeScale().fitContent();

    const resizeObserver = new ResizeObserver(() => {
      if (!rootRef.current) return;
      chart.applyOptions({ width: rootRef.current.clientWidth });
      chart.timeScale().fitContent();
    });
    resizeObserver.observe(rootRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
    };
  }, [candles, line]);

  return <div ref={rootRef} className="chart-root" />;
}
