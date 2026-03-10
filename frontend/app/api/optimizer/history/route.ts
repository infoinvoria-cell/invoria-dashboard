import { NextResponse } from "next/server";

import { listOptimizerRuns, readOptimizerRun, saveOptimizerRun } from "@/lib/server/optimizer/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET() {
  const items = await listOptimizerRuns();
  return NextResponse.json(
    { items },
    {
      headers: { "cache-control": "no-store, max-age=0" },
    },
  );
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const runId = String(body?.runId || "").trim();
  if (!runId) {
    return NextResponse.json({ error: "runId is required" }, { status: 400 });
  }

  const existing = await readOptimizerRun(runId);
  if (!existing?.result) {
    return NextResponse.json({ error: "Run not found or not completed yet." }, { status: 404 });
  }

  const saved = await saveOptimizerRun(runId);
  return NextResponse.json(saved, {
    headers: { "cache-control": "no-store, max-age=0" },
  });
}
