"use client";

import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { getMonteCarloPalette } from "@/components/monte-carlo/theme";
import type { MonteCarloTheme, StressScenarioResult } from "@/components/monte-carlo/types";

type Props = {
  theme: MonteCarloTheme;
  scenarios: StressScenarioResult[];
  animationProgress: number;
};

export default function StressTestPanel({ theme, scenarios, animationProgress }: Props) {
  const palette = getMonteCarloPalette(theme);
  const activeScenario = scenarios[0];
  const visiblePoints = activeScenario ? activeScenario.pathSeries.slice(0, Math.max(2, Math.round(activeScenario.pathSeries.length * Math.max(animationProgress, 0.08)))) : [];

  return (
    <section className="glass-panel rounded-[24px] border p-4 min-[769px]:p-5" style={{ background: palette.panelBackground, borderColor: palette.border, boxShadow: `0 18px 44px rgba(0,0,0,0.30), 0 0 28px ${palette.glow}` }}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <div className="ivq-section-label">Stress Testing Engine</div>
          <h2 className="text-lg font-semibold" style={{ color: palette.heading }}>
            Historische Krisenszenarien
          </h2>
        </div>
        <div className="text-[11px]" style={{ color: palette.muted }}>
          {activeScenario?.label ?? "Stress"}
        </div>
      </div>

      <div className="grid gap-4 min-[769px]:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)]">
        <div className="h-[280px] rounded-[18px] border p-3" style={{ borderColor: palette.border, background: palette.panelBackgroundSoft }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={visiblePoints} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={palette.chartGrid} vertical={false} />
              <XAxis dataKey="label" tick={{ fill: palette.muted, fontSize: 11 }} minTickGap={28} tickLine={false} axisLine={false} />
              <YAxis tick={{ fill: palette.muted, fontSize: 11 }} tickLine={false} axisLine={false} width={42} />
              <Tooltip contentStyle={{ background: theme === "dark" ? "#0d0b08" : "#071427", border: `1px solid ${palette.border}`, borderRadius: 14, color: palette.text }} />
              <Line type="monotone" dataKey="median" stroke={palette.negative} strokeWidth={2.4} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="p05" stroke={palette.accent} strokeWidth={1.4} dot={false} strokeDasharray="5 5" isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="grid gap-4">
          <div className="h-[134px] rounded-[18px] border p-3" style={{ borderColor: palette.border, background: palette.panelBackgroundSoft }}>
            <div className="mb-2 text-[11px] uppercase tracking-[0.16em]" style={{ color: palette.muted }}>
              Drawdown Comparison
            </div>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={scenarios} layout="vertical" margin={{ top: 0, right: 12, left: 8, bottom: 0 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="id" hide />
                <Bar dataKey="maxDrawdown" radius={[0, 6, 6, 0]} isAnimationActive={false}>
                  {scenarios.map((scenario) => (
                    <Cell key={`${scenario.id}-dd`} fill={palette.negative} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="grid gap-2">
            {scenarios.slice(0, 5).map((scenario) => (
              <div key={scenario.id} className="rounded-[16px] border p-3" style={{ borderColor: palette.border, background: palette.panelBackgroundSoft }}>
                <div className="text-[11px] font-semibold" style={{ color: palette.heading }}>
                  {scenario.label}
                </div>
                <div className="mt-1 text-[11px] leading-5" style={{ color: palette.muted }}>
                  Return {(scenario.terminalReturn * 100).toFixed(1)}% | DD {(scenario.maxDrawdown * 100).toFixed(1)}%
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
