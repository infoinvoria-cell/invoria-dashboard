import { promises as fs } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export type ForexCacheBar = {
  t: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
};

type ForexCachePayload = {
  symbol: string;
  timeframe: "H1";
  source: "dukascopy";
  updatedAt: string;
  bars: ForexCacheBar[];
};

function projectRoots(): string[] {
  const cwd = process.cwd();
  return Array.from(new Set([
    cwd,
    path.join(cwd, ".."),
    path.join(cwd, "frontend"),
  ]));
}

function cacheRoots(): string[] {
  const cwd = process.cwd();
  return Array.from(new Set([
    path.join(cwd, "data", "forex"),
    path.join(cwd, "frontend", "data", "forex"),
  ]));
}

function cacheFileName(symbol: string, extension: "json" | "parquet"): string {
  return `${String(symbol || "").trim().toUpperCase()}_H1.${extension}`;
}

async function existingFile(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function looksComplete(payload: ForexCachePayload | null): boolean {
  if (!payload?.bars?.length) return false;
  const start = payload.bars[0]?.t?.slice(0, 10) ?? "";
  const end = payload.bars[payload.bars.length - 1]?.t?.slice(0, 10) ?? "";
  const staleCutoff = new Date();
  staleCutoff.setUTCDate(staleCutoff.getUTCDate() - 5);
  return start <= "2012-01-01" && end >= staleCutoff.toISOString().slice(0, 10);
}

export async function readForexCache(symbol: string): Promise<ForexCachePayload | null> {
  for (const root of cacheRoots()) {
    const filePath = path.join(root, cacheFileName(symbol, "json"));
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as ForexCachePayload | null;
      if (parsed?.bars?.length) return parsed;
    } catch {
      // keep searching
    }
  }
  return null;
}

async function findPythonCommand(): Promise<{ command: string; args: string[] } | null> {
  const candidates = [
    { command: "python", args: [] },
    { command: "py", args: ["-3"] },
    { command: "python3", args: [] },
  ];
  for (const candidate of candidates) {
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(candidate.command, [...candidate.args, "--version"], { stdio: "ignore" });
        child.once("error", reject);
        child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(String(code)))));
      });
      return candidate;
    } catch {
      // try next candidate
    }
  }
  return null;
}

export async function ensureForexCache(symbols: string[]): Promise<void> {
  const normalized = Array.from(new Set(symbols.map((item) => String(item || "").trim().toUpperCase()).filter(Boolean)));
  if (!normalized.length) return;

  const missing: string[] = [];
  for (const symbol of normalized) {
    const payload = await readForexCache(symbol);
    if (!looksComplete(payload)) {
      missing.push(symbol);
    }
  }

  if (!missing.length) return;
  if (process.env.VERCEL) {
    throw new Error(`Local Dukascopy cache missing for ${missing.join(", ")} in Vercel runtime.`);
  }

  const python = await findPythonCommand();
  if (!python) {
    throw new Error("Python interpreter not found for Dukascopy cache downloader.");
  }

  let scriptPath: string | null = null;
  for (const root of projectRoots()) {
    const candidate = path.join(root, "frontend", "scripts", "fetch_optimizer_forex_cache.py");
    if (await existingFile(candidate)) {
      scriptPath = candidate;
      break;
    }
  }
  if (!scriptPath) {
    throw new Error("Optimizer forex cache downloader script not found.");
  }

  const cwd = path.dirname(path.dirname(scriptPath));
  const args = [
    ...python.args,
    scriptPath,
    "--symbols",
    missing.join(","),
    "--start",
    "2012-01-01",
    "--chunk-months",
    "12",
    "--workers",
    String(Math.min(3, missing.length)),
  ];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(python.command, args, { cwd, stdio: "pipe" });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr.trim() || `Downloader exited with code ${code}`));
      }
    });
  });
}
