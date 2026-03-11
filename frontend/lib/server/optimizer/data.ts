import { promises as fs } from "node:fs";
import path from "node:path";

import type {
  OptimizerAssetId,
  OptimizerCandleIntegrityReport,
  OptimizerConfig,
  OptimizerMarketCoverage,
} from "@/lib/optimizer/types";
import { filterValidOhlcvSeries } from "@/lib/candleIntegrity";
import { OPTIMIZER_FX_UNIVERSE } from "@/lib/server/optimizer/config";
import { ensureForexCache, readForexCache } from "@/lib/server/optimizer/forexCache";
import type { OhlcvPoint, TimeseriesResponse } from "@/types";

const TARGET_START_DAY = "2012-01-01";

type LoadOptimizerDataOptions = {
  onProgress?: (completed: number, total: number, message: string) => void;
};

export type OptimizerDailyBar = {
  t: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type OptimizerAssetDataset = {
  assetId: OptimizerAssetId;
  symbol: string;
  barsH1: OhlcvPoint[];
  barsD1: OptimizerDailyBar[];
  sourceRequested: string;
  sourceUsed: string;
  fallbackUsed: boolean;
};

export type OptimizerReferenceSeries = {
  symbol: string;
  closesByDate: Map<string, number>;
  sourceUsed: string;
  start: string | null;
  end: string | null;
};

export type OptimizerLoadedData = {
  assets: OptimizerAssetDataset[];
  references: {
    dxy: OptimizerReferenceSeries;
    gold: OptimizerReferenceSeries;
    us10y: OptimizerReferenceSeries;
  };
  coverage: OptimizerMarketCoverage[];
  integrity: OptimizerCandleIntegrityReport[];
  warnings: string[];
};

type ReferenceFallbackSpec = {
  symbol: "DXY" | "GC1!" | "^TNX";
  fredSeries: string;
  label: string;
};

type ReferenceSymbol = "DXY" | "GC1!" | "^TNX";

const REFERENCE_FALLBACKS: ReferenceFallbackSpec[] = [
  { symbol: "DXY", fredSeries: "DTWEXBGS", label: "FRED broad dollar index" },
  { symbol: "GC1!", fredSeries: "GOLDAMGBD228NLBM", label: "FRED gold LBMA" },
  { symbol: "^TNX", fredSeries: "DGS10", label: "FRED 10Y treasury yield" },
];
const REFERENCE_PROVIDER_SYMBOLS: Record<ReferenceSymbol, Record<string, string[]>> = {
  DXY: {
    dukascopy: ["DXY", "USDIDX"],
    tradingview: ["DXY", "TVC:DXY"],
  },
  "GC1!": {
    dukascopy: ["XAUUSD", "GOLD"],
    tradingview: ["GC1!", "COMEX:GC1!", "OANDA:XAUUSD"],
  },
  "^TNX": {
    dukascopy: ["US10Y", "UST10Y"],
    tradingview: ["US10Y", "TVC:US10Y", "TVC:TNX"],
  },
};

function isoDay(value: string): string {
  return new Date(value).toISOString().slice(0, 10);
}

function snapshotRoots(): string[] {
  const cwd = process.cwd();
  return Array.from(new Set([
    path.join(cwd, "data", "optimizer-snapshots"),
    path.join(cwd, "frontend", "data", "optimizer-snapshots"),
  ]));
}

function normalizeSnapshotKey(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9!_-]/g, "");
}

async function readOptimizerSnapshot(scope: "references", provider: string, key: string): Promise<TimeseriesResponse | null> {
  const safeProvider = normalizeSnapshotKey(provider);
  const safeKey = normalizeSnapshotKey(key);
  for (const root of snapshotRoots()) {
    const filePath = path.join(root, scope, safeProvider, `${safeKey}.json`);
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as TimeseriesResponse | null;
      if (parsed?.ohlcv?.length) return parsed;
    } catch {
      // keep searching
    }
  }
  return null;
}

function sanitizeBars(points: OhlcvPoint[]): OhlcvPoint[] {
  return filterValidOhlcvSeries(points).map((row) => ({
    ...row,
    volume: row.volume ?? null,
  }));
}

