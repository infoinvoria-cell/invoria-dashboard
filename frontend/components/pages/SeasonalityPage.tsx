"use client";

import { Search, Settings2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import SeasonalityWinrateChart from "@/components/seasonality/SeasonalityWinrateChart";
import SeasonalityChart from "@/components/globe/charts/SeasonalityChart";
import { GlobeApi } from "@/lib/api";
import { AssetIcon } from "@/lib/icons";
import {
  buildSeasonalityWorkbench,
  dayLabel,
  type SeasonalCandidate,
} from "@/lib/seasonalityWorkbench";
import type {
  AssetItem,
  HeatmapAssetsResponse,
  HeatmapSeasonalityItem,
  SeasonalityResponse,
  TimeseriesResponse,
} from "@/types";

type DataSource = "tradingview" | "dukascopy" | "yahoo";
type ThemeMode = "gold" | "blue";

function dayOfYearNow(): number {
  const now = new Date();
  const start = Date.UTC(now.getUTCFullYear(), 0, 1);
  const current = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((current - start) / 86_400_000) + 1;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function formatPct(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatCandidate(candidate: SeasonalCandidate | null): string {
  if (!candidate) return "--";
  return `${dayLabel(candidate.startDay)} -> ${dayLabel(candidate.endDay)} | ${candidate.direction} | ${candidate.holdDays}d`;
}

function detailTone(value: string): string {
  const probe = String(value || "").toLowerCase();
  if (probe === "--") return "text-slate-400";
  if (probe.includes("long") || probe.startsWith("+")) return "text-emerald-300";
  if (probe.includes("short") || probe.startsWith("-")) return "text-rose-300";
  return "text-slate-100";
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[16px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))] px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="text-[9px] uppercase tracking-[0.18em] text-slate-400">{label}</div>
      <div className={`mt-1.5 text-[15px] font-semibold leading-tight ${detailTone(value)}`}>{value}</div>
    </div>
  );
}

