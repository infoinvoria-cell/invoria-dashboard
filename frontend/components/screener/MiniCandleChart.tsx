"use client";

import { sanitizeOhlcvSeries } from "@/lib/ohlcv";
import type { ScreenerTheme } from "@/lib/screener/types";
import type { OhlcvPoint } from "@/types";

type Props = {
  candles: OhlcvPoint[];
  theme: ScreenerTheme;
};

function priceBounds(candles: OhlcvPoint[]): { low: number; high: number } {
  const low = Math.min(...candles.map((row) => row.low));
  const high = Math.max(...candles.map((row) => row.high));
  return { low, high };
}

export default function MiniCandleChart({ candles, theme }: Props) {
  const safeCandles = sanitizeOhlcvSeries(candles).slice(-5);

  if (!safeCandles.length) {
    return <div className="h-[38px] w-[92px] rounded-md border border-white/10 bg-black/10" />;
  }

  const { low, high } = priceBounds(safeCandles);
  const range = Math.max(high - low, 0.0001);
  const bodyWidth = 6;
  const width = 92;
  const height = 38;
  const padding = 4;
  const gap = 10;
  const bullishColor = theme === "gold" ? "#d6c38f" : "#39ff40";
  const bearishColor = "#e05656";

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-[38px] w-[92px] overflow-visible rounded-md">
      {safeCandles.map((row, index) => {
        const x = padding + index * gap + 6;
        const wickTop = height - padding - (((row.high - low) / range) * (height - padding * 2));
        const wickBottom = height - padding - (((row.low - low) / range) * (height - padding * 2));
        const openY = height - padding - (((row.open - low) / range) * (height - padding * 2));
        const closeY = height - padding - (((row.close - low) / range) * (height - padding * 2));
        const top = Math.min(openY, closeY);
        const bodyHeight = Math.max(Math.abs(openY - closeY), 1.2);
        const bullish = row.close >= row.open;
        const color = bullish ? bullishColor : bearishColor;
        return (
          <g key={`${row.t}-${index}`}>
            <line x1={x} x2={x} y1={wickTop} y2={wickBottom} stroke={color} strokeWidth={1.4} strokeLinecap="round" />
            <rect x={x - bodyWidth / 2} y={top} width={bodyWidth} height={bodyHeight} rx={1.2} fill={bullish ? `${color}dd` : `${color}ea`} stroke={color} strokeWidth={0.9} />
          </g>
        );
      })}
    </svg>
  );
}
