"use client";

import Link from "next/link";
import { ArrowRight, Globe2, LayoutGrid, Search } from "lucide-react";

function cardStyle() {
  return {
    background: "linear-gradient(180deg, rgba(10,9,7,0.96), rgba(6,6,5,0.94))",
    borderColor: "rgba(201, 170, 87, 0.28)",
    boxShadow: "0 22px 54px rgba(0,0,0,0.35), 0 0 36px rgba(201,170,87,0.08)",
  } as const;
}

export default function HeatmapPage() {
  return (
    <main className="ivq-terminal-page relative min-h-screen pb-10">
      <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-6 px-4 pt-6 sm:px-6 lg:px-8">
        <section className="rounded-[30px] border p-6 sm:p-8" style={cardStyle()}>
          <div className="flex items-center gap-3">
            <LayoutGrid className="h-5 w-5 text-amber-200" />
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Market Analysis</div>
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-[0.04em] text-white sm:text-4xl">Heatmap</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">
            Quick access page for market heatmap workflows. Use it as the dedicated navigation target and jump directly into the live heatmap views.
          </p>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <Link href="/screener" className="rounded-[28px] border p-5 transition hover:border-amber-300/40" style={cardStyle()}>
            <div className="flex items-center justify-between">
              <Search className="h-5 w-5 text-amber-200" />
              <ArrowRight className="h-4 w-4 text-slate-500" />
            </div>
            <h2 className="mt-5 text-lg font-semibold text-white">Screener Heatmap</h2>
            <p className="mt-3 text-sm leading-6 text-slate-400">
              Open the screener to inspect asset groups, valuation distribution, and live table-based heatmap workflows.
            </p>
          </Link>

          <Link href="/dashboard" className="rounded-[28px] border p-5 transition hover:border-amber-300/40" style={cardStyle()}>
            <div className="flex items-center justify-between">
              <Globe2 className="h-5 w-5 text-amber-200" />
              <ArrowRight className="h-4 w-4 text-slate-500" />
            </div>
            <h2 className="mt-5 text-lg font-semibold text-white">Globe Heatmap Context</h2>
            <p className="mt-3 text-sm leading-6 text-slate-400">
              Open the globe dashboard to combine asset heatmaps with overlays, events, and news context in one view.
            </p>
          </Link>
        </section>
      </div>
    </main>
  );
}
