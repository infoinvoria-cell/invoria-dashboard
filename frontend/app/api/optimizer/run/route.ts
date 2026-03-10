import { randomUUID } from "node:crypto";

import type { OptimizerConfig, OptimizerProgressSnapshot, OptimizerRunStreamEvent } from "@/lib/optimizer/types";
import { DEFAULT_OPTIMIZER_CONFIG } from "@/lib/server/optimizer/config";
import { loadOptimizerData } from "@/lib/server/optimizer/data";
import { runOptimizerPipeline } from "@/lib/server/optimizer/engine";
import {
  completeOptimizerRun,
  createOptimizerRun,
  failOptimizerRun,
  updateOptimizerRunProgress,
} from "@/lib/server/optimizer/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 60;

function mergeConfig(input: Partial<OptimizerConfig> | null | undefined): OptimizerConfig {
  if (!input) return DEFAULT_OPTIMIZER_CONFIG;
  return {
    ...DEFAULT_OPTIMIZER_CONFIG,
    ...input,
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
}

function encodeLine(value: OptimizerRunStreamEvent): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value)}\n`);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const config = mergeConfig(body?.config);
  const runId = randomUUID();
  const origin = new URL(request.url).origin;
  await createOptimizerRun(runId, config);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      void (async () => {
        const pushProgress = async (progress: OptimizerProgressSnapshot) => {
          await updateOptimizerRunProgress(runId, progress);
          controller.enqueue(encodeLine({ type: "progress", payload: progress }));
        };

        try {
          await pushProgress({
            runId,
            stage: "data",
            label: "Data validation",
            stageIndex: 1,
            stageCount: 5,
            percent: 0,
            completed: 0,
            total: Math.max(1, config.assets.length + 3),
            etaSeconds: null,
            message: "Initializing optimizer run.",
            updatedAt: new Date().toISOString(),
          });

          const data = await loadOptimizerData(origin, config, {
            onProgress: async (completed, total, message) => {
              await pushProgress({
                runId,
                stage: "data",
                label: "Data validation",
                stageIndex: 1,
                stageCount: 5,
                percent: total > 0 ? (completed / total) * 100 : 0,
                completed,
                total,
                etaSeconds: null,
                message,
                updatedAt: new Date().toISOString(),
              });
            },
          });

          const result = await runOptimizerPipeline(config, data, {
            runId,
            onProgress: pushProgress,
          });
          await completeOptimizerRun(runId, result);
          controller.enqueue(encodeLine({ type: "result", payload: result }));
          controller.close();
        } catch (error) {
          const message = error instanceof Error ? error.message : "Optimizer pipeline failed";
          await failOptimizerRun(runId, config, message);
          controller.enqueue(encodeLine({ type: "error", payload: { runId, message } }));
          controller.close();
        }
      })();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "cache-control": "no-store, max-age=0",
      "content-type": "application/x-ndjson; charset=utf-8",
    },
  });
}
