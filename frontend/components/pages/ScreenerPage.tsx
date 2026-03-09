"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { useDashboardStateStore } from "@/components/DashboardStateProvider";
import ScreenerHeaderCharts from "@/components/screener/ScreenerHeaderCharts";
import ScreenerSettingsDrawer from "@/components/screener/ScreenerSettingsDrawer";
import ScreenerTable from "@/components/screener/ScreenerTable";
import { GlobeApi } from "@/lib/api";
import { ensureAssets, ensureHeatmapAssets, ensureTimeseries } from "@/lib/dashboardPreload";
import { buildMacroAlignment } from "@/lib/screener/macro";
import {
  buildSelectedAnalysis,
  buildScreenerRow,
  type CompareSeriesMap,
} from "@/lib/screener/pineLikeEngine";
import { sortScreenerRows } from "@/lib/screener/screenerSort";
import type {
  PineScreenerRow,
  ScreenerMacroSnapshot,
  PineScreenerSettings,
  ScreenerSortDirection,
  ScreenerSortKey,
  ScreenerTheme,
} from "@/lib/screener/types";
import type {
  AssetItem,
  CommodityShockResponse,
  FundamentalOscillatorResponse,
  HeatmapAssetsResponse,
  HeatmapSeasonalityItem,
  InflationResponse,
  RiskResponse,
  SeasonalityResponse,
  TimeseriesResponse,
  VolatilityRegimeResponse,
} from "@/types";

function assetGroupOf(asset: AssetItem | null, category: string): string {
  const cat = String(asset?.category ?? category ?? "").toLowerCase();
  const assetId = String(asset?.id ?? "").toLowerCase();
  const name = String(asset?.name ?? "").toLowerCase();
  if (assetId.startsWith("cross_") || cat.includes("cross pair") || cat.includes("crosspair")) return "Forex Cross Pairs";
  if ((cat.includes("future") || cat.includes("futures")) && (cat.includes("fx") || cat.includes("currency"))) return "FX Futures";
  if (cat === "fx" || cat.includes("major fx") || cat.includes("currency")) return "FX Futures";
  if (cat.includes("crypto")) return "Crypto";
  if (cat.includes("metal") || name.includes("gold") || name.includes("silver") || name.includes("platinum")) return "Metals";
  if (cat.includes("energy") || cat.includes("agriculture") || cat.includes("soft") || cat.includes("livestock") || cat.includes("commodity")) return "Commodities";
  if (name.includes("s&p") || name.includes("nasdaq") || name.includes("dow") || name.includes("russell") || name.includes("dax")) return "Indices";
  if (cat.includes("equit") || cat.includes("stock") || cat.includes("share")) return "Aktien";
  return "Macro";
}

const LEGACY_DEFAULT_GROUPS = ["Forex Cross Pairs", "FX Futures", "Metals", "Commodities", "Aktien"];

function defaultSelectedGroupsFromAvailable(groups: string[]): string[] {
  const withoutStocks = groups.filter((group) => group !== "Aktien");
  return withoutStocks.length ? withoutStocks : groups;
}

const DEFAULT_SETTINGS: PineScreenerSettings = {
  source: "tradingview",
  timeframe: "D",
  screenerLookback: 2,
  valuationSignalWindow: "val20",
  valuationAgreementMode: "combined",
  selectedAssetGroups: LEGACY_DEFAULT_GROUPS,
  compareSymbol1: "DXY",
  compareSymbol2: "GC1!",
  compareSymbol3: "ZB1!",
  length: 20,
  rescaleLength: 100,
  top: 75,
  bottom: -75,
  comactive: true,
  comactive1: false,
  sd: true,
  sd1: true,
  candle: true,
  longg: true,
  shortt: true,
  dojiextrem: false,
  minBarsBeforeBox: 1,
  pauseBars: 3,
  yearsReq: 1,
  commercial: false,
  index1: false,
  smalltrader: false,
  indexsmall: false,
  andcot: false,
  umkehrcot: false,
  orcot: false,
  zeitfilter: false,
  zeitzone: -2,
  startHour: 14,
  startMinute: 0,
  endHour: 16,
  endMinute: 0,
  seasonalityThreshold: 60,
  weekdays: { mon: true, tue: true, wed: true, thu: true, fri: true },
  months: { jan: true, feb: true, mar: true, apr: true, may: true, jun: true, jul: true, aug: true, sep: true, oct: true, nov: true, dec: true },
};

