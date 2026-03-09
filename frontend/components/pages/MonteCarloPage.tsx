"use client";

import type { ChangeEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import KellyOptimizationCard from "@/components/monte-carlo/KellyOptimizationCard";
import MonteCarloChart from "@/components/monte-carlo/MonteCarloChart";
import RegimeDetectionChart from "@/components/monte-carlo/RegimeDetectionChart";
import ResultsSummary from "@/components/monte-carlo/ResultsSummary";
import RiskDistributionChart from "@/components/monte-carlo/RiskDistributionChart";
import RiskSurface3D from "@/components/monte-carlo/RiskSurface3D";
import SimulationControlPanel from "@/components/monte-carlo/SimulationControlPanel";
import VolatilityChart from "@/components/monte-carlo/VolatilityChart";
import { buildSimulationResults, parseCsvDataset } from "@/components/monte-carlo/engine";
import { MOCK_DATASETS } from "@/components/monte-carlo/mockData";
import { getMonteCarloPalette } from "@/components/monte-carlo/theme";
import type { DatasetOption, MonteCarloTheme, SimulationControls } from "@/components/monte-carlo/types";

const defaultControls: SimulationControls = {
  datasetId: MOCK_DATASETS[0].id,
  simulationCount: 1200,
  horizon: 252,
  confidenceLevel: 0.95,
  drift: 0.12,
  volatility: 0.24,
  bootstrapRuns: 500,
  samplePaths: 3,
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

export default function MonteCarloPage() {
  const [theme, setTheme] = useState<MonteCarloTheme>("dark");
  const [controls, setControls] = useState<SimulationControls>(defaultControls);
  const [uploadedDataset, setUploadedDataset] = useState<DatasetOption | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  const datasets = useMemo(() => (uploadedDataset ? [...MOCK_DATASETS, uploadedDataset] : MOCK_DATASETS), [uploadedDataset]);
  const activeDataset = useMemo(
    () => datasets.find((dataset) => dataset.id === controls.datasetId) ?? datasets[0],
    [controls.datasetId, datasets],
  );
  const results = useMemo(() => buildSimulationResults(activeDataset, controls), [activeDataset, controls]);
  const palette = getMonteCarloPalette(theme);

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const parsed = parseCsvDataset(text, file.name.replace(/\.[^.]+$/, ""));
    setUploadedDataset(parsed);
    setUploadedFileName(file.name);
    const returns = parsed.observations.map((row) => row.strategyReturn);
    const meanReturn = returns.reduce((sum, value) => sum + value, 0) / Math.max(returns.length, 1);
    const variance = returns.reduce((sum, value) => sum + (value - meanReturn) ** 2, 0) / Math.max(returns.length, 1);
    setControls((current) => ({
      ...current,
      datasetId: parsed.id,
      drift: Number(Math.max(-0.1, Math.min(0.4, meanReturn * 252)).toFixed(4)),
      volatility: Number(Math.max(0.08, Math.min(0.65, Math.sqrt(variance) * Math.sqrt(252))).toFixed(4)),
    }));
  };

  const sharpeStabilityMedian = useMemo(() => {
    const sorted = [...results.sharpeStability].sort((left, right) => left - right);
    return sorted[Math.floor(sorted.length / 2)] ?? 0;
  }, [results.sharpeStability]);

  const exportJson = () => {
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
    ];
    downloadBlob("monte-carlo-lab-report.csv", "text/csv;charset=utf-8", rows.map((row) => row.join(",")).join("\n"));
  };

  const exportPdf = () => {
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
        </body>
      </html>
    `);
    popup.document.close();
    popup.focus();
    popup.print();
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
          onControlsChange={setControls}
          onUploadClick={() => fileInputRef.current?.click()}
          onExportJson={exportJson}
          onExportCsv={exportCsv}
          onExportPdf={exportPdf}
        />

        <div className="grid gap-4 min-[769px]:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.92fr)] min-[769px]:gap-5">
          <MonteCarloChart theme={theme} pathSeries={results.pathSeries} />
          <ResultsSummary theme={theme} report={results.report} modelCards={results.modelCards} />
        </div>

        <div className="grid gap-4 min-[769px]:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)] min-[769px]:gap-5">
          <RiskDistributionChart
            theme={theme}
            histogram={results.histogram}
            varHistorical={results.valueAtRiskHistorical}
            varParametric={results.valueAtRiskParametric}
            esHistorical={results.expectedShortfallHistorical}
            esParametric={results.expectedShortfallParametric}
            confidenceLabel={`${Math.round(controls.confidenceLevel * 100)}% confidence`}
          />
          <KellyOptimizationCard
            theme={theme}
            kellyFraction={results.kellyFraction}
            kellyFractionCapped={results.kellyFractionCapped}
            payoffRatio={results.payoffRatio}
            drawdownSeries={results.drawdownSeries}
            sharpeStabilityMedian={sharpeStabilityMedian}
          />
        </div>

        <div className="grid gap-4 min-[769px]:grid-cols-2 min-[769px]:gap-5">
          <RegimeDetectionChart theme={theme} regimeSeries={results.regimeSeries} />
          <VolatilityChart theme={theme} volatilitySeries={results.volatilitySeries} />
        </div>

        <div className="grid gap-4 min-[769px]:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)] min-[769px]:gap-5">
          <RiskSurface3D theme={theme} points={results.riskSurface} />
          <section className="glass-panel rounded-[24px] border p-4 min-[769px]:p-5" style={{ background: palette.panelBackground, borderColor: palette.border, boxShadow: `0 18px 44px rgba(0,0,0,0.30), 0 0 28px ${palette.glow}` }}>
            <div className="ivq-section-label">Simulation Pipeline</div>
            <h2 className="text-lg font-semibold" style={{ color: palette.heading }}>
              Research workflow
            </h2>
            <div className="mt-4 grid gap-3">
              {[
                ["1", "Load dataset", results.dataset.description],
                ["2", "Calculate returns", `Using ${results.dataset.observations.length} observations with strategy return and signal context.`],
                ["3", "Apply model assumptions", `Drift ${controls.drift.toFixed(2)}, vol ${controls.volatility.toFixed(2)}, ${controls.simulationCount} simulations.`],
                ["4", "Generate simulations", "GBM, regime switching, bootstrap sampling and drawdown stress curves."],
                ["5", "Evaluate risk metrics", "Historical / parametric VaR, CVaR, Sharpe, Sortino, Kelly and Bayesian mean."],
                ["6", "Visualize", "2D and 3D outputs for distribution, volatility and risk landscape analysis."],
                ["7", "Export report", "JSON, CSV or printable PDF summary report for the research pack."],
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
        </div>
      </div>
    </main>
  );
}
