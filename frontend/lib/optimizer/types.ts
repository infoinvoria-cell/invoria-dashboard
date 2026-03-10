export type OptimizerDataSource = "dukascopy";

export type OptimizerAssetId =
  | "cross_eurusd"
  | "cross_gbpusd"
  | "cross_usdjpy"
  | "cross_usdchf"
  | "cross_audusd"
  | "cross_usdcad"
  | "cross_nzdusd";

export type ZoneMode = "normal" | "strong" | "both";
export type StopMode = "fixed" | "atr";

export type RangeSpec = {
  min: number;
  max: number;
  step: number;
};

export type OptimizerConfig = {
  assets: OptimizerAssetId[];
  source: OptimizerDataSource;
  monteCarloSimulations: number;
  broadRanges: {
    zoneLookback: RangeSpec;
    valuationLength: RangeSpec;
    valuationThreshold: RangeSpec;
    seasonalityYears: RangeSpec;
    holdDays: RangeSpec;
    atrPeriod: RangeSpec;
    atrMultiplier: RangeSpec;
    fixedStopPct: RangeSpec;
    takeProfitRr: RangeSpec;
    breakEvenRr: RangeSpec;
  };
  toggles: {
    allowNormalZones: boolean;
    allowStrongZones: boolean;
    requireCandleConfirmation: boolean;
    requireValuation: boolean;
    requireSeasonality: boolean;
    allowLong: boolean;
    allowShort: boolean;
  };
};

export type OptimizerMarketCoverage = {
  assetId: OptimizerAssetId;
  symbol: string;
  barsH1: number;
  barsD1: number;
  start: string | null;
  end: string | null;
  sourceRequested: string;
  sourceUsed: string;
  fallbackUsed: boolean;
  coverageRatioD1: number;
  missingDaysD1: number;
  largestGapDays: number;
  issues: string[];
};

export type TradeRecord = {
  assetId: OptimizerAssetId;
  direction: "long" | "short";
  entryDate: string;
  exitDate: string;
  holdDays: number;
  entryPrice: number;
  exitPrice: number;
  returnPct: number;
  stopHit: boolean;
  takeProfitHit: boolean;
  breakEvenTriggered: boolean;
};

export type StrategyParams = {
  zoneMode: ZoneMode;
  zoneLookback: number;
  valuationLength: 10 | 20;
  valuationThreshold: number;
  seasonalityYears: number;
  holdDays: number;
  stopMode: StopMode;
  atrPeriod: number;
  atrMultiplier: number;
  fixedStopPct: number;
  takeProfitRr: number;
  breakEvenRr: number;
  requireCandleConfirmation: boolean;
  requireValuation: boolean;
  requireSeasonality: boolean;
  allowLong: boolean;
  allowShort: boolean;
};

export type OptimizerParameterKey =
  | "zoneLookback"
  | "valuationLength"
  | "valuationThreshold"
  | "seasonalityYears"
  | "holdDays"
  | "atrPeriod"
  | "atrMultiplier"
  | "fixedStopPct"
  | "takeProfitRr"
  | "breakEvenRr";

export type StrategyMetrics = {
  score: number;
  sharpe: number;
  calmar: number;
  cagr: number;
  profitFactor: number;
  stability: number;
  maxDrawdown: number;
  trades: number;
  winRate: number;
  expectancy: number;
  medianAssetSharpe: number;
  portfolioSharpe: number;
  worstAssetSharpe: number;
};

export type StrategyAssetMetrics = {
  assetId: OptimizerAssetId;
  sharpe: number;
  cagr: number;
  maxDrawdown: number;
  profitFactor: number;
  trades: number;
  winRate: number;
};

export type MonteCarloSummary = {
  simulations: number;
  worstCaseDrawdown: number;
  monteCarloSharpe: number;
  probabilityOfRuin: number;
  returnDistribution: {
    p05: number;
    p50: number;
    p95: number;
  };
  distributionBuckets: Array<{
    from: number;
    to: number;
    label: string;
    count: number;
  }>;
  samplePaths: number[][];
};

export type EquityPoint = {
  t: string;
  equity: number;
};

export type OptimizerStrategyResult = {
  rank: number;
  stage: 1 | 2 | 3;
  strategyId: string;
  params: StrategyParams;
  metrics: StrategyMetrics;
  assetMetrics: StrategyAssetMetrics[];
  equityCurve: EquityPoint[];
  trades: TradeRecord[];
  monteCarlo: MonteCarloSummary | null;
};

export type OptimizerStageSummary = {
  stage: 1 | 2 | 3;
  label: string;
  strategyCount: number;
  topStrategies: OptimizerStrategyResult[];
};

export type OptimizerHeatmapCell = {
  x: number;
  y: number;
  score: number;
  sharpe: number;
  cagr: number;
  maxDrawdown: number;
  count: number;
  smoothedScore: number;
};

export type OptimizerParameterHeatmap = {
  id: string;
  stage: 1 | 2;
  xKey: OptimizerParameterKey;
  yKey: OptimizerParameterKey;
  xValues: number[];
  yValues: number[];
  cells: OptimizerHeatmapCell[];
};

export type OptimizerClusterSummary = {
  clusterId: string;
  heatmapId: string;
  stage: 1 | 2;
  xKey: OptimizerParameterKey;
  yKey: OptimizerParameterKey;
  xRange: { min: number; max: number };
  yRange: { min: number; max: number };
  medianSharpe: number;
  medianCagr: number;
  maxDrawdown: number;
  strategyCount: number;
  representativeStrategy: OptimizerStrategyResult;
  clusterStrategies: OptimizerStrategyResult[];
};

export type OptimizerStabilityAnalysis = {
  availablePairs: Array<{
    id: string;
    stage: 1 | 2;
    xKey: OptimizerParameterKey;
    yKey: OptimizerParameterKey;
  }>;
  heatmaps: OptimizerParameterHeatmap[];
  clusters: OptimizerClusterSummary[];
};

export type OptimizerRunResponse = {
  status: "ok";
  runId: string;
  generatedAt: string;
  config: OptimizerConfig;
  coverage: OptimizerMarketCoverage[];
  stageSummaries: OptimizerStageSummary[];
  topStrategies: OptimizerStrategyResult[];
  stability: OptimizerStabilityAnalysis;
  warnings: string[];
};

export type OptimizerProgressStage =
  | "data"
  | "stage1"
  | "stage2"
  | "stage3"
  | "monte_carlo"
  | "storage"
  | "complete";

export type OptimizerProgressSnapshot = {
  runId: string;
  stage: OptimizerProgressStage;
  label: string;
  stageIndex: number;
  stageCount: number;
  percent: number;
  completed: number;
  total: number;
  etaSeconds: number | null;
  message: string;
  updatedAt: string;
};

export type OptimizerRunSummary = {
  runId: string;
  createdAt: string;
  updatedAt: string;
  mode: "temp" | "saved";
  assets: OptimizerAssetId[];
  strategyCount: number;
  bestSharpe: number;
  bestCagr: number;
  status: "running" | "completed" | "error";
  warnings: string[];
  progress: OptimizerProgressSnapshot | null;
};

export type OptimizerStoredRun = {
  summary: OptimizerRunSummary;
  config: OptimizerConfig;
  result: OptimizerRunResponse | null;
  error: string | null;
};

export type OptimizerRunStreamEvent =
  | { type: "progress"; payload: OptimizerProgressSnapshot }
  | { type: "result"; payload: OptimizerRunResponse }
  | { type: "error"; payload: { runId: string; message: string } };