function aggregateH1ToD1(points: OhlcvPoint[]): OptimizerDailyBar[] {
  const buckets = new Map<string, OhlcvPoint[]>();
  for (const row of sanitizeBars(points)) {
    const day = isoDay(row.t);
    const bucket = buckets.get(day) ?? [];
    bucket.push(row);
    buckets.set(day, bucket);
  }

  return Array.from(buckets.entries())
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([day, rows]) => ({
      t: `${day}T00:00:00Z`,
      open: Number(rows[0].open),
      high: Math.max(...rows.map((row) => Number(row.high))),
      low: Math.min(...rows.map((row) => Number(row.low))),
      close: Number(rows[rows.length - 1].close),
    }));
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for ${url}`);
  }
  return response.json() as Promise<T>;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { accept: "text/plain,text/csv,*/*" },
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for ${url}`);
  }
  return response.text();
}

async function loadAssetTimeseries(assetId: OptimizerAssetId, symbol: string): Promise<TimeseriesResponse> {
  const cache = await readForexCache(symbol);
  if (!cache?.bars?.length) {
    throw new Error(`Local Dukascopy cache missing for ${symbol}.`);
  }
  return {
    assetId,
    symbol,
    updatedAt: cache.updatedAt,
    source: "dukascopy",
    sourceRequested: "dukascopy",
    sourceUsed: "local-dukascopy-cache",
    fallbackUsed: false,
    diagnostics: {
      timeframe: "1H",
      bars: cache.bars.length,
      start: cache.bars[0]?.t ?? null,
      end: cache.bars[cache.bars.length - 1]?.t ?? null,
    },
    ohlcv: cache.bars,
    supplyDemand: { demand: [], supply: [] },
    indicators: {
      distanceToDemand: null,
      distanceToSupply: null,
      rsi: 0,
      atrPct: 0,
      volatility: 0,
      trend: "flat",
    },
    aiScore: {
      total: 0,
      breakdown: {},
    },
  };
}

