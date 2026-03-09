"use client";

import CandleChart from "@/components/globe/charts/CandleChart";
import { deriveSupportResistanceZones } from "@/components/screener/OrderBlockDetector";
import type { ExpandedAssetData, ScreenerRowData, ScreenerTheme } from "@/components/screener/types";

type Props = {
  assetName: string;
  row: ScreenerRowData;
  assetData: ExpandedAssetData | null;
  theme: ScreenerTheme;
};

export default function ExpandedTradingChart({ assetName, row, assetData, theme }: Props) {
  const structuralZones = deriveSupportResistanceZones(assetData?.timeseries ?? null);
  const enrichedPayload = assetData?.timeseries
    ? {
        ...assetData.timeseries,
        supplyDemand: {
          demand: [
            ...(assetData.timeseries.supplyDemand?.demand ?? []),
            ...structuralZones.demand,
            ...(row.orderBlock.direction === "bullish" && row.orderBlock.low != null && row.orderBlock.high != null && row.orderBlock.start && row.orderBlock.end
              ? [{ start: row.orderBlock.start, end: row.orderBlock.end, low: row.orderBlock.low, high: row.orderBlock.high }]
              : []),
          ],
          supply: [
            ...(assetData.timeseries.supplyDemand?.supply ?? []),
            ...structuralZones.supply,
            ...(row.orderBlock.direction === "bearish" && row.orderBlock.low != null && row.orderBlock.high != null && row.orderBlock.start && row.orderBlock.end
              ? [{ start: row.orderBlock.start, end: row.orderBlock.end, low: row.orderBlock.low, high: row.orderBlock.high }]
              : []),
          ],
        },
      }
    : null;

  return (
    <div className="h-[360px] min-w-[720px]">
      <CandleChart
        payload={enrichedPayload}
        evaluation={assetData?.evaluation ?? null}
        seasonality={assetData?.seasonality ?? null}
        title={assetName}
        sourceLabel={assetData?.timeseries?.sourceUsed ?? assetData?.timeseries?.source ?? "Source"}
        goldThemeEnabled={theme === "gold"}
        themePrimary={theme === "gold" ? "#d6c38f" : "#4d87fe"}
      />
    </div>
  );
}
