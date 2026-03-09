import type { OhlcvPoint } from "@/types";

export type SeasonalDirection = "LONG" | "SHORT";

export type SeasonalCandidate = {
  startDay: number;
  endDay: number;
  holdDays: number;
  direction: SeasonalDirection;
  winRate: number;
  averageReturn: number;
  samples: number;
};

export type SeasonalDayPoint = {
  day: number;
  winRate: number;
  direction: SeasonalDirection;
  holdDays: number;
  averageReturn: number;
  samples: number;
};

type DailyBar = {
  date: Date;
  year: number;
  dayOfYear: number;
  open: number;
  close: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function leapYearDate(dayOfYear: number): Date {
  const base = new Date(Date.UTC(2024, 0, 1));
  base.setUTCDate(base.getUTCDate() + dayOfYear - 1);
  return base;
}

export function dayLabel(dayOfYear: number): string {
  return leapYearDate(clamp(dayOfYear, 1, 366)).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "UTC",
  });
}

function getDayOfYear(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const current = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.floor((current - start) / 86_400_000) + 1;
}

function normalizeDailyBars(points: OhlcvPoint[]): DailyBar[] {
  return points
    .map((point) => {
      const date = new Date(point.t);
      if (Number.isNaN(date.getTime())) return null;
      return {
        date,
        year: date.getUTCFullYear(),
        dayOfYear: getDayOfYear(date),
        open: Number(point.open),
        close: Number(point.close),
      };
    })
    .filter((point): point is DailyBar => point != null && Number.isFinite(point.open) && Number.isFinite(point.close) && point.open !== 0)
    .sort((left, right) => left.date.getTime() - right.date.getTime());
}

function completedYears(bars: DailyBar[], years: number): number[] {
  if (!bars.length) return [];
  const latestYear = bars[bars.length - 1].year;
  const uniqueYears = Array.from(new Set(bars.map((bar) => bar.year).filter((year) => year < latestYear))).sort((a, b) => a - b);
  const fallbackYears = uniqueYears.length ? uniqueYears : Array.from(new Set(bars.map((bar) => bar.year))).sort((a, b) => a - b);
  return fallbackYears.slice(-Math.max(1, years));
}

function returnsForWindow(
  bars: DailyBar[],
  years: number[],
  startDay: number,
  holdDays: number,
  direction: SeasonalDirection,
): number[] {
  const out: number[] = [];
  for (const year of years) {
    const yearBars = bars.filter((bar) => bar.year === year);
    if (!yearBars.length) continue;
    const startIndex = yearBars.findIndex((bar) => bar.dayOfYear >= startDay);
    if (startIndex < 0) continue;
    const endIndex = startIndex + holdDays;
    if (endIndex >= yearBars.length) continue;
    const entry = yearBars[startIndex].open;
    const exit = yearBars[endIndex].close;
    if (!Number.isFinite(entry) || !Number.isFinite(exit) || entry === 0) continue;
    let result = (exit / entry) - 1;
    if (direction === "SHORT") result = -result;
    out.push(result * 100);
  }
  return out;
}

function candidateForStartDay(
  bars: DailyBar[],
  years: number[],
  startDay: number,
  minHold: number,
  maxHold: number,
): SeasonalCandidate | null {
  let best: SeasonalCandidate | null = null;
  for (let holdDays = minHold; holdDays <= maxHold; holdDays += 1) {
    for (const direction of ["LONG", "SHORT"] as const) {
      const returns = returnsForWindow(bars, years, startDay, holdDays, direction);
      if (!returns.length) continue;
      const winRate = (returns.filter((value) => value > 0).length / returns.length) * 100;
      const averageReturn = returns.reduce((sum, value) => sum + value, 0) / returns.length;
      const candidate: SeasonalCandidate = {
        startDay,
        endDay: clamp(startDay + holdDays, 1, 366),
        holdDays,
        direction,
        winRate,
        averageReturn,
        samples: returns.length,
      };
      if (
        best == null ||
        candidate.winRate > best.winRate ||
        (candidate.winRate === best.winRate && candidate.averageReturn > best.averageReturn)
      ) {
        best = candidate;
      }
    }
  }
  return best;
}

function candidateForExactRange(
  bars: DailyBar[],
  years: number[],
  startDay: number,
  holdDays: number,
): SeasonalCandidate | null {
  let best: SeasonalCandidate | null = null;
  for (const direction of ["LONG", "SHORT"] as const) {
    const returns = returnsForWindow(bars, years, startDay, holdDays, direction);
    if (!returns.length) continue;
    const winRate = (returns.filter((value) => value > 0).length / returns.length) * 100;
    const averageReturn = returns.reduce((sum, value) => sum + value, 0) / returns.length;
    const candidate: SeasonalCandidate = {
      startDay,
      endDay: clamp(startDay + holdDays, 1, 366),
      holdDays,
      direction,
      winRate,
      averageReturn,
      samples: returns.length,
    };
    if (
      best == null ||
      candidate.winRate > best.winRate ||
      (candidate.winRate === best.winRate && candidate.averageReturn > best.averageReturn)
    ) {
      best = candidate;
    }
  }
  return best;
}

export function buildSeasonalityWorkbench(
  points: OhlcvPoint[],
  years: number,
  minHold: number,
  maxHold: number,
  rangeStartDay: number,
  rangeEndDay: number,
): {
  dayCurve: SeasonalDayPoint[];
  currentPattern: SeasonalCandidate | null;
  nextPattern: SeasonalCandidate | null;
} {
  const bars = normalizeDailyBars(points);
  const yearlySet = completedYears(bars, years);
  const safeStart = clamp(Math.min(rangeStartDay, rangeEndDay), 1, 366);
  const safeEnd = clamp(Math.max(rangeStartDay, rangeEndDay), safeStart, 366);
  const safeMinHold = clamp(minHold, 1, 90);
  const safeMaxHold = clamp(Math.max(maxHold, safeMinHold), safeMinHold, 120);
  const selectedHold = clamp(Math.max(1, safeEnd - safeStart), safeMinHold, safeMaxHold);

  const dayCurve: SeasonalDayPoint[] = [];
  for (let day = 1; day <= 366; day += 1) {
    const best = candidateForStartDay(bars, yearlySet, day, safeMinHold, safeMaxHold);
    if (!best) continue;
    dayCurve.push({
      day,
      winRate: best.winRate,
      direction: best.direction,
      holdDays: best.holdDays,
      averageReturn: best.averageReturn,
      samples: best.samples,
    });
  }

  const currentPattern = candidateForExactRange(bars, yearlySet, safeStart, selectedHold);

  const nextPatternWindowStart = clamp(safeStart + selectedHold + 1, 1, 366);
  const nextPatternWindowEnd = clamp(nextPatternWindowStart + safeMaxHold, nextPatternWindowStart, 366);
  const nextPattern = dayCurve
    .filter((point) => point.day >= nextPatternWindowStart && point.day <= nextPatternWindowEnd)
    .sort((left, right) => right.winRate - left.winRate || right.averageReturn - left.averageReturn)[0];

  return {
    dayCurve,
    currentPattern,
    nextPattern: nextPattern
      ? {
          startDay: nextPattern.day,
          endDay: clamp(nextPattern.day + nextPattern.holdDays, 1, 366),
          holdDays: nextPattern.holdDays,
          direction: nextPattern.direction,
          winRate: nextPattern.winRate,
          averageReturn: nextPattern.averageReturn,
          samples: nextPattern.samples,
        }
      : null,
  };
}
