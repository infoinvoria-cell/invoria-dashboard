import type {
  PineScreenerRow,
  ScreenerSortDirection,
  ScreenerSortKey,
} from "@/lib/screener/types";

function signalRank(signal: PineScreenerRow["signal"]): number {
  if (signal === "long") return 4;
  if (signal === "short") return 3;
  if (signal === "recent-long") return 2;
  if (signal === "recent-short") return 1;
  return 0;
}

function entryRank(state: PineScreenerRow["entryState"]): number {
  if (state === "ACTIVE") return 2;
  if (state === "RECENT") return 1;
  return 0;
}

function directionRank(direction: PineScreenerRow["signalDirection"]): number {
  if (direction === "LONG") return 2;
  if (direction === "SHORT") return 1;
  return 0;
}

function ageRank(row: PineScreenerRow): number {
  return Number.isFinite(row.ageBars) ? Number(row.ageBars) : 9999;
}

export function sortScreenerRows(
  rows: PineScreenerRow[],
  sortKey: ScreenerSortKey,
  sortDirection: ScreenerSortDirection,
): PineScreenerRow[] {
  const factor = sortDirection === "asc" ? 1 : -1;
  const collator = new Intl.Collator("de-DE", { sensitivity: "base" });

  return [...rows].sort((left, right) => {
    if (sortKey === "default") {
      const entryDelta = entryRank(right.entryState) - entryRank(left.entryState);
      if (entryDelta !== 0) return entryDelta;
      const priorityDelta = right.priority - left.priority;
      if (priorityDelta !== 0) return priorityDelta;
      const signalDelta = signalRank(right.signal) - signalRank(left.signal);
      if (signalDelta !== 0) return signalDelta;
      return collator.compare(left.name, right.name);
    }

    const leftValue =
      sortKey === "asset" ? left.name
        : sortKey === "entry" ? (entryRank(left.entryState) * 1000) - ageRank(left)
          : sortKey === "priority" ? left.priority
            : sortKey === "signal" ? directionRank(left.signalDirection)
              : sortKey === "seasonalHitRate" ? left.currentPatternHitRate
                : sortKey === "val10" ? left.val10Combined
                  : sortKey === "val20" ? left.val20Combined
                    : ageRank(left);
    const rightValue =
      sortKey === "asset" ? right.name
        : sortKey === "entry" ? (entryRank(right.entryState) * 1000) - ageRank(right)
          : sortKey === "priority" ? right.priority
            : sortKey === "signal" ? directionRank(right.signalDirection)
              : sortKey === "seasonalHitRate" ? right.currentPatternHitRate
                : sortKey === "val10" ? right.val10Combined
                  : sortKey === "val20" ? right.val20Combined
                    : ageRank(right);

    if (typeof leftValue === "string" && typeof rightValue === "string") {
      return collator.compare(leftValue, rightValue) * factor;
    }
    return ((Number(leftValue) || 0) - (Number(rightValue) || 0)) * factor;
  });
}
