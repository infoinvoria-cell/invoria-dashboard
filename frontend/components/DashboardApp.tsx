"use client";

import { lazy, useCallback, useEffect, useMemo, useRef, useState, Suspense } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { GlobeCanvas } from "./globe/GlobeCanvas";
import { KpiGrid } from "./globe/KpiGrid";
import { MacroFundamentalsPanel } from "./globe/MacroFundamentalsPanel";
import { MiniWorldMap } from "./globe/MiniWorldMap";
import { NewsColumns } from "./globe/NewsColumns";
import { SettingsPanel } from "./globe/SettingsPanel";
import { AssetHeatmapPanel } from "./globe/AssetHeatmapPanel";
import { SignalDetailPanel } from "./globe/SignalDetailPanel";
import { GlobeApi, subscribeApiLoading } from "../lib/api";
import { iconUrlForAsset } from "../lib/icons";
import { buildDisplayMarkers } from "../lib/markers";
import { normalizedSeasonalityCurve } from "../lib/seasonality";
import { DEFAULT_GLOBE_STATE, hasPersistedGlobeState, loadInitialGlobeState, persistGlobeState } from "../lib/state";
import type {
  AssetRegionHighlightResponse,
  AssetSignalDetailResponse,
  AssetItem,
  CommodityRegionItem,
  CrossPairPath,
  EvaluationResponse,
  GeoEventItem,
  GlobalLiquidityRegionItem,
  GlobalRiskRegionItem,
  MarkerPoint,
  NewsItem,
  OverlayMode,
  OverlayRouteItem,
  OverlayToggleState,
  PolicyRateCountryEntry,
  SeasonalityResponse,
  ShipTrackingItem,
  TimeseriesResponse,
} from "../types";

const CandleChart = lazy(() => import("./globe/charts/CandleChart"));
const EvaluationChart = lazy(() => import("./globe/charts/EvaluationChart"));
const GlobeSeasonalityChart = lazy(() => import("./globe/charts/GlobeSeasonalityChart"));
const ASSET_USAGE_STORAGE_KEY = "ivq_globe_asset_usage_v1";
const DATA_SOURCE_STORAGE_KEY = "ivq_globe_data_source_v2";
const GOLD_THEME_STORAGE_KEY = "ivq_globe_gold_theme_v1";
const GOLD_PRIMARY = "#d6b24a";
const ALLOWED_OVERLAYS: OverlayMode[] = [
  "none",
  "geo_events",
  "news_geo",
  "conflicts",
  "wildfires",
  "earthquakes",
  "ship_tracking",
  "oil_routes",
  "container_traffic",
  "commodity_regions",
  "global_risk_layer",
  "global_liquidity_map",
  "shipping_disruptions",
  "commodity_stress_map",
  "regional_asset_highlight",
];
const OVERLAY_CACHE_MS: Record<keyof OverlayToggleState, number> = {
  assets: 12 * 60 * 60 * 1000,
  earthquakes: 10 * 60 * 1000,
  conflicts: 60 * 60 * 1000,
  wildfires: 30 * 60 * 1000,
  shipTracking: 5 * 60 * 1000,
  oilRoutes: 3 * 60 * 60 * 1000,
  containerTraffic: 3 * 60 * 60 * 1000,
  commodityRegions: 24 * 60 * 60 * 1000,
  globalRiskLayer: 3 * 60 * 60 * 1000,
  globalLiquidityMap: 60 * 60 * 1000,
  shippingDisruptions: 10 * 60 * 1000,
  commodityStressMap: 2 * 60 * 60 * 1000,
  regionalAssetHighlight: 2 * 60 * 60 * 1000,
};
const MARKET_CACHE_MS = 40 * 60 * 1000;
const NEWS_CACHE_MS = 10 * 60 * 1000;
const VALUATION_CACHE_MS = 40 * 60 * 1000;
const SEASONALITY_CACHE_MS = 10 * 365 * 24 * 60 * 60 * 1000;
const SHELL_REFRESH_MS = 40 * 60 * 1000;
const CHART_REFRESH_MS = 5 * 60 * 1000;
const GLOBE_MARKER_UPDATE_MS = 30 * 1000;
const GLOBE_TIMER_TICK_MS = 30 * 1000;
const OVERLAY_ACTIVATION_PRIORITY: Array<keyof OverlayToggleState> = [
  "globalLiquidityMap",
  "globalRiskLayer",
  "shippingDisruptions",
  "commodityStressMap",
  "regionalAssetHighlight",
  "shipTracking",
  "oilRoutes",
  "containerTraffic",
  "commodityRegions",
  "earthquakes",
  "conflicts",
  "wildfires",
];

type DeferredSections = {
  news: boolean;
  valuation: boolean;
  seasonality: boolean;
  heatmap: boolean;
  macro: boolean;
};
const DEFAULT_OVERLAY_STATE: OverlayToggleState = {
  assets: true,
  earthquakes: false,
  conflicts: false,
  wildfires: false,
  shipTracking: false,
  oilRoutes: false,
  containerTraffic: false,
  commodityRegions: false,
  globalRiskLayer: false,
  globalLiquidityMap: false,
  shippingDisruptions: false,
  commodityStressMap: false,
  regionalAssetHighlight: false,
};
const OVERLAY_LOADING_KEYS: Array<keyof OverlayToggleState> = [
  "assets",
  "earthquakes",
  "conflicts",
  "wildfires",
  "shipTracking",
  "oilRoutes",
  "containerTraffic",
  "commodityRegions",
  "globalRiskLayer",
  "globalLiquidityMap",
  "shippingDisruptions",
  "commodityStressMap",
  "regionalAssetHighlight",
];
const OVERLAY_LOADING_LABELS: Record<keyof OverlayToggleState, string> = {
  assets: "Loading assets overlay...",
  earthquakes: "Loading earthquakes...",
  conflicts: "Loading conflicts...",
  wildfires: "Loading wildfires...",
  shipTracking: "Loading ship tracking...",
  oilRoutes: "Loading oil routes...",
  containerTraffic: "Loading container traffic...",
  commodityRegions: "Loading commodity regions...",
  globalRiskLayer: "Loading risk layer...",
  globalLiquidityMap: "Loading liquidity map...",
  shippingDisruptions: "Loading shipping disruptions...",
  commodityStressMap: "Loading commodity stress map...",
  regionalAssetHighlight: "Loading regional highlight...",
};

function defaultEnabledIds(assets: AssetItem[]): string[] {
  return assets
    .filter((a) => a.category !== "Cross Pairs" && a.showOnGlobe !== false && a.defaultEnabled !== false)
    .map((a) => a.id);
}

function normalizeEnabledIds(ids: string[], assets: AssetItem[], hasPersisted: boolean): string[] {
  if (!assets.length) return [];
  const valid = new Set(assets.map((a) => a.id));
  const filtered = ids.filter((id) => valid.has(id));
  if (filtered.length) return filtered;
  const defaults = defaultEnabledIds(assets);
  if (defaults.length) return defaults;
  if (hasPersisted && !filtered.length) return defaults;
  return defaults;
}

type SharedTimeRange = {
  visibleSpan: number;
  rightOffset: number;
};
type GlobeRotateMode = "off" | "slow" | "normal";
type DataSource = "tradingview" | "dukascopy" | "yahoo";
type RecentSignal = {
  direction: "bullish" | "bearish";
  lines: string[];
  ageBars: number;
} | null;

function clampNum(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Number(v)));
}

