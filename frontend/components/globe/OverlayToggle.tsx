import type { OverlayMode } from "../../types";

type Props = {
  mode: OverlayMode;
  onChange: (next: OverlayMode) => void;
};

const OPTIONS: Array<{ id: OverlayMode; label: string }> = [
  { id: "none", label: "None" },
  { id: "inflation", label: "Inflation" },
  { id: "policy_rate", label: "Policy Rate Map" },
  { id: "volatility", label: "Volatility Regime" },
  { id: "commodity_shock", label: "Commodity Shock" },
];

export function OverlayToggle({ mode, onChange }: Props) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto whitespace-nowrap pr-1 text-xs text-slate-200">
      <span className="mr-1 text-[11px] uppercase tracking-[0.12em] text-slate-400">Macro Overlay</span>
      {OPTIONS.map((option) => {
        const active = mode === option.id;
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            className={`rounded-full border px-2 py-1 text-[11px] transition ${
              active
                ? "border-[#2962ff]/70 bg-[#2962ff]/18 text-[#d9e4ff]"
                : "border-slate-600/45 bg-slate-900/45 text-slate-300 hover:border-[#2962ff]/45 hover:text-[#d9e4ff]"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
