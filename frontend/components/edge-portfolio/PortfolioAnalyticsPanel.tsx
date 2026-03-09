"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { PortfolioContributionItem, TradeHistogramBin } from "@/components/edge-portfolio/metrics";
import type { TrackRecordTheme } from "@/components/track-record/metrics";
import { getTrackRecordThemePalette } from "@/components/track-record/theme";

type Props = {
  theme: TrackRecordTheme;
  riskContributions: PortfolioContributionItem[];
  histogram: TradeHistogramBin[];
};

export default function PortfolioAnalyticsPanel({ theme, riskContributions, histogram }: Props) {
  const palette = getTrackRecordThemePalette(theme);

  return (
    <section
      className="relative overflow-hidden rounded-[24px] border p-3.5 backdrop-blur-[20px] min-[769px]:p-4"
      style={{ background: palette.panelBackgroundStrong, borderColor: palette.panelBorder, boxShadow: palette.panelShadow }}
    >
      <div className="mb-3">
        <div className="text-[12px] font-semibold uppercase tracking-[0.2em]" style={{ color: palette.heading }}>
          Risk & Trade Distribution
        </div>
        <div className="mt-1 text-[11px]" style={{ color: palette.muted }}>
          Strategy risk share, drawdown burden and trade return histogram
        </div>
      </div>

      <div className="grid gap-3 min-[769px]:grid-cols-2">
        <div className="rounded-[18px] border p-3" style={{ borderColor: palette.panelBorder, background: "rgba(7,10,15,0.68)" }}>
          <div className="mb-2 text-[10px] uppercase tracking-[0.18em]" style={{ color: palette.muted }}>
            Risk contribution by strategy
          </div>
          <div className="h-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={riskContributions} margin={{ top: 8, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid stroke={palette.grid} strokeDasharray="2 8" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: palette.muted, fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis hide />
                <Tooltip contentStyle={{ borderRadius: 14, border: `1px solid ${palette.panelBorder}`, background: "rgba(7,10,15,0.96)" }} />
                <Bar dataKey="riskShare" radius={[6, 6, 0, 0]} isAnimationActive={false}>
                  {riskContributions.map((item) => (
                    <Cell key={`${item.id}-risk`} fill={item.color} />
                  ))}
                </Bar>
                <Bar dataKey="drawdownShare" radius={[6, 6, 0, 0]} isAnimationActive={false}>
                  {riskContributions.map((item) => (
                    <Cell key={`${item.id}-drawdown`} fill={palette.negative} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-[18px] border p-3" style={{ borderColor: palette.panelBorder, background: "rgba(7,10,15,0.68)" }}>
          <div className="mb-2 text-[10px] uppercase tracking-[0.18em]" style={{ color: palette.muted }}>
            Trade return histogram
          </div>
          <div className="h-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={histogram} margin={{ top: 8, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid stroke={palette.grid} strokeDasharray="2 8" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: palette.muted, fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={18} />
                <YAxis hide />
                <Tooltip contentStyle={{ borderRadius: 14, border: `1px solid ${palette.panelBorder}`, background: "rgba(7,10,15,0.96)" }} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                  {histogram.map((bin) => (
                    <Cell key={bin.label} fill={bin.midpoint >= 0 ? palette.accent : palette.negative} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </section>
  );
}