function normalizeLookback(value: number | null | undefined): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_SETTINGS.screenerLookback;
  return Math.max(1, Math.round(numeric));
}

function canonicalizeScreenerSettings(value?: Partial<PineScreenerSettings> | null): PineScreenerSettings {
  const merged = {
    ...DEFAULT_SETTINGS,
    ...(value ?? {}),
  };
  return {
    ...merged,
    screenerLookback: normalizeLookback(merged.screenerLookback),
    valuationSignalWindow: "val20",
    valuationAgreementMode: "combined",
    comactive: true,
    comactive1: false,
    sd: true,
    sd1: true,
    candle: true,
    longg: true,
    shortt: true,
    selectedAssetGroups: uniqueGroups(merged.selectedAssetGroups),
  };
}

function compareLabel(symbol: string): string {
  const normalized = String(symbol).toUpperCase();
  if (normalized === "DXY") return "Dollar Index";
  if (normalized === "GC1!") return "Gold";
  if (normalized === "ZB1!" || normalized === "US10Y" || normalized === "^TNX") return "US 10Y";
  return normalized;
}

function loadingRow(asset: AssetItem, selectedAssetId: string | null): PineScreenerRow {
  return {
    assetId: asset.id,
    name: asset.name,
    symbol: asset.symbol,
    category: asset.category,
    assetGroup: assetGroupOf(asset, asset.category),
    signal: "neutral",
    signalDirection: "NONE",
    signalLabel: "Loading",
    entryState: "WAIT",
    entryConfirmed: false,
    priority: 0,
    ageBars: null,
    passesSignalFilter: false,
    seasonalityScore: 0,
    seasonalityDirection: "NEUTRAL",
    val10Combined: 0,
    val20Combined: 0,
    val10Direction: "NONE",
    val20Direction: "NONE",
    val10MatchCount: 0,
    val20MatchCount: 0,
    val10Components: [0, 0, 0, 0],
    val20Components: [0, 0, 0, 0],
    valuationPhase: "NEUTRAL",
    supplyDemandLabel: "Lade Zonen",
    supplyDemandStrongLabel: "Lade Zonen",
    supplyDemandStrength: "none",
    supplyDemandDirection: "neutral",
    hasNormalDemand: false,
    hasNormalSupply: false,
    hasStrongDemand: false,
    hasStrongSupply: false,
    currentPatternLabel: "Loading",
    currentPatternHoldDays: 0,
    currentPatternHitRate: 0,
    currentPatternAvgReturn: 0,
    nextPatternLabel: "Loading",
    nextPatternHoldDays: 0,
    nextPatternHitRate: 0,
    nextPatternAvgReturn: 0,
    seasonalityCurve: [],
    cpiAlignment: "neutral",
    ppiAlignment: "neutral",
    cotCommercialsAlignment: "neutral",
    riskAlignment: "neutral",
    lastCandles: [],
    selected: selectedAssetId === asset.id,
    loading: true,
  };
}

function uniqueGroups(groups: string[]): string[] {
  return Array.from(new Set(groups.filter(Boolean)));
}

function sameGroupSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const leftSorted = [...left].sort();
  const rightSorted = [...right].sort();
  return leftSorted.every((item, index) => item === rightSorted[index]);
}

function normalizeSelectedGroups(selectedGroups: string[], availableGroups: string[]): string[] {
  const normalized = uniqueGroups(selectedGroups).filter((group) => availableGroups.includes(group));
  return normalized.length ? normalized : defaultSelectedGroupsFromAvailable(availableGroups);
}

