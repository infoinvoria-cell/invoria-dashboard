"use client";

import type { ScreenerTheme } from "@/components/screener/types";

type Props = {
  value: number;
  theme: ScreenerTheme;
};

function toneFor(theme: ScreenerTheme, value: number): string {
  if (value >= 70) return theme === "gold" ? "#d6c38f" : "#4d87fe";
  if (value >= 55) return "#cbd5e1";
  return "#e05656";
}

export default function ProbabilityIndicator({ value, theme }: Props) {
  const safe = Math.max(0, Math.min(100, value));
  const tone = toneFor(theme, safe);
  return (
    <div className="inline-flex items-center gap-1.5">
      <span className="inline-flex h-2.5 w-2.5 rounded-full" style={{ background: tone, boxShadow: `0 0 8px ${tone}66` }} />
      <span className="text-[10px] text-slate-300">{safe.toFixed(0)}%</span>
    </div>
  );
}
