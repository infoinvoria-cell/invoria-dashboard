"use client";

import { GlobeApi } from "@/lib/api";
import { dashboardStoreApi, type TrackRecordApiPayload, type TrackRecordDatasetPayload } from "@/lib/dashboardStore";
import type { EdgeStrategyDocument } from "@/lib/edgePortfolioStore";
import type { AssetItem, HeatmapAssetsResponse, NewsResponse, TimeseriesResponse } from "@/types";

const ASSETS_TTL_MS = 30 * 60 * 1000;
const HEATMAP_TTL_MS = 45 * 1000;
const TIMESERIES_TTL_MS = 60 * 1000;
const TRACK_RECORD_TTL_MS = 5 * 60 * 1000;
const PORTFOLIO_TTL_MS = 5 * 60 * 1000;
const NEWS_TTL_MS = 7 * 60 * 1000;
const MONTE_CARLO_TRACK_RECORD_TTL_MS = 5 * 60 * 1000;

const inflight = new Map<string, Promise<unknown>>();

function dedupe<T>(key: string, factory: () => Promise<T>): Promise<T> {
  const current = inflight.get(key);
  if (current) {
    return current as Promise<T>;
  }

  const next = factory().finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, next);
  return next;
}

function isFresh(updatedAt: number, ttlMs: number): boolean {
  return Number.isFinite(updatedAt) && updatedAt > 0 && Date.now() - updatedAt <= ttlMs;
}

export function marketDataKey(assetId: string, timeframe = "D", source = "tradingview"): string {
  return `${String(source).toLowerCase()}:${String(timeframe).toUpperCase()}:${String(assetId).toLowerCase()}`;
}

export function screenerHeatmapKey(source = "tradingview", timeframe = "D"): string {
  return `screener:${String(source).toLowerCase()}:${String(timeframe).toUpperCase()}`;
}

export async function ensureAssets(force = false): Promise<AssetItem[]> {
  const state = dashboardStoreApi.getState();
  if (!force && state.sharedData.assets.length > 0 && isFresh(state.sharedMeta.assetsUpdatedAt, ASSETS_TTL_MS)) {
    return state.sharedData.assets;
  }

  return dedupe("assets", async () => {
    const response = await GlobeApi.getAssets();
    dashboardStoreApi.getState().setSharedAssets(response.items);
    dashboardStoreApi.getState().setDataCache("screener:assets", response.items);
    dashboardStoreApi.getState().setDataCache("seasonality:assets", response.items);
    return response.items;
  });
}

export async function ensureHeatmapAssets(source = "tradingview", timeframe = "D", force = false): Promise<HeatmapAssetsResponse> {
  const key = screenerHeatmapKey(source, timeframe);
  const state = dashboardStoreApi.getState();
  const cached = state.sharedData.screenerResults[key];
  const updatedAt = state.sharedMeta.screenerResultsUpdatedAt[key] ?? 0;
  if (!force && cached && isFresh(updatedAt, HEATMAP_TTL_MS)) {
    return cached;
  }

  return dedupe(`heatmap:${key}`, async () => {
    const response = await GlobeApi.getHeatmapAssets(timeframe, source);
    const api = dashboardStoreApi.getState();
    api.setScreenerResult(key, response);
    api.setDataCache(`screener:heatmap:${source}:${timeframe}`, response);
    api.setDataCache(`seasonality:heatmap:${source}`, response);
    return response;
  });
}

export async function ensureTimeseries(
  assetId: string,
  timeframe = "D",
  source = "tradingview",
  force = false,
  refreshBucket?: number,
): Promise<TimeseriesResponse> {
  const key = marketDataKey(assetId, timeframe, source);
  const state = dashboardStoreApi.getState();
  const cached = state.sharedData.marketData[key];
  const updatedAt = state.sharedMeta.marketDataUpdatedAt[key] ?? 0;
  if (!force && cached && isFresh(updatedAt, TIMESERIES_TTL_MS)) {
    return cached;
  }

  const refreshKey = Number.isFinite(Number(refreshBucket)) ? `:rb${Math.floor(Number(refreshBucket))}` : "";
  return dedupe(`timeseries:${key}${refreshKey}`, async () => {
    const response = await GlobeApi.getTimeseries(assetId, timeframe, source, "backadjusted", refreshBucket);
    const api = dashboardStoreApi.getState();
    api.upsertMarketData(key, response);
    api.setDataCache(`screener:market:${key}`, response);
    return response;
  });
}

export async function ensureTrackRecord(force = false): Promise<TrackRecordApiPayload> {
  const state = dashboardStoreApi.getState();
  const cached = state.sharedData.strategyData.trackRecord;
  const updatedAt = state.sharedMeta.strategyDataUpdatedAt.trackRecord;
  if (!force && cached && isFresh(updatedAt, TRACK_RECORD_TTL_MS)) {
    return cached;
  }

  return dedupe("track-record", async () => {
    const response = await fetch("/api/track-record/trades", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Failed to load track record.");
    }
    const payload = (await response.json()) as TrackRecordApiPayload;
    const api = dashboardStoreApi.getState();
    api.setTrackRecordData(payload);
    api.setDataCache("track-record:model", payload.model);
    return payload;
  });
}

