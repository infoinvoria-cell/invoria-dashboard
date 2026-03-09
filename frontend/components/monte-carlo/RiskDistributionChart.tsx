"use client";

import { Info } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { getMonteCarloPalette } from "@/components/monte-carlo/theme";
import type { HistogramBin, MonteCarloTheme } from "@/components/monte-carlo/types";

type Props = {
  theme: MonteCarloTheme;
  histogram: HistogramBin[];
  varHistorical: number;
  varParametric: number;
  esHistorical: number;
  esParametric: number;
  confidenceLabel: string;
  animationProgress: number;
};

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

export default function RiskDistributionChart({
  theme,
  histogram,
  varHistorical,
  varParametric,
  esHistorical,
  esParametric,
  confidenceLabel,
  animationProgress,
}: Props) {
  const palette = getMonteCarloPalette(theme);
  const visibleBins = histogram.slice(0, Math.max(2, Math.round(histogram.length * Math.max(0.05, animationProgress))));
  const histogramData = visibleBins.map((bin) => ({
    ...bin,
    tailMark: bin.isVarTail ? bin.count : null,
  }));

  return (
    <section className="glass-panel rounded-[24px] border p-4 min-[769px]:p-5" style={{ background: palette.panelBackground, borderColor: palette.border, boxShadow: `0 18px 44px rgba(0,0,0,0.30), 0 0 28px ${palette.glow}` }}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="ivq-section-label">Return Distribution</div>
          <h2 className="text-lg font-semibold" style={{ color: palette.heading }}>
            Historical and parametric VaR / CVaR
          </h2>
        </div>
        <span className="inline-flex items-center gap-2 text-[11px]" style={{ color: palette.muted }} title="Maximum expected loss at a given confidence level. Expected shortfall measures the average loss beyond the VaR threshold.">
          <Info size={13} /> {confidenceLabel}
        </span>
      </div>

      <div className="grid gap-4 min-[769px]:grid-cols-[minmax(0,1.5fr)_minmax(240px,0.8fr)]">
        <div className="h-[290px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={histogramData} margin={{ top: 10, right: 10, bottom: 8, left: 0 }}>
              <CartesianGrid stroke={palette.chartGrid} vertical={false} />
              <XAxis dataKey="label" tick={{ fill: palette.muted, fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={22} />
              <YAxis tick={{ fill: palette.muted, fontSize: 10 }} tickLine={false} axisLine={false} width={38} />
              <Tooltip
                cursor={{ fill: "rgba(255,255,255,0.03)" }}
                contentStyle={{ borderRadius: 12, border: `1px solid ${palette.border}`, background: theme === "dark" ? "rgba(11,9,7,0.95)" : "rgba(9,18,38,0.95)" }}
                labelStyle={{ color: palette.heading }}
              />
              <ReferenceLine x={`${(-varHistorical * 100).toFixed(2)}%`} stroke={palette.negative} strokeDasharray="4 4" />
              <Bar dataKey="count" radius={[5, 5, 0, 0]}>
                {histogramData.map((entry) => (
                  <Cell
                    key={entry.label}
                    fill={
                      entry.isExpectedShortfallTail
                        ? palette.negative
                        : entry.isVarTail
                          ? theme === "dark"
                            ? "#b86f5d"
                            : "#7f8fff"
                          : palette.accent
                    }
                    opacity={entry.isVarTail ? 0.95 : 0.78}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="grid gap-3">
          {[
            { label: "Historical VaR", value: varHistorical, tone: palette.negative },
            { label: "Parametric VaR", value: varParametric, tone: palette.accent },
            { label: "Historical CVaR", value: esHistorical, tone: palette.negative },
            { label: "Parametric CVaR", value: esParametric, tone: palette.accentSoft },
          ].map((item) => (
            <div key={item.label} className="rounded-[18px] border p-3.5" style={{ borderColor: palette.border, background: palette.panelBackgroundSoft }}>
              <div className="text-[10px] uppercase tracking-[0.18em]" style={{ color: palette.muted }}>
                {item.label}
              </div>
              <div className="mt-1 text-[24px] font-semibold" style={{ color: item.tone }}>
                {formatPercent(item.value)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
