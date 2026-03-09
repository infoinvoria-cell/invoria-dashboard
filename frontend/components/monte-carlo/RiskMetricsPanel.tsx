"use client";

import { CheckCircle2 } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";

import { getMonteCarloPalette } from "@/components/monte-carlo/theme";
import type { MetricSparkline, ModelSummaryItem, MonteCarloTheme, ResearchReport } from "@/components/monte-carlo/types";

type Props = {
  theme: MonteCarloTheme;
  report: ResearchReport;
  modelCards: ModelSummaryItem[];
  metricSparklines: MetricSparkline;
  animationProgress: number;
};

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function animatedSeries(values: number[], progress: number): Array<{ index: number; value: number }> {
  const visible = Math.max(2, Math.round(values.length * Math.max(progress, 0.05)));
  return values.slice(0, visible).map((value, index) => ({ index, value }));
}

function MiniMetricChart({
  values,
  theme,
  tone,
  progress,
}: {
  values: number[];
  theme: MonteCarloTheme;
  tone: string;
  progress: number;
}) {
  const palette = getMonteCarloPalette(theme);
  return (
    <div className="h-[42px]">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={animatedSeries(values, progress)} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
          <Area type="monotone" dataKey="value" stroke={tone} fill={tone} fillOpacity={0.16} strokeWidth={1.8} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function RiskMetricsPanel({ theme, report, modelCards, metricSparklines, animationProgress }: Props) {
  const palette = getMonteCarloPalette(theme);

  const cards = [
    ["Expected Return", formatPercent(report.expectedReturn), palette.accentStrong, metricSparklines.expectedReturn],
    ["Volatility", formatPercent(report.volatility), palette.accent, metricSparklines.volatility],
    ["Max Drawdown", formatPercent(report.maxDrawdown), palette.negative, metricSparklines.maxDrawdown],
    ["Sharpe Ratio", report.sharpeRatio.toFixed(2), palette.accentSoft, metricSparklines.sharpeRatio],
    ["Sortino Ratio", report.sortinoRatio.toFixed(2), palette.heading, metricSparklines.sharpeRatio.map((value) => value * 1.08)],
    ["VaR", formatPercent(report.valueAtRisk), palette.negative, metricSparklines.maxDrawdown.map((value) => value * 0.85)],
    ["CVaR", formatPercent(report.expectedShortfall), palette.negative, metricSparklines.maxDrawdown.map((value) => value * 1.1)],
    ["Regime Probability", formatPercent(report.regimeProbability), palette.accent, metricSparklines.volatility.map((value, index) => value * (index % 2 === 0 ? 0.94 : 1.02))],
    ["Robustness", `${report.strategyRobustnessScore.toFixed(0)}/100`, palette.positive, metricSparklines.robustness],
    ["Overfitting Risk", `${report.overfittingRiskScore.toFixed(0)}/100`, palette.negative, metricSparklines.overfitting],
    ["DD Probability", formatPercent(report.maxDrawdownProbability), palette.negative, metricSparklines.maxDrawdown.map((value) => value * 0.95)],
    ["Posterior Return", formatPercent(report.posteriorReturn), palette.accentStrong, metricSparklines.expectedReturn.map((value, index) => value * (index % 2 === 0 ? 0.96 : 1.02))],
  ] as const;

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
        {cards.map(([label, value, tone, sparkline]) => (
          <div key={label} className="rounded-[18px] border p-3.5" style={{ borderColor: palette.border, background: palette.panelBackgroundSoft }}>
            <div className="text-[10px] uppercase tracking-[0.18em]" style={{ color: palette.muted }}>
              {label}
            </div>
            <div className="mt-1 text-[22px] font-semibold" style={{ color: palette.heading }}>
              {value}
            </div>
            <div className="mt-2">
              <MiniMetricChart values={sparkline} theme={theme} tone={tone} progress={animationProgress} />
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
            <MiniMetricChart
              values={item.sparkline}
              theme={theme}
              tone={
                item.tone === "negative"
                  ? palette.negative
                  : item.tone === "positive"
                    ? palette.positive
                    : item.tone === "accent"
                      ? palette.accent
                      : palette.heading
              }
              progress={animationProgress}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
