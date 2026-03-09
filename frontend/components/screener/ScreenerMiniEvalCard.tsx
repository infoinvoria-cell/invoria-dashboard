"use client";

import EvaluationChart from "@/components/globe/charts/EvaluationChart";
import type { ValuationSeriesPoint, ScreenerTheme } from "@/lib/screener/types";
import type { EvaluationResponse } from "@/types";

type Props = {
  title: string;
  mode: "v10" | "v20";
  payload: EvaluationResponse | null;
  activePoint: ValuationSeriesPoint | null;
  theme: ScreenerTheme;
};

function tone(value: number | null | undefined): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "text-slate-300";
  if (numeric <= -75) return "text-emerald-300";
  if (numeric >= 75) return "text-rose-300";
  return "text-slate-200";
}

export default function ScreenerMiniEvalCard({ title, mode, payload, activePoint, theme }: Props) {
  return (
    <section className="glass-panel ivq-screener-mini-card">
      <div className="ivq-screener-mini-card__head">
        <div className="ivq-section-label">{title}</div>
        <div className="ivq-screener-mini-card__metrics">
          <span className={tone(activePoint?.combined)}>{activePoint?.combined != null ? activePoint.combined.toFixed(0) : "--"}</span>
          <span>{activePoint?.phaseval ?? "NEUTRAL"}</span>
          <span>{activePoint ? `${activePoint.longHits}/${activePoint.shortHits}` : "--"}</span>
        </div>
      </div>
      <div className="ivq-screener-mini-card__chart">
        <EvaluationChart payload={payload} mode={mode} />
      </div>
      <div className="ivq-screener-mini-card__foot">
        <span>1/4 {activePoint?.long1 || activePoint?.short1 ? "ok" : "-"}</span>
        <span>2/4 {activePoint?.long12 || activePoint?.short12 ? "ok" : "-"}</span>
        <span>{mode === "v10" ? "Window 10" : "Window 20"}</span>
      </div>
    </section>
  );
}
