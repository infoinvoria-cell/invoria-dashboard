"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Search, TrendingDown, TrendingUp } from "lucide-react";

import SimpleLineChart from "@/components/charts/SimpleLineChart";
import { GlobeApi } from "@/lib/api";
import { AssetIcon } from "@/lib/icons";
import type {
  AlertItem,
  AssetItem,
  AssetSignalDetailResponse,
  CategoryHeatmapItem,
  CategoryHeatmapResponse,
  OpportunitiesResponse,
  TimeseriesResponse,
} from "@/types";

type DataSource = "tradingview" | "dukascopy" | "yahoo";

function scoreTone(score: number): string {
  if (score >= 80) return "text-emerald-300";
  if (score >= 60) return "text-blue-200";
  if (score >= 40) return "text-slate-200";
  if (score >= 20) return "text-amber-200";
  return "text-rose-300";
}

function toneChip(tone: string): string {
  const t = String(tone || "").toLowerCase();
  if (t.includes("bull")) return "bg-emerald-500/12 text-emerald-200 border-emerald-400/30";
  if (t.includes("bear")) return "bg-rose-500/12 text-rose-200 border-rose-400/30";
  return "bg-slate-500/12 text-slate-200 border-slate-400/30";
}

function formatPct(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

export default function ScreenerPage() {
  const [assets, setAssets] = useState<AssetItem[]>([]);
  const [heatmap, setHeatmap] = useState<CategoryHeatmapResponse | null>(null);
  const [opportunities, setOpportunities] = useState<OpportunitiesResponse | null>(null);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [detail, setDetail] = useState<AssetSignalDetailResponse | null>(null);
  const [timeseries, setTimeseries] = useState<TimeseriesResponse | null>(null);
  const [source, setSource] = useState<DataSource>("tradingview");
  const [category, setCategory] = useState("Equities");
  const [sortBy, setSortBy] = useState("ai_score");
  const [query, setQuery] = useState("");
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);

  useEffect(() => {
    let cancelled = false;
    GlobeApi.getAssets()
      .then((payload) => {
        if (!cancelled) setAssets(payload.items);
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
    setLoadingList(true);
    Promise.all([
      GlobeApi.getCategoryHeatmap(category, sortBy, source),
      GlobeApi.getOpportunities(source),
      GlobeApi.getAlerts(source),
    ])
      .then(([nextHeatmap, nextOpportunities, nextAlerts]) => {
        if (cancelled) return;
        setHeatmap(nextHeatmap);
        setOpportunities(nextOpportunities);
        setAlerts(nextAlerts.items);
        setSelectedAssetId((current) => (
          current && nextHeatmap.items.some((item) => item.assetId === current)
            ? current
            : (nextHeatmap.items[0]?.assetId ?? "")
        ));
      })
      .catch(() => {
        if (cancelled) return;
        setHeatmap({ updatedAt: "", category, sortBy, categories: [], items: [] });
        setOpportunities({ updatedAt: "", long: [], short: [] });
        setAlerts([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingList(false);
      });
    return () => {
      cancelled = true;
    };
  }, [category, sortBy, source]);

  useEffect(() => {
    if (!selectedAssetId) {
      setDetail(null);
      setTimeseries(null);
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
    Promise.all([
      GlobeApi.getAssetSignalDetail(selectedAssetId, source),
      GlobeApi.getTimeseries(selectedAssetId, "D", source),
    ])
      .then(([nextDetail, nextTimeseries]) => {
        if (cancelled) return;
        setDetail(nextDetail);
        setTimeseries(nextTimeseries);
      })
      .catch(() => {
        if (cancelled) return;
        setDetail(null);
        setTimeseries(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedAssetId, source]);

  const filteredItems = useMemo(() => {
    const items = heatmap?.items ?? [];
    const term = query.trim().toLowerCase();
    if (!term) return items;
    return items.filter((item) => `${item.name} ${item.assetId} ${item.category}`.toLowerCase().includes(term));
  }, [heatmap?.items, query]);

  const selectedItem = useMemo<CategoryHeatmapItem | null>(
    () => filteredItems.find((item) => item.assetId === selectedAssetId)
      ?? (heatmap?.items ?? []).find((item) => item.assetId === selectedAssetId)
      ?? filteredItems[0]
      ?? null,
    [filteredItems, heatmap?.items, selectedAssetId],
  );

  const selectedAsset = useMemo(
    () => assets.find((asset) => asset.id === selectedItem?.assetId) ?? null,
    [assets, selectedItem?.assetId],
  );

  const chartPoints = useMemo(
    () => (timeseries?.ohlcv ?? []).slice(-160).map((row) => ({ t: row.t, value: row.close })),
    [timeseries?.ohlcv],
  );

  const liveLong = opportunities?.long ?? [];
  const liveShort = opportunities?.short ?? [];

  return (
    <main className="ivq-terminal-page">
      <section className="glass-panel ivq-terminal-hero">
        <div>
          <div className="ivq-section-label">Screener</div>
          <h1 className="ivq-terminal-title">Signal universe and ranking overview</h1>
          <p className="ivq-terminal-subtitle">
            Ranking, signal quality and live opportunity monitoring for the existing project universe.
          </p>
        </div>
        <div className="ivq-terminal-hero-meta">
          <div className="ivq-terminal-pill">{heatmap?.updatedAt ? `Updated ${new Date(heatmap.updatedAt).toLocaleString("de-DE")}` : "Waiting for data"}</div>
          <div className="ivq-terminal-pill">{source.toUpperCase()}</div>
        </div>
      </section>

      <div className="ivq-terminal-grid ivq-terminal-grid--screener">
        <aside className="space-y-4">
          <section className="glass-panel">
            <div className="ivq-section-label">Filters</div>
            <div className="space-y-3">
              <label className="ivq-form-row">
                <span>Search</span>
                <div className="ivq-input-wrap">
                  <Search size={14} strokeWidth={1.8} />
                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ticker or asset" className="ivq-input" />
                </div>
              </label>
              <label className="ivq-form-row">
                <span>Category</span>
                <select value={category} onChange={(event) => setCategory(event.target.value)} className="ivq-select">
                  {(heatmap?.categories?.length ? heatmap.categories : ["FX", "Metals", "Equities", "Crypto", "Energy", "Agriculture", "Softs", "Livestock"]).map((entry) => (
                    <option key={entry} value={entry}>{entry}</option>
                  ))}
                </select>
              </label>
              <label className="ivq-form-row">
                <span>Sort</span>
                <select value={sortBy} onChange={(event) => setSortBy(event.target.value)} className="ivq-select">
                  <option value="ai_score">AI Score</option>
                  <option value="confidence">Confidence</option>
                  <option value="momentum">Momentum</option>
                </select>
              </label>
              <label className="ivq-form-row">
                <span>Source</span>
                <select value={source} onChange={(event) => setSource(event.target.value as DataSource)} className="ivq-select">
                  <option value="tradingview">TradingView</option>
                  <option value="dukascopy">Dukascopy</option>
                  <option value="yahoo">Yahoo</option>
                </select>
              </label>
            </div>
          </section>

          <section className="glass-panel">
            <div className="ivq-section-label">Live Summary</div>
            <div className="ivq-stat-grid ivq-stat-grid--compact">
              <div className="ivq-stat-card">
                <span className="ivq-stat-label">Visible</span>
                <strong>{filteredItems.length}</strong>
              </div>
              <div className="ivq-stat-card">
                <span className="ivq-stat-label">Long</span>
                <strong>{liveLong.length}</strong>
              </div>
              <div className="ivq-stat-card">
                <span className="ivq-stat-label">Short</span>
                <strong>{liveShort.length}</strong>
              </div>
              <div className="ivq-stat-card">
                <span className="ivq-stat-label">Alerts</span>
                <strong>{alerts.length}</strong>
              </div>
            </div>
          </section>

          <section className="glass-panel">
            <div className="ivq-section-label">Opportunity Flow</div>
            <div className="space-y-2">
              {[...liveLong.map((item) => ({ ...item, side: "LONG" })), ...liveShort.map((item) => ({ ...item, side: "SHORT" }))].slice(0, 8).map((item) => (
                <button key={`${item.side}-${item.assetId}`} type="button" className="ivq-list-row" onClick={() => setSelectedAssetId(item.assetId)}>
                  <div className="flex items-center gap-2">
                    <span className={`ivq-list-icon ${item.side === "LONG" ? "is-positive" : "is-negative"}`}>
                      {item.side === "LONG" ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                    </span>
                    <div>
                      <div className="text-sm font-semibold text-slate-100">{item.name}</div>
                      <div className="text-[11px] text-slate-400">{item.category}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`text-sm font-semibold ${scoreTone(item.aiScore)}`}>{item.aiScore.toFixed(0)}</div>
                    <div className="text-[11px] text-slate-400">{item.confidenceScore.toFixed(0)} conf.</div>
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
                <div className="ivq-section-label">Ranking</div>
                <div className="text-sm text-slate-400">{loadingList ? "Refreshing screener universe..." : `${filteredItems.length} ranked assets`}</div>
              </div>
              <div className="ivq-terminal-pill">{heatmap?.category ?? category}</div>
            </div>

            <div className="ivq-data-table-wrap">
              <table className="ivq-data-table">
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th>AI</th>
                    <th>Confidence</th>
                    <th>Momentum</th>
                    <th>Signal</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((item) => {
                    const asset = assets.find((entry) => entry.id === item.assetId);
                    const active = item.assetId === selectedItem?.assetId;
                    return (
                      <tr key={item.assetId} className={active ? "is-active" : ""} onClick={() => setSelectedAssetId(item.assetId)}>
                        <td>
                          <div className="flex items-center gap-2">
                            <AssetIcon iconKey={asset?.iconKey ?? "stock"} category={asset?.category ?? item.category} assetName={item.name} />
                            <div>
                              <div className="font-semibold text-slate-100">{item.name}</div>
                              <div className="text-[11px] text-slate-400">{item.category}</div>
                            </div>
                          </div>
                        </td>
                        <td className={scoreTone(item.aiScore)}>{item.aiScore.toFixed(0)}</td>
                        <td>{item.confidenceScore.toFixed(0)}</td>
                        <td>{item.momentum.toFixed(1)}</td>
                        <td>
                          <span className={`ivq-tone-chip ${toneChip(item.tone)}`}>{item.signalQuality}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
            <section className="glass-panel">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="ivq-section-label">Selected Asset</div>
                  <div className="flex items-center gap-2 text-lg font-semibold text-slate-100">
                    {selectedAsset ? <AssetIcon iconKey={selectedAsset.iconKey} category={selectedAsset.category} assetName={selectedAsset.name} className="!h-[18px] !w-[18px]" /> : null}
                    <span>{selectedItem?.name ?? "No selection"}</span>
                  </div>
                </div>
                {selectedItem ? <span className={`ivq-tone-chip ${toneChip(selectedItem.tone)}`}>{selectedItem.tone.replace("_", " ")}</span> : null}
              </div>

              <div className="mb-4 grid gap-3 sm:grid-cols-3">
                <div className="ivq-stat-card">
                  <span className="ivq-stat-label">AI Score</span>
                  <strong className={scoreTone(selectedItem?.aiScore ?? 50)}>{selectedItem?.aiScore?.toFixed(0) ?? "--"}</strong>
                </div>
                <div className="ivq-stat-card">
                  <span className="ivq-stat-label">Confidence</span>
                  <strong>{selectedItem?.confidenceScore?.toFixed(0) ?? "--"}</strong>
                </div>
                <div className="ivq-stat-card">
                  <span className="ivq-stat-label">Momentum</span>
                  <strong>{selectedItem?.momentum?.toFixed(1) ?? "--"}</strong>
                </div>
              </div>

              <div className="h-[280px]">
                <SimpleLineChart
                  points={chartPoints}
                  tone={selectedItem?.aiScore != null && selectedItem.aiScore >= 50 ? "#39ff40" : "#ff384c"}
                  fillTone={selectedItem?.aiScore != null && selectedItem.aiScore >= 50 ? "rgba(57,255,64,0.18)" : "rgba(255,56,76,0.18)"}
                  valueFormatter={(value) => value.toFixed(2)}
                />
              </div>
              {loadingDetail ? <div className="mt-3 text-sm text-slate-400">Loading signal detail...</div> : null}
            </section>

            <section className="glass-panel">
              <div className="ivq-section-label">Signal Detail</div>
              {detail ? (
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="ivq-stat-card">
                      <span className="ivq-stat-label">Signal Quality</span>
                      <strong>{detail.signalQuality}</strong>
                    </div>
                    <div className="ivq-stat-card">
                      <span className="ivq-stat-label">Confidence Score</span>
                      <strong>{detail.confidenceScore.toFixed(0)}</strong>
                    </div>
                  </div>

                  <div className="grid gap-2">
                    {Object.entries(detail.components).map(([key, value]) => (
                      <div key={key} className="ivq-progress-row">
                        <span>{key}</span>
                        <div className="ivq-progress-track">
                          <div className="ivq-progress-fill" style={{ width: `${Math.max(0, Math.min(100, Number(value)))}%` }} />
                        </div>
                        <strong>{Number(value).toFixed(0)}</strong>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-2">
                    {detail.whySignal.map((row) => (
                      <div key={`${row.label}-${row.value}`} className="ivq-list-row is-static">
                        <div className="text-sm font-semibold text-slate-100">{row.label}</div>
                        <div className="text-sm text-slate-300">{row.value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="grid h-full min-h-[220px] place-items-center text-sm text-slate-400">Select an asset to inspect signal internals.</div>
              )}
            </section>
          </div>

          <section className="glass-panel">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="ivq-section-label mb-0">Market Alerts</div>
              <AlertTriangle size={14} className="text-amber-200" />
            </div>
            <div className="grid gap-2 lg:grid-cols-2">
              {alerts.slice(0, 8).map((alert) => (
                <button key={`${alert.assetId}-${alert.title}`} type="button" className="ivq-list-row" onClick={() => setSelectedAssetId(alert.assetId)}>
                  <div>
                    <div className="text-sm font-semibold text-slate-100">{alert.title}</div>
                    <div className="text-[11px] text-slate-400">{alert.assetId}</div>
                  </div>
                  <span className={`ivq-tone-chip ${toneChip(alert.tone)}`}>{alert.tone}</span>
                </button>
              ))}
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}
