"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarRange, Search } from "lucide-react";

import SeasonalityChart from "@/components/globe/charts/SeasonalityChart";
import { GlobeApi } from "@/lib/api";
import { AssetIcon } from "@/lib/icons";
import type { AssetItem, HeatmapAssetsResponse, HeatmapSeasonalityItem, SeasonalityResponse } from "@/types";

type DataSource = "tradingview" | "dukascopy" | "yahoo";

function formatPct(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

export default function SeasonalityPage() {
  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [payload, setPayload] = useState<SeasonalityResponse | null>(null);
  const [heatmap, setHeatmap] = useState<HeatmapAssetsResponse | null>(null);
  const [search, setSearch] = useState("");
  const [source, setSource] = useState<DataSource>("tradingview");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    GlobeApi.getAssets()
      .then((response) => {
        if (cancelled) return;
        setAssets(response.items);
        const first = response.items.find((asset) => asset.category === "Cross Pairs") ?? response.items[0];
        setSelectedAssetId(first?.id ?? "");
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
    GlobeApi.getSeasonality(selectedAssetId, source)
      .then((response) => {
        if (!cancelled) setPayload(response);
      })
      .catch(() => {
        if (!cancelled) setPayload(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedAssetId, source]);

  const selectedAsset = useMemo(
    () => assets.find((asset) => asset.id === selectedAssetId) ?? null,
    [assets, selectedAssetId],
  );

  const filteredAssets = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return [];
    return assets
      .filter((asset) => `${asset.name} ${asset.symbol} ${asset.category} ${asset.country}`.toLowerCase().includes(term))
      .slice(0, 18);
  }, [assets, search]);

  const rankedSeasonality = useMemo<HeatmapSeasonalityItem[]>(
    () => [...(heatmap?.tabs.seasonality.items ?? [])].sort((a, b) => b.score - a.score).slice(0, 12),
    [heatmap?.tabs.seasonality.items],
  );

  return (
    <main className="ivq-terminal-page">
      <section className="glass-panel ivq-terminal-hero">
        <div>
          <div className="ivq-section-label">Seasonality</div>
          <h1 className="ivq-terminal-title">Directional seasonality and holding windows</h1>
          <p className="ivq-terminal-subtitle">
            Asset search, ranking and best holding horizon on the existing seasonality engine.
          </p>
        </div>
        <div className="ivq-terminal-hero-meta">
          <div className="ivq-terminal-pill">{source.toUpperCase()}</div>
          <div className="ivq-terminal-pill">{payload?.updatedAt ? new Date(payload.updatedAt).toLocaleDateString("de-DE") : "Waiting for data"}</div>
        </div>
      </section>

      <div className="ivq-terminal-grid ivq-terminal-grid--seasonality">
        <aside className="space-y-4">
          <section className="glass-panel">
            <div className="ivq-section-label">Asset Search</div>
            <label className="ivq-form-row">
              <span>Universe</span>
              <div className="ivq-input-wrap">
                <Search size={14} strokeWidth={1.8} />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search all project assets" className="ivq-input" />
              </div>
            </label>
            <label className="ivq-form-row mt-3">
              <span>Source</span>
              <select value={source} onChange={(event) => setSource(event.target.value as DataSource)} className="ivq-select">
                <option value="tradingview">TradingView</option>
                <option value="dukascopy">Dukascopy</option>
                <option value="yahoo">Yahoo</option>
              </select>
            </label>

            <div className="mt-3 space-y-2">
              {(search ? filteredAssets : rankedSeasonality.map((item) => assets.find((asset) => asset.id === item.assetId)).filter(Boolean) as AssetItem[]).map((asset) => {
                const heatmapRow = rankedSeasonality.find((row) => row.assetId === asset.id);
                const active = asset.id === selectedAssetId;
                return (
                  <button key={asset.id} type="button" className={`ivq-list-row ${active ? "is-active" : ""}`} onClick={() => setSelectedAssetId(asset.id)}>
                    <div className="flex items-center gap-2">
                      <AssetIcon iconKey={asset.iconKey} category={asset.category} assetName={asset.name} />
                      <div className="text-left">
                        <div className="text-sm font-semibold text-slate-100">{asset.name}</div>
                        <div className="text-[11px] text-slate-400">{asset.category}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      {heatmapRow ? (
                        <>
                          <div className="text-sm font-semibold text-slate-100">{heatmapRow.bestHoldPeriod}d</div>
                          <div className="text-[11px] text-slate-400">{formatPct(heatmapRow.hitRate * 100)}</div>
                        </>
                      ) : (
                        <div className="text-[11px] text-slate-400">Select</div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="glass-panel">
            <div className="ivq-section-label">Top Seasonal Setups</div>
            <div className="space-y-2">
              {rankedSeasonality.map((item) => (
                <button key={item.assetId} type="button" className="ivq-list-row" onClick={() => setSelectedAssetId(item.assetId)}>
                  <div>
                    <div className="text-sm font-semibold text-slate-100">{item.name}</div>
                    <div className="text-[11px] text-slate-400">{item.direction} | {item.bestHoldPeriod} days</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold text-slate-100">{item.score.toFixed(0)}</div>
                    <div className="text-[11px] text-slate-400">{formatPct(item.expectedReturn)}</div>
                  </div>
                </button>
              ))}
            </div>
          </section>
        </aside>

        <section className="space-y-4">
          <section className="glass-panel">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="ivq-section-label">Selected Asset</div>
                <div className="flex items-center gap-2 text-lg font-semibold text-slate-100">
                  {selectedAsset ? <AssetIcon iconKey={selectedAsset.iconKey} category={selectedAsset.category} assetName={selectedAsset.name} className="!h-[18px] !w-[18px]" /> : null}
                  <span>{selectedAsset?.name ?? "No asset selected"}</span>
                </div>
              </div>
              <div className="ivq-terminal-pill">{payload?.stats.direction ?? "--"}</div>
            </div>
            <div className="h-[420px]">
              {loading ? (
                <div className="grid h-full place-items-center text-sm text-slate-400">Loading seasonality curve...</div>
              ) : (
                <SeasonalityChart payload={payload} />
              )}
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
            <section className="glass-panel">
              <div className="ivq-section-label">Statistics</div>
              <div className="ivq-stat-grid">
                <div className="ivq-stat-card">
                  <span className="ivq-stat-label">Best Hold</span>
                  <strong>{payload?.stats.bestHorizonDays ?? "--"} days</strong>
                </div>
                <div className="ivq-stat-card">
                  <span className="ivq-stat-label">Hit Rate</span>
                  <strong>{payload ? formatPct(payload.stats.hitRate * 100) : "--"}</strong>
                </div>
                <div className="ivq-stat-card">
                  <span className="ivq-stat-label">Expected Return</span>
                  <strong>{payload ? formatPct(payload.stats.expectedValue) : "--"}</strong>
                </div>
                <div className="ivq-stat-card">
                  <span className="ivq-stat-label">Projection</span>
                  <strong>{payload?.projectionDays ?? "--"} days</strong>
                </div>
                <div className="ivq-stat-card">
                  <span className="ivq-stat-label">Samples</span>
                  <strong>{payload?.stats.samples ?? "--"}</strong>
                </div>
                <div className="ivq-stat-card">
                  <span className="ivq-stat-label">Sharpe</span>
                  <strong>{payload?.stats.sharpeRatio?.toFixed(2) ?? "--"}</strong>
                </div>
                <div className="ivq-stat-card">
                  <span className="ivq-stat-label">Sortino</span>
                  <strong>{payload?.stats.sortinoRatio?.toFixed(2) ?? "--"}</strong>
                </div>
                <div className="ivq-stat-card">
                  <span className="ivq-stat-label">Avg 20d</span>
                  <strong>{payload ? formatPct(payload.stats.avgReturn20d) : "--"}</strong>
                </div>
              </div>
            </section>

            <section className="glass-panel">
              <div className="mb-3 flex items-center gap-2">
                <CalendarRange size={14} className="text-slate-300" />
                <div className="ivq-section-label mb-0">Best Windows</div>
              </div>
              <div className="space-y-2">
                {rankedSeasonality.slice(0, 8).map((item) => (
                  <button key={item.assetId} type="button" className="ivq-list-row" onClick={() => setSelectedAssetId(item.assetId)}>
                    <div>
                      <div className="text-sm font-semibold text-slate-100">{item.name}</div>
                      <div className="text-[11px] text-slate-400">{item.direction} | hold {item.bestHoldPeriod}d</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-slate-100">{formatPct(item.expectedValue)}</div>
                      <div className="text-[11px] text-slate-400">{formatPct(item.hitRate * 100)}</div>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}
