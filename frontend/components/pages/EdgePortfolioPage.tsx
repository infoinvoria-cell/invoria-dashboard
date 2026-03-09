"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { useDashboardStateStore } from "@/components/DashboardStateProvider";
import CorrelationMatrix from "@/components/edge-portfolio/CorrelationMatrix";
import PortfolioAnalyticsPanel from "@/components/edge-portfolio/PortfolioAnalyticsPanel";
import PortfolioBuilder from "@/components/edge-portfolio/PortfolioBuilder";
import PortfolioKpiPanel from "@/components/edge-portfolio/PortfolioKpiPanel";
import PortfolioPerformanceChart from "@/components/edge-portfolio/PortfolioPerformanceChart";
import StrategyContributionChart from "@/components/edge-portfolio/StrategyContributionChart";
import StrategyList from "@/components/edge-portfolio/StrategyList";
import StrategyUploadPanel from "@/components/edge-portfolio/StrategyUploadPanel";
import { buildEdgePortfolioModel, buildStrategySummaries } from "@/components/edge-portfolio/metrics";
import PerformanceTable from "@/components/track-record/PerformanceTable";
import type { TrackRecordTheme } from "@/components/track-record/metrics";
import { getTrackRecordThemePalette } from "@/components/track-record/theme";
import type { EdgeStrategyDocument } from "@/lib/edgePortfolioStore";

type Props = {
  initialStrategies: EdgeStrategyDocument[];
};

function rebalanceEqualWeights(ids: string[]): Record<string, number> {
  if (ids.length === 0) return {};
  const equal = 1 / ids.length;
  return Object.fromEntries(ids.map((id) => [id, equal]));
}

