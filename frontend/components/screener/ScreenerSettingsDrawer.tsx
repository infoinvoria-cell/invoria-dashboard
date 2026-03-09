"use client";

import { Settings2 } from "lucide-react";

import type { PineScreenerSettings, ScreenerTheme } from "@/lib/screener/types";

type Props = {
  open: boolean;
  settings: PineScreenerSettings;
  assetGroups: string[];
  assetGroupCounts: Record<string, number>;
  onToggle: () => void;
  onChange: (next: PineScreenerSettings) => void;
  onApply: () => void;
  onRefresh: () => void;
  loadedCount: number;
  totalCount: number;
  resultCount: number;
  theme: ScreenerTheme;
};

function Tip({ text }: { text: string }) {
  return <span className="ivq-screener-tip" title={text}>?</span>;
}

export default function ScreenerSettingsDrawer({
  open,
  settings,
  assetGroups,
  assetGroupCounts,
  onToggle,
  onChange,
  onApply,
  onRefresh,
  loadedCount,
  totalCount,
  resultCount,
  theme,
}: Props) {
  const themeAccent = theme === "gold" ? "#d6c38f" : "#4d87fe";
  const allGroupsSelected = assetGroups.length > 0 && assetGroups.every((group) => settings.selectedAssetGroups.includes(group));
  const defaultGroups = assetGroups.filter((group) => group !== "Aktien");
  const fallbackGroups = defaultGroups.length ? defaultGroups : assetGroups;

  const toggleAssetGroup = (group: string) => {
    const hasGroup = settings.selectedAssetGroups.includes(group);
    const nextGroups = hasGroup
      ? settings.selectedAssetGroups.filter((item) => item !== group)
      : [...settings.selectedAssetGroups, group];
    onChange({ ...settings, selectedAssetGroups: nextGroups.length ? nextGroups : fallbackGroups });
  };

  return (
    <div className={`ivq-screener-drawer ${open ? "is-open" : ""}`}>
      <button type="button" className="ivq-screener-drawer__toggle" onClick={onToggle}>
        <Settings2 size={14} /> Settings
      </button>
      <aside className="glass-panel ivq-screener-drawer__panel">
        <div className="ivq-screener-drawer__head">
          <div>
            <div className="ivq-section-label">Pine Settings</div>
            <h2 className="ivq-terminal-title">Screener Inputs</h2>
          </div>
          <div className="ivq-screener-drawer__status">
            <div>{loadedCount}/{totalCount} geladen</div>
            <div>{resultCount} Zeilen</div>
          </div>
        </div>

        <div className="ivq-screener-drawer__actions">
          <button type="button" className="ivq-segment-btn" onClick={onApply} style={{ background: themeAccent, borderColor: themeAccent, color: theme === "gold" ? "#110d07" : "#04101f" }}>
            Berechnen
          </button>
          <button type="button" className="ivq-segment-btn" onClick={onRefresh}>Refresh Data</button>
        </div>

        <div className="ivq-screener-drawer__grid">
          <label className="ivq-form-row">
            <span>Quelle <Tip text="Marktdatenquelle fuer Screener und Chart." /></span>
            <select value={settings.source} onChange={(event) => onChange({ ...settings, source: event.target.value as PineScreenerSettings["source"] })} className="ivq-select">
              <option value="tradingview">TradingView</option>
              <option value="dukascopy">Dukascopy</option>
              <option value="yahoo">Yahoo</option>
            </select>
          </label>
          <label className="ivq-form-row">
            <span>Timeframe <Tip text="Screener-Basis fuer die Candles." /></span>
            <select value={settings.timeframe} onChange={(event) => onChange({ ...settings, timeframe: event.target.value as PineScreenerSettings["timeframe"] })} className="ivq-select">
              <option value="D">Daily</option>
              <option value="W">Weekly</option>
            </select>
          </label>

          <label className="ivq-form-row">
            <span>Asset Groups <Tip text="Standardgruppen fuer den Scan." /></span>
            <div className="ivq-screener-group-picker">
              <button
                type="button"
                className={`ivq-screener-group-chip ivq-screener-group-chip--all ${allGroupsSelected ? "is-active" : ""}`}
                onClick={() => onChange({ ...settings, selectedAssetGroups: allGroupsSelected ? fallbackGroups : assetGroups })}
              >
                <span>Alle</span>
                <small>{assetGroups.length}</small>
              </button>
              {assetGroups.map((group) => {
                const active = settings.selectedAssetGroups.includes(group);
                return (
                  <button
                    key={group}
                    type="button"
                    className={`ivq-screener-group-chip ${active ? "is-active" : ""}`}
                    onClick={() => toggleAssetGroup(group)}
                  >
                    <span>{group}</span>
                    <small>{assetGroupCounts[group] ?? 0}</small>
                  </button>
                );
              })}
            </div>
          </label>

          <label className="ivq-form-row">
            <span>Lookback <Tip text="Lookback 2 bedeutet aktueller Bar plus die zwei vorherigen Bars." /></span>
            <input type="number" className="ivq-select" value={settings.screenerLookback} onChange={(event) => onChange({ ...settings, screenerLookback: Number(event.target.value) || 2 })} />
          </label>
        </div>

        <p className="text-xs text-slate-400">
          Valuation Check, Supply &amp; Demand und Entry Confirm sind fest aktiv und definieren den Entry automatisch.
        </p>
      </aside>
    </div>
  );
}
