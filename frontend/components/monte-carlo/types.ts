export type MonteCarloTheme = "dark" | "blue";

export type ConfidenceLevel = 0.9 | 0.95 | 0.99;

export type DatasetKind = "track_record" | "historical" | "strategy" | "screener" | "engine" | "csv" | "market";

export type StressScenarioId = "none" | "gfc2008" | "covid2020" | "flash2010" | "dotcom" | "inflation";

export type DatasetOption = {
  id: string;
  name: string;
  description: string;
  kind: DatasetKind;
  sourceGroup?: "Track Record" | "Strategie" | "CSV" | "Marktdaten";
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
  portfolioWeightA: number;
  portfolioWeightB: number;
  portfolioWeightC: number;
  portfolioCorrelation: number;
  stressScenario: StressScenarioId;
  walkForwardTrainWindow: number;
  walkForwardTestWindow: number;
  parameterStopLossMin: number;
  parameterStopLossMax: number;
  parameterTakeProfitMin: number;
  parameterTakeProfitMax: number;
  parameterLookbackMin: number;
  parameterLookbackMax: number;
  parameterThresholdMin: number;
  parameterThresholdMax: number;
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
  sparkline: number[];
};

export type MetricSparkline = {
  expectedReturn: number[];
  volatility: number[];
  maxDrawdown: number[];
  sharpeRatio: number[];
  robustness: number[];
  overfitting: number[];
};

export type PortfolioAllocation = {
  label: string;
  weight: number;
  expectedReturn: number;
  volatility: number;
};

export type StressScenarioResult = {
  id: StressScenarioId;
  label: string;
  description: string;
  severity: number;
  pathSeries: SimulationPathPoint[];
  terminalReturn: number;
  maxDrawdown: number;
  impact: number;
};

export type WalkForwardPoint = {
  segment: string;
  trainReturn: number;
  testReturn: number;
  degradation: number;
  stability: number;
};

export type OverfittingSummary = {
  riskScore: number;
  stabilityScore: number;
  randomizedEdge: number;
  consistencyScore: number;
  parameterStability: number;
};

export type ParameterHeatmapPoint = {
  xLabel: string;
  yLabel: string;
  xValue: number;
  yValue: number;
  score: number;
  drawdown: number;
  robustness: number;
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
  maxDrawdownProbability: number;
  strategyRobustnessScore: number;
  overfittingRiskScore: number;
};

export type SimulationResults = {
  dataset: DatasetOption;
  controls: SimulationControls;
  returns: number[];
  cumulativeEquity: Array<{ date: string; equity: number }>;
  pathSeries: SimulationPathPoint[];
  bootstrapPathSeries: SimulationPathPoint[];
  portfolioPathSeries: SimulationPathPoint[];
  histogram: HistogramBin[];
  drawdownHistogram: HistogramBin[];
  portfolioReturnHistogram: HistogramBin[];
  portfolioDrawdownHistogram: HistogramBin[];
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
  metricSparklines: MetricSparkline;
  report: ResearchReport;
  modelCards: ModelSummaryItem[];
  portfolioAllocations: PortfolioAllocation[];
  stressScenarioResults: StressScenarioResult[];
  walkForwardSeries: WalkForwardPoint[];
  overfittingSummary: OverfittingSummary;
  overfittingDistribution: number[];
  parameterHeatmap: ParameterHeatmapPoint[];
  parameterDrawdownHeatmap: ParameterHeatmapPoint[];
};