export default function ScreenerPage() {
  const dashboardStore = useDashboardStateStore();
  const persistedState = useMemo(
    () =>
      dashboardStore.getPageState<{
        settings?: PineScreenerSettings;
        draftSettings?: PineScreenerSettings;
        selectedAssetId?: string | null;
        sortKey?: ScreenerSortKey;
        sortDirection?: ScreenerSortDirection;
        drawerOpen?: boolean;
      }>("screener-pine") ?? {},
    [dashboardStore],
  );
  const [theme, setTheme] = useState<ScreenerTheme>("gold");
  const [assets, setAssets] = useState<AssetItem[]>(() => dashboardStore.getDataCache<AssetItem[]>("screener:assets") ?? []);
  const [heatmap, setHeatmap] = useState<HeatmapAssetsResponse | null>(null);
  const [settings, setSettings] = useState<PineScreenerSettings>(() => canonicalizeScreenerSettings(persistedState.settings));
  const [draftSettings, setDraftSettings] = useState<PineScreenerSettings>(() => canonicalizeScreenerSettings(persistedState.draftSettings ?? persistedState.settings));
  const [marketCache, setMarketCache] = useState<Record<string, TimeseriesResponse>>(
    () => dashboardStore.getDataCache<Record<string, TimeseriesResponse>>("screener:pine:market") ?? {},
  );
  const [seasonalityCache, setSeasonalityCache] = useState<Record<string, SeasonalityResponse | null>>(
    () => dashboardStore.getDataCache<Record<string, SeasonalityResponse | null>>("screener:pine:seasonality") ?? {},
  );
  const [compareCache, setCompareCache] = useState<Record<string, TimeseriesResponse>>(
    () => dashboardStore.getDataCache<Record<string, TimeseriesResponse>>("screener:pine:compare") ?? {},
  );
  const [macroSnapshot, setMacroSnapshot] = useState<ScreenerMacroSnapshot | null>(
    () => dashboardStore.getDataCache<ScreenerMacroSnapshot>("screener:macro:snapshot") ?? null,
  );
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(persistedState.selectedAssetId ?? null);
  const [sortKey, setSortKey] = useState<ScreenerSortKey>(persistedState.sortKey ?? "default");
  const [sortDirection, setSortDirection] = useState<ScreenerSortDirection>(persistedState.sortDirection ?? "desc");
  const [drawerOpen, setDrawerOpen] = useState<boolean>(persistedState.drawerOpen ?? false);
  const [scanProgress, setScanProgress] = useState<{ active: boolean; total: number; completed: number; startedAt: number }>({
    active: false,
    total: 0,
    completed: 0,
    startedAt: 0,
  });
  const groupDefaultsMigratedRef = useRef(false);
  const refreshVersion = dashboardStore.getRefreshVersion("screener");

  useEffect(() => {
    const readTheme = () => {
      try {
        const stored = window.localStorage.getItem("ivq_globe_gold_theme_v1");
        setTheme(stored === "0" ? "blue" : "gold");
      } catch {
        setTheme("gold");
      }
    };
    readTheme();
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([ensureAssets(refreshVersion > 0), ensureHeatmapAssets(settings.source, settings.timeframe, refreshVersion > 0)])
      .then(([assetItems, heatmapPayload]) => {
        if (cancelled) return;
        setAssets(assetItems);
        setHeatmap(heatmapPayload);
      })
      .catch(() => {
        if (cancelled) return;
        setAssets([]);
        setHeatmap(null);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshVersion, settings.source, settings.timeframe]);

  useEffect(() => {
    dashboardStore.setPageState("screener-pine", {
      settings,
      draftSettings,
      selectedAssetId,
      sortKey,
      sortDirection,
      drawerOpen,
    });
  }, [dashboardStore, draftSettings, drawerOpen, selectedAssetId, settings, sortDirection, sortKey]);

  useEffect(() => {
    dashboardStore.setDataCache("screener:pine:market", marketCache);
  }, [dashboardStore, marketCache]);

  useEffect(() => {
    dashboardStore.setDataCache("screener:pine:seasonality", seasonalityCache);
  }, [dashboardStore, seasonalityCache]);

  useEffect(() => {
    dashboardStore.setDataCache("screener:pine:compare", compareCache);
  }, [compareCache, dashboardStore]);

  useEffect(() => {
    if (macroSnapshot) {
      dashboardStore.setDataCache("screener:macro:snapshot", macroSnapshot);
    }
  }, [dashboardStore, macroSnapshot]);

  const availableGroups = useMemo(() => {
    return Array.from(new Set(assets.map((asset) => assetGroupOf(asset, asset.category)))).sort((left, right) => {
      const leftDefault = LEGACY_DEFAULT_GROUPS.indexOf(left);
      const rightDefault = LEGACY_DEFAULT_GROUPS.indexOf(right);
      if (leftDefault >= 0 && rightDefault >= 0) return leftDefault - rightDefault;
      if (leftDefault >= 0) return -1;
      if (rightDefault >= 0) return 1;
      return left.localeCompare(right);
    });
  }, [assets]);

  const assetGroupCounts = useMemo(
    () =>
      assets.reduce<Record<string, number>>((counts, asset) => {
        const group = assetGroupOf(asset, asset.category);
        counts[group] = (counts[group] ?? 0) + 1;
        return counts;
      }, {}),
    [assets],
  );

  useEffect(() => {
    if (!availableGroups.length || groupDefaultsMigratedRef.current) return;
    const persistedGroups = persistedState.settings?.selectedAssetGroups ?? [];
    const defaultGroups = defaultSelectedGroupsFromAvailable(availableGroups);
    const shouldApplyDefaultGroups =
      persistedGroups.length === 0 ||
      sameGroupSet(uniqueGroups(persistedGroups), uniqueGroups(LEGACY_DEFAULT_GROUPS)) ||
      sameGroupSet(uniqueGroups(persistedGroups), uniqueGroups(availableGroups));

    const normalizedSettingsGroups = shouldApplyDefaultGroups
      ? defaultGroups
      : normalizeSelectedGroups(settings.selectedAssetGroups, availableGroups);
    const normalizedDraftGroups = shouldApplyDefaultGroups
      ? defaultGroups
      : normalizeSelectedGroups(draftSettings.selectedAssetGroups, availableGroups);

    const settingsChanged = !sameGroupSet(uniqueGroups(settings.selectedAssetGroups), uniqueGroups(normalizedSettingsGroups));
    const draftChanged = !sameGroupSet(uniqueGroups(draftSettings.selectedAssetGroups), uniqueGroups(normalizedDraftGroups));

    if (settingsChanged) {
      setSettings((current) => canonicalizeScreenerSettings({ ...current, selectedAssetGroups: normalizedSettingsGroups }));
    }
    if (draftChanged) {
      setDraftSettings((current) => canonicalizeScreenerSettings({ ...current, selectedAssetGroups: normalizedDraftGroups }));
    }
    groupDefaultsMigratedRef.current = true;
  }, [availableGroups, draftSettings.selectedAssetGroups, persistedState.settings?.selectedAssetGroups, settings.selectedAssetGroups]);

  const filteredAssets = useMemo(
    () => assets.filter((asset) => settings.selectedAssetGroups.includes(assetGroupOf(asset, asset.category))),
    [assets, settings.selectedAssetGroups],
  );

  useEffect(() => {
    const compareSymbols = [settings.compareSymbol1, settings.compareSymbol2, settings.compareSymbol3];
    let cancelled = false;
    Promise.all(compareSymbols.map((symbol) => GlobeApi.getReferenceTimeseries(symbol, settings.timeframe, settings.source)))
      .then((responses) => {
        if (cancelled) return;
        setCompareCache((current) => {
          const next = { ...current };
          compareSymbols.forEach((symbol, index) => {
            next[`${settings.source}:${settings.timeframe}:${symbol}`] = responses[index];
          });
          return next;
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [settings.compareSymbol1, settings.compareSymbol2, settings.compareSymbol3, settings.source, settings.timeframe]);

  useEffect(() => {
    if (!filteredAssets.length) {
      setScanProgress({ active: false, total: 0, completed: 0, startedAt: 0 });
      return;
    }
    let cancelled = false;
    const pendingIds = filteredAssets
      .map((asset) => asset.id)
      .filter((assetId) => !marketCache[`${settings.source}:${settings.timeframe}:${assetId}`]);

    if (!pendingIds.length) {
      setScanProgress({ active: false, total: filteredAssets.length, completed: filteredAssets.length, startedAt: 0 });
      return;
    }

    const load = async () => {
      const total = filteredAssets.length;
      let completed = total - pendingIds.length;
      setScanProgress({ active: true, total, completed, startedAt: Date.now() });
      for (let index = 0; index < pendingIds.length; index += 8) {
        const batch = pendingIds.slice(index, index + 8);
        const responses = await Promise.allSettled(
          batch.map((assetId) =>
            ensureTimeseries(
              assetId,
              settings.timeframe,
              settings.source,
              refreshVersion > 0,
              refreshVersion > 0 ? refreshVersion : undefined,
            ),
          ),
        );
        if (cancelled) return;
        setMarketCache((current) => {
          const next = { ...current };
          responses.forEach((response, responseIndex) => {
            if (response.status === "fulfilled") {
              next[`${settings.source}:${settings.timeframe}:${batch[responseIndex]}`] = response.value;
            }
          });
          return next;
        });
        completed += batch.length;
        setScanProgress((current) => ({
          active: completed < total,
          total,
          completed,
          startedAt: current.startedAt || Date.now(),
        }));
      }
      if (!cancelled) {
        setScanProgress((current) => ({ ...current, active: false, total: filteredAssets.length, completed: filteredAssets.length }));
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [filteredAssets, marketCache, refreshVersion, settings.source, settings.timeframe]);

  useEffect(() => {
    let cancelled = false;
    const refreshMs = 15 * 60 * 1000;
    const shouldRefresh = !macroSnapshot || (Date.now() - Number(macroSnapshot.fetchedAt ?? 0)) >= refreshMs;

    const loadMacro = async () => {
      try {
        const [inflation, risk, volatility, fundamental, commodityShock] = await Promise.all([
          GlobeApi.getInflation(),
          GlobeApi.getRisk(),
          GlobeApi.getVolatilityRegime(),
          GlobeApi.getFundamentalMacro(),
          GlobeApi.getCommodityShock(),
        ]);
        if (cancelled) return;
        setMacroSnapshot({
          fetchedAt: Date.now(),
          inflation: inflation as InflationResponse,
          risk: risk as RiskResponse | null,
          volatility: volatility as VolatilityRegimeResponse,
          fundamental: fundamental as FundamentalOscillatorResponse,
          commodityShock: commodityShock as CommodityShockResponse,
        });
      } catch {
        if (!cancelled && !macroSnapshot) {
          setMacroSnapshot({
            fetchedAt: Date.now(),
            inflation: null,
            risk: null,
            volatility: null,
            fundamental: null,
            commodityShock: null,
          });
        }
      }
    };

    if (shouldRefresh) {
      void loadMacro();
    }

    const timer = window.setInterval(() => {
      void loadMacro();
    }, refreshMs);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [macroSnapshot]);

  useEffect(() => {
    if (!selectedAssetId || seasonalityCache[selectedAssetId] !== undefined) return;
    let cancelled = false;
    GlobeApi.getSeasonality(selectedAssetId, settings.source)
      .then((payload) => {
        if (!cancelled) {
          setSeasonalityCache((current) => ({ ...current, [selectedAssetId]: payload }));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSeasonalityCache((current) => ({ ...current, [selectedAssetId]: null }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [seasonalityCache, selectedAssetId, settings.source]);

  const heatmapSeasonalityByAsset = useMemo(
    () => Object.fromEntries((heatmap?.tabs.seasonality.items ?? []).map((item) => [item.assetId, item])),
    [heatmap?.tabs.seasonality.items],
  );

  const compareSeries = useMemo<CompareSeriesMap | null>(() => {
    const compare1 = compareCache[`${settings.source}:${settings.timeframe}:${settings.compareSymbol1}`];
    const compare2 = compareCache[`${settings.source}:${settings.timeframe}:${settings.compareSymbol2}`];
    const compare3 = compareCache[`${settings.source}:${settings.timeframe}:${settings.compareSymbol3}`];
    if (!compare1 || !compare2 || !compare3) return null;
    return {
      compare1: compare1.ohlcv.map((row) => ({ t: row.t, close: row.close })),
      compare2: compare2.ohlcv.map((row) => ({ t: row.t, close: row.close })),
      compare3: compare3.ohlcv.map((row) => ({ t: row.t, close: row.close })),
      compareLabel1: compareLabel(settings.compareSymbol1),
      compareLabel2: compareLabel(settings.compareSymbol2),
      compareLabel3: compareLabel(settings.compareSymbol3),
    };
  }, [compareCache, settings.compareSymbol1, settings.compareSymbol2, settings.compareSymbol3, settings.source, settings.timeframe]);

  const rows = useMemo(() => {
    const base = filteredAssets.map((asset) => {
      const timeseries = marketCache[`${settings.source}:${settings.timeframe}:${asset.id}`] ?? null;
      const seasonalityItem = (heatmapSeasonalityByAsset[asset.id] as HeatmapSeasonalityItem | undefined) ?? null;
      const built = buildScreenerRow(
        asset.id,
        asset.name,
        asset.symbol,
        asset.category,
        assetGroupOf(asset, asset.category),
        timeseries,
        seasonalityItem,
        compareSeries,
        settings,
        selectedAssetId,
      );
      return built ?? loadingRow(asset, selectedAssetId);
    });
    const enriched = base.map((row) => ({
      ...row,
      ...buildMacroAlignment(row, macroSnapshot),
    }));
    return sortScreenerRows(enriched, sortKey, sortDirection);
  }, [compareSeries, filteredAssets, heatmapSeasonalityByAsset, macroSnapshot, marketCache, selectedAssetId, settings, sortDirection, sortKey]);

  useEffect(() => {
    if (!rows.length) {
      setSelectedAssetId(null);
      return;
    }
    if (!selectedAssetId || !rows.some((row) => row.assetId === selectedAssetId)) {
      setSelectedAssetId(rows[0].assetId);
    }
  }, [rows, selectedAssetId]);

  const selectedAsset = useMemo(
    () => assets.find((asset) => asset.id === selectedAssetId) ?? null,
    [assets, selectedAssetId],
  );
  const selectedTimeseries = selectedAssetId ? marketCache[`${settings.source}:${settings.timeframe}:${selectedAssetId}`] ?? null : null;
  const selectedSeasonalityHeatmap = selectedAssetId ? (heatmapSeasonalityByAsset[selectedAssetId] as HeatmapSeasonalityItem | undefined) ?? null : null;
  const selectedSeasonality = selectedAssetId ? seasonalityCache[selectedAssetId] ?? null : null;
  const selectedAnalysis = useMemo(
    () => buildSelectedAnalysis(selectedAssetId ?? "", selectedTimeseries, selectedSeasonality, selectedSeasonalityHeatmap, compareSeries, settings),
    [compareSeries, selectedAssetId, selectedSeasonality, selectedSeasonalityHeatmap, selectedTimeseries, settings],
  );

  const loadedCount = useMemo(
    () => filteredAssets.filter((asset) => Boolean(marketCache[`${settings.source}:${settings.timeframe}:${asset.id}`])).length,
    [filteredAssets, marketCache, settings.source, settings.timeframe],
  );

  const scanPercent = useMemo(() => {
    if (scanProgress.total <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((scanProgress.completed / scanProgress.total) * 100)));
  }, [scanProgress.completed, scanProgress.total]);

  const scanEtaLabel = useMemo(() => {
    if (!scanProgress.active || scanProgress.completed <= 0 || scanProgress.total <= 0) return "Scan bereit";
    const elapsedMs = Date.now() - scanProgress.startedAt;
    const avgMs = elapsedMs / Math.max(scanProgress.completed, 1);
    const remainingMs = Math.max(0, (scanProgress.total - scanProgress.completed) * avgMs);
    const remainingSeconds = Math.ceil(remainingMs / 1000);
    return remainingSeconds > 90 ? `${Math.ceil(remainingSeconds / 60)} min verbleibend` : `${remainingSeconds}s verbleibend`;
  }, [scanProgress.active, scanProgress.completed, scanProgress.startedAt, scanProgress.total]);

  const handleSort = (key: ScreenerSortKey) => {
    if (sortKey === key) {
      setSortDirection((current) => current === "asc" ? "desc" : "asc");
      return;
    }
    setSortKey(key);
    setSortDirection(key === "asset" || key === "age" ? "asc" : "desc");
  };

  const handleRestoreDefaultSort = () => {
    setSortKey("default");
    setSortDirection("desc");
  };

  const handleRefresh = () => {
    dashboardStore.clearDataCache("screener:pine:market");
    dashboardStore.clearDataCache("screener:pine:seasonality");
    dashboardStore.clearDataCache("screener:pine:compare");
    setMarketCache({});
    setSeasonalityCache({});
    setCompareCache({});
    GlobeApi.clearCache((key) => key.includes("/api/assets") || key.includes("/api/reference/timeseries") || key.includes("/timeseries") || key.includes("/seasonality") || key.includes("/heatmap"));
    dashboardStore.bumpRefreshVersion("screener");
  };

  const handleApply = () => {
    setSettings(canonicalizeScreenerSettings(draftSettings));
  };

  return (
    <main className="ivq-terminal-page ivq-screener-pine-page">
      <div className="ivq-screener-page-head">
        <div className="ivq-screener-page-head__stats">
          <span>{rows.length} Assets</span>
          <span>{loadedCount}/{filteredAssets.length} geladen</span>
          <span>{scanPercent}% Scan</span>
          <span>{scanEtaLabel}</span>
          <span>{settings.source === "tradingview" ? "TradingView" : settings.source}</span>
          <ScreenerSettingsDrawer
            open={drawerOpen}
            settings={draftSettings}
            assetGroups={availableGroups}
            assetGroupCounts={assetGroupCounts}
            onToggle={() => setDrawerOpen((current) => !current)}
            onChange={(next) => setDraftSettings(canonicalizeScreenerSettings(next))}
            onApply={handleApply}
            onRefresh={handleRefresh}
            loadedCount={loadedCount}
            totalCount={filteredAssets.length}
            resultCount={rows.length}
            theme={theme}
          />
        </div>
      </div>

      <section className="glass-panel ivq-screener-progress-card" aria-label="Scan progress">
        <div className="ivq-screener-progress-card__head">
          <strong>Live Scan</strong>
          <span>{scanProgress.completed}/{Math.max(scanProgress.total, filteredAssets.length)} Assets</span>
        </div>
        <div className="ivq-screener-progress-bar">
          <div className="ivq-screener-progress-bar__fill" style={{ width: `${scanPercent}%` }} />
        </div>
      </section>

      <ScreenerHeaderCharts
        theme={theme}
        assetName={selectedAsset?.name ?? "Screener"}
        analysis={selectedAnalysis}
        settings={settings}
      />

      <ScreenerTable
        rows={rows}
        sortKey={sortKey}
        sortDirection={sortDirection}
        onSort={handleSort}
        onRestoreDefaultSort={handleRestoreDefaultSort}
        onSelectAsset={setSelectedAssetId}
        theme={theme}
      />
    </main>
  );
}
