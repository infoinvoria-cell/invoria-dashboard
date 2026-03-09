const WATCHLIST_ROWS = [
  ["AUD/CAD", "AUD/CHF"],
  ["AUD/JPY", "AUD/NZD"],
  ["AUD/USD", "CAD/CHF"],
  ["CAD/JPY", "CHF/JPY"],
  ["EUR/AUD", "EUR/CAD"],
  ["EUR/CHF", "EUR/GBP"],
  ["EUR/JPY", "EUR/NZD"],
  ["EUR/USD", "GBP/AUD"],
  ["GBP/CAD", "GBP/CHF"],
  ["GBP/JPY", "GBP/NZD"],
  ["GBP/USD", "NZD/CAD"],
  ["NZD/CHF", "NZD/JPY"],
  ["NZD/USD", "USD/CAD"],
  ["USD/CHF", "USD/JPY"],
];

function LoadingCard({
  title,
  className = "",
}: {
  title: string;
  className?: string;
}) {
  return (
    <div className={`glass-panel ivq-panel min-h-0 p-[18px] ${className}`}>
      <div className="ivq-section-label">{title}</div>
      <div className="grid h-[calc(100%-24px)] place-items-center rounded-lg border border-slate-700/45 bg-[rgba(6,12,22,0.22)] text-[11px] font-medium text-slate-400">
        Loading...
      </div>
    </div>
  );
}

export default function DashboardLoadingShell() {
  return (
    <main className="ivq-app-bg relative min-h-screen overflow-x-hidden overflow-y-visible bg-transparent p-0 text-slate-100">
      <div className="ivq-page-grid relative z-10 grid min-h-screen grid-cols-[55%_45%] gap-4 px-4 pb-4 pt-0">
        <section className="ivq-layout-wrapper flex flex-col">
          <div className="grid h-[760px] grid-cols-[286px_minmax(0,1fr)] grid-rows-[minmax(0,1.62fr)_minmax(0,0.66fr)] gap-4">
            <div className="row-span-2 min-h-0">
              <div className="glass-panel flex h-full flex-col overflow-hidden rounded-xl">
                <div className="mb-2 flex items-center gap-1.5">
                  <div className="h-7 min-w-0 flex-1 rounded-md border border-slate-700/65 bg-transparent px-2 text-[11px] text-slate-500" />
                  <div className="h-7 rounded-md border border-slate-700/65 bg-transparent px-3 text-[10px] font-semibold text-slate-300">All On</div>
                  <div className="h-7 rounded-md border border-slate-700/65 bg-transparent px-3 text-[10px] font-semibold text-slate-300">All Off</div>
                </div>

                <div className="scroll-thin min-h-0 flex-1 overflow-y-auto pr-0.5">
                  <section className="mb-1.5 rounded-lg border border-slate-700/40 bg-transparent">
                    <div className="flex items-center justify-between gap-1 px-1.5 py-1">
                      <div className="flex items-center gap-1.5">
                        <div className="h-[14px] w-[24px] rounded-full border border-[#2962ff]/70 bg-[#2962ff]/25" />
                        <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-300">Cross Pairs (28)</div>
                      </div>
                      <div className="rounded border border-slate-700/60 px-1 text-[10px] text-slate-400">-</div>
                    </div>
                    <div className="grid grid-cols-2 gap-1 px-1.5 pb-1.5">
                      {WATCHLIST_ROWS.map((row) => (
                        row.map((label) => (
                          <div
                            key={label}
                            className="flex h-6 items-center gap-1 rounded-md border border-slate-700/60 bg-transparent px-1 text-[10px] text-slate-300"
                          >
                            <span className="inline-block h-[12px] w-[16px] rounded-sm bg-[rgba(41,98,255,0.22)]" />
                            <span className="truncate">{label}</span>
                          </div>
                        ))
                      ))}
                    </div>
                  </section>
                </div>

                <div className="mt-2 rounded-lg border border-slate-700/45 bg-transparent p-2">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <div className="ivq-section-label mb-0">Overlay Control</div>
                    <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-[#b2c5de]">Ready</div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex h-8 items-center justify-between rounded-md border border-[#2962ff]/72 px-2 text-[11px] font-semibold text-[#d9e4ff]">
                      <span>Assets</span>
                      <span className="text-[8px] uppercase tracking-[0.08em]">On</span>
                    </div>
                    <div className="flex h-7 items-center justify-between rounded-md border border-slate-700/60 px-2 text-[10px] font-semibold text-slate-200">
                      <span>Overlays</span>
                      <span className="text-[9px] text-slate-400">0/8</span>
                    </div>
                    <div className="flex h-7 items-center justify-between rounded-md border border-slate-700/60 px-2 text-[10px] font-semibold text-slate-200">
                      <span>Advanced</span>
                      <span className="text-[9px] text-slate-400">0/4</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <LoadingCard title="Globe" className="glass-panel--flush" />
            <LoadingCard title="World Map" className="glass-panel--flush" />
          </div>

          <div className="mt-4 h-[360px] min-h-[360px]">
            <LoadingCard title="Global News" />
          </div>

          <div className="mt-4 h-[980px] min-h-[980px]">
            <LoadingCard title="Heatmap" />
          </div>
        </section>

        <section className="ivq-layout-wrapper grid grid-rows-[766px_360px_96px_860px] gap-4">
          <div className="grid min-h-0 grid-cols-1 grid-rows-[398px_168px_168px] gap-4">
            <LoadingCard title="Asset" />
            <LoadingCard title="Valuation 10" />
            <LoadingCard title="Valuation 20" />
          </div>
          <LoadingCard title="Seasonality" />
          <LoadingCard title="KPI" />
          <LoadingCard title="Macro / Signals" />
        </section>
      </div>
    </main>
  );
}
