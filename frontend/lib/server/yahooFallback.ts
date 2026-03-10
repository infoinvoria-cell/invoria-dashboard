import assetSnapshot from "@/data/asset-snapshot.json";

type AssetLocation = {
  label: string;
  lat: number;
  lng: number;
  weight: number;
};

type AssetItem = {
  id: string;
  name: string;
  category: string;
  iconKey: string;
  tvSource: string;
  symbol: string;
  lat: number;
  lng: number;
  country: string;
  color: string;
  defaultEnabled: boolean;
  watchlistFeatured?: boolean;
  showOnGlobe?: boolean;
  locations: AssetLocation[];
};

type OhlcvBar = {
  t: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
};

type EvaluationPoint = {
  t: string;
  v10: number | null;
  v20: number | null;
};

type EvaluationSeries = {
  id: string;
  label: string;
  symbol: string;
  color: string;
  points: EvaluationPoint[];
};

const DAY_MS = 86_400_000;
const ASSETS = assetSnapshot.items as AssetItem[];
const YAHOO_SYMBOL_ALIASES: Record<string, string> = {
  "DXY": "DX-Y.NYB",
  "DX-Y.NYB": "DX-Y.NYB",
  "USD_INDEX": "DX-Y.NYB",
  "US500": "^GSPC",
  "SPX": "^GSPC",
  "^GSPC": "^GSPC",
  "ES1!": "^GSPC",
  "^GDAXI": "^GDAXI",
  "FDAX1!": "^GDAXI",
  "6E1!": "EURUSD=X",
  "6J1!": "JPY=X",
  "6B1!": "GBPUSD=X",
  "6S1!": "CHF=X",
  "6A1!": "AUDUSD=X",
  "6C1!": "CAD=X",
  "6N1!": "NZDUSD=X",
  "NQ1!": "^IXIC",
  "YM1!": "^DJI",
  "RTY1!": "^RUT",
  "GC1!": "GC=F",
  "XAUUSD": "GC=F",
  "SI1!": "SI=F",
  "XAGUSD": "SI=F",
  "HG1!": "HG=F",
  "COPPER": "HG=F",
  "PL1!": "PL=F",
  "PA1!": "PA=F",
  "ALI1!": "ALI=F",
  "USOIL": "CL=F",
  "WTI": "CL=F",
  "NG1!": "NG=F",
  "RB1!": "RB=F",
  "ZW1!": "ZW=F",
  "WHEAT": "ZW=F",
  "ZC1!": "ZC=F",
  "CORN": "ZC=F",
  "ZS1!": "ZS=F",
  "ZL1!": "ZL=F",
  "KC1!": "KC=F",
  "SB1!": "SB=F",
  "C1!": "CC=F",
  "CC1!": "CC=F",
  "CT1!": "CT=F",
  "OJ1!": "OJ=F",
  "LE1!": "LE=F",
  "HE1!": "HE=F",
  "BTCUSD": "BTC-USD",
  "USDJPY": "JPY=X",
  "USDCHF": "CHF=X",
  "USDCAD": "CAD=X",
  "EURUSD": "EURUSD=X",
  "GBPUSD": "GBPUSD=X",
  "AUDUSD": "AUDUSD=X",
  "NZDUSD": "NZDUSD=X",
};

function nowIso(): string {
  return new Date().toISOString();
}

function clip(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = average(values);
  const variance = average(values.map((value) => (value - mean) ** 2));
  return Math.sqrt(variance);
}

function findAsset(assetId: string): AssetItem | null {
  const normalized = String(assetId || "").trim().toLowerCase();
  return ASSETS.find((asset) => asset.id.toLowerCase() === normalized) ?? null;
}

