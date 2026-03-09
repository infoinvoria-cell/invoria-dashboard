import { NextResponse } from "next/server";

import { buildTrackRecordModel, type TrackRecordTradeInput } from "@/components/track-record/metrics";
import {
  appendTrackRecordTrades,
  getHistoricalTrackRecordEndDate,
  loadTrackRecordTrades,
} from "@/lib/trackRecordStore";

export const dynamic = "force-dynamic";

export async function GET() {
  const trades = await loadTrackRecordTrades();
  const model = buildTrackRecordModel(trades);
  const historicalEndDate = await getHistoricalTrackRecordEndDate();

  return NextResponse.json({
    historicalEndDate,
    trades,
    model,
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const payload = Array.isArray(body?.trades) ? body.trades : Array.isArray(body) ? body : [body];
    const trades = payload as TrackRecordTradeInput[];

    if (trades.length === 0) {
      return NextResponse.json({ error: "No trades supplied." }, { status: 400 });
    }

    const mergedTrades = await appendTrackRecordTrades(trades);
    const model = buildTrackRecordModel(mergedTrades);
    const historicalEndDate = await getHistoricalTrackRecordEndDate();

    return NextResponse.json({
      ok: true,
      historicalEndDate,
      trades: mergedTrades,
      model,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to append track record trades." },
      { status: 400 },
    );
  }
}
