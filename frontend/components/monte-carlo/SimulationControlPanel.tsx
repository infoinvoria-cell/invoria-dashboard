"use client";

import type { ReactNode } from "react";
import { FileJson, FileSpreadsheet, FileText, Info, Layers3, Play, Upload } from "lucide-react";

import { getMonteCarloPalette } from "@/components/monte-carlo/theme";
import type { DatasetOption, MonteCarloTheme, SimulationControls } from "@/components/monte-carlo/types";

type Props = {
  theme: MonteCarloTheme;
  controls: SimulationControls;
  datasets: DatasetOption[];
  uploadedFileName: string | null;
  datasetDescription: string;
  datasetObservationCount: number;
  pendingChanges: boolean;
  isRunning: boolean;
  progressCount: number;
  onControlsChange: (next: SimulationControls) => void;
  onUploadClick: () => void;
  onRunSimulation: () => void;
  onRefreshData: () => void;
  onShowAllModels: () => void;
  onExportJson: () => void;
  onExportCsv: () => void;
  onExportPdf: () => void;
};

const tooltipCopy = {
  dataSource: "Waehlt die Datenbasis fuer die Simulation. Standard ist die eigene Track-Record-Equity-Kurve.",
  simulationCount: "Anzahl der simulierten Zukunftspfade. Mehr Pfade liefern stabilere Wahrscheinlichkeitskegel.",
  horizon: "Anzahl der Perioden in die Zukunft, typischerweise 252 Handelstage fuer ein Jahr.",
  drift: "Die erwartete durchschnittliche Rendite pro Periode.",
  volatility: "Standardabweichung der Renditen und Mass fuer Marktrisiko.",
  confidence: "Konfidenzniveau fuer Value at Risk und Expected Shortfall.",
  bootstrap: "Erzeugt alternative Szenarien durch zufaelliges Wiederverwenden historischer Renditen.",
  samplePaths: "Anzahl exemplarischer Pfade, die im Chart hervorgehoben werden.",
  portfolioWeight: "Portfolio-Gewicht je Baustein fuer die korrelierte Multi-Asset-Simulation.",
  portfolioCorrelation: "Durchschnittliche Korrelation zwischen den simulierten Assets im Portfolio.",
  stressScenario: "Historisches Krisenszenario, das zusaetzlich auf das Portfolio angewendet wird.",
  walkForwardTrain: "Laenge des Trainingsfensters fuer die Walk-Forward-Validierung.",
  walkForwardTest: "Laenge des Testfensters fuer die Walk-Forward-Validierung.",
  parameterRange: "Definiert den untersuchten Bereich fuer die Sensitivitaetsanalyse der Strategieparameter.",
};

function ControlHint({ text }: { text: string }) {
  return (
    <span
      className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-white/10 text-[10px] text-white/70"
      title={text}
    >
      <Info size={10} strokeWidth={2} />
    </span>
  );
}

function SectionCard({
  title,
  children,
  theme,
}: {
  title: string;
  children: ReactNode;
  theme: MonteCarloTheme;
}) {
  const palette = getMonteCarloPalette(theme);
  return (
    <div
      className="rounded-[18px] border p-3.5"
      style={{
        borderColor: palette.border,
        background: palette.panelBackgroundSoft,
      }}
    >
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: palette.heading }}>
        {title}
      </div>
      <div className="grid gap-3">{children}</div>
    </div>
  );
}

