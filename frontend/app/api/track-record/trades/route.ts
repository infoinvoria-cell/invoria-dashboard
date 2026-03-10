import { NextResponse } from "next/server";
import { buildTrackRecordModel, type TrackRecordTradeInput } from "@/components/track-record/metrics";
import { loadTrackRecordTrades } from "@/lib/trackRecordStore";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const trades: TrackRecordTradeInput[] = await loadTrackRecordTrades();
    const model = buildTrackRecordModel(trades);

    return NextResponse.json({
      historicalEndDate: model.historicalEndDate,
      trades,
      model,
    });
  } catch (error) {
    console.error("TRACK RECORD API ERROR:", error);
    return NextResponse.json(
      {
        error: "Failed to load track record trades.",
        historicalEndDate: null,
        trades: [],
        model: buildTrackRecordModel([]),
      },
      { status: 500 }
    );
  }
}
