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
export type ValuationPeriod = 10 | 15 | 20;
export type ValuationMode = "ANY_SINGLE" | "TWO_OF_THREE" | "ALL_THREE" | "COMBINED" | "WEIGHTED_COMBINED";
export type ValuationMultiPeriodLogic = "SINGLE" | "OR" | "AND" | "AGREEMENT";
export type ValuationWeightProfile = "equal" | "macro" | "fx";

export type RangeSpec = {
  min: number;
  max: number;
  step: number;
};

export type OptimizerConfig = {
  assets: OptimizerAssetId[];
  source: OptimizerDataSource;
  monteCarloSimulations: number;
  valuationPeriods: ValuationPeriod[];
  valuationModes: ValuationMode[];
  valuationMultiPeriodLogics: ValuationMultiPeriodLogic[];
  valuationWeightProfiles: ValuationWeightProfile[];
  broadRanges: {
    zoneLookback: RangeSpec;
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
  entryIndex: number;
  exitIndex: number;
  holdDays: number;
  entryPrice: number;
  exitPrice: number;
  stopPrice: number;
  takeProfitPrice: number;
  returnPct: number;
  stopHit: boolean;
  takeProfitHit: boolean;
  breakEvenTriggered: boolean;
  exitReason: "stop" | "target" | "time";
};

export type StrategyParams = {
  zoneMode: ZoneMode;
  zoneLookback: number;
  valuationPrimaryPeriod: ValuationPeriod;
  valuationSecondaryPeriod: ValuationPeriod | null;
  valuationPrimaryMode: ValuationMode;
  valuationSecondaryMode: ValuationMode | null;
  valuationMultiPeriodLogic: ValuationMultiPeriodLogic;
  valuationWeightProfile: ValuationWeightProfile;
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
  | "valuationPrimaryPeriod"
  | "valuationSecondaryPeriod"
  | "valuationModeIndex"
  | "valuationMultiPeriodLogicIndex"
  | "valuationWeightProfileIndex"
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

export type OptimizerCandleIntegrityReport = {
  assetId: OptimizerAssetId;
  symbol: string;
  candleCount: number;
  invalidHighLowCount: number;
  flatRangeCount: number;
  openEqualsCloseCount: number;
  invalidHighLowRatio: number;
  flatRangeRatio: number;
  openEqualsCloseRatio: number;
  warnings: string[];
  isValid: boolean;
};

export type OptimizerTradeValidation = {
  isValid: boolean;
  reason: string | null;
  minimumTradesPerAsset: number;
  minimumTotalTrades: number;
  minimumTradesPerYear: number;
  totalTrades: number;
  tradesPerYear: number;
  assetTradeCounts: Array<{
    assetId: OptimizerAssetId;
    trades: number;
    minimumRequired: number;
  }>;
};

export type OptimizerDebugZone = {
  id: string;
  kind: "demand" | "supply";
  strength: "normal" | "strong";
  low: number;
  high: number;
  startIndex: number;
  endIndex: number;
  touched: boolean;
  broken: boolean;
  lastTouchedIndex: number | null;
};

export type OptimizerDebugSignal = {
  assetId: OptimizerAssetId;
  barIndex: number;
  time: string;
  direction: "long" | "short";
  zoneId: string | null;
  valuationScorePrimary: number | null;
  valuationScoreSecondary: number | null;
  valuationPass: boolean;
  seasonalityPass: boolean;
  seasonalityDirection: "long" | "short" | "neutral";
  seasonalityScore: number;
  candleConfirmation: boolean;
};

export type OptimizerValuationWindow = {
  barIndex: number;
  time: string;
  valuationScorePrimary: number | null;
  valuationScoreSecondary: number | null;
  longPass: boolean;
  shortPass: boolean;
};

export type OptimizerStrategyValuationSummary = {
  periods: ValuationPeriod[];
  primaryPeriod: ValuationPeriod;
  secondaryPeriod: ValuationPeriod | null;
  primaryMode: ValuationMode;
  secondaryMode: ValuationMode | null;
  multiPeriodLogic: ValuationMultiPeriodLogic;
  weightProfile: ValuationWeightProfile;
  threshold: number;
  signalDensity: number;
  candidateSignals: number;
  qualifyingSignals: number;
  contributionReturn: number;
};

export type OptimizerSeasonalityWindow = {
  startIndex: number;
  endIndex: number;
  direction: "long" | "short";
  score: number;
  holdDays: number;
};

export type OptimizerDebugAsset = {
  assetId: OptimizerAssetId;
  symbol: string;
  candles: Array<{
    t: string;
    open: number;
    high: number;
    low: number;
    close: number;
  }>;
  zones: OptimizerDebugZone[];
  signals: OptimizerDebugSignal[];
  valuationWindows: OptimizerValuationWindow[];
  seasonalityWindows: OptimizerSeasonalityWindow[];
  trades: TradeRecord[];
  integrity: OptimizerCandleIntegrityReport;
};

export type OptimizerPreviewResponse = {
  generatedAt: string;
  config: OptimizerConfig;
  coverage: OptimizerMarketCoverage[];
  integrity: OptimizerCandleIntegrityReport[];
  selectedAssetId: OptimizerAssetId;
  previewAsset: OptimizerDebugAsset | null;
  warnings: string[];
  requiresConfirmation: boolean;
};

export type OptimizerStrategyResult = {
  rank: number;
  stage: 1 | 2 | 3;
  strategyId: string;
  params: StrategyParams;
  valuation: OptimizerStrategyValuationSummary;
  metrics: StrategyMetrics;
  assetMetrics: StrategyAssetMetrics[];
  equityCurve: EquityPoint[];
  trades: TradeRecord[];
  validation: OptimizerTradeValidation;
  debugAssets: OptimizerDebugAsset[];
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
  trades: number;
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
  integrity: OptimizerCandleIntegrityReport[];
  preview: OptimizerPreviewResponse | null;
  stageSummaries: OptimizerStageSummary[];
  topStrategies: OptimizerStrategyResult[];
  invalidStrategies: OptimizerStrategyResult[];
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
