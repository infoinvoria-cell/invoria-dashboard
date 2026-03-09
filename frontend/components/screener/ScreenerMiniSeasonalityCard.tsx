"use client";

import SeasonalityChart from "@/components/globe/charts/SeasonalityChart";
import { seasonalityRiskStats, seasonalitySummary } from "@/lib/screener/seasonality";
import type { ScreenerTheme } from "@/lib/screener/types";
import type { HeatmapSeasonalityItem, SeasonalityResponse } from "@/types";

type Props = {
  theme: ScreenerTheme;
  payload: SeasonalityResponse | null;
  fallback: HeatmapSeasonalityItem | null;
};

function winTone(winRate: number): string {
  if (winRate >= 60) return "text-emerald-300";
  if (winRate >= 50) return "text-slate-200";
  return "text-rose-300";
}

function fmt(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
}

export default function ScreenerMiniSeasonalityCard({ theme, payload, fallback }: Props) {
  const summary = seasonalitySummary(payload, fallback);
  const risk = seasonalityRiskStats(payload);

  return (
    <section className={`glass-panel ivq-screener-mini-card ivq-screener-mini-card--season ${theme === "gold" ? "is-gold" : "is-blue"}`}>
      <div className="ivq-screener-mini-card__head">
        <div className="ivq-section-label">Seasonality Pattern</div>
        <div className={`ivq-screener-winrate ${winTone(summary.hitRatePct)}`}>{Math.round(summary.hitRatePct)}%</div>
      </div>
      <div className="ivq-screener-mini-card__chart">
        <SeasonalityChart payload={payload} />
      </div>
      <div className="ivq-screener-season-stats">
        <span className={summary.direction === "LONG" ? "text-emerald-300" : summary.direction === "SHORT" ? "text-rose-300" : "text-slate-300"}>{summary.direction}</span>
        <span>EV {fmt(summary.expectedReturn)}%</span>
        <span>Sharpe {risk.sharpeRatio.toFixed(2)}</span>
        <span>Sortino {risk.sortinoRatio.toFixed(2)}</span>
        <span>Max DD {risk.maxDrawdownPct.toFixed(1)}%</span>
        <span>Avg DD {risk.averageDrawdownPct.toFixed(1)}%</span>
      </div>
    </section>
  );
}
