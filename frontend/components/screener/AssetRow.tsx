"use client";

import { Check, ChevronDown, ChevronUp, Layers3, X } from "lucide-react";

import ExpandedTradingChart from "@/components/screener/ExpandedTradingChart";
import MiniCandleChart from "@/components/screener/MiniCandleChart";
import ProbabilityIndicator from "@/components/screener/ProbabilityIndicator";
import SeasonalityGraph from "@/components/screener/SeasonalityGraph";
import SignalScoreIndicator from "@/components/screener/SignalScoreIndicator";
import { AssetIcon } from "@/lib/icons";
import type { AssetItem } from "@/types";
import type { ExpandedAssetData, ScreenerRowData, ScreenerTheme } from "@/components/screener/types";

type Props = {
  row: ScreenerRowData;
  asset: AssetItem | null;
  expanded: boolean;
  onToggle: () => void;
  expandedData: ExpandedAssetData | null;
  expandedLoading: boolean;
  theme: ScreenerTheme;
};

function formatPct(value: number): string {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

function metricTone(value: number, theme: ScreenerTheme): string {
  if (value >= 70) return theme === "gold" ? "text-[#f1dfb0]" : "text-blue-200";
  if (value >= 50) return "text-slate-100";
  return "text-rose-300";
}

function valueTone(direction: "bullish" | "bearish", theme: ScreenerTheme): string {
  if (direction === "bullish") return theme === "gold" ? "text-[#d6c38f]" : "text-emerald-300";
  if (direction === "bearish") return "text-rose-300";
  return "text-slate-200";
}

function strengthTone(score: number, theme: ScreenerTheme): string {
  if (score >= 80) return theme === "gold" ? "text-[#f0ddb0]" : "text-blue-200";
  if (score >= 60) return theme === "gold" ? "text-[#d6c38f]" : "text-blue-300";
  if (score >= 40) return "text-slate-200";
  return "text-rose-300";
}

function compactVolume(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return value.toFixed(0);
}

function ValuationCell({ label, value, theme }: { label: string; value: ScreenerRowData["val10"]; theme: ScreenerTheme }) {
  return (
    <div className="min-w-[88px] text-[10px] leading-4">
      <div className="font-semibold text-slate-100">{label}</div>
      <div className={metricTone(value.strength, theme)}>S {value.strength.toFixed(0)}</div>
      <div className="text-slate-300">P {value.probability.toFixed(0)}</div>
      <div className="text-slate-400">C {value.combined.toFixed(0)}</div>
    </div>
  );
}

function SupplyDemandCell({ value }: { value: ScreenerRowData["supplyDemand"] }) {
  return (
    <div className="min-w-[96px] text-[10px] leading-4">
      <div className={`font-semibold ${value.tone === "demand" ? "text-emerald-300" : value.tone === "supply" ? "text-rose-300" : "text-slate-200"}`}>
        {value.label}
      </div>
      <div className="text-slate-400">Score {value.score.toFixed(0)}</div>
      <div className="text-slate-500">Zones {value.zoneCount}</div>
    </div>
  );
}

function SignalCell({ row, theme }: { row: ScreenerRowData; theme: ScreenerTheme }) {
  return (
    <div className="min-w-[112px] space-y-1.5">
      <div className="flex items-center gap-2">
        <span className={`ivq-tone-chip ${row.signal === "bullish" ? "bg-emerald-500/12 text-emerald-200 border-emerald-400/30" : row.signal === "bearish" ? "bg-rose-500/12 text-rose-200 border-rose-400/30" : "bg-slate-500/12 text-slate-200 border-slate-400/30"}`}>
          {row.signalLabel}
        </span>
        <span
          className={`inline-flex h-6 w-6 items-center justify-center rounded-full border ${row.orderBlock.confirmed ? "border-sky-400/50 bg-sky-500/12" : "border-white/10 bg-white/5"}`}
          title={row.orderBlock.label}
        >
          <Layers3 size={12} className={row.orderBlock.confirmed ? "text-sky-200" : "text-slate-400"} />
        </span>
      </div>
      <div className="text-[10px] text-slate-400">{row.orderBlock.label}</div>
      <SignalScoreIndicator value={row.signalStrength.score} label={row.signalStrength.label} theme={theme} />
    </div>
  );
}

export default function AssetRow({ row, asset, expanded, onToggle, expandedData, expandedLoading, theme }: Props) {
  return (
    <>
      <tr className={expanded ? "is-active" : ""} onClick={onToggle}>
        <td>
          <div className="flex items-center gap-2">
            <AssetIcon iconKey={asset?.iconKey ?? "stock"} category={asset?.category ?? row.category} assetName={row.name} />
            <div>
              <div className="font-semibold text-slate-100">{row.name}</div>
              <div className="text-[11px] text-slate-400">{row.assetGroup}</div>
            </div>
          </div>
        </td>
        <td><MiniCandleChart candles={row.lastCandles} theme={theme} /></td>
        <td>
          <div className={`inline-flex h-6 w-6 items-center justify-center rounded-full border ${row.entryConfirmed ? "border-emerald-400/40 bg-emerald-500/12" : "border-rose-400/40 bg-rose-500/12"}`}>
            {row.entryConfirmed ? <Check size={12} className="text-emerald-300" /> : <X size={12} className="text-rose-300" />}
          </div>
        </td>
        <td><SignalCell row={row} theme={theme} /></td>
        <td>{row.age}</td>
        <td><ValuationCell label="" value={row.val20} theme={theme} /></td>
        <td><ValuationCell label="" value={row.val10} theme={theme} /></td>
        <td><SupplyDemandCell value={row.supplyDemand} /></td>
        <td>
          <div className="space-y-1.5">
            <SupplyDemandCell value={row.supplyDemandPlus} />
            <div className={`text-[10px] ${row.orderBlock.confirmed ? "text-sky-200" : "text-slate-500"}`}>
              OB {row.orderBlock.confirmed ? "confirmed" : "pending"}
            </div>
          </div>
        </td>
        <td><SeasonalityGraph points={row.graphCurve} progress={row.graphProgress} direction={row.currentCluster.direction} theme={theme} /></td>
        <td>
          <div className="space-y-1">
            <div className={valueTone(row.currentCluster.direction, theme)}>{(row.currentCluster.hitRate * 100).toFixed(1)}%</div>
            <ProbabilityIndicator value={row.probability.score} theme={theme} />
          </div>
        </td>
        <td className={valueTone(row.currentCluster.direction, theme)}>{formatPct(row.currentCluster.avgReturn)}</td>
        <td>{row.currentCluster.fromLabel}</td>
        <td>{row.currentCluster.toLabel}</td>
        <td>
          <div className="space-y-1.5">
            <div>{row.currentCluster.holdDays}</div>
            <SignalScoreIndicator value={row.aiRanking.score} label="AI" theme={theme} />
          </div>
        </td>
        <td className={valueTone(row.nextCluster.direction, theme)}>{(row.nextCluster.hitRate * 100).toFixed(1)}%</td>
        <td>
          <div className="space-y-1">
            <div className={valueTone(row.nextCluster.direction, theme)}>{formatPct(row.nextCluster.avgReturn)}</div>
            <div className={`text-[10px] ${strengthTone(row.liquidity.score, theme)}`}>
              LQ {row.liquidity.score.toFixed(0)} | {compactVolume(row.liquidity.averageDailyVolume)}
            </div>
          </div>
        </td>
        <td>{row.nextCluster.fromLabel}</td>
        <td>{row.nextCluster.toLabel}</td>
        <td>
          <button type="button" className="inline-flex items-center gap-1 text-slate-300" onClick={(event) => { event.stopPropagation(); onToggle(); }}>
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </td>
      </tr>
      {expanded ? (
        <tr className="is-active">
          <td colSpan={20} className="!p-0">
            <div className="border-t border-slate-700/40 bg-[rgba(6,10,18,0.46)] p-3">
              <div className="overflow-x-auto">
                {expandedLoading ? (
                  <div className="grid h-[360px] min-w-[720px] place-items-center text-sm text-slate-400">Loading TradingView-style chart...</div>
                ) : (
                  <ExpandedTradingChart assetName={row.name} row={row} assetData={expandedData} theme={theme} />
                )}
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
