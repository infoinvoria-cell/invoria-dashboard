import { NextResponse } from "next/server";

import { deleteOptimizerRun, readOptimizerRun } from "@/lib/server/optimizer/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

type RouteContext = {
  params: {
    runId: string;
  };
};

export async function GET(_request: Request, { params }: RouteContext) {
  const runId = String(params.runId || "").trim();
  const run = await readOptimizerRun(runId);
  if (!run) {
    return NextResponse.json({ error: "Run not found." }, { status: 404 });
  }
  return NextResponse.json(run, {
    headers: { "cache-control": "no-store, max-age=0" },
  });
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const runId = String(params.runId || "").trim();
  const removed = await deleteOptimizerRun(runId);
  if (!removed) {
    return NextResponse.json({ error: "Run not found." }, { status: 404 });
  }
  return NextResponse.json({ ok: true }, {
    headers: { "cache-control": "no-store, max-age=0" },
  });
}
