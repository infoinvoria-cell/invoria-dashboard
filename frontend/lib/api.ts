import type {
  AlertsResponse,
  AssetRegionHighlightResponse,
  AssetSignalDetailResponse,
  AssetsResponse,
  CategoryHeatmapResponse,
  CommodityStressMapResponse,
  CommodityRegionsResponse,
  CommodityShockResponse,
  GlobalLiquidityMapResponse,
  GlobalRiskLayerResponse,
  OverlayRoutesResponse,
  DiagnosticsResponse,
  EvaluationResponse,
  FundamentalOscillatorResponse,
  GeoEventsResponse,
  HeatmapAssetsResponse,
  InflationResponse,
  NewsResponse,
  NewsTranslationResponse,
  OpportunitiesResponse,
  PolicyRateResponse,
  RiskResponse,
  SeasonalityResponse,
  ShippingDisruptionsResponse,
  ShipTrackingResponse,
  TrackRecordResponse,
  TimeseriesResponse,
  VolatilityRegimeResponse,
} from "../types";

const cache = new Map<string, { expires: number; value: unknown }>();
const loadingLabels = new Map<number, string>();
const loadingListeners = new Set<(state: ApiLoadingSnapshot) => void>();
let loadingRequestSeq = 0;
const MARKET_CACHE_MS = 40 * 60 * 1000;
const NEWS_CACHE_MS = 10 * 60 * 1000;
const VALUATION_CACHE_MS = 40 * 60 * 1000;
const SEASONALITY_CACHE_MS = 10 * 365 * 24 * 60 * 60 * 1000;

export type ApiLoadingSnapshot = {
  active: boolean;
  count: number;
  labels: string[];
};

function labelForUrl(url: string): string {
  const u = String(url || "").toLowerCase();
  if (u.includes("/events/earthquakes")) return "Loading earthquakes...";
  if (u.includes("/events/wildfires")) return "Loading wildfires...";
  if (u.includes("/events/conflicts")) return "Loading conflicts...";
  if (u.includes("/overlay/ships")) return "Loading ship tracking...";
  if (u.includes("/overlay/global_liquidity")) return "Loading liquidity map...";
  if (u.includes("/overlay/global_risk")) return "Loading risk layer...";
  if (u.includes("/overlay/shipping_disruptions")) return "Loading shipping disruptions...";
  if (u.includes("/overlay/commodity_regions")) return "Loading commodity regions...";
  if (u.includes("/overlay/commodity_stress")) return "Loading commodity stress map...";
  if (u.includes("/news/translate")) return "Translating news...";
  if (u.includes("/timeseries")) return "Loading candlestick data...";
  if (u.includes("/evaluation")) return "Loading valuation data...";
  if (u.includes("/seasonality")) return "Loading seasonality...";
  if (u.includes("/heatmap")) return "Loading heatmap...";
  if (u.includes("/news/")) return "Loading news...";
  return "Loading macro data...";
}

function loadingSnapshot(): ApiLoadingSnapshot {
  const labels = Array.from(new Set(Array.from(loadingLabels.values()))).slice(0, 4);
  return {
    active: loadingLabels.size > 0,
    count: loadingLabels.size,
    labels,
  };
}

function notifyLoading(): void {
  const snap = loadingSnapshot();
  for (const cb of loadingListeners) cb(snap);
}

function beginLoading(url: string): () => void {
  const id = loadingRequestSeq + 1;
  loadingRequestSeq = id;
  loadingLabels.set(id, labelForUrl(url));
  notifyLoading();
  return () => {
    loadingLabels.delete(id);
    notifyLoading();
  };
}

export function subscribeApiLoading(listener: (state: ApiLoadingSnapshot) => void): () => void {
  loadingListeners.add(listener);
  listener(loadingSnapshot());
  return () => {
    loadingListeners.delete(listener);
  };
}

function resolveApiBase(): string {
  const envBase = (process.env.NEXT_PUBLIC_API_BASE_URL || process.env.API_BASE_URL || "").trim();
  if (envBase) {
    return envBase.replace(/\/+$/g, "");
  }

  if (typeof window === "undefined") {
    return process.env.NODE_ENV === "development" ? "http://127.0.0.1:8000" : "";
  }
  try {
    const qp = new URLSearchParams(window.location.search);
    const qBase = qp.get("apiBase");
    if (qBase && qBase.trim()) {
      return decodeURIComponent(qBase).replace(/\/+$/g, "");
    }
  } catch (_err) {
    // no-op
  }

  const host = window.location.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1") {
    return "http://127.0.0.1:8000";
  }

  return "";
}

