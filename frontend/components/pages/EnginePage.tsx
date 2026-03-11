"use client";

import Link from "next/link";
import { ArrowRight, Blocks, Radar, SlidersHorizontal } from "lucide-react";

function cardStyle() {
  return {
    background: "linear-gradient(180deg, rgba(10,9,7,0.96), rgba(6,6,5,0.94))",
    borderColor: "rgba(201, 170, 87, 0.28)",
    boxShadow: "0 22px 54px rgba(0,0,0,0.35), 0 0 36px rgba(201,170,87,0.08)",
  } as const;
}

const modules = [
  {
    title: "Optimizer",
    href: "/optimizer",
    icon: SlidersHorizontal,
    text: "Run broad search, refinement, out-of-sample validation, and parameter stability analysis.",
  },
  {
    title: "Monte Carlo",
    href: "/monte-carlo",
    icon: Blocks,
    text: "Stress-test track records and strategy paths with robustness, drawdown, and distribution analysis.",
  },
  {
    title: "Regimes",
    href: "/regimes",
    icon: Radar,
    text: "Analyze performance across volatility, trend, and macro-style market regimes.",
  },
];

export default function EnginePage() {
  return (
    <main className="ivq-terminal-page relative min-h-screen pb-10">
      <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-6 px-4 pt-6 sm:px-6 lg:px-8">
        <section className="rounded-[30px] border p-6 sm:p-8" style={cardStyle()}>
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Engine</div>
          <h1 className="mt-3 text-3xl font-semibold tracking-[0.04em] text-white sm:text-4xl">Research Engine</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">
            Central access point for the quantitative research stack. Open the optimizer, robustness workflows, and regime analysis from one page.
          </p>
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          {modules.map((module) => {
            const Icon = module.icon;
            return (
              <Link
                key={module.title}
                href={module.href}
                className="rounded-[28px] border p-5 transition hover:translate-y-[-1px] hover:border-amber-300/40"
                style={cardStyle()}
              >
                <div className="flex items-center justify-between">
                  <div className="rounded-[16px] border border-white/10 bg-white/[0.04] p-3 text-amber-200">
                    <Icon className="h-5 w-5" />
                  </div>
                  <ArrowRight className="h-4 w-4 text-slate-500" />
                </div>
                <h2 className="mt-5 text-lg font-semibold text-white">{module.title}</h2>
                <p className="mt-3 text-sm leading-6 text-slate-400">{module.text}</p>
              </Link>
            );
          })}
        </section>
      </div>
    </main>
  );
}
