import type { SeasonalityResponse } from "../types";

export type SeasonDirection = "LONG" | "SHORT";

export function getSeasonDirection(payload?: SeasonalityResponse | null): SeasonDirection {
  const raw = String(payload?.stats?.direction ?? "LONG").toUpperCase();
  return raw === "SHORT" ? "SHORT" : "LONG";
}

export function seasonTone(direction: SeasonDirection): string {
  return direction === "SHORT" ? "#ff384c" : "#39ff40";
}

export function normalizedSeasonalityCurve(
  payload?: SeasonalityResponse | null,
): Array<{ x: number; y: number }> {
  const direction = getSeasonDirection(payload);
  const sign = direction === "SHORT" ? -1 : 1;
  const rows = (payload?.curve ?? [])
    .map((p) => ({ x: Number(p.x), y: Number(p.y) }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .sort((a, b) => a.x - b.x)
    .map((p) => ({ x: p.x, y: p.y * sign }));

  if (!rows.length) return [];
  if (rows[0].x !== 0) {
    rows.unshift({ x: 0, y: 0 });
  }
  return rows;
}

