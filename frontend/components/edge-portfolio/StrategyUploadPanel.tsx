"use client";

import type { TrackRecordTheme } from "@/components/track-record/metrics";
import { getTrackRecordThemePalette } from "@/components/track-record/theme";

type Props = {
  theme: TrackRecordTheme;
  uploadName: string;
  onUploadNameChange: (value: string) => void;
  onPickFile: () => void;
  onRefresh: () => void;
  isUploading: boolean;
  totalStrategies: number;
  selectedCount: number;
};

export default function StrategyUploadPanel({
  theme,
  uploadName,
  onUploadNameChange,
  onPickFile,
  onRefresh,
  isUploading,
  totalStrategies,
  selectedCount,
}: Props) {
  const palette = getTrackRecordThemePalette(theme);

  return (
    <section
      className="relative overflow-hidden rounded-[24px] border p-3.5 backdrop-blur-[20px] min-[769px]:p-4"
      style={{ background: palette.panelBackgroundStrong, borderColor: palette.panelBorder, boxShadow: palette.panelShadow }}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-[12px] font-semibold uppercase tracking-[0.2em]" style={{ color: palette.heading }}>
            Strategy Upload
          </div>
          <div className="mt-1 text-[11px]" style={{ color: palette.muted }}>
            TradingView CSV import into local project storage
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            className="h-8 rounded-full border px-3 text-[10px] font-semibold uppercase tracking-[0.14em]"
            style={{ borderColor: palette.panelBorder, background: "rgba(7,10,15,0.62)", color: palette.muted }}
          >
            Refresh
          </button>
          <div className="text-right text-[10px]" style={{ color: palette.muted }}>
            <div>{totalStrategies} stored</div>
            <div>{selectedCount} selected</div>
          </div>
        </div>
      </div>

      <div className="grid gap-3 min-[769px]:grid-cols-[minmax(0,1fr)_auto]">
        <input
          value={uploadName}
          onChange={(event) => onUploadNameChange(event.target.value)}
          placeholder="Strategy display name"
          className="h-10 rounded-[14px] border px-3 text-sm outline-none"
          style={{ borderColor: palette.panelBorder, background: "rgba(7,10,15,0.72)", color: palette.text }}
        />
        <button
          type="button"
          onClick={onPickFile}
          disabled={isUploading}
          className="h-10 rounded-[14px] border px-4 text-[11px] font-semibold uppercase tracking-[0.14em] transition"
          style={{
            borderColor: `${palette.accent}66`,
            background: `${palette.accent}14`,
            color: palette.heading,
            boxShadow: `0 0 16px ${palette.panelGlow}`,
          }}
        >
          {isUploading ? "Uploading..." : "Upload CSV"}
        </button>
      </div>
    </section>
  );
}
