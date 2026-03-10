import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const FX_ASSETS = [
  "cross_eurusd",
  "cross_gbpusd",
  "cross_usdjpy",
  "cross_usdchf",
  "cross_audusd",
  "cross_usdcad",
  "cross_nzdusd",
];

const REFERENCES = ["DXY", "GC1!", "ZB1!"];

function parseArgs(argv) {
  const args = {};
  for (const entry of argv) {
    if (!entry.startsWith("--")) continue;
    const [rawKey, rawValue = "true"] = entry.slice(2).split("=");
    args[rawKey] = rawValue;
  }
  return args;
}

function normalizeKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9!_-]/g, "");
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

async function writeSnapshot(root, scope, provider, key, payload) {
  const dir = path.join(root, scope, normalizeKey(provider));
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${normalizeKey(key)}.json`), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = String(args["base-url"] || "http://localhost:3000").replace(/\/+$/g, "");
  const source = String(args.source || "dukascopy");
  const outputRoot = path.join(process.cwd(), "data", "optimizer-snapshots");

  const manifest = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    source,
    assets: [],
    references: [],
    failures: [],
  };

  for (const assetId of FX_ASSETS) {
    const url = `${baseUrl}/api/asset/${encodeURIComponent(assetId)}/timeseries?tf=1H&source=${encodeURIComponent(source)}&continuous_mode=regular`;
    try {
      const payload = await fetchJson(url);
      if (!payload?.ohlcv?.length) throw new Error("empty ohlcv");
      await writeSnapshot(outputRoot, "assets", source, assetId, payload);
      manifest.assets.push({ assetId, bars: payload.ohlcv.length, start: payload.ohlcv[0]?.t ?? null, end: payload.ohlcv[payload.ohlcv.length - 1]?.t ?? null });
      console.log(`[optimizer-snapshots] asset ${assetId} ok (${payload.ohlcv.length} bars)`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      manifest.failures.push({ scope: "asset", key: assetId, error: message });
      console.error(`[optimizer-snapshots] asset ${assetId} failed: ${message}`);
    }
  }

  for (const symbol of REFERENCES) {
    const url = `${baseUrl}/api/reference/timeseries?symbol=${encodeURIComponent(symbol)}&tf=D&source=${encodeURIComponent(source)}`;
    try {
      const payload = await fetchJson(url);
      if (!payload?.ohlcv?.length) throw new Error("empty ohlcv");
      await writeSnapshot(outputRoot, "references", source, symbol, payload);
      manifest.references.push({ symbol, bars: payload.ohlcv.length, start: payload.ohlcv[0]?.t ?? null, end: payload.ohlcv[payload.ohlcv.length - 1]?.t ?? null });
      console.log(`[optimizer-snapshots] reference ${symbol} ok (${payload.ohlcv.length} bars)`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      manifest.failures.push({ scope: "reference", key: symbol, error: message });
      console.error(`[optimizer-snapshots] reference ${symbol} failed: ${message}`);
    }
  }

  await mkdir(outputRoot, { recursive: true });
  await writeFile(path.join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
