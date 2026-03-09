import { useMemo } from "react";

import type { AssetSignalDetailResponse } from "../../types";

type RecentSignal = {
  direction: "bullish" | "bearish";
  lines: string[];
  ageBars: number;
} | null;

type Props = {
  payload: AssetSignalDetailResponse | null;
  fallbackWhy?: Array<{ label: string; value: string }>;
  recentSignal?: RecentSignal;
  goldThemeEnabled?: boolean;
};

type DriverTone = "bull" | "bear" | "neutral";

function clamp100(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Number(v)));
}

function corrColor(v: number): string {
  if (v >= 0) return "#39ff40";
  return "#ff384c";
}

function scoreColor(v: number, neutralColor = "#4d87fe"): string {
  const x = clamp100(v);
  if (x >= 80) return "#39ff40";
  if (x >= 60) return "#7dff87";
  if (x >= 40) return neutralColor;
  if (x >= 20) return "#ff9800";
  return "#ff384c";
}

function qualityColor(label: string, neutralColor = "#4d87fe"): string {
  const q = String(label || "").toLowerCase();
  if (q.includes("high")) return "#39ff40";
  if (q.includes("medium")) return neutralColor;
  if (q.includes("low")) return "#ff9800";
  return "#9aa3b2";
}

function fallbackRows(rows?: Array<{ label: string; value: string }>, fallback?: Array<{ label: string; value: string }>): Array<{ label: string; value: string }> {
  const primary = (rows ?? [])
    .filter((row) => String(row?.label || "").trim() && String(row?.value || "").trim())
    .slice(0, 5);
  if (primary.length >= 5) return primary;

  const backup = (fallback ?? [
    { label: "Valuation", value: "Data Pending" },
    { label: "Seasonality Bias", value: "Neutral" },
    { label: "Momentum", value: "Neutral" },
    { label: "Supply/Demand Distance", value: "Updating..." },
    { label: "Volatility Regime", value: "Normal" },
  ])
    .filter((row) => String(row?.label || "").trim() && String(row?.value || "").trim());

  const merged = [...primary];
  for (const row of backup) {
    if (merged.some((existing) => existing.label === row.label)) continue;
    merged.push(row);
    if (merged.length >= 5) break;
  }
  return merged;
}

function textTone(value: string): DriverTone {
  const t = String(value || "").toLowerCase();
  if (
    t.includes("bull") ||
    t.includes("positive") ||
    t.includes("underval") ||
    t.includes("near demand") ||
    t.includes("compressed") ||
    t.includes("low")
  ) {
    return "bull";
  }
  if (
    t.includes("bear") ||
    t.includes("negative") ||
    t.includes("overval") ||
    t.includes("near supply") ||
    t.includes("elevated") ||
    t.includes("stress")
  ) {
    return "bear";
  }
  return "neutral";
}

function alignedDriverScore(value: string, signalDirection: "bullish" | "bearish"): number {
  const tone = textTone(value);
  if (tone === "neutral") return 50;
  const aligned = (tone === "bull" && signalDirection === "bullish") || (tone === "bear" && signalDirection === "bearish");
  return aligned ? 84 : 22;
}

