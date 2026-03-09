"use client";

import CandleChart from "@/components/globe/charts/CandleChart";
import { zonesToTimeseriesPayload } from "@/lib/screener/pineLikeEngine";
import type { PineScreenerSettings, ScreenerSelectedAnalysis, ScreenerTheme } from "@/lib/screener/types";

type Props = {
  assetName: string;
  theme: ScreenerTheme;
  analysis: ScreenerSelectedAnalysis | null;
  settings: PineScreenerSettings;
};

function titleCase(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "--";
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

export default function ScreenerMainChart({ assetName, theme, analysis, settings }: Props) {
  if (!analysis?.timeseries) {
    return (
      <section className="glass-panel ivq-screener-main-card">
        <div className="grid h-[520px] place-items-center text-sm text-slate-400">Lade Candles und Pine-Signale...</div>
      </section>
    );
  }

  const payload = zonesToTimeseriesPayload(analysis.timeseries, analysis.zones);
  const activeZones = analysis.zones.filter((zone) => zone.active).length;
  const zoneMode = activeZones > 0 ? "Active" : "Off";
  const timeframe = String(analysis.timeseries.diagnostics?.timeframe ?? settings.timeframe ?? "D");
  const dataType = titleCase(analysis.timeseries.continuousMode ?? "regular");

  return (
    <section className="glass-panel ivq-screener-main-card">
      <div className="ivq-screener-main-card__head">
        <div>
          <div className="ivq-section-label">Screener Chart</div>
          <h2 className="ivq-terminal-title">{assetName}</h2>
        </div>
      </div>
      <div className="ivq-screener-main-card__body ivq-screener-main-card__body--meta">
        <div className="ivq-screener-chart-meta">
          <span>{assetName}</span>
          <span>{timeframe}</span>
          <span>{dataType}</span>
          <span>Lookback:{settings.screenerLookback}</span>
          <span>Zones:{zoneMode}</span>
        </div>
        <CandleChart
          payload={payload}
          evaluation={analysis.valuation?.evaluationPayload ?? null}
          seasonality={analysis.seasonality ?? null}
          title={assetName}
          sourceLabel={analysis.timeseries.sourceUsed ?? analysis.timeseries.source ?? "TradingView"}
          goldThemeEnabled={theme === "gold"}
          themePrimary={theme === "gold" ? "#d6c38f" : "#4d87fe"}
        />
      </div>
    </section>
  );
}
