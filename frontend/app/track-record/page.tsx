import { buildTrackRecordModel } from "@/components/track-record/metrics";
import TrackRecordPage from "@/components/pages/TrackRecordPage";
import { loadTrackRecordTrades } from "@/lib/trackRecordStore";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export default async function Page() {
  const trades = await loadTrackRecordTrades();
  const model = buildTrackRecordModel(trades);

  return <TrackRecordPage initialModel={model} />;
}
