export type OverlayMode =
  | "none"
  | "inflation"
  | "policy_rate"
  | "volatility"
  | "commodity_shock"
  | "geo_events"
  | "news_geo"
  | "conflicts"
  | "wildfires"
  | "earthquakes"
  | "ship_tracking"
  | "oil_routes"
  | "container_traffic"
  | "commodity_regions"
  | "global_risk_layer"
  | "global_liquidity_map"
  | "shipping_disruptions"
  | "commodity_stress_map"
  | "regional_asset_highlight";

export interface OverlayToggleState {
  assets: boolean;
  earthquakes: boolean;
  conflicts: boolean;
  wildfires: boolean;
  shipTracking: boolean;
  oilRoutes: boolean;
  containerTraffic: boolean;
  commodityRegions: boolean;
  globalRiskLayer: boolean;
  globalLiquidityMap: boolean;
  shippingDisruptions: boolean;
  commodityStressMap: boolean;
  regionalAssetHighlight: boolean;
}

export interface AssetLocation {
  label: string;
  lat: number;
  lng: number;
  weight: number;
}

export interface AssetItem {
  id: string;
  name: string;
  category: string;
  iconKey: string;
  tvSource: string;
  symbol: string;
  lat: number;
  lng: number;
  country: string;
  color: string;
  defaultEnabled: boolean;
  watchlistFeatured?: boolean;
  showOnGlobe?: boolean;
  locations: AssetLocation[];
}

export interface AssetsResponse {
  updatedAt: string;
  count: number;
  items: AssetItem[];
}

export interface TrackRecordPoint {
  t: string;
  value: number;
  returnPct?: number | null;
  symbol?: string | null;
}

export interface TrackRecordCurve {
  id: string;
  label: string;
  points: TrackRecordPoint[];
}

export interface TrackRecordMonthlyReturn {
  year: number;
  month: number;
  monthReturn: number;
}

export interface TrackRecordPerformanceRow {
  year: number;
  total: number | null;
  months: Record<string, number | null>;
}

export interface TrackRecordResponse {
  updatedAt: string | null;
  metrics: {
    finalEquity: number;
    totalReturnPct: number;
    maxDrawdown: number;
    winRate: number;
    sharpeRatio: number;
    calmarRatio: number;
    trades: number;
  };
  curves: TrackRecordCurve[];
  monthlyReturns: TrackRecordMonthlyReturn[];
  performanceTable: TrackRecordPerformanceRow[];
}

