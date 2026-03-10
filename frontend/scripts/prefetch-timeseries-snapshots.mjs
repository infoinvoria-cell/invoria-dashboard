import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_SOURCES = ["tradingview", "dukascopy", "yahoo"];
const DEFAULT_TIMEFRAME = "D";
const DEFAULT_CONCURRENCY = 4;

function parseArgs(argv) {
  const args = {};
  for (const entry of argv) {
    if (!entry.startsWith("--")) continue;
    const [rawKey, rawValue = "true"] = entry.slice(2).split("=");
    args[rawKey] = rawValue;
  }
  return args;
}

function splitCsv(value, fallback = []) {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  return raw.split(",").map((item) => item.trim()).filter(Boolean);
}

function normalizeKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "");
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = String(args["base-url"] || "http://localhost:3000").replace(/\/+$/g, "");
  const timeframe = String(args.tf || DEFAULT_TIMEFRAME).toUpperCase();
  const sources = splitCsv(args.sources, DEFAULT_SOURCES);
  const concurrency = Math.max(1, Number(args.concurrency || DEFAULT_CONCURRENCY) || DEFAULT_CONCURRENCY);
  const explicitAssets = splitCsv(args.assets);

  const assets = explicitAssets.length
    ? explicitAssets
    : (await fetchJson(`${baseUrl}/api/assets`)).items.map((item) => String(item.id || "").trim()).filter(Boolean);

  const jobs = sources.flatMap((source) => assets.map((assetId) => ({ source, assetId })));
  const outputRoot = path.join(process.cwd(), "data", "timeseries-snapshots");
  const manifest = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    timeframe,
    totalJobs: jobs.length,
    completed: 0,
    failed: [],
  };

  let cursor = 0;
  async function worker() {
    while (cursor < jobs.length) {
      const job = jobs[cursor];
      cursor += 1;
      const { source, assetId } = job;
      const safeSource = normalizeKey(source);
      const safeAssetId = normalizeKey(assetId);
      const targetDir = path.join(outputRoot, safeSource);
      const targetFile = path.join(targetDir, `${safeAssetId}.json`);
      const url = `${baseUrl}/api/asset/${encodeURIComponent(assetId)}/timeseries?tf=${encodeURIComponent(timeframe)}&source=${encodeURIComponent(source)}`;

      try {
        const payload = await fetchJson(url);
        if (!Array.isArray(payload?.ohlcv) || payload.ohlcv.length === 0) {
          throw new Error("empty ohlcv");
        }
        await mkdir(targetDir, { recursive: true });
        await writeFile(targetFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
        manifest.completed += 1;
        if (manifest.completed % 25 === 0 || manifest.completed === jobs.length) {
          console.log(`[snapshots] ${manifest.completed}/${jobs.length}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        manifest.failed.push({ source, assetId, error: message });
        console.error(`[snapshots] failed ${source}/${assetId}: ${message}`);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  await mkdir(outputRoot, { recursive: true });
  await writeFile(path.join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  console.log(`[snapshots] done ${manifest.completed}/${jobs.length}`);
  if (manifest.failed.length) {
    console.log(`[snapshots] failed ${manifest.failed.length}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
