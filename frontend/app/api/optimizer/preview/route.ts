import { NextResponse } from "next/server";

import type { OptimizerConfig, OptimizerPreviewResponse } from "@/lib/optimizer/types";
import { DEFAULT_OPTIMIZER_CONFIG } from "@/lib/server/optimizer/config";
import { loadOptimizerData } from "@/lib/server/optimizer/data";
import { buildOptimizerPreview } from "@/lib/server/optimizer/strategy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function mergeConfig(input: Partial<OptimizerConfig> | null | undefined): OptimizerConfig {
  const merged = !input ? DEFAULT_OPTIMIZER_CONFIG : {
    ...DEFAULT_OPTIMIZER_CONFIG,
    ...input,
    valuationPeriods: input.valuationPeriods?.length ? input.valuationPeriods : DEFAULT_OPTIMIZER_CONFIG.valuationPeriods,
    valuationModes: input.valuationModes?.length ? input.valuationModes : DEFAULT_OPTIMIZER_CONFIG.valuationModes,
    valuationMultiPeriodLogics: input.valuationMultiPeriodLogics?.length ? input.valuationMultiPeriodLogics : DEFAULT_OPTIMIZER_CONFIG.valuationMultiPeriodLogics,
    valuationWeightProfiles: input.valuationWeightProfiles?.length ? input.valuationWeightProfiles : DEFAULT_OPTIMIZER_CONFIG.valuationWeightProfiles,
    broadRanges: {
      ...DEFAULT_OPTIMIZER_CONFIG.broadRanges,
      ...input.broadRanges,
    },
    toggles: {
      ...DEFAULT_OPTIMIZER_CONFIG.toggles,
      ...input.toggles,
    },
    assets: input.assets?.length ? input.assets : DEFAULT_OPTIMIZER_CONFIG.assets,
  };

  return {
    ...merged,
    broadRanges: {
      ...merged.broadRanges,
      zoneLookback: { min: 3, max: 10, step: 1 },
      valuationThreshold: { min: 75, max: 75, step: 1 },
      holdDays: { min: 5, max: 20, step: 1 },
    },
  };
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const config = mergeConfig(body?.config);
  const selectedAssetId = config.assets.includes(body?.selectedAssetId)
    ? body.selectedAssetId
    : config.assets[0] ?? DEFAULT_OPTIMIZER_CONFIG.assets[0];
  const origin = new URL(request.url).origin;
  const data = await loadOptimizerData(origin, config);
  const preview: OptimizerPreviewResponse = buildOptimizerPreview(config, data, selectedAssetId);
  return NextResponse.json(preview, {
    headers: { "cache-control": "no-store, max-age=0" },
  });
}