async function loadReferenceFromFred(spec: ReferenceFallbackSpec): Promise<OptimizerReferenceSeries> {
  const csv = await fetchText(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(spec.fredSeries)}`);
  const closesByDate = new Map<string, number>();
  for (const line of csv.split(/\r?\n/).slice(1)) {
    const [date, raw] = line.split(",");
    if (!date || !raw || raw === ".") continue;
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    closesByDate.set(date.trim(), value);
  }
  const dates = Array.from(closesByDate.keys()).sort();
  return {
    symbol: spec.symbol,
    closesByDate,
    sourceUsed: `fred:${spec.fredSeries}`,
    start: dates[0] ?? null,
    end: dates[dates.length - 1] ?? null,
  };
}

async function loadReferenceCandidate(origin: string, symbol: string, source: string): Promise<OptimizerReferenceSeries> {
  const snapshot = await readOptimizerSnapshot("references", source, symbol);
  if (snapshot) return toReferenceSeries(symbol, snapshot, `${source}-snapshot`);

  const url = `${origin}/api/reference/timeseries?symbol=${encodeURIComponent(symbol)}&tf=D&source=${encodeURIComponent(source)}`;
  const payload = await fetchJson<TimeseriesResponse>(url);
  return toReferenceSeries(symbol, payload, payload.sourceUsed || source);
}

function sortedReferenceDates(series: OptimizerReferenceSeries): string[] {
  return Array.from(series.closesByDate.keys()).sort((left, right) => left.localeCompare(right));
}

function rebaseReferenceSeries(series: OptimizerReferenceSeries, factor: number, sourceUsed: string): OptimizerReferenceSeries {
  if (!Number.isFinite(factor) || factor <= 0 || Math.abs(factor - 1) < 1e-12) {
    return { ...series, sourceUsed };
  }
  const closesByDate = new Map<string, number>();
  for (const [day, close] of series.closesByDate.entries()) {
    closesByDate.set(day, close * factor);
  }
  return {
    symbol: series.symbol,
    closesByDate,
    sourceUsed,
    start: series.start,
    end: series.end,
  };
}

function mergeReferenceSeries(
  symbol: ReferenceSymbol,
  historical: OptimizerReferenceSeries | null,
  recent: OptimizerReferenceSeries | null,
): OptimizerReferenceSeries {
  if (!historical && !recent) return emptyReferenceSeries(symbol);
  if (!historical) return recent as OptimizerReferenceSeries;
  if (!recent || !recent.start) return historical;

  const recentDates = sortedReferenceDates(recent);
  const recentStart = recent.start;
  const recentStartClose = recent.closesByDate.get(recentStart);
  const historicalDates = sortedReferenceDates(historical).filter((day) => day < recentStart);
  let rebasedHistorical = historical;

  if (historicalDates.length && Number.isFinite(recentStartClose)) {
    const anchorDay = historicalDates[historicalDates.length - 1];
    const anchorClose = historical.closesByDate.get(anchorDay);
    if (Number.isFinite(anchorClose) && anchorClose && recentStartClose) {
      rebasedHistorical = rebaseReferenceSeries(
        historical,
        recentStartClose / anchorClose,
        `${historical.sourceUsed} -> ${recent.sourceUsed}`,
      );
    }
  }

  const closesByDate = new Map<string, number>();
  for (const day of sortedReferenceDates(rebasedHistorical)) {
    if (day < recentStart) {
      const value = rebasedHistorical.closesByDate.get(day);
      if (Number.isFinite(value)) closesByDate.set(day, value as number);
    }
  }
  for (const day of recentDates) {
    const value = recent.closesByDate.get(day);
    if (Number.isFinite(value)) closesByDate.set(day, value as number);
  }

  const dates = Array.from(closesByDate.keys()).sort((left, right) => left.localeCompare(right));
  return {
    symbol,
    closesByDate,
    sourceUsed: `${rebasedHistorical.sourceUsed} + ${recent.sourceUsed}`,
    start: dates[0] ?? null,
    end: dates[dates.length - 1] ?? null,
  };
}

async function loadHistoricalReferenceBridge(origin: string, symbol: ReferenceSymbol, preferredSource: string): Promise<OptimizerReferenceSeries | null> {
  const sources = [preferredSource, "tradingview", "dukascopy"].filter((item, index, list) => item !== "yahoo" && list.indexOf(item) === index);
  for (const currentSource of sources) {
    const aliases = REFERENCE_PROVIDER_SYMBOLS[symbol][currentSource] ?? [symbol];
    for (const alias of aliases) {
      try {
        const candidate = await loadReferenceCandidate(origin, alias, currentSource);
        if (candidate.start && candidate.closesByDate.size > 0) {
          return {
            ...candidate,
            symbol,
            sourceUsed: `${currentSource}:${alias}${candidate.sourceUsed && candidate.sourceUsed !== currentSource ? ` (${candidate.sourceUsed})` : ""}`,
          };
        }
      } catch {
        // try next alias/provider
      }
    }
  }

  const spec = REFERENCE_FALLBACKS.find((item) => item.symbol === symbol);
  if (!spec) return null;
  return loadReferenceFromFred(spec);
}

async function loadReferenceTimeseries(origin: string, symbol: ReferenceSymbol, source: string): Promise<OptimizerReferenceSeries> {
  let yahooSeries: OptimizerReferenceSeries | null = null;
  try {
    yahooSeries = await loadReferenceCandidate(origin, symbol, "yahoo");
  } catch {
    yahooSeries = null;
  }

  if (yahooSeries?.start && yahooSeries.start <= TARGET_START_DAY) {
    return {
      ...yahooSeries,
      symbol,
    };
  }

  let historicalBridge: OptimizerReferenceSeries | null = null;
  try {
    historicalBridge = await loadHistoricalReferenceBridge(origin, symbol, source);
  } catch {
    historicalBridge = null;
  }

  const merged = mergeReferenceSeries(symbol, historicalBridge, yahooSeries);
  if (merged.start) return merged;

  throw new Error(`Unable to load reference series for ${symbol}`);
}

function toReferenceSeries(symbol: string, payload: TimeseriesResponse, sourceUsed?: string): OptimizerReferenceSeries {
  const closesByDate = new Map<string, number>();
  for (const row of sanitizeBars(payload.ohlcv ?? [])) {
    closesByDate.set(isoDay(row.t), Number(row.close));
  }
  const dates = Array.from(closesByDate.keys()).sort();
  return {
    symbol,
    closesByDate,
    sourceUsed: String(sourceUsed || payload.sourceUsed || payload.source || "unknown"),
    start: dates[0] ?? null,
    end: dates[dates.length - 1] ?? null,
  };
}

function emptyReferenceSeries(symbol: string): OptimizerReferenceSeries {
  return { symbol, closesByDate: new Map<string, number>(), sourceUsed: "unavailable", start: null, end: null };
}

function businessDaysBetween(startDay: string, endDay: string): number {
  const start = new Date(`${startDay}T00:00:00Z`);
  const end = new Date(`${endDay}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 0;
  let count = 0;
  for (let current = new Date(start); current <= end; current.setUTCDate(current.getUTCDate() + 1)) {
    const day = current.getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
  }
  return count;
}

