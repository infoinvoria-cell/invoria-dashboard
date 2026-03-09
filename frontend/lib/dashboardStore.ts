"use client";

import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { createJSONStorage, persist } from "zustand/middleware";

import type { SimulationResults, DatasetOption } from "@/components/monte-carlo/types";
import type { TrackRecordTradeInput, TrackRecordModel } from "@/components/track-record/metrics";
import type { EdgeStrategyDocument } from "@/lib/edgePortfolioStore";
import type {
  AssetItem,
  HeatmapAssetsResponse,
  NewsResponse,
  TimeseriesResponse,
} from "@/types";

export type DashboardPageStateMap = Record<string, unknown>;
export type DashboardDataCacheMap = Record<string, unknown>;

export type TrackRecordDatasetPayload = DatasetOption;

export type TrackRecordApiPayload = {
  historicalEndDate: string | null;
  trades: TrackRecordTradeInput[];
  model: TrackRecordModel;
};

type DashboardSharedData = {
  assets: AssetItem[];
  marketData: Record<string, TimeseriesResponse>;
  screenerResults: Record<string, HeatmapAssetsResponse>;
  strategyData: {
    trackRecord: TrackRecordApiPayload | null;
    monteCarloTrackRecordDataset: TrackRecordDatasetPayload | null;
  };
  portfolioData: {
    strategies: EdgeStrategyDocument[];
  };
  newsData: {
    global: NewsResponse | null;
    assetById: Record<string, NewsResponse>;
  };
  monteCarloResults: SimulationResults | null;
};

type DashboardSharedMeta = {
  assetsUpdatedAt: number;
  marketDataUpdatedAt: Record<string, number>;
  screenerResultsUpdatedAt: Record<string, number>;
  strategyDataUpdatedAt: {
    trackRecord: number;
    monteCarloTrackRecordDataset: number;
  };
  portfolioDataUpdatedAt: {
    strategies: number;
  };
  newsDataUpdatedAt: {
    global: number;
    assetById: Record<string, number>;
  };
  monteCarloResultsUpdatedAt: number;
};

type DashboardStoreState = {
  pageState: DashboardPageStateMap;
  dataCache: DashboardDataCacheMap;
  refreshVersions: Record<string, number>;
  scrollPositions: Record<string, number>;
  sharedData: DashboardSharedData;
  sharedMeta: DashboardSharedMeta;
  getPageState: <T>(key: string) => T | undefined;
  setPageState: <T>(key: string, value: T) => void;
  getDataCache: <T>(key: string) => T | undefined;
  setDataCache: <T>(key: string, value: T) => void;
  clearDataCache: (key?: string) => void;
  getRefreshVersion: (key: string) => number;
  bumpRefreshVersion: (key: string) => void;
  getScrollPosition: (key: string) => number;
  setScrollPosition: (key: string, value: number) => void;
  setSharedAssets: (assets: AssetItem[]) => void;
  upsertMarketData: (key: string, payload: TimeseriesResponse) => void;
  setScreenerResult: (key: string, payload: HeatmapAssetsResponse) => void;
  setTrackRecordData: (payload: TrackRecordApiPayload | null) => void;
  setMonteCarloTrackRecordDataset: (payload: TrackRecordDatasetPayload | null) => void;
  setPortfolioStrategies: (payload: EdgeStrategyDocument[]) => void;
  setGlobalNews: (payload: NewsResponse | null) => void;
  setAssetNews: (assetId: string, payload: NewsResponse | null) => void;
  setMonteCarloResults: (payload: SimulationResults | null) => void;
};

type DashboardStateActions = Pick<
  DashboardStoreState,
  | "getPageState"
  | "setPageState"
  | "getDataCache"
  | "setDataCache"
  | "clearDataCache"
  | "getRefreshVersion"
  | "bumpRefreshVersion"
  | "getScrollPosition"
  | "setScrollPosition"
  | "setSharedAssets"
  | "upsertMarketData"
  | "setScreenerResult"
  | "setTrackRecordData"
  | "setMonteCarloTrackRecordDataset"
  | "setPortfolioStrategies"
  | "setGlobalNews"
  | "setAssetNews"
  | "setMonteCarloResults"
>;

const STORE_KEY = "ivq_dashboard_store_v2";

const DEFAULT_SHARED_DATA: DashboardSharedData = {
  assets: [],
  marketData: {},
  screenerResults: {},
  strategyData: {
    trackRecord: null,
    monteCarloTrackRecordDataset: null,
  },
  portfolioData: {
    strategies: [],
  },
  newsData: {
    global: null,
    assetById: {},
  },
  monteCarloResults: null,
};

