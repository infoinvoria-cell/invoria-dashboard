"use client";

import { CheckCircle2 } from "lucide-react";

import { getMonteCarloPalette } from "@/components/monte-carlo/theme";
import type { ModelSummaryItem, MonteCarloTheme, ResearchReport } from "@/components/monte-carlo/types";

type Props = {
  theme: MonteCarloTheme;
  report: ResearchReport;
  modelCards: ModelSummaryItem[];
};

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

export default function ResultsSummary({ theme, report, modelCards }: Props) {
  const palette = getMonteCarloPalette(theme);

  return (
    <section className="glass-panel rounded-[24px] border p-4 min-[769px]:p-5" style={{ background: palette.panelBackground, borderColor: palette.border, boxShadow: `0 18px 44px rgba(0,0,0,0.30), 0 0 28px ${palette.glow}` }}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="ivq-section-label">Results Panel</div>
          <h2 className="text-lg font-semibold" style={{ color: palette.heading }}>
            Final research output
          </h2>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px]" style={{ borderColor: palette.border, color: palette.heading }}>
          <CheckCircle2 size={12} style={{ color: palette.accent }} />
          Risk score {report.riskScore.toFixed(0)}/100
        </div>
      </div>

      <div className="grid gap-3 min-[769px]:grid-cols-2">
        {[
          ["Expected Return", formatPercent(report.expectedReturn)],
          ["Volatility", formatPercent(report.volatility)],
          ["Max Drawdown", formatPercent(report.maxDrawdown)],
          ["VaR", formatPercent(report.valueAtRisk)],
          ["CVaR", formatPercent(report.expectedShortfall)],
          ["Sharpe Ratio", report.sharpeRatio.toFixed(2)],
          ["Sortino Ratio", report.sortinoRatio.toFixed(2)],
          ["Regime Probability", formatPercent(report.regimeProbability)],
          ["Profit Probability", formatPercent(report.profitProbability)],
          ["Bayesian Return", formatPercent(report.posteriorReturn)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-[18px] border p-3.5" style={{ borderColor: palette.border, background: palette.panelBackgroundSoft }}>
            <div className="text-[10px] uppercase tracking-[0.18em]" style={{ color: palette.muted }}>
              {label}
            </div>
            <div className="mt-1 text-[22px] font-semibold" style={{ color: palette.heading }}>
              {value}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-2 min-[769px]:grid-cols-4">
        {modelCards.map((item) => (
          <div
            key={item.id}
            className="rounded-[16px] border px-3 py-2.5"
            style={{ borderColor: palette.border, background: palette.panelBackgroundSoft }}
          >
            <div className="text-[10px] uppercase tracking-[0.16em]" style={{ color: palette.muted }}>
              {item.label}
            </div>
            <div
              className="mt-1 text-[16px] font-semibold"
              style={{
                color:
                  item.tone === "negative"
                    ? palette.negative
                    : item.tone === "positive"
                      ? palette.positive
                      : item.tone === "accent"
                        ? palette.accentStrong
                        : palette.heading,
              }}
            >
              {item.value}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
