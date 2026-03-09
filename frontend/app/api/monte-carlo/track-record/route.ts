import { NextResponse } from "next/server";

import { loadTrackRecordTrades } from "@/lib/trackRecordStore";

export const dynamic = "force-dynamic";

export async function GET() {
  const trades = await loadTrackRecordTrades();
  let equity = 100_000;

  const observations = trades.map((trade, index) => {
    const strategyReturn = Number(trade.return_pct) / 100;
    const open = equity;
    equity *= 1 + strategyReturn;
    const close = equity;
    const baseHigh = Math.max(open, close);
    const baseLow = Math.min(open, close);
    const pad = Math.max(baseHigh * 0.0025, Math.abs(close - open) * 0.25);

    return {
      date: trade.date,
      open,
      high: baseHigh + pad,
      low: Math.max(0.01, baseLow - pad),
      close,
      volume: 0,
      returns: strategyReturn,
      trade_return: strategyReturn,
      strategy_return: strategyReturn,
      strategyReturn,
      signal: trade.trade_direction === "Short" ? -1 : 1,
    };
  });

  return NextResponse.json({
    id: "track-record-default",
    name: "Track Record Equity Curve",
    description: "Persoenliche Track-Record-Historie aus der lokalen Equity-Kurve.",
    kind: "track_record",
    sourceGroup: "Track Record",
    observations,
  });
}
