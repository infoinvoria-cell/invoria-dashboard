"use client";

import { useMemo } from "react";

import type { OptimizerDebugAsset } from "@/lib/optimizer/types";

type Props = {
  asset: OptimizerDebugAsset | null;
  selectedTradeKey?: string | null;
};

const CHART_WIDTH = 1120;
const CHART_HEIGHT = 430;
const PADDING_LEFT = 62;
const PADDING_RIGHT = 18;
const PADDING_TOP = 18;
const PADDING_BOTTOM = 32;
const SEASONALITY_BAND_HEIGHT = 22;

function tradeKey(assetId: string, entryDate: string, exitDate: string, index: number): string {
  return `${assetId}:${entryDate}:${exitDate}:${index}`;
}

function formatPrice(value: number): string {
  return Number.isFinite(value) ? value.toFixed(4) : "0.0000";
}

export default function OptimizerDebugChart({ asset, selectedTradeKey = null }: Props) {
  const model = useMemo(() => {
    if (!asset || asset.candles.length === 0) return null;

    const selectedTrade = asset.trades.find((trade, index) => tradeKey(trade.assetId, trade.entryDate, trade.exitDate, index) === selectedTradeKey) ?? null;
    const visibleStart = Math.max(0, (selectedTrade?.entryIndex ?? Math.max(0, asset.candles.length - 140)) - 20);
    const visibleEnd = Math.min(asset.candles.length - 1, (selectedTrade?.exitIndex ?? asset.candles.length - 1) + 20);
    const visibleCandles = asset.candles.slice(visibleStart, visibleEnd + 1);
    const xSpan = Math.max(1, visibleEnd - visibleStart);
    const xStep = (CHART_WIDTH - PADDING_LEFT - PADDING_RIGHT) / xSpan;
    const visibleTrades = asset.trades.filter((trade) => trade.exitIndex >= visibleStart && trade.entryIndex <= visibleEnd);
    const visibleZones = asset.zones.filter((zone) => zone.endIndex >= visibleStart && zone.startIndex <= visibleEnd);
    const visibleValuation = asset.valuationWindows.filter((item) => item.barIndex >= visibleStart && item.barIndex <= visibleEnd);
    const visibleSeasonality = asset.seasonalityWindows.filter((item) => item.endIndex >= visibleStart && item.startIndex <= visibleEnd);
    const visibleSignals = asset.signals.filter((item) => item.barIndex >= visibleStart && item.barIndex <= visibleEnd);

    const lows = visibleCandles.map((item) => item.low);
    const highs = visibleCandles.map((item) => item.high);
    const selectedTradePrices = selectedTrade ? [selectedTrade.entryPrice, selectedTrade.exitPrice, selectedTrade.stopPrice, selectedTrade.takeProfitPrice] : [];
    const minPrice = Math.min(...lows, ...selectedTradePrices);
    const maxPrice = Math.max(...highs, ...selectedTradePrices);
    const paddedRange = Math.max(1e-6, (maxPrice - minPrice) * 0.08);
    const low = minPrice - paddedRange;
    const high = maxPrice + paddedRange;
    const plotTop = PADDING_TOP + SEASONALITY_BAND_HEIGHT;
    const plotBottom = CHART_HEIGHT - PADDING_BOTTOM;
    const plotHeight = plotBottom - plotTop;

    const xFor = (barIndex: number) => PADDING_LEFT + ((barIndex - visibleStart) * xStep);
    const yFor = (price: number) => plotBottom - (((price - low) / Math.max(1e-9, high - low)) * plotHeight);

    return {
      selectedTrade,
      visibleStart,
      visibleEnd,
      visibleCandles,
      visibleTrades,
      visibleZones,
      visibleValuation,
      visibleSeasonality,
      visibleSignals,
      xStep,
      xFor,
      yFor,
      low,
      high,
      plotTop,
      plotBottom,
      plotHeight,
    };
  }, [asset, selectedTradeKey]);

  if (!asset || !model) {
    return (
      <div className="grid min-h-[320px] place-items-center rounded-[24px] border border-dashed border-white/10 bg-black/20 text-sm text-slate-400">
        No market preview available.
      </div>
    );
  }

  return (
    <div className="rounded-[24px] border border-white/10 bg-[#030507] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-white">{asset.symbol} visual validation</div>
          <div className="mt-1 text-xs text-slate-400">
            Candles, zones, valuation windows, seasonality windows, signals and executed trades.
          </div>
        </div>
        <div className="rounded-[14px] border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300">
          Integrity: {asset.integrity.isValid ? "valid" : "warning"} | Trades: {asset.trades.length} | Signals: {asset.signals.length}
        </div>
      </div>

      <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className="h-[430px] w-full overflow-visible">
        <defs>
          <linearGradient id="optimizer-bg-grid" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(255,255,255,0.02)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0.005)" />
          </linearGradient>
        </defs>

        <rect x={PADDING_LEFT} y={model.plotTop} width={CHART_WIDTH - PADDING_LEFT - PADDING_RIGHT} height={model.plotHeight} fill="url(#optimizer-bg-grid)" rx="16" />

        {[0, 1, 2, 3, 4].map((step) => {
          const ratio = step / 4;
          const y = model.plotTop + (model.plotHeight * ratio);
          const price = model.high - ((model.high - model.low) * ratio);
          return (
            <g key={`grid-${step}`}>
              <line x1={PADDING_LEFT} y1={y} x2={CHART_WIDTH - PADDING_RIGHT} y2={y} stroke="rgba(255,255,255,0.06)" strokeDasharray="4 6" />
              <text x={10} y={y + 4} fill="#94a3b8" fontSize="11">
                {formatPrice(price)}
              </text>
            </g>
          );
        })}

        {model.visibleValuation.map((item) => {
          const x = model.xFor(item.barIndex) - (model.xStep * 0.5);
          if (item.longPass) {
            return <rect key={`val-long-${item.barIndex}`} x={x} y={model.plotTop} width={Math.max(4, model.xStep)} height={model.plotHeight} fill="rgba(37,99,235,0.13)" />;
          }
          if (item.shortPass) {
            return <rect key={`val-short-${item.barIndex}`} x={x} y={model.plotTop} width={Math.max(4, model.xStep)} height={model.plotHeight} fill="rgba(239,68,68,0.13)" />;
          }
          return null;
        })}

        {model.visibleSeasonality.map((window, index) => {
          const x = model.xFor(window.startIndex) - (model.xStep * 0.5);
          const width = Math.max(model.xStep, (window.endIndex - window.startIndex + 1) * model.xStep);
          return (
            <rect
              key={`season-${index}`}
              x={x}
              y={PADDING_TOP}
              width={width}
              height={SEASONALITY_BAND_HEIGHT - 4}
              rx="8"
              fill={window.direction === "long" ? "rgba(22,163,74,0.28)" : "rgba(220,38,38,0.28)"}
              stroke={window.direction === "long" ? "rgba(34,197,94,0.9)" : "rgba(248,113,113,0.9)"}
            />
          );
        })}

        {model.visibleZones.map((zone) => {
          const x = model.xFor(zone.startIndex) - (model.xStep * 0.5);
          const width = Math.max(model.xStep, (Math.min(zone.endIndex, model.visibleEnd) - Math.max(zone.startIndex, model.visibleStart) + 1) * model.xStep);
          const y = model.yFor(zone.high);
          const height = Math.max(2, model.yFor(zone.low) - y);
          const stroke = zone.kind === "demand"
            ? zone.strength === "strong" ? "rgba(16,185,129,0.95)" : "rgba(52,211,153,0.75)"
            : zone.strength === "strong" ? "rgba(248,113,113,0.95)" : "rgba(251,146,60,0.75)";
          const fill = zone.kind === "demand"
            ? zone.strength === "strong" ? "rgba(16,185,129,0.17)" : "rgba(52,211,153,0.12)"
            : zone.strength === "strong" ? "rgba(248,113,113,0.17)" : "rgba(251,146,60,0.12)";
          return (
            <rect
              key={zone.id}
              x={x}
              y={y}
              width={width}
              height={height}
              rx="8"
              fill={fill}
              stroke={stroke}
              strokeWidth={zone.touched ? 2 : 1}
              strokeDasharray={zone.broken ? "4 4" : undefined}
            />
          );
        })}

        {model.visibleCandles.map((bar, index) => {
          const actualIndex = model.visibleStart + index;
          const x = model.xFor(actualIndex);
          const openY = model.yFor(bar.open);
          const closeY = model.yFor(bar.close);
          const highY = model.yFor(bar.high);
          const lowY = model.yFor(bar.low);
          const bullish = bar.close >= bar.open;
          const candleColor = bullish ? "#f4f8ff" : "#4f83ff";
          return (
            <g key={bar.t}>
              <line x1={x} x2={x} y1={highY} y2={lowY} stroke={candleColor} strokeWidth={1.4} />
              <rect
                x={x - Math.max(2.5, model.xStep * 0.28)}
                y={Math.min(openY, closeY)}
                width={Math.max(5, model.xStep * 0.56)}
                height={Math.max(1.6, Math.abs(closeY - openY))}
                rx="2"
                fill={bullish ? "rgba(248,250,252,0.95)" : "rgba(59,130,246,0.9)"}
                stroke={candleColor}
              />
            </g>
          );
        })}

        {model.visibleSignals.map((signal) => {
          const x = model.xFor(signal.barIndex);
          const candle = asset.candles[signal.barIndex];
          const markerY = signal.direction === "long" ? model.yFor(candle.low) + 14 : model.yFor(candle.high) - 14;
          const points = signal.direction === "long"
            ? `${x},${markerY} ${x - 7},${markerY + 12} ${x + 7},${markerY + 12}`
            : `${x},${markerY} ${x - 7},${markerY - 12} ${x + 7},${markerY - 12}`;
          return (
            <polygon
              key={`${signal.assetId}-${signal.time}-${signal.direction}`}
              points={points}
              fill={signal.direction === "long" ? "#22c55e" : "#ef4444"}
              stroke="rgba(255,255,255,0.7)"
            />
          );
        })}

        {model.visibleTrades.map((trade, index) => {
          const key = tradeKey(trade.assetId, trade.entryDate, trade.exitDate, asset.trades.indexOf(trade));
          const selected = model.selectedTrade != null && key === selectedTradeKey;
          const entryX = model.xFor(trade.entryIndex);
          const exitX = model.xFor(trade.exitIndex);
          const entryY = model.yFor(trade.entryPrice);
          const exitY = model.yFor(trade.exitPrice);
          const stopY = model.yFor(trade.stopPrice);
          return (
            <g key={`trade-${index}`}>
              <line
                x1={entryX}
                x2={exitX}
                y1={stopY}
                y2={stopY}
                stroke={selected ? "rgba(245,158,11,0.95)" : "rgba(245,158,11,0.35)"}
                strokeDasharray="6 4"
                strokeWidth={selected ? 2 : 1}
              />
              <circle cx={entryX} cy={entryY} r={selected ? 5.2 : 4} fill="#f8fafc" stroke="#111827" />
              <circle
                cx={exitX}
                cy={exitY}
                r={selected ? 5.2 : 4}
                fill={trade.returnPct >= 0 ? "#22c55e" : "#ef4444"}
                stroke="#111827"
              />
              <circle cx={exitX} cy={stopY} r={selected ? 4.6 : 3.2} fill="#f59e0b" stroke="#111827" />
            </g>
          );
        })}

        {model.visibleCandles
          .filter((_, index) => index % Math.max(1, Math.ceil(model.visibleCandles.length / 6)) === 0)
          .map((bar, index) => {
            const actualIndex = model.visibleStart + index;
            const x = model.xFor(actualIndex);
            return (
              <text key={`label-${bar.t}`} x={x} y={CHART_HEIGHT - 8} textAnchor="middle" fill="#94a3b8" fontSize="11">
                {bar.t.slice(0, 10)}
              </text>
            );
          })}
      </svg>

      <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-300">
        <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1">Green band: seasonality long window</span>
        <span className="rounded-full border border-rose-400/30 bg-rose-400/10 px-3 py-1">Red band: seasonality short window</span>
        <span className="rounded-full border border-blue-400/30 bg-blue-400/10 px-3 py-1">Blue background: long valuation family active below -75</span>
        <span className="rounded-full border border-orange-400/30 bg-orange-400/10 px-3 py-1">Red background: short valuation family active above 75</span>
      </div>
    </div>
  );
}