const DEFAULT_SHARED_META: DashboardSharedMeta = {
  assetsUpdatedAt: 0,
  marketDataUpdatedAt: {},
  screenerResultsUpdatedAt: {},
  strategyDataUpdatedAt: {
    trackRecord: 0,
    monteCarloTrackRecordDataset: 0,
  },
  portfolioDataUpdatedAt: {
    strategies: 0,
  },
  newsDataUpdatedAt: {
    global: 0,
    assetById: {},
  },
  monteCarloResultsUpdatedAt: 0,
};

export const dashboardStoreApi = createStore<DashboardStoreState>()(
  persist(
    (set, get) => ({
      pageState: {},
      dataCache: {},
      refreshVersions: {},
      scrollPositions: {},
      sharedData: DEFAULT_SHARED_DATA,
      sharedMeta: DEFAULT_SHARED_META,
      getPageState: <T,>(key: string) => get().pageState[key] as T | undefined,
      setPageState: <T,>(key: string, value: T) =>
        set((state) => ({
          pageState: { ...state.pageState, [key]: value },
        })),
      getDataCache: <T,>(key: string) => get().dataCache[key] as T | undefined,
      setDataCache: <T,>(key: string, value: T) =>
        set((state) => ({
          dataCache: { ...state.dataCache, [key]: value },
        })),
      clearDataCache: (key?: string) =>
        set((state) => {
          if (!key) {
            return { dataCache: {} };
          }
          if (!(key in state.dataCache)) {
            return state;
          }
          const next = { ...state.dataCache };
          delete next[key];
          return { dataCache: next };
        }),
      getRefreshVersion: (key: string) => get().refreshVersions[key] ?? 0,
      bumpRefreshVersion: (key: string) =>
        set((state) => ({
          refreshVersions: { ...state.refreshVersions, [key]: (state.refreshVersions[key] ?? 0) + 1 },
        })),
      getScrollPosition: (key: string) => get().scrollPositions[key] ?? 0,
      setScrollPosition: (key: string, value: number) =>
        set((state) => ({
          scrollPositions: { ...state.scrollPositions, [key]: value },
        })),
      setSharedAssets: (assets: AssetItem[]) =>
        set((state) => ({
          sharedData: {
            ...state.sharedData,
            assets,
          },
          sharedMeta: {
            ...state.sharedMeta,
            assetsUpdatedAt: Date.now(),
          },
        })),
      upsertMarketData: (key: string, payload: TimeseriesResponse) =>
        set((state) => ({
          sharedData: {
            ...state.sharedData,
            marketData: {
              ...state.sharedData.marketData,
              [key]: payload,
            },
          },
          sharedMeta: {
            ...state.sharedMeta,
            marketDataUpdatedAt: {
              ...state.sharedMeta.marketDataUpdatedAt,
              [key]: Date.now(),
            },
          },
        })),
      setScreenerResult: (key: string, payload: HeatmapAssetsResponse) =>
        set((state) => ({
          sharedData: {
            ...state.sharedData,
            screenerResults: {
              ...state.sharedData.screenerResults,
              [key]: payload,
            },
          },
          sharedMeta: {
            ...state.sharedMeta,
            screenerResultsUpdatedAt: {
              ...state.sharedMeta.screenerResultsUpdatedAt,
              [key]: Date.now(),
            },
          },
        })),
      setTrackRecordData: (payload: TrackRecordApiPayload | null) =>
        set((state) => ({
          sharedData: {
            ...state.sharedData,
            strategyData: {
              ...state.sharedData.strategyData,
              trackRecord: payload,
            },
          },
          sharedMeta: {
            ...state.sharedMeta,
            strategyDataUpdatedAt: {
              ...state.sharedMeta.strategyDataUpdatedAt,
              trackRecord: Date.now(),
            },
          },
        })),
      setMonteCarloTrackRecordDataset: (payload: TrackRecordDatasetPayload | null) =>
        set((state) => ({
          sharedData: {
            ...state.sharedData,
            strategyData: {
              ...state.sharedData.strategyData,
              monteCarloTrackRecordDataset: payload,
            },
          },
          sharedMeta: {
            ...state.sharedMeta,
            strategyDataUpdatedAt: {
              ...state.sharedMeta.strategyDataUpdatedAt,
              monteCarloTrackRecordDataset: Date.now(),
            },
          },
        })),
      setPortfolioStrategies: (payload: EdgeStrategyDocument[]) =>
        set((state) => ({
          sharedData: {
            ...state.sharedData,
            portfolioData: {
              ...state.sharedData.portfolioData,
              strategies: payload,
            },
          },
          sharedMeta: {
            ...state.sharedMeta,
            portfolioDataUpdatedAt: {
              ...state.sharedMeta.portfolioDataUpdatedAt,
              strategies: Date.now(),
            },
          },
        })),
      setGlobalNews: (payload: NewsResponse | null) =>
        set((state) => ({
          sharedData: {
            ...state.sharedData,
            newsData: {
              ...state.sharedData.newsData,
              global: payload,
            },
          },
          sharedMeta: {
            ...state.sharedMeta,
            newsDataUpdatedAt: {
              ...state.sharedMeta.newsDataUpdatedAt,
              global: Date.now(),
            },
          },
        })),
      setAssetNews: (assetId: string, payload: NewsResponse | null) =>
        set((state) => ({
          sharedData: {
            ...state.sharedData,
            newsData: {
              ...state.sharedData.newsData,
              assetById: payload == null
                ? state.sharedData.newsData.assetById
                : { ...state.sharedData.newsData.assetById, [assetId]: payload },
            },
          },
          sharedMeta: {
            ...state.sharedMeta,
            newsDataUpdatedAt: {
              ...state.sharedMeta.newsDataUpdatedAt,
              assetById: {
                ...state.sharedMeta.newsDataUpdatedAt.assetById,
                [assetId]: Date.now(),
              },
            },
          },
        })),
      setMonteCarloResults: (payload: SimulationResults | null) =>
        set((state) => ({
          sharedData: {
            ...state.sharedData,
            monteCarloResults: payload,
          },
          sharedMeta: {
            ...state.sharedMeta,
            monteCarloResultsUpdatedAt: Date.now(),
          },
        })),
    }),
    {
      name: STORE_KEY,
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({
        pageState: state.pageState,
        scrollPositions: state.scrollPositions,
        sharedData: {
          assets: state.sharedData.assets,
          marketData: {},
          screenerResults: {},
          strategyData: state.sharedData.strategyData,
          portfolioData: state.sharedData.portfolioData,
          newsData: {
            global: state.sharedData.newsData.global,
            assetById: {},
          },
          monteCarloResults: state.sharedData.monteCarloResults,
        },
        sharedMeta: {
          ...state.sharedMeta,
          marketDataUpdatedAt: {},
          screenerResultsUpdatedAt: {},
          newsDataUpdatedAt: {
            ...state.sharedMeta.newsDataUpdatedAt,
            assetById: {},
          },
        },
      }),
    },
  ),
);

