import { promises as fs } from "node:fs";
import path from "node:path";

import type { TimeseriesResponse } from "@/types";

function normalizeSegment(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "");
}

function snapshotRoots(): string[] {
  const cwd = process.cwd();
  return Array.from(new Set([
    path.join(cwd, "data", "timeseries-snapshots"),
    path.join(cwd, "frontend", "data", "timeseries-snapshots"),
  ]));
}

export async function readTimeseriesSnapshot(source: string, assetId: string): Promise<TimeseriesResponse | null> {
  const safeSource = normalizeSegment(source);
  const safeAssetId = normalizeSegment(assetId);
  if (!safeSource || !safeAssetId) return null;

  for (const root of snapshotRoots()) {
    const filePath = path.join(root, safeSource, `${safeAssetId}.json`);
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as TimeseriesResponse | null;
      if (!parsed || !Array.isArray(parsed.ohlcv) || parsed.ohlcv.length === 0) {
        continue;
      }
      return parsed;
    } catch {
      // keep searching other roots
    }
  }

  return null;
}
