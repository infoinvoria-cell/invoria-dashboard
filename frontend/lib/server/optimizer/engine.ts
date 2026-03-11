import type {
  OptimizerClusterSummary,
  OptimizerConfig,
  OptimizerParameterHeatmap,
  OptimizerParameterKey,
  OptimizerProgressSnapshot,
  OptimizerRunResponse,
  OptimizerStageSummary,
  OptimizerStrategyResult,
  StopMode,
  StrategyParams,
  ValuationMode,
  ValuationMultiPeriodLogic,
  ValuationWeightProfile,
  ZoneMode,
} from "@/lib/optimizer/types";
import type { OptimizerLoadedData } from "@/lib/server/optimizer/data";
import { runMonteCarlo } from "@/lib/server/optimizer/monteCarlo";
import { buildOptimizerPreview, evaluateStrategyCandidate } from "@/lib/server/optimizer/strategy";

const TRAIN_START = "2012-01-01T00:00:00Z";
const TRAIN_END = "2019-12-31T23:59:59Z";
const TEST_START = "2020-01-01T00:00:00Z";
const TEST_END = "2025-12-31T23:59:59Z";

const BROAD_STAGE_KEEP = 100;
const REFINE_STAGE_KEEP = 20;
const OOS_STAGE_KEEP = 5;
const BROAD_CANDIDATE_BUDGET = 6000;
const REFINE_CANDIDATE_BUDGET = 4000;
const INVALID_STRATEGY_KEEP = 24;
const EVAL_BATCH_SIZE = 500;
const STAGE_COUNT = 5;
const FIXED_VALUATION_THRESHOLD = 75;
const VALUATION_MODE_ORDER: ValuationMode[] = ["ANY_SINGLE", "TWO_OF_THREE", "ALL_THREE", "COMBINED", "WEIGHTED_COMBINED"];
const MULTI_PERIOD_LOGIC_ORDER: ValuationMultiPeriodLogic[] = ["SINGLE", "OR", "AND", "AGREEMENT"];
const WEIGHT_PROFILE_ORDER: ValuationWeightProfile[] = ["equal", "macro", "fx"];

const HEATMAP_PAIRS: Array<{ stage: 1 | 2; xKey: OptimizerParameterKey; yKey: OptimizerParameterKey }> = [
  { stage: 1, xKey: "valuationPrimaryPeriod", yKey: "valuationModeIndex" },
  { stage: 1, xKey: "valuationMultiPeriodLogicIndex", yKey: "holdDays" },
  { stage: 2, xKey: "valuationSecondaryPeriod", yKey: "takeProfitRr" },
  { stage: 2, xKey: "valuationWeightProfileIndex", yKey: "zoneLookback" },
];

type StageEvalOptions = {
  startDate: string;
  endDate: string;
  enforceFilters: boolean;
};

type PipelineOptions = {
  runId: string;
  onProgress?: (progress: OptimizerProgressSnapshot) => Promise<void> | void;
};

type EvaluatedCandidate = {
  params: StrategyParams;
  result: Omit<OptimizerStrategyResult, "rank" | "stage" | "strategyId" | "monteCarlo">;
};

type EvaluationBatch = {
  valid: EvaluatedCandidate[];
  invalid: EvaluatedCandidate[];
};

type RankedCandidate = EvaluatedCandidate & {
  rank: number;
  stage: 1 | 2 | 3;
  strategyId: string;
};

type HeatmapBucket = {
  candidates: RankedCandidate[];
  scoreSum: number;
  sharpeSum: number;
  cagrSum: number;
  maxDrawdownSum: number;
  tradeSum: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function quantile(values: number[], q: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q)));
  return sorted[index];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function rangeValues(min: number, max: number, step: number): number[] {
  const decimals = step.toString().includes(".") ? step.toString().split(".")[1].length : 0;
  const values: number[] = [];
  for (let current = min; current <= max + (step / 10); current += step) {
    values.push(Number(current.toFixed(decimals)));
  }
  return values;
}

function dedupeParams(candidates: StrategyParams[]): StrategyParams[] {
  const seen = new Set<string>();
  const unique: StrategyParams[] = [];
  for (const params of candidates) {
    const key = JSON.stringify(params);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(params);
  }
  return unique;
}

function dedupeNumbers(values: number[]): number[] {
  return Array.from(new Set(values.map((value) => Number(value.toFixed(4))))).sort((left, right) => left - right);
}