function RingGauge({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  const pct = clamp100(value);
  const ringBg = `conic-gradient(${color} ${pct}%, rgba(83,104,140,0.28) 0)`;
  return (
    <div className="rounded-md bg-[rgba(10,20,38,0.58)] p-1.5">
      <div className="mb-1 truncate text-[9px] uppercase tracking-[0.08em] text-slate-400">{label}</div>
      <div className="flex items-center gap-2">
        <div
          className="grid h-10 w-10 place-items-center rounded-full border border-slate-700/70"
          style={{ background: ringBg }}
        >
          <span className="grid h-7 w-7 place-items-center rounded-full bg-[#081222] text-[9px] font-semibold text-slate-100">
            {pct.toFixed(0)}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="h-1.5 rounded-full bg-slate-700/35">
            <div className="h-1.5 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
          </div>
          <div className="mt-1 text-[9px] text-slate-400">Score</div>
        </div>
      </div>
    </div>
  );
}

export function SignalDetailPanel({ payload, fallbackWhy: fallback, recentSignal = null, goldThemeEnabled = false }: Props) {
  const why = fallbackRows(payload?.whySignal, fallback);
  const pos = payload?.miniCorrelation?.positive ?? [];
  const neg = payload?.miniCorrelation?.negative ?? [];

  const neutralAccent = goldThemeEnabled ? "#d6b24a" : "#4d87fe";
  const signalDirection: "bullish" | "bearish" = recentSignal?.direction ?? (Number(payload?.aiScore ?? 50) >= 50 ? "bullish" : "bearish");
  const directionColor = signalDirection === "bullish" ? "#39ff40" : "#ff384c";
  const signalType = signalDirection === "bullish" ? "Bullish Setup" : "Bearish Setup";

  const lookbackBars = Math.max(8, Math.min(14, Number(recentSignal?.ageBars ?? 0) + 6));
  const triggerFromRight = Math.max(0, Math.min(lookbackBars - 1, Number(recentSignal?.ageBars ?? 0)));
  const triggerIndex = lookbackBars - 1 - triggerFromRight;
  const winStart = Math.max(0, triggerIndex - 2);
  const winEnd = triggerIndex;
  const lookbackHeights = useMemo(
    () =>
      Array.from({ length: lookbackBars }, (_, i) => {
        const d = Math.abs(i - triggerIndex);
        return Math.max(4, 16 - d * 2);
      }),
    [lookbackBars, triggerIndex],
  );

  const attractiveRows = useMemo(
    () =>
      why.slice(0, 5).map((row) => {
        const score = alignedDriverScore(row.value, signalDirection);
        return {
          ...row,
          score,
          color: scoreColor(score, neutralAccent),
        };
      }),
    [neutralAccent, signalDirection, why],
  );

  return (
    <div className="glass-panel ivq-subpanel flex min-h-0 flex-col p-3.5">
      <div className="ivq-section-label">Why This Signal</div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-2.5 min-[769px]:grid-cols-[1.4fr_1fr]">
        <div className="flex min-h-0 flex-col gap-2">
          <div className="grid grid-cols-1 gap-2 min-[480px]:grid-cols-[1fr_94px]">
            <div className="rounded-md bg-[rgba(8,18,34,0.56)] p-2">
              <div className="mb-1 text-[9px] uppercase tracking-[0.08em] text-slate-400">Signal Type</div>
              <div className="flex items-center justify-between gap-2">
                <div className="text-[12px] font-semibold" style={{ color: directionColor }}>
                  {signalType}
                </div>
                <div
                  className="rounded px-1.5 py-0.5 text-[9px] font-semibold"
                  style={{ color: qualityColor(String(payload?.signalQuality || "Low"), neutralAccent), backgroundColor: "rgba(12,24,44,0.8)" }}
                >
                  {String(payload?.signalQuality || "Low")}
                </div>
              </div>
              <div className="mt-1 text-[9px] text-slate-400">
                Lookback Window: <span className="text-slate-200">3 bars</span> | Trigger:{" "}
                <span className="text-slate-200">{Math.max(0, Number(recentSignal?.ageBars ?? 0))} bars ago</span>
              </div>
            </div>
            <RingGauge
              label="Confidence"
              value={Number(payload?.confidenceScore ?? 0)}
              color={scoreColor(Number(payload?.confidenceScore ?? 0), neutralAccent)}
            />
          </div>

          <div className="grid grid-cols-2 gap-1.5 min-[769px]:grid-cols-4">
            <RingGauge label="Strength" value={Number(payload?.components?.signalStrength ?? 0)} color={neutralAccent} />
            <RingGauge label="Data" value={Number(payload?.components?.dataQuality ?? 0)} color="#39ff40" />
            <RingGauge label="Regime" value={Number(payload?.components?.regimeAlignment ?? 0)} color="#ff9800" />
            <RingGauge label="Corr" value={Number(payload?.components?.correlationSupport ?? 0)} color={neutralAccent} />
          </div>

          <div className="rounded-md bg-[rgba(8,18,34,0.56)] p-2">
            <div className="mb-1 text-[9px] uppercase tracking-[0.08em] text-slate-400">Signal Lookback Graph</div>
            <div className="relative flex h-8 items-end gap-1">
              {lookbackHeights.map((h, idx) => {
                const inWindow = idx >= winStart && idx <= winEnd;
                const isTrigger = idx === triggerIndex;
                return (
                  <div
                    key={`lb-${idx}`}
                    className="min-w-0 flex-1 rounded-sm"
                    style={{
                      height: `${h}px`,
                      background: isTrigger
                        ? directionColor
                        : inWindow
                          ? `${directionColor}99`
                          : "rgba(78,106,154,0.35)",
                      boxShadow: isTrigger ? `0 0 10px ${directionColor}66` : "none",
                    }}
                  />
                );
              })}
            </div>
            {recentSignal?.lines?.length ? (
              <div className="mt-1.5 text-[9px] text-slate-200">
                {recentSignal.lines.slice(0, 2).map((line, idx) => (
                  <span key={`${line}-${idx}`} className="mr-2">
                    • {line}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex min-h-0 flex-col gap-2">
          <div className="rounded-md bg-[rgba(8,18,34,0.56)] p-2">
            <div className="mb-1 text-[9px] uppercase tracking-[0.08em] text-slate-400">What Is Attractive Now</div>
            <div className="space-y-1.5">
              {attractiveRows.map((row) => (
                <div key={row.label}>
                  <div className="mb-0.5 flex items-center justify-between text-[9px]">
                    <span className="truncate text-slate-300">{row.label}</span>
                    <span style={{ color: row.color }}>{row.score.toFixed(0)}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-700/35">
                    <div className="h-1.5 rounded-full" style={{ width: `${clamp100(row.score)}%`, backgroundColor: row.color }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="min-h-0 rounded-md bg-[rgba(8,18,34,0.56)] p-2">
            <div className="mb-1 text-[9px] uppercase tracking-[0.08em] text-slate-400">Mini Correlation Lens</div>
            <div className="grid min-h-0 grid-cols-1 gap-2 min-[480px]:grid-cols-2">
              <div>
                <div className="mb-1 text-[9px] uppercase tracking-[0.08em] text-[#39ff40]">Top +</div>
                <div className="space-y-0.5">
                  {pos.slice(0, 3).map((row) => (
                    <div key={`p-${row.assetId}`} className="flex items-center justify-between text-[9px]">
                      <span className="truncate text-slate-200">{row.symbol || row.name}</span>
                      <span style={{ color: corrColor(row.value) }}>{row.value.toFixed(0)}</span>
                    </div>
                  ))}
                  {!pos.length && <div className="text-[9px] text-slate-500">No + corr</div>}
                </div>
              </div>
              <div>
                <div className="mb-1 text-[9px] uppercase tracking-[0.08em] text-[#ff384c]">Top -</div>
                <div className="space-y-0.5">
                  {neg.slice(0, 3).map((row) => (
                    <div key={`n-${row.assetId}`} className="flex items-center justify-between text-[9px]">
                      <span className="truncate text-slate-200">{row.symbol || row.name}</span>
                      <span style={{ color: corrColor(row.value) }}>{row.value.toFixed(0)}</span>
                    </div>
                  ))}
                  {!neg.length && <div className="text-[9px] text-slate-500">No - corr</div>}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