export function useDashboardStore<T>(selector: (state: DashboardStoreState) => T): T {
  return useStore(dashboardStoreApi, selector);
}

const dashboardStateActions: DashboardStateActions = {
  getPageState: <T,>(key: string) => dashboardStoreApi.getState().getPageState<T>(key),
  setPageState: <T,>(key: string, value: T) => dashboardStoreApi.getState().setPageState(key, value),
  getDataCache: <T,>(key: string) => dashboardStoreApi.getState().getDataCache<T>(key),
  setDataCache: <T,>(key: string, value: T) => dashboardStoreApi.getState().setDataCache(key, value),
  clearDataCache: (key?: string) => dashboardStoreApi.getState().clearDataCache(key),
  getRefreshVersion: (key: string) => dashboardStoreApi.getState().getRefreshVersion(key),
  bumpRefreshVersion: (key: string) => dashboardStoreApi.getState().bumpRefreshVersion(key),
  getScrollPosition: (key: string) => dashboardStoreApi.getState().getScrollPosition(key),
  setScrollPosition: (key: string, value: number) => dashboardStoreApi.getState().setScrollPosition(key, value),
  setSharedAssets: (assets: AssetItem[]) => dashboardStoreApi.getState().setSharedAssets(assets),
  upsertMarketData: (key: string, payload: TimeseriesResponse) => dashboardStoreApi.getState().upsertMarketData(key, payload),
  setScreenerResult: (key: string, payload: HeatmapAssetsResponse) => dashboardStoreApi.getState().setScreenerResult(key, payload),
  setTrackRecordData: (payload: TrackRecordApiPayload | null) => dashboardStoreApi.getState().setTrackRecordData(payload),
  setMonteCarloTrackRecordDataset: (payload: TrackRecordDatasetPayload | null) => dashboardStoreApi.getState().setMonteCarloTrackRecordDataset(payload),
  setPortfolioStrategies: (payload: EdgeStrategyDocument[]) => dashboardStoreApi.getState().setPortfolioStrategies(payload),
  setGlobalNews: (payload: NewsResponse | null) => dashboardStoreApi.getState().setGlobalNews(payload),
  setAssetNews: (assetId: string, payload: NewsResponse | null) => dashboardStoreApi.getState().setAssetNews(assetId, payload),
  setMonteCarloResults: (payload: SimulationResults | null) => dashboardStoreApi.getState().setMonteCarloResults(payload),
};

export function useDashboardStateStore(): DashboardStateActions {
  return dashboardStateActions;
}
