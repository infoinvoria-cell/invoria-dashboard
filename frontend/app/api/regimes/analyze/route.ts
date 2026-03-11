import { NextResponse } from "next/server";

import type { RegimeInputRow, RegimeSourceType } from "@/lib/regimes/types";
import { analyzeRegimeDataset, loadDefaultRegimeRows } from "@/lib/server/regimes/regimeEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

type AnalyzeRequest = {
  rows?: RegimeInputRow[];
  sourceType?: RegimeSourceType;
  sourceName?: string;
};

export async function GET() {
  const rows = await loadDefaultRegimeRows();
  const analysis = analyzeRegimeDataset(rows, "demo", "Default Demo Track Record");
  return NextResponse.json(analysis, {
    headers: { "cache-control": "no-store, max-age=0" },
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as AnalyzeRequest;
  const rows = Array.isArray(body.rows) && body.rows.length ? body.rows : await loadDefaultRegimeRows();
  const analysis = analyzeRegimeDataset(
    rows,
    body.sourceType ?? "demo",
    String(body.sourceName || "Custom Regime Dataset"),
  );
  return NextResponse.json(analysis, {
    headers: { "cache-control": "no-store, max-age=0" },
  });
}