export const API_BASE = resolveApiBase();

async function fetchJson<T>(url: string, ttlMs: number): Promise<T> {
  const now = Date.now();
  for (const [key, row] of cache.entries()) {
    if (row.expires <= now) cache.delete(key);
  }
  const hit = cache.get(url);
  if (hit && hit.expires > now) {
    return hit.value as T;
  }
  const endLoading = beginLoading(url);
  try {
    const res = await fetch(url, { credentials: "omit" });
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText} for ${url}`);
    }
    const parsed = (await res.json()) as T;
    cache.set(url, { expires: now + ttlMs, value: parsed });
    return parsed;
  } finally {
    endLoading();
  }
}

function endpoint(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return API_BASE ? `${API_BASE}${p}` : p;
}

function normalizeCorrTf(value: string): string {
  const tf = String(value || "D").trim().toUpperCase();
  if (tf === "1M" || tf === "1MINUTE" || tf === "M1") return "1MIN";
  if (tf === "5M" || tf === "5MINUTE" || tf === "M5") return "5MIN";
  if (tf === "30M" || tf === "30MINUTE" || tf === "M30") return "30MIN";
  if (tf === "H1" || tf === "1HOUR" || tf === "HOURLY") return "1H";
  if (tf === "H4" || tf === "4HOUR") return "4H";
  if (tf === "DAY" || tf === "DAILY") return "D";
  if (tf === "WEEK" || tf === "WEEKLY") return "W";
  if (tf === "MONTH" || tf === "MONTHLY") return "M";
  return tf;
}

function heatmapCorrelationTtlMs(timeframe: string): number {
  const tf = normalizeCorrTf(timeframe);
  const ttlByTfMs: Record<string, number> = {
    "1MIN": 5 * 60 * 1000,
    "5MIN": 10 * 60 * 1000,
    "30MIN": 20 * 60 * 1000,
    "1H": 30 * 60 * 1000,
    "4H": 60 * 60 * 1000,
    "D": 4 * 60 * 60 * 1000,
    "W": 24 * 60 * 60 * 1000,
    "M": 24 * 60 * 60 * 1000,
  };
  return ttlByTfMs[tf] ?? (30 * 60 * 1000);
}

export const GlobeApi = {
  clearCache(predicate?: (key: string) => boolean): void {
    if (!predicate) {
      cache.clear();
      return;
    }
    for (const key of Array.from(cache.keys())) {
      if (predicate(key)) {
        cache.delete(key);
      }
    }
  },
  getAssets(): Promise<AssetsResponse> {
    return fetchJson<AssetsResponse>(endpoint("/api/assets"), 60 * 60 * 1000);
  },
  getTimeseries(
    assetId: string,
    timeframe = "D",
    source = "tradingview",
    continuousMode: "regular" | "backadjusted" = "backadjusted",
    refreshBucket?: number,
  ): Promise<TimeseriesResponse> {
    const tf = encodeURIComponent(String(timeframe || "D").toUpperCase());
    const src = encodeURIComponent(String(source || "dukascopy").toLowerCase());
    const mode = encodeURIComponent(String(continuousMode || "backadjusted").toLowerCase());
    const hasRefreshBucket = Number.isFinite(Number(refreshBucket));
    const refreshPart = hasRefreshBucket
      ? `&refresh_bucket=${encodeURIComponent(String(Math.floor(Number(refreshBucket))))}`
      : "";
    return fetchJson<TimeseriesResponse>(
      endpoint(`/api/asset/${assetId}/timeseries?tf=${tf}&source=${src}&continuous_mode=${mode}${refreshPart}`),
      MARKET_CACHE_MS,
    );
  },
  getEvaluation(assetId: string, source = "tradingview"): Promise<EvaluationResponse> {
    const src = encodeURIComponent(String(source || "dukascopy").toLowerCase());
    return fetchJson<EvaluationResponse>(endpoint(`/api/asset/${assetId}/evaluation?v=6&source=${src}`), VALUATION_CACHE_MS);
  },
  getSeasonality(assetId: string, source = "tradingview", years = 10): Promise<SeasonalityResponse> {
    // version tag avoids stale in-memory cache collisions during active UI/data iterations
    const src = encodeURIComponent(String(source || "dukascopy").toLowerCase());
    const yearsParam = encodeURIComponent(String(Math.max(10, Math.floor(Number(years) || 10))));
    return fetchJson<SeasonalityResponse>(endpoint(`/api/asset/${assetId}/seasonality?v=3&source=${src}&years=${yearsParam}`), SEASONALITY_CACHE_MS);
  },
  getGlobalNews(): Promise<NewsResponse> {
    return fetchJson<NewsResponse>(endpoint("/api/news/global"), NEWS_CACHE_MS);
  },
  getAssetNews(assetId: string): Promise<NewsResponse> {
    return fetchJson<NewsResponse>(endpoint(`/api/news/asset/${assetId}`), NEWS_CACHE_MS);
  },
  getInflation(): Promise<InflationResponse> {
    return fetchJson<InflationResponse>(endpoint("/api/macro/inflation"), 10 * 60 * 1000);
  },
  getRisk(): Promise<RiskResponse> {
    return fetchJson<RiskResponse>(endpoint("/api/macro/risk"), 10 * 60 * 1000);
  },
  getPolicyRateMap(): Promise<PolicyRateResponse> {
    return fetchJson<PolicyRateResponse>(endpoint("/api/macro/policy_rate"), 10 * 60 * 1000);
  },
  getVolatilityRegime(): Promise<VolatilityRegimeResponse> {
    return fetchJson<VolatilityRegimeResponse>(endpoint("/api/macro/volatility_regime"), 10 * 60 * 1000);
  },
  getCommodityShock(): Promise<CommodityShockResponse> {
    return fetchJson<CommodityShockResponse>(endpoint("/api/macro/commodity_shock"), 10 * 60 * 1000);
  },
  getFundamentalMacro(): Promise<FundamentalOscillatorResponse> {
    return fetchJson<FundamentalOscillatorResponse>(endpoint("/api/macro/fundamental"), 10 * 60 * 1000);
  },
  getHeatmapAssets(timeframe = "D", source = "tradingview"): Promise<HeatmapAssetsResponse> {
    const tfRaw = normalizeCorrTf(timeframe);
    const tf = encodeURIComponent(tfRaw);
    const src = encodeURIComponent(String(source || "dukascopy").toLowerCase());
    return fetchJson<HeatmapAssetsResponse>(endpoint(`/api/heatmap/assets?tf=${tf}&source=${src}&v=9`), heatmapCorrelationTtlMs(tfRaw));
  },
  getCategoryHeatmap(category = "FX", sortBy = "ai_score", source = "tradingview"): Promise<CategoryHeatmapResponse> {
    const cat = encodeURIComponent(String(category || "FX"));
    const sort = encodeURIComponent(String(sortBy || "ai_score"));
    const src = encodeURIComponent(String(source || "dukascopy").toLowerCase());
    return fetchJson<CategoryHeatmapResponse>(endpoint(`/api/heatmap/category?category=${cat}&sort_by=${sort}&source=${src}`), 5 * 60 * 1000);
  },
  getOpportunities(source = "tradingview"): Promise<OpportunitiesResponse> {
    const src = encodeURIComponent(String(source || "dukascopy").toLowerCase());
    return fetchJson<OpportunitiesResponse>(endpoint(`/api/opportunities?source=${src}`), 5 * 60 * 1000);
  },
  getAssetSignalDetail(assetId: string, source = "tradingview"): Promise<AssetSignalDetailResponse> {
    const src = encodeURIComponent(String(source || "dukascopy").toLowerCase());
    return fetchJson<AssetSignalDetailResponse>(endpoint(`/api/asset/${assetId}/signal_detail?source=${src}`), VALUATION_CACHE_MS);
  },
  getReferenceTimeseries(symbol: string, timeframe = "D", source = "tradingview"): Promise<TimeseriesResponse> {
    const ref = encodeURIComponent(String(symbol || "").trim());
    const tf = encodeURIComponent(String(timeframe || "D").toUpperCase());
    const src = encodeURIComponent(String(source || "dukascopy").toLowerCase());
    return fetchJson<TimeseriesResponse>(endpoint(`/api/reference/timeseries?symbol=${ref}&tf=${tf}&source=${src}`), MARKET_CACHE_MS);
  },
  getAlerts(source = "tradingview"): Promise<AlertsResponse> {
    const src = encodeURIComponent(String(source || "dukascopy").toLowerCase());
    return fetchJson<AlertsResponse>(endpoint(`/api/alerts?source=${src}`), 5 * 60 * 1000);
  },
  getGeoEvents(layer = "geo_events"): Promise<GeoEventsResponse> {
    const mode = String(layer || "geo_events").toLowerCase();
    if (mode === "conflicts") {
      return fetchJson<GeoEventsResponse>(endpoint("/api/events/conflicts"), 60 * 60 * 1000);
    }
    if (mode === "wildfires") {
      return fetchJson<GeoEventsResponse>(endpoint("/api/events/wildfires"), 30 * 60 * 1000);
    }
    if (mode === "earthquakes") {
      return fetchJson<GeoEventsResponse>(endpoint("/api/events/earthquakes"), 10 * 60 * 1000);
    }
    if (mode === "news_geo") {
      return fetchJson<GeoEventsResponse>(endpoint("/api/events/news_geo"), 10 * 60 * 1000);
    }
    const encoded = encodeURIComponent(mode);
    return fetchJson<GeoEventsResponse>(endpoint(`/api/geo/events?layer=${encoded}`), 10 * 60 * 1000);
  },
  translateNews(
    newsId: string,
    title: string,
    description = "",
    targetLanguage: "DE" | "EN" = "DE",
  ): Promise<NewsTranslationResponse> {
    const params = new URLSearchParams({
      news_id: String(newsId || "").trim(),
      title: String(title || ""),
      description: String(description || ""),
      target_language: String(targetLanguage || "DE").toUpperCase(),
    });
    return fetchJson<NewsTranslationResponse>(endpoint(`/api/news/translate?${params.toString()}`), 24 * 60 * 60 * 1000);
  },
  getShipTracking(): Promise<ShipTrackingResponse> {
    return fetchJson<ShipTrackingResponse>(endpoint("/api/overlay/ships"), 5 * 60 * 1000);
  },
  getOilRoutes(): Promise<OverlayRoutesResponse> {
    return fetchJson<OverlayRoutesResponse>(endpoint("/api/overlay/oil_routes"), 3 * 60 * 60 * 1000);
  },
  getContainerRoutes(): Promise<OverlayRoutesResponse> {
    return fetchJson<OverlayRoutesResponse>(endpoint("/api/overlay/container_routes"), 3 * 60 * 60 * 1000);
  },
  getCommodityRegions(): Promise<CommodityRegionsResponse> {
    return fetchJson<CommodityRegionsResponse>(endpoint("/api/overlay/commodity_regions"), 24 * 60 * 60 * 1000);
  },
  getGlobalRiskLayer(): Promise<GlobalRiskLayerResponse> {
    return fetchJson<GlobalRiskLayerResponse>(endpoint("/api/overlay/global_risk"), 3 * 60 * 60 * 1000);
  },
  getGlobalLiquidityMap(): Promise<GlobalLiquidityMapResponse> {
    return fetchJson<GlobalLiquidityMapResponse>(endpoint("/api/overlay/global_liquidity"), 60 * 60 * 1000);
  },
  getShippingDisruptions(): Promise<ShippingDisruptionsResponse> {
    return fetchJson<ShippingDisruptionsResponse>(endpoint("/api/overlay/shipping_disruptions"), 10 * 60 * 1000);
  },
  getCommodityStressMap(): Promise<CommodityStressMapResponse> {
    return fetchJson<CommodityStressMapResponse>(endpoint("/api/overlay/commodity_stress"), 2 * 60 * 60 * 1000);
  },
  getAssetRegions(assetId: string): Promise<AssetRegionHighlightResponse> {
    const safe = encodeURIComponent(String(assetId || "").trim().toLowerCase());
    return fetchJson<AssetRegionHighlightResponse>(endpoint(`/api/overlay/asset_regions/${safe}`), 30 * 60 * 1000);
  },
  getDiagnostics(): Promise<DiagnosticsResponse> {
    return fetchJson<DiagnosticsResponse>(endpoint("/api/diagnostics"), 60 * 1000);
  },
  getTrackRecord(): Promise<TrackRecordResponse> {
    return fetchJson<TrackRecordResponse>(endpoint("/api/track-record/trades"), 5 * 60 * 1000);
  },
};