function finiteOr(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function currentUtcDayOfYear(): number {
  const now = new Date();
  const start = Date.UTC(now.getUTCFullYear(), 0, 1);
  const current = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((current - start) / 86_400_000) + 1;
}

function formatSeasonDay(day: number): string {
  const base = new Date(Date.UTC(2024, 0, 1));
  base.setUTCDate(Math.max(1, Math.min(366, Math.round(day))));
  return base.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = String(hex || "").replace("#", "");
  const norm = clean.length === 3
    ? clean.split("").map((c) => `${c}${c}`).join("")
    : clean.padEnd(6, "0").slice(0, 6);
  const r = parseInt(norm.slice(0, 2), 16);
  const g = parseInt(norm.slice(2, 4), 16);
  const b = parseInt(norm.slice(4, 6), 16);
  return [Number.isFinite(r) ? r : 0, Number.isFinite(g) ? g : 0, Number.isFinite(b) ? b : 0];
}

function mixHex(a: string, b: string, t: number): string {
  const x = clampNum(t, 0, 1);
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const r = Math.round(ar + (br - ar) * x);
  const g = Math.round(ag + (bg - ag) * x);
  const bch = Math.round(ab + (bb - ab) * x);
  return `rgb(${r}, ${g}, ${bch})`;
}

function buildMiniSparkPaths(values: number[]): { line: string; area: string } {
  const clean = values.filter((value) => Number.isFinite(value));
  if (clean.length < 2) return { line: "", area: "" };

  const width = 100;
  const height = 28;
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const range = Math.max(1e-6, max - min);
  const points = clean.map((value, index) => {
    const x = (index / Math.max(1, clean.length - 1)) * width;
    const y = height - ((value - min) / range) * height;
    return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
  });
  const line = points.join(" ");
  return {
    line,
    area: `${line} L${width} ${height} L0 ${height} Z`,
  };
}

function isStale(ts: number | null | undefined, ttlMs: number): boolean {
  if (!Number.isFinite(Number(ts))) return true;
  return Date.now() - Number(ts) > ttlMs;
}

function mapOverlayKeyToMode(key: keyof OverlayToggleState): OverlayMode {
  if (key === "earthquakes") return "earthquakes";
  if (key === "conflicts") return "conflicts";
  if (key === "wildfires") return "wildfires";
  if (key === "shipTracking") return "ship_tracking";
  if (key === "oilRoutes") return "oil_routes";
  if (key === "containerTraffic") return "container_traffic";
  if (key === "commodityRegions") return "commodity_regions";
  if (key === "globalRiskLayer") return "global_risk_layer";
  if (key === "globalLiquidityMap") return "global_liquidity_map";
  if (key === "shippingDisruptions") return "shipping_disruptions";
  if (key === "commodityStressMap") return "commodity_stress_map";
  if (key === "regionalAssetHighlight") return "regional_asset_highlight";
  return "none";
}

function overlayCacheMs(key: keyof OverlayToggleState): number {
  return OVERLAY_CACHE_MS[key] ?? (30 * 60 * 1000);
}

export default function App() {
  const initialPersisted = useMemo(loadInitialGlobeState, []);
  const hasPersisted = useMemo(hasPersistedGlobeState, []);
  const isEmbedded = useMemo(() => {
    if (typeof window === "undefined") return true;
    try {
      const params = new URLSearchParams(window.location.search || "");
      return params.get("embedded") === "1";
    } catch (_err) {
      return true;
    }
  }, []);
  const defaultsAppliedRef = useRef(false);
  const initialOverlay = useMemo<OverlayMode>(() => {
    const candidate = initialPersisted.selectedOverlay;
    return ALLOWED_OVERLAYS.includes(candidate) ? candidate : "none";
  }, [initialPersisted.selectedOverlay]);
  const initialOverlayState = useMemo<OverlayToggleState>(() => {
    const base = { ...DEFAULT_OVERLAY_STATE };
    if (initialOverlay === "conflicts") base.conflicts = true;
    if (initialOverlay === "wildfires") base.wildfires = true;
    if (initialOverlay === "earthquakes") base.earthquakes = true;
    if (initialOverlay === "ship_tracking") base.shipTracking = true;
    if (initialOverlay === "oil_routes") base.oilRoutes = true;
    if (initialOverlay === "container_traffic") base.containerTraffic = true;
    if (initialOverlay === "commodity_regions") base.commodityRegions = true;
    if (initialOverlay === "global_risk_layer") base.globalRiskLayer = true;
    if (initialOverlay === "global_liquidity_map") base.globalLiquidityMap = true;
    if (initialOverlay === "shipping_disruptions") base.shippingDisruptions = true;
    if (initialOverlay === "commodity_stress_map") base.commodityStressMap = true;
    if (initialOverlay === "regional_asset_highlight") base.regionalAssetHighlight = true;
    return base;
  }, [initialOverlay]);

  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [globalNews, setGlobalNews] = useState<NewsItem[]>([]);
  const [assetNews, setAssetNews] = useState<NewsItem[]>([]);

  const [selectedAssetId, setSelectedAssetId] = useState(initialPersisted.selectedAssetId || "");
  const [focusAssetId, setFocusAssetId] = useState<string | null>(null);
  const [focusLocation, setFocusLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [sharedTimeRange, setSharedTimeRange] = useState<SharedTimeRange | null>(null);
  const [enabledAssets, setEnabledAssets] = useState<string[]>(initialPersisted.enabledAssets ?? []);
  const [overlayState, setOverlayState] = useState<OverlayToggleState>(initialOverlayState);
  const [selectedOverlay, setSelectedOverlay] = useState<OverlayMode>(initialOverlay);
  const [camera, setCamera] = useState(initialPersisted.camera ?? DEFAULT_GLOBE_STATE.camera);
  const [markerZoomLevel, setMarkerZoomLevel] = useState<number>(() => {
    const altitude = Number(initialPersisted.camera?.altitude ?? DEFAULT_GLOBE_STATE.camera.altitude ?? 1.8);
    return Math.round(altitude * 3) / 3;
  });
  const markerAltitudeRef = useRef<number>(Number(initialPersisted.camera?.altitude ?? DEFAULT_GLOBE_STATE.camera.altitude ?? 1.8));
  const [globeRotateMode, setGlobeRotateMode] = useState<GlobeRotateMode>("off");
  const [visualLoopEnabled, setVisualLoopEnabled] = useState(false);
  const [visualLoopTick, setVisualLoopTick] = useState(0);
  const [dataSource, setDataSource] = useState<DataSource>(() => {
    if (typeof window === "undefined") return "tradingview";
    try {
      const raw = (window.localStorage.getItem(DATA_SOURCE_STORAGE_KEY) ?? "").trim().toLowerCase();
      if (raw === "tradingview" || raw === "yahoo" || raw === "dukascopy") {
        return raw;
      }
    } catch (_err) {
      // no-op
    }
    return "tradingview";
  });
  const [goldThemeEnabled, setGoldThemeEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      const params = new URLSearchParams(window.location.search || "");
      const qpTheme = String(params.get("theme") || "").trim().toLowerCase();
      if (qpTheme === "black" || qpTheme === "gold") return true;
      if (qpTheme === "blue") return false;
    } catch (_err) {
      // no-op
    }
    try {
      return window.localStorage.getItem(GOLD_THEME_STORAGE_KEY) === "1";
    } catch (_err) {
      return false;
    }
  });
  const [categoryEnabled, setCategoryEnabled] = useState<Record<string, boolean>>({});

  const [timeseries, setTimeseries] = useState<TimeseriesResponse | null>(null);
  const [evaluation, setEvaluation] = useState<EvaluationResponse | null>(null);
  const [seasonality, setSeasonality] = useState<SeasonalityResponse | null>(null);
  const [signalDetail, setSignalDetail] = useState<AssetSignalDetailResponse | null>(null);
  const [geoEvents, setGeoEvents] = useState<GeoEventItem[]>([]);
  const [conflictEvents, setConflictEvents] = useState<GeoEventItem[]>([]);
  const [wildfireEvents, setWildfireEvents] = useState<GeoEventItem[]>([]);
  const [earthquakeEvents, setEarthquakeEvents] = useState<GeoEventItem[]>([]);
  const [shipTracking, setShipTracking] = useState<ShipTrackingItem[]>([]);
  const [oilRoutes, setOilRoutes] = useState<OverlayRouteItem[]>([]);
  const [containerRoutes, setContainerRoutes] = useState<OverlayRouteItem[]>([]);
  const [commodityRegions, setCommodityRegions] = useState<CommodityRegionItem[]>([]);
  const [globalRiskRegions, setGlobalRiskRegions] = useState<GlobalRiskRegionItem[]>([]);
  const [globalLiquidityRegions, setGlobalLiquidityRegions] = useState<GlobalLiquidityRegionItem[]>([]);
  const [shippingDisruptionEvents, setShippingDisruptionEvents] = useState<GeoEventItem[]>([]);
  const [shippingDisruptionRoutes, setShippingDisruptionRoutes] = useState<OverlayRouteItem[]>([]);
  const [commodityStressRegions, setCommodityStressRegions] = useState<CommodityRegionItem[]>([]);
  const [regionHighlight, setRegionHighlight] = useState<AssetRegionHighlightResponse | null>(null);
  const [recentSignal, setRecentSignal] = useState<RecentSignal>(null);
  const [deferredSections, setDeferredSections] = useState<DeferredSections>({
    news: true,
    valuation: true,
    seasonality: true,
    heatmap: false,
    macro: true,
  });
  const sharedTimeRangeRef = useRef<SharedTimeRange | null>(null);
  const panelCacheRef = useRef<Record<string, {
    timeseries: TimeseriesResponse | null;
    evaluation: EvaluationResponse | null;
    seasonality: SeasonalityResponse | null;
    assetNews: NewsItem[];
    signalDetail: AssetSignalDetailResponse | null;
    timeseriesUpdatedAt: number;
    evaluationUpdatedAt: number;
    seasonalityUpdatedAt: number;
    assetNewsUpdatedAt: number;
    signalDetailUpdatedAt: number;
  }>>({});
  const globalNewsCacheRef = useRef<{ items: NewsItem[]; updatedAt: number } | null>(null);
  const overlayLastUpdatedAtRef = useRef<Record<string, number>>({});
  const overlayLoadingCountRef = useRef<Record<string, number>>({});
  const assetRegionCacheRef = useRef<Record<string, { updatedAt: number; payload: AssetRegionHighlightResponse }>>({});
  const panelRequestTokenRef = useRef(0);
  const shellLastUpdatedRef = useRef<{ assets: number }>({ assets: 0 });

  const [shellLoading, setShellLoading] = useState(true);
  const [panelLoading, setPanelLoading] = useState(false);
  const [apiLoading, setApiLoading] = useState<{ active: boolean; count: number; labels: string[] }>({
    active: false,
    count: 0,
    labels: [],
  });
  const [overlayLoadingState, setOverlayLoadingState] = useState<Partial<Record<keyof OverlayToggleState, boolean>>>({});
  const [isGlobeFullscreen, setIsGlobeFullscreen] = useState(false);
  const [isChartStackFullscreen, setIsChartStackFullscreen] = useState(false);
  const globeShellRef = useRef<HTMLDivElement | null>(null);
  const [assetUsage, setAssetUsage] = useState<Record<string, number>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const raw = window.localStorage.getItem(ASSET_USAGE_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      if (parsed && typeof parsed === "object") return parsed as Record<string, number>;
    } catch (_err) {
      // no-op
    }
    return {};
  });

  const markAssetUsage = useCallback((assetId: string) => {
    const key = String(assetId || "").trim().toLowerCase();
    if (!key) return;
    setAssetUsage((prev) => {
      const next = { ...prev, [key]: Number(prev[key] ?? 0) + 1 };
      try {
        window.localStorage.setItem(ASSET_USAGE_STORAGE_KEY, JSON.stringify(next));
      } catch (_err) {
        // no-op
      }
      return next;
    });
  }, []);

  const beginOverlayLoad = useCallback((key: keyof OverlayToggleState) => {
    const name = String(key);
    const current = Number(overlayLoadingCountRef.current[name] ?? 0);
    overlayLoadingCountRef.current[name] = current + 1;
    if (current === 0) {
      setOverlayLoadingState((prev) => ({ ...prev, [key]: true }));
    }
  }, []);

  const endOverlayLoad = useCallback((key: keyof OverlayToggleState) => {
    const name = String(key);
    const current = Number(overlayLoadingCountRef.current[name] ?? 0);
    const nextCount = Math.max(0, current - 1);
    overlayLoadingCountRef.current[name] = nextCount;
    if (nextCount === 0) {
      setOverlayLoadingState((prev) => ({ ...prev, [key]: false }));
    }
  }, []);

  const withOverlayLoad = useCallback(
    (key: keyof OverlayToggleState, job: Promise<void>): Promise<void> => {
      beginOverlayLoad(key);
      return job.finally(() => {
        endOverlayLoad(key);
      });
    },
    [beginOverlayLoad, endOverlayLoad],
  );

  const activateSection = useCallback((key: keyof DeferredSections) => {
    setDeferredSections((prev) => (prev[key] ? prev : { ...prev, [key]: true }));
  }, []);

  const refreshShellData = (setLoading = false) => {
    if (setLoading) setShellLoading(true);
    return Promise.allSettled([GlobeApi.getAssets()])
      .then(([assetsRes]) => {
        if (assetsRes.status === "fulfilled") {
          setAssets(assetsRes.value.items ?? []);
          shellLastUpdatedRef.current.assets = Date.now();
          return;
        }
        // eslint-disable-next-line no-console
        console.error("Assets load failed:", assetsRes.reason);
      })
      .finally(() => {
        if (setLoading) setShellLoading(false);
      });
  };

  const loadGlobalNews = (force = false) => {
    const cached = globalNewsCacheRef.current;
    if (!force && cached && !isStale(cached.updatedAt, NEWS_CACHE_MS)) {
      setGlobalNews(cached.items);
      return Promise.resolve();
    }
    return GlobeApi.getGlobalNews()
      .then((res) => {
        const items = res.items ?? [];
        setGlobalNews(items);
        globalNewsCacheRef.current = {
          items,
          updatedAt: Date.now(),
        };
      })
      .catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.error("Global news load failed:", err);
      });
  };

  type PanelLoadFlags = {
    force?: boolean;
    forceTimeseriesRefresh?: boolean;
    includeEvaluation?: boolean;
    includeSeasonality?: boolean;
    includeAssetNews?: boolean;
    includeSignalDetail?: boolean;
  };

  const loadPanelData = (assetId: string, source: DataSource, flags: PanelLoadFlags = {}) => {
    const safeAssetId = String(assetId || "").trim();
    if (!safeAssetId) return Promise.resolve();
    const cacheKey = `${source}:${safeAssetId.toLowerCase()}`;
    const cached = panelCacheRef.current[cacheKey];
    const force = Boolean(flags.force);
    const includeEvaluation = Boolean(flags.includeEvaluation);
    const includeSeasonality = Boolean(flags.includeSeasonality);
    const includeAssetNews = Boolean(flags.includeAssetNews);
    const includeSignalDetail = Boolean(flags.includeSignalDetail);
    const forceTimeseriesRefresh = Boolean(flags.forceTimeseriesRefresh);

    const timeseriesStale = force || forceTimeseriesRefresh || !cached || !cached.timeseries || isStale(cached.timeseriesUpdatedAt, CHART_REFRESH_MS);
    const evaluationStale = includeEvaluation && (force || !cached || !cached.evaluation || isStale(cached.evaluationUpdatedAt, VALUATION_CACHE_MS));
    const seasonalityStale = includeSeasonality && (force || !cached || !cached.seasonality || isStale(cached.seasonalityUpdatedAt, SEASONALITY_CACHE_MS));
    const assetNewsStale = includeAssetNews && (force || !cached || !cached.assetNews?.length || isStale(cached.assetNewsUpdatedAt, NEWS_CACHE_MS));
    const signalDetailStale = includeSignalDetail && (force || !cached || !cached.signalDetail || isStale(cached.signalDetailUpdatedAt, VALUATION_CACHE_MS));

    if (!timeseriesStale && !evaluationStale && !seasonalityStale && !assetNewsStale && !signalDetailStale) {
      if (cached) {
        setTimeseries(cached.timeseries ?? null);
        if (includeEvaluation) setEvaluation(cached.evaluation ?? null);
        if (includeSeasonality) setSeasonality(cached.seasonality ?? null);
        if (includeAssetNews) setAssetNews(cached.assetNews ?? []);
        if (includeSignalDetail) setSignalDetail(cached.signalDetail ?? null);
      }
      return Promise.resolve();
    }

    const selectedMeta = assets.find((a) => a.id === safeAssetId);
    const shouldLoadSignalDetail = includeSignalDetail && selectedMeta?.category !== "Cross Pairs";
    const token = panelRequestTokenRef.current + 1;
    panelRequestTokenRef.current = token;
    const hasPanelWork = timeseriesStale || evaluationStale || seasonalityStale || signalDetailStale;
    if (hasPanelWork) setPanelLoading(true);
    const refreshBucket = forceTimeseriesRefresh ? Math.floor(Date.now() / CHART_REFRESH_MS) : undefined;

    return Promise.allSettled([
      timeseriesStale
        ? GlobeApi.getTimeseries(safeAssetId, "D", source, "regular", refreshBucket)
        : Promise.resolve(cached?.timeseries ?? null),
      evaluationStale
        ? GlobeApi.getEvaluation(safeAssetId, source)
        : Promise.resolve(cached?.evaluation ?? null),
      seasonalityStale
        ? GlobeApi.getSeasonality(safeAssetId, source)
        : Promise.resolve(cached?.seasonality ?? null),
      assetNewsStale
        ? GlobeApi.getAssetNews(safeAssetId)
        : Promise.resolve({ items: cached?.assetNews ?? [] }),
      shouldLoadSignalDetail && signalDetailStale
        ? GlobeApi.getAssetSignalDetail(safeAssetId, source)
        : Promise.resolve(cached?.signalDetail ?? null),
    ])
      .then(([tsRes, evalRes, seasRes, newsRes, signalRes]) => {
        if (token !== panelRequestTokenRef.current) return;

        const nextTimeseries =
          tsRes.status === "fulfilled"
            ? tsRes.value
            : (cached?.timeseries ?? null);
        const nextEvaluation =
          evalRes.status === "fulfilled"
            ? evalRes.value
            : (cached?.evaluation ?? null);
        const nextSeasonality =
          seasRes.status === "fulfilled"
            ? seasRes.value
            : (cached?.seasonality ?? null);
        const nextAssetNews =
          newsRes.status === "fulfilled"
            ? (newsRes.value.items ?? [])
            : (cached?.assetNews ?? []);
        const nextSignalDetail =
          signalRes.status === "fulfilled" && signalRes.value
            ? signalRes.value
            : (cached?.signalDetail ?? null);

        if (timeseriesStale && tsRes.status === "rejected") {
          // eslint-disable-next-line no-console
          console.error("Timeseries load failed:", tsRes.reason);
        }
        if (evaluationStale && evalRes.status === "rejected") {
          // eslint-disable-next-line no-console
          console.error("Evaluation load failed:", evalRes.reason);
        }
        if (seasonalityStale && seasRes.status === "rejected") {
          // eslint-disable-next-line no-console
          console.error("Seasonality load failed:", seasRes.reason);
        }
        if (assetNewsStale && newsRes.status === "rejected") {
          // eslint-disable-next-line no-console
          console.error("Asset news load failed:", newsRes.reason);
        }
        if (signalDetailStale && signalRes.status === "rejected" && shouldLoadSignalDetail) {
          // eslint-disable-next-line no-console
          console.error("Asset signal detail load failed:", signalRes.reason);
        }

        setTimeseries(nextTimeseries);
        if (includeEvaluation) setEvaluation(nextEvaluation);
        if (includeSeasonality) setSeasonality(nextSeasonality);
        if (includeAssetNews) setAssetNews(nextAssetNews);
        if (includeSignalDetail) setSignalDetail(nextSignalDetail);

        const now = Date.now();
        panelCacheRef.current[cacheKey] = {
          timeseries: nextTimeseries,
          evaluation: nextEvaluation,
          seasonality: nextSeasonality,
          assetNews: nextAssetNews,
          signalDetail: nextSignalDetail,
          timeseriesUpdatedAt: timeseriesStale ? now : Number(cached?.timeseriesUpdatedAt || 0),
          evaluationUpdatedAt: evaluationStale ? now : Number(cached?.evaluationUpdatedAt || 0),
          seasonalityUpdatedAt: seasonalityStale ? now : Number(cached?.seasonalityUpdatedAt || 0),
          assetNewsUpdatedAt: assetNewsStale ? now : Number(cached?.assetNewsUpdatedAt || 0),
          signalDetailUpdatedAt: signalDetailStale ? now : Number(cached?.signalDetailUpdatedAt || 0),
        };
      })
      .catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.error("Globe panel error:", err);
      })
      .finally(() => {
        if (hasPanelWork && token === panelRequestTokenRef.current) {
          setPanelLoading(false);
        }
      });
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const body = window.document.body;
    const root = window.document.documentElement;
    if (isEmbedded) {
      body.classList.add("ivq-embedded");
      root.classList.add("ivq-embedded");
    } else {
      body.classList.remove("ivq-embedded");
      root.classList.remove("ivq-embedded");
    }
    if (goldThemeEnabled) {
      body.classList.add("ivq-theme-gold");
      root.classList.add("ivq-theme-gold");
    } else {
      body.classList.remove("ivq-theme-gold");
      root.classList.remove("ivq-theme-gold");
    }
    try {
      window.localStorage.setItem(GOLD_THEME_STORAGE_KEY, goldThemeEnabled ? "1" : "0");
    } catch (_err) {
      // no-op
    }
    return () => {
      body.classList.remove("ivq-embedded");
      root.classList.remove("ivq-embedded");
      body.classList.remove("ivq-theme-gold");
      root.classList.remove("ivq-theme-gold");
    };
  }, [goldThemeEnabled, isEmbedded]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onThemeMessage = (event: MessageEvent) => {
      const payload = event?.data as { type?: string; theme?: string; themeCanonical?: string } | null;
      if (!payload || typeof payload !== "object") return;
      if (payload.type !== "invoria-parent-theme") return;
      const canonical = String(payload.themeCanonical || "").toLowerCase();
      const legacy = String(payload.theme || "").toLowerCase();
      const isBlack = canonical === "black" || legacy === "gold" || legacy === "black";
      setGoldThemeEnabled(isBlack);
    };
    const onLocalThemeEvent = (event: Event) => {
      const custom = event as CustomEvent<{ theme?: string; themeCanonical?: string }>;
      const detail = custom?.detail ?? {};
      const canonical = String(detail.themeCanonical || "").toLowerCase();
      const legacy = String(detail.theme || "").toLowerCase();
      const isBlack = canonical === "black" || legacy === "gold" || legacy === "black";
      setGoldThemeEnabled(isBlack);
    };

    window.addEventListener("message", onThemeMessage);
    window.addEventListener("invoria-theme-set", onLocalThemeEvent as EventListener);
    try {
      window.parent?.postMessage({ type: "invoria-theme-request" }, "*");
    } catch (_err) {
      // no-op
    }

    return () => {
      window.removeEventListener("message", onThemeMessage);
      window.removeEventListener("invoria-theme-set", onLocalThemeEvent as EventListener);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let raf = 0;

    const postHeight = () => {
      try {
        const doc = window.document.documentElement;
        const body = window.document.body;
        const height = Math.max(
          Number(doc?.scrollHeight || 0),
          Number(doc?.offsetHeight || 0),
          Number(body?.scrollHeight || 0),
          Number(body?.offsetHeight || 0),
        );
        window.parent?.postMessage({ type: "invoria-globe-height", height }, "*");
      } catch (_err) {
        // no-op
      }
    };

    const schedulePostHeight = () => {
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(postHeight);
    };

    const resizeObserver = new ResizeObserver(schedulePostHeight);
    const mutationObserver = new MutationObserver(schedulePostHeight);
    if (window.document.documentElement) resizeObserver.observe(window.document.documentElement);
    if (window.document.body) {
      resizeObserver.observe(window.document.body);
      mutationObserver.observe(window.document.body, {
        subtree: true,
        childList: true,
        attributes: true,
      });
    }

    const intervalId = window.setInterval(schedulePostHeight, 1200);
    window.addEventListener("resize", schedulePostHeight);
    schedulePostHeight();

    return () => {
      window.cancelAnimationFrame(raf);
      window.clearInterval(intervalId);
      window.removeEventListener("resize", schedulePostHeight);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, []);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsGlobeFullscreen(document.fullscreenElement === globeShellRef.current);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, []);

  const onToggleGlobeFullscreen = () => {
    const node = globeShellRef.current;
    if (!node) return;
    if (document.fullscreenElement === node) {
      document.exitFullscreen().catch(() => {
        // no-op
      });
      return;
    }
    node.requestFullscreen().catch(() => {
      // no-op
    });
  };

  useEffect(() => {
    if (!visualLoopEnabled) return;
    const timer = window.setInterval(() => {
      setVisualLoopTick((v) => v + 1);
    }, 6500);
    return () => {
      window.clearInterval(timer);
    };
  }, [visualLoopEnabled]);

  useEffect(() => {
    if (!isChartStackFullscreen) return undefined;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsChartStackFullscreen(false);
      }
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isChartStackFullscreen]);

  useEffect(() => {
    markerAltitudeRef.current = Number(camera?.altitude ?? 1.8);
  }, [camera?.altitude]);

  useEffect(() => {
    const updateZoom = () => {
      const next = Math.round(Number(markerAltitudeRef.current || 1.8) * 3) / 3;
      setMarkerZoomLevel((prev) => (prev === next ? prev : next));
    };
    updateZoom();
    const timer = window.setInterval(updateZoom, GLOBE_MARKER_UPDATE_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeApiLoading((state) => {
      setApiLoading({
        active: Boolean(state.active),
        count: Math.max(0, Number(state.count || 0)),
        labels: Array.isArray(state.labels) ? state.labels.slice(0, 4) : [],
      });
    });
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    refreshShellData(true).catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error("Globe boot error:", err);
      setShellLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!assets.length) return;
    const defaults = defaultEnabledIds(assets);

    if (!defaultsAppliedRef.current) {
      // Default for first load: all standard assets ON, Cross-Pairs OFF.
      setEnabledAssets(defaults);
      const categories: Record<string, boolean> = {};
      for (const asset of assets) {
        categories[asset.category] = true;
      }
      setCategoryEnabled(categories);
      defaultsAppliedRef.current = true;
    } else {
      setEnabledAssets((prev) => normalizeEnabledIds(prev, assets, hasPersisted));
      setCategoryEnabled((prev) => {
        const next = { ...prev };
        for (const asset of assets) {
          if (next[asset.category] === undefined) {
            next[asset.category] = true;
          }
        }
        return next;
      });
    }

    setSelectedAssetId((prev) => {
      if (prev && assets.some((a) => a.id === prev)) return prev;
      const firstEnabled = normalizeEnabledIds(initialPersisted.enabledAssets ?? [], assets, hasPersisted)[0];
      const fallback = defaults[0] ?? assets.find((a) => a.category !== "Cross Pairs")?.id ?? assets[0]?.id;
      return firstEnabled || fallback || "";
    });
  }, [assets, hasPersisted, initialPersisted.enabledAssets]);

  useEffect(() => {
    if (!enabledAssets.length) return;
    const selected = assets.find((a) => a.id === selectedAssetId);
    if (selectedAssetId && (enabledAssets.includes(selectedAssetId) || selected?.category === "Cross Pairs")) return;
    setSelectedAssetId(enabledAssets[0]);
  }, [assets, enabledAssets, selectedAssetId]);

  useEffect(() => {
    setOverlayLoadingState((prev) => {
      let changed = false;
      const next: Partial<Record<keyof OverlayToggleState, boolean>> = { ...prev };
      for (const key of OVERLAY_LOADING_KEYS) {
        if (!overlayState[key] && prev[key]) {
          changed = true;
          next[key] = false;
          overlayLoadingCountRef.current[String(key)] = 0;
        }
      }
      return changed ? next : prev;
    });
  }, [overlayState]);

  useEffect(() => {
    if (!selectedAssetId) return;
    loadPanelData(selectedAssetId, dataSource, {
      includeEvaluation: deferredSections.valuation,
      includeSeasonality: deferredSections.seasonality,
      includeAssetNews: deferredSections.news,
      includeSignalDetail: deferredSections.valuation,
    });
  }, [dataSource, deferredSections.news, deferredSections.seasonality, deferredSections.valuation, selectedAssetId]);

  useEffect(() => {
    if (!deferredSections.news || !selectedAssetId) return;
    loadGlobalNews(false);
  }, [deferredSections.news, selectedAssetId]);

  useEffect(() => {
    let cancelled = false;
    const jobs: Array<Promise<void>> = [];

    const loadLayer = (
      key: "conflicts" | "wildfires" | "earthquakes",
      setter: (rows: GeoEventItem[]) => void,
    ) => {
      if (!overlayState[key]) return;
      const stampKey = `geo:${key}`;
      if (!isStale(overlayLastUpdatedAtRef.current[stampKey], overlayCacheMs(key))) return;
      jobs.push(
        withOverlayLoad(key, GlobeApi.getGeoEvents(key)
          .then((res) => {
            if (cancelled) return;
            setter(res.items ?? []);
            overlayLastUpdatedAtRef.current[stampKey] = Date.now();
          })
          .catch((err: unknown) => {
            // eslint-disable-next-line no-console
            console.error(`Geo events load failed (${key}):`, err);
          })),
      );
    };

    if (overlayState.shipTracking && isStale(overlayLastUpdatedAtRef.current.ships, overlayCacheMs("shipTracking"))) {
      jobs.push(
        withOverlayLoad("shipTracking", GlobeApi.getShipTracking()
          .then((res) => {
            if (cancelled) return;
            setShipTracking(res.items ?? []);
            overlayLastUpdatedAtRef.current.ships = Date.now();
          })
          .catch((err: unknown) => {
            // eslint-disable-next-line no-console
            console.error("Ship tracking load failed:", err);
          })),
      );
    }

    if (overlayState.oilRoutes && isStale(overlayLastUpdatedAtRef.current.oilRoutes, overlayCacheMs("oilRoutes"))) {
      jobs.push(
        withOverlayLoad("oilRoutes", GlobeApi.getOilRoutes()
          .then((res) => {
            if (cancelled) return;
            setOilRoutes(res.items ?? []);
            overlayLastUpdatedAtRef.current.oilRoutes = Date.now();
          })
          .catch((err: unknown) => {
            // eslint-disable-next-line no-console
            console.error("Oil routes load failed:", err);
          })),
      );
    }

    if (overlayState.containerTraffic && isStale(overlayLastUpdatedAtRef.current.containerRoutes, overlayCacheMs("containerTraffic"))) {
      jobs.push(
        withOverlayLoad("containerTraffic", GlobeApi.getContainerRoutes()
          .then((res) => {
            if (cancelled) return;
            setContainerRoutes(res.items ?? []);
            overlayLastUpdatedAtRef.current.containerRoutes = Date.now();
          })
          .catch((err: unknown) => {
            // eslint-disable-next-line no-console
            console.error("Container routes load failed:", err);
          })),
      );
    }

    if (overlayState.commodityRegions && isStale(overlayLastUpdatedAtRef.current.commodityRegions, overlayCacheMs("commodityRegions"))) {
      jobs.push(
        withOverlayLoad("commodityRegions", GlobeApi.getCommodityRegions()
          .then((res) => {
            if (cancelled) return;
            setCommodityRegions(res.items ?? []);
            overlayLastUpdatedAtRef.current.commodityRegions = Date.now();
          })
          .catch((err: unknown) => {
            // eslint-disable-next-line no-console
            console.error("Commodity regions load failed:", err);
          })),
      );
    }

    if (overlayState.globalRiskLayer && isStale(overlayLastUpdatedAtRef.current.globalRiskLayer, overlayCacheMs("globalRiskLayer"))) {
      jobs.push(
        withOverlayLoad("globalRiskLayer", GlobeApi.getGlobalRiskLayer()
          .then((res) => {
            if (cancelled) return;
            setGlobalRiskRegions(res.regions ?? []);
            overlayLastUpdatedAtRef.current.globalRiskLayer = Date.now();
          })
          .catch((err: unknown) => {
            // eslint-disable-next-line no-console
            console.error("Global risk layer load failed:", err);
          })),
      );
    }

    if (overlayState.globalLiquidityMap && isStale(overlayLastUpdatedAtRef.current.globalLiquidityMap, overlayCacheMs("globalLiquidityMap"))) {
      jobs.push(
        withOverlayLoad("globalLiquidityMap", GlobeApi.getGlobalLiquidityMap()
          .then((res) => {
            if (cancelled) return;
            setGlobalLiquidityRegions(res.regions ?? []);
            overlayLastUpdatedAtRef.current.globalLiquidityMap = Date.now();
          })
          .catch((err: unknown) => {
            // eslint-disable-next-line no-console
            console.error("Global liquidity map load failed:", err);
          })),
      );
    }

    if (overlayState.shippingDisruptions && isStale(overlayLastUpdatedAtRef.current.shippingDisruptions, overlayCacheMs("shippingDisruptions"))) {
      jobs.push(
        withOverlayLoad("shippingDisruptions", GlobeApi.getShippingDisruptions()
          .then((res) => {
            if (cancelled) return;
            setShippingDisruptionEvents(res.items ?? []);
            setShippingDisruptionRoutes(res.routes ?? []);
            overlayLastUpdatedAtRef.current.shippingDisruptions = Date.now();
          })
          .catch((err: unknown) => {
            // eslint-disable-next-line no-console
            console.error("Shipping disruptions load failed:", err);
          })),
      );
    }

    if (overlayState.commodityStressMap && isStale(overlayLastUpdatedAtRef.current.commodityStressMap, overlayCacheMs("commodityStressMap"))) {
      jobs.push(
        withOverlayLoad("commodityStressMap", GlobeApi.getCommodityStressMap()
          .then((res) => {
            if (cancelled) return;
            setCommodityStressRegions((res.items ?? []).map((row) => ({ ...row })));
            overlayLastUpdatedAtRef.current.commodityStressMap = Date.now();
          })
          .catch((err: unknown) => {
            // eslint-disable-next-line no-console
            console.error("Commodity stress map load failed:", err);
          })),
      );
    }

    if (overlayState.regionalAssetHighlight && selectedAssetId) {
      const assetKey = String(selectedAssetId || "").trim().toLowerCase();
      const stampKey = `assetRegion:${assetKey}`;
      const cached = assetRegionCacheRef.current[assetKey];
      if (cached && !isStale(cached.updatedAt, overlayCacheMs("regionalAssetHighlight"))) {
        setRegionHighlight(cached.payload);
        overlayLastUpdatedAtRef.current[stampKey] = cached.updatedAt;
      } else if (isStale(overlayLastUpdatedAtRef.current[stampKey], overlayCacheMs("regionalAssetHighlight"))) {
        setRegionHighlight(null);
        jobs.push(
          withOverlayLoad("regionalAssetHighlight", GlobeApi.getAssetRegions(assetKey)
            .then((res) => {
              if (cancelled) return;
              const now = Date.now();
              setRegionHighlight(res);
              assetRegionCacheRef.current[assetKey] = { payload: res, updatedAt: now };
              overlayLastUpdatedAtRef.current[stampKey] = now;
            })
            .catch((err: unknown) => {
              // eslint-disable-next-line no-console
              console.error("Asset region highlight load failed:", err);
            })),
        );
      }
    }

    loadLayer("conflicts", setConflictEvents);
    loadLayer("wildfires", setWildfireEvents);
    loadLayer("earthquakes", setEarthquakeEvents);

    if (jobs.length) {
      Promise.allSettled(jobs).catch(() => {
        // no-op
      });
    }

    return () => {
      cancelled = true;
    };
  }, [
    overlayState.commodityStressMap,
    overlayState.commodityRegions,
    overlayState.conflicts,
    overlayState.containerTraffic,
    overlayState.earthquakes,
    overlayState.globalLiquidityMap,
    overlayState.globalRiskLayer,
    overlayState.oilRoutes,
    overlayState.regionalAssetHighlight,
    overlayState.shipTracking,
    overlayState.shippingDisruptions,
    overlayState.wildfires,
    selectedAssetId,
    withOverlayLoad,
  ]);

  useEffect(() => {
    const merged: GeoEventItem[] = [];
    if (overlayState.conflicts) merged.push(...conflictEvents);
    if (overlayState.wildfires) merged.push(...wildfireEvents);
    if (overlayState.earthquakes) merged.push(...earthquakeEvents);
    if (overlayState.shippingDisruptions) merged.push(...shippingDisruptionEvents);
    setGeoEvents(merged);
  }, [
    conflictEvents,
    earthquakeEvents,
    overlayState.conflicts,
    overlayState.earthquakes,
    overlayState.shippingDisruptions,
    overlayState.wildfires,
    shippingDisruptionEvents,
    wildfireEvents,
  ]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const shellStamp = shellLastUpdatedRef.current.assets || 0;
      if (isStale(shellStamp, SHELL_REFRESH_MS)) {
        refreshShellData(false).catch(() => {
          // no-op
        });
      }

      if (selectedAssetId) {
        const key = `${dataSource}:${selectedAssetId.toLowerCase()}`;
        const cached = panelCacheRef.current[key];
        const tsStamp = Number(cached?.timeseriesUpdatedAt || 0);
        if (isStale(tsStamp, CHART_REFRESH_MS)) {
          loadPanelData(selectedAssetId, dataSource, {
            forceTimeseriesRefresh: true,
            includeEvaluation: deferredSections.valuation,
            includeSeasonality: deferredSections.seasonality,
            includeAssetNews: deferredSections.news,
            includeSignalDetail: deferredSections.valuation,
          });
        } else {
          if (deferredSections.valuation && isStale(Number(cached?.evaluationUpdatedAt || 0), VALUATION_CACHE_MS)) {
            loadPanelData(selectedAssetId, dataSource, {
              includeEvaluation: true,
              includeSignalDetail: true,
            });
          }
          if (deferredSections.news && isStale(Number(cached?.assetNewsUpdatedAt || 0), NEWS_CACHE_MS)) {
            loadPanelData(selectedAssetId, dataSource, {
              includeAssetNews: true,
            });
          }
        }
      }

      if (deferredSections.news && isStale(globalNewsCacheRef.current?.updatedAt, NEWS_CACHE_MS)) {
        loadGlobalNews(false);
      }

      if (overlayState.conflicts && isStale(overlayLastUpdatedAtRef.current["geo:conflicts"], overlayCacheMs("conflicts"))) {
        withOverlayLoad("conflicts", GlobeApi.getGeoEvents("conflicts")
          .then((res) => {
            setConflictEvents(res.items ?? []);
            overlayLastUpdatedAtRef.current["geo:conflicts"] = Date.now();
          }))
          .catch(() => {
            // no-op
          });
      }
      if (overlayState.wildfires && isStale(overlayLastUpdatedAtRef.current["geo:wildfires"], overlayCacheMs("wildfires"))) {
        withOverlayLoad("wildfires", GlobeApi.getGeoEvents("wildfires")
          .then((res) => {
            setWildfireEvents(res.items ?? []);
            overlayLastUpdatedAtRef.current["geo:wildfires"] = Date.now();
          }))
          .catch(() => {
            // no-op
          });
      }
      if (overlayState.earthquakes && isStale(overlayLastUpdatedAtRef.current["geo:earthquakes"], overlayCacheMs("earthquakes"))) {
        withOverlayLoad("earthquakes", GlobeApi.getGeoEvents("earthquakes")
          .then((res) => {
            setEarthquakeEvents(res.items ?? []);
            overlayLastUpdatedAtRef.current["geo:earthquakes"] = Date.now();
          }))
          .catch(() => {
            // no-op
          });
      }
      if (overlayState.shipTracking && isStale(overlayLastUpdatedAtRef.current.ships, overlayCacheMs("shipTracking"))) {
        withOverlayLoad("shipTracking", GlobeApi.getShipTracking()
          .then((res) => {
            setShipTracking(res.items ?? []);
            overlayLastUpdatedAtRef.current.ships = Date.now();
          }))
          .catch(() => {
            // no-op
          });
      }
      if (overlayState.oilRoutes && isStale(overlayLastUpdatedAtRef.current.oilRoutes, overlayCacheMs("oilRoutes"))) {
        withOverlayLoad("oilRoutes", GlobeApi.getOilRoutes()
          .then((res) => {
            setOilRoutes(res.items ?? []);
            overlayLastUpdatedAtRef.current.oilRoutes = Date.now();
          }))
          .catch(() => {
            // no-op
          });
      }
      if (overlayState.containerTraffic && isStale(overlayLastUpdatedAtRef.current.containerRoutes, overlayCacheMs("containerTraffic"))) {
        withOverlayLoad("containerTraffic", GlobeApi.getContainerRoutes()
          .then((res) => {
            setContainerRoutes(res.items ?? []);
            overlayLastUpdatedAtRef.current.containerRoutes = Date.now();
          }))
          .catch(() => {
            // no-op
          });
      }
      if (overlayState.commodityRegions && isStale(overlayLastUpdatedAtRef.current.commodityRegions, overlayCacheMs("commodityRegions"))) {
        withOverlayLoad("commodityRegions", GlobeApi.getCommodityRegions()
          .then((res) => {
            setCommodityRegions(res.items ?? []);
            overlayLastUpdatedAtRef.current.commodityRegions = Date.now();
          }))
          .catch(() => {
            // no-op
          });
      }
      if (overlayState.globalRiskLayer && isStale(overlayLastUpdatedAtRef.current.globalRiskLayer, overlayCacheMs("globalRiskLayer"))) {
        withOverlayLoad("globalRiskLayer", GlobeApi.getGlobalRiskLayer()
          .then((res) => {
            setGlobalRiskRegions(res.regions ?? []);
            overlayLastUpdatedAtRef.current.globalRiskLayer = Date.now();
          }))
          .catch(() => {
            // no-op
          });
      }
      if (overlayState.globalLiquidityMap && isStale(overlayLastUpdatedAtRef.current.globalLiquidityMap, overlayCacheMs("globalLiquidityMap"))) {
        withOverlayLoad("globalLiquidityMap", GlobeApi.getGlobalLiquidityMap()
          .then((res) => {
            setGlobalLiquidityRegions(res.regions ?? []);
            overlayLastUpdatedAtRef.current.globalLiquidityMap = Date.now();
          }))
          .catch(() => {
            // no-op
          });
      }
      if (overlayState.shippingDisruptions && isStale(overlayLastUpdatedAtRef.current.shippingDisruptions, overlayCacheMs("shippingDisruptions"))) {
        withOverlayLoad("shippingDisruptions", GlobeApi.getShippingDisruptions()
          .then((res) => {
            setShippingDisruptionEvents(res.items ?? []);
            setShippingDisruptionRoutes(res.routes ?? []);
            overlayLastUpdatedAtRef.current.shippingDisruptions = Date.now();
          }))
          .catch(() => {
            // no-op
          });
      }
      if (overlayState.commodityStressMap && isStale(overlayLastUpdatedAtRef.current.commodityStressMap, overlayCacheMs("commodityStressMap"))) {
        withOverlayLoad("commodityStressMap", GlobeApi.getCommodityStressMap()
          .then((res) => {
            setCommodityStressRegions((res.items ?? []).map((row) => ({ ...row })));
            overlayLastUpdatedAtRef.current.commodityStressMap = Date.now();
          }))
          .catch(() => {
            // no-op
          });
      }
      if (overlayState.regionalAssetHighlight && selectedAssetId) {
        const assetKey = String(selectedAssetId || "").trim().toLowerCase();
        const stampKey = `assetRegion:${assetKey}`;
        if (isStale(overlayLastUpdatedAtRef.current[stampKey], overlayCacheMs("regionalAssetHighlight"))) {
          withOverlayLoad("regionalAssetHighlight", GlobeApi.getAssetRegions(assetKey)
            .then((res) => {
              const now = Date.now();
              setRegionHighlight(res);
              assetRegionCacheRef.current[assetKey] = { payload: res, updatedAt: now };
              overlayLastUpdatedAtRef.current[stampKey] = now;
            }))
            .catch(() => {
              // no-op
            });
        } else {
          const cached = assetRegionCacheRef.current[assetKey];
          if (cached) {
            setRegionHighlight(cached.payload);
          }
        }
      }
    }, GLOBE_TIMER_TICK_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [
    dataSource,
    deferredSections.news,
    deferredSections.seasonality,
    deferredSections.valuation,
    overlayState.commodityStressMap,
    overlayState.conflicts,
    overlayState.containerTraffic,
    overlayState.commodityRegions,
    overlayState.earthquakes,
    overlayState.globalLiquidityMap,
    overlayState.globalRiskLayer,
    overlayState.oilRoutes,
    overlayState.regionalAssetHighlight,
    overlayState.shipTracking,
    overlayState.shippingDisruptions,
    overlayState.wildfires,
    selectedAssetId,
    withOverlayLoad,
  ]);

  useEffect(() => {
    const active = OVERLAY_ACTIVATION_PRIORITY.find((key) => overlayState[key]);
    setSelectedOverlay(active ? mapOverlayKeyToMode(active) : "none");
  }, [
    overlayState.commodityStressMap,
    overlayState.commodityRegions,
    overlayState.conflicts,
    overlayState.containerTraffic,
    overlayState.earthquakes,
    overlayState.globalLiquidityMap,
    overlayState.globalRiskLayer,
    overlayState.oilRoutes,
    overlayState.regionalAssetHighlight,
    overlayState.shipTracking,
    overlayState.shippingDisruptions,
    overlayState.wildfires,
  ]);

  useEffect(() => {
    persistGlobeState({
      selectedAssetId,
      enabledAssets,
      selectedOverlay,
      camera,
    });
  }, [selectedAssetId, enabledAssets, selectedOverlay, camera]);

  useEffect(() => {
    if (!timeseries) return;
    // eslint-disable-next-line no-console
    console.info("[IVQ][Globe][Data]", {
      asset: timeseries.assetId,
      timeframe: timeseries.diagnostics?.timeframe,
      bars: timeseries.diagnostics?.bars,
      start: timeseries.diagnostics?.start,
      end: timeseries.diagnostics?.end,
      sourceRequested: timeseries.sourceRequested,
      sourceUsed: timeseries.sourceUsed || timeseries.source,
      fallbackReason: timeseries.fallbackReason ?? "",
      continuousMode: timeseries.continuousMode ?? "backadjusted",
    });
  }, [timeseries]);

  useEffect(() => {
    try {
      window.localStorage.setItem(DATA_SOURCE_STORAGE_KEY, dataSource);
    } catch (_err) {
      // no-op
    }
  }, [dataSource]);

  const selectedAsset = useMemo(
    () => assets.find((a) => a.id === selectedAssetId) ?? assets[0] ?? null,
    [assets, selectedAssetId],
  );
  const emptyLocations = useMemo<Array<{ lat: number; lng: number; label: string }>>(() => [], []);
  const selectedAssetLocations = useMemo(
    () => selectedAsset?.locations ?? emptyLocations,
    [emptyLocations, selectedAsset?.locations],
  );
  const emptyInflationByCountry = useMemo<Record<string, number>>(() => ({}), []);
  const emptyPolicyRateByCountry = useMemo<Record<string, PolicyRateCountryEntry>>(() => ({}), []);
  const emptyCommodityRegionScores = useMemo<Record<string, number>>(() => ({}), []);

  const selectedCrossPair = useMemo(
    () => (selectedAsset?.category === "Cross Pairs" ? selectedAsset : null),
    [selectedAsset],
  );

  const crossPairPath = useMemo<CrossPairPath | null>(() => {
    if (!selectedCrossPair) return null;
    const [a, b] = selectedCrossPair.locations ?? [];
    if (!a || !b) return null;
    const direction = String(seasonality?.stats?.direction ?? "LONG").toUpperCase();
    const routeColor = direction === "SHORT" ? "#ff384c" : "#39ff40";
    const raw = String(selectedCrossPair.name || "").toUpperCase().replace(/[^A-Z/]/g, "");
    const [base, quote] = raw.includes("/") ? raw.split("/") : [raw.slice(0, 3), raw.slice(3, 6)];
    return {
      assetId: selectedCrossPair.id,
      name: selectedCrossPair.name,
      from: {
        code: String(base || "A").slice(0, 3),
        label: String(a.label || "From"),
        lat: Number(a.lat),
        lng: Number(a.lng),
      },
      to: {
        code: String(quote || "B").slice(0, 3),
        label: String(b.label || "To"),
        lat: Number(b.lat),
        lng: Number(b.lng),
      },
      color: routeColor,
    };
  }, [seasonality?.stats?.direction, selectedCrossPair]);

  const enabledSet = useMemo(() => new Set(enabledAssets), [enabledAssets]);

  const markerScores = useMemo<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    out[selectedAssetId] = Number(timeseries?.aiScore?.total ?? 50);
    return out;
  }, [selectedAssetId, timeseries?.aiScore?.total]);

  const autoRotateEnabled = globeRotateMode !== "off";
  const autoRotateSpeed = globeRotateMode === "normal" ? 0.7 : 0.35;
  const effectiveAutoRotateEnabled = autoRotateEnabled || visualLoopEnabled;
  const effectiveAutoRotateSpeed = visualLoopEnabled
    ? Math.max(autoRotateSpeed, 0.8)
    : autoRotateSpeed;

  const markers = useMemo(
    () => buildDisplayMarkers(assets, enabledAssets, categoryEnabled, markerScores, markerZoomLevel),
    [assets, enabledAssets, categoryEnabled, markerScores, markerZoomLevel],
  );
  const visibleMarkers = useMemo(
    () => (overlayState.assets ? markers : []),
    [markers, overlayState.assets],
  );
  const activeShipTracking = useMemo(
    () => (overlayState.shipTracking ? shipTracking : []),
    [overlayState.shipTracking, shipTracking],
  );
  const activeCommodityRegions = useMemo(() => {
    const out: CommodityRegionItem[] = [];
    if (overlayState.commodityRegions) out.push(...commodityRegions);
    if (overlayState.commodityStressMap) out.push(...commodityStressRegions);
    return out;
  }, [commodityRegions, commodityStressRegions, overlayState.commodityRegions, overlayState.commodityStressMap]);
  const activeGlobalRiskRegions = useMemo(
    () => (overlayState.globalRiskLayer ? globalRiskRegions : []),
    [globalRiskRegions, overlayState.globalRiskLayer],
  );
  const activeGlobalLiquidityRegions = useMemo(
    () => (overlayState.globalLiquidityMap ? globalLiquidityRegions : []),
    [globalLiquidityRegions, overlayState.globalLiquidityMap],
  );
  const activeRegionHighlight = useMemo(
    () => (overlayState.regionalAssetHighlight ? regionHighlight : null),
    [overlayState.regionalAssetHighlight, regionHighlight],
  );
  const activeRouteOverlays = useMemo(() => {
    const out: OverlayRouteItem[] = [];
    if (overlayState.oilRoutes) out.push(...oilRoutes);
    if (overlayState.containerTraffic) out.push(...containerRoutes);
    if (overlayState.shippingDisruptions) out.push(...shippingDisruptionRoutes);
    if (overlayState.shipTracking) {
      for (const ship of shipTracking) {
        const path = Array.isArray(ship.route) ? ship.route : [];
        if (path.length < 2) continue;
        out.push({
          id: `ship-route:${ship.id}`,
          name: `${ship.name} path`,
          from: String(path[0]?.lat ?? ""),
          to: String(path[path.length - 1]?.lat ?? ""),
          path: path.map((pt) => ({ lat: Number(pt.lat), lng: Number(pt.lng) })),
          color: ship.shipType === "oil_tanker" ? "rgba(90,170,255,0.26)" : "rgba(150,210,255,0.24)",
          lineWidth: 0.32,
          animationSpeed: 0.36,
        });
      }
    }
    return out;
  }, [
    containerRoutes,
    oilRoutes,
    overlayState.containerTraffic,
    overlayState.oilRoutes,
    overlayState.shipTracking,
    overlayState.shippingDisruptions,
    shipTracking,
    shippingDisruptionRoutes,
  ]);

  const onToggleAsset = useCallback((assetId: string) => {
    setEnabledAssets((prev) => {
      const has = prev.includes(assetId);
      if (has) {
        const next = prev.filter((id) => id !== assetId);
        if (assetId === selectedAssetId && next.length) {
          setSelectedAssetId(next[0]);
        }
        return next;
      }
      return [...prev, assetId];
    });
  }, [selectedAssetId]);

  const onToggleCategory = useCallback((category: string) => {
    setCategoryEnabled((prev) => ({ ...prev, [category]: prev[category] === false }));
  }, []);

  const onAllOn = useCallback(() => {
    setEnabledAssets(assets.filter((asset) => asset.showOnGlobe !== false).map((asset) => asset.id));
  }, [assets]);

  const onAllOff = useCallback(() => {
    setEnabledAssets([]);
  }, []);

  const onRefreshData = useCallback(() => {
    globalNewsCacheRef.current = null;
    panelCacheRef.current = {};
    overlayLastUpdatedAtRef.current = {};
    assetRegionCacheRef.current = {};
    GlobeApi.clearCache();
    refreshShellData(true).catch(() => {
      // no-op
    });
    if (selectedAssetId) {
      loadPanelData(selectedAssetId, dataSource, {
        force: true,
        forceTimeseriesRefresh: true,
        includeEvaluation: deferredSections.valuation,
        includeSeasonality: deferredSections.seasonality,
        includeAssetNews: deferredSections.news,
        includeSignalDetail: deferredSections.valuation,
      }).catch(() => {
        // no-op
      });
    }
  }, [dataSource, deferredSections.news, deferredSections.seasonality, deferredSections.valuation, loadPanelData, refreshShellData, selectedAssetId]);

  const onToggleOverlay = useCallback((key: keyof OverlayToggleState) => {
    setOverlayState((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const onSelectAssetFromWatchlist = useCallback((assetId: string) => {
    setSelectedAssetId(assetId);
    activateSection("valuation");
    activateSection("seasonality");
    markAssetUsage(assetId);
    setFocusAssetId(assetId);
  }, [activateSection, markAssetUsage]);

  const onSelectAssetAnywhere = useCallback((assetId: string) => {
    if (!assetId) return;
    setSelectedAssetId(assetId);
    activateSection("valuation");
    activateSection("seasonality");
    markAssetUsage(assetId);
    setFocusAssetId(assetId);
  }, [activateSection, markAssetUsage]);

  const onSelectPointFromMiniMap = useCallback((point: MarkerPoint) => {
    if (point.kind !== "event" && point.kind !== "ship" && point.kind !== "commodity" && point.kind !== "region" && point.assetId) {
      setSelectedAssetId(point.assetId);
      activateSection("valuation");
      activateSection("seasonality");
      markAssetUsage(point.assetId);
    }
    setFocusLocation({ lat: Number(point.lat), lng: Number(point.lng) });
  }, [activateSection, markAssetUsage]);

  const onSharedTimeRangeChange = useCallback((next: SharedTimeRange | null) => {
    if (!next) return;
    sharedTimeRangeRef.current = next;
    setSharedTimeRange((prev) => {
      if (!prev) return next;
      const spanDelta = Math.abs(Number(prev.visibleSpan || 0) - Number(next.visibleSpan || 0));
      const offDelta = Math.abs(Number(prev.rightOffset || 0) - Number(next.rightOffset || 0));
      if (spanDelta < 0.001 && offDelta < 0.001) return prev;
      return next;
    });
  }, []);
  const onGlobeSelectAsset = useCallback((assetId: string) => {
    onSelectAssetAnywhere(assetId);
  }, [onSelectAssetAnywhere]);
  const onFocusHandled = useCallback(() => {
    setFocusAssetId(null);
  }, []);
  const onFocusLocationHandled = useCallback(() => {
    setFocusLocation(null);
  }, []);

  const seasonStats = useMemo(() => {
    const stats = seasonality?.stats;
    const curve = Array.isArray(seasonality?.curve) ? seasonality?.curve : [];

    let bestHorizonDays = Math.round(finiteOr(stats?.bestHorizonDays, finiteOr(seasonality?.projectionDays, 12)));
    bestHorizonDays = clampNum(bestHorizonDays, 10, 20);

    let avgReturn20d = finiteOr(stats?.avgReturn20d, Number.NaN);
    let hitRateRaw = finiteOr(stats?.hitRate, Number.NaN);
    let expectedValue = finiteOr(stats?.expectedValue, Number.NaN);
    let sharpeRatio = finiteOr(stats?.sharpeRatio, Number.NaN);
    let sortinoRatio = finiteOr(stats?.sortinoRatio, Number.NaN);
    let direction = String(stats?.direction ?? "").toUpperCase();

    if ((!Number.isFinite(avgReturn20d) || !Number.isFinite(hitRateRaw) || !Number.isFinite(sharpeRatio) || !Number.isFinite(sortinoRatio)) && curve.length >= 2) {
      const ys = curve.map((p) => finiteOr(p?.y, 0));
      const start = ys[0] ?? 0;
      const end = ys[ys.length - 1] ?? 0;
      const delta = end - start;
      const diffs: number[] = [];
      for (let i = 1; i < ys.length; i += 1) {
        diffs.push((ys[i] ?? 0) - (ys[i - 1] ?? 0));
      }
      const meanDiff = diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length : 0;
      const varDiff = diffs.length
        ? diffs.reduce((a, b) => a + (b - meanDiff) * (b - meanDiff), 0) / Math.max(1, diffs.length - 1)
        : 0;
      const stdDiff = Math.sqrt(Math.max(0, varDiff));

      if (!Number.isFinite(avgReturn20d)) avgReturn20d = delta;
      if (!Number.isFinite(hitRateRaw)) {
        const base = delta >= 0 ? 0.58 : 0.42;
        hitRateRaw = clampNum(base + Math.sign(delta || 0) * Math.min(0.1, Math.abs(delta) * 0.005), 0.05, 0.95);
      }
      if (!Number.isFinite(expectedValue)) expectedValue = avgReturn20d * hitRateRaw;
      if (!Number.isFinite(sharpeRatio)) sharpeRatio = stdDiff > 1e-9 ? meanDiff / stdDiff : 0;
      if (!Number.isFinite(sortinoRatio)) sortinoRatio = stdDiff > 1e-9 ? (meanDiff * 1.15) / stdDiff : 0;
      if (!(direction === "LONG" || direction === "SHORT")) direction = delta >= 0 ? "LONG" : "SHORT";
      if (!Number.isFinite(bestHorizonDays) || bestHorizonDays < 10 || bestHorizonDays > 20) {
        bestHorizonDays = clampNum(Math.max(10, ys.length - 1), 10, 20);
      }
    }

    if (!(direction === "LONG" || direction === "SHORT")) direction = finiteOr(avgReturn20d, 0) >= 0 ? "LONG" : "SHORT";
    // tolerate payloads that send hitRate either as fraction (0..1) or percent (0..100)
    if (Number.isFinite(hitRateRaw) && hitRateRaw > 1.5) hitRateRaw = hitRateRaw / 100.0;
    if (!Number.isFinite(avgReturn20d)) avgReturn20d = 0;
    if (!Number.isFinite(hitRateRaw)) hitRateRaw = 0.5;
    if (!Number.isFinite(expectedValue)) expectedValue = avgReturn20d * hitRateRaw;
    if (!Number.isFinite(sharpeRatio)) sharpeRatio = 0;
    if (!Number.isFinite(sortinoRatio)) sortinoRatio = 0;

    return {
      avgReturn20d,
      hitRateRaw: clampNum(hitRateRaw, 0, 1),
      expectedValue,
      direction: direction as "LONG" | "SHORT",
      sharpeRatio,
      sortinoRatio,
      bestHorizonDays: clampNum(bestHorizonDays, 10, 20),
    };
  }, [seasonality]);

  const avgReturn = seasonStats.avgReturn20d;
  const hitRate = clampNum(seasonStats.hitRateRaw * 100, 0, 100);
  const seasonDirection = seasonStats.direction;
  const seasonSharpe = seasonStats.sharpeRatio;
  const seasonSortino = seasonStats.sortinoRatio;
  const seasonHorizon = seasonStats.bestHorizonDays;
  const seasonBaseColor = seasonDirection === "LONG" ? "#39ff40" : "#ff384c";
  const winrateColor = hitRate < 58 ? "#94a3b8" : (seasonDirection === "LONG" ? "#39ff40" : "#ff384c");
  const winrateArc = `conic-gradient(${winrateColor} ${hitRate.toFixed(2)}%, rgba(71,85,105,0.28) 0)`;
  const seasonWinrateSpark = useMemo(() => {
    const curve = normalizedSeasonalityCurve(seasonality).map((point) => Number(point.y));
    return buildMiniSparkPaths(curve);
  }, [seasonality]);
  const currentSeasonPattern = useMemo(() => {
    const holdDays = Math.max(10, Math.min(20, Math.round(finiteOr(seasonHorizon, 12))));
    const today = currentUtcDayOfYear();
    const endDay = Math.min(366, today + holdDays);
    const curve = (seasonality?.curve ?? [])
      .map((point) => ({
        x: Number(point.x),
        y: Number(point.y),
      }))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
      .sort((left, right) => left.x - right.x);
    const startValue = curve.find((point) => point.x >= 0)?.y ?? 0;
    const endValue = curve.find((point) => point.x >= holdDays)?.y ?? curve[curve.length - 1]?.y ?? finiteOr(avgReturn, 0);
    const delta = finiteOr(endValue, 0) - finiteOr(startValue, 0);
    const direction = delta >= 0 ? "LONG" as const : "SHORT" as const;

    if (!curve.length) {
      return {
        label: `${formatSeasonDay(today)} - ${formatSeasonDay(endDay)}`,
        holdLabel: `${holdDays} Tage`,
        direction,
        avgReturnPct: finiteOr(avgReturn, 0),
      };
    }

    return {
      label: `${formatSeasonDay(today)} - ${formatSeasonDay(endDay)}`,
      holdLabel: `${holdDays} Tage`,
      direction,
      avgReturnPct: delta,
    };
  }, [avgReturn, seasonHorizon, seasonality]);
  const seasonHorizonLabel = `${Math.max(10, Math.min(20, Math.round(finiteOr(seasonHorizon, 12))))} Tage`;
  const avgReturnLabel = `${finiteOr(avgReturn, 0).toFixed(2)}%`;
  const hitRateLabel = `${hitRate.toFixed(0)}%`;
  const sharpeLabel = finiteOr(seasonSharpe, 0).toFixed(2);
  const sortinoLabel = finiteOr(seasonSortino, 0).toFixed(2);
  const avgReturnPct = Math.max(0, Math.min(100, Math.abs(finiteOr(avgReturn, 0)) * 18));
  const sharpePct = Math.max(0, Math.min(100, Math.abs(finiteOr(seasonSharpe, 0)) * 32));
  const sortinoPct = Math.max(0, Math.min(100, Math.abs(finiteOr(seasonSortino, 0)) * 24));
  const neutralAccent = goldThemeEnabled ? GOLD_PRIMARY : "#4d87fe";
  const colorizeRiskMetric = (value: number): string => {
    const v = Math.abs(finiteOr(value, 0));
    if (v < 0.25) return "#eef5ff";
    if (v < 0.9) return neutralAccent;
    return seasonDirection === "LONG" ? "#39ff40" : "#ff384c";
  };
  const seasonColor = seasonBaseColor;
  const sharpeColor = colorizeRiskMetric(seasonSharpe);
  const seasonStateLabel = seasonDirection === "LONG" ? "Bullish" : "Bearish";
  const currentPatternColor = currentSeasonPattern.direction === "LONG" ? "#39ff40" : "#ff384c";
  const currentPatternStateLabel = currentSeasonPattern.direction === "LONG" ? "Bullish" : "Bearish";
  const currentPatternReturnLabel = `${finiteOr(currentSeasonPattern.avgReturnPct, 0) >= 0 ? "+" : ""}${finiteOr(currentSeasonPattern.avgReturnPct, 0).toFixed(2)}%`;
  const chartHeaderLabel = useMemo(() => {
    if (!selectedAsset) return "Asset";
    if (selectedAsset.id === "dax40") return "DAX 40";
    if (selectedAsset.id === "sp500") return "S&P 500";
    if (selectedAsset.id === "nasdaq100") return "Nasdaq 100";
    if (selectedAsset.id === "dowjones") return "Dow Jones";
    if (selectedAsset.id === "russell2000") return "Russell 2000";
    return selectedAsset.name;
  }, [selectedAsset]);
  const chartSourceLabel = useMemo(
    () => `${String(timeseries?.sourceUsed || timeseries?.source || dataSource).replace(/^./, (s) => s.toUpperCase())}${timeseries?.fallbackUsed ? " (fallback)" : ""}`,
    [dataSource, timeseries?.fallbackUsed, timeseries?.source, timeseries?.sourceUsed],
  );
  const globeGridLayoutClass = isGlobeFullscreen
    ? "h-full"
    : "min-h-0 grid-cols-1 grid-rows-[minmax(320px,42vh)_auto_minmax(180px,24vh)] min-[769px]:h-[760px] min-[769px]:grid-cols-[286px_minmax(0,1fr)] min-[769px]:grid-rows-[minmax(0,1.62fr)_minmax(0,0.66fr)]";
  const globeGridLayoutStyle = isGlobeFullscreen
    ? {
        gridTemplateColumns: "minmax(460px, 48%) minmax(0, 52%)",
        gridTemplateRows: "minmax(0, 1.18fr) minmax(0, 0.82fr)",
      }
    : undefined;
  const overlayLoadingLabels = useMemo(() => {
    const labels: string[] = [];
    for (const key of OVERLAY_LOADING_KEYS) {
      if (overlayLoadingState[key]) {
        labels.push(OVERLAY_LOADING_LABELS[key]);
      }
    }
    return labels;
  }, [overlayLoadingState]);
  const dashboardLoadingLabels = useMemo(() => {
    const combined = [
      ...apiLoading.labels,
      ...overlayLoadingLabels,
      ...(panelLoading ? ["Loading chart + valuation + seasonality..."] : []),
      ...(shellLoading ? ["Loading dashboard shell..."] : []),
    ];
    return Array.from(new Set(combined)).slice(0, 5);
  }, [apiLoading.labels, overlayLoadingLabels, panelLoading, shellLoading]);
  const dashboardLoadingActive = Boolean(shellLoading || panelLoading || apiLoading.active || overlayLoadingLabels.length > 0);
  const dashboardLoadingHeadline = dashboardLoadingLabels[0] || "Loading data...";

  return (
    <main className={`ivq-app-bg relative min-h-screen overflow-x-hidden overflow-y-visible bg-transparent p-0 text-slate-100 ${goldThemeEnabled ? "ivq-theme-gold" : ""}`}>
      <div className="ivq-page-grid relative z-10 grid grid-cols-1 gap-4 px-3 pb-4 pt-16 min-[769px]:min-h-screen min-[769px]:grid-cols-[55%_45%] min-[769px]:px-4 min-[769px]:pt-0">
        <section className="ivq-layout-wrapper flex flex-col">
          <div ref={globeShellRef} className="ivq-globe-shell group relative">
            {isGlobeFullscreen ? (
              <div className="grid h-full grid-cols-[minmax(460px,48%)_minmax(0,52%)] gap-4">
                <div className="grid min-h-0 grid-rows-[minmax(0,1.08fr)_minmax(240px,0.92fr)] gap-4 overflow-hidden">
                  <div className="min-h-0 overflow-hidden">
                    <SettingsPanel
                      assets={assets}
                      enabledSet={enabledSet}
                      categoryEnabled={categoryEnabled}
                      selectedAssetId={selectedAssetId}
                      goldThemeEnabled={goldThemeEnabled}
                      onSelectAsset={onSelectAssetFromWatchlist}
                      onToggleAsset={onToggleAsset}
                      onToggleCategory={onToggleCategory}
                      onAllOn={onAllOn}
                      onAllOff={onAllOff}
                      onRefreshData={onRefreshData}
                      overlayState={overlayState}
                      overlayLoadingState={overlayLoadingState}
                      onToggleOverlay={onToggleOverlay}
                    />
                  </div>

                  <div className="min-h-0 overflow-hidden">
                    <MiniWorldMap
                      markers={visibleMarkers}
                      selectedAssetId={selectedAssetId}
                      selectedAssetCategory={selectedAsset?.category ?? ""}
                      selectedAssetLocations={selectedAssetLocations}
                      crossPairColor={crossPairPath?.color ?? null}
                      geoEvents={geoEvents}
                      shipTracking={activeShipTracking}
                      overlayRoutes={activeRouteOverlays}
                      commodityRegions={activeCommodityRegions}
                      globalRiskRegions={activeGlobalRiskRegions}
                      globalLiquidityRegions={activeGlobalLiquidityRegions}
                      regionHighlight={activeRegionHighlight}
                      selectedOverlay={selectedOverlay}
                      cameraAltitude={Number(camera?.altitude ?? 1.8)}
                      goldThemeEnabled={goldThemeEnabled}
                      assetUsage={assetUsage}
                      onSelectPoint={onSelectPointFromMiniMap}
                    />
                  </div>
                </div>

                <div className="glass-panel glass-panel--flush relative min-h-0 overflow-hidden rounded-xl">
                  <div className="ivq-globe-hover-controls absolute right-3 top-3 z-30">
                    <button
                      type="button"
                      onClick={onToggleGlobeFullscreen}
                      className="ivq-globe-icon-btn"
                      title="Exit fullscreen"
                      aria-label="Exit fullscreen"
                    >
                      <Minimize2 size={15} strokeWidth={1.9} />
                    </button>
                  </div>

                  <GlobeCanvas
                    markers={visibleMarkers}
                    selectedAssetId={selectedAssetId}
                    selectedAssetCategory={selectedAsset?.category ?? ""}
                    selectedAssetLocations={selectedAssetLocations}
                    crossPairPath={crossPairPath}
                    focusAssetId={focusAssetId}
                    focusLocation={focusLocation}
                    selectedOverlay={selectedOverlay}
                    inflationByCountry={emptyInflationByCountry}
                    policyRateByCountry={emptyPolicyRateByCountry}
                    volatilityScore={50}
                    volatilityRegime="Neutral"
                    commodityRegionScores={emptyCommodityRegionScores}
                    commodityMode="Normal"
                    geoEvents={geoEvents}
                    shipTracking={activeShipTracking}
                    overlayRoutes={activeRouteOverlays}
                    commodityRegions={activeCommodityRegions}
                    globalRiskRegions={activeGlobalRiskRegions}
                    globalLiquidityRegions={activeGlobalLiquidityRegions}
                    regionHighlight={activeRegionHighlight}
                    overlayState={overlayState}
                    camera={camera}
                    autoRotateEnabled={effectiveAutoRotateEnabled}
                    autoRotateSpeed={effectiveAutoRotateSpeed}
                    goldThemeEnabled={goldThemeEnabled}
                    onCameraChange={setCamera}
                    onSelectAsset={onGlobeSelectAsset}
                    onFocusHandled={onFocusHandled}
                    onFocusLocationHandled={onFocusLocationHandled}
                  />
                </div>
              </div>
            ) : (
              <div className={`grid ${globeGridLayoutClass} gap-4`} style={globeGridLayoutStyle}>
                <div className="min-h-0 min-[769px]:row-span-2">
                  <SettingsPanel
                    assets={assets}
                    enabledSet={enabledSet}
                    categoryEnabled={categoryEnabled}
                    selectedAssetId={selectedAssetId}
                    goldThemeEnabled={goldThemeEnabled}
                    onSelectAsset={onSelectAssetFromWatchlist}
                    onToggleAsset={onToggleAsset}
                    onToggleCategory={onToggleCategory}
                    onAllOn={onAllOn}
                    onAllOff={onAllOff}
                    onRefreshData={onRefreshData}
                    overlayState={overlayState}
                    overlayLoadingState={overlayLoadingState}
                    onToggleOverlay={onToggleOverlay}
                  />
                </div>

                <div className="glass-panel glass-panel--flush relative min-h-[320px] overflow-hidden rounded-xl min-[769px]:min-h-0">
                  <div className="ivq-globe-hover-controls absolute right-3 top-3 z-30">
                    <button
                      type="button"
                      onClick={onToggleGlobeFullscreen}
                      className="ivq-globe-icon-btn"
                      title="Fullscreen"
                      aria-label="Fullscreen"
                    >
                      <Maximize2 size={15} strokeWidth={1.9} />
                    </button>
                  </div>

                  <GlobeCanvas
                    markers={visibleMarkers}
                    selectedAssetId={selectedAssetId}
                    selectedAssetCategory={selectedAsset?.category ?? ""}
                    selectedAssetLocations={selectedAssetLocations}
                    crossPairPath={crossPairPath}
                    focusAssetId={focusAssetId}
                    focusLocation={focusLocation}
                    selectedOverlay={selectedOverlay}
                    inflationByCountry={emptyInflationByCountry}
                    policyRateByCountry={emptyPolicyRateByCountry}
                    volatilityScore={50}
                    volatilityRegime="Neutral"
                    commodityRegionScores={emptyCommodityRegionScores}
                    commodityMode="Normal"
                    geoEvents={geoEvents}
                    shipTracking={activeShipTracking}
                    overlayRoutes={activeRouteOverlays}
                    commodityRegions={activeCommodityRegions}
                    globalRiskRegions={activeGlobalRiskRegions}
                    globalLiquidityRegions={activeGlobalLiquidityRegions}
                    regionHighlight={activeRegionHighlight}
                    overlayState={overlayState}
                    camera={camera}
                    autoRotateEnabled={effectiveAutoRotateEnabled}
                    autoRotateSpeed={effectiveAutoRotateSpeed}
                    goldThemeEnabled={goldThemeEnabled}
                    onCameraChange={setCamera}
                    onSelectAsset={onGlobeSelectAsset}
                    onFocusHandled={onFocusHandled}
                    onFocusLocationHandled={onFocusLocationHandled}
                  />
                </div>

                <div className="min-h-[180px] min-[769px]:min-h-0">
                  <MiniWorldMap
                    markers={visibleMarkers}
                    selectedAssetId={selectedAssetId}
                    selectedAssetCategory={selectedAsset?.category ?? ""}
                    selectedAssetLocations={selectedAssetLocations}
                    crossPairColor={crossPairPath?.color ?? null}
                    geoEvents={geoEvents}
                    shipTracking={activeShipTracking}
                    overlayRoutes={activeRouteOverlays}
                    commodityRegions={activeCommodityRegions}
                    globalRiskRegions={activeGlobalRiskRegions}
                    globalLiquidityRegions={activeGlobalLiquidityRegions}
                    regionHighlight={activeRegionHighlight}
                    selectedOverlay={selectedOverlay}
                    cameraAltitude={Number(camera?.altitude ?? 1.8)}
                    goldThemeEnabled={goldThemeEnabled}
                    assetUsage={assetUsage}
                    onSelectPoint={onSelectPointFromMiniMap}
                  />
                </div>
              </div>
            )}
          </div>

          <div
            className="mt-4 h-auto min-h-[320px] min-[769px]:h-[360px] min-[769px]:min-h-[360px]"
            onMouseEnter={() => activateSection("news")}
            onClick={() => activateSection("news")}
          >
            <NewsColumns
              globalNews={globalNews}
              assetNews={assetNews}
              assetName={selectedAsset?.name ?? "Asset"}
              assetIconUrl={selectedAsset ? iconUrlForAsset(selectedAsset) : undefined}
              goldThemeEnabled={goldThemeEnabled}
            />
          </div>

          <div
            className="mt-4 h-auto min-h-[620px] min-[769px]:h-[980px] min-[769px]:min-h-[980px]"
            onMouseEnter={() => activateSection("heatmap")}
            onClick={() => activateSection("heatmap")}
          >
            <AssetHeatmapPanel
              selectedAssetId={selectedAssetId}
              dataSource={dataSource}
              goldThemeEnabled={goldThemeEnabled}
              enabled={deferredSections.heatmap}
            />
          </div>
        </section>

        <section className="ivq-layout-wrapper grid grid-cols-1 gap-4 min-[769px]:grid-rows-[766px_360px_96px_860px]">
          <div
            className={`${
              isChartStackFullscreen
                ? "ivq-chart-stack-overlay fixed inset-0 z-[70] grid grid-cols-1 grid-rows-[minmax(0,1.06fr)_minmax(220px,0.55fr)_minmax(220px,0.55fr)] gap-4 p-4 min-[769px]:grid-cols-2 min-[769px]:grid-rows-[minmax(0,1.28fr)_minmax(0,0.88fr)]"
                : "grid min-h-0 grid-cols-1 grid-rows-[minmax(320px,44vh)_220px_220px] gap-4 min-[769px]:grid-rows-[398px_168px_168px]"
            }`}
            style={isChartStackFullscreen ? {
              background: goldThemeEnabled
                ? "radial-gradient(980px 640px at 8% 8%, rgba(214,178,74,0.18), transparent 62%), radial-gradient(880px 620px at 92% 12%, rgba(214,178,74,0.12), transparent 68%), linear-gradient(180deg, #030303 0%, #090807 50%, #040404 100%)"
                : "radial-gradient(980px 640px at 8% 8%, rgba(100, 158, 250, 0.20), transparent 62%), radial-gradient(880px 620px at 92% 12%, rgba(86, 145, 236, 0.15), transparent 68%), linear-gradient(180deg, #030915 0%, #071325 50%, #060d1b 100%)",
            } : undefined}
          >
            <div className={`glass-panel ivq-panel group relative min-h-0 p-[18px] ${isChartStackFullscreen ? "col-span-2 row-start-1" : ""}`}>
              <div className="h-full min-h-0">
                <Suspense fallback={<div className="grid h-full place-items-center text-xs text-slate-400">Loading chart...</div>}>
                  <CandleChart
                    payload={timeseries}
                    evaluation={evaluation}
                    seasonality={seasonality}
                    dataSource={dataSource}
                    title={chartHeaderLabel}
                    sourceLabel={chartSourceLabel}
                    goldThemeEnabled={goldThemeEnabled}
                    themePrimary={goldThemeEnabled ? GOLD_PRIMARY : "#4d87fe"}
                    isPanelLoading={panelLoading}
                    isFullscreen={isChartStackFullscreen}
                    onToggleFullscreen={() => setIsChartStackFullscreen((value) => !value)}
                    loopReplayTick={visualLoopEnabled ? visualLoopTick : 0}
                    onTimeRangeChange={onSharedTimeRangeChange}
                    onRecentSignalChange={setRecentSignal}
                  />
                </Suspense>
              </div>
            </div>

            <div
              className={`glass-panel ivq-panel min-h-0 p-[14px] ${isChartStackFullscreen ? "col-start-1 row-start-2" : ""}`}
              onMouseEnter={() => activateSection("valuation")}
              onClick={() => activateSection("valuation")}
            >
              <div className="ivq-section-label">Valuation 10</div>
              <div className="h-[calc(100%-26px)] min-h-0">
                <Suspense fallback={<div className="grid h-full place-items-center text-xs text-slate-400">Loading eval...</div>}>
                  <EvaluationChart payload={evaluation} mode="v10" syncRange={sharedTimeRange} loopReplayTick={visualLoopEnabled ? visualLoopTick : 0} />
                </Suspense>
              </div>
            </div>

            <div
              className={`glass-panel ivq-panel min-h-0 p-[14px] ${isChartStackFullscreen ? "col-start-2 row-start-2" : ""}`}
              onMouseEnter={() => activateSection("valuation")}
              onClick={() => activateSection("valuation")}
            >
              <div className="ivq-section-label">Valuation 20</div>
              <div className="h-[calc(100%-26px)] min-h-0">
                <Suspense fallback={<div className="grid h-full place-items-center text-xs text-slate-400">Loading eval...</div>}>
                  <EvaluationChart payload={evaluation} mode="v20" syncRange={sharedTimeRange} loopReplayTick={visualLoopEnabled ? visualLoopTick : 0} />
                </Suspense>
              </div>
            </div>
          </div>

          <div
            className="glass-panel ivq-panel flex min-h-0 flex-col p-[18px]"
            onMouseEnter={() => activateSection("seasonality")}
            onClick={() => activateSection("seasonality")}
          >
            <div className="ivq-section-label">Seasonality</div>
            <div className="grid min-h-0 flex-1 grid-cols-1 gap-3.5 overflow-hidden min-[769px]:grid-cols-[minmax(0,1fr)_188px]">
                <div className="ivq-subpanel relative h-full min-h-0 overflow-hidden rounded-md p-[2px]">
                  <div className="h-full min-h-0">
                    <Suspense fallback={<div className="grid h-full place-items-center text-xs text-slate-400">Loading seasonality...</div>}>
                      <GlobeSeasonalityChart payload={seasonality} loopReplayTick={visualLoopEnabled ? visualLoopTick : 0} />
                    </Suspense>
                  </div>
                </div>
              <div className="grid h-full min-h-0 grid-cols-2 gap-2.5 text-[10px] min-[769px]:grid-cols-1 min-[769px]:grid-rows-[repeat(5,minmax(0,1fr))]">
                <div className="ivq-subpanel min-h-0 overflow-hidden p-2.5">
                  <div className="mb-1 text-[#b2c5de]">Current Pattern</div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-semibold" style={{ color: currentPatternColor }}>
                        {currentSeasonPattern.label}
                      </div>
                      <div className="mt-1 text-[10px] font-semibold" style={{ color: currentPatternColor }}>
                        {currentPatternStateLabel} / {currentPatternReturnLabel}
                      </div>
                    </div>
                    <span className="text-[10px] font-semibold text-slate-300">{currentSeasonPattern.holdLabel}</span>
                  </div>
                  <div className="mt-1 h-1 rounded-full bg-slate-700/45">
                    <div className="h-1 rounded-full" style={{ width: `${Math.max(0, Math.min(100, (finiteOr(seasonHorizon, 12) - 10) * 10))}%`, backgroundColor: currentPatternColor }} />
                  </div>
                </div>
                <div className="ivq-subpanel min-h-0 overflow-hidden p-2.5">
                  <div className="mb-1 text-[#b2c5de]">Average Return</div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-[72px] text-[14px] font-semibold" style={{ color: avgReturn >= 0 ? "#39ff40" : "#ff384c" }}>{avgReturnLabel}</div>
                    <span className="text-[10px] font-semibold text-slate-300">{avgReturn >= 0 ? "Pos" : "Neg"}</span>
                  </div>
                  <div className="mt-1 h-1 rounded-full bg-slate-700/45">
                    <div className="h-1 rounded-full" style={{ width: `${avgReturnPct}%`, backgroundColor: avgReturn >= 0 ? "#39ff40" : "#ff384c" }} />
                  </div>
                </div>
                <div className="ivq-subpanel min-h-0 overflow-hidden p-2.5">
                  <div className="mb-1 text-[#b2c5de]">Winrate</div>
                  <div className="grid grid-cols-[minmax(0,1fr)_52px] items-center gap-2">
                    <div className="min-w-0">
                      <div className="text-[14px] font-semibold leading-none" style={{ color: winrateColor }}>
                        {hitRateLabel}
                      </div>
                      <div className="mt-1 text-[10px] font-semibold" style={{ color: winrateColor }}>
                        {seasonDirection === "LONG" ? "Bullish" : seasonDirection === "SHORT" ? "Bearish" : "Neutral"}
                      </div>
                    </div>
                    <div
                      className="grid h-[52px] w-[52px] place-items-center rounded-full border border-slate-600/65 text-[10px] font-semibold text-slate-100"
                      style={{ background: winrateArc }}
                    >
                      <span className="grid h-[34px] w-[34px] place-items-center rounded-full bg-[#07101d]">
                        {hitRateLabel}
                      </span>
                    </div>
                  </div>
                  <div className="mt-1.5 h-[18px] w-full overflow-hidden rounded bg-[rgba(4,10,20,0.36)]">
                    <svg viewBox="0 0 100 28" preserveAspectRatio="none" className="h-full w-full">
                      {seasonWinrateSpark.area ? <path d={seasonWinrateSpark.area} fill={winrateColor} fillOpacity={0.14} /> : null}
                      {seasonWinrateSpark.line ? <path d={seasonWinrateSpark.line} fill="none" stroke={winrateColor} strokeWidth={1.8} /> : null}
                    </svg>
                  </div>
                </div>
                <div className="ivq-subpanel min-h-0 overflow-hidden p-2.5">
                  <div className="mb-1 text-[#b2c5de]">Sharpe Ratio</div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-[72px] text-[14px] font-semibold" style={{ color: sharpeColor }}>{sharpeLabel}</div>
                    <span className="text-[10px] font-semibold text-slate-300">S</span>
                  </div>
                  <div className="mt-1 h-1 rounded-full bg-slate-700/45">
                    <div className="h-1 rounded-full" style={{ width: `${sharpePct}%`, backgroundColor: sharpeColor }} />
                  </div>
                </div>
                <div className="ivq-subpanel min-h-0 overflow-hidden p-2.5">
                  <div className="mb-1 text-[#b2c5de]">Sortino Ratio</div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-[72px] text-[14px] font-semibold" style={{ color: colorizeRiskMetric(seasonSortino) }}>{sortinoLabel}</div>
                    <span className="text-[10px] font-semibold text-slate-300">So</span>
                  </div>
                  <div className="mt-1 h-1 rounded-full bg-slate-700/45">
                    <div className="h-1 rounded-full" style={{ width: `${sortinoPct}%`, backgroundColor: colorizeRiskMetric(seasonSortino) }} />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="glass-panel ivq-panel h-auto min-h-[108px] overflow-hidden p-[18px] min-[769px]:h-[108px] min-[769px]:min-h-[108px]">
            <KpiGrid
              indicators={timeseries?.indicators}
              aiScore={Number(timeseries?.aiScore?.total ?? 50)}
              breakdown={timeseries?.aiScore?.breakdown}
              confidenceScore={Number(signalDetail?.confidenceScore ?? 0)}
              signalQuality={signalDetail?.signalQuality ?? "Low"}
              goldThemeEnabled={goldThemeEnabled}
            />
          </div>

          <div className="grid h-full min-h-0 grid-cols-1 gap-3 min-[769px]:grid-rows-[192px_minmax(0,1fr)_56px]">
            <SignalDetailPanel
              payload={signalDetail}
              recentSignal={recentSignal}
              goldThemeEnabled={goldThemeEnabled}
              fallbackWhy={[
                {
                  label: "Valuation",
                  value:
                    Number(timeseries?.aiScore?.breakdown?.Valuation ?? 50) >= 55
                      ? "Supportive"
                      : "Neutral",
                },
                {
                  label: "Seasonality Bias",
                  value: String(seasonality?.stats?.direction ?? "NEUTRAL").toUpperCase(),
                },
                {
                  label: "Momentum",
                  value: String(timeseries?.indicators?.trend ?? "Neutral"),
                },
                {
                  label: "Supply/Demand Distance",
                  value: `D ${Number(timeseries?.indicators?.distanceToDemand ?? 0).toFixed(2)} | S ${Number(timeseries?.indicators?.distanceToSupply ?? 0).toFixed(2)}`,
                },
                {
                  label: "Volatility Regime",
                  value: Number(timeseries?.indicators?.volatility ?? 0) >= 5 ? "Elevated" : "Calm",
                },
              ]}
            />
            <div
              className="h-full min-h-0 min-[769px]:min-h-0"
              onMouseEnter={() => activateSection("macro")}
              onClick={() => activateSection("macro")}
            >
              <MacroFundamentalsPanel
                goldThemeEnabled={goldThemeEnabled}
                loopReplayTick={visualLoopEnabled ? visualLoopTick : 0}
                enabled={deferredSections.macro}
              />
            </div>
            <div className="glass-panel ivq-subpanel ivq-controls-compact grid h-auto min-h-[56px] grid-cols-1 items-center gap-2 px-2 py-2 min-[769px]:h-[56px] min-[769px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_30px] min-[769px]:py-1.5">
              <div className="flex flex-col items-stretch gap-2 min-[769px]:flex-row min-[769px]:items-center">
                <div className="shrink-0 text-[9px] uppercase tracking-[0.11em] text-slate-300">Globe Motion</div>
                <div className="grid flex-1 grid-cols-4 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setGlobeRotateMode("off")}
                    className={`ivq-glass-btn ${globeRotateMode === "off" ? "is-active" : ""}`}
                  >
                    <span className="ivq-glass-btn-dot" />
                    Stopp
                  </button>
                  <button
                    type="button"
                    onClick={() => setGlobeRotateMode("slow")}
                    className={`ivq-glass-btn ${globeRotateMode === "slow" ? "is-active" : ""}`}
                  >
                    <span className="ivq-glass-btn-dot" />
                    Langsam
                  </button>
                  <button
                    type="button"
                    onClick={() => setGlobeRotateMode("normal")}
                    className={`ivq-glass-btn ${globeRotateMode === "normal" ? "is-active" : ""}`}
                  >
                    <span className="ivq-glass-btn-dot" />
                    Normal
                  </button>
                  <button
                    type="button"
                    onClick={() => setVisualLoopEnabled((v) => !v)}
                    className={`ivq-glass-btn ${visualLoopEnabled ? "is-active" : ""}`}
                    title="Loop"
                  >
                    <span className="ivq-glass-btn-dot" />
                    Loop
                  </button>
                </div>
              </div>
              <div className="flex flex-col items-stretch gap-2 min-[769px]:flex-row min-[769px]:items-center">
                <div className="shrink-0 text-[9px] uppercase tracking-[0.11em] text-slate-300">Data Source</div>
                <div className="grid flex-1 grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setDataSource("tradingview")}
                    className={`ivq-glass-btn ${dataSource === "tradingview" ? "is-active" : ""}`}
                  >
                    TradingView
                  </button>
                  <button
                    type="button"
                    onClick={() => setDataSource("dukascopy")}
                    className={`ivq-glass-btn ${dataSource === "dukascopy" ? "is-active" : ""}`}
                  >
                    Dukascopy
                  </button>
                  <button
                    type="button"
                    onClick={() => setDataSource("yahoo")}
                    className={`ivq-glass-btn ${dataSource === "yahoo" ? "is-active" : ""}`}
                  >
                    Yahoo
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>

      {dashboardLoadingActive ? (
        <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center bg-[rgba(5,10,18,0.18)]">
          <div className="rounded-lg border border-slate-700/70 bg-[rgba(7,13,22,0.88)] px-4 py-3 shadow-[0_14px_34px_rgba(0,0,0,0.45)]">
            <div className="flex items-center gap-3">
              <div
                className="h-9 w-9 animate-spin rounded-full border-2"
                style={{
                  borderColor: goldThemeEnabled ? "rgba(214,178,74,0.24)" : "rgba(41,98,255,0.25)",
                  borderTopColor: goldThemeEnabled ? GOLD_PRIMARY : "#2962ff",
                }}
              />
              <div className="flex min-w-[220px] flex-col">
                <span className="text-[11px] font-semibold tracking-[0.05em] text-slate-100">{dashboardLoadingHeadline}</span>
                <span className="text-[10px] text-slate-300">
                  {dashboardLoadingLabels.length > 1
                    ? `${dashboardLoadingLabels.length} datasets loading`
                    : "Fetching latest dataset"}
                </span>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
