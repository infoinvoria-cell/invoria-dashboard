"use client";

import {
  Activity,
  Database,
  FileUp,
  Gauge,
  Layers3,
  Radar,
  Save,
  Table2,
} from "lucide-react";

const SECTIONS = [
  {
    title: "Input Source Selection",
    description: "Load uploaded track records, stored strategies, optimizer outputs, or combined portfolios into one regime workspace.",
    icon: FileUp,
    bullets: ["Uploaded Track Record", "Stored Strategy", "Optimizer Strategy", "Portfolio Input", "Multi-strategy Comparison"],
  },
  {
    title: "Regime Configuration",
    description: "Define volatility, trend, stress, and macro regimes with configurable thresholds, lookbacks, and sensitivity settings.",
    icon: Layers3,
    bullets: ["Volatility Regime", "Trend Regime", "Liquidity / Stress", "Macro / Risk"],
  },
  {
    title: "Analysis Controls",
    description: "Run regime analysis across the selected period with clear progress tracking, benchmark selection, and source visibility.",
    icon: Activity,
    bullets: ["Source selection", "Analysis window", "Benchmark selector", "Run analysis"],
  },
  {
    title: "Current Regime Summary",
    description: "Summarize the live market environment with an ampel-style decision layer and quick strategy-fit interpretation.",
    icon: Gauge,
    bullets: ["Volatility state", "Trend state", "Macro state", "Strategy fit"],
  },
  {
    title: "Regime Performance Results",
    description: "Compare Sharpe, CAGR, drawdown, win rate, trade count, and stability across single and combined regimes.",
    icon: Table2,
    bullets: ["Regime result table", "Trend x Volatility matrix", "Stability badges", "Best strategy by regime"],
  },
  {
    title: "Heatmaps and 3D Visuals",
    description: "Inspect regime performance through readable heatmaps, timeline overlays, equity segmentation, and interactive surfaces.",
    icon: Radar,
    bullets: ["Regime heatmap", "Performance heatmap", "3D regime surface", "Regime timeline"],
  },
  {
    title: "Saved Analyses / History",
    description: "Store completed regime analyses, reload prior runs, and compare different regime models over time.",
    icon: Save,
    bullets: ["Temporary cache", "Permanent saves", "History table", "Compare / delete"],
  },
];

function cardStyle() {
  return {
    background: "linear-gradient(180deg, rgba(10,9,7,0.96), rgba(6,6,5,0.94))",
    borderColor: "rgba(201, 170, 87, 0.28)",
    boxShadow: "0 22px 54px rgba(0,0,0,0.35), 0 0 36px rgba(201,170,87,0.08)",
  } as const;
}

export default function RegimesPage() {
  return (
    <main className="ivq-terminal-page relative min-h-screen pb-10">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-4 pt-6 sm:px-6 lg:px-8">
        <section className="rounded-[30px] border p-6 sm:p-8" style={cardStyle()}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-4xl">
              <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Research Module</div>
              <h1 className="mt-3 text-3xl font-semibold tracking-[0.04em] text-white sm:text-4xl">Regimes</h1>
              <p className="mt-3 text-base text-slate-300">
                Analyze strategies, portfolios, and track records across market regimes.
              </p>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">
                This page helps identify where a strategy works, where it fails, and which market conditions currently dominate.
              </p>
            </div>
            <div className="grid min-w-[280px] gap-3 rounded-[24px] border border-amber-200/15 bg-white/[0.03] p-4">
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">Status</div>
              <div className="rounded-[18px] border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">
                Route active. Sidebar navigation now links to <span className="font-semibold">/regimes</span>.
              </div>
              <div className="rounded-[18px] border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-300">
                The full analysis engine is the next build step. This screen is the clickable entry point and page shell.
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-[28px] border p-5" style={cardStyle()}>
            <div className="mb-4 flex items-center gap-3">
              <Database className="h-5 w-5 text-amber-200" />
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Implementation Scope</div>
                <div className="mt-1 text-sm text-slate-300">The Regimes page follows the Optimizer page structure and will be built in vertical research blocks.</div>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                "Clear top-to-bottom workflow",
                "High-contrast institutional research UI",
                "Optimizer integration and strategy import",
                "Saved analyses and reloadable history",
              ].map((item) => (
                <div key={item} className="rounded-[18px] border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-200">
                  {item}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[28px] border p-5" style={cardStyle()}>
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Planned Outputs</div>
            <div className="mt-4 grid gap-3">
              {[
                "Current regime traffic-light summary",
                "Regime-specific performance tables",
                "Heatmaps, timeline overlays, and 3D surfaces",
                "Best strategy for current regime decision support",
              ].map((item) => (
                <div key={item} className="rounded-[18px] border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-300">
                  {item}
                </div>
              ))}
            </div>
          </div>
        </section>

        <div className="grid gap-4">
          {SECTIONS.map((section) => {
            const Icon = section.icon;
            return (
              <section key={section.title} className="rounded-[28px] border p-5" style={cardStyle()}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="max-w-3xl">
                    <div className="flex items-center gap-3">
                      <div className="rounded-[16px] border border-white/10 bg-white/[0.04] p-3 text-amber-200">
                        <Icon className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Section</div>
                        <h2 className="mt-1 text-lg font-semibold text-white">{section.title}</h2>
                      </div>
                    </div>
                    <p className="mt-4 text-sm leading-6 text-slate-400">{section.description}</p>
                  </div>
                  <div className="min-w-[260px] rounded-[22px] border border-white/10 bg-black/20 p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Planned Controls</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {section.bullets.map((item) => (
                        <span key={item} className="rounded-full border border-amber-200/20 bg-amber-200/10 px-3 py-1 text-xs font-medium text-amber-100">
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </main>
  );
}
