"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

import { preloadCoreData, preloadRouteData, ensureGlobalNews, ensureHeatmapAssets, ensureTrackRecord, ensurePortfolioStrategies } from "@/lib/dashboardPreload";

function scheduleIdle(task: () => void): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const idle = (window as Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  }).requestIdleCallback;

  if (idle) {
    const id = idle(task, { timeout: 1200 });
    return () => {
      (window as Window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback?.(id);
    };
  }

  const timeoutId = window.setTimeout(task, 180);
  return () => window.clearTimeout(timeoutId);
}

export default function DashboardDataBootstrap() {
  const pathname = usePathname();

  useEffect(() => {
    return scheduleIdle(() => {
      void preloadCoreData();
    });
  }, []);

  useEffect(() => {
    return scheduleIdle(() => {
      void preloadRouteData(pathname);
    });
  }, [pathname]);

  useEffect(() => {
    const marketTimer = window.setInterval(() => {
      void ensureHeatmapAssets("tradingview", "D", true);
    }, 45_000);
    const newsTimer = window.setInterval(() => {
      void ensureGlobalNews(true);
    }, 7 * 60_000);
    const strategyTimer = window.setInterval(() => {
      void Promise.allSettled([ensureTrackRecord(true), ensurePortfolioStrategies(true)]);
    }, 5 * 60_000);

    return () => {
      window.clearInterval(marketTimer);
      window.clearInterval(newsTimer);
      window.clearInterval(strategyTimer);
    };
  }, []);

  return null;
}
