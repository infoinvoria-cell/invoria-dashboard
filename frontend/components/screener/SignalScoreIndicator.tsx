"use client";

import type { ScreenerTheme } from "@/components/screener/types";

type Props = {
  value: number;
  label: string;
  theme: ScreenerTheme;
};

function fillTone(theme: ScreenerTheme, value: number): string {
  if (value >= 80) return theme === "gold" ? "#f0ddb0" : "#7cb6ff";
  if (value >= 60) return theme === "gold" ? "#d6c38f" : "#4d87fe";
  if (value >= 40) return "#94a3b8";
  return "#e05656";
}

export default function SignalScoreIndicator({ value, label, theme }: Props) {
  const safe = Math.max(0, Math.min(100, value));
  const tone = fillTone(theme, safe);

  return (
    <div className="min-w-[92px] space-y-1">
      <div className="flex items-center justify-between gap-2 text-[10px] leading-none text-slate-400">
        <span>{label}</span>
        <span className="text-slate-200">{safe.toFixed(0)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/8">
        <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${safe}%`, background: tone, boxShadow: `0 0 8px ${tone}55` }} />
      </div>
    </div>
  );
}
