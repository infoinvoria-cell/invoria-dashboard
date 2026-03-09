import TerminalShell from "@/components/TerminalShell";
import { buildTrackRecordModel } from "@/components/track-record/metrics";
import TrackRecordPage from "@/components/pages/TrackRecordPage";
import { loadTrackRecordTrades } from "@/lib/trackRecordStore";

export const dynamic = "force-dynamic";

export default async function Page() {
  const trades = await loadTrackRecordTrades();
  const model = buildTrackRecordModel(trades);

  return (
    <TerminalShell>
      <TrackRecordPage initialModel={model} />
    </TerminalShell>
  );
}
