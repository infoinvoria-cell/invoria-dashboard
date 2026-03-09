import type { AlertItem } from "../../types";

type Props = {
  items: AlertItem[];
  onPickAsset?: (assetId: string) => void;
};

function toneColor(tone: string): string {
  const t = String(tone || "").toLowerCase();
  if (t === "bull") return "#39ff40";
  if (t === "bear") return "#ff384c";
  return "#4d87fe";
}

export function AlertCenter({ items, onPickAsset }: Props) {
  return (
    <div className="glass-panel ivq-subpanel flex h-full min-h-0 flex-col p-3">
      <div className="ivq-section-label">Market Alerts</div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto pr-1.5">
        <ul className="space-y-2">
          {items.slice(0, 5).map((row, idx) => (
            <li key={`${row.assetId}-${idx}`}>
              <button
                type="button"
                onClick={() => onPickAsset?.(row.assetId)}
                className="ivq-tile flex w-full items-start gap-2 rounded bg-[rgba(18,30,55,0.65)] px-2 py-1.5 text-left text-[11px] text-slate-100"
              >
                <span className="mt-[2px] inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: toneColor(row.tone) }} />
                <span className="line-clamp-2">{row.title}</span>
              </button>
            </li>
          ))}
          {!items.length && <li className="text-[11px] text-slate-500">No active alerts</li>}
        </ul>
      </div>
    </div>
  );
}

