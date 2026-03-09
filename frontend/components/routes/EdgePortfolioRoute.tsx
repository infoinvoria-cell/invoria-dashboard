"use client";

import { useEffect } from "react";

import EdgePortfolioPage from "@/components/pages/EdgePortfolioPage";
import { ensurePortfolioStrategies } from "@/lib/dashboardPreload";
import { useDashboardStore } from "@/lib/dashboardStore";

export default function EdgePortfolioRoute() {
  const strategies = useDashboardStore((state) => state.sharedData.portfolioData.strategies);

  useEffect(() => {
    if (strategies.length > 0) return;
    void ensurePortfolioStrategies();
  }, [strategies.length]);

  return <EdgePortfolioPage initialStrategies={strategies} />;
}
