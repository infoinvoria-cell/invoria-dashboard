"use client";

import { RotateCcw } from "lucide-react";

import MiniCandleChart from "@/components/screener/MiniCandleChart";
import { AssetIcon } from "@/lib/icons";
import type {
  PineScreenerRow,
  ScreenerSortDirection,
  ScreenerSortKey,
  ScreenerTheme,
} from "@/lib/screener/types";

type Props = {
  rows: PineScreenerRow[];
  sortKey: ScreenerSortKey;
  sortDirection: ScreenerSortDirection;
  onSort: (key: ScreenerSortKey) => void;
  onRestoreDefaultSort: () => void;
  onSelectAsset: (assetId: string) => void;
  theme: ScreenerTheme;
};

function headerTone(active: boolean): string {
  return active ? "text-slate-100" : "text-slate-400";
}

function sortMarker(active: boolean, direction: ScreenerSortDirection): string {
  if (!active) return "";
  return direction === "asc" ? "^" : "v";
}

function signalTone(direction: PineScreenerRow["signalDirection"]): string {
  if (direction === "LONG") return "text-emerald-300";
  if (direction === "SHORT") return "text-rose-300";
  return "text-sky-300";
}

function valuationTone(direction: PineScreenerRow["val10Direction"] | PineScreenerRow["val20Direction"]): string {
  if (direction === "LONG") return "text-emerald-300";
  if (direction === "SHORT") return "text-rose-300";
  return "text-sky-300";
}