function analyzeCoverage(assetId: OptimizerAssetId, symbol: string, barsH1: OhlcvPoint[], barsD1: OptimizerDailyBar[], sourceRequested: string, sourceUsed: string, fallbackUsed: boolean): OptimizerMarketCoverage {
  const start = barsD1[0]?.t ?? null;
  const end = barsD1[barsD1.length - 1]?.t ?? null;
  const issues: string[] = [];
  const expectedBusinessDays = start && end ? businessDaysBetween(isoDay(start), isoDay(end)) : 0;
  const missingDaysD1 = Math.max(0, expectedBusinessDays - barsD1.length);
  const coverageRatioD1 = expectedBusinessDays > 0 ? barsD1.length / expectedBusinessDays : 0;
  let largestGapDays = 0;

  for (let index = 1; index < barsD1.length; index += 1) {
    const prev = new Date(barsD1[index - 1].t).getTime();
    const next = new Date(barsD1[index].t).getTime();
    const gapDays = Math.round((next - prev) / 86_400_000);
    largestGapDays = Math.max(largestGapDays, gapDays);
  }

  if (fallbackUsed || !sourceUsed.toLowerCase().includes("dukascopy")) {
    issues.push(`fallback source active (${sourceUsed})`);
  }
  if (!start || isoDay(start) > TARGET_START_DAY) {
    issues.push(`coverage starts late (${start ? isoDay(start) : "missing"})`);
  }
  if (coverageRatioD1 < 0.92) {
    issues.push(`daily coverage ${(coverageRatioD1 * 100).toFixed(1)}%`);
  }
  if (largestGapDays > 5) {
    issues.push(`largest data gap ${largestGapDays} days`);
  }
  if (barsH1.length === 0 || barsD1.length === 0) {
    issues.push("no usable OHLC history");
  }

  return {
    assetId,
    symbol,
    barsH1: barsH1.length,
    barsD1: barsD1.length,
    start,
    end,
    sourceRequested,
    sourceUsed,
    fallbackUsed,
    coverageRatioD1,
    missingDaysD1,
    largestGapDays,
    issues,
  };
}

function analyzeCandleIntegrity(assetId: OptimizerAssetId, symbol: string, barsD1: OptimizerDailyBar[]): OptimizerCandleIntegrityReport {
  const candleCount = barsD1.length;
  let invalidHighLowCount = 0;
  let flatRangeCount = 0;
  let openEqualsCloseCount = 0;

  for (const bar of barsD1) {
    const maxBody = Math.max(bar.open, bar.close);
    const minBody = Math.min(bar.open, bar.close);
    if (bar.high < maxBody || bar.low > minBody) invalidHighLowCount += 1;
    if (Math.abs(bar.high - bar.low) < 1e-10) flatRangeCount += 1;
    if (Math.abs(bar.open - bar.close) < 1e-10) openEqualsCloseCount += 1;
  }

  const invalidHighLowRatio = candleCount > 0 ? invalidHighLowCount / candleCount : 0;
  const flatRangeRatio = candleCount > 0 ? flatRangeCount / candleCount : 0;
  const openEqualsCloseRatio = candleCount > 0 ? openEqualsCloseCount / candleCount : 0;
  const warnings: string[] = [];

  if (invalidHighLowCount > 0) {
    warnings.push(`High/low envelope violations: ${invalidHighLowCount}`);
  }
  if (flatRangeRatio > 0.01) {
    warnings.push(`Flat candles exceed threshold: ${(flatRangeRatio * 100).toFixed(2)}%`);
  }
  if (openEqualsCloseRatio > 0.4) {
    warnings.push(`Open equals close is excessive: ${(openEqualsCloseRatio * 100).toFixed(2)}%`);
  }

  return {
    assetId,
    symbol,
    candleCount,
    invalidHighLowCount,
    flatRangeCount,
    openEqualsCloseCount,
    invalidHighLowRatio,
    flatRangeRatio,
    openEqualsCloseRatio,
    warnings,
    isValid: invalidHighLowCount === 0 && flatRangeRatio <= 0.01 && openEqualsCloseRatio <= 0.4,
  };
}

