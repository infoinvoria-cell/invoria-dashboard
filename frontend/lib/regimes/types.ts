export type RegimeVolatility = "Low Vol" | "Medium Vol" | "High Vol";
export type RegimeTrend = "Bull" | "Bear" | "Sideways";
export type RegimeMacro = "Risk On" | "Neutral" | "Risk Off";
export type TrafficLight = "green" | "yellow" | "red";

export type RegimeInputRow = {
  date: string;
  equity: number;
};

export type RegimeSourceType = "demo" | "upload" | "track-record" | "optimizer" | "portfolio";

export type RegimeSourceSummary = {
  name: string;
  type: RegimeSourceType;
  dateRange: string;
  trades: number;
  market: string;
  status: string;
  isDemo: boolean;
};

export type RegimeTimelinePoint = {
  index: number;
  date: string;
  equity: number;
  returnPct: number;
  rollingVol: number;
  trendSlope: number;
  volatilityRegime: RegimeVolatility;
  trendRegime: RegimeTrend;
  macroRegime: RegimeMacro;
  combinedRegime: string;
};

export type RegimeMetricRow = {
  regime: string;
  returnPct: number;
  sharpe: number;
  maxDrawdown: number;
  tradeCount: number;
};

export type RegimeHeatmapCell = {
  trend: RegimeTrend;
  volatility: RegimeVolatility;
  sharpe: number;
  returnPct: number;
  maxDrawdown: number;
  tradeCount: number;
};

export type CurrentRegimeCard = {
  label: string;
  value: string;
  light: TrafficLight;
  detail: string;
};

export type RegimeAnalysisResponse = {
  source: RegimeSourceSummary;
  interpretation: string;
  currentSummary: CurrentRegimeCard[];
  timeline: RegimeTimelinePoint[];
  regimeTable: RegimeMetricRow[];
  heatmap: RegimeHeatmapCell[];
  equityCurve: Array<{ date: string; equity: number; returnPct: number }>;
};
