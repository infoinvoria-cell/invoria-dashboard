"use client";

import { Info } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { getMonteCarloPalette } from "@/components/monte-carlo/theme";
import type { DrawdownPoint, MonteCarloTheme } from "@/components/monte-carlo/types";

type Props = {
  theme: MonteCarloTheme;
  kellyFraction: number;
  kellyFractionCapped: number;
  payoffRatio: number;
  drawdownSeries: DrawdownPoint[];
  sharpeStabilityMedian: number;
};

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export default function KellyOptimizationCard({
  theme,
  kellyFraction,
  kellyFractionCapped,
  payoffRatio,
  drawdownSeries,
  sharpeStabilityMedian,
}: Props) {
  const palette = getMonteCarloPalette(theme);

  return (
    <section className="glass-panel rounded-[24px] border p-4 min-[769px]:p-5" style={{ background: palette.panelBackground, borderColor: palette.border, boxShadow: `0 18px 44px rgba(0,0,0,0.30), 0 0 28px ${palette.glow}` }}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="ivq-section-label">Kelly Allocation</div>
          <h2 className="text-lg font-semibold" style={{ color: palette.heading }}>
            Position sizing and drawdown stability
          </h2>
        </div>
        <span className="inline-flex items-center gap-2 text-[11px]" style={{ color: palette.muted }} title="Kelly Criterion estimates the optimal fraction of capital to allocate based on win rate and payoff ratio.">
          <Info size={13} /> Kelly
        </span>
      </div>

      <div className="grid gap-4 min-[769px]:grid-cols-[220px_minmax(0,1fr)]">
        <div className="space-y-3">
          <div className="rounded-[18px] border p-3.5" style={{ borderColor: palette.border, background: palette.panelBackgroundSoft }}>
            <div className="text-[10px] uppercase tracking-[0.18em]" style={{ color: palette.muted }}>
              Recommended capital allocation
            </div>
            <div className="mt-1 text-[28px] font-semibold" style={{ color: palette.accentStrong }}>
              {formatPercent(kellyFractionCapped)}
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/25">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max(4, kellyFractionCapped * 100)}%`,
                  background: `linear-gradient(90deg, ${palette.accent}, ${palette.accentStrong})`,
                }}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-[18px] border p-3" style={{ borderColor: palette.border, background: palette.panelBackgroundSoft }}>
              <div className="text-[10px] uppercase tracking-[0.18em]" style={{ color: palette.muted }}>
                Raw Kelly
              </div>
              <div className="mt-1 text-[20px] font-semibold" style={{ color: palette.heading }}>
                {formatPercent(kellyFraction)}
              </div>
            </div>
            <div className="rounded-[18px] border p-3" style={{ borderColor: palette.border, background: palette.panelBackgroundSoft }}>
              <div className="text-[10px] uppercase tracking-[0.18em]" style={{ color: palette.muted }}>
                Payoff
              </div>
              <div className="mt-1 text-[20px] font-semibold" style={{ color: palette.heading }}>
                {payoffRatio.toFixed(2)}x
              </div>
            </div>
          </div>

          <div className="rounded-[18px] border p-3" style={{ borderColor: palette.border, background: palette.panelBackgroundSoft }}>
            <div className="text-[10px] uppercase tracking-[0.18em]" style={{ color: palette.muted }}>
              Sharpe stability
            </div>
            <div className="mt-1 text-[20px] font-semibold" style={{ color: palette.heading }}>
              {sharpeStabilityMedian.toFixed(2)}
            </div>
          </div>
        </div>

        <div className="h-[270px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={drawdownSeries} margin={{ top: 10, right: 10, bottom: 6, left: 0 }}>
              <CartesianGrid stroke={palette.chartGrid} vertical={false} />
              <XAxis dataKey="step" tick={{ fill: palette.muted, fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fill: palette.muted, fontSize: 10 }} tickFormatter={(value) => `${(value * 100).toFixed(0)}%`} tickLine={false} axisLine={false} width={46} />
              <Tooltip
                contentStyle={{ borderRadius: 12, border: `1px solid ${palette.border}`, background: theme === "dark" ? "rgba(11,9,7,0.95)" : "rgba(9,18,38,0.95)" }}
                labelStyle={{ color: palette.heading }}
              />
              <Area type="monotone" dataKey="p95Worst" stroke={palette.negative} fill={palette.negative} fillOpacity={0.2} />
              <Area type="monotone" dataKey="median" stroke={palette.accent} fill={palette.accent} fillOpacity={0.28} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
}
