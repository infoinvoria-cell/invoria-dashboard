"use client";

import { useEffect } from "react";

import TrackRecordPage from "@/components/pages/TrackRecordPage";
import { ensureTrackRecord } from "@/lib/dashboardPreload";
import { useDashboardStore } from "@/lib/dashboardStore";

export default function TrackRecordRoute() {
  const payload = useDashboardStore((state) => state.sharedData.strategyData.trackRecord);

  useEffect(() => {
    if (payload) return;
    void ensureTrackRecord();
  }, [payload]);

  if (!payload) {
    return <div className="grid min-h-[320px] place-items-center text-sm text-slate-400">Loading track record...</div>;
  }

  return <TrackRecordPage initialModel={payload.model} />;
}