function summarizeReferenceCoverage(series: OptimizerReferenceSeries, label: string, warnings: string[]): void {
  if (!series.start) {
    warnings.push(`${label}: reference series unavailable.`);
    return;
  }
  if (series.start > TARGET_START_DAY) {
    warnings.push(`${label}: reference coverage starts at ${series.start} via ${series.sourceUsed}.`);
  }
}

export async function loadOptimizerData(origin: string, config: OptimizerConfig, options?: LoadOptimizerDataOptions): Promise<OptimizerLoadedData> {
  const selectedAssets = OPTIMIZER_FX_UNIVERSE.filter((item) => config.assets.includes(item.assetId));
  const warnings: string[] = [];
  const totalSteps = selectedAssets.length + 3;
  let completedSteps = 0;
  const bump = (message: string) => {
    completedSteps += 1;
    options?.onProgress?.(completedSteps, totalSteps, message);
  };

  const assetPayloads: OptimizerAssetDataset[] = [];
  const coverage: OptimizerMarketCoverage[] = [];
  const integrity: OptimizerCandleIntegrityReport[] = [];

  options?.onProgress?.(0, totalSteps, `Checking local Dukascopy H1 cache for ${selectedAssets.length} FX assets.`);
  await ensureForexCache(selectedAssets.map((item) => item.symbol));

  for (const item of selectedAssets) {
    const payload = await loadAssetTimeseries(item.assetId, item.symbol);
    const barsH1 = sanitizeBars(payload.ohlcv ?? []);
    const barsD1 = aggregateH1ToD1(barsH1);
    const dataset: OptimizerAssetDataset = {
      assetId: item.assetId,
      symbol: item.symbol,
      barsH1,
      barsD1,
      sourceRequested: "dukascopy",
      sourceUsed: String(payload.sourceUsed || "local-dukascopy-cache"),
      fallbackUsed: Boolean(payload.fallbackUsed),
    };
    const assetCoverage = analyzeCoverage(
      item.assetId,
      item.symbol,
      barsH1,
      barsD1,
      dataset.sourceRequested,
      dataset.sourceUsed,
      dataset.fallbackUsed,
    );
    if (assetCoverage.issues.length) {
      warnings.push(`${item.symbol}: ${assetCoverage.issues.join("; ")}.`);
    }
    const assetIntegrity = analyzeCandleIntegrity(item.assetId, item.symbol, barsD1);
    if (!assetIntegrity.isValid) {
      warnings.push(`${item.symbol}: Invalid candle construction detected. ${assetIntegrity.warnings.join("; ")}.`);
    }
    assetPayloads.push(dataset);
    coverage.push(assetCoverage);
    integrity.push(assetIntegrity);
    bump(`Loaded ${item.symbol} (${barsD1.length} daily bars).`);
  }

  const [dxy, gold, us10y] = await Promise.all([
    loadReferenceTimeseries(origin, "DXY", config.source).catch((error) => {
      warnings.push(`DXY reference unavailable: ${error instanceof Error ? error.message : String(error)}`);
      return emptyReferenceSeries("DXY");
    }),
    loadReferenceTimeseries(origin, "GC1!", config.source).catch((error) => {
      warnings.push(`Gold reference unavailable: ${error instanceof Error ? error.message : String(error)}`);
      return emptyReferenceSeries("GC1!");
    }),
    loadReferenceTimeseries(origin, "^TNX", config.source).catch((error) => {
      warnings.push(`US 10Y reference unavailable: ${error instanceof Error ? error.message : String(error)}`);
      return emptyReferenceSeries("^TNX");
    }),
  ]);
  bump(`Loaded ${dxy.symbol} reference via ${dxy.sourceUsed}.`);
  bump(`Loaded ${gold.symbol} reference via ${gold.sourceUsed}.`);
  bump(`Loaded ${us10y.symbol} reference via ${us10y.sourceUsed}.`);

  summarizeReferenceCoverage(dxy, "DXY", warnings);
  summarizeReferenceCoverage(gold, "Gold", warnings);
  summarizeReferenceCoverage(us10y, "US 10Y", warnings);

  return {
    assets: assetPayloads,
    references: { dxy, gold, us10y },
    coverage,
    integrity,
    warnings,
  };
}
