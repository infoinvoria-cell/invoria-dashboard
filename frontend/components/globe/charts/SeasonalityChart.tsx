"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { SeasonalityResponse } from "../../../types";

type Props = {
  payload: SeasonalityResponse | null;
  loopReplayTick?: number;
  lineColor?: string;
  rangeStartDay?: number;
  rangeEndDay?: number;
  minHold?: number;
  maxHold?: number;
  onRangeChange?: (startDay: number, endDay: number) => void;
};

type Point = {
  day: number;
  value: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function rgba(hex: string, alpha: number): string {
  const clean = String(hex || "").replace("#", "");
  const normalized = clean.length === 3
    ? clean.split("").map((char) => `${char}${char}`).join("")
    : clean.padEnd(6, "0").slice(0, 6);
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`;
}

function monthLabel(day: number): string {
  const base = new Date(Date.UTC(2024, 0, 1));
  base.setUTCDate(base.getUTCDate() + clamp(day, 1, 366) - 1);
  return base.toLocaleDateString("de-DE", { month: "short", day: "2-digit", timeZone: "UTC" });
}

export default function SeasonalityChart({
  payload,
  lineColor = "#4d87fe",
  rangeStartDay,
  rangeEndDay,
  minHold = 10,
  maxHold = 20,
  onRangeChange,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const dragAnchorRef = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);

  const points = useMemo<Point[]>(
    () =>
      (payload?.curve ?? [])
        .map((point) => ({
          day: clamp(Math.round(Number(point.x) + 1), 1, 366),
          value: Number(point.y),
        }))
        .filter((point) => Number.isFinite(point.value))
        .slice(0, 366),
    [payload?.curve],
  );

  const geometry = useMemo(() => {
    const width = 1080;
    const height = 440;
    const left = 18;
    const right = 18;
    const top = 18;
    const bottom = 20;
    const usableWidth = width - left - right;
    const usableHeight = height - top - bottom;
    const minValue = Math.min(...points.map((point) => point.value), 0);
    const maxValue = Math.max(...points.map((point) => point.value), 0);
    const spread = Math.max(maxValue - minValue, 0.0001);
    return {
      width,
      height,
      left,
      right,
      top,
      bottom,
      usableWidth,
      usableHeight,
      minValue,
      maxValue,
      spread,
    };
  }, [points]);

  const xForDay = (day: number) =>
    geometry.left + (((clamp(day, 1, 366) - 1) / 365) * geometry.usableWidth);
  const yForValue = (value: number) =>
    geometry.top + (geometry.usableHeight - (((value - geometry.minValue) / geometry.spread) * geometry.usableHeight));

  const path = useMemo(() => {
    if (points.length < 2) return "";
    return points
      .map((point, index) => `${index === 0 ? "M" : "L"}${xForDay(point.day).toFixed(2)},${yForValue(point.value).toFixed(2)}`)
      .join(" ");
  }, [points]);

  const fillPath = useMemo(() => {
    if (!path || points.length < 2) return "";
    const baseline = yForValue(0);
    const first = points[0];
    const last = points[points.length - 1];
    return `${path} L${xForDay(last.day).toFixed(2)},${baseline.toFixed(2)} L${xForDay(first.day).toFixed(2)},${baseline.toFixed(2)} Z`;
  }, [path, points]);

  const effectiveRangeStart = rangeStartDay ?? 1;
  const effectiveRangeEnd = rangeEndDay ?? Math.min(366, effectiveRangeStart + minHold);
  const selectionLeft = xForDay(Math.min(effectiveRangeStart, effectiveRangeEnd));
  const selectionRight = xForDay(Math.max(effectiveRangeStart, effectiveRangeEnd));
  const selectionWidth = Math.max(4, selectionRight - selectionLeft);

  const updateRangeFromPointer = (pointerX: number) => {
    const host = hostRef.current;
    const anchor = dragAnchorRef.current;
    if (!host || anchor == null) return;
    const rect = host.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = clamp((pointerX - rect.left) / rect.width, 0, 1);
    const targetDay = clamp(Math.round(ratio * 365) + 1, 1, 366);
    const baseStart = Math.min(anchor, targetDay);
    const baseEnd = Math.max(anchor, targetDay);
    const desiredHold = clamp(Math.max(1, baseEnd - baseStart), minHold, maxHold);
    const normalizedStart = clamp(baseStart, 1, 366 - desiredHold);
    const normalizedEnd = clamp(normalizedStart + desiredHold, normalizedStart + 1, 366);
    onRangeChange?.(normalizedStart, normalizedEnd);
  };

  useEffect(() => {
    if (!dragging) return;
    const handlePointerMove = (event: PointerEvent) => {
      updateRangeFromPointer(event.clientX);
    };
    const handlePointerUp = () => {
      dragAnchorRef.current = null;
      setDragging(false);
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [dragging, maxHold, minHold, onRangeChange]);

  if (points.length < 2) {
    return <div className="h-full w-full rounded-[18px] border border-white/10 bg-white/[0.03]" />;
  }

  return (
    <div
      ref={hostRef}
      className={`relative h-full w-full overflow-hidden rounded-[18px] ${onRangeChange ? "cursor-crosshair" : ""}`}
      onPointerDown={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
        if (!onRangeChange) return;
        const anchor = clamp(Math.round(ratio * 365) + 1, 1, 366);
        dragAnchorRef.current = anchor;
        setDragging(true);
        updateRangeFromPointer(event.clientX);
      }}
    >
      <svg viewBox={`0 0 ${geometry.width} ${geometry.height}`} className="h-full w-full">
        <defs>
          <linearGradient id="ivq-seasonality-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={rgba(lineColor, 0.22)} />
            <stop offset="100%" stopColor={rgba(lineColor, 0.03)} />
          </linearGradient>
        </defs>

        {[61, 122, 183, 244, 305].map((day) => (
          <line
            key={day}
            x1={xForDay(day)}
            x2={xForDay(day)}
            y1={geometry.top}
            y2={geometry.height - geometry.bottom}
            stroke="rgba(148, 163, 184, 0.08)"
            strokeDasharray="4 10"
          />
        ))}

        <rect
          x={selectionLeft}
          y={geometry.top}
          width={selectionWidth}
          height={geometry.usableHeight}
          fill={rgba(lineColor, 0.12)}
          stroke={rgba(lineColor, 0.32)}
          rx="12"
        />

        <line
          x1={geometry.left}
          x2={geometry.width - geometry.right}
          y1={yForValue(0)}
          y2={yForValue(0)}
          stroke="rgba(214, 226, 246, 0.24)"
          strokeDasharray="3 4"
        />

        <path d={fillPath} fill="url(#ivq-seasonality-fill)" />
        <path d={path} fill="none" stroke={lineColor} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />

        <circle cx={selectionLeft} cy={yForValue(points[Math.max(0, effectiveRangeStart - 1)]?.value ?? 0)} r="4.5" fill={lineColor} />
        <circle cx={selectionRight} cy={yForValue(points[Math.max(0, effectiveRangeEnd - 1)]?.value ?? 0)} r="4.5" fill={lineColor} />

        <g transform={`translate(${geometry.left + 4}, ${geometry.top + 12})`}>
          <rect width="208" height="48" rx="12" fill="rgba(7, 14, 26, 0.84)" stroke="rgba(148, 163, 184, 0.16)" />
          <text x="12" y="18" fill="#cbd5e1" fontSize="11" fontWeight="700" letterSpacing="1.4">
            RANGE
          </text>
          <text x="12" y="34" fill="#f8fafc" fontSize="13" fontWeight="700">
            {monthLabel(effectiveRangeStart)} - {monthLabel(effectiveRangeEnd)}
          </text>
          <text x="12" y="45" fill="#93a3b8" fontSize="10">
            Hold {Math.max(1, effectiveRangeEnd - effectiveRangeStart)} Tage
          </text>
        </g>
      </svg>
    </div>
  );
}
