"use client";

import type { ReactNode } from "react";

export type MetricCardProps = {
  title: string;
  value: string;
  status?: string;
  subtitle?: string;
  miniChart?: ReactNode;
  toneClass?: string;
};

export default function MetricCard({ title, value, status, subtitle, miniChart, toneClass }: MetricCardProps) {
  return (
    <div className="ivq-stat-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="ivq-stat-label">{title}</div>
          <div className={`mt-1 text-lg font-semibold ${toneClass ?? "text-slate-100"}`}>{value}</div>
          {subtitle ? <div className="text-xs text-slate-400">{subtitle}</div> : null}
        </div>
        {status ? (
          <div className="rounded-full border border-slate-600/50 bg-[rgba(15,24,45,0.7)] px-2 py-1 text-[10px] font-semibold text-slate-200">
            {status}
          </div>
        ) : null}
      </div>
      {miniChart ? <div className="mt-3">{miniChart}</div> : null}
    </div>
  );
}
