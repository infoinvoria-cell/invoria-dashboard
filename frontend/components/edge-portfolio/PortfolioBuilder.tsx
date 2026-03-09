"use client";

import type { EdgeStrategyDocument } from "@/lib/edgePortfolioStore";
import type { TrackRecordTheme } from "@/components/track-record/metrics";
import { getTrackRecordThemePalette } from "@/components/track-record/theme";

type Props = {
  theme: TrackRecordTheme;
  strategies: EdgeStrategyDocument[];
  selectedIds: string[];
  weights: Record<string, number>;
  onWeightChange: (id: string, value: number) => void;
};

export default function PortfolioBuilder({ theme, strategies, selectedIds, weights, onWeightChange }: Props) {
  const palette = getTrackRecordThemePalette(theme);
  const selectedStrategies = strategies.filter((strategy) => selectedIds.includes(strategy.id));

  return (
    <section
      className="relative overflow-hidden rounded-[24px] border p-3.5 backdrop-blur-[20px] min-[769px]:p-4"
      style={{ background: palette.panelBackgroundStrong, borderColor: palette.panelBorder, boxShadow: palette.panelShadow }}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-[12px] font-semibold uppercase tracking-[0.2em]" style={{ color: palette.heading }}>
          Portfolio Builder
        </div>
        <div className="text-[10px]" style={{ color: palette.muted }}>
          Default = equal weight
        </div>
      </div>

      <div className="space-y-3">
        {selectedStrategies.length === 0 ? (
          <div className="rounded-[18px] border px-3 py-4 text-sm" style={{ borderColor: palette.panelBorder, color: palette.muted }}>
            Select one or more strategies to build the portfolio.
          </div>
        ) : (
          selectedStrategies.map((strategy) => (
            <div key={strategy.id} className="rounded-[18px] border p-3" style={{ borderColor: palette.panelBorder, background: "rgba(7,10,15,0.68)" }}>
              <div className="mb-2 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold" style={{ color: palette.heading }}>
                    {strategy.name}
                  </div>
                  <div className="text-[10px]" style={{ color: palette.muted }}>
                    {strategy.asset}
                  </div>
                </div>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={Math.round((weights[strategy.id] ?? 0) * 100)}
                  onChange={(event) => onWeightChange(strategy.id, Number(event.target.value) / 100)}
                  className="h-9 w-[72px] rounded-[12px] border px-2 text-right text-sm outline-none"
                  style={{ borderColor: palette.panelBorder, background: "rgba(7,10,15,0.78)", color: palette.text }}
                />
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round((weights[strategy.id] ?? 0) * 100)}
                onChange={(event) => onWeightChange(strategy.id, Number(event.target.value) / 100)}
                className="w-full accent-current"
                style={{ color: palette.accent }}
              />
            </div>
          ))
        )}
      </div>
    </section>
  );
}
