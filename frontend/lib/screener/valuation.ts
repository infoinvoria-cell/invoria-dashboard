import type { EvaluationResponse } from "@/types";

import type {
  PineSignalDirection,
  ValuationAgreementMode,
  ValuationSeriesPoint,
} from "@/lib/screener/types";

type SeriesPoint = { t: string; close: number };

function normalizeDateKey(value: string): string {
  return new Date(value).toISOString().slice(0, 10);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function pctChange(values: number[], length: number): Array<number | null> {
  return values.map((value, index) => {
    const base = values[index - length];
    if (index < length || !Number.isFinite(base) || Math.abs(base) < 1e-12 || !Number.isFinite(value)) {
      return null;
    }
    return ((value - base) / base) * 100;
  });
}

function rescaleToRange(values: Array<number | null>, length: number): Array<number | null> {
  return values.map((value, index) => {
    if (value == null || !Number.isFinite(value)) return null;
    const slice = values.slice(Math.max(0, index - length + 1), index + 1).filter((item): item is number => item != null && Number.isFinite(item));
    if (slice.length < 2) return null;
    const hi = Math.max(...slice);
    const lo = Math.min(...slice);
    const span = hi - lo;
    if (!Number.isFinite(span) || Math.abs(span) < 1e-12) return 0;
    return clamp(((value - lo) / span) * 200 - 100, -100, 100);
  });
}

function phaseForCounts(longHits: number, shortHits: number, agreementMode: ValuationAgreementMode, combined: number | null, top: number, bottom: number): PineSignalDirection {
  if (agreementMode === "combined") {
    if (combined != null && combined < bottom) return "LONG";
    if (combined != null && combined > top) return "SHORT";
    return "NEUTRAL";
  }
  const threshold = agreementMode === "3of4" ? 3 : agreementMode === "2of4" ? 2 : 1;
  const longOk = longHits >= threshold;
  const shortOk = shortHits >= threshold;
  if (longOk && shortOk) return "CONFLICT";
  if (longOk) return "LONG";
  if (shortOk) return "SHORT";
  return "NEUTRAL";
}

export function buildValuationSeries(
  assetSeries: SeriesPoint[],
  compare1: SeriesPoint[],
  compare2: SeriesPoint[],
  compare3: SeriesPoint[],
  length: number,
  rescaleLength: number,
  top: number,
  bottom: number,
  agreementMode: ValuationAgreementMode,
): ValuationSeriesPoint[] {
  const map1 = new Map(compare1.map((row) => [normalizeDateKey(row.t), row.close]));
  const map2 = new Map(compare2.map((row) => [normalizeDateKey(row.t), row.close]));
  const map3 = new Map(compare3.map((row) => [normalizeDateKey(row.t), row.close]));

  const aligned = assetSeries
    .map((row) => {
      const key = normalizeDateKey(row.t);
      const c1 = map1.get(key);
      const c2 = map2.get(key);
      const c3 = map3.get(key);
      if (![row.close, c1, c2, c3].every((value) => Number.isFinite(value))) return null;
      return {
        t: row.t,
        asset: row.close,
        compare1: Number(c1),
        compare2: Number(c2),
        compare3: Number(c3),
      };
    })
    .filter((row): row is { t: string; asset: number; compare1: number; compare2: number; compare3: number } => row != null);

  const assetPct = pctChange(aligned.map((row) => row.asset), length);
  const c1Pct = pctChange(aligned.map((row) => row.compare1), length);
  const c2Pct = pctChange(aligned.map((row) => row.compare2), length);
  const c3Pct = pctChange(aligned.map((row) => row.compare3), length);

  const diff1 = aligned.map((_, index) => assetPct[index] == null || c1Pct[index] == null ? null : assetPct[index]! - c1Pct[index]!);
  const diff2 = aligned.map((_, index) => assetPct[index] == null || c2Pct[index] == null ? null : assetPct[index]! - c2Pct[index]!);
  const diff3 = aligned.map((_, index) => assetPct[index] == null || c3Pct[index] == null ? null : assetPct[index]! - c3Pct[index]!);
  const r1 = rescaleToRange(diff1, rescaleLength);
  const r2 = rescaleToRange(diff2, rescaleLength);
  const r3 = rescaleToRange(diff3, rescaleLength);

  return aligned.map((row, index) => {
    const v1 = r1[index];
    const v2 = r2[index];
    const v3 = r3[index];
    const combined = [v1, v2, v3].every((value) => value != null && Number.isFinite(value))
      ? clamp(((v1 ?? 0) + (v2 ?? 0) + (v3 ?? 0)) / 3, -100, 100)
      : null;
    const values = [v1, v2, v3, combined].filter((value): value is number => value != null && Number.isFinite(value));
    const longHits = values.filter((value) => value < bottom).length;
    const shortHits = values.filter((value) => value > top).length;

    return {
      t: row.t,
      compare1: v1,
      compare2: v2,
      compare3: v3,
      combined,
      long1: longHits >= 1,
      short1: shortHits >= 1,
      long12: longHits >= 2,
      short12: shortHits >= 2,
      longval: combined != null && combined < bottom,
      shortval: combined != null && combined > top,
      phaseval: phaseForCounts(longHits, shortHits, agreementMode, combined, top, bottom),
      longHits,
      shortHits,
    };
  });
}

export function buildEvaluationPayloadFromValuation(
  assetId: string,
  compareLabel1: string,
  compareLabel2: string,
  compareLabel3: string,
  val10: ValuationSeriesPoint[],
  val20: ValuationSeriesPoint[],
): EvaluationResponse {
  const rows = val20.map((row, index) => {
    const v10Row = val10[index];
    return {
      t: row.t,
      combined10: v10Row?.combined ?? null,
      combined20: row.combined ?? null,
      c1v10: v10Row?.compare1 ?? null,
      c1v20: row.compare1 ?? null,
      c2v10: v10Row?.compare2 ?? null,
      c2v20: row.compare2 ?? null,
      c3v10: v10Row?.compare3 ?? null,
      c3v20: row.compare3 ?? null,
    };
  });

  return {
    assetId,
    updatedAt: new Date().toISOString(),
    series: [
      {
        id: "combined",
        label: "Combined",
        symbol: "COMBINED",
        color: "#2962ff",
        points: rows.map((row) => ({ t: row.t, v10: row.combined10, v20: row.combined20 })),
      },
      {
        id: "compare1",
        label: compareLabel1,
        symbol: compareLabel1,
        color: "#ffeb3b",
        points: rows.map((row) => ({ t: row.t, v10: row.c1v10, v20: row.c1v20 })),
      },
      {
        id: "compare2",
        label: compareLabel2,
        symbol: compareLabel2,
        color: "#4caf50",
        points: rows.map((row) => ({ t: row.t, v10: row.c2v10, v20: row.c2v20 })),
      },
      {
        id: "compare3",
        label: compareLabel3,
        symbol: compareLabel3,
        color: "#ff6f8d",
        points: rows.map((row) => ({ t: row.t, v10: row.c3v10, v20: row.c3v20 })),
      },
    ],
  };
}
