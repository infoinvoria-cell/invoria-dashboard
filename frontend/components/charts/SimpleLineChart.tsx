"use client";

import { useId, useMemo } from "react";

type Point = {
  t: string;
  value: number;
};

type Props = {
  points: Point[];
  tone?: string;
  fillTone?: string;
  valueFormatter?: (value: number) => string;
  className?: string;
};

function buildPath(points: Point[], width: number, height: number, padding: number): string {
  if (points.length < 2) return "";
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1e-6, max - min);
  return points
    .map((point, index) => {
      const x = padding + ((width - padding * 2) * index) / Math.max(1, points.length - 1);
      const y = height - padding - ((point.value - min) / span) * (height - padding * 2);
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

export default function SimpleLineChart({
  points,
  tone = "#2962ff",
  fillTone = "rgba(41,98,255,0.16)",
  valueFormatter = (value) => value.toFixed(2),
  className = "",
}: Props) {
  const gradientId = useId().replace(/:/g, "");
  const view = { width: 960, height: 320, padding: 20 };

  const normalized = useMemo(
    () => points.filter((point) => Number.isFinite(point.value)),
    [points],
  );

  const path = useMemo(
    () => buildPath(normalized, view.width, view.height, view.padding),
    [normalized],
  );

  const areaPath = useMemo(() => {
    if (normalized.length < 2 || !path) return "";
    const lastX = view.width - view.padding;
    const baseline = view.height - view.padding;
    return `${path} L ${lastX} ${baseline} L ${view.padding} ${baseline} Z`;
  }, [normalized.length, path, view.height, view.padding, view.width]);

  const firstValue = normalized[0]?.value ?? 0;
  const lastValue = normalized[normalized.length - 1]?.value ?? 0;
  const delta = lastValue - firstValue;

  if (!normalized.length) {
    return (
      <div className={`grid h-full min-h-[220px] place-items-center rounded-xl border border-slate-700/50 bg-[rgba(4,9,18,0.18)] text-sm text-slate-400 ${className}`}>
        No data available
      </div>
    );
  }

  return (
    <div className={`relative h-full min-h-[220px] w-full overflow-hidden rounded-xl ${className}`}>
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between px-1 text-[11px] text-slate-400">
        <span>{normalized[0]?.t ?? ""}</span>
        <span className={delta >= 0 ? "text-emerald-300" : "text-rose-300"}>
          {delta >= 0 ? "+" : ""}
          {valueFormatter(delta)}
        </span>
        <span>{normalized[normalized.length - 1]?.t ?? ""}</span>
      </div>

      <svg viewBox={`0 0 ${view.width} ${view.height}`} className="h-full w-full">
        <defs>
          <linearGradient id={`fill-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={fillTone} />
            <stop offset="100%" stopColor="rgba(0,0,0,0)" />
          </linearGradient>
        </defs>

        <line x1={view.padding} y1={view.height - view.padding} x2={view.width - view.padding} y2={view.height - view.padding} stroke="rgba(148,163,184,0.18)" strokeWidth="1" />
        <line x1={view.padding} y1={view.padding} x2={view.padding} y2={view.height - view.padding} stroke="rgba(148,163,184,0.08)" strokeWidth="1" />

        {areaPath ? <path d={areaPath} fill={`url(#fill-${gradientId})`} /> : null}
        {path ? <path d={path} fill="none" stroke={tone} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" /> : null}
      </svg>

      <div className="pointer-events-none absolute bottom-0 right-0 rounded-lg border border-slate-700/50 bg-[rgba(6,12,22,0.62)] px-2 py-1 text-[11px] font-semibold text-slate-100">
        {valueFormatter(lastValue)}
      </div>
    </div>
  );
}
