"use client";

import { useEffect, useState } from "react";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import type { TrackRecordTheme } from "@/components/track-record/metrics";
import { getTrackRecordThemePalette } from "@/components/track-record/theme";

export type DonutSegment = {
  label: string;
  value: number;
  color: string;
};

type Props = {
  segments: DonutSegment[];
  centerLabel?: string;
  theme: TrackRecordTheme;
};

export default function DonutChart({ segments, centerLabel, theme }: Props) {
  const [mounted, setMounted] = useState(false);
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const palette = getTrackRecordThemePalette(theme);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div
        className="h-full w-full rounded-full border"
        style={{ borderColor: palette.panelBorder, background: "rgba(7,10,15,0.7)" }}
      />
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Tooltip
          contentStyle={{
            borderRadius: 12,
            border: `1px solid ${palette.panelBorder}`,
            background: "rgba(7,10,15,0.96)",
            boxShadow: "0 18px 36px rgba(0,0,0,0.45)",
          }}
          formatter={(value, _name, item) => {
            const numericValue = Number(value ?? 0);
            const ratio = total > 0 ? (numericValue / total) * 100 : 0;
            return [`${numericValue} (${ratio.toFixed(1)}%)`, item.payload.label];
          }}
        />
        <Pie
          data={segments}
          dataKey="value"
          nameKey="label"
          innerRadius={22}
          outerRadius={36}
          paddingAngle={2}
          stroke="rgba(7,10,15,0.92)"
          strokeWidth={1}
          isAnimationActive={false}
        >
          {segments.map((segment) => (
            <Cell key={segment.label} fill={segment.color} />
          ))}
        </Pie>
        {centerLabel ? (
          <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle" fill={palette.muted} fontSize="10" fontWeight={700}>
            {centerLabel}
          </text>
        ) : null}
      </PieChart>
    </ResponsiveContainer>
  );
}
