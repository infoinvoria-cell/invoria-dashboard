"use client";

import ScreenerMainChart from "@/components/screener/ScreenerMainChart";
import ScreenerMiniEvalCard from "@/components/screener/ScreenerMiniEvalCard";
import ScreenerMiniSeasonalityCard from "@/components/screener/ScreenerMiniSeasonalityCard";
import type { PineScreenerSettings, ScreenerSelectedAnalysis, ScreenerTheme } from "@/lib/screener/types";

type Props = {
  theme: ScreenerTheme;
  assetName: string;
  analysis: ScreenerSelectedAnalysis | null;
  settings: PineScreenerSettings;
};

export default function ScreenerHeaderCharts({ theme, assetName, analysis, settings }: Props) {
  return (
    <section className="ivq-screener-header-grid">
      <ScreenerMainChart assetName={assetName} theme={theme} analysis={analysis} settings={settings} />
      <div className="ivq-screener-header-grid__side">
        <ScreenerMiniEvalCard
          title="Valuation"
          mode="v10"
          payload={analysis?.valuation?.evaluationPayload ?? null}
          activePoint={analysis?.valuation?.activeVal10 ?? null}
          theme={theme}
        />
        <ScreenerMiniEvalCard
          title="Valuation Distribution"
          mode="v20"
          payload={analysis?.valuation?.evaluationPayload ?? null}
          activePoint={analysis?.valuation?.activeVal20 ?? null}
          theme={theme}
        />
        <ScreenerMiniSeasonalityCard
          theme={theme}
          payload={analysis?.seasonality ?? null}
          fallback={analysis?.seasonalityHeatmap ?? null}
        />
      </div>
    </section>
  );
}