export async function ensurePortfolioStrategies(force = false): Promise<EdgeStrategyDocument[]> {
  const state = dashboardStoreApi.getState();
  const cached = state.sharedData.portfolioData.strategies;
  const updatedAt = state.sharedMeta.portfolioDataUpdatedAt.strategies;
  if (!force && cached.length > 0 && isFresh(updatedAt, PORTFOLIO_TTL_MS)) {
    return cached;
  }

  return dedupe("edge-portfolio:strategies", async () => {
    const response = await fetch("/api/edge-portfolio/strategies", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Failed to load strategies.");
    }
    const payload = (await response.json()) as { strategies?: EdgeStrategyDocument[] };
    const strategies = payload.strategies ?? [];
    const api = dashboardStoreApi.getState();
    api.setPortfolioStrategies(strategies);
    api.setDataCache("edge-portfolio:strategies", strategies);
    return strategies;
  });
}

export async function ensureGlobalNews(force = false): Promise<NewsResponse> {
  const state = dashboardStoreApi.getState();
  const cached = state.sharedData.newsData.global;
  const updatedAt = state.sharedMeta.newsDataUpdatedAt.global;
  if (!force && cached && isFresh(updatedAt, NEWS_TTL_MS)) {
    return cached;
  }

  return dedupe("news:global", async () => {
    const response = await GlobeApi.getGlobalNews();
    dashboardStoreApi.getState().setGlobalNews(response);
    return response;
  });
}

export async function ensureMonteCarloTrackRecordDataset(force = false): Promise<TrackRecordDatasetPayload> {
  const state = dashboardStoreApi.getState();
  const cached = state.sharedData.strategyData.monteCarloTrackRecordDataset;
  const updatedAt = state.sharedMeta.strategyDataUpdatedAt.monteCarloTrackRecordDataset;
  if (!force && cached && isFresh(updatedAt, MONTE_CARLO_TRACK_RECORD_TTL_MS)) {
    return cached;
  }

  return dedupe("monte-carlo:track-record", async () => {
    const response = await fetch("/api/monte-carlo/track-record", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Failed to load Monte Carlo track record dataset.");
    }
    const payload = (await response.json()) as TrackRecordDatasetPayload;
    dashboardStoreApi.getState().setMonteCarloTrackRecordDataset(payload);
    dashboardStoreApi.getState().setDataCache("monte-carlo:track-record-dataset", payload);
    return payload;
  });
}

export async function preloadCoreData(): Promise<void> {
  const assets = await ensureAssets();
  const priorityAssets = assets
    .filter((asset) => asset.watchlistFeatured || asset.defaultEnabled)
    .slice(0, 10);

  await Promise.allSettled([
    ensureHeatmapAssets("tradingview", "D"),
    ensureTrackRecord(),
    ensurePortfolioStrategies(),
    ensureGlobalNews(),
    ensureMonteCarloTrackRecordDataset(),
    ...priorityAssets.map((asset) => ensureTimeseries(asset.id, "D", "tradingview")),
  ]);
}

export async function preloadRouteData(pathname: string): Promise<void> {
  if (pathname.startsWith("/dashboard")) {
    await Promise.allSettled([
      ensureHeatmapAssets("tradingview", "D"),
      ensureGlobalNews(),
      ensurePortfolioStrategies(),
      ensureTrackRecord(),
    ]);
    return;
  }

  if (pathname.startsWith("/screener")) {
    await Promise.allSettled([
      ensureAssets(),
      ensureHeatmapAssets("tradingview", "D"),
      ensureGlobalNews(),
      ensurePortfolioStrategies(),
    ]);
    return;
  }

  if (pathname.startsWith("/seasonality")) {
    await Promise.allSettled([
      ensureAssets(),
      ensureHeatmapAssets("tradingview", "D"),
      ensureGlobalNews(),
    ]);
    return;
  }

  if (pathname.startsWith("/track-record")) {
    await Promise.allSettled([
      ensureTrackRecord(),
      ensurePortfolioStrategies(),
      ensureMonteCarloTrackRecordDataset(),
    ]);
    return;
  }

  if (pathname.startsWith("/edge-portfolio")) {
    await Promise.allSettled([
      ensurePortfolioStrategies(),
      ensureTrackRecord(),
      ensureMonteCarloTrackRecordDataset(),
    ]);
    return;
  }

  if (pathname.startsWith("/monte-carlo")) {
    await Promise.allSettled([
      ensureMonteCarloTrackRecordDataset(),
      ensureTrackRecord(),
      ensurePortfolioStrategies(),
    ]);
  }
}
