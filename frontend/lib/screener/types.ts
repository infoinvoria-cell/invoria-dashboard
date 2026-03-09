import type { DataSource } from "@/components/screener/types";
import type {
  CommodityShockResponse,
  EvaluationResponse,
  FundamentalOscillatorResponse,
  HeatmapSeasonalityItem,
  InflationResponse,
  OhlcvPoint,
  RiskResponse,
  SeasonalityResponse,
  TimeseriesResponse,
  VolatilityRegimeResponse,
} from "@/types";

export type ScreenerTheme = "blue" | "gold";
export type PineWeekdayKey = "mon" | "tue" | "wed" | "thu" | "fri";
export type PineMonthKey = "jan" | "feb" | "mar" | "apr" | "may" | "jun" | "jul" | "aug" | "sep" | "oct" | "nov" | "dec";
export type ValuationAgreementMode = "1of4" | "2of4" | "3of4" | "combined";
export type ValuationSignalWindow = "val10" | "val20";
export type PineSignalDirection = "LONG" | "SHORT" | "NEUTRAL" | "CONFLICT";
export type ScreenerRowSignal = "long" | "short" | "recent-long" | "recent-short" | "neutral";
export type ScreenerSortKey = "default" | "asset" | "entry" | "priority" | "signal" | "seasonalHitRate" | "val10" | "val20" | "age";
export type ScreenerSortDirection = "asc" | "desc";
export type MacroAlignmentState = "supportive" | "neutral" | "contradicting";

export type PineWeekdayFilters = Record<PineWeekdayKey, boolean>;
export type PineMonthFilters = Record<PineMonthKey, boolean>;

export type PineScreenerSettings = {
  source: DataSource;
  timeframe: "D" | "W";
  screenerLookback: number;
  valuationSignalWindow: ValuationSignalWindow;
  valuationAgreementMode: ValuationAgreementMode;
  selectedAssetGroups: string[];
  compareSymbol1: string;
  compareSymbol2: string;
  compareSymbol3: string;
  length: number;
  rescaleLength: number;
  top: number;
  bottom: number;
  comactive: boolean;
  comactive1: boolean;
  sd: boolean;
  sd1: boolean;
  candle: boolean;
  longg: boolean;
  shortt: boolean;
  dojiextrem: boolean;
  minBarsBeforeBox: number;
  pauseBars: number;
  yearsReq: number;
  commercial: boolean;
  index1: boolean;
  smalltrader: boolean;
  indexsmall: boolean;
  andcot: boolean;
  umkehrcot: boolean;
  orcot: boolean;
  zeitfilter: boolean;
  zeitzone: number;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
  seasonalityThreshold: number;
  weekdays: PineWeekdayFilters;
  months: PineMonthFilters;
};

export type ValuationSeriesPoint = {
  t: string;
  compare1: number | null;
  compare2: number | null;
  compare3: number | null;
  combined: number | null;
  long1: boolean;
  short1: boolean;
  long12: boolean;
  short12: boolean;
  longval: boolean;
  shortval: boolean;
  phaseval: PineSignalDirection;
  longHits: number;
  shortHits: number;
};

export type PineZone = {
  id: string;
  kind: "demand" | "supply";
  strength: "normal" | "strong";
  start: string;
  end: string;
  low: number;
  high: number;
  originIndex: number;
  startIndex: number;
  endIndex: number;
  active: boolean;
  broken: boolean;
  touched: boolean;
  inZone: boolean;
  lastTouchedIndex: number | null;
};

export type PineSignalState = {
  currentLong: boolean;
  recentLong: boolean;
  currentShort: boolean;
  recentShort: boolean;
  currentDirection: ScreenerRowSignal;
  lastSignalIndex: number | null;
  ageBars: number | null;
};

export type PineBarDecision = {
  index: number;
  time: string;
  allowedLong: boolean;
  allowedShort: boolean;
  signal: "long" | "short" | "none";
  seasonalityPass: boolean;
  valuationPassLong: boolean;
  valuationPassShort: boolean;
  zonePassLong: boolean;
  zonePassShort: boolean;
  candlePassLong: boolean;
  candlePassShort: boolean;
  dojiBlocked: boolean;
  timePassed: boolean;
  weekdayPassed: boolean;
  monthPassed: boolean;
  agePassed: boolean;
};

export type PineScreenerRow = {
  assetId: string;
  name: string;
  symbol: string;
  category: string;
  assetGroup: string;
  signal: ScreenerRowSignal;
  signalDirection: "LONG" | "SHORT" | "NONE";
  signalLabel: string;
  entryState: "ACTIVE" | "RECENT" | "WAIT";
  entryConfirmed: boolean;
  priority: number;
  ageBars: number | null;
  passesSignalFilter: boolean;
  seasonalityScore: number;
  seasonalityDirection: "LONG" | "SHORT" | "NEUTRAL";
  val10Combined: number;
  val20Combined: number;
  val10Direction: "LONG" | "SHORT" | "NONE";
  val20Direction: "LONG" | "SHORT" | "NONE";
  val10MatchCount: number;
  val20MatchCount: number;
  val10Components: [number, number, number, number];
  val20Components: [number, number, number, number];
  valuationPhase: PineSignalDirection;
  supplyDemandLabel: string;
  supplyDemandStrongLabel: string;
  supplyDemandStrength: "normal" | "strong" | "none";
  supplyDemandDirection: "demand" | "supply" | "neutral";
  hasNormalDemand: boolean;
  hasNormalSupply: boolean;
  hasStrongDemand: boolean;
  hasStrongSupply: boolean;
  currentPatternLabel: string;
  currentPatternHoldDays: number;
  currentPatternHitRate: number;
  currentPatternAvgReturn: number;
  nextPatternLabel: string;
  nextPatternHoldDays: number;
  nextPatternHitRate: number;
  nextPatternAvgReturn: number;
  seasonalityCurve: number[];
  cpiAlignment: MacroAlignmentState;
  ppiAlignment: MacroAlignmentState;
  cotCommercialsAlignment: MacroAlignmentState;
  riskAlignment: MacroAlignmentState;
  lastCandles: OhlcvPoint[];
  selected: boolean;
  loading: boolean;
};

export type ScreenerMacroSnapshot = {
  fetchedAt: number;
  inflation: InflationResponse | null;
  risk: RiskResponse | null;
  volatility: VolatilityRegimeResponse | null;
  fundamental: FundamentalOscillatorResponse | null;
  commodityShock: CommodityShockResponse | null;
};

export type ScreenerSelectedAnalysis = {
  timeseries: TimeseriesResponse | null;
  seasonality: SeasonalityResponse | null;
  seasonalityHeatmap: HeatmapSeasonalityItem | null;
  valuation: {
    evaluationPayload: EvaluationResponse;
    val10Points: ValuationSeriesPoint[];
    val20Points: ValuationSeriesPoint[];
    activeVal10: ValuationSeriesPoint | null;
    activeVal20: ValuationSeriesPoint | null;
  } | null;
  signals: PineSignalState | null;
  decisions: PineBarDecision[];
  zones: PineZone[];
};
