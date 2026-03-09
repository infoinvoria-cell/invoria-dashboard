"use client";

import type { ChangeEvent } from "react";
import dynamic from "next/dynamic";
import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { FastForward, RotateCcw, X } from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, LineChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";

import DrawdownChart from "@/components/monte-carlo/DrawdownChart";
import { useDashboardStateStore } from "@/components/DashboardStateProvider";
import KellyOptimizationCard from "@/components/monte-carlo/KellyOptimizationCard";
import MonteCarloChart from "@/components/monte-carlo/MonteCarloChart";
import OverfittingDetectionPanel from "@/components/monte-carlo/OverfittingDetectionPanel";
import ParameterHeatmapPanel from "@/components/monte-carlo/ParameterHeatmapPanel";
import PortfolioSimulationPanel from "@/components/monte-carlo/PortfolioSimulationPanel";
import RegimeDetectionChart from "@/components/monte-carlo/RegimeDetectionChart";
import RiskDistributionChart from "@/components/monte-carlo/RiskDistributionChart";
import RiskMetricsPanel from "@/components/monte-carlo/RiskMetricsPanel";
import SimulationControlPanel from "@/components/monte-carlo/SimulationControlPanel";
import StressTestPanel from "@/components/monte-carlo/StressTestPanel";
import VolatilityChart from "@/components/monte-carlo/VolatilityChart";
import WalkForwardValidationPanel from "@/components/monte-carlo/WalkForwardValidationPanel";
import { buildSimulationResults, deriveControlsFromDataset, parseCsvDataset } from "@/components/monte-carlo/engine";
import { MOCK_DATASETS } from "@/components/monte-carlo/mockData";
import { getMonteCarloPalette } from "@/components/monte-carlo/theme";
import type { DatasetOption, MonteCarloTheme, SimulationControls, SimulationResults } from "@/components/monte-carlo/types";
import { ensureMonteCarloTrackRecordDataset } from "@/lib/dashboardPreload";
import { useDashboardStore } from "@/lib/dashboardStore";

const Simulation3DView = dynamic(() => import("@/components/monte-carlo/Simulation3DView"), {
  ssr: false,
  loading: () => <div className="glass-panel min-h-[320px] rounded-[24px] border p-4" />,
});

type SimulationWorkerRequest = {
  requestId: number;
  dataset: DatasetOption;
  controls: SimulationControls;
};

type SimulationWorkerResponse = {
  requestId: number;
  results: SimulationResults;
};

const defaultControls: SimulationControls = {
  datasetId: "track-record-default",
  simulationCount: 1000,
  horizon: 252,
  confidenceLevel: 0.95,
  drift: 0.12,
  volatility: 0.24,
  bootstrapRuns: 500,
  samplePaths: 6,
  portfolioWeightA: 0.45,
  portfolioWeightB: 0.35,
  portfolioWeightC: 0.2,
  portfolioCorrelation: 0.38,
  stressScenario: "none",
  walkForwardTrainWindow: 126,
  walkForwardTestWindow: 42,
  parameterStopLossMin: 2,
  parameterStopLossMax: 8,
  parameterTakeProfitMin: 1.5,
  parameterTakeProfitMax: 6,
  parameterLookbackMin: 10,
  parameterLookbackMax: 60,
  parameterThresholdMin: 0.2,
  parameterThresholdMax: 0.9,
};

