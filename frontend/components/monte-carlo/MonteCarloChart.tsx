"use client";

import { Info } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { getMonteCarloPalette } from "@/components/monte-carlo/theme";
import type { MonteCarloTheme, SimulationControls, SimulationPathPoint } from "@/components/monte-carlo/types";

type Props = {
  theme: MonteCarloTheme;
  pathSeries: SimulationPathPoint[];
  bootstrapPathSeries: SimulationPathPoint[];
  controls: SimulationControls;
  animationProgress: number;
  isRunning: boolean;
  compact?: boolean;
};

function animatedSlice<T>(rows: T[], progress: number): T[] {
  if (!rows.length) return [];
  const visible = Math.max(2, Math.round(rows.length * Math.max(0.02, progress)));
  return rows.slice(0, visible);
}

export default function MonteCarloChart({
  theme,
  pathSeries,
  bootstrapPathSeries,
  controls,
  animationProgress,
  isRunning,
  compact = false,
}: Props) {
  const palette = getMonteCarloPalette(theme);
  const panelPaddingClass = compact ? "p-3.5 min-[769px]:p-4" : "p-4 min-[769px]:p-5";
  const chartData = animatedSlice(pathSeries, animationProgress).map((point) => ({
    ...point,
    sample1: point.samples[0],
    sample2: point.samples[1],
    sample3: point.samples[2],
  }));
  const bootstrapData = animatedSlice(bootstrapPathSeries, animationProgress).map((point) => ({
    ...point,
    sample1: point.samples[0],
    sample2: point.samples[1],
    sample3: point.samples[2],
  }));

  return (
    <section
      className={`glass-panel flex h-full min-h-[320px] flex-col rounded-[24px] border ${panelPaddingClass}`}
      style={{ background: palette.panelBackground, borderColor: palette.border, boxShadow: `0 18px 44px rgba(0,0,0,0.30), 0 0 30px ${palette.glow}` }}
    >
      <div className={`flex items-start justify-between gap-3 ${compact ? "mb-3" : "mb-4"}`}>
        <div>
          <div className="ivq-section-label">Monte Carlo Simulation Paths</div>
          <h2 className={`${compact ? "text-base" : "text-lg"} font-semibold`} style={{ color: palette.heading }}>
            GBM probability cone with progressive path animation
          </h2>
        </div>
        <span className="inline-flex items-center gap-2 text-[11px]" style={{ color: palette.muted }} title="Monte-Carlo-Simulation: Simuliert viele moegliche zukuenftige Kursverlaeufe basierend auf historischen Renditen.">
          <Info size={13} /> {isRunning ? "Animation aktiv" : "GBM"}
        </span>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 min-[769px]:grid-cols-[minmax(0,1.78fr)_minmax(232px,0.7fr)]">
        <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] gap-3">
          <div className="min-h-[340px] min-w-0 rounded-[18px] border p-2.5 min-[769px]:p-3" style={{ borderColor: palette.border, background: palette.panelBackgroundSoft }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 12, right: 12, bottom: 6, left: 0 }}>
                <defs>
                  <linearGradient id="ivqMonteBand" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={palette.accent} stopOpacity={0.28} />
                    <stop offset="100%" stopColor={palette.accent} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={palette.chartGrid} vertical={false} />
                <XAxis dataKey="label" tick={{ fill: palette.muted, fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={36} />
                <YAxis tick={{ fill: palette.muted, fontSize: 11 }} tickLine={false} axisLine={false} width={56} />
                <Tooltip
                  cursor={{ stroke: palette.accent, strokeOpacity: 0.2 }}
                  contentStyle={{ borderRadius: 12, border: `1px solid ${palette.border}`, background: theme === "dark" ? "rgba(11,9,7,0.95)" : "rgba(9,18,38,0.95)" }}
                  labelStyle={{ color: palette.heading }}
                />
                <Area type="monotone" dataKey="p95" stroke="none" fill="url(#ivqMonteBand)" />
                <Area type="monotone" dataKey="p05" stroke="none" fill={theme === "dark" ? "rgba(4,4,4,0.96)" : "rgba(4,8,20,0.96)"} />
                <Line type="monotone" dataKey="median" stroke={palette.accentStrong} strokeWidth={2.4} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="mean" stroke={palette.accent} strokeWidth={1.4} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="grid gap-2 min-[769px]:grid-cols-4">
            {[
              ["Simulationen", String(controls.simulationCount)],
              ["Horizont", `${controls.horizon} Tage`],
              ["Drift", `${(controls.drift * 100).toFixed(2)}%`],
              ["Volatilitaet", `${(controls.volatility * 100).toFixed(2)}%`],
            ].map(([label, value]) => (
              <div
                key={label}
                className="rounded-[16px] border px-3 py-2.5"
                style={{ borderColor: palette.border, background: palette.panelBackgroundSoft }}
              >
                <div className="text-[10px] uppercase tracking-[0.16em]" style={{ color: palette.muted }}>
                  {label}
                </div>
                <div className="mt-1.5 text-[14px] font-semibold" style={{ color: palette.heading }}>
                  {value}
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-white/8">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${label === "Simulationen" ? Math.min(100, controls.simulationCount / 20) : label === "Horizont" ? Math.min(100, controls.horizon / 7.56) : label === "Drift" ? Math.min(100, Math.abs(controls.drift) * 240) : Math.min(100, controls.volatility * 160)}%`,
                      background: `linear-gradient(90deg, ${palette.accent}, ${palette.accentStrong})`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3">
          <div className="rounded-[18px] border p-3" style={{ borderColor: palette.border, background: palette.panelBackgroundSoft }}>
            <div className="text-[10px] uppercase tracking-[0.18em]" style={{ color: palette.muted }}>
              Compact Parameters
            </div>
            <div className="mt-3 grid gap-3">
              {[
                ["Simulationen", String(controls.simulationCount)],
                ["Horizont", `${controls.horizon} Tage`],
                ["Drift", `${(controls.drift * 100).toFixed(2)}%`],
                ["Volatilitaet", `${(controls.volatility * 100).toFixed(2)}%`],
              ].map(([label, value]) => (
                <div key={label}>
                  <div className="flex items-center justify-between gap-2 text-[11px]" style={{ color: palette.muted }}>
                    <span>{label}</span>
                    <span style={{ color: palette.heading }}>{value}</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-white/8">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${label === "Simulationen" ? Math.min(100, controls.simulationCount / 20) : label === "Horizont" ? Math.min(100, controls.horizon / 7.56) : label === "Drift" ? Math.min(100, Math.abs(controls.drift) * 240) : Math.min(100, controls.volatility * 160)}%`,
                        background: `linear-gradient(90deg, ${palette.accent}, ${palette.accentStrong})`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="min-h-[180px] rounded-[18px] border p-3" style={{ borderColor: palette.border, background: palette.panelBackgroundSoft }}>
            <div className="mb-2 text-[10px] uppercase tracking-[0.18em]" style={{ color: palette.muted }}>
              Bootstrap Paths
            </div>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={bootstrapData} margin={{ top: 8, right: 4, bottom: 8, left: 4 }}>
                <CartesianGrid stroke={palette.chartGrid} vertical={false} />
                <XAxis dataKey="label" hide />
                <YAxis hide />
                <Line type="monotone" dataKey="sample1" stroke={palette.accentSoft} strokeWidth={1.4} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="sample2" stroke={palette.accent} strokeWidth={1.2} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="sample3" stroke={palette.negative} strokeWidth={1.1} dot={false} opacity={0.75} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </section>
  );
}
