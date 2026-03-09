import type {
  EvaluationResponse,
  OhlcvPoint,
  SeasonalityResponse,
  TimeseriesResponse,
} from "@/types";

export type DataSource = "tradingview" | "dukascopy" | "yahoo";
export type ScreenerTimeframe = "D" | "W";
export type SignalFilter = "all" | "bullish" | "bearish";
export type ScreenerTheme = "blue" | "gold";

export type ScreenerSortKey =
  | "hitRate"
  | "avgReturn"
  | "age"
  | "val20"
  | "val10"
  | "probability"
  | "signalStrength"
  | "aiRanking";
export type ScreenerSortDirection = "asc" | "desc";

export type SeasonalityControlValues = {
  seasonalityMinDays: number;
  seasonalityMaxDays: number;
  historicalYears: number;
};

export type ScreenerFilters = SeasonalityControlValues & {
  signalFilter: SignalFilter;
  valuationThreshold: number;
  assetGroup: string;
  timeframe: ScreenerTimeframe;
  minimumProbability: number;
  minimumSignalStrength: number;
  liquidityThreshold: number;
  requireOrderBlock: boolean;
  sortBy: ScreenerSortKey;
  sortDirection: ScreenerSortDirection;
};

export type ClusterPoint = {
  step: number;
  value: number;
};

export type ScreenerCluster = {
  hitRate: number;
  avgReturn: number;
  fromLabel: string;
  toLabel: string;
  holdDays: number;
  confidence: number;
  direction: "bullish" | "bearish";
  curve: ClusterPoint[];
  samples: number;
};

export type ScreenerValuation = {
  strength: number;
  probability: number;
  combined: number;
  raw: number;
};

export type ScreenerSupplyDemand = {
  label: string;
  tone: "demand" | "supply" | "neutral";
  score: number;
  distancePct: number | null;
  zoneCount: number;
};

export type ScreenerOrderBlock = {
  active: boolean;
  confirmed: boolean;
  direction: "bullish" | "bearish" | "neutral";
  label: string;
  low: number | null;
  high: number | null;
  proximityPct: number | null;
  start: string | null;
  end: string | null;
};

export type ScreenerLiquidity = {
  score: number;
  averageDailyVolume: number;
  spreadStability: number;
  volatilityClustering: number;
  passes: boolean;
};

export type ScreenerProbability = {
  score: number;
  similarSetups: number;
  volatilityRegime: "calm" | "neutral" | "stress";
};

export type ScreenerSignalStrength = {
  score: number;
  label: "Weak" | "Balanced" | "Strong" | "Elite";
};

export type ScreenerAiRanking = {
  score: number;
  orderBlockWeight: number;
  seasonalityWeight: number;
  valuationWeight: number;
  ageWeight: number;
};

export type ScreenerRowData = {
  assetId: string;
  name: string;
  symbol: string;
  category: string;
  assetGroup: string;
  signal: "bullish" | "bearish" | "neutral";
  signalLabel: string;
  age: number;
  entryConfirmed: boolean;
  lastCandles: OhlcvPoint[];
  val20: ScreenerValuation;
  val10: ScreenerValuation;
  supplyDemand: ScreenerSupplyDemand;
  supplyDemandPlus: ScreenerSupplyDemand;
  currentCluster: ScreenerCluster;
  nextCluster: ScreenerCluster;
  graphCurve: ClusterPoint[];
  graphProgress: number;
  orderBlock: ScreenerOrderBlock;
  probability: ScreenerProbability;
  liquidity: ScreenerLiquidity;
  signalStrength: ScreenerSignalStrength;
  aiRanking: ScreenerAiRanking;
  aiScore: number;
  confidenceScore: number;
  momentum: number;
};

export type ExpandedAssetData = {
  timeseries: TimeseriesResponse | null;
  evaluation: EvaluationResponse | null;
  seasonality: SeasonalityResponse | null;
};
