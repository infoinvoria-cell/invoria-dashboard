"use client";

import { useEffect, useState } from "react";

import { Area, AreaChart, ResponsiveContainer, Tooltip } from "recharts";

import type { TrackRecordTheme } from "@/components/track-record/metrics";
import { getTrackRecordThemePalette } from "@/components/track-record/theme";

type Props = {
  data: number[];
  color?: string;
  negative?: boolean;
  theme: TrackRecordTheme;
};

export default function Sparkline({ data, color = "#d6c38f", negative = false, theme }: Props) {
  const [mounted, setMounted] = useState(false);
  const chartData = data.map((value, index) => ({ index, value }));
  const gradientId = `spark-${color.replace(/[^a-zA-Z0-9]/g, "")}-${negative ? "neg" : "pos"}-${theme}`;
  const palette = getTrackRecordThemePalette(theme);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || chartData.length === 0) {
    return <div className="h-8 rounded-xl" style={{ background: "rgba(255,255,255,0.03)" }} />;
  }

  return (
    <div className="h-8 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.42} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Tooltip
            contentStyle={{
              borderRadius: 12,
              border: `1px solid ${palette.panelBorder}`,
              background: "rgba(7,10,15,0.96)",
              boxShadow: "0 18px 36px rgba(0,0,0,0.45)",
            }}
            formatter={(value) => [Number(value ?? 0).toFixed(2), negative ? "drawdown" : "value"]}
            labelFormatter={() => ""}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={1.6}
            fill={`url(#${gradientId})`}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