export default function SeasonalityPage() {
  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [payload, setPayload] = useState<SeasonalityResponse | null>(null);
  const [selectedTimeseries, setSelectedTimeseries] = useState<TimeseriesResponse | null>(null);
  const [heatmap, setHeatmap] = useState<HeatmapAssetsResponse | null>(null);
  const [search, setSearch] = useState("");
  const [source, setSource] = useState<DataSource>("tradingview");
  const [years, setYears] = useState(10);
  const [minHold, setMinHold] = useState(10);
  const [maxHold, setMaxHold] = useState(20);
  const [rangeStartDay, setRangeStartDay] = useState(() => clamp(dayOfYearNow(), 1, 346));
  const [rangeEndDay, setRangeEndDay] = useState(() => clamp(dayOfYearNow() + 20, 2, 366));
  const [loading, setLoading] = useState(true);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [theme, setTheme] = useState<ThemeMode>("blue");

  useEffect(() => {
    const readTheme = () => {
      try {
        const stored = window.localStorage.getItem("ivq_globe_gold_theme_v1");
        setTheme(stored === "0" ? "blue" : "gold");
      } catch {
        setTheme("blue");
      }
    };
    readTheme();
  }, []);

  useEffect(() => {
    let cancelled = false;
    GlobeApi.getAssets()
      .then((response) => {
        if (cancelled) return;
        setAssets(response.items);
        setSelectedAssetId((current) => current || response.items[0]?.id || "");
      })
      .catch(() => {
        if (!cancelled) setAssets([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    GlobeApi.getHeatmapAssets("D", source)
      .then((response) => {
        if (!cancelled) setHeatmap(response);
      })
      .catch(() => {
        if (!cancelled) setHeatmap(null);
      });
    return () => {
      cancelled = true;
    };
  }, [source]);

  useEffect(() => {
    if (!selectedAssetId) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      GlobeApi.getSeasonality(selectedAssetId, source, years),
      GlobeApi.getTimeseries(selectedAssetId, "D", source, "backadjusted"),
    ])
      .then(([seasonalityResponse, timeseriesResponse]) => {
        if (cancelled) return;
        setPayload(seasonalityResponse);
        setSelectedTimeseries(timeseriesResponse);
      })
      .catch(() => {
        if (cancelled) return;
        setPayload(null);
        setSelectedTimeseries(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedAssetId, source, years]);

  const selectedAsset = useMemo(
    () => assets.find((asset) => asset.id === selectedAssetId) ?? null,
    [assets, selectedAssetId],
  );

  const filteredAssets = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return assets;
    return assets.filter((asset) => `${asset.name} ${asset.symbol} ${asset.category} ${asset.country}`.toLowerCase().includes(term));
  }, [assets, search]);

  const selectedHeatmapRow = useMemo<HeatmapSeasonalityItem | null>(
    () => heatmap?.tabs.seasonality.items.find((item) => item.assetId === selectedAssetId) ?? null,
    [heatmap?.tabs.seasonality.items, selectedAssetId],
  );

  const safeRangeStart = Math.min(rangeStartDay, rangeEndDay);
  const safeRangeEnd = Math.max(rangeStartDay, rangeEndDay);
  const selectedHoldDays = clamp(Math.max(1, safeRangeEnd - safeRangeStart), minHold, maxHold);
  const workbench = useMemo(
    () =>
      buildSeasonalityWorkbench(
        selectedTimeseries?.ohlcv ?? [],
        years,
        minHold,
        maxHold,
        safeRangeStart,
        safeRangeEnd,
      ),
    [maxHold, minHold, safeRangeEnd, safeRangeStart, selectedTimeseries?.ohlcv, years],
  );

  const themeColor = theme === "gold" ? "#d6c38f" : "#4d87fe";

  const handleRangeChange = (startDay: number, endDay: number) => {
    const safeStart = clamp(Math.min(startDay, endDay), 1, 366);
    const desiredHold = clamp(Math.max(1, Math.abs(endDay - startDay)), minHold, maxHold);
    const normalizedStart = clamp(safeStart, 1, 366 - desiredHold);
    setRangeStartDay(normalizedStart);
    setRangeEndDay(clamp(normalizedStart + desiredHold, normalizedStart + 1, 366));
  };

  return (
    <main className="ivq-terminal-page xl:min-h-[calc(100dvh-50px)]">
      <div className="grid h-full min-h-0 gap-4 xl:grid-cols-[232px_minmax(0,1fr)_320px]">
        <aside className="glass-panel flex min-h-0 max-h-[38dvh] flex-col gap-3 self-start !p-3 xl:max-h-[calc(100dvh-124px)]">
          <div className="ivq-input-wrap">
            <Search size={14} strokeWidth={1.8} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Asset suchen" className="ivq-input" />
          </div>
          <div className="scroll-thin min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
            {filteredAssets.map((asset) => (
              <button
                key={asset.id}
                type="button"
                className={`ivq-list-row ${asset.id === selectedAssetId ? "is-active" : ""}`}
                onClick={() => setSelectedAssetId(asset.id)}
              >
                <div className="flex items-center gap-2">
                  <AssetIcon iconKey={asset.iconKey} category={asset.category} assetName={asset.name} />
                  <span className="text-sm font-semibold text-slate-100">{asset.name}</span>
                </div>
              </button>
            ))}
          </div>
        </aside>

        <section className="grid min-h-0 gap-3 xl:grid-rows-[auto_minmax(0,1fr)_208px]">
          <section className="glass-panel flex items-center justify-between gap-3 !p-3">
            <div className="flex items-center gap-2">
              {selectedAsset ? <AssetIcon iconKey={selectedAsset.iconKey} category={selectedAsset.category} assetName={selectedAsset.name} className="!h-[18px] !w-[18px]" /> : null}
              <div className="text-base font-semibold text-slate-100">{selectedAsset?.name ?? "Seasonality"}</div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="ivq-terminal-pill">{dayLabel(safeRangeStart)} - {dayLabel(safeRangeEnd)}</div>
              <div className="ivq-terminal-pill">{Math.max(10, years)} Jahre</div>
              <button type="button" className="ivq-segment-btn" onClick={() => setDetailsOpen((current) => !current)}>
                <Settings2 size={14} /> Details
              </button>
            </div>
          </section>

          <section className="glass-panel grid min-h-0 gap-3 !p-3.5 xl:grid-rows-[minmax(0,1fr)_94px]">
            <div className="grid min-h-0 gap-3 xl:grid-cols-[minmax(0,1fr)_272px]">
              <div className="min-h-[320px] xl:min-h-0">
                {loading ? (
                  <div className="grid h-full place-items-center text-sm text-slate-400">Lade Jahres-Saisonalitaet...</div>
                ) : (
                  <SeasonalityChart
                    payload={payload}
                    lineColor={themeColor}
                    rangeStartDay={safeRangeStart}
                    rangeEndDay={safeRangeEnd}
                    minHold={minHold}
                    maxHold={maxHold}
                    onRangeChange={handleRangeChange}
                  />
                )}
              </div>
              <div className="grid content-start gap-2 sm:grid-cols-2 xl:grid-cols-1">
                <DetailRow label="Current Pattern" value={formatCandidate(workbench.currentPattern)} />
                <DetailRow label="Current Winrate" value={workbench.currentPattern ? `${workbench.currentPattern.winRate.toFixed(0)}%` : "--"} />
                <DetailRow label="Current Avg Return" value={workbench.currentPattern ? formatPct(workbench.currentPattern.averageReturn) : "--"} />
                <DetailRow label="Current Hold" value={workbench.currentPattern ? `${workbench.currentPattern.holdDays} Tage` : "--"} />
                <DetailRow label="Selected Range" value={`${dayLabel(safeRangeStart)} - ${dayLabel(safeRangeEnd)}`} />
                <DetailRow label="Data Base" value={`${payload?.yearsUsed ?? Math.max(10, years)} Jahre`} />
              </div>
            </div>
            <div className="grid gap-3 rounded-[16px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] px-3.5 py-3 sm:grid-cols-[minmax(0,1fr)_170px_150px]">
              <div className="text-[10px] uppercase tracking-[0.16em] text-slate-300">
                Range direkt im Chart mit der Maus ziehen. Haltedauer wird automatisch auf {minHold}-{maxHold} Tage begrenzt.
              </div>
              <div className="text-right text-[10px] uppercase tracking-[0.14em] text-slate-400">
                <div>Selected Hold</div>
                <div className="mt-1 text-sm font-semibold text-slate-100">{selectedHoldDays} Tage</div>
              </div>
              <div className="text-right text-[10px] uppercase tracking-[0.14em] text-slate-400">
                <div>Range</div>
                <div className="mt-1 text-sm font-semibold text-slate-100">{dayLabel(safeRangeStart)} - {dayLabel(safeRangeEnd)}</div>
              </div>
            </div>
          </section>

          <section className="glass-panel flex min-h-0 flex-col gap-3 !p-3.5">
            <div className="flex items-center justify-between gap-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-300">
              <span>Winrate 01.01 - 31.12</span>
              <span className="rounded-full border border-white/10 px-2 py-1 text-[10px] tracking-[0.14em]">{minHold}-{maxHold} Tage Hold</span>
            </div>
            <div className="min-h-[190px] flex-1">
              <SeasonalityWinrateChart
                points={workbench.dayCurve}
                rangeStartDay={safeRangeStart}
                rangeEndDay={safeRangeEnd}
                themeColor={themeColor}
              />
            </div>
          </section>
        </section>

        <aside className="glass-panel flex min-h-0 flex-col gap-3 !p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-300">Details</div>
            <button type="button" className="ivq-segment-btn" onClick={() => setDetailsOpen((current) => !current)}>
              {detailsOpen ? "Hide" : "Show"}
            </button>
          </div>

          {detailsOpen ? (
            <div className="grid min-h-0 flex-1 content-start gap-2 overflow-auto sm:grid-cols-2 xl:grid-cols-1">
              <label className="ivq-form-row">
                <span>Source</span>
                <select value={source} onChange={(event) => setSource(event.target.value as DataSource)} className="ivq-select">
                  <option value="tradingview">TradingView</option>
                  <option value="dukascopy">Dukascopy</option>
                  <option value="yahoo">Yahoo</option>
                </select>
              </label>
              <label className="ivq-form-row">
                <span>Years</span>
                <input type="number" min={10} value={years} onChange={(event) => setYears(Math.max(10, Number(event.target.value) || 10))} className="ivq-select" />
              </label>
              <label className="ivq-form-row">
                <span>Min Hold</span>
                <input type="number" min={1} max={90} value={minHold} onChange={(event) => setMinHold(clamp(Number(event.target.value) || 10, 1, maxHold))} className="ivq-select" />
              </label>
              <label className="ivq-form-row">
                <span>Max Hold</span>
                <input type="number" min={minHold} max={120} value={maxHold} onChange={(event) => setMaxHold(clamp(Number(event.target.value) || 20, minHold, 120))} className="ivq-select" />
              </label>

              <DetailRow label="Current Pattern" value={formatCandidate(workbench.currentPattern)} />
              <DetailRow label="Current Samples" value={String(workbench.currentPattern?.samples ?? "--")} />
              <DetailRow label="Next Pattern" value={formatCandidate(workbench.nextPattern)} />
              <DetailRow label="Next Winrate" value={workbench.nextPattern ? `${workbench.nextPattern.winRate.toFixed(0)}%` : "--"} />
              <DetailRow label="Next Avg Return" value={workbench.nextPattern ? formatPct(workbench.nextPattern.averageReturn) : "--"} />
              <DetailRow label="Seasonality EV" value={payload ? formatPct(payload.stats.expectedValue) : "--"} />
              <DetailRow label="Heatmap Return" value={selectedHeatmapRow ? formatPct(selectedHeatmapRow.expectedReturn) : "--"} />
              <DetailRow label="Sharpe" value={payload?.stats.sharpeRatio?.toFixed(2) ?? "--"} />
              <DetailRow label="Sortino" value={payload?.stats.sortinoRatio?.toFixed(2) ?? "--"} />
            </div>
          ) : (
            <div className="grid flex-1 place-items-center text-sm text-slate-500">Details ausgeblendet</div>
          )}
        </aside>
      </div>
    </main>
  );
}
