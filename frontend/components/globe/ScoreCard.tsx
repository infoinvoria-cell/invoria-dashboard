import type { AiScoreBreakdown } from "../../types";

type Props = {
  score: number;
  breakdown?: Partial<AiScoreBreakdown>;
};

function scoreColor(score: number): string {
  if (score < 40) return "#ff384c";
  if (score < 70) return "#ffeb3b";
  return "#39ff40";
}

function labelShort(name: keyof AiScoreBreakdown): string {
  if (name === "Valuation") return "Val";
  if (name === "SupplyDemand") return "S&D";
  if (name === "Seasonality") return "Seas";
  if (name === "Momentum") return "Mom";
  return "Vol";
}

export function ScoreCard({ score, breakdown }: Props) {
  const safeScore = Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 50;
  const color = scoreColor(safeScore);
  const ring = `conic-gradient(${color} ${(safeScore / 100) * 360}deg, rgba(71, 85, 105, 0.28) 0deg)`;
  const items: Array<keyof AiScoreBreakdown> = ["Valuation", "SupplyDemand", "Seasonality", "Momentum", "Volatility"];

  return (
    <div className="flex h-full flex-col">
      <div className="text-[10px] uppercase tracking-[0.12em] text-slate-400">AI Score</div>
      <div className="flex flex-1 items-center justify-center">
        <div
          className="grid h-[108px] w-[108px] place-items-center rounded-full border border-slate-600/60 p-2"
          style={{ backgroundImage: ring }}
        >
          <div className="grid h-full w-full place-items-center rounded-full bg-slate-950/95 text-center">
            <div className="text-[28px] font-extrabold leading-none" style={{ color }}>
              {safeScore.toFixed(0)}
            </div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-slate-400">/100</div>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-5 gap-1">
        {items.map((name) => {
          const v = Number(breakdown?.[name] ?? 50);
          const barColor = scoreColor(v);
          return (
            <div key={name} className="min-w-0">
              <div className="truncate text-[9px] text-slate-400">{labelShort(name)}</div>
              <div className="h-1.5 rounded-full bg-slate-700/50">
                <div
                  className="h-1.5 rounded-full transition-all"
                  style={{ width: `${Math.max(0, Math.min(100, v))}%`, backgroundColor: barColor }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