export interface OhlcvPoint {
  t: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

export interface CandleIntegritySummary {
  totalCandles: number;
  validCandles: number;
  rejectedCandles: number;
  invalidStructureCount: number;
  openEqualsCloseCount: number;
  flatRangeCount: number;
  openEqualsClosePct: number;
  flatRangePct: number;
  valid: boolean;
  warnings: string[];
}

export interface SupplyDemandZone {
  start: string;
  end: string;
  low: number;
  high: number;
}

export interface TimeseriesIndicators {
  distanceToDemand: number | null;
  distanceToSupply: number | null;
  rsi: number;
  atrPct: number;
  volatility: number;
  trend: string;
}

export interface AiScoreBreakdown {
  Valuation: number;
  SupplyDemand: number;
  Seasonality: number;
  Momentum: number;
  Volatility: number;
}

export interface TimeseriesResponse {
  assetId: string;
  symbol: string;
  updatedAt: string;
  source?: string;
  sourceRequested?: string;
  sourceUsed?: string;
  fallbackUsed?: boolean;
  fallbackReason?: string | null;
  continuousMode?: "regular" | "backadjusted" | string;
  diagnostics?: {
    timeframe?: string;
    bars?: number;
    start?: string | null;
    end?: string | null;
  };
  integrity?: CandleIntegritySummary;
  ohlcv: OhlcvPoint[];
  supplyDemand: {
    demand: SupplyDemandZone[];
    supply: SupplyDemandZone[];
  };
  indicators: TimeseriesIndicators;
  aiScore: {
    total: number;
    breakdown: Partial<AiScoreBreakdown>;
  };
}

export interface EvaluationPoint {
  t: string;
  v10: number | null;
  v20: number | null;
}

export interface EvaluationSeries {
  id: string;
  label: string;
  symbol: string;
  color: string;
  points: EvaluationPoint[];
}

export interface EvaluationResponse {
  assetId: string;
  updatedAt: string;
  series: EvaluationSeries[];
}

export interface SeasonalityCurvePoint {
  x: number;
  y: number;
}

export interface SeasonalityStats {
  avgReturn20d: number;
  hitRate: number;
  expectedValue: number;
  direction: "LONG" | "SHORT";
  samples: number;
  sharpeRatio: number;
  sortinoRatio: number;
  bestHorizonDays: number;
}

export interface SeasonalityResponse {
  assetId: string;
  updatedAt: string;
  projectionDays: number;
  yearsUsed?: number;
  curve: SeasonalityCurvePoint[];
  stats: SeasonalityStats;
}

export interface NewsItem {
  newsId?: string;
  title: string;
  description?: string;
  source: string;
  url: string;
  publishedAt?: string;
  timestamp?: string;
  language?: string;
  category?: "energy" | "macro" | "geopolitics" | "commodities" | "central_banks" | "infrastructure" | "supply_chain" | string;
  country?: string;
  relatedAssets?: string[];
  marketRelevance?: number;
  sourceCredibility?: number;
  priorityScore?: number;
  sentiment?: "Bullish" | "Bearish" | "Neutral" | string;
  confidence?: number;
  assetImpact?: "Bullish" | "Bearish" | "Neutral" | "No-Signal" | string;
  macroImpact?: "Bullish" | "Bearish" | "Neutral" | "No-Signal" | string;
  impactSymbol?: string;
  sourceDomain?: string;
}

export interface NewsResponse {
  updatedAt: string;
  items: NewsItem[];
}

export interface InflationResponse {
  updatedAt: string;
  countryCpiYoY: Record<string, number>;
}

export interface UsdStrengthResponse {
  updatedAt: string;
  usdScore: number;
  formula: string;
  components: Record<string, number>;
  regions: Record<string, number>;
}

export interface RiskResponse {
  updatedAt: string;
  riskScore: number;
  riskMode: string;
  formula: string;
  components: Record<string, number>;
}

export interface PolicyRateCountryEntry {
  rate: number;
  change: number;
  lastMove: "up" | "down" | "hold";
}

export interface PolicyRateResponse {
  updatedAt: string;
  countryPolicyRate: Record<string, PolicyRateCountryEntry>;
}

export interface VolatilityRegimeResponse {
  updatedAt: string;
  volScore: number;
  regime: "Low" | "Neutral" | "Stress" | string;
  formula: string;
  components: Record<string, number>;
}

export interface CommodityShockSignal {
  id: string;
  label: string;
  region: string;
  threshold: number;
  change20d: number;
  active: boolean;
}

export interface CommodityShockResponse {
  updatedAt: string;
  mode: string;
  signals: CommodityShockSignal[];
  regionScores: Record<string, number>;
}

export interface GlobeCameraState {
  lat: number;
  lng: number;
  altitude: number;
}

export interface PersistedGlobeState {
  selectedAssetId: string;
  enabledAssets: string[];
  selectedOverlay: OverlayMode;
  camera: GlobeCameraState;
}

export interface MarkerPoint {
  id: string;
  assetId: string;
  assetIds: string[];
  isCluster: boolean;
  name: string;
  shortName: string;
  category: string;
  country: string;
  locationLabel: string;
  icon: string;
  iconUrl?: string;
  color: string;
  lat: number;
  lng: number;
  label: string;
  clusterCount: number;
  aiScore: number;
  macroSensitivity: string;
  isCrossEndpoint?: boolean;
  kind?: "asset" | "event" | "ship" | "commodity" | "region";
  eventType?: string;
  eventDate?: string;
  eventSeverity?: string;
  eventHeadline?: string;
  eventDescription?: string;
  eventTimestamp?: string;
  eventUrl?: string;
  eventSentiment?: string;
  eventConfidence?: number;
  shipType?: string;
  shipSpeed?: number;
  shipHeading?: number;
  shipDestination?: string;
  commodity?: string;
  commodityRegion?: string;
  regionId?: string;
  regionScore?: number;
  regionBias?: string;
  regionLabel?: string;
  regionCountries?: string[];
}

export interface CrossPairPath {
  assetId: string;
  name: string;
  from: { code: string; label: string; lat: number; lng: number };
  to: { code: string; label: string; lat: number; lng: number };
  color: string;
}

export interface MacroPoint {
  t: string;
  v: number;
}

export interface FundamentalOscillatorResponse {
  updatedAt: string;
  cot: {
    net: {
      commercials: MacroPoint[];
      largeSpecs: MacroPoint[];
      smallTraders: MacroPoint[];
    };
    index: {
      commercials: MacroPoint[];
      largeSpecs: MacroPoint[];
      smallTraders: MacroPoint[];
    };
  };
  fedLiquidity: {
    net: MacroPoint[];
  };
  vix: {
    vix: MacroPoint[];
    vix3m: MacroPoint[];
    ratioOsc: MacroPoint[];
    regime: string;
  };
}

export interface HeatmapAssetMeta {
  assetId: string;
  symbol: string;
  name: string;
  category: string;
}

export interface HeatmapAssetItem {
  assetId: string;
  name: string;
  symbol: string;
  category: string;
  values: {
    correlation: number;
    valuation: number;
    seasonality: number;
    supplyDemand: number;
    macro?: number;
    combined: number;
    aiScore: number;
  };
}

export interface HeatmapCorrelationTab {
  updatedAt: string;
  timeframe?: string;
  windowBars?: number;
  rollingWindow?: number;
  clusters?: Array<{
    name: string;
    start: number;
    end: number;
    count: number;
  }>;
  assets: HeatmapAssetMeta[];
  matrix: number[][];
}

export interface HeatmapValuationItem extends HeatmapAssetMeta {
  val10: number;
  val20: number;
  score: number;
  deviationPct: number;
  drivers?: {
    dollar: number;
    gold: number;
    us10y: number;
    combined: number;
  };
  dominantDriver?: "dollar" | "gold" | "us10y" | "combined" | string;
}

export interface HeatmapValuationTab {
  updatedAt: string;
  items: HeatmapValuationItem[];
}

export interface HeatmapSeasonalityItem extends HeatmapAssetMeta {
  direction: "LONG" | "SHORT" | string;
  bestHoldPeriod: number;
  expectedReturn: number;
  hitRate: number;
  expectedValue: number;
  strength: number;
  curve: number[];
  score: number;
}

export interface HeatmapSeasonalityTab {
  updatedAt: string;
  items: HeatmapSeasonalityItem[];
}

export interface HeatmapSupplyDemandItem extends HeatmapAssetMeta {
  status: "demand" | "supply" | "neutral" | string;
  distanceToDemand: number | null;
  distanceToSupply: number | null;
  distanceToDemandPct: number | null;
  distanceToSupplyPct: number | null;
  score: number;
}

export interface HeatmapSupplyDemandTab {
  updatedAt: string;
  thresholdPct: number;
  items: HeatmapSupplyDemandItem[];
}

export interface HeatmapCombinedItem extends HeatmapAssetMeta {
  aiScore: number;
  subscores: {
    valuation: number;
    supplyDemand: number;
    seasonality: number;
    momentum: number;
    volatility: number;
  };
  signed: {
    valuation: number;
    supplyDemand: number;
    seasonality: number;
    momentum: number;
  };
}

export interface HeatmapCombinedTab {
  updatedAt: string;
  items: HeatmapCombinedItem[];
}

export interface HeatmapMacroItem extends HeatmapAssetMeta {
  direction: "LONG" | "SHORT" | string;
  score: number;
  macroScore: number;
  strength: number;
  components: {
    risk: number;
    fedLiquidity: number;
    cotIndex: number;
    cotNet: number;
  };
}

export interface HeatmapMacroTab {
  updatedAt: string;
  factors: {
    risk: number;
    fedLiquidity: number;
    cotIndex: number;
    cotNet: number;
  };
  items: HeatmapMacroItem[];
}

export interface HeatmapAssetsResponse {
  updatedAt: string;
  count: number;
  timeframe?: string;
  assets: HeatmapAssetMeta[];
  tabs: {
    correlation: HeatmapCorrelationTab;
    valuation: HeatmapValuationTab;
    seasonality: HeatmapSeasonalityTab;
    supplyDemand: HeatmapSupplyDemandTab;
    macro: HeatmapMacroTab;
    combined: HeatmapCombinedTab;
  };
  items?: HeatmapAssetItem[];
}

export interface OpportunityItem {
  assetId: string;
  name: string;
  symbol: string;
  category: string;
  aiScore: number;
  confidenceScore: number;
  lat: number;
  lng: number;
}

export interface OpportunitiesResponse {
  updatedAt: string;
  long: OpportunityItem[];
  short: OpportunityItem[];
}

export interface CategoryHeatmapItem {
  assetId: string;
  name: string;
  category: string;
  aiScore: number;
  confidenceScore: number;
  momentum: number;
  signalQuality: string;
  tone: "strong_bullish" | "bullish" | "neutral" | "bearish" | "strong_bearish" | string;
}

export interface CategoryHeatmapResponse {
  updatedAt: string;
  category: string;
  sortBy: string;
  categories: string[];
  items: CategoryHeatmapItem[];
}

export interface CorrelationLensItem {
  assetId: string;
  name: string;
  symbol: string;
  value: number;
}

export interface AssetSignalDetailResponse {
  assetId: string;
  aiScore: number;
  confidenceScore: number;
  signalQuality: string;
  components: {
    signalStrength: number;
    dataQuality: number;
    regimeAlignment: number;
    correlationSupport: number;
  };
  whySignal: Array<{ label: string; value: string }>;
  miniCorrelation: {
    timeframe: string;
    positive: CorrelationLensItem[];
    negative: CorrelationLensItem[];
  };
  updatedAt: string;
}

export interface AlertItem {
  assetId: string;
  title: string;
  tone: "bull" | "bear" | "neutral" | string;
}

export interface AlertsResponse {
  updatedAt: string;
  items: AlertItem[];
}

export interface GeoEventItem {
  id: string;
  type: "conflict" | "wildfire" | "earthquake" | "news_geo" | string;
  event_type?: string;
  date: string;
  timestamp?: string;
  location: string;
  severity: string;
  description?: string;
  lat: number;
  latitude?: number;
  lng: number;
  longitude?: number;
  color: string;
  headline?: string;
  url?: string;
  sentiment?: string;
  confidence?: number;
  label?: string;
}

export interface GeoEventsResponse {
  updatedAt: string;
  layer: string;
  items: GeoEventItem[];
}

export interface OverlayRoutePoint {
  lat: number;
  lng: number;
}

export interface OverlayRouteItem {
  id: string;
  name: string;
  from: string;
  to: string;
  path: OverlayRoutePoint[];
  color: string;
  lineWidth?: number;
  animationSpeed?: number;
}

export interface OverlayRoutesResponse {
  updatedAt: string;
  items: OverlayRouteItem[];
}

export interface ShipTrackingItem {
  id: string;
  name: string;
  shipType: "oil_tanker" | "container" | string;
  speed: number;
  heading: number;
  destination: string;
  routeId: string;
  routeName?: string;
  lat: number;
  lng: number;
  progress?: number;
  route?: OverlayRoutePoint[];
  updatedAt?: string;
}

export interface ShipTrackingResponse {
  updatedAt: string;
  items: ShipTrackingItem[];
}

export interface CommodityRegionItem {
  id: string;
  commodity: string;
  region: string;
  lat: number;
  lng: number;
  icon: string;
  description?: string;
}

export interface CommodityRegionsResponse {
  updatedAt: string;
  items: CommodityRegionItem[];
}

export interface NewsTranslationResponse {
  newsId?: string;
  language: string;
  translated: boolean;
  provider: string;
  title: string;
  description: string;
}

export interface GlobalRiskRegionItem {
  id: string;
  name: string;
  lat: number;
  lng: number;
  score: number;
  signal: "risk_on" | "risk_off" | "neutral" | string;
  severity: "low" | "medium" | "high" | string;
  countries: string[];
  components: {
    riskOnOff: number;
    inflation: number;
    shipping: number;
    commodity: number;
  };
}

export interface GlobalRiskLayerResponse {
  updatedAt: string;
  indicators: {
    riskOnOff: Record<string, number>;
    inflationHotspots: Record<string, number>;
    shippingDisruptions: Record<string, number>;
    commodityStress: Record<string, number>;
  };
  regions: GlobalRiskRegionItem[];
}

export interface GlobalLiquidityRegionItem {
  id: string;
  name: string;
  lat: number;
  lng: number;
  score: number;
  signal: "high_liquidity" | "tightening" | "neutral" | string;
  severity: "low" | "medium" | "high" | string;
  countries: string[];
  components: {
    centralBankLiquidity: number;
    usdFundingStress: number;
    capitalFlows: number;
  };
}

export interface GlobalLiquidityMapResponse {
  updatedAt: string;
  indicators: {
    centralBankLiquidity: Record<string, number>;
    usdFundingStress: Record<string, number>;
    globalCapitalFlows: Record<string, number>;
  };
  regions: GlobalLiquidityRegionItem[];
}

export interface ShippingDisruptionsResponse {
  updatedAt: string;
  items: GeoEventItem[];
  routes: OverlayRouteItem[];
}

export interface CommodityStressRegionItem extends CommodityRegionItem {
  stressScore: number;
  stressLevel: "low" | "medium" | "high" | string;
  glow: boolean;
}

export interface CommodityStressMapResponse {
  updatedAt: string;
  mode: string;
  regionScores: Record<string, number>;
  items: CommodityStressRegionItem[];
}

export interface AssetRegionEntry {
  id: string;
  name: string;
  lat: number;
  lng: number;
  countries: string[];
}

export interface AssetRegionHighlightResponse {
  updatedAt: string;
  assetId: string;
  bias: "bullish" | "bearish" | "neutral" | string;
  score: number;
  regions: AssetRegionEntry[];
  assetRegionMap: Record<string, string | string[]>;
}

export interface DiagnosticsTimeframeRow {
  timeframe: string;
  updatedAt: string;
  windowBars: number;
  rollingWindow: number;
  matrixSize: number;
  status: string;
  source: string;
}

export interface DiagnosticsResponse {
  updatedAt: string;
  assetMap: {
    totalAssets: number;
    missingFieldCount: number;
    missingFields: Array<{ assetId: string; missing: string[] }>;
    missingLocations: number;
    duplicateCoordinateCount: number;
    duplicateCoordinates: Array<{ coord: { lat: number; lng: number }; assets: string[] }>;
  };
  seasonality: {
    checkedAssets: number;
    emptySeriesCount: number;
    badHorizonCount: number;
    pendingCount: number;
    emptyAssets: string[];
    badHorizonAssets: string[];
    pendingAssets: string[];
  };
  timeframes: DiagnosticsTimeframeRow[];
  freshness: Record<string, string>;
}
