import { NextResponse } from "next/server";
import { buildTrackRecordModel, type TrackRecordTradeInput } from "@/components/track-record/metrics";

export const dynamic = "force-dynamic";

export async function GET() {

  const trades: TrackRecordTradeInput[] = [];

  const model = buildTrackRecordModel(trades);

  return NextResponse.json({
    historicalEndDate: null,
    trades,
    model,
  });
}