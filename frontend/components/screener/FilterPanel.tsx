"use client";

import type { DataSource, ScreenerFilters, ScreenerTheme } from "@/components/screener/types";

type Props = {
  source: DataSource;
  onSourceChange: (next: DataSource) => void;
  filters: ScreenerFilters;
  onChange: (next: ScreenerFilters) => void;
  onApply: () => void;
  onRefresh: () => void;
  assetGroups: string[];
  theme: ScreenerTheme;
  isLoading: boolean;
  resultCount: number;
  loadedCount: number;
  totalCount: number;
};

export default function FilterPanel({
  source,
  onSourceChange,
  filters,
  onChange,
  onApply,
  onRefresh,
  assetGroups,
  theme,
  isLoading,
  resultCount,
  loadedCount,
  totalCount,
}: Props) {
  const themeChip = theme === "gold" ? "#d6c38f" : "#4d87fe";
  const isStreaming = isLoading || loadedCount < totalCount;

  return (
    <aside className="ivq-screener-filter-sidebar">
      <button type="button" className="ivq-screener-filter-rail" aria-label="Filter oeffnen">
        <span>Filter</span>
      </button>
      <section className="glass-panel ivq-screener-filter-panel">
        <div className="ivq-screener-filter-actions">
          <button
            type="button"
            className="ivq-segment-btn"
            onClick={onApply}
            style={{ background: themeChip, borderColor: themeChip, color: theme === "gold" ? "#110d07" : "#04101f" }}
          >
            Berechnen
          </button>
          <button type="button" className="ivq-segment-btn" onClick={onRefresh}>
            Refresh
          </button>
          <div className="ivq-screener-filter-status">
            <div className="ivq-screener-filter-status-line">
              {isStreaming ? <span className="ivq-loading-orb" aria-hidden="true" /> : null}
              <span>{isStreaming ? `Laedt ${loadedCount}/${totalCount}` : `${resultCount} Treffer`}</span>
            </div>
            <div className="ivq-screener-filter-status-sub">
              {resultCount} Zeilen sichtbar
            </div>
          </div>
        </div>

        <div className="ivq-screener-filter-stack">
          <label className="ivq-form-row">
            <span>Quelle</span>
            <select value={source} onChange={(event) => onSourceChange(event.target.value as DataSource)} className="ivq-select">
              <option value="tradingview">TradingView</option>
              <option value="dukascopy">Dukascopy</option>
              <option value="yahoo">Yahoo</option>
            </select>
          </label>

          <label className="ivq-form-row">
            <span>Asset-Gruppe</span>
            <select value={filters.assetGroup} onChange={(event) => onChange({ ...filters, assetGroup: event.target.value })} className="ivq-select">
              <option value="All">Alle</option>
              {assetGroups.map((group) => (
                <option key={group} value={group}>{group}</option>
              ))}
            </select>
          </label>

          <label className="ivq-form-row">
            <span>Signal-Richtung</span>
            <select value={filters.signalFilter} onChange={(event) => onChange({ ...filters, signalFilter: event.target.value as ScreenerFilters["signalFilter"] })} className="ivq-select">
              <option value="all">Alle</option>
              <option value="bullish">Bullish</option>
              <option value="bearish">Bearish</option>
            </select>
          </label>

          <label className="ivq-form-row">
            <span>Timeframe</span>
            <select value={filters.timeframe} onChange={(event) => onChange({ ...filters, timeframe: event.target.value as ScreenerFilters["timeframe"] })} className="ivq-select">
              <option value="D">Daily</option>
              <option value="W">Weekly</option>
            </select>
          </label>

          <label className="ivq-form-row">
            <span>Seasonality Min Days</span>
            <input type="number" min={5} max={40} value={filters.seasonalityMinDays} onChange={(event) => onChange({ ...filters, seasonalityMinDays: Number(event.target.value) || 10 })} className="ivq-select" />
          </label>

          <label className="ivq-form-row">
            <span>Seasonality Max Days</span>
            <input type="number" min={filters.seasonalityMinDays} max={60} value={filters.seasonalityMaxDays} onChange={(event) => onChange({ ...filters, seasonalityMaxDays: Number(event.target.value) || 20 })} className="ivq-select" />
          </label>

          <label className="ivq-form-row">
            <span>Historical Years</span>
            <input type="number" min={3} max={10} value={filters.historicalYears} onChange={(event) => onChange({ ...filters, historicalYears: Number(event.target.value) || 10 })} className="ivq-select" />
          </label>

          <label className="ivq-form-row">
            <span>Valuation Threshold</span>
            <input type="number" min={0} max={100} value={filters.valuationThreshold} onChange={(event) => onChange({ ...filters, valuationThreshold: Number(event.target.value) || 0 })} className="ivq-select" />
          </label>

          <label className="ivq-form-row">
            <span>Minimum Probability</span>
            <input type="number" min={0} max={100} value={filters.minimumProbability} onChange={(event) => onChange({ ...filters, minimumProbability: Number(event.target.value) || 0 })} className="ivq-select" />
          </label>

          <label className="ivq-form-row">
            <span>Minimum Signal Strength</span>
            <input type="number" min={0} max={100} value={filters.minimumSignalStrength} onChange={(event) => onChange({ ...filters, minimumSignalStrength: Number(event.target.value) || 0 })} className="ivq-select" />
          </label>

          <label className="ivq-form-row">
            <span>Liquidity Threshold</span>
            <input type="number" min={0} max={100} value={filters.liquidityThreshold} onChange={(event) => onChange({ ...filters, liquidityThreshold: Number(event.target.value) || 0 })} className="ivq-select" />
          </label>

          <label className="ivq-form-row">
            <span>Order Block</span>
            <select value={filters.requireOrderBlock ? "required" : "all"} onChange={(event) => onChange({ ...filters, requireOrderBlock: event.target.value === "required" })} className="ivq-select">
              <option value="all">Alle</option>
              <option value="required">Nur bestaetigt</option>
            </select>
          </label>

          <label className="ivq-form-row">
            <span>Sort By</span>
            <select value={filters.sortBy} onChange={(event) => onChange({ ...filters, sortBy: event.target.value as ScreenerFilters["sortBy"] })} className="ivq-select">
              <option value="hitRate">Hit Rate</option>
              <option value="avgReturn">Avg Return</option>
              <option value="age">Age</option>
              <option value="val20">Val20</option>
              <option value="val10">Val10</option>
              <option value="probability">Probability</option>
              <option value="signalStrength">Signal Strength</option>
              <option value="aiRanking">AI Ranking</option>
            </select>
          </label>

          <label className="ivq-form-row">
            <span>Sort Direction</span>
            <select value={filters.sortDirection} onChange={(event) => onChange({ ...filters, sortDirection: event.target.value as ScreenerFilters["sortDirection"] })} className="ivq-select">
              <option value="desc">Descending</option>
              <option value="asc">Ascending</option>
            </select>
          </label>
        </div>
      </section>
    </aside>
  );
}