function valuationModeIndex(mode: ValuationMode): number {
  return Math.max(0, VALUATION_MODE_ORDER.indexOf(mode));
}

function multiPeriodLogicIndex(mode: ValuationMultiPeriodLogic): number {
  return Math.max(0, MULTI_PERIOD_LOGIC_ORDER.indexOf(mode));
}

function weightProfileIndex(profile: ValuationWeightProfile): number {
  return Math.max(0, WEIGHT_PROFILE_ORDER.indexOf(profile));
}

function paramValue(params: StrategyParams, key: OptimizerParameterKey): number {
  switch (key) {
    case "valuationModeIndex":
      return valuationModeIndex(params.valuationPrimaryMode);
    case "valuationMultiPeriodLogicIndex":
      return multiPeriodLogicIndex(params.valuationMultiPeriodLogic);
    case "valuationWeightProfileIndex":
      return weightProfileIndex(params.valuationWeightProfile);
    case "valuationSecondaryPeriod":
      return Number(params.valuationSecondaryPeriod ?? 0);
    default:
      return Number(params[key]);
  }
}

function strategyId(stage: 1 | 2 | 3, rank: number, params: StrategyParams): string {
  const directionBits = `${params.allowLong ? "L" : ""}${params.allowShort ? "S" : ""}` || "N";
  const valuationBits = `${params.valuationPrimaryPeriod}${params.valuationSecondaryPeriod ? `-${params.valuationSecondaryPeriod}` : ""}-${params.valuationPrimaryMode}-${params.valuationMultiPeriodLogic}-${params.valuationWeightProfile}`;
  return `S${stage}-${String(rank).padStart(4, "0")}-${params.zoneMode}-${params.stopMode}-${params.zoneLookback}-${params.holdDays}-${valuationBits}-${directionBits}`;
}

function summarizeRankedCandidate(
  candidate: RankedCandidate,
  includeDetail: boolean,
  monteCarlo: OptimizerStrategyResult["monteCarlo"],
): OptimizerStrategyResult {
  return {
    rank: candidate.rank,
    stage: candidate.stage,
    strategyId: candidate.strategyId,
    params: candidate.params,
    valuation: candidate.result.valuation,
    metrics: candidate.result.metrics,
    assetMetrics: candidate.result.assetMetrics,
    equityCurve: includeDetail ? candidate.result.equityCurve : candidate.result.equityCurve.slice(-24),
    trades: includeDetail ? candidate.result.trades : [],
    validation: candidate.result.validation,
    debugAssets: includeDetail ? candidate.result.debugAssets : [],
    monteCarlo,
  };
}

