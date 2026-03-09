"use client";

import type { StrategySummary } from "@/components/edge-portfolio/metrics";
import type { TrackRecordTheme } from "@/components/track-record/metrics";
import { getTrackRecordThemePalette } from "@/components/track-record/theme";

type Props = {
  theme: TrackRecordTheme;
  summaries: StrategySummary[];
  selectedIds: string[];
  onToggleSelect: (id: string) => void;
  onRename: (id: string) => void;
  onDelete: (id: string) => void;
};

function formatPercent(value: number): string {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

export default function StrategyList({ theme, summaries, selectedIds, onToggleSelect, onRename, onDelete }: Props) {
  const palette = getTrackRecordThemePalette(theme);

  return (
    <section
      className="relative flex min-h-0 flex-col overflow-hidden rounded-[24px] border p-3.5 backdrop-blur-[20px]"
      style={{ background: palette.panelBackgroundStrong, borderColor: palette.panelBorder, boxShadow: palette.panelShadow }}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-[12px] font-semibold uppercase tracking-[0.2em]" style={{ color: palette.heading }}>
          Strategy List
        </div>
        <div className="text-[10px]" style={{ color: palette.muted }}>
          Multi-select portfolio manager
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
        {summaries.length === 0 ? (
          <div className="grid flex-1 place-items-center rounded-[18px] border text-center text-sm" style={{ borderColor: palette.panelBorder, color: palette.muted }}>
            No strategies stored yet.
          </div>
        ) : (
          summaries.map((strategy) => {
            const active = selectedIds.includes(strategy.id);
            return (
              <article
                key={strategy.id}
                className="rounded-[18px] border p-3"
                style={{
                  borderColor: active ? `${palette.accent}66` : palette.panelBorder,
                  background: active ? `${palette.accent}10` : "rgba(7,10,15,0.68)",
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <label className="flex min-w-0 cursor-pointer items-start gap-3">
                    <input type="checkbox" checked={active} onChange={() => onToggleSelect(strategy.id)} className="mt-1 h-4 w-4" />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold" style={{ color: palette.heading }}>
                        {strategy.name}
                      </div>
                      <div className="mt-0.5 text-[11px]" style={{ color: palette.muted }}>
                        {strategy.asset} • {strategy.tradeCount} trades
                      </div>
                    </div>
                  </label>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => onRename(strategy.id)} className="text-[10px] uppercase tracking-[0.14em]" style={{ color: palette.heading }}>
                      Rename
                    </button>
                    <button type="button" onClick={() => onDelete(strategy.id)} className="text-[10px] uppercase tracking-[0.14em]" style={{ color: palette.negative }}>
                      Delete
                    </button>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] min-[769px]:grid-cols-3">
                  <div style={{ color: palette.muted }}>Return <span style={{ color: strategy.totalReturn >= 0 ? palette.positive : palette.negative }}>{formatPercent(strategy.totalReturn)}</span></div>
                  <div style={{ color: palette.muted }}>Sharpe <span style={{ color: palette.heading }}>{strategy.sharpeRatio.toFixed(2)}</span></div>
                  <div style={{ color: palette.muted }}>DD <span style={{ color: palette.negative }}>{formatPercent(-strategy.maxDrawdown)}</span></div>
                </div>
              </article>
            );
          })
        )}
      </div>
    </section>
  );
}
