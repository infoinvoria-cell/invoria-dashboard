import { useState } from "react";

import type { OpportunityItem } from "../../types";

type Props = {
  longItems: OpportunityItem[];
  shortItems: OpportunityItem[];
  onPickAsset: (assetId: string) => void;
};

function rowTone(ai: number): string {
  if (ai >= 80) return "#39ff40";
  if (ai >= 60) return "#7bff8f";
  if (ai <= 20) return "#ff384c";
  if (ai <= 40) return "#ff6a79";
  return "#9db0cf";
}

function OppItem({
  side,
  item,
  onPick,
}: {
  side: "LONG" | "SHORT";
  item: OpportunityItem;
  onPick: (assetId: string) => void;
}) {
  const tone = rowTone(Number(item.aiScore));
  return (
    <button
      type="button"
      onClick={() => onPick(item.assetId)}
      className="ivq-tile flex h-7 w-full items-center justify-between rounded bg-[rgba(18,30,55,0.65)] px-2 text-left text-[10px] text-slate-100"
      title={`${item.name} | Score ${item.aiScore.toFixed(0)} | Confidence ${item.confidenceScore.toFixed(0)}%`}
    >
      <span className="mr-1 min-w-0 flex-1 truncate">
        <span className="mr-1 text-slate-400">{side === "LONG" ? "L" : "S"}</span>
        {item.name}
      </span>
      <span className="ml-2 shrink-0" style={{ color: tone }}>
        {item.aiScore.toFixed(0)} | {item.confidenceScore.toFixed(0)}%
      </span>
    </button>
  );
}

export function OpportunityBar({ longItems, shortItems, onPickAsset }: Props) {
  const [open, setOpen] = useState(true);

  return (
    <div className="glass-panel ivq-subpanel absolute left-2 right-2 top-2 z-20 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="ivq-section-label mb-0">Top Opportunities</div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded border border-slate-700/70 px-1.5 py-[1px] text-[9px] font-semibold text-slate-300 transition hover:border-[#2962ff]/55 hover:text-[#dce8ff]"
        >
          {open ? "Hide" : "Show"}
        </button>
      </div>

      {open ? (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="mb-1.5 text-[9px] uppercase tracking-[0.08em] text-[#39ff40]">Long</div>
            <div className="space-y-1.5">
              {longItems.slice(0, 5).map((item) => (
                <OppItem key={`long-${item.assetId}`} side="LONG" item={item} onPick={onPickAsset} />
              ))}
              {!longItems.length && <div className="text-[10px] text-slate-500">No long setups</div>}
            </div>
          </div>

          <div>
            <div className="mb-1.5 text-[9px] uppercase tracking-[0.08em] text-[#ff384c]">Short</div>
            <div className="space-y-1.5">
              {shortItems.slice(0, 5).map((item) => (
                <OppItem key={`short-${item.assetId}`} side="SHORT" item={item} onPick={onPickAsset} />
              ))}
              {!shortItems.length && <div className="text-[10px] text-slate-500">No short setups</div>}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

