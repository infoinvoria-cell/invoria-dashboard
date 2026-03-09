export type MonteCarloTheme = "dark" | "blue";

export type ConfidenceLevel = 0.9 | 0.95 | 0.99;

export type DatasetKind = "historical" | "strategy" | "screener" | "engine" | "csv";

export type DatasetOption = {
  id: string;
  name: string;
  description: string;
  kind: DatasetKind;
  observations: DatasetObservation[];
};

export type DatasetObservation = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  returns: number;
  signal: number;
  strategyReturn: number;
};

export type SimulationControls = {
  datasetId: string;
  simulationCount: number;
  horizon: number;
  confidenceLevel: ConfidenceLevel;
  drift: number;
  volatility: number;
  bootstrapRuns: number;
  samplePaths: number;
};

export type SimulationPathPoint = {
  step: number;
  label: string;
  median: number;
  p05: number;
  p95: number;
  mean: number;
  samples: number[];
};

export type HistogramBin = {
  label: string;
  midpoint: number;
  count: number;
  density: number;
  isVarTail: boolean;
  isExpectedShortfallTail: boolean;
};

export type RegimePoint = {
  date: string;
  bull: number;
  bear: number;
  neutral: number;
  state: "Bull" | "Bear" | "Neutral";
};

export type VolatilityPoint = {
  date: string;
  realized: number;
  garch: number;
};

export type DrawdownPoint = {
  step: number;
  median: number;
  p95Worst: number;
};

export type RiskSurfacePoint = {
  drift: number;
  volatility: number;
  score: number;
  expectedReturn: number;
  cvar: number;
};

export type ModelSummaryItem = {
  id: string;
  label: string;
  value: string;
  tone: "neutral" | "accent" | "positive" | "negative";
};

export type ResearchReport = {
  expectedReturn: number;
  volatility: number;
  maxDrawdown: number;
  valueAtRisk: number;
  expectedShortfall: number;
  sharpeRatio: number;
  sortinoRatio: number;
  regimeProbability: number;
  riskScore: number;
  profitProbability: number;
  posteriorReturn: number;
};

export type SimulationResults = {
  dataset: DatasetOption;
  controls: SimulationControls;
  returns: number[];
  cumulativeEquity: Array<{ date: string; equity: number }>;
  pathSeries: SimulationPathPoint[];
  histogram: HistogramBin[];
  valueAtRiskHistorical: number;
  valueAtRiskParametric: number;
  expectedShortfallHistorical: number;
  expectedShortfallParametric: number;
  regimeSeries: RegimePoint[];
  volatilitySeries: VolatilityPoint[];
  drawdownSeries: DrawdownPoint[];
  riskSurface: RiskSurfacePoint[];
  sharpeStability: number[];
  bootstrapTerminalReturns: number[];
  kellyFraction: number;
  kellyFractionCapped: number;
  payoffRatio: number;
  bayesianReturn: number;
  report: ResearchReport;
  modelCards: ModelSummaryItem[];
};