function buildBaseCandidateGrid(config: OptimizerConfig): StrategyParams[] {
  const zoneModes: ZoneMode[] = [];
  if (config.toggles.allowNormalZones) zoneModes.push("normal");
  if (config.toggles.allowStrongZones) zoneModes.push("strong");
  if (config.toggles.allowNormalZones && config.toggles.allowStrongZones) zoneModes.push("both");

  const stopModes: StopMode[] = ["fixed", "atr"];
  const zoneLookbacks = rangeValues(config.broadRanges.zoneLookback.min, config.broadRanges.zoneLookback.max, config.broadRanges.zoneLookback.step);
  const seasonalityYears = rangeValues(config.broadRanges.seasonalityYears.min, config.broadRanges.seasonalityYears.max, config.broadRanges.seasonalityYears.step);
  const holdDays = rangeValues(config.broadRanges.holdDays.min, config.broadRanges.holdDays.max, config.broadRanges.holdDays.step);
  const atrPeriods = rangeValues(config.broadRanges.atrPeriod.min, config.broadRanges.atrPeriod.max, config.broadRanges.atrPeriod.step);
  const atrMultipliers = rangeValues(config.broadRanges.atrMultiplier.min, config.broadRanges.atrMultiplier.max, config.broadRanges.atrMultiplier.step);
  const fixedStops = rangeValues(config.broadRanges.fixedStopPct.min, config.broadRanges.fixedStopPct.max, config.broadRanges.fixedStopPct.step);
  const takeProfitRrs = rangeValues(config.broadRanges.takeProfitRr.min, config.broadRanges.takeProfitRr.max, config.broadRanges.takeProfitRr.step);
  const breakEvenRrs = rangeValues(config.broadRanges.breakEvenRr.min, config.broadRanges.breakEvenRr.max, config.broadRanges.breakEvenRr.step);

  const valuationPeriods = [...config.valuationPeriods].sort((left, right) => left - right);
  const valuationModes = config.valuationModes.length ? config.valuationModes : VALUATION_MODE_ORDER;
  const multiPeriodLogics = config.valuationMultiPeriodLogics.filter((logic) => logic !== "SINGLE");
  const weightProfiles = config.valuationWeightProfiles.length ? config.valuationWeightProfiles : WEIGHT_PROFILE_ORDER;

  const candidates: StrategyParams[] = [];
  for (const zoneMode of zoneModes) {
    for (const stopMode of stopModes) {
      for (const zoneLookback of zoneLookbacks) {
        for (const years of seasonalityYears) {
          for (const hold of holdDays) {
            for (const atrPeriod of atrPeriods) {
              for (const atrMultiplier of atrMultipliers) {
                for (const fixedStopPct of fixedStops) {
                  for (const takeProfitRr of takeProfitRrs) {
                    for (const breakEvenRr of breakEvenRrs) {
                      for (const weightProfile of weightProfiles) {
                        for (const primaryPeriod of valuationPeriods) {
                          for (const primaryMode of valuationModes) {
                            candidates.push({
                              zoneMode,
                              zoneLookback,
                              valuationPrimaryPeriod: primaryPeriod,
                              valuationSecondaryPeriod: null,
                              valuationPrimaryMode: primaryMode,
                              valuationSecondaryMode: null,
                              valuationMultiPeriodLogic: "SINGLE",
                              valuationWeightProfile: weightProfile,
                              valuationThreshold: FIXED_VALUATION_THRESHOLD,
                              seasonalityYears: years,
                              holdDays: hold,
                              stopMode,
                              atrPeriod,
                              atrMultiplier,
                              fixedStopPct,
                              takeProfitRr,
                              breakEvenRr,
                              requireCandleConfirmation: config.toggles.requireCandleConfirmation,
                              requireValuation: true,
                              requireSeasonality: true,
                              allowLong: config.toggles.allowLong,
                              allowShort: config.toggles.allowShort,
                            });
                            for (const secondaryPeriod of valuationPeriods.filter((candidate) => candidate > primaryPeriod)) {
                              for (const secondaryMode of valuationModes) {
                                for (const multiPeriodLogic of multiPeriodLogics) {
                                  candidates.push({
                                    zoneMode,
                                    zoneLookback,
                                    valuationPrimaryPeriod: primaryPeriod,
                                    valuationSecondaryPeriod: secondaryPeriod,
                                    valuationPrimaryMode: primaryMode,
                                    valuationSecondaryMode: secondaryMode,
                                    valuationMultiPeriodLogic: multiPeriodLogic,
                                    valuationWeightProfile: weightProfile,
                                    valuationThreshold: FIXED_VALUATION_THRESHOLD,
                                    seasonalityYears: years,
                                    holdDays: hold,
                                    stopMode,
                                    atrPeriod,
                                    atrMultiplier,
                                    fixedStopPct,
                                    takeProfitRr,
                                    breakEvenRr,
                                    requireCandleConfirmation: config.toggles.requireCandleConfirmation,
                                    requireValuation: true,
                                    requireSeasonality: true,
                                    allowLong: config.toggles.allowLong,
                                    allowShort: config.toggles.allowShort,
                                  });
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  return dedupeParams(candidates);
}

function trimCandidateGrid(candidates: StrategyParams[], budget: number): StrategyParams[] {
  if (candidates.length <= budget) return candidates;
  const trimmed: StrategyParams[] = [];
  const stride = candidates.length / budget;
  for (let index = 0; index < budget; index += 1) {
    trimmed.push(candidates[Math.floor(index * stride)]);
  }
  return dedupeParams(trimmed);
}

function refinedValueSet(center: number, step: number, min: number, max: number): number[] {
  const delta = Math.max(step / 2, step >= 1 ? 1 : 0.1);
  return dedupeNumbers([clamp(center - delta, min, max), center, clamp(center + delta, min, max)]);
}

function buildRefinedCandidates(seed: StrategyParams, config: OptimizerConfig): StrategyParams[] {
  const refinedZoneModes: ZoneMode[] = seed.zoneMode === "both" ? ["both", "normal", "strong"] : [seed.zoneMode, "both"];
  const refinedStopModes: StopMode[] = seed.stopMode === "atr" ? ["atr", "fixed"] : ["fixed", "atr"];
  const neighborhood = {
    zoneLookback: refinedValueSet(seed.zoneLookback, config.broadRanges.zoneLookback.step, config.broadRanges.zoneLookback.min, config.broadRanges.zoneLookback.max),
    seasonalityYears: refinedValueSet(seed.seasonalityYears, config.broadRanges.seasonalityYears.step, config.broadRanges.seasonalityYears.min, config.broadRanges.seasonalityYears.max),
    holdDays: refinedValueSet(seed.holdDays, config.broadRanges.holdDays.step, config.broadRanges.holdDays.min, config.broadRanges.holdDays.max),
    atrPeriod: refinedValueSet(seed.atrPeriod, config.broadRanges.atrPeriod.step, config.broadRanges.atrPeriod.min, config.broadRanges.atrPeriod.max),
    atrMultiplier: refinedValueSet(seed.atrMultiplier, config.broadRanges.atrMultiplier.step, config.broadRanges.atrMultiplier.min, config.broadRanges.atrMultiplier.max),
    fixedStopPct: refinedValueSet(seed.fixedStopPct, config.broadRanges.fixedStopPct.step, config.broadRanges.fixedStopPct.min, config.broadRanges.fixedStopPct.max),
    takeProfitRr: refinedValueSet(seed.takeProfitRr, config.broadRanges.takeProfitRr.step, config.broadRanges.takeProfitRr.min, config.broadRanges.takeProfitRr.max),
    breakEvenRr: refinedValueSet(seed.breakEvenRr, config.broadRanges.breakEvenRr.step, config.broadRanges.breakEvenRr.min, config.broadRanges.breakEvenRr.max),
  };

  const candidates: StrategyParams[] = [seed];
  for (const zoneMode of refinedZoneModes) {
    for (const stopMode of refinedStopModes) {
      for (const zoneLookback of neighborhood.zoneLookback) candidates.push({ ...seed, zoneMode, stopMode, zoneLookback });
      for (const seasonalityYears of neighborhood.seasonalityYears) candidates.push({ ...seed, zoneMode, stopMode, seasonalityYears });
      for (const holdDays of neighborhood.holdDays) candidates.push({ ...seed, zoneMode, stopMode, holdDays });
      for (const atrPeriod of neighborhood.atrPeriod) candidates.push({ ...seed, zoneMode, stopMode, atrPeriod });
      for (const atrMultiplier of neighborhood.atrMultiplier) candidates.push({ ...seed, zoneMode, stopMode, atrMultiplier });
      for (const fixedStopPct of neighborhood.fixedStopPct) candidates.push({ ...seed, zoneMode, stopMode, fixedStopPct });
      for (const takeProfitRr of neighborhood.takeProfitRr) candidates.push({ ...seed, zoneMode, stopMode, takeProfitRr });
      for (const breakEvenRr of neighborhood.breakEvenRr) candidates.push({ ...seed, zoneMode, stopMode, breakEvenRr });
      for (const valuationPrimaryPeriod of config.valuationPeriods) candidates.push({ ...seed, zoneMode, stopMode, valuationPrimaryPeriod });
      for (const valuationPrimaryMode of config.valuationModes) candidates.push({ ...seed, zoneMode, stopMode, valuationPrimaryMode });
      for (const valuationWeightProfile of config.valuationWeightProfiles) candidates.push({ ...seed, zoneMode, stopMode, valuationWeightProfile });
      for (const valuationSecondaryPeriod of [null, ...config.valuationPeriods.filter((period) => period !== seed.valuationPrimaryPeriod)]) {
        candidates.push({
          ...seed,
          zoneMode,
          stopMode,
          valuationSecondaryPeriod,
          valuationSecondaryMode: valuationSecondaryPeriod == null ? null : (seed.valuationSecondaryMode ?? seed.valuationPrimaryMode),
          valuationMultiPeriodLogic: valuationSecondaryPeriod == null ? "SINGLE" : seed.valuationMultiPeriodLogic,
        });
      }
      for (const valuationSecondaryMode of config.valuationModes) {
        if (seed.valuationSecondaryPeriod != null) {
          candidates.push({ ...seed, zoneMode, stopMode, valuationSecondaryMode });
        }
      }
      for (const valuationMultiPeriodLogic of config.valuationMultiPeriodLogics) {
        candidates.push({
          ...seed,
          zoneMode,
          stopMode,
          valuationMultiPeriodLogic,
          valuationSecondaryPeriod: valuationMultiPeriodLogic === "SINGLE" ? null : (seed.valuationSecondaryPeriod ?? config.valuationPeriods[1] ?? config.valuationPeriods[0] ?? null),
          valuationSecondaryMode: valuationMultiPeriodLogic === "SINGLE" ? null : (seed.valuationSecondaryMode ?? seed.valuationPrimaryMode),
        });
      }
    }
  }

  return dedupeParams(
    candidates.map((params) => ({
      ...params,
      valuationThreshold: FIXED_VALUATION_THRESHOLD,
      requireValuation: true,
      requireSeasonality: true,
      zoneLookback: Math.round(params.zoneLookback),
      seasonalityYears: Math.round(params.seasonalityYears),
      holdDays: Math.round(params.holdDays),
      atrPeriod: Math.round(params.atrPeriod),
    })),
  );
}

async function emitProgress(
  options: PipelineOptions,
  stage: OptimizerProgressSnapshot["stage"],
  label: string,
  stageIndex: number,
  completed: number,
  total: number,
  stageStartedAt: number,
  message: string,
): Promise<void> {
  const elapsedSeconds = Math.max(0.001, (Date.now() - stageStartedAt) / 1000);
  const etaSeconds = completed > 0 && total > 0
    ? Math.max(0, Math.round(((elapsedSeconds / completed) * Math.max(total - completed, 0))))
    : null;
  await options.onProgress?.({
    runId: options.runId,
    stage,
    label,
    stageIndex,
    stageCount: STAGE_COUNT,
    percent: total > 0 ? Math.min(100, (completed / total) * 100) : 0,
    completed,
    total,
    etaSeconds,
    message,
    updatedAt: new Date().toISOString(),
  });
}

async function evaluateCandidates(
  data: OptimizerLoadedData,
  candidates: StrategyParams[],
  options: StageEvalOptions,
  progress: {
    pipeline: PipelineOptions;
    stage: "stage1" | "stage2" | "stage3";
    label: string;
    stageIndex: number;
  },
): Promise<EvaluationBatch> {
  const valid: EvaluatedCandidate[] = [];
  const invalid: EvaluatedCandidate[] = [];
  const startedAt = Date.now();

  await emitProgress(progress.pipeline, progress.stage, progress.label, progress.stageIndex, 0, candidates.length, startedAt, "Preparing batch evaluation.");

  for (let offset = 0; offset < candidates.length; offset += EVAL_BATCH_SIZE) {
    const batch = candidates.slice(offset, offset + EVAL_BATCH_SIZE);
    for (const params of batch) {
      const evaluation = evaluateStrategyCandidate(
        params,
        data.assets,
        data.references,
        data.integrity,
        options.startDate,
        options.endDate,
        { enforceFilters: options.enforceFilters },
      );
      if (evaluation.status === "valid") {
        valid.push({ params, result: evaluation.result });
      } else if (evaluation.status === "invalid_trade_count") {
        invalid.push({ params, result: evaluation.result });
      }
    }

    await emitProgress(
      progress.pipeline,
      progress.stage,
      progress.label,
      progress.stageIndex,
      Math.min(offset + batch.length, candidates.length),
      candidates.length,
      startedAt,
      `${Math.min(offset + batch.length, candidates.length).toLocaleString()} / ${candidates.length.toLocaleString()} strategies evaluated.`,
    );
    await sleep(0);
  }

  return {
    valid: valid.sort((left, right) => right.result.metrics.score - left.result.metrics.score),
    invalid: invalid.sort((left, right) => right.result.metrics.score - left.result.metrics.score).slice(0, INVALID_STRATEGY_KEEP),
  };
}

function rankCandidates(stage: 1 | 2 | 3, candidates: EvaluatedCandidate[]): RankedCandidate[] {
  return candidates.map((candidate, index) => ({
    ...candidate,
    stage,
    rank: index + 1,
    strategyId: strategyId(stage, index + 1, candidate.params),
  }));
}

function buildStageSummary(stage: 1 | 2 | 3, label: string, candidates: RankedCandidate[], keepDetailRanks: number[]): OptimizerStageSummary {
  return {
    stage,
    label,
    strategyCount: candidates.length,
    topStrategies: candidates.map((candidate) => summarizeRankedCandidate(candidate, keepDetailRanks.includes(candidate.rank), null)),
  };
}

function buildHeatmap(stage: 1 | 2, xKey: OptimizerParameterKey, yKey: OptimizerParameterKey, candidates: RankedCandidate[]): OptimizerParameterHeatmap {
  const buckets = new Map<string, HeatmapBucket>();
  const xValues = dedupeNumbers(candidates.map((candidate) => paramValue(candidate.params, xKey)));
  const yValues = dedupeNumbers(candidates.map((candidate) => paramValue(candidate.params, yKey)));

  for (const candidate of candidates) {
    const x = paramValue(candidate.params, xKey);
    const y = paramValue(candidate.params, yKey);
    const key = `${x}|${y}`;
    const current = buckets.get(key) ?? {
      candidates: [],
      scoreSum: 0,
      sharpeSum: 0,
      cagrSum: 0,
      maxDrawdownSum: 0,
      tradeSum: 0,
    };
    current.candidates.push(candidate);
    current.scoreSum += candidate.result.metrics.score;
    current.sharpeSum += candidate.result.metrics.sharpe;
    current.cagrSum += candidate.result.metrics.cagr;
    current.maxDrawdownSum += candidate.result.metrics.maxDrawdown;
    current.tradeSum += candidate.result.metrics.trades;
    buckets.set(key, current);
  }

  const cells = Array.from(buckets.entries()).map(([key, bucket]) => {
    const [xRaw, yRaw] = key.split("|");
    const count = bucket.candidates.length;
    return {
      x: Number(xRaw),
      y: Number(yRaw),
      score: bucket.scoreSum / count,
      sharpe: bucket.sharpeSum / count,
      cagr: bucket.cagrSum / count,
      maxDrawdown: bucket.maxDrawdownSum / count,
      trades: bucket.tradeSum / count,
      count,
      smoothedScore: 0,
    };
  });

  const cellByIndex = new Map<string, number>();
  for (const cell of cells) {
    const xi = xValues.indexOf(cell.x);
    const yi = yValues.indexOf(cell.y);
    cellByIndex.set(`${xi}|${yi}`, cell.score);
  }

  for (const cell of cells) {
    const xi = xValues.indexOf(cell.x);
    const yi = yValues.indexOf(cell.y);
    const neighborhood: number[] = [];
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const score = cellByIndex.get(`${xi + dx}|${yi + dy}`);
        if (typeof score === "number") neighborhood.push(score);
      }
    }
    cell.smoothedScore = mean(neighborhood);
  }

  return {
    id: `${stage}:${xKey}:${yKey}`,
    stage,
    xKey,
    yKey,
    xValues,
    yValues,
    cells: cells.sort((left, right) => left.x - right.x || left.y - right.y),
  };
}

function buildClustersForHeatmap(heatmap: OptimizerParameterHeatmap, rankedCandidates: RankedCandidate[]): OptimizerClusterSummary[] {
  if (!heatmap.cells.length) return [];

  const cellMap = new Map<string, OptimizerParameterHeatmap["cells"][number]>();
  const xIndex = new Map<number, number>(heatmap.xValues.map((value, index) => [value, index]));
  const yIndex = new Map<number, number>(heatmap.yValues.map((value, index) => [value, index]));
  for (const cell of heatmap.cells) {
    cellMap.set(`${xIndex.get(cell.x)}|${yIndex.get(cell.y)}`, cell);
  }

  const maxScore = Math.max(...heatmap.cells.map((cell) => cell.smoothedScore));
  const adaptiveThreshold = maxScore >= 0 ? maxScore * 0.8 : maxScore * 1.2;
  const threshold = Math.max(quantile(heatmap.cells.map((cell) => cell.smoothedScore), 0.7), adaptiveThreshold);
  const visited = new Set<string>();
  const clusters: OptimizerClusterSummary[] = [];
  let clusterCounter = 0;

  for (const cell of heatmap.cells) {
    const startKey = `${xIndex.get(cell.x)}|${yIndex.get(cell.y)}`;
    if (visited.has(startKey) || cell.smoothedScore < threshold) continue;

    const stack = [startKey];
    const memberCells: typeof heatmap.cells = [];
    while (stack.length) {
      const key = stack.pop() as string;
      if (visited.has(key)) continue;
      visited.add(key);
      const current = cellMap.get(key);
      if (!current || current.smoothedScore < threshold) continue;
      memberCells.push(current);
      const [xi, yi] = key.split("|").map(Number);
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          if (dx === 0 && dy === 0) continue;
          const nextKey = `${xi + dx}|${yi + dy}`;
          if (!visited.has(nextKey) && cellMap.has(nextKey)) stack.push(nextKey);
        }
      }
    }

    if (memberCells.length < 2) continue;

    const xMin = Math.min(...memberCells.map((member) => member.x));
    const xMax = Math.max(...memberCells.map((member) => member.x));
    const yMin = Math.min(...memberCells.map((member) => member.y));
    const yMax = Math.max(...memberCells.map((member) => member.y));
    const members = rankedCandidates
      .filter((candidate) => {
        const x = paramValue(candidate.params, heatmap.xKey);
        const y = paramValue(candidate.params, heatmap.yKey);
        return x >= xMin && x <= xMax && y >= yMin && y <= yMax;
      })
      .sort((left, right) => right.result.metrics.score - left.result.metrics.score);

    if (!members.length) continue;

    clusterCounter += 1;
    clusters.push({
      clusterId: `C${heatmap.stage}-${String(clusterCounter).padStart(2, "0")}`,
      heatmapId: heatmap.id,
      stage: heatmap.stage,
      xKey: heatmap.xKey,
      yKey: heatmap.yKey,
      xRange: { min: xMin, max: xMax },
      yRange: { min: yMin, max: yMax },
      medianSharpe: median(members.map((member) => member.result.metrics.sharpe)),
      medianCagr: median(members.map((member) => member.result.metrics.cagr)),
      maxDrawdown: Math.max(...members.map((member) => member.result.metrics.maxDrawdown)),
      strategyCount: members.length,
      representativeStrategy: summarizeRankedCandidate(members[0], true, null),
      clusterStrategies: members.slice(0, 5).map((member) => summarizeRankedCandidate(member, true, null)),
    });
  }

  return clusters.sort((left, right) => {
    if (right.medianSharpe !== left.medianSharpe) return right.medianSharpe - left.medianSharpe;
    return right.strategyCount - left.strategyCount;
  });
}

function mergeInvalidCandidates(stage: 1 | 2 | 3, candidates: EvaluatedCandidate[], current: OptimizerStrategyResult[]): OptimizerStrategyResult[] {
  const seen = new Set(current.map((item) => JSON.stringify(item.params)));
  const additions = candidates
    .filter((candidate) => !seen.has(JSON.stringify(candidate.params)))
    .slice(0, Math.max(0, INVALID_STRATEGY_KEEP - current.length))
    .map((candidate, index) => ({
      rank: index + 1,
      stage,
      strategyId: `INVALID-S${stage}-${String(index + 1).padStart(3, "0")}`,
      params: candidate.params,
      valuation: candidate.result.valuation,
      metrics: candidate.result.metrics,
      assetMetrics: candidate.result.assetMetrics,
      equityCurve: candidate.result.equityCurve.slice(-24),
      trades: candidate.result.trades,
      validation: candidate.result.validation,
      debugAssets: candidate.result.debugAssets,
      monteCarlo: null,
    }));
  return [...current, ...additions].slice(0, INVALID_STRATEGY_KEEP);
}

export async function runOptimizerPipeline(config: OptimizerConfig, data: OptimizerLoadedData, options: PipelineOptions): Promise<OptimizerRunResponse> {
  const warnings = [...data.warnings];
  const preview = buildOptimizerPreview(config, data, config.assets[0] ?? data.assets[0]?.assetId ?? "cross_eurusd");
  if (preview.requiresConfirmation) {
    warnings.push("Invalid candle construction detected.");
  }

  const broadUniverse = buildBaseCandidateGrid(config);
  const sampledBroadUniverse = trimCandidateGrid(broadUniverse, BROAD_CANDIDATE_BUDGET);
  if (sampledBroadUniverse.length < broadUniverse.length) {
    warnings.push(`Stage 1 candidate grid trimmed from ${broadUniverse.length} to ${sampledBroadUniverse.length} combinations for interactive runtime.`);
  }

  let invalidStrategies: OptimizerStrategyResult[] = [];

  const stage1Batch = await evaluateCandidates(
    data,
    sampledBroadUniverse,
    { startDate: TRAIN_START, endDate: TRAIN_END, enforceFilters: true },
    { pipeline: options, stage: "stage1", label: "Stage 1 - Parameter discovery", stageIndex: 2 },
  );
  invalidStrategies = mergeInvalidCandidates(1, stage1Batch.invalid, invalidStrategies);
  const stage1RankedAll = rankCandidates(1, stage1Batch.valid);
  const stage1Top = stage1RankedAll.slice(0, BROAD_STAGE_KEEP);

  const refinedUniverse = trimCandidateGrid(
    dedupeParams(stage1Top.flatMap((candidate) => buildRefinedCandidates(candidate.params, config))),
    REFINE_CANDIDATE_BUDGET,
  );
  if (refinedUniverse.length === 0) {
    warnings.push("Stage 2 refinement received no valid candidates from Stage 1.");
  }

  const stage2Batch = await evaluateCandidates(
    data,
    refinedUniverse,
    { startDate: TRAIN_START, endDate: TRAIN_END, enforceFilters: true },
    { pipeline: options, stage: "stage2", label: "Stage 2 - Parameter refinement", stageIndex: 3 },
  );
  invalidStrategies = mergeInvalidCandidates(2, stage2Batch.invalid, invalidStrategies);
  const stage2RankedAll = rankCandidates(2, stage2Batch.valid);
  const stage2Top = stage2RankedAll.slice(0, REFINE_STAGE_KEEP);

  const stage3Batch = await evaluateCandidates(
    data,
    stage2Top.map((candidate) => candidate.params),
    { startDate: TEST_START, endDate: TEST_END, enforceFilters: false },
    { pipeline: options, stage: "stage3", label: "Stage 3 - Out of sample test", stageIndex: 4 },
  );
  invalidStrategies = mergeInvalidCandidates(3, stage3Batch.invalid, invalidStrategies);
  const stage3Ranked = rankCandidates(3, stage3Batch.valid).slice(0, OOS_STAGE_KEEP);

  const monteCarloStartedAt = Date.now();
  const monteCarloTotal = Math.max(1, stage3Ranked.length * Math.max(1000, config.monteCarloSimulations));
  let monteCarloCompleted = 0;
  await emitProgress(options, "monte_carlo", "Monte Carlo robustness", 5, 0, monteCarloTotal, monteCarloStartedAt, "Preparing Monte Carlo simulations.");
  const topStrategies = stage3Ranked.map((candidate, index) => {
    const tradeReturns = candidate.result.trades.map((trade) => trade.returnPct);
    const monteCarlo = runMonteCarlo(tradeReturns, Math.max(1000, config.monteCarloSimulations), {
      onProgress: (completed, total) => {
        monteCarloCompleted = (index * total) + completed;
        void emitProgress(
          options,
          "monte_carlo",
          "Monte Carlo robustness",
          5,
          monteCarloCompleted,
          monteCarloTotal,
          monteCarloStartedAt,
          `Monte Carlo ${index + 1}/${stage3Ranked.length} - ${completed.toLocaleString()} / ${total.toLocaleString()} simulations.`,
        );
      },
    });
    return summarizeRankedCandidate(candidate, true, monteCarlo);
  });

  if (topStrategies.length === 0) {
    warnings.push("No valid out-of-sample strategies were produced. Check data coverage or widen the parameter ranges.");
  } else if (topStrategies.every((strategy) => strategy.metrics.trades === 0)) {
    warnings.push("Optimizer completed, but the current data coverage still does not produce valid trades in the requested train/test windows.");
  }

  const heatmaps = HEATMAP_PAIRS.map((pair) =>
    buildHeatmap(pair.stage, pair.xKey, pair.yKey, pair.stage === 1 ? stage1RankedAll : stage2RankedAll),
  );
  const clusters = heatmaps.flatMap((heatmap) =>
    buildClustersForHeatmap(heatmap, heatmap.stage === 1 ? stage1RankedAll : stage2RankedAll),
  );

  await emitProgress(options, "complete", "Complete", 5, 1, 1, Date.now(), "Optimization finished.");

  return {
    status: "ok",
    runId: options.runId,
    generatedAt: new Date().toISOString(),
    config,
    coverage: data.coverage,
    integrity: data.integrity,
    preview,
    warnings,
    stageSummaries: [
      buildStageSummary(1, "Stage 1 - Broad Search (2012-01-01 to 2019-12-31)", stage1Top, [1, 2, 3, 4, 5]),
      buildStageSummary(2, "Stage 2 - Refinement (2012-01-01 to 2019-12-31)", stage2Top, [1, 2, 3, 4, 5]),
      buildStageSummary(3, "Stage 3 - Out of Sample (2020-01-01 to 2025-12-31)", stage3Ranked, [1, 2, 3, 4, 5]),
    ],
    topStrategies,
    invalidStrategies,
    stability: {
      availablePairs: heatmaps.map((heatmap) => ({
        id: heatmap.id,
        stage: heatmap.stage,
        xKey: heatmap.xKey,
        yKey: heatmap.yKey,
      })),
      heatmaps,
      clusters,
    },
  };
}
