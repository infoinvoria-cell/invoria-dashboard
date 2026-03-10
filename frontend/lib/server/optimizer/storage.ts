import { promises as fs } from "node:fs";
import path from "node:path";

import type {
  OptimizerConfig,
  OptimizerProgressSnapshot,
  OptimizerRunResponse,
  OptimizerRunSummary,
  OptimizerStoredRun,
} from "@/lib/optimizer/types";

type RunMode = "temp" | "saved";

type RunStatus = OptimizerRunSummary["status"];

function runRootCandidates(): string[] {
  const cwd = process.cwd();
  return Array.from(new Set([
    path.join(cwd, "data", "optimizer-runs"),
    path.join(cwd, "frontend", "data", "optimizer-runs"),
    path.join(process.env.TMPDIR || process.env.TEMP || "/tmp", "invoria-optimizer-runs"),
  ]));
}

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

async function resolveWritableRoot(): Promise<string> {
  for (const candidate of runRootCandidates()) {
    try {
      await ensureDir(candidate);
      return candidate;
    } catch {
      // try next
    }
  }
  throw new Error("Unable to initialize optimizer run storage.");
}

async function rootForMode(mode: RunMode): Promise<string> {
  const root = await resolveWritableRoot();
  const target = path.join(root, mode);
  await ensureDir(target);
  return target;
}

function runFile(runId: string): string {
  return `${String(runId || "").trim()}.json`;
}

function defaultSummary(runId: string, config: OptimizerConfig): OptimizerRunSummary {
  const now = new Date().toISOString();
  return {
    runId,
    createdAt: now,
    updatedAt: now,
    mode: "temp",
    assets: config.assets,
    strategyCount: 0,
    bestSharpe: 0,
    bestCagr: 0,
    status: "running",
    warnings: [],
    progress: null,
  };
}

async function writeEnvelope(mode: RunMode, envelope: OptimizerStoredRun): Promise<void> {
  const dir = await rootForMode(mode);
  const filePath = path.join(dir, runFile(envelope.summary.runId));
  await fs.writeFile(filePath, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
}

async function readEnvelopeFrom(mode: RunMode, runId: string): Promise<OptimizerStoredRun | null> {
  const dir = await rootForMode(mode);
  const filePath = path.join(dir, runFile(runId));
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as OptimizerStoredRun;
  } catch {
    return null;
  }
}

export async function createOptimizerRun(runId: string, config: OptimizerConfig): Promise<OptimizerStoredRun> {
  const envelope: OptimizerStoredRun = {
    summary: defaultSummary(runId, config),
    config,
    result: null,
    error: null,
  };
  await writeEnvelope("temp", envelope);
  return envelope;
}

export async function updateOptimizerRunProgress(runId: string, progress: OptimizerProgressSnapshot): Promise<void> {
  const current = await readOptimizerRun(runId);
  if (!current) return;
  const next: OptimizerStoredRun = {
    ...current,
    summary: {
      ...current.summary,
      updatedAt: progress.updatedAt,
      status: progress.stage === "complete" ? "completed" : "running",
      progress,
    },
  };
  await writeEnvelope(current.summary.mode, next);
}

export async function completeOptimizerRun(runId: string, result: OptimizerRunResponse): Promise<void> {
  const current = await readOptimizerRun(runId);
  const summary: OptimizerRunSummary = {
    ...(current?.summary ?? defaultSummary(runId, result.config)),
    updatedAt: result.generatedAt,
    status: "completed",
    strategyCount: result.topStrategies.length,
    bestSharpe: result.topStrategies[0]?.metrics.sharpe ?? 0,
    bestCagr: result.topStrategies[0]?.metrics.cagr ?? 0,
    warnings: result.warnings,
    progress: current?.summary.progress
      ? {
          ...current.summary.progress,
          stage: "complete",
          label: "Complete",
          stageIndex: 5,
          stageCount: 5,
          percent: 100,
          completed: 1,
          total: 1,
          etaSeconds: 0,
          message: "Optimization finished.",
          updatedAt: result.generatedAt,
        }
      : null,
  };

  await writeEnvelope(summary.mode, {
    summary,
    config: result.config,
    result,
    error: null,
  });
}

export async function failOptimizerRun(runId: string, config: OptimizerConfig, message: string): Promise<void> {
  const current = await readOptimizerRun(runId);
  const now = new Date().toISOString();
  const summary: OptimizerRunSummary = {
    ...(current?.summary ?? defaultSummary(runId, config)),
    updatedAt: now,
    status: "error",
    warnings: current?.summary.warnings ?? [],
    progress: current?.summary.progress
      ? { ...current.summary.progress, updatedAt: now, message, etaSeconds: null }
      : null,
  };
  await writeEnvelope(summary.mode, {
    summary,
    config,
    result: current?.result ?? null,
    error: message,
  });
}

export async function readOptimizerRun(runId: string): Promise<OptimizerStoredRun | null> {
  return (await readEnvelopeFrom("saved", runId)) ?? readEnvelopeFrom("temp", runId);
}

export async function listOptimizerRuns(): Promise<OptimizerRunSummary[]> {
  const modes: RunMode[] = ["saved", "temp"];
  const all: OptimizerRunSummary[] = [];
  for (const mode of modes) {
    const dir = await rootForMode(mode);
    const entries = await fs.readdir(dir).catch(() => []);
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      try {
        const raw = await fs.readFile(path.join(dir, entry), "utf8");
        const parsed = JSON.parse(raw) as OptimizerStoredRun;
        all.push({ ...parsed.summary, mode });
      } catch {
        // ignore unreadable files
      }
    }
  }
  return all.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function saveOptimizerRun(runId: string): Promise<OptimizerStoredRun | null> {
  const current = await readOptimizerRun(runId);
  if (!current) return null;
  const next: OptimizerStoredRun = {
    ...current,
    summary: {
      ...current.summary,
      mode: "saved",
      updatedAt: new Date().toISOString(),
    },
  };
  await writeEnvelope("saved", next);
  if (current.summary.mode === "temp") {
    await deleteOptimizerRun(runId, "temp");
  }
  return next;
}

export async function deleteOptimizerRun(runId: string, preferredMode?: RunMode): Promise<boolean> {
  const modes = preferredMode ? [preferredMode] : (["saved", "temp"] as RunMode[]);
  let removed = false;
  for (const mode of modes) {
    const dir = await rootForMode(mode);
    const filePath = path.join(dir, runFile(runId));
    try {
      await fs.unlink(filePath);
      removed = true;
    } catch {
      // ignore missing files
    }
  }
  return removed;
}
