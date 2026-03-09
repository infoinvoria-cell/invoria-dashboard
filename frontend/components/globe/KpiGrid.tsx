import type { AiScoreBreakdown, TimeseriesIndicators } from "../../types";

type Props = {
  indicators?: TimeseriesIndicators | null;
  aiScore?: number;
  breakdown?: Partial<AiScoreBreakdown>;
  confidenceScore?: number;
  signalQuality?: string;
  goldThemeEnabled?: boolean;
};

function fmt(value: number | null | undefined, suffix = ""): string {
  if (value == null || Number.isNaN(value)) return "-";
  return `${value.toFixed(2)}${suffix}`;
}

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

function confidenceColor(score: number): string {
  if (score >= 80) return "#39ff40";
  if (score >= 60) return "#7bff8f";
  if (score >= 40) return "#9db0cf";
  if (score >= 20) return "#ff9800";
  return "#ff384c";
}

function signalQualityValue(label: string): number {
  const t = String(label || "").toLowerCase();
  if (t.includes("high")) return 88;
  if (t.includes("medium")) return 68;
  if (t.includes("moderate")) return 48;
  return 28;
}

export function KpiGrid({ indicators, aiScore, breakdown, confidenceScore, signalQuality, goldThemeEnabled = false }: Props) {
  const trend = String(indicators?.trend ?? "-");
  const isBull = trend.toLowerCase().startsWith("bull");
  const trendColor = isBull ? "#39ff40" : "#ff384c";
  const safeScore = Number.isFinite(aiScore) ? Math.max(0, Math.min(100, Number(aiScore))) : 50;
  const safeConfidence = Number.isFinite(confidenceScore) ? Math.max(0, Math.min(100, Number(confidenceScore))) : 0;
  const safeSignalQuality = String(signalQuality || "Low");
  const qualityValue = signalQualityValue(safeSignalQuality);
  const score = scoreColor(safeScore);
  const confColor = confidenceColor(safeConfidence);
  const qualityColor = confidenceColor(qualityValue);
  const neutralAccent = goldThemeEnabled ? "#d6b24a" : "#4d87fe";
  const breakdownItems: Array<keyof AiScoreBreakdown> = ["Valuation", "SupplyDemand", "Seasonality", "Momentum", "Volatility"];

  return (
    <div className="grid h-full grid-cols-1 gap-[10px] min-[480px]:grid-cols-2 min-[769px]:grid-cols-5">
      <div className="ivq-kpi-card flex h-full flex-col rounded-lg bg-transparent p-2">
        <div className="ivq-kpi-label text-[9px] uppercase tracking-[0.11em] text-slate-400">AI Score</div>
        <div className="ivq-kpi-value flex items-center justify-between">
          <div className="text-base font-semibold" style={{ color: score }}>
            {safeScore.toFixed(0)}
          </div>
          <div className="h-1.5 w-[62px] rounded-full bg-slate-700/50">
            <div className="h-1.5 rounded-full" style={{ width: `${safeScore}%`, backgroundColor: score }} />
          </div>
        </div>
        <div className="mt-auto grid grid-cols-5 gap-1">
          {breakdownItems.map((name) => {
            const v = Number(breakdown?.[name] ?? 50);
            return (
              <div key={name} className="min-w-0">
                <div className="mb-[2px] truncate text-[8px] text-slate-500">{labelShort(name)}</div>
                <div className="h-1 rounded-full bg-slate-700/45">
                  <div className="h-1 rounded-full" style={{ width: `${Math.max(0, Math.min(100, v))}%`, backgroundColor: scoreColor(v) }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="ivq-kpi-card flex h-full flex-col rounded-lg bg-transparent p-2">
        <div className="ivq-kpi-label text-[9px] uppercase tracking-[0.11em] text-slate-400">Trend</div>
        <div className="ivq-kpi-value flex items-center justify-between gap-2">
          <div className="text-base font-semibold" style={{ color: trend === "-" ? "#e2e8f0" : trendColor }}>
            {trend}
          </div>
          <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true">
            <path d={isBull ? "M4 13l4-4 3 3 5-6" : "M4 7l4 4 3-3 5 6"} fill="none" stroke={trendColor} strokeWidth="2" />
            <circle cx="4" cy={isBull ? "13" : "7"} r="1.2" fill={trendColor} />
          </svg>
        </div>
        <div className="mt-auto h-1.5 rounded-full bg-slate-700/45">
          <div className="h-1.5 rounded-full" style={{ width: trend === "-" ? "50%" : "100%", backgroundColor: trendColor }} />
        </div>
      </div>
      <div className="ivq-kpi-card flex h-full flex-col rounded-lg bg-transparent p-2">
        <div className="ivq-kpi-label text-[9px] uppercase tracking-[0.11em] text-slate-400">Volatility</div>
        <div className="ivq-kpi-value flex items-center justify-between gap-2">
          <div className="text-base font-semibold text-slate-100">{fmt(indicators?.volatility, "%")}</div>
          <svg width="20" height="12" viewBox="0 0 20 12" aria-hidden="true">
            <rect x="1" y="6" width="2.5" height="5" fill={neutralAccent} opacity="0.65" />
            <rect x="5" y="3" width="2.5" height="8" fill={neutralAccent} opacity="0.75" />
            <rect x="9" y="5" width="2.5" height="6" fill={neutralAccent} opacity="0.82" />
            <rect x="13" y="2" width="2.5" height="9" fill={neutralAccent} opacity="0.9" />
            <rect x="17" y="4" width="2.5" height="7" fill={neutralAccent} opacity="0.75" />
          </svg>
        </div>
        <div className="mt-auto h-1.5 rounded-full bg-slate-700/45">
          <div className="h-1.5 rounded-full" style={{ width: `${Math.max(8, Math.min(100, Number(indicators?.volatility ?? 0)))}%`, backgroundColor: neutralAccent }} />
        </div>
      </div>
      <div className="ivq-kpi-card flex h-full flex-col rounded-lg bg-transparent p-2">
        <div className="ivq-kpi-label text-[9px] uppercase tracking-[0.11em] text-slate-400">Confidence</div>
        <div className="ivq-kpi-value flex items-center justify-between gap-2">
          <div className="text-base font-semibold" style={{ color: confColor }}>
            {safeConfidence.toFixed(0)}%
          </div>
          <div className="h-1.5 w-[62px] rounded-full bg-slate-700/45">
            <div className="h-1.5 rounded-full" style={{ width: `${safeConfidence}%`, backgroundColor: confColor }} />
          </div>
        </div>
        <div className="mt-auto h-1.5 rounded-full bg-slate-700/45">
          <div className="h-1.5 rounded-full" style={{ width: `${safeConfidence}%`, backgroundColor: confColor }} />
        </div>
      </div>
      <div className="ivq-kpi-card flex h-full flex-col rounded-lg bg-transparent p-2">
        <div className="ivq-kpi-label text-[9px] uppercase tracking-[0.11em] text-slate-400">Signal Quality</div>
        <div className="ivq-kpi-value flex items-center justify-between gap-2">
          <div className="text-base font-semibold" style={{ color: qualityColor }}>
            {safeSignalQuality}
          </div>
          <div className="h-1.5 w-[62px] rounded-full bg-slate-700/45">
            <div className="h-1.5 rounded-full" style={{ width: `${qualityValue}%`, backgroundColor: qualityColor }} />
          </div>
        </div>
        <div className="mt-auto h-1.5 rounded-full bg-slate-700/45">
          <div className="h-1.5 rounded-full" style={{ width: `${qualityValue}%`, backgroundColor: qualityColor }} />
        </div>
      </div>
    </div>
  );
}

