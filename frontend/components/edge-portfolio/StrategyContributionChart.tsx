"use client";

import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { PortfolioContributionItem, PortfolioContributionRow } from "@/components/edge-portfolio/metrics";
import type { TrackRecordTheme } from "@/components/track-record/metrics";
import { getTrackRecordThemePalette } from "@/components/track-record/theme";

type Props = {
  theme: TrackRecordTheme;
  contributionItems: PortfolioContributionItem[];
  monthlyContributionRows: PortfolioContributionRow[];
};

export default function StrategyContributionChart({ theme, contributionItems, monthlyContributionRows }: Props) {
  const palette = getTrackRecordThemePalette(theme);

  return (
    <section
      className="relative overflow-hidden rounded-[24px] border p-3.5 backdrop-blur-[20px] min-[769px]:p-4"
      style={{ background: palette.panelBackgroundStrong, borderColor: palette.panelBorder, boxShadow: palette.panelShadow }}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-[12px] font-semibold uppercase tracking-[0.2em]" style={{ color: palette.heading }}>
            Strategy Contribution
          </div>
          <div className="mt-1 text-[11px]" style={{ color: palette.muted }}>
            Return contribution, risk share and weighted portfolio impact
          </div>
        </div>
      </div>

      <div className="grid gap-3 min-[769px]:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
        <div className="rounded-[18px] border p-3" style={{ borderColor: palette.panelBorder, background: "rgba(7,10,15,0.68)" }}>
          <div className="mb-2 text-[10px] uppercase tracking-[0.18em]" style={{ color: palette.muted }}>
            Monthly contribution
          </div>
          <div className="h-[210px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyContributionRows} margin={{ top: 8, right: 10, left: -12, bottom: 0 }}>
                <CartesianGrid stroke={palette.grid} strokeDasharray="2 8" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: palette.muted, fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: palette.muted, fontSize: 11 }} tickLine={false} axisLine={false} width={42} />
                <Tooltip contentStyle={{ borderRadius: 14, border: `1px solid ${palette.panelBorder}`, background: "rgba(7,10,15,0.96)" }} />
                {contributionItems.map((item) => (
                  <Bar key={item.id} dataKey={item.id} stackId="a" fill={item.color} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="grid gap-3">
          <div className="rounded-[18px] border p-3" style={{ borderColor: palette.panelBorder, background: "rgba(7,10,15,0.68)" }}>
            <div className="mb-2 text-[10px] uppercase tracking-[0.18em]" style={{ color: palette.muted }}>
              Weighted return contribution
            </div>
            <div className="h-[96px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={contributionItems} layout="vertical" margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" width={84} tick={{ fill: palette.muted, fontSize: 10 }} tickLine={false} axisLine={false} />
                  <Bar dataKey="weightedReturn" radius={[0, 6, 6, 0]} isAnimationActive={false}>
                    {contributionItems.map((item) => (
                      <Cell key={item.id} fill={item.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-[18px] border p-3" style={{ borderColor: palette.panelBorder, background: "rgba(7,10,15,0.68)" }}>
            <div className="mb-2 text-[10px] uppercase tracking-[0.18em]" style={{ color: palette.muted }}>
              Risk contribution
            </div>
            <div className="h-[96px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={contributionItems} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid stroke={palette.grid} strokeDasharray="2 8" vertical={false} />
                  <XAxis dataKey="name" tick={{ fill: palette.muted, fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis hide />
                  <Line type="monotone" dataKey="riskShare" stroke={palette.accent} strokeWidth={2.2} dot={{ r: 3 }} isAnimationActive={false} />
                  <Line type="monotone" dataKey="drawdownShare" stroke={palette.negative} strokeWidth={1.8} dot={{ r: 2.5 }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