export default function SimulationControlPanel({
  theme,
  controls,
  datasets,
  uploadedFileName,
  datasetDescription,
  datasetObservationCount,
  pendingChanges,
  isRunning,
  progressCount,
  onControlsChange,
  onUploadClick,
  onRunSimulation,
  onRefreshData,
  onShowAllModels,
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
            <p className="max-w-[960px] text-sm leading-6" style={{ color: palette.muted }}>
              Interaktive quantitative Simulationsumgebung fuer Track Record, Strategiedaten, CSV-Uploads und Marktdaten. Simulationen starten erst nach Klick auf den Berechnungs-Button.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 min-[769px]:grid-cols-3">
            <button type="button" className="ivq-segment-btn" onClick={onRefreshData}>
              <Layers3 size={14} /> Refresh
            </button>
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

        <div className="grid gap-3 min-[769px]:grid-cols-2 xl:grid-cols-4">
          <SectionCard title="Data Source" theme={theme}>
            <label className="ivq-form-row">
              <span className="flex items-center gap-2">
                Datenquelle
                <ControlHint text={tooltipCopy.dataSource} />
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
            </label>
            <button type="button" className="ivq-segment-btn justify-center" onClick={onUploadClick}>
              <Upload size={14} /> {uploadedFileName ? uploadedFileName : "CSV hochladen"}
            </button>
            <div className="rounded-[14px] border p-3 text-[12px] leading-5" style={{ borderColor: palette.border, color: palette.muted }}>
              {datasetDescription}
              <div className="mt-1 text-[11px] text-slate-300">{datasetObservationCount} Beobachtungen geladen</div>
            </div>
          </SectionCard>

          <SectionCard title="Simulation Settings" theme={theme}>
            <label className="ivq-form-row">
              <span className="flex items-center gap-2">
                Simulationen
                <ControlHint text={tooltipCopy.simulationCount} />
              </span>
              <input
                type="number"
                min={200}
                max={5000}
                step={100}
                value={controls.simulationCount}
                onChange={(event) => onControlsChange({ ...controls, simulationCount: Number(event.target.value) || controls.simulationCount })}
                className="ivq-select"
              />
            </label>
            <label className="ivq-form-row">
              <span className="flex items-center gap-2">
                Zeithorizont
                <ControlHint text={tooltipCopy.horizon} />
              </span>
              <input
                type="number"
                min={21}
                max={756}
                step={21}
                value={controls.horizon}
                onChange={(event) => onControlsChange({ ...controls, horizon: Number(event.target.value) || controls.horizon })}
                className="ivq-select"
              />
            </label>
            <label className="ivq-form-row">
              <span className="flex items-center gap-2">
                Beispielpfade
                <ControlHint text={tooltipCopy.samplePaths} />
              </span>
              <input
                type="number"
                min={3}
                max={12}
                step={1}
                value={controls.samplePaths}
                onChange={(event) => onControlsChange({ ...controls, samplePaths: Number(event.target.value) || controls.samplePaths })}
                className="ivq-select"
              />
            </label>
          </SectionCard>

          <SectionCard title="Model Parameters" theme={theme}>
            <label className="ivq-form-row">
              <span className="flex items-center gap-2">
                Drift (mu)
                <ControlHint text={tooltipCopy.drift} />
              </span>
              <input
                type="number"
                step={0.01}
                value={controls.drift}
                onChange={(event) => onControlsChange({ ...controls, drift: Number(event.target.value) || 0 })}
                className="ivq-select"
              />
            </label>
            <label className="ivq-form-row">
              <span className="flex items-center gap-2">
                Volatilitaet (sigma)
                <ControlHint text={tooltipCopy.volatility} />
              </span>
              <input
                type="number"
                step={0.01}
                value={controls.volatility}
                onChange={(event) => onControlsChange({ ...controls, volatility: Number(event.target.value) || 0 })}
                className="ivq-select"
              />
            </label>
            <label className="ivq-form-row">
              <span className="flex items-center gap-2">
                Bootstrap-Laeufe
                <ControlHint text={tooltipCopy.bootstrap} />
              </span>
              <input
                type="number"
                min={100}
                max={2500}
                step={50}
                value={controls.bootstrapRuns}
                onChange={(event) => onControlsChange({ ...controls, bootstrapRuns: Number(event.target.value) || controls.bootstrapRuns })}
                className="ivq-select"
              />
            </label>
          </SectionCard>

          <SectionCard title="Risk Metrics" theme={theme}>
            <label className="ivq-form-row">
              <span className="flex items-center gap-2">
                Konfidenzniveau
                <ControlHint text={tooltipCopy.confidence} />
              </span>
              <select
                value={String(controls.confidenceLevel)}
                onChange={(event) => onControlsChange({ ...controls, confidenceLevel: Number(event.target.value) as SimulationControls["confidenceLevel"] })}
                className="ivq-select"
              >
                <option value="0.9">90%</option>
                <option value="0.95">95%</option>
                <option value="0.99">99%</option>
              </select>
            </label>
            <div className="rounded-[14px] border p-3 text-[12px]" style={{ borderColor: palette.border, background: "rgba(255,255,255,0.02)", color: palette.muted }}>
              <div>Drift und Volatilitaet werden beim Datenwechsel automatisch aus der Historie vorbelegt.</div>
              <div className="mt-1">Default: 1000 Simulationen, 252 Handelstage.</div>
            </div>
            <div className="rounded-[14px] border p-3 text-[12px]" style={{ borderColor: palette.border, background: "rgba(255,255,255,0.02)", color: palette.muted }}>
              {isRunning
                ? `Simulation laeuft: ${progressCount} / ${controls.simulationCount} Pfade berechnet`
                : pendingChanges
                  ? "Parameter geaendert. Simulation neu berechnen."
                  : "Bereit fuer neue Simulation."}
            </div>
          </SectionCard>
        </div>

        <div className="grid gap-3 min-[769px]:grid-cols-2 xl:grid-cols-4">
          <SectionCard title="Portfolio Inputs" theme={theme}>
            <label className="ivq-form-row">
              <span className="flex items-center gap-2">
                Core Gewicht
                <ControlHint text={tooltipCopy.portfolioWeight} />
              </span>
              <input type="number" min={0} max={1} step={0.05} value={controls.portfolioWeightA} onChange={(event) => onControlsChange({ ...controls, portfolioWeightA: Number(event.target.value) || 0 })} className="ivq-select" />
            </label>
            <label className="ivq-form-row">
              <span className="flex items-center gap-2">
                Defensive Gewicht
                <ControlHint text={tooltipCopy.portfolioWeight} />
              </span>
              <input type="number" min={0} max={1} step={0.05} value={controls.portfolioWeightB} onChange={(event) => onControlsChange({ ...controls, portfolioWeightB: Number(event.target.value) || 0 })} className="ivq-select" />
            </label>
            <label className="ivq-form-row">
              <span className="flex items-center gap-2">
                Opportunistic Gewicht
                <ControlHint text={tooltipCopy.portfolioWeight} />
              </span>
              <input type="number" min={0} max={1} step={0.05} value={controls.portfolioWeightC} onChange={(event) => onControlsChange({ ...controls, portfolioWeightC: Number(event.target.value) || 0 })} className="ivq-select" />
            </label>
            <label className="ivq-form-row">
              <span className="flex items-center gap-2">
                Korrelation
                <ControlHint text={tooltipCopy.portfolioCorrelation} />
              </span>
              <input type="number" min={-0.25} max={0.95} step={0.05} value={controls.portfolioCorrelation} onChange={(event) => onControlsChange({ ...controls, portfolioCorrelation: Number(event.target.value) || 0 })} className="ivq-select" />
            </label>
          </SectionCard>

          <SectionCard title="Stress Test Scenarios" theme={theme}>
            <label className="ivq-form-row">
              <span className="flex items-center gap-2">
                Szenario
                <ControlHint text={tooltipCopy.stressScenario} />
              </span>
              <select value={controls.stressScenario} onChange={(event) => onControlsChange({ ...controls, stressScenario: event.target.value as SimulationControls["stressScenario"] })} className="ivq-select">
                <option value="none">Kein Zusatzszenario</option>
                <option value="gfc2008">2008 GFC</option>
                <option value="covid2020">COVID 2020</option>
                <option value="flash2010">Flash Crash 2010</option>
                <option value="dotcom">Dot-Com Collapse</option>
                <option value="inflation">Inflation Shock</option>
              </select>
            </label>
            <div className="rounded-[14px] border p-3 text-[12px] leading-5" style={{ borderColor: palette.border, color: palette.muted }}>
              Historische Schockpfade werden parallel zur Basis-Simulation berechnet und im Stress-Panel verglichen.
            </div>
          </SectionCard>

          <SectionCard title="Validation Settings" theme={theme}>
            <label className="ivq-form-row">
              <span className="flex items-center gap-2">
                Train-Fenster
                <ControlHint text={tooltipCopy.walkForwardTrain} />
              </span>
              <input type="number" min={60} max={504} step={21} value={controls.walkForwardTrainWindow} onChange={(event) => onControlsChange({ ...controls, walkForwardTrainWindow: Number(event.target.value) || controls.walkForwardTrainWindow })} className="ivq-select" />
            </label>
            <label className="ivq-form-row">
              <span className="flex items-center gap-2">
                Test-Fenster
                <ControlHint text={tooltipCopy.walkForwardTest} />
              </span>
              <input type="number" min={20} max={168} step={21} value={controls.walkForwardTestWindow} onChange={(event) => onControlsChange({ ...controls, walkForwardTestWindow: Number(event.target.value) || controls.walkForwardTestWindow })} className="ivq-select" />
            </label>
          </SectionCard>

          <SectionCard title="Parameter Ranges" theme={theme}>
            <label className="ivq-form-row">
              <span className="flex items-center gap-2">
                Stop Loss Min / Max
                <ControlHint text={tooltipCopy.parameterRange} />
              </span>
              <div className="grid grid-cols-2 gap-2">
                <input type="number" step={0.5} value={controls.parameterStopLossMin} onChange={(event) => onControlsChange({ ...controls, parameterStopLossMin: Number(event.target.value) || controls.parameterStopLossMin })} className="ivq-select" />
                <input type="number" step={0.5} value={controls.parameterStopLossMax} onChange={(event) => onControlsChange({ ...controls, parameterStopLossMax: Number(event.target.value) || controls.parameterStopLossMax })} className="ivq-select" />
              </div>
            </label>
            <label className="ivq-form-row">
              <span className="flex items-center gap-2">
                Take Profit Min / Max
                <ControlHint text={tooltipCopy.parameterRange} />
              </span>
              <div className="grid grid-cols-2 gap-2">
                <input type="number" step={0.5} value={controls.parameterTakeProfitMin} onChange={(event) => onControlsChange({ ...controls, parameterTakeProfitMin: Number(event.target.value) || controls.parameterTakeProfitMin })} className="ivq-select" />
                <input type="number" step={0.5} value={controls.parameterTakeProfitMax} onChange={(event) => onControlsChange({ ...controls, parameterTakeProfitMax: Number(event.target.value) || controls.parameterTakeProfitMax })} className="ivq-select" />
              </div>
            </label>
            <label className="ivq-form-row">
              <span className="flex items-center gap-2">
                Lookback Min / Max
                <ControlHint text={tooltipCopy.parameterRange} />
              </span>
              <div className="grid grid-cols-2 gap-2">
                <input type="number" step={1} value={controls.parameterLookbackMin} onChange={(event) => onControlsChange({ ...controls, parameterLookbackMin: Number(event.target.value) || controls.parameterLookbackMin })} className="ivq-select" />
                <input type="number" step={1} value={controls.parameterLookbackMax} onChange={(event) => onControlsChange({ ...controls, parameterLookbackMax: Number(event.target.value) || controls.parameterLookbackMax })} className="ivq-select" />
              </div>
            </label>
            <label className="ivq-form-row">
              <span className="flex items-center gap-2">
                Threshold Min / Max
                <ControlHint text={tooltipCopy.parameterRange} />
              </span>
              <div className="grid grid-cols-2 gap-2">
                <input type="number" step={0.05} value={controls.parameterThresholdMin} onChange={(event) => onControlsChange({ ...controls, parameterThresholdMin: Number(event.target.value) || controls.parameterThresholdMin })} className="ivq-select" />
                <input type="number" step={0.05} value={controls.parameterThresholdMax} onChange={(event) => onControlsChange({ ...controls, parameterThresholdMax: Number(event.target.value) || controls.parameterThresholdMax })} className="ivq-select" />
              </div>
            </label>
          </SectionCard>
        </div>

        <div className="flex flex-col gap-3 min-[769px]:flex-row min-[769px]:items-center min-[769px]:justify-between">
          <div className="grid gap-2 min-[769px]:grid-cols-4">
            {[
              "Monte Carlo Path Simulation",
              "Geometric Brownian Motion",
              "Bootstrapped Return Simulation",
              "VaR / Expected Shortfall",
              "Portfolio Monte Carlo",
              "Stress Testing",
              "Walk-Forward Validation",
              "Overfitting Detection",
            ].map((label) => (
              <div
                key={label}
                className="rounded-[16px] border px-3 py-2"
                style={{ borderColor: palette.border, background: palette.panelBackgroundSoft }}
                title={label}
              >
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: palette.heading }}>
                  {label}
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="button" className="ivq-segment-btn" onClick={onShowAllModels}>
              <Layers3 size={14} /> Research Overview
            </button>
            <button
              type="button"
              className="ivq-segment-btn"
              onClick={onRunSimulation}
              disabled={isRunning}
              style={{
                background: palette.accent,
                color: theme === "dark" ? "#110d07" : "#04101f",
                borderColor: palette.accent,
              }}
            >
              <Play size={14} /> Simulation berechnen
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