export default function EdgePortfolioPage({ initialStrategies }: Props) {
  const dashboardStore = useDashboardStateStore();
  const persistedState = useMemo(
    () =>
      dashboardStore.getPageState<{
        selectedIds?: string[];
        weights?: Record<string, number>;
      }>("edge-portfolio") ?? {},
    [dashboardStore],
  );
  const [theme, setTheme] = useState<TrackRecordTheme>("dark");
  const [strategies, setStrategies] = useState<EdgeStrategyDocument[]>(
    () => dashboardStore.getDataCache<EdgeStrategyDocument[]>("edge-portfolio:strategies") ?? initialStrategies,
  );
  const initialSelectedIds = persistedState.selectedIds && persistedState.selectedIds.length > 0
    ? persistedState.selectedIds
    : initialStrategies[0]
      ? [initialStrategies[0].id]
      : [];
  const [selectedIds, setSelectedIds] = useState<string[]>(initialSelectedIds);
  const [weights, setWeights] = useState<Record<string, number>>(persistedState.weights ?? rebalanceEqualWeights(initialSelectedIds));
  const [uploadName, setUploadName] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [animationProgress, setAnimationProgress] = useState(1);
  const [isReplaying, setIsReplaying] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const palette = getTrackRecordThemePalette(theme);

  useEffect(() => {
    const readTheme = () => {
      try {
        const stored = window.localStorage.getItem("ivq_globe_gold_theme_v1");
        setTheme(stored === "0" ? "blue" : "dark");
      } catch {
        setTheme("dark");
      }
    };

    const onThemeEvent = (event: Event) => {
      const custom = event as CustomEvent<{ theme?: string; themeCanonical?: string }>;
      const canonical = String(custom.detail?.themeCanonical || "").toLowerCase();
      const legacy = String(custom.detail?.theme || "").toLowerCase();
      if (canonical === "blue" || legacy === "blue") {
        setTheme("blue");
        return;
      }
      if (canonical === "black" || legacy === "black" || legacy === "gold") {
        setTheme("dark");
      }
    };

    readTheme();
    window.addEventListener("invoria-theme-set", onThemeEvent as EventListener);
    return () => window.removeEventListener("invoria-theme-set", onThemeEvent as EventListener);
  }, []);

  useEffect(() => {
    return () => {
      if (frameRef.current != null) {
        window.cancelAnimationFrame(frameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    dashboardStore.setPageState("edge-portfolio", { selectedIds, weights });
  }, [dashboardStore, selectedIds, weights]);

  useEffect(() => {
    dashboardStore.setDataCache("edge-portfolio:strategies", strategies);
  }, [dashboardStore, strategies]);

  const summaries = useMemo(() => buildStrategySummaries(strategies), [strategies]);
  const portfolioModel = useMemo(
    () => buildEdgePortfolioModel(strategies, selectedIds, weights, theme),
    [selectedIds, strategies, theme, weights],
  );

  const startReplay = () => {
    if (frameRef.current != null) {
      window.cancelAnimationFrame(frameRef.current);
    }
    setAnimationProgress(0);
    setIsReplaying(true);
    const startTime = performance.now();
    const duration = 1700;

    const step = (now: number) => {
      const linear = Math.min(1, (now - startTime) / duration);
      const eased = 1 - (1 - linear) ** 2.1;
      setAnimationProgress(eased);
      if (linear < 1) {
        frameRef.current = window.requestAnimationFrame(step);
        return;
      }
      setIsReplaying(false);
      frameRef.current = null;
    };

    frameRef.current = window.requestAnimationFrame(step);
  };

  useEffect(() => {
    setAnimationProgress(1);
    setIsReplaying(false);
    if (frameRef.current != null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, [selectedIds]);

  const toggleStrategy = (id: string) => {
    setSelectedIds((current) => {
      const next = current.includes(id) ? current.filter((value) => value !== id) : [...current, id];
      setWeights(rebalanceEqualWeights(next));
      return next;
    });
  };

  const handleWeightChange = (id: string, value: number) => {
    setWeights((current) => ({ ...current, [id]: Math.max(0, value) }));
  };

  const handleUpload = async (file: File) => {
    setIsUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      if (uploadName.trim()) {
        formData.append("name", uploadName.trim());
      }

      const response = await fetch("/api/edge-portfolio/strategies", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json()) as { strategy?: EdgeStrategyDocument; error?: string };
      if (!response.ok || !payload.strategy) {
        throw new Error(payload.error || "Upload failed.");
      }

      setStrategies((current) => [...current, payload.strategy!].sort((left, right) => left.name.localeCompare(right.name)));
      setSelectedIds((current) => {
        const next = current.includes(payload.strategy!.id) ? current : [...current, payload.strategy!.id];
        setWeights(rebalanceEqualWeights(next));
        return next;
      });
      setUploadName("");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    await handleUpload(file);
  };

  const handleRename = async (id: string) => {
    const current = strategies.find((strategy) => strategy.id === id);
    const name = window.prompt("Rename strategy", current?.name ?? "");
    if (!name?.trim()) return;

    const response = await fetch(`/api/edge-portfolio/strategies/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    const payload = (await response.json()) as { strategy?: EdgeStrategyDocument; error?: string };
    if (!response.ok || !payload.strategy) {
      setError(payload.error || "Rename failed.");
      return;
    }

    setStrategies((currentStrategies) =>
      currentStrategies
        .map((strategy) => (strategy.id === id ? payload.strategy! : strategy))
        .sort((left, right) => left.name.localeCompare(right.name)),
    );
  };

  const handleDelete = async (id: string) => {
    const current = strategies.find((strategy) => strategy.id === id);
    if (!window.confirm(`Delete strategy '${current?.name ?? id}'?`)) return;

    const response = await fetch(`/api/edge-portfolio/strategies/${id}`, { method: "DELETE" });
    if (!response.ok) {
      setError("Delete failed.");
      return;
    }

    setStrategies((currentStrategies) => currentStrategies.filter((strategy) => strategy.id !== id));
    setSelectedIds((currentIds) => {
      const next = currentIds.filter((value) => value !== id);
      setWeights(rebalanceEqualWeights(next));
      return next;
    });
  };

  const refreshStrategies = async () => {
    const response = await fetch("/api/edge-portfolio/strategies", { cache: "no-store" });
    const payload = (await response.json()) as { strategies?: EdgeStrategyDocument[]; error?: string };
    if (!response.ok || !payload.strategies) {
      setError(payload.error || "Refresh failed.");
      return;
    }

    setStrategies(payload.strategies);
    dashboardStore.setDataCache("edge-portfolio:strategies", payload.strategies);
    setSelectedIds((current) => current.filter((id) => payload.strategies!.some((strategy) => strategy.id === id)));
  };

  return (
    <main className="ivq-terminal-page relative xl:min-h-[calc(100dvh-50px)]">
      <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFileChange} />

      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[28px]" aria-hidden="true">
        <div className="absolute inset-0" style={{ background: palette.pageBackground }} />
        <div
          className="absolute inset-0 opacity-90"
          style={{
            background:
              theme === "dark"
                ? "linear-gradient(120deg, rgba(255,255,255,0.05), transparent 22%), radial-gradient(720px 280px at 78% 14%, rgba(214,195,143,0.10), transparent 62%)"
                : "linear-gradient(120deg, rgba(255,255,255,0.05), transparent 22%), radial-gradient(720px 280px at 78% 14%, rgba(77,135,254,0.12), transparent 62%)",
          }}
        />
      </div>

      <div className="relative mx-auto flex h-full w-full max-w-[1720px] flex-col gap-4 pt-2" style={{ color: palette.text }}>
        {error ? (
          <div className="rounded-[18px] border px-4 py-3 text-sm" style={{ borderColor: `${palette.negative}66`, background: `${palette.negative}12`, color: palette.negative }}>
            {error}
          </div>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.66fr)_minmax(360px,0.92fr)]">
          <section className="grid min-h-0 gap-4">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
              <StrategyUploadPanel
                theme={theme}
                uploadName={uploadName}
                onUploadNameChange={setUploadName}
                onPickFile={() => fileInputRef.current?.click()}
                onRefresh={refreshStrategies}
                isUploading={isUploading}
                totalStrategies={strategies.length}
                selectedCount={selectedIds.length}
              />
              <PortfolioBuilder
                theme={theme}
                strategies={strategies}
                selectedIds={selectedIds}
                weights={weights}
                onWeightChange={handleWeightChange}
              />
            </div>

            <PortfolioPerformanceChart
              theme={theme}
              chartData={portfolioModel.chartData}
              overlayLines={portfolioModel.overlayLines}
              animationProgress={animationProgress}
              isReplaying={isReplaying}
              onReplay={startReplay}
            />

            <PerformanceTable
              rows={portfolioModel.performanceRows}
              totalCumulativeReturn={portfolioModel.totalCumulativeReturn}
              activeMultiplier={1}
              onMultiplierChange={() => {
                // Edge Portfolio keeps the base portfolio table view fixed at 1x.
              }}
              theme={theme}
            />

            <div className="grid gap-4 xl:grid-cols-2">
              <StrategyContributionChart
                theme={theme}
                contributionItems={portfolioModel.contributionItems}
                monthlyContributionRows={portfolioModel.monthlyContributionRows}
              />
              <PortfolioAnalyticsPanel
                theme={theme}
                riskContributions={portfolioModel.riskContributions}
                histogram={portfolioModel.tradeHistogram}
              />
            </div>
          </section>

          <aside className="grid min-h-0 gap-3 xl:grid-rows-[minmax(320px,0.34fr)_minmax(0,0.44fr)_minmax(280px,0.22fr)]">
            <StrategyList
              theme={theme}
              summaries={summaries}
              selectedIds={selectedIds}
              onToggleSelect={toggleStrategy}
              onRename={handleRename}
              onDelete={handleDelete}
            />
            <PortfolioKpiPanel theme={theme} kpis={portfolioModel.kpis} />
            <CorrelationMatrix theme={theme} matrix={portfolioModel.correlationMatrix} />
          </aside>
        </div>
      </div>
    </main>
  );
}