function formatPct(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function valueTone(value: number): string {
  if (value > 0) return "is-positive";
  if (value < 0) return "is-negative";
  return "is-neutral";
}

function macroTone(state: PineScreenerRow["cpiAlignment"]): string {
  if (state === "supportive") return "ivq-screener-macro-dot is-supportive";
  if (state === "contradicting") return "ivq-screener-macro-dot is-contradicting";
  return "ivq-screener-macro-dot is-neutral";
}

function MacroCell({ state, label }: { state: PineScreenerRow["cpiAlignment"]; label: string }) {
  return (
    <div className="ivq-screener-macro-cell" title={label}>
      <span className={macroTone(state)} />
      <span>{label}</span>
    </div>
  );
}

function EntryCell({ row }: { row: PineScreenerRow }) {
  const label =
    row.loading ? "Loading"
      : row.entryConfirmed ? "Confirmed"
        : row.entryState === "RECENT" ? "Recent"
          : "Pending";
  const ageLabel =
    row.loading ? "Scan laeuft"
      : row.ageBars == null ? "Warte auf Trigger"
        : row.ageBars === 0 ? "Heute"
          : `${row.ageBars} Bars`;

  return (
    <div className="ivq-screener-entry-cell">
      <span className={`ivq-tone-chip ${row.entryConfirmed ? "ivq-tone-chip--positive" : ""}`}>{label}</span>
      <span className="ivq-screener-pattern-cell__meta">{ageLabel}</span>
    </div>
  );
}

function ValuationCell({
  direction,
  matches,
  components,
}: {
  direction: PineScreenerRow["val10Direction"] | PineScreenerRow["val20Direction"];
  matches: number;
  components: [number, number, number, number];
}) {
  return (
    <div className="ivq-screener-pattern-cell">
      <span className={valuationTone(direction)}>{direction}</span>
      <div className="ivq-screener-valuation-grid">
        <span className={`ivq-screener-valuation-pill ${valueTone(components[0])}`}>DXY {components[0].toFixed(0)}</span>
        <span className={`ivq-screener-valuation-pill ${valueTone(components[1])}`}>Gold {components[1].toFixed(0)}</span>
        <span className={`ivq-screener-valuation-pill ${valueTone(components[2])}`}>10Y {components[2].toFixed(0)}</span>
        <span className={`ivq-screener-valuation-pill ${valueTone(components[3])}`}>All {components[3].toFixed(0)}</span>
      </div>
      <span className="ivq-screener-pattern-cell__meta">{matches}/4 Treffer</span>
    </div>
  );
}

function SupplyDemandCell({
  direction,
  strong,
}: {
  direction: "demand" | "supply" | "neutral";
  strong: boolean;
}) {
  const label = direction === "demand" ? "Demand" : direction === "supply" ? "Supply" : "Neutral";
  return (
    <span className={`ivq-screener-zone-box is-${direction} ${strong ? "is-strong" : ""}`}>
      {label}
    </span>
  );
}

function SeasonalityCell({
  label,
  holdDays,
  hitRate,
  avgReturn,
}: {
  label: string;
  holdDays: number;
  hitRate: number;
  avgReturn: number;
}) {
  return (
    <div className="ivq-screener-seasonal-cell">
      <span>{label}</span>
      <span className="ivq-screener-pattern-cell__meta">
        {holdDays}T | {hitRate.toFixed(0)}% | {formatPct(avgReturn)}
      </span>
    </div>
  );
}

export default function ScreenerTable({
  rows,
  sortKey,
  sortDirection,
  onSort,
  onRestoreDefaultSort,
  onSelectAsset,
  theme,
}: Props) {
  return (
    <section className="glass-panel ivq-screener-table-card">
      <div className="ivq-screener-table-toolbar">
        <div>
          <div className="ivq-section-label">Quant Screener</div>
          <h2 className="ivq-terminal-title">Asset Scan</h2>
        </div>
        <button type="button" className="ivq-segment-btn" onClick={onRestoreDefaultSort}>
          <RotateCcw size={14} /> Restore Default Sorting
        </button>
      </div>
      <div className="ivq-screener-table-scroll">
        <table className="ivq-screener-table">
          <thead>
            <tr>
              <th><button type="button" className={headerTone(sortKey === "asset")} onClick={() => onSort("asset")}>Asset {sortMarker(sortKey === "asset", sortDirection)}</button></th>
              <th>Last 5 Candles</th>
              <th><button type="button" className={headerTone(sortKey === "entry")} onClick={() => onSort("entry")}>Entry {sortMarker(sortKey === "entry", sortDirection)}</button></th>
              <th><button type="button" className={headerTone(sortKey === "signal")} onClick={() => onSort("signal")}>Signal Direction {sortMarker(sortKey === "signal", sortDirection)}</button></th>
              <th><button type="button" className={headerTone(sortKey === "val10")} onClick={() => onSort("val10")}>Evaluation 10 {sortMarker(sortKey === "val10", sortDirection)}</button></th>
              <th><button type="button" className={headerTone(sortKey === "val20")} onClick={() => onSort("val20")}>Evaluation 20 {sortMarker(sortKey === "val20", sortDirection)}</button></th>
              <th>Supply &amp; Demand</th>
              <th>Supply &amp; Demand Strong</th>
              <th>Current Seasonal Pattern</th>
              <th>Current Hold</th>
              <th><button type="button" className={headerTone(sortKey === "seasonalHitRate")} onClick={() => onSort("seasonalHitRate")}>Current Seasonal Hit Rate {sortMarker(sortKey === "seasonalHitRate", sortDirection)}</button></th>
              <th>Current Seasonal Avg Return</th>
              <th>Next Seasonal Pattern</th>
              <th>Next Hold</th>
              <th>Next Seasonal Hit Rate</th>
              <th>Next Seasonal Avg Return</th>
              <th>CPI Alignment</th>
              <th>PPI Alignment</th>
              <th>COT Commercials</th>
              <th>Risk On / Risk Off</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.assetId}
                className={row.selected ? "is-selected" : ""}
                onClick={() => onSelectAsset(row.assetId)}
              >
                <td>
                  <div className="ivq-screener-asset-cell">
                    <AssetIcon iconKey="stock" category={row.category} assetName={row.name} />
                    <div>
                      <div className="ivq-screener-asset-cell__name">{row.name}</div>
                      <div className="ivq-screener-asset-cell__meta">{row.assetGroup}</div>
                    </div>
                  </div>
                </td>
                <td><MiniCandleChart candles={row.lastCandles} theme={theme} /></td>
                <td><EntryCell row={row} /></td>
                <td className={signalTone(row.signalDirection)}>{row.signalDirection}</td>
                <td><ValuationCell direction={row.val10Direction} matches={row.val10MatchCount} components={row.val10Components} /></td>
                <td><ValuationCell direction={row.val20Direction} matches={row.val20MatchCount} components={row.val20Components} /></td>
                <td><SupplyDemandCell direction={row.hasNormalDemand ? "demand" : row.hasNormalSupply ? "supply" : "neutral"} strong={false} /></td>
                <td><SupplyDemandCell direction={row.hasStrongDemand ? "demand" : row.hasStrongSupply ? "supply" : "neutral"} strong /></td>
                <td><SeasonalityCell label={row.currentPatternLabel} holdDays={row.currentPatternHoldDays} hitRate={row.currentPatternHitRate} avgReturn={row.currentPatternAvgReturn} /></td>
                <td>{row.currentPatternHoldDays > 0 ? `${row.currentPatternHoldDays}T` : "--"}</td>
                <td className={row.currentPatternHitRate >= 60 ? "text-emerald-300" : "text-slate-300"}>{row.currentPatternHitRate.toFixed(0)}%</td>
                <td className={row.currentPatternAvgReturn >= 0 ? "text-emerald-300" : "text-rose-300"}>{formatPct(row.currentPatternAvgReturn)}</td>
                <td><SeasonalityCell label={row.nextPatternLabel} holdDays={row.nextPatternHoldDays} hitRate={row.nextPatternHitRate} avgReturn={row.nextPatternAvgReturn} /></td>
                <td>{row.nextPatternHoldDays > 0 ? `${row.nextPatternHoldDays}T` : "--"}</td>
                <td className={row.nextPatternHitRate >= 60 ? "text-emerald-300" : "text-slate-300"}>{row.nextPatternHitRate.toFixed(0)}%</td>
                <td className={row.nextPatternAvgReturn >= 0 ? "text-emerald-300" : "text-rose-300"}>{formatPct(row.nextPatternAvgReturn)}</td>
                <td><MacroCell state={row.cpiAlignment} label={row.cpiAlignment} /></td>
                <td><MacroCell state={row.ppiAlignment} label={row.ppiAlignment} /></td>
                <td><MacroCell state={row.cotCommercialsAlignment} label={row.cotCommercialsAlignment} /></td>
                <td><MacroCell state={row.riskAlignment} label={row.riskAlignment} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
