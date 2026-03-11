import type { OptimizerAssetId, OptimizerConfig } from "@/lib/optimizer/types";

export const OPTIMIZER_FX_UNIVERSE: Array<{ assetId: OptimizerAssetId; symbol: string; label: string }> = [
  { assetId: "cross_eurusd", symbol: "EURUSD", label: "EUR/USD" },
  { assetId: "cross_gbpusd", symbol: "GBPUSD", label: "GBP/USD" },
  { assetId: "cross_usdjpy", symbol: "USDJPY", label: "USD/JPY" },
  { assetId: "cross_usdchf", symbol: "USDCHF", label: "USD/CHF" },
  { assetId: "cross_audusd", symbol: "AUDUSD", label: "AUD/USD" },
  { assetId: "cross_usdcad", symbol: "USDCAD", label: "USD/CAD" },
  { assetId: "cross_nzdusd", symbol: "NZDUSD", label: "NZD/USD" },
];

export const DEFAULT_OPTIMIZER_CONFIG: OptimizerConfig = {
  assets: OPTIMIZER_FX_UNIVERSE.map((item) => item.assetId),
  source: "dukascopy",
  monteCarloSimulations: 1000,
  valuationPeriods: [10, 15, 20],
  valuationModes: ["ANY_SINGLE", "TWO_OF_THREE", "ALL_THREE", "COMBINED", "WEIGHTED_COMBINED"],
  valuationMultiPeriodLogics: ["SINGLE", "OR", "AND", "AGREEMENT"],
  valuationWeightProfiles: ["equal", "macro", "fx"],
  broadRanges: {
    zoneLookback: { min: 3, max: 10, step: 1 },
    valuationThreshold: { min: 75, max: 75, step: 1 },
    seasonalityYears: { min: 8, max: 12, step: 2 },
    holdDays: { min: 5, max: 20, step: 1 },
    atrPeriod: { min: 10, max: 20, step: 5 },
    atrMultiplier: { min: 1, max: 3, step: 0.5 },
    fixedStopPct: { min: 0.4, max: 1.2, step: 0.2 },
    takeProfitRr: { min: 1, max: 3, step: 0.5 },
    breakEvenRr: { min: 0.5, max: 1.5, step: 0.5 },
  },
  toggles: {
    allowNormalZones: true,
    allowStrongZones: true,
    requireCandleConfirmation: true,
    requireValuation: true,
    requireSeasonality: true,
    allowLong: true,
    allowShort: true,
  },
};