function downloadBlob(filename: string, mimeType: string, content: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function placeholderPanel(theme: MonteCarloTheme, title: string, text: string) {
  const palette = getMonteCarloPalette(theme);
  return (
    <section className="glass-panel grid min-h-[320px] place-items-center rounded-[24px] border p-6 text-center" style={{ background: palette.panelBackground, borderColor: palette.border, boxShadow: `0 18px 44px rgba(0,0,0,0.30), 0 0 28px ${palette.glow}` }}>
      <div>
        <div className="ivq-section-label">{title}</div>
        <div className="mt-2 text-lg font-semibold" style={{ color: palette.heading }}>
          Simulation bereit
        </div>
        <div className="mt-2 max-w-[420px] text-sm leading-6" style={{ color: palette.muted }}>
          {text}
        </div>
      </div>
    </section>
  );
}

const PLAYBACK_SPEEDS = [0.75, 1, 1.5, 2] as const;

function OverviewShell({
  theme,
  title,
  accentText,
  children,
}: {
  theme: MonteCarloTheme;
  title: string;
  accentText?: string;
  children: React.ReactNode;
}) {
  const palette = getMonteCarloPalette(theme);

  return (
    <section
      className="glass-panel flex h-full min-h-0 flex-col overflow-hidden rounded-[20px] border p-3"
      style={{ background: palette.panelBackground, borderColor: palette.border, boxShadow: `0 12px 34px rgba(0,0,0,0.22), 0 0 20px ${palette.glow}` }}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[9px] font-semibold uppercase tracking-[0.18em]" style={{ color: palette.muted }}>
            {title}
          </div>
        </div>
        {accentText ? (
          <div className="shrink-0 text-[10px] font-semibold" style={{ color: palette.heading }}>
            {accentText}
          </div>
        ) : null}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

export default function MonteCarloPage() {
  const dashboardStore = useDashboardStateStore();
  const sharedTrackRecordDataset = useDashboardStore((state) => state.sharedData.strategyData.monteCarloTrackRecordDataset);
  const sharedResults = useDashboardStore((state) => state.sharedData.monteCarloResults);
  const persistedState = useMemo(
    () =>
      dashboardStore.getPageState<{
        controls?: SimulationControls;
        uploadedFileName?: string | null;
        playbackSpeed?: (typeof PLAYBACK_SPEEDS)[number];
      }>("monte-carlo") ?? {},
    [dashboardStore],
  );
  const [theme, setTheme] = useState<MonteCarloTheme>("dark");
  const [controls, setControls] = useState<SimulationControls>(persistedState.controls ?? defaultControls);
  const [uploadedDataset, setUploadedDataset] = useState<DatasetOption | null>(
    () => dashboardStore.getDataCache<DatasetOption | null>("monte-carlo:uploaded-dataset") ?? null,
  );
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(persistedState.uploadedFileName ?? null);
  const [trackRecordDataset, setTrackRecordDataset] = useState<DatasetOption | null>(
    () => dashboardStore.getDataCache<DatasetOption | null>("monte-carlo:track-record-dataset") ?? sharedTrackRecordDataset ?? null,
  );
  const [results, setResults] = useState<SimulationResults | null>(
    () => dashboardStore.getDataCache<SimulationResults | null>("monte-carlo:results") ?? sharedResults ?? null,
  );
  const [isRunning, setIsRunning] = useState(false);
  const [animationProgress, setAnimationProgress] = useState(results ? 1 : 0);
  const [progressCount, setProgressCount] = useState(results?.controls.simulationCount ?? 0);
  const [showAllModels, setShowAllModels] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<(typeof PLAYBACK_SPEEDS)[number]>(persistedState.playbackSpeed ?? 1);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const playbackSpeedRef = useRef<(typeof PLAYBACK_SPEEDS)[number]>(persistedState.playbackSpeed ?? 1);
  const workerRef = useRef<Worker | null>(null);
  const workerRequestIdRef = useRef(0);
  const refreshVersion = dashboardStore.getRefreshVersion("monte-carlo");

  playbackSpeedRef.current = playbackSpeed;

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
    if (!sharedTrackRecordDataset) return;
    setTrackRecordDataset((current) => current ?? sharedTrackRecordDataset);
  }, [sharedTrackRecordDataset]);

  useEffect(() => {
    if (!sharedResults) return;
    setResults((current) => current ?? sharedResults);
    setAnimationProgress((current) => (current > 0 ? current : 1));
    setProgressCount((current) => (current > 0 ? current : sharedResults.controls.simulationCount));
  }, [sharedResults]);

  useEffect(() => {
    let cancelled = false;
    const cachedDataset = dashboardStore.getDataCache<DatasetOption | null>("monte-carlo:track-record-dataset");
    if (cachedDataset && refreshVersion === 0) {
      setTrackRecordDataset(cachedDataset);
      setControls((current) => deriveControlsFromDataset(cachedDataset, { ...current, datasetId: cachedDataset.id }));
      return () => {
        cancelled = true;
      };
    }
    ensureMonteCarloTrackRecordDataset(refreshVersion > 0)
      .then((dataset) => {
        if (cancelled) return;
        setTrackRecordDataset(dataset);
        dashboardStore.setDataCache("monte-carlo:track-record-dataset", dataset);
        setControls((current) => deriveControlsFromDataset(dataset, { ...current, datasetId: dataset.id }));
      })
      .catch(() => {
        if (cancelled) return;
        setTrackRecordDataset(null);
        setControls((current) => ({ ...current, datasetId: MOCK_DATASETS[0].id }));
      });

    return () => {
      cancelled = true;
    };
  }, [dashboardStore, refreshVersion]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const worker = new Worker(new URL("../monte-carlo/engine.worker.ts", import.meta.url));
    workerRef.current = worker;
    worker.onmessage = (event: MessageEvent<SimulationWorkerResponse>) => {
      if (event.data.requestId !== workerRequestIdRef.current) return;
      startTransition(() => {
        setResults(event.data.results);
      });
      setProgressCount(event.data.results.controls.simulationCount);
      setAnimationProgress(1);
      setIsRunning(false);
      if (frameRef.current != null) {
        window.cancelAnimationFrame(frameRef.current);
      }
      setAnimationProgress(0);
      setProgressCount(0);
      startAnimation(event.data.results.controls.simulationCount);
    };
    worker.onerror = () => {
      workerRef.current = null;
      setIsRunning(false);
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    dashboardStore.setPageState("monte-carlo", {
      controls,
      uploadedFileName,
      playbackSpeed,
    });
  }, [controls, dashboardStore, playbackSpeed, uploadedFileName]);

  useEffect(() => {
    dashboardStore.setDataCache("monte-carlo:uploaded-dataset", uploadedDataset);
  }, [dashboardStore, uploadedDataset]);

  useEffect(() => {
    dashboardStore.setDataCache("monte-carlo:results", results);
    dashboardStore.setMonteCarloResults(results);
  }, [dashboardStore, results]);

  const datasets = useMemo(() => {
    const base = [
      ...(trackRecordDataset ? [trackRecordDataset] : []),
      ...MOCK_DATASETS,
      ...(uploadedDataset ? [uploadedDataset] : []),
    ];
    return base;
  }, [trackRecordDataset, uploadedDataset]);

  const activeDataset = useMemo(
    () => datasets.find((dataset) => dataset.id === controls.datasetId) ?? datasets[0] ?? null,
    [controls.datasetId, datasets],
  );

  useEffect(() => {
    if (!activeDataset) return;
    setControls((current) => {
      const next = deriveControlsFromDataset(activeDataset, current);
      return JSON.stringify(next) === JSON.stringify(current) ? current : next;
    });
  }, [activeDataset]);

  useEffect(() => {
    return () => {
      if (frameRef.current != null) window.cancelAnimationFrame(frameRef.current);
    };
  }, []);

  useEffect(() => {
    if (!showAllModels) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [showAllModels]);

  const palette = getMonteCarloPalette(theme);
  const pendingChanges = useMemo(() => {
    if (!results || !activeDataset) return true;
    return results.dataset.id !== activeDataset.id || JSON.stringify(results.controls) !== JSON.stringify(controls);
  }, [activeDataset, controls, results]);

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const parsed = parseCsvDataset(text, file.name.replace(/\.[^.]+$/, ""));
    parsed.sourceGroup = "CSV";
    setUploadedDataset(parsed);
    dashboardStore.setDataCache("monte-carlo:uploaded-dataset", parsed);
    setUploadedFileName(file.name);
    setControls((current) => deriveControlsFromDataset(parsed, { ...current, datasetId: parsed.id }));
  };

  const startAnimation = (simulationCount: number) => {
    if (frameRef.current != null) window.cancelAnimationFrame(frameRef.current);
    setIsRunning(true);
    setAnimationProgress(0);
    setProgressCount(0);

    const duration = 1700 / playbackSpeedRef.current;
    const startedAt = performance.now();

    const animate = (now: number) => {
      const linear = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - (1 - linear) ** 2.4;
      setAnimationProgress(eased);
      setProgressCount(Math.min(simulationCount, Math.max(1, Math.round(simulationCount * eased))));
      if (linear < 1) {
        frameRef.current = window.requestAnimationFrame(animate);
        return;
      }
      setIsRunning(false);
      setProgressCount(simulationCount);
      frameRef.current = null;
    };

    frameRef.current = window.requestAnimationFrame(animate);
  };

  const runSimulation = () => {
    if (!activeDataset) return;

    const snapshotControls = { ...controls, datasetId: activeDataset.id };
    workerRequestIdRef.current += 1;
    const requestId = workerRequestIdRef.current;
    setIsRunning(true);
    setAnimationProgress(0);
    setProgressCount(0);

    const workerPayload: SimulationWorkerRequest = {
      requestId,
      dataset: activeDataset,
      controls: snapshotControls,
    };

    try {
      if (workerRef.current) {
        workerRef.current.postMessage(workerPayload);
        return;
      }
    } catch {
      workerRef.current = null;
    }

    const nextResults = buildSimulationResults(activeDataset, snapshotControls);
    startTransition(() => {
      setResults(nextResults);
    });
    startAnimation(snapshotControls.simulationCount);
  };

  const replaySimulation = () => {
    if (!results) return;
    startAnimation(results.controls.simulationCount);
  };

  const refreshData = async () => {
    dashboardStore.clearDataCache("monte-carlo:track-record-dataset");
    dashboardStore.setMonteCarloTrackRecordDataset(null);
    dashboardStore.bumpRefreshVersion("monte-carlo");
  };

  const exportJson = () => {
    if (!results) return;
    downloadBlob(
      "monte-carlo-lab-report.json",
      "application/json",
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          dataset: results.dataset.name,
          controls: results.controls,
          report: results.report,
          modelCards: results.modelCards,
        },
        null,
        2,
      ),
    );
  };

  const exportCsv = () => {
    if (!results) return;
    const rows = [
      ["metric", "value"],
      ["expected_return", results.report.expectedReturn],
      ["volatility", results.report.volatility],
      ["max_drawdown", results.report.maxDrawdown],
      ["var", results.report.valueAtRisk],
      ["cvar", results.report.expectedShortfall],
      ["sharpe_ratio", results.report.sharpeRatio],
      ["sortino_ratio", results.report.sortinoRatio],
      ["regime_probability", results.report.regimeProbability],
      ["risk_score", results.report.riskScore],
      ["posterior_return", results.report.posteriorReturn],
      ["max_drawdown_probability", results.report.maxDrawdownProbability],
      ["strategy_robustness_score", results.report.strategyRobustnessScore],
      ["overfitting_risk_score", results.report.overfittingRiskScore],
    ];
    downloadBlob("monte-carlo-lab-report.csv", "text/csv;charset=utf-8", rows.map((row) => row.join(",")).join("\n"));
  };

  const exportPdf = () => {
    if (!results) return;
    const popup = window.open("", "_blank", "width=1024,height=768");
    if (!popup) return;
    popup.document.write(`
      <html>
        <head><title>Monte Carlo Lab Report</title></head>
        <body style="font-family: Arial, sans-serif; padding: 32px;">
          <h1>Monte Carlo Lab Report</h1>
          <p>Dataset: ${results.dataset.name}</p>
          <p>Expected Return: ${(results.report.expectedReturn * 100).toFixed(2)}%</p>
          <p>Volatility: ${(results.report.volatility * 100).toFixed(2)}%</p>
          <p>Max Drawdown: ${(results.report.maxDrawdown * 100).toFixed(2)}%</p>
          <p>VaR: ${(results.report.valueAtRisk * 100).toFixed(2)}%</p>
          <p>CVaR: ${(results.report.expectedShortfall * 100).toFixed(2)}%</p>
          <p>Sharpe Ratio: ${results.report.sharpeRatio.toFixed(2)}</p>
          <p>Sortino Ratio: ${results.report.sortinoRatio.toFixed(2)}</p>
          <p>Risk Score: ${results.report.riskScore.toFixed(0)}/100</p>
          <p>Robustness Score: ${results.report.strategyRobustnessScore.toFixed(0)}/100</p>
          <p>Overfitting Risk: ${results.report.overfittingRiskScore.toFixed(0)}/100</p>
        </body>
      </html>
    `);
    popup.document.close();
    popup.focus();
    popup.print();
  };

  const renderSimulationGrid = (fullscreen = false) => {
    if (!results) {
      return (
        <>
          <div className="grid gap-4 min-[769px]:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.92fr)] min-[769px]:gap-5">
            {placeholderPanel(theme, "Monte Carlo Simulation Paths", "Track Record oder andere Datenquelle auswaehlen, Parameter pruefen und dann auf 'Simulation berechnen' klicken.")}
            {placeholderPanel(theme, "Results Panel", "Die KPI-Karten mit Expected Return, Volatility, Drawdown, VaR und Sharpe werden nach dem Simulationslauf gefuellt.")}
          </div>
          <div className="grid gap-4 min-[769px]:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)] min-[769px]:gap-5">
            {placeholderPanel(theme, "Return Distribution", "VaR- und Expected-Shortfall-Histogramme entstehen erst nach der Berechnung.")}
            {placeholderPanel(theme, "Kelly Allocation", "Kelly, Drawdown-Stabilitaet und Positionsgroesse folgen nach dem Simulationslauf.")}
          </div>
          <div className="grid gap-4 min-[769px]:grid-cols-2 min-[769px]:gap-5">
            {placeholderPanel(theme, "Portfolio Monte Carlo", "Korrelierte Portfolio-Simulationen, Return-Verteilungen und Drawdown-Verteilungen erscheinen nach der Berechnung.")}
            {placeholderPanel(theme, "Stress / Walk-Forward", "Krisenszenarien und Walk-Forward-Validierung werden gemeinsam mit der Hauptsimulation berechnet.")}
          </div>
          <div className="grid gap-4 min-[769px]:grid-cols-2 min-[769px]:gap-5">
            {placeholderPanel(theme, "Overfitting Detection", "Overfitting-Risiko, Stability Score und Randomized Signal Tests werden nach dem Lauf sichtbar.")}
            {placeholderPanel(theme, "Parameter Sensitivity", "Heatmaps fuer Stop Loss, Take Profit, Lookback und Threshold werden aus den Ergebnissen abgeleitet.")}
          </div>
        </>
      );
    }

    return (
      <>
        <div className="grid gap-4 min-[769px]:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.92fr)] min-[769px]:gap-5">
          <MonteCarloChart
            theme={theme}
            pathSeries={results.pathSeries}
            bootstrapPathSeries={results.bootstrapPathSeries}
            controls={results.controls}
            animationProgress={animationProgress}
            isRunning={isRunning}
            compact={!fullscreen}
          />
          <RiskMetricsPanel
            theme={theme}
            report={results.report}
            modelCards={results.modelCards}
            metricSparklines={results.metricSparklines}
            animationProgress={animationProgress}
          />
        </div>

        <div className="grid gap-4 min-[769px]:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)] min-[769px]:gap-5">
          <RiskDistributionChart
            theme={theme}
            histogram={results.histogram}
            varHistorical={results.valueAtRiskHistorical}
            varParametric={results.valueAtRiskParametric}
            esHistorical={results.expectedShortfallHistorical}
            esParametric={results.expectedShortfallParametric}
            confidenceLabel={`${Math.round(results.controls.confidenceLevel * 100)}% Konfidenz`}
            animationProgress={animationProgress}
          />
          <KellyOptimizationCard
            theme={theme}
            kellyFraction={results.kellyFraction}
            kellyFractionCapped={results.kellyFractionCapped}
            payoffRatio={results.payoffRatio}
            drawdownSeries={results.drawdownSeries}
            sharpeStabilityMedian={results.modelCards.find((item) => item.id === "sharpe") ? Number(results.modelCards.find((item) => item.id === "sharpe")?.value) : 0}
            animationProgress={animationProgress}
          />
        </div>

        <div className="grid gap-4 min-[769px]:grid-cols-2 min-[769px]:gap-5">
          <DrawdownChart
            theme={theme}
            drawdownSeries={results.drawdownSeries}
            drawdownHistogram={results.drawdownHistogram}
            animationProgress={animationProgress}
          />
          <RegimeDetectionChart theme={theme} regimeSeries={results.regimeSeries} animationProgress={animationProgress} />
        </div>

        <div className="grid gap-4 min-[769px]:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] min-[769px]:gap-5">
          <VolatilityChart theme={theme} volatilitySeries={results.volatilitySeries} animationProgress={animationProgress} />
          <Simulation3DView theme={theme} points={results.riskSurface} parameterSurface={results.parameterHeatmap} animationProgress={animationProgress} />
        </div>

        <div className="grid gap-4 min-[769px]:grid-cols-2 min-[769px]:gap-5">
          <PortfolioSimulationPanel
            theme={theme}
            pathSeries={results.portfolioPathSeries}
            allocations={results.portfolioAllocations}
            returnHistogram={results.portfolioReturnHistogram}
            drawdownHistogram={results.portfolioDrawdownHistogram}
            animationProgress={animationProgress}
          />
          <StressTestPanel theme={theme} scenarios={results.stressScenarioResults} animationProgress={animationProgress} />
        </div>

        <div className="grid gap-4 min-[769px]:grid-cols-2 min-[769px]:gap-5">
          <WalkForwardValidationPanel theme={theme} data={results.walkForwardSeries} animationProgress={animationProgress} />
          <OverfittingDetectionPanel theme={theme} summary={results.overfittingSummary} distribution={results.overfittingDistribution} animationProgress={animationProgress} />
        </div>

        <ParameterHeatmapPanel
          theme={theme}
          performanceHeatmap={results.parameterHeatmap}
          drawdownHeatmap={results.parameterDrawdownHeatmap}
          animationProgress={animationProgress}
        />

        {!fullscreen ? (
          <section className="glass-panel rounded-[24px] border p-4 min-[769px]:p-5" style={{ background: palette.panelBackground, borderColor: palette.border, boxShadow: `0 18px 44px rgba(0,0,0,0.30), 0 0 28px ${palette.glow}` }}>
            <div className="ivq-section-label">Practical Workflow</div>
            <h2 className="text-lg font-semibold" style={{ color: palette.heading }}>
              Research workflow
            </h2>
            <div className="mt-4 grid gap-3 min-[769px]:grid-cols-2 xl:grid-cols-4">
              {[
                ["1", "Track Record geladen", "Die lokale Equity-Kurve steht als Standard-Datenquelle fuer persoenliche Analysen bereit."],
                ["2", "Parameter automatisch gesetzt", "Drift und Volatilitaet werden aus der Historie abgeleitet, ohne die Simulation automatisch zu starten."],
                ["3", "Simulation berechnen", "Monte Carlo, GBM, Bootstrap, Drawdown und VaR/CVaR laufen gleichzeitig an."],
                ["4", "Visualisierung und Export", "Charts animieren progressiv, anschliessend koennen JSON, CSV oder PDF exportiert werden."],
              ].map(([index, title, text]) => (
                <div key={title} className="rounded-[18px] border p-3.5" style={{ borderColor: palette.border, background: palette.panelBackgroundSoft }}>
                  <div className="flex items-start gap-3">
                    <div className="grid h-8 w-8 place-items-center rounded-full text-sm font-semibold" style={{ background: palette.accent, color: theme === "dark" ? "#130f09" : "#071224" }}>
                      {index}
                    </div>
                    <div>
                      <div className="text-sm font-semibold" style={{ color: palette.heading }}>
                        {title}
                      </div>
                      <div className="mt-1 text-[12px] leading-5" style={{ color: palette.muted }}>
                        {text}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </>
    );
  };

  const renderOverviewGrid = () => {
    if (!results) {
      return (
        <div className="grid flex-1 place-items-center rounded-[24px] border" style={{ borderColor: palette.border, background: palette.panelBackgroundSoft }}>
          <div className="text-center">
            <div className="ivq-section-label">Research Overview</div>
            <div className="mt-2 text-lg font-semibold" style={{ color: palette.heading }}>
              Erst Simulation berechnen
            </div>
            <div className="mt-2 text-sm" style={{ color: palette.muted }}>
              Danach wird die Vollbildansicht als kompakte Research-Wall ohne Scrollen aufgebaut.
            </div>
          </div>
        </div>
      );
    }

    const visiblePathSeries = results.pathSeries.slice(0, Math.max(4, Math.round(results.pathSeries.length * Math.max(animationProgress, 0.08))));
    const visibleBootstrap = results.bootstrapPathSeries.slice(0, Math.max(4, Math.round(results.bootstrapPathSeries.length * Math.max(animationProgress, 0.08))));
    const visibleHistogram = results.histogram.slice(0, Math.max(4, Math.round(results.histogram.length * Math.max(animationProgress, 0.12))));
    const visibleDrawdown = results.drawdownSeries.slice(0, Math.max(4, Math.round(results.drawdownSeries.length * Math.max(animationProgress, 0.08))));
    const visibleRegimes = results.regimeSeries.slice(0, Math.max(4, Math.round(results.regimeSeries.length * Math.max(animationProgress, 0.08)))).map((item) => ({
      date: item.date,
      bull: item.bull * 100,
      bear: item.bear * 100,
      neutral: item.neutral * 100,
    }));
    const visibleVolatility = results.volatilitySeries.slice(0, Math.max(4, Math.round(results.volatilitySeries.length * Math.max(animationProgress, 0.08))));
    const visiblePortfolioPaths = results.portfolioPathSeries.slice(0, Math.max(4, Math.round(results.portfolioPathSeries.length * Math.max(animationProgress, 0.08))));
    const visiblePortfolioReturns = results.portfolioReturnHistogram.slice(0, Math.max(4, Math.round(results.portfolioReturnHistogram.length * Math.max(animationProgress, 0.1))));
    const activeStress = results.stressScenarioResults[0] ?? null;
    const visibleStress = activeStress?.pathSeries.slice(0, Math.max(4, Math.round(activeStress.pathSeries.length * Math.max(animationProgress, 0.08)))) ?? [];
    const visibleWalkForward = results.walkForwardSeries.slice(0, Math.max(2, Math.round(results.walkForwardSeries.length * Math.max(animationProgress, 0.12))));
    const visibleOverfitting = results.overfittingDistribution.slice(0, Math.max(8, Math.round(results.overfittingDistribution.length * Math.max(animationProgress, 0.12)))).map((value, index) => ({ index, value }));
    const visibleHeatmap = results.parameterHeatmap.slice(0, Math.max(12, Math.round(results.parameterHeatmap.length * Math.max(animationProgress, 0.18))));
    const visibleRiskSurface = results.riskSurface.slice(0, Math.max(12, Math.round(results.riskSurface.length * Math.max(animationProgress, 0.2)))).map((point, index) => ({
      ...point,
      id: index,
      x: Number((point.volatility * 100).toFixed(2)),
      y: Number((point.expectedReturn * 100).toFixed(2)),
      z: Math.max(50, point.score * 4),
    }));
    const summarySeries = results.metricSparklines.expectedReturn.map((value, index) => ({
      step: index,
      expectedReturn: value,
      sharpe: results.metricSparklines.sharpeRatio[index] ?? results.metricSparklines.sharpeRatio.at(-1) ?? 0,
      volatility: results.metricSparklines.volatility[index] ?? results.metricSparklines.volatility.at(-1) ?? 0,
    }));
    const overviewMetrics = [
      { label: "Return", value: `${(results.report.expectedReturn * 100).toFixed(1)}%` },
      { label: "Vol", value: `${(results.report.volatility * 100).toFixed(1)}%` },
      { label: "DD", value: `${(results.report.maxDrawdown * 100).toFixed(1)}%` },
      { label: "VaR", value: `${(results.report.valueAtRisk * 100).toFixed(1)}%` },
      { label: "Sharpe", value: results.report.sharpeRatio.toFixed(2) },
      { label: "Sortino", value: results.report.sortinoRatio.toFixed(2) },
      { label: "Robust", value: `${results.report.strategyRobustnessScore.toFixed(0)}/100` },
      { label: "Overfit", value: `${results.report.overfittingRiskScore.toFixed(0)}/100` },
    ];

    return (
      <div className="grid h-full min-h-0 gap-3 grid-cols-1 min-[769px]:grid-cols-2 xl:grid-cols-6 xl:grid-rows-2">
        <OverviewShell theme={theme} title="Monte Carlo Paths" accentText={`${results.controls.simulationCount}`}>
          <div className="grid h-full grid-rows-[1fr_auto] gap-2">
            <div className="min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={visiblePathSeries} margin={{ top: 6, right: 2, bottom: 0, left: -18 }}>
                  <defs>
                    <linearGradient id="ivqOverviewCone" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={palette.accent} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={palette.accent} stopOpacity={0.04} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={palette.chartGrid} vertical={false} />
                  <XAxis dataKey="label" hide />
                  <YAxis hide />
                  <Area type="monotone" dataKey="p95" stroke="none" fill="url(#ivqOverviewCone)" isAnimationActive={false} />
                  <Area type="monotone" dataKey="p05" stroke="none" fill={theme === "dark" ? "rgba(6,6,6,0.92)" : "rgba(5,12,24,0.92)"} isAnimationActive={false} />
                  <Line type="monotone" dataKey="median" stroke={palette.heading} strokeWidth={2.1} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="mean" stroke={palette.accent} strokeWidth={1.3} dot={false} strokeDasharray="4 4" isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[10px]">
              <div style={{ color: palette.muted }}>Drift <span style={{ color: palette.heading }}>{(results.controls.drift * 100).toFixed(2)}%</span></div>
              <div style={{ color: palette.muted }}>Vol <span style={{ color: palette.heading }}>{(results.controls.volatility * 100).toFixed(2)}%</span></div>
            </div>
          </div>
        </OverviewShell>

        <OverviewShell theme={theme} title="Results Summary" accentText={`${results.report.riskScore.toFixed(0)}/100`}>
          <div className="grid h-full grid-rows-[auto_1fr] gap-2">
            <div className="grid grid-cols-2 gap-1.5">
              {overviewMetrics.map((metric) => (
                <div
                  key={metric.label}
                  className="rounded-[12px] border px-2 py-1.5"
                  style={{ borderColor: palette.border, background: palette.panelBackgroundSoft }}
                >
                  <div className="text-[8px] uppercase tracking-[0.14em]" style={{ color: palette.muted }}>
                    {metric.label}
                  </div>
                  <div className="mt-1 text-[12px] font-semibold" style={{ color: palette.heading }}>
                    {metric.value}
                  </div>
                </div>
              ))}
            </div>
            <div className="min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={summarySeries} margin={{ top: 4, right: 2, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke={palette.chartGrid} vertical={false} />
                  <XAxis dataKey="step" hide />
                  <YAxis hide />
                  <Line type="monotone" dataKey="expectedReturn" stroke={palette.accent} strokeWidth={1.8} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="sharpe" stroke={palette.heading} strokeWidth={1.1} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="volatility" stroke={palette.negative} strokeWidth={1} dot={false} opacity={0.75} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </OverviewShell>

        <OverviewShell theme={theme} title="VaR / Expected Shortfall" accentText={`${Math.round(results.controls.confidenceLevel * 100)}%`}>
          <div className="grid h-full grid-rows-[1fr_auto] gap-2">
            <div className="min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={visibleHistogram} margin={{ top: 6, right: 0, bottom: 0, left: -22 }}>
                  <CartesianGrid stroke={palette.chartGrid} vertical={false} />
                  <XAxis dataKey="label" hide />
                  <YAxis hide />
                  <Tooltip contentStyle={{ background: theme === "dark" ? "#0d0b08" : "#071427", border: `1px solid ${palette.border}`, borderRadius: 12, color: palette.text }} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                    {visibleHistogram.map((entry) => (
                      <Cell
                        key={entry.label}
                        fill={entry.isExpectedShortfallTail ? palette.negative : entry.isVarTail ? palette.accent : palette.accentSoft}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[10px]">
              <div style={{ color: palette.muted }}>Hist. VaR <span style={{ color: palette.heading }}>{(results.valueAtRiskHistorical * 100).toFixed(2)}%</span></div>
              <div style={{ color: palette.muted }}>Hist. CVaR <span style={{ color: palette.heading }}>{(results.expectedShortfallHistorical * 100).toFixed(2)}%</span></div>
              <div style={{ color: palette.muted }}>Param. VaR <span style={{ color: palette.heading }}>{(results.valueAtRiskParametric * 100).toFixed(2)}%</span></div>
              <div style={{ color: palette.muted }}>Param. CVaR <span style={{ color: palette.heading }}>{(results.expectedShortfallParametric * 100).toFixed(2)}%</span></div>
            </div>
          </div>
        </OverviewShell>

        <OverviewShell theme={theme} title="Drawdown Distribution" accentText={`${(results.report.maxDrawdown * 100).toFixed(1)}%`}>
          <div className="grid h-full grid-rows-[1fr_auto] gap-2">
            <div className="min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={visibleDrawdown} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke={palette.chartGrid} vertical={false} />
                  <XAxis dataKey="step" hide />
                  <YAxis hide />
                  <Line type="monotone" dataKey="median" stroke={palette.accent} strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="p95Worst" stroke={palette.negative} strokeWidth={1.4} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="text-[10px]" style={{ color: palette.muted }}>
              DD probability {(results.report.maxDrawdownProbability * 100).toFixed(2)}%
            </div>
          </div>
        </OverviewShell>

        <OverviewShell theme={theme} title="Regime Detection" accentText={`${(results.report.regimeProbability * 100).toFixed(0)}%`}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={visibleRegimes} margin={{ top: 6, right: 2, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={palette.chartGrid} vertical={false} />
              <XAxis dataKey="date" hide />
              <YAxis hide />
              <Area type="monotone" dataKey="bull" stackId="1" stroke={palette.positive} fill={palette.positive} fillOpacity={0.24} isAnimationActive={false} />
              <Area type="monotone" dataKey="neutral" stackId="1" stroke={palette.accent} fill={palette.accent} fillOpacity={0.18} isAnimationActive={false} />
              <Area type="monotone" dataKey="bear" stackId="1" stroke={palette.negative} fill={palette.negative} fillOpacity={0.2} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </OverviewShell>

        <OverviewShell theme={theme} title="Volatility Model" accentText="GARCH">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={visibleVolatility} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={palette.chartGrid} vertical={false} />
              <XAxis dataKey="date" hide />
              <YAxis hide />
              <Line type="monotone" dataKey="realized" stroke={palette.accentSoft} strokeWidth={1.6} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="garch" stroke={palette.accentStrong} strokeWidth={2.1} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </OverviewShell>

        <OverviewShell theme={theme} title="Kelly Allocation" accentText={`${(results.kellyFractionCapped * 100).toFixed(0)}%`}>
          <div className="grid h-full grid-rows-[auto_1fr] gap-2">
            <div className="grid grid-cols-2 gap-2 text-[10px]">
              <div className="rounded-[12px] border px-2 py-1.5" style={{ borderColor: palette.border, background: palette.panelBackgroundSoft, color: palette.muted }}>
                Kelly <span style={{ color: palette.heading }}>{(results.kellyFraction * 100).toFixed(1)}%</span>
              </div>
              <div className="rounded-[12px] border px-2 py-1.5" style={{ borderColor: palette.border, background: palette.panelBackgroundSoft, color: palette.muted }}>
                Payoff <span style={{ color: palette.heading }}>{results.payoffRatio.toFixed(2)}</span>
              </div>
            </div>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={visibleDrawdown} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                <Area type="monotone" dataKey="median" stroke={palette.accent} fill={palette.accent} fillOpacity={0.16} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </OverviewShell>

        <OverviewShell theme={theme} title="Portfolio Simulation" accentText="MC">
          <div className="grid h-full grid-rows-[1fr_auto] gap-2">
            <div className="min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={visiblePortfolioPaths} margin={{ top: 6, right: 2, bottom: 0, left: -18 }}>
                  <defs>
                    <linearGradient id="ivqPortfolioOverview" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={theme === "dark" ? palette.accentStrong : palette.accent} stopOpacity={0.28} />
                      <stop offset="100%" stopColor={theme === "dark" ? palette.accentStrong : palette.accent} stopOpacity={0.03} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={palette.chartGrid} vertical={false} />
                  <XAxis dataKey="label" hide />
                  <YAxis hide />
                  <Area type="monotone" dataKey="p95" stroke="none" fill="url(#ivqPortfolioOverview)" isAnimationActive={false} />
                  <Area type="monotone" dataKey="p05" stroke="none" fill={theme === "dark" ? "rgba(6,6,6,0.92)" : "rgba(5,12,24,0.92)"} isAnimationActive={false} />
                  <Line type="monotone" dataKey="median" stroke={palette.heading} strokeWidth={2.1} dot={false} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {results.portfolioAllocations.map((allocation) => (
                <div
                  key={allocation.label}
                  className="rounded-[12px] border px-2 py-1.5"
                  style={{ borderColor: palette.border, background: palette.panelBackgroundSoft }}
                >
                  <div className="text-[8px] uppercase tracking-[0.14em]" style={{ color: palette.muted }}>
                    {allocation.label}
                  </div>
                  <div className="mt-1 text-[11px] font-semibold" style={{ color: palette.heading }}>
                    {(allocation.weight * 100).toFixed(0)}%
                  </div>
                </div>
              ))}
            </div>
          </div>
        </OverviewShell>

        <OverviewShell theme={theme} title="Stress Testing" accentText={activeStress?.label ?? "Stress"}>
          <div className="grid h-full grid-rows-[1fr_auto] gap-2">
            <div className="min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={visibleStress} margin={{ top: 6, right: 2, bottom: 0, left: -12 }}>
                  <CartesianGrid stroke={palette.chartGrid} vertical={false} />
                  <XAxis dataKey="label" hide />
                  <YAxis hide />
                  <Line type="monotone" dataKey="median" stroke={palette.negative} strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="p05" stroke={palette.accent} strokeWidth={1.1} dot={false} strokeDasharray="5 5" isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {results.stressScenarioResults.slice(0, 3).map((scenario) => (
                <div
                  key={scenario.id}
                  className="rounded-[12px] border px-2 py-1.5"
                  style={{ borderColor: palette.border, background: palette.panelBackgroundSoft }}
                >
                  <div className="truncate text-[8px] uppercase tracking-[0.12em]" style={{ color: palette.muted }}>
                    {scenario.label}
                  </div>
                  <div className="mt-1 text-[10px] font-semibold" style={{ color: palette.heading }}>
                    {(scenario.terminalReturn * 100).toFixed(1)}%
                  </div>
                </div>
              ))}
            </div>
          </div>
        </OverviewShell>

        <OverviewShell theme={theme} title="Walk-Forward Validation" accentText={`${visibleWalkForward.length} Seg.`}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={visibleWalkForward} margin={{ top: 10, right: 2, bottom: 0, left: -10 }}>
              <CartesianGrid stroke={palette.chartGrid} vertical={false} />
              <XAxis dataKey="segment" tick={{ fill: palette.muted, fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis hide />
              <Bar dataKey="trainReturn" fill={palette.accentSoft} radius={[4, 4, 0, 0]} isAnimationActive={false} />
              <Bar dataKey="testReturn" fill={palette.negative} radius={[4, 4, 0, 0]} isAnimationActive={false} />
              <Line type="monotone" dataKey="degradation" stroke={palette.heading} strokeWidth={1.3} dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </OverviewShell>

        <OverviewShell theme={theme} title="Overfitting Detection" accentText={`${results.overfittingSummary.riskScore.toFixed(0)}/100`}>
          <div className="grid h-full grid-rows-[auto_1fr] gap-2">
            <div className="grid grid-cols-2 gap-2 text-[10px]">
              <div style={{ color: palette.muted }}>Stability <span style={{ color: palette.heading }}>{results.overfittingSummary.stabilityScore.toFixed(0)}</span></div>
              <div style={{ color: palette.muted }}>Consistency <span style={{ color: palette.heading }}>{results.overfittingSummary.consistencyScore.toFixed(0)}%</span></div>
            </div>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={visibleOverfitting} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={palette.chartGrid} vertical={false} />
                <XAxis dataKey="index" hide />
                <YAxis hide />
                <Area type="monotone" dataKey="value" stroke={palette.negative} fill={palette.negative} fillOpacity={0.2} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </OverviewShell>

        <OverviewShell theme={theme} title="Parameter Sensitivity" accentText={`${results.report.strategyRobustnessScore.toFixed(0)}/100`}>
          <div className="grid h-full grid-cols-4 gap-1.5">
            {visibleHeatmap.map((point) => {
              const ratio = Math.max(0, Math.min(1, point.score / 100));
              const fill = theme === "dark"
                ? `rgba(214,195,143,${0.18 + ratio * 0.7})`
                : `rgba(77,135,254,${0.18 + ratio * 0.7})`;
              return (
                <div
                  key={`${point.xLabel}-${point.yLabel}`}
                  className="flex min-h-[48px] flex-col justify-between rounded-[12px] border p-1.5"
                  style={{ borderColor: palette.border, background: fill }}
                >
                  <div className="text-[8px] uppercase tracking-[0.08em]" style={{ color: palette.muted }}>
                    {point.xLabel}
                  </div>
                  <div className="text-[10px] font-semibold" style={{ color: palette.heading }}>
                    {point.score.toFixed(0)}
                  </div>
                </div>
              );
            })}
          </div>
        </OverviewShell>

        <OverviewShell theme={theme} title="Risk Surface" accentText="3D Preview">
          <div className="grid h-full grid-rows-[1fr_auto] gap-2">
            <div className="min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 10, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke={palette.chartGrid} />
                  <XAxis type="number" dataKey="x" hide />
                  <YAxis type="number" dataKey="y" hide />
                  <Tooltip
                    cursor={{ stroke: palette.accent, strokeOpacity: 0.18 }}
                    contentStyle={{
                      borderRadius: 12,
                      border: `1px solid ${palette.border}`,
                      background: theme === "dark" ? "rgba(11,9,7,0.95)" : "rgba(9,18,38,0.95)",
                    }}
                    formatter={(value, name) => {
                      if (name === "x") return [`${Number(value).toFixed(2)}%`, "Volatility"];
                      if (name === "y") return [`${Number(value).toFixed(2)}%`, "Expected return"];
                      return [String(value), name];
                    }}
                  />
                  <Scatter data={visibleRiskSurface} fill={palette.accent}>
                    {visibleRiskSurface.map((point) => (
                      <Cell
                        key={point.id}
                        fill={theme === "dark" ? palette.accent : palette.accentStrong}
                        opacity={0.34 + Math.min(0.56, point.score / 180)}
                      />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[10px]">
              <div style={{ color: palette.muted }}>Points <span style={{ color: palette.heading }}>{visibleRiskSurface.length}</span></div>
              <div style={{ color: palette.muted }}>Posterior <span style={{ color: palette.heading }}>{(results.report.posteriorReturn * 100).toFixed(1)}%</span></div>
            </div>
          </div>
        </OverviewShell>
      </div>
    );
  };

  return (
    <main className="ivq-terminal-page relative overflow-hidden">
      <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleUpload} />

      <div className="pointer-events-none absolute inset-0 rounded-[28px]" aria-hidden="true">
        <div className="absolute inset-0" style={{ background: palette.pageBackground }} />
      </div>

      <div className="relative mx-auto flex max-w-[1720px] flex-col gap-4 min-[769px]:gap-5" style={{ color: palette.text }}>
        <SimulationControlPanel
          theme={theme}
          controls={controls}
          datasets={datasets}
          uploadedFileName={uploadedFileName}
          datasetDescription={activeDataset?.description ?? "Datenquelle wird vorbereitet."}
          datasetObservationCount={activeDataset?.observations.length ?? 0}
          pendingChanges={pendingChanges}
          isRunning={isRunning}
          progressCount={progressCount}
          onControlsChange={setControls}
          onUploadClick={() => fileInputRef.current?.click()}
          onRunSimulation={runSimulation}
          onRefreshData={refreshData}
          onShowAllModels={() => setShowAllModels(true)}
          onExportJson={exportJson}
          onExportCsv={exportCsv}
          onExportPdf={exportPdf}
        />

        {renderSimulationGrid(false)}
      </div>

      {showAllModels ? (
        <div className="fixed inset-0 z-[80] bg-black/78 backdrop-blur-lg">
          <div className="absolute inset-3 flex min-h-0 flex-col overflow-hidden rounded-[28px] border p-3 min-[769px]:inset-5 min-[769px]:p-4" style={{ background: palette.pageBackground, borderColor: palette.border }}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="ivq-section-label">Research Overview</div>
                <h2 className="text-2xl font-semibold" style={{ color: palette.heading }}>
                  Vollbild-Analyse
                </h2>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className="ivq-segment-btn" onClick={replaySimulation} disabled={!results}>
                  <RotateCcw size={14} /> Replay
                </button>
                {PLAYBACK_SPEEDS.map((speed) => (
                  <button
                    key={speed}
                    type="button"
                    className="ivq-segment-btn"
                    onClick={() => setPlaybackSpeed(speed)}
                    style={playbackSpeed === speed ? { borderColor: palette.accent, color: palette.heading } : undefined}
                  >
                    <FastForward size={12} /> {speed}x
                  </button>
                ))}
                <button type="button" className="ivq-segment-btn" onClick={() => setShowAllModels(false)}>
                  <X size={14} /> Schliessen
                </button>
              </div>
            </div>
            <div className="mb-3 text-[11px]" style={{ color: palette.muted }}>
              {isRunning ? `Simulation laeuft: ${progressCount} / ${results?.controls.simulationCount ?? controls.simulationCount} Pfade berechnet` : "Alle Modelle laufen parallel als kompakte Research-Wall."}
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">{renderOverviewGrid()}</div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
