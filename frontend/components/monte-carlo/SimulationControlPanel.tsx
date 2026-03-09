"use client";

import { Download, FileJson, FileSpreadsheet, FileText, Info, Upload } from "lucide-react";

import { getMonteCarloPalette } from "@/components/monte-carlo/theme";
import type { DatasetOption, MonteCarloTheme, SimulationControls } from "@/components/monte-carlo/types";

type Props = {
  theme: MonteCarloTheme;
  controls: SimulationControls;
  datasets: DatasetOption[];
  uploadedFileName: string | null;
  onControlsChange: (next: SimulationControls) => void;
  onUploadClick: () => void;
  onExportJson: () => void;
  onExportCsv: () => void;
  onExportPdf: () => void;
};

const tooltipCopy = {
  gbm: "Standard stochastic process used to model asset price dynamics assuming log-normal returns.",
  var: "Maximum expected loss at a given confidence level.",
  cvar: "Average loss beyond the Value at Risk threshold.",
  hmm: "Statistical model detecting hidden market regimes.",
};

function ControlHint({ text }: { text: string }) {
  return (
    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-white/10 text-[10px] text-white/70" title={text}>
      <Info size={10} strokeWidth={2} />
    </span>
  );
}

export default function SimulationControlPanel({
  theme,
  controls,
  datasets,
  uploadedFileName,
  onControlsChange,
  onUploadClick,
  onExportJson,
  onExportCsv,
  onExportPdf,
}: Props) {
  const palette = getMonteCarloPalette(theme);

  return (
    <section
      className="glass-panel relative overflow-hidden rounded-[24px] border p-4 min-[769px]:p-5"
      style={{
        background: palette.panelBackground,
        borderColor: palette.border,
        boxShadow: `0 20px 50px rgba(0,0,0,0.34), 0 0 30px ${palette.glow}, inset 0 1px 0 rgba(255,255,255,0.05)`,
      }}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            theme === "dark"
              ? "linear-gradient(135deg, rgba(255,255,255,0.05), transparent 26%), radial-gradient(420px 180px at 100% 0%, rgba(214,195,143,0.18), transparent 68%)"
              : "linear-gradient(135deg, rgba(255,255,255,0.05), transparent 26%), radial-gradient(420px 180px at 100% 0%, rgba(77,135,254,0.18), transparent 68%)",
        }}
      />

      <div className="relative z-[1] flex flex-col gap-4">
        <div className="flex flex-col gap-3 min-[769px]:flex-row min-[769px]:items-start min-[769px]:justify-between">
          <div className="space-y-2">
            <div className="ivq-section-label">Monte Carlo Simulation Control Panel</div>
            <h1 className="m-0 text-[28px] font-semibold leading-[1.02] min-[769px]:text-[34px]" style={{ color: palette.heading }}>
              Monte Carlo Lab
            </h1>
            <p className="max-w-[920px] text-sm leading-6" style={{ color: palette.muted }}>
              Institutional-grade quantitative research environment for robustness validation, regime detection, path simulation, VaR and volatility stress testing.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 min-[769px]:grid-cols-3">
            <button type="button" className="ivq-segment-btn" onClick={onExportJson}>
              <FileJson size={14} /> JSON
            </button>
            <button type="button" className="ivq-segment-btn" onClick={onExportCsv}>
              <FileSpreadsheet size={14} /> CSV
            </button>
            <button type="button" className="ivq-segment-btn" onClick={onExportPdf}>
              <FileText size={14} /> PDF
            </button>
          </div>
        </div>

        <div className="grid gap-3 min-[769px]:grid-cols-2 xl:grid-cols-[1.35fr_0.95fr_1fr_1fr]">
          <label className="ivq-form-row">
            <span className="flex items-center gap-2">
              Dataset
              <ControlHint text="Load mock strategy files, engine outputs, screener signals or an uploaded CSV." />
            </span>
            <select
              value={controls.datasetId}
              onChange={(event) => onControlsChange({ ...controls, datasetId: event.target.value })}
              className="ivq-select"
            >
              {datasets.map((dataset) => (
                <option key={dataset.id} value={dataset.id}>
                  {dataset.name}
                </option>
              ))}
            </select>
            <button type="button" className="ivq-segment-btn mt-1 justify-center" onClick={onUploadClick}>
              <Upload size={14} /> {uploadedFileName ? uploadedFileName : "Upload CSV"}
            </button>
          </label>

          <label className="ivq-form-row">
            <span className="flex items-center gap-2">
              Simulations & Horizon
              <ControlHint text={`${tooltipCopy.gbm} ${tooltipCopy.hmm}`} />
            </span>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                min={200}
                max={5000}
                step={100}
                value={controls.simulationCount}
                onChange={(event) => onControlsChange({ ...controls, simulationCount: Number(event.target.value) || controls.simulationCount })}
                className="ivq-select"
              />
              <input
                type="number"
                min={21}
                max={756}
                step={21}
                value={controls.horizon}
                onChange={(event) => onControlsChange({ ...controls, horizon: Number(event.target.value) || controls.horizon })}
                className="ivq-select"
              />
            </div>
            <div className="text-[11px]" style={{ color: palette.muted }}>
              Paths and forward trading days
            </div>
          </label>

          <label className="ivq-form-row">
            <span className="flex items-center gap-2">
              Confidence / Drift
              <ControlHint text={`${tooltipCopy.var} ${tooltipCopy.cvar}`} />
            </span>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={String(controls.confidenceLevel)}
                onChange={(event) => onControlsChange({ ...controls, confidenceLevel: Number(event.target.value) as SimulationControls["confidenceLevel"] })}
                className="ivq-select"
              >
                <option value="0.9">90%</option>
                <option value="0.95">95%</option>
                <option value="0.99">99%</option>
              </select>
              <input
                type="number"
                step={0.01}
                value={controls.drift}
                onChange={(event) => onControlsChange({ ...controls, drift: Number(event.target.value) || 0 })}
                className="ivq-select"
              />
            </div>
            <div className="text-[11px]" style={{ color: palette.muted }}>
              Annual drift assumption
            </div>
          </label>

          <label className="ivq-form-row">
            <span className="flex items-center gap-2">
              Volatility / Bootstrap
              <ControlHint text="GARCH, bootstrap sampling, drawdown distribution and Sharpe stability all update from this block." />
            </span>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                step={0.01}
                value={controls.volatility}
                onChange={(event) => onControlsChange({ ...controls, volatility: Number(event.target.value) || 0 })}
                className="ivq-select"
              />
              <input
                type="number"
                min={100}
                max={2000}
                step={50}
                value={controls.bootstrapRuns}
                onChange={(event) => onControlsChange({ ...controls, bootstrapRuns: Number(event.target.value) || controls.bootstrapRuns })}
                className="ivq-select"
              />
            </div>
            <div className="text-[11px]" style={{ color: palette.muted }}>
              Annualized sigma and bootstrap runs
            </div>
          </label>
        </div>

        <div className="grid gap-2 min-[769px]:grid-cols-4">
          {[
            { label: "GBM", copy: tooltipCopy.gbm },
            { label: "VaR / CVaR", copy: `${tooltipCopy.var} ${tooltipCopy.cvar}` },
            { label: "Hidden Markov", copy: tooltipCopy.hmm },
            { label: "Bootstrap / GARCH", copy: "Bootstrapped return sampling, drawdown distribution and time-varying volatility clustering." },
          ].map((item) => (
            <div
              key={item.label}
              className="rounded-[16px] border px-3 py-2"
              style={{
                borderColor: palette.border,
                background: palette.panelBackgroundSoft,
              }}
              title={item.copy}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: palette.heading }}>
                  {item.label}
                </span>
                <Download size={12} style={{ color: palette.accent }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
