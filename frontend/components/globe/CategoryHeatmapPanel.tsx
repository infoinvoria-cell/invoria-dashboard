import { useEffect, useMemo, useState } from "react";

import { GlobeApi } from "../../lib/api";
import type { CategoryHeatmapItem, CategoryHeatmapResponse } from "../../types";

type SortMode = "ai_score" | "confidence" | "momentum";

function toneColor(tone: string): string {
  const t = String(tone || "").toLowerCase();
  if (t === "strong_bullish") return "rgba(57,255,64,0.85)";
  if (t === "bullish") return "rgba(49,188,70,0.75)";
  if (t === "strong_bearish") return "rgba(255,56,76,0.86)";
  if (t === "bearish") return "rgba(176,52,72,0.72)";
  return "rgba(18,34,61,0.72)";
}

const SORTS: Array<{ id: SortMode; label: string }> = [
  { id: "ai_score", label: "AI Score" },
  { id: "confidence", label: "Confidence" },
  { id: "momentum", label: "Momentum" },
];

type Props = {
  onPickAsset?: (assetId: string) => void;
};

export function CategoryHeatmapPanel({ onPickAsset }: Props) {
  const [payload, setPayload] = useState<CategoryHeatmapResponse | null>(null);
  const [category, setCategory] = useState("FX");
  const [sortBy, setSortBy] = useState<SortMode>("ai_score");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    GlobeApi.getCategoryHeatmap(category, sortBy)
      .then((res) => {
        if (cancelled) return;
        setPayload(res);
        if (res.category && res.category !== category) setCategory(res.category);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Heatmap load failed");
        setPayload(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [category, sortBy]);

  const categories = useMemo(() => payload?.categories ?? [], [payload?.categories]);
  const items = useMemo(() => payload?.items ?? [], [payload?.items]);

  return (
    <div className="glass-panel ivq-panel flex h-full min-h-0 flex-col overflow-hidden p-[18px]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="ivq-section-label mb-0">Category Heatmap</div>
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="rounded border border-slate-700/70 px-1.5 py-[2px] text-[9px] font-semibold text-slate-300 transition hover:border-[#2962ff]/55 hover:text-[#dce8ff]"
        >
          {visible ? "Hide" : "Show"}
        </button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {categories.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setCategory(cat)}
            className={`rounded border px-1.5 py-[2px] text-[9px] font-semibold transition ${
              category === cat
                ? "border-[#2962ff]/85 bg-[#2962ff]/25 text-[#dce8ff]"
                : "border-slate-700/70 bg-[rgba(7,13,24,0.42)] text-slate-300 hover:border-[#2962ff]/55 hover:text-[#dce8ff]"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {SORTS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setSortBy(entry.id)}
            className={`rounded border px-1.5 py-[2px] text-[9px] font-semibold transition ${
              sortBy === entry.id
                ? "border-[#2962ff]/85 bg-[#2962ff]/25 text-[#dce8ff]"
                : "border-slate-700/70 bg-[rgba(7,13,24,0.42)] text-slate-300 hover:border-[#2962ff]/55 hover:text-[#dce8ff]"
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {!visible ? (
        <div className="grid h-full place-items-center text-[10px] text-slate-500">Heatmap hidden</div>
      ) : loading ? (
        <div className="grid h-full place-items-center text-[10px] text-slate-400">Loading category heatmap...</div>
      ) : error ? (
        <div className="grid h-full place-items-center text-[10px] text-red-300/90">{error}</div>
      ) : (
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto pr-1.5">
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            {items.map((item: CategoryHeatmapItem) => (
              <button
                key={item.assetId}
                type="button"
                onClick={() => onPickAsset?.(item.assetId)}
                className="min-h-[74px] rounded border border-slate-700/55 p-3 text-left transition hover:border-[#2962ff]/58"
                style={{ backgroundColor: toneColor(item.tone) }}
                title={`${item.name} | AI ${item.aiScore.toFixed(0)} | Confidence ${item.confidenceScore.toFixed(0)}%`}
              >
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <div className="truncate text-[12px] font-semibold text-slate-100">{item.name}</div>
                  <div className="text-[12px] font-semibold text-slate-100">{item.aiScore.toFixed(0)}</div>
                </div>
                <div className="mb-1.5 text-[10px] uppercase tracking-[0.08em] text-slate-300">{item.category}</div>
                <div className="flex items-center justify-between gap-2 text-[10px] text-slate-100">
                  <span>Confidence {item.confidenceScore.toFixed(0)}%</span>
                  <span>{item.signalQuality}</span>
                </div>
              </button>
            ))}
            {!items.length && <div className="text-[10px] text-slate-500">No assets in selected category.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