function floorUtcDay(timestampMs: number): number {
  const date = new Date(timestampMs);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function isoAtUtcDay(timestampMs: number): string {
  return new Date(floorUtcDay(timestampMs)).toISOString().replace(".000Z", "Z");
}

function normalizeTf(value: string | null | undefined): "D" | "W" | "M" | "4H" | "1H" {
  const tf = String(value || "D").trim().toUpperCase();
  if (tf === "W") return "W";
  if (tf === "M") return "M";
  if (tf === "4H") return "4H";
  if (tf === "1H") return "1H";
  return "D";
}

function yahooSymbolFromRaw(rawSymbol: string): string {
  const normalized = String(rawSymbol || "").trim().toUpperCase();
  if (!normalized) return "";
  const alias = YAHOO_SYMBOL_ALIASES[normalized];
  if (alias) return alias;
  if (/^[A-Z]{6}$/.test(normalized)) {
    return `${normalized}=X`;
  }
  return rawSymbol;
}

function yahooSymbolForAsset(assetId: string): string {
  const asset = findAsset(assetId);
  if (!asset) {
    return yahooSymbolFromRaw(assetId);
  }
  return yahooSymbolFromRaw(asset.symbol || asset.tvSource || asset.id);
}

function assetIdForReferenceSymbol(symbol: string): string | null {
  const normalized = String(symbol || "").trim().toUpperCase();
  const byAsset = ASSETS.find((asset) => {
    const candidates = [asset.id, asset.symbol, asset.tvSource, asset.name]
      .map((value) => String(value || "").trim().toUpperCase());
    return candidates.includes(normalized);
  });
  return byAsset?.id ?? null;
}

function tfConfig(tf: "D" | "W" | "M" | "4H" | "1H") {
  if (tf === "1H" || tf === "4H") {
    return {
      interval: "60m",
      range: "730d",
    };
  }
  return {
    interval: "1d",
    range: "10y",
  };
}

async function fetchYahooRaw(symbol: string, tf: "D" | "W" | "M" | "4H" | "1H"): Promise<OhlcvBar[]> {
  const config = tfConfig(tf);
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  url.searchParams.set("interval", config.interval);
  url.searchParams.set("range", config.range);
  url.searchParams.set("includePrePost", "false");
  url.searchParams.set("events", "div,splits");

  const response = await fetch(url.toString(), {
    headers: {
      accept: "application/json",
      "user-agent": "Mozilla/5.0",
    },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Yahoo chart fetch failed for ${symbol}: ${response.status}`);
  }

  const payload = await response.json();
  const result = payload?.chart?.result?.[0];
  const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
  const quote = result?.indicators?.quote?.[0] ?? {};
  const opens = Array.isArray(quote?.open) ? quote.open : [];
  const highs = Array.isArray(quote?.high) ? quote.high : [];
  const lows = Array.isArray(quote?.low) ? quote.low : [];
  const closes = Array.isArray(quote?.close) ? quote.close : [];
  const volumes = Array.isArray(quote?.volume) ? quote.volume : [];

  const out: OhlcvBar[] = [];
  for (let index = 0; index < timestamps.length; index += 1) {
    const ts = Number(timestamps[index]) * 1000;
    const open = Number(opens[index]);
    const high = Number(highs[index]);
    const low = Number(lows[index]);
    const close = Number(closes[index]);
    if (![ts, open, high, low, close].every(Number.isFinite)) {
      continue;
    }
    out.push({
      t: new Date(ts).toISOString().replace(".000Z", "Z"),
      open,
      high: Math.max(high, open, close),
      low: Math.min(low, open, close),
      close,
      volume: Number.isFinite(Number(volumes[index])) ? Number(volumes[index]) : null,
    });
  }
  return out;
}

function startOfIsoWeek(timestampMs: number): number {
  const date = new Date(floorUtcDay(timestampMs));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function startOfUtcMonth(timestampMs: number): number {
  const date = new Date(timestampMs);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

function startOfUtc4H(timestampMs: number): number {
  const date = new Date(timestampMs);
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    Math.floor(date.getUTCHours() / 4) * 4,
    0,
    0,
    0,
  );
}

function aggregateBars(bars: OhlcvBar[], bucketFn: (timestampMs: number) => number): OhlcvBar[] {
  const buckets = new Map<number, OhlcvBar[]>();
  for (const bar of bars) {
    const key = bucketFn(new Date(bar.t).getTime());
    const group = buckets.get(key) ?? [];
    group.push(bar);
    buckets.set(key, group);
  }

  return Array.from(buckets.entries())
    .sort((left, right) => left[0] - right[0])
    .map(([timestamp, group]) => {
      const open = group[0].open;
      const close = group[group.length - 1].close;
      const high = Math.max(...group.map((row) => row.high));
      const low = Math.min(...group.map((row) => row.low));
      const volumeRaw = group.reduce((sum, row) => sum + (row.volume ?? 0), 0);
      const volume = volumeRaw > 0 ? volumeRaw : null;
      return {
        t: isoAtUtcDay(timestamp),
        open,
        high,
        low,
        close,
        volume,
      };
    });
}

async function fetchYahooBars(symbol: string, tf: "D" | "W" | "M" | "4H" | "1H"): Promise<OhlcvBar[]> {
  const raw = await fetchYahooRaw(symbol, tf);
  if (tf === "D" || tf === "1H") {
    return raw;
  }
  if (tf === "W") {
    return aggregateBars(raw, startOfIsoWeek);
  }
  if (tf === "M") {
    return aggregateBars(raw, startOfUtcMonth);
  }
  return aggregateBars(raw, startOfUtc4H);
}

function closesFromBars(bars: OhlcvBar[]): number[] {
  return bars.map((bar) => Number(bar.close)).filter(Number.isFinite);
}

function rollingAverage(values: number[], window: number): number[] {
  return values.map((_, index) => {
    const start = Math.max(0, index - window + 1);
    return average(values.slice(start, index + 1));
  });
}

function computeRsi(closes: number[], length = 14): number {
  if (closes.length <= length) return 50;
  let gain = 0;
  let loss = 0;
  for (let index = closes.length - length; index < closes.length; index += 1) {
    const delta = closes[index] - closes[index - 1];
    if (delta >= 0) gain += delta;
    else loss -= delta;
  }
  const avgGain = gain / length;
  const avgLoss = loss / length;
  if (avgLoss <= 1e-9) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function computeAtrPct(bars: OhlcvBar[], length = 14): number {
  if (bars.length <= length) return 0;
  const ranges: number[] = [];
  for (let index = bars.length - length; index < bars.length; index += 1) {
    const current = bars[index];
    const previousClose = bars[index - 1]?.close ?? current.close;
    const tr = Math.max(
      current.high - current.low,
      Math.abs(current.high - previousClose),
      Math.abs(current.low - previousClose),
    );
    ranges.push(tr);
  }
  const lastClose = bars[bars.length - 1]?.close ?? 0;
  if (!Number.isFinite(lastClose) || lastClose <= 0) return 0;
  return (average(ranges) / lastClose) * 100;
}

function computeVolatility(closes: number[]): number {
  if (closes.length < 21) return 0;
  const returns: number[] = [];
  for (let index = closes.length - 20; index < closes.length; index += 1) {
    const previous = closes[index - 1];
    const current = closes[index];
    if (!Number.isFinite(previous) || !Number.isFinite(current) || previous === 0) continue;
    returns.push((current / previous) - 1);
  }
  return stdDev(returns) * Math.sqrt(252) * 100;
}

function computeIndicators(bars: OhlcvBar[]) {
  const closes = closesFromBars(bars);
  const sma20 = rollingAverage(closes, 20);
  const lastClose = closes[closes.length - 1] ?? 0;
  const lastSma20 = sma20[sma20.length - 1] ?? lastClose;
  return {
    distanceToDemand: null,
    distanceToSupply: null,
    rsi: Number(computeRsi(closes).toFixed(2)),
    atrPct: Number(computeAtrPct(bars).toFixed(2)),
    volatility: Number(computeVolatility(closes).toFixed(2)),
    trend: lastClose >= lastSma20 ? "Bullish" : "Bearish",
  };
}

export async function buildYahooTimeseriesPayload(
  assetId: string,
  timeframe: string,
  source: string,
  continuousMode: string,
) {
  const asset = findAsset(assetId);
  if (!asset) {
    throw new Error(`Unknown asset: ${assetId}`);
  }
  const tf = normalizeTf(timeframe);
  const yahooSymbol = yahooSymbolForAsset(assetId);
  const bars = await fetchYahooBars(yahooSymbol, tf);
  if (!bars.length) {
    throw new Error(`No bars for ${assetId}`);
  }

  const lastClose = bars[bars.length - 1]?.close ?? 0;
  return {
    assetId: asset.id,
    symbol: asset.symbol || asset.tvSource || yahooSymbol,
    updatedAt: nowIso(),
    source,
    sourceRequested: source,
    sourceUsed: "yahoo",
    fallbackUsed: true,
    fallbackReason: "nextjs yahoo fallback",
    continuousMode,
    diagnostics: {
      timeframe: tf,
      bars: bars.length,
      start: bars[0]?.t ?? null,
      end: bars[bars.length - 1]?.t ?? null,
    },
    ohlcv: bars,
    supplyDemand: {
      demand: [],
      supply: [],
    },
    indicators: computeIndicators(bars),
    aiScore: {
      total: Number.isFinite(lastClose) ? 50 : 0,
      breakdown: {},
    },
  };
}

async function dailyBarsForAssetOrSymbol(assetIdOrSymbol: string): Promise<OhlcvBar[]> {
  const asset = findAsset(assetIdOrSymbol);
  const yahooSymbol = asset ? yahooSymbolForAsset(asset.id) : yahooSymbolFromRaw(assetIdOrSymbol);
  return fetchYahooBars(yahooSymbol, "D");
}

function alignBars(left: OhlcvBar[], right: OhlcvBar[]): Array<{ t: string; left: number; right: number }> {
  const rightEntries: Array<[string, number]> = right
    .map((bar) => [bar.t.slice(0, 10), Number(bar.close)] as [string, number])
    .filter((row) => Number.isFinite(row[1]));
  const rightMap = new Map<string, number>(
    rightEntries,
  );
  return left
    .map((bar) => ({
      t: bar.t,
      left: Number(bar.close),
      right: Number(rightMap.get(bar.t.slice(0, 10))),
    }))
    .filter((row) => Number.isFinite(row.left) && Number.isFinite(row.right));
}

function valuationValueSeries(aligned: Array<{ t: string; left: number; right: number }>) {
  const points: EvaluationPoint[] = [];
  for (let index = 0; index < aligned.length; index += 1) {
    const row = aligned[index];
    const prev10 = aligned[index - 10];
    const prev20 = aligned[index - 20];
    const v10 = prev10
      ? clip((((row.left / prev10.left) - (row.right / prev10.right)) * 1000), -100, 100)
      : null;
    const v20 = prev20
      ? clip((((row.left / prev20.left) - (row.right / prev20.right)) * 1000), -100, 100)
      : null;
    points.push({
      t: row.t,
      v10: v10 == null ? null : Number(v10.toFixed(2)),
      v20: v20 == null ? null : Number(v20.toFixed(2)),
    });
  }
  return points;
}

export async function buildYahooEvaluationPayload(assetId: string) {
  const asset = findAsset(assetId);
  if (!asset) {
    throw new Error(`Unknown asset: ${assetId}`);
  }

  const [assetBars, goldBars, usdBars, us10yBars] = await Promise.all([
    dailyBarsForAssetOrSymbol(asset.id),
    dailyBarsForAssetOrSymbol("gold"),
    dailyBarsForAssetOrSymbol("DXY"),
    dailyBarsForAssetOrSymbol("^TNX"),
  ]);

  const goldPoints = valuationValueSeries(alignBars(assetBars, goldBars));
  const usdPoints = valuationValueSeries(alignBars(assetBars, usdBars));
  const us10yPoints = valuationValueSeries(alignBars(assetBars, us10yBars));

  const combinedMap = new Map<string, { v10: number[]; v20: number[] }>();
  for (const row of [goldPoints, usdPoints, us10yPoints].flat()) {
    const bucket = combinedMap.get(row.t) ?? { v10: [], v20: [] };
    if (row.v10 != null) bucket.v10.push(row.v10);
    if (row.v20 != null) bucket.v20.push(row.v20);
    combinedMap.set(row.t, bucket);
  }

  const combinedPoints = Array.from(combinedMap.entries())
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([t, bucket]) => ({
      t,
      v10: bucket.v10.length ? Number(average(bucket.v10).toFixed(2)) : null,
      v20: bucket.v20.length ? Number(average(bucket.v20).toFixed(2)) : null,
    }));

  const series: EvaluationSeries[] = [
    { id: "combined", label: "Combined", symbol: "COMB", color: "#2962ff", points: combinedPoints.slice(-260) },
    { id: "gold", label: "Gold", symbol: "XAU", color: "#ffeb3b", points: goldPoints.slice(-260) },
    { id: "dxy", label: "Dollar", symbol: "USD", color: "#4caf50", points: usdPoints.slice(-260) },
    { id: "us10y", label: "US10Y", symbol: "US10Y", color: "#ff6f8d", points: us10yPoints.slice(-260) },
  ];

  return {
    assetId: asset.id,
    updatedAt: nowIso(),
    series,
  };
}

function dayOfYearFromIso(iso: string): number {
  const date = new Date(iso);
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  return Math.floor((floorUtcDay(date.getTime()) - start) / DAY_MS) + 1;
}

export async function buildYahooSeasonalityPayload(assetId: string) {
  const asset = findAsset(assetId);
  if (!asset) {
    throw new Error(`Unknown asset: ${assetId}`);
  }

  const bars = await dailyBarsForAssetOrSymbol(asset.id);
  if (bars.length < 260) {
    throw new Error(`Insufficient seasonality data for ${assetId}`);
  }

  const closes = bars.map((bar) => Number(bar.close));
  const doys = bars.map((bar) => dayOfYearFromIso(bar.t));
  const currentDoy = dayOfYearFromIso(nowIso());
  const candidateHolds = [10, 12, 15, 18, 20];

  let bestHold = 20;
  let bestExpected = -Infinity;
  let bestDirection: "LONG" | "SHORT" = "LONG";
  let bestHitRate = 0;
  let bestSamples = 0;
  let bestCurve: Array<{ x: number; y: number }> = [];
  let bestReturns: number[] = [];

  for (const hold of candidateHolds) {
    const sampleReturns: number[] = [];
    const sampleCurves: number[][] = [];
    for (let index = 0; index < bars.length - hold; index += 1) {
      if (Math.abs(doys[index] - currentDoy) > 12) continue;
      const start = closes[index];
      if (!Number.isFinite(start) || start <= 0) continue;
      const path: number[] = [];
      for (let step = 1; step <= hold; step += 1) {
        const end = closes[index + step];
        path.push(((end / start) - 1) * 100);
      }
      sampleCurves.push(path);
      sampleReturns.push(path[path.length - 1]);
    }

    if (sampleReturns.length < 4) continue;

    const meanReturn = average(sampleReturns);
    const expected = Math.abs(meanReturn);
    if (expected < bestExpected) continue;

    bestExpected = expected;
    bestHold = hold;
    bestDirection = meanReturn >= 0 ? "LONG" : "SHORT";
    bestSamples = sampleReturns.length;
    bestHitRate = sampleReturns.filter((value) => value >= 0).length / sampleReturns.length;
    bestReturns = sampleReturns;
    bestCurve = Array.from({ length: hold + 1 }, (_, step) => {
      if (step === 0) {
        return { x: 0, y: 0 };
      }
      return {
        x: step,
        y: Number(average(sampleCurves.map((curve) => curve[step - 1] ?? 0)).toFixed(4)),
      };
    });
  }

  if (!bestCurve.length) {
    bestCurve = [{ x: 0, y: 0 }];
  }

  const avgReturn20d = Number((bestCurve[Math.min(bestCurve.length - 1, 20)]?.y ?? 0).toFixed(4));
  const expectedValue = Number((bestReturns.length ? average(bestReturns) : 0).toFixed(4));
  const sharpeRatio = bestReturns.length > 1 ? Number((average(bestReturns) / Math.max(1e-9, stdDev(bestReturns))).toFixed(4)) : 0;
  const downside = bestReturns.filter((value) => value < 0);
  const downsideStd = downside.length ? stdDev(downside) : 0;
  const sortinoRatio = downsideStd > 1e-9 ? Number((average(bestReturns) / downsideStd).toFixed(4)) : sharpeRatio;

  return {
    assetId: asset.id,
    updatedAt: nowIso(),
    projectionDays: bestHold,
    yearsUsed: Math.min(10, new Set(bars.map((bar) => new Date(bar.t).getUTCFullYear())).size),
    curve: bestCurve,
    stats: {
      avgReturn20d,
      hitRate: Number(bestHitRate.toFixed(4)),
      expectedValue,
      direction: bestDirection,
      samples: bestSamples,
      sharpeRatio,
      sortinoRatio,
      bestHorizonDays: bestHold,
    },
  };
}

export async function buildYahooReferenceTimeseriesPayload(
  symbol: string,
  timeframe: string,
  source: string,
  continuousMode: string,
) {
  const assetId = assetIdForReferenceSymbol(symbol);
  if (assetId) {
    return buildYahooTimeseriesPayload(assetId, timeframe, source, continuousMode);
  }

  const tf = normalizeTf(timeframe);
  const yahooSymbol = yahooSymbolFromRaw(symbol);
  const bars = await fetchYahooBars(yahooSymbol, tf);
  if (!bars.length) {
    throw new Error(`No bars for reference ${symbol}`);
  }
  return {
    assetId: String(symbol || "").trim(),
    symbol: yahooSymbol,
    updatedAt: nowIso(),
    source,
    sourceRequested: source,
    sourceUsed: "yahoo",
    fallbackUsed: true,
    fallbackReason: "nextjs yahoo reference fallback",
    continuousMode,
    diagnostics: {
      timeframe: tf,
      bars: bars.length,
      start: bars[0]?.t ?? null,
      end: bars[bars.length - 1]?.t ?? null,
    },
    ohlcv: bars,
    supplyDemand: {
      demand: [],
      supply: [],
    },
    indicators: computeIndicators(bars),
    aiScore: {
      total: 50,
      breakdown: {},
    },
  };
}
