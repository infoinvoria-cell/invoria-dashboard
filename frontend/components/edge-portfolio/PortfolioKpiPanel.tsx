"use client";

import KpiCard from "@/components/track-record/KpiCard";
import type { PortfolioKpiItem } from "@/components/edge-portfolio/metrics";
import type { TrackRecordTheme } from "@/components/track-record/metrics";

type Props = {
  theme: TrackRecordTheme;
  kpis: PortfolioKpiItem[];
};

export default function PortfolioKpiPanel({ theme, kpis }: Props) {
  return (
    <section className="grid min-h-0 grid-cols-1 gap-2.5 min-[769px]:grid-cols-2 xl:auto-rows-fr">
      {kpis.map((kpi) => (
        <div key={kpi.title} title={kpi.tooltip}>
          <KpiCard
            title={kpi.title}
            value={kpi.value}
            footer={kpi.footer}
            sparkline={kpi.sparkline}
            tone={kpi.tone}
            theme={theme}
          />
        </div>
      ))}
    </section>
  );
}
