"use client";

import type { ReactNode } from "react";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";

import Sidebar from "@/components/Sidebar";
import { useDashboardStateStore } from "@/components/DashboardStateProvider";

const DashboardRoute = dynamic(() => import("@/components/routes/DashboardRoute"), { ssr: false });
const ScreenerRoute = dynamic(() => import("@/components/routes/ScreenerRoute"), { ssr: false });
const SeasonalityRoute = dynamic(() => import("@/components/routes/SeasonalityRoute"), { ssr: false });
const TrackRecordRoute = dynamic(() => import("@/components/routes/TrackRecordRoute"), { ssr: false });
const EdgePortfolioRoute = dynamic(() => import("@/components/routes/EdgePortfolioRoute"), { ssr: false });
const MonteCarloRoute = dynamic(() => import("@/components/routes/MonteCarloRoute"), { ssr: false });

const ROUTES = [
  { key: "dashboard", match: (pathname: string) => pathname === "/dashboard", Component: DashboardRoute },
  { key: "screener", match: (pathname: string) => pathname === "/screener", Component: ScreenerRoute },
  { key: "seasonality", match: (pathname: string) => pathname === "/seasonality", Component: SeasonalityRoute },
  { key: "track-record", match: (pathname: string) => pathname === "/track-record", Component: TrackRecordRoute },
  { key: "edge-portfolio", match: (pathname: string) => pathname === "/edge-portfolio", Component: EdgePortfolioRoute },
  { key: "monte-carlo", match: (pathname: string) => pathname === "/monte-carlo", Component: MonteCarloRoute },
] as const;

export default function TerminalShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const contentRef = useRef<HTMLElement | null>(null);
  const dashboardStore = useDashboardStateStore();
  const activeRoute = useMemo(
    () => ROUTES.find((route) => route.match(pathname)) ?? null,
    [pathname],
  );
  const [mountedRouteKeys, setMountedRouteKeys] = useState<string[]>(() => (activeRoute ? [activeRoute.key] : []));

  useEffect(() => {
    const contentElement = contentRef.current;
    if (!contentElement) return;

    const onScroll = () => {
      dashboardStore.setScrollPosition(pathname, contentElement.scrollTop);
    };

    contentElement.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      contentElement.removeEventListener("scroll", onScroll);
    };
  }, [dashboardStore, pathname]);

  useEffect(() => {
    const contentElement = contentRef.current;
    if (!contentElement) return;

    const scrollTop = dashboardStore.getScrollPosition(pathname);
    contentElement.scrollTo({ top: scrollTop, behavior: "auto" });
  }, [dashboardStore, pathname]);

  useEffect(() => {
    if (!activeRoute) return;
    setMountedRouteKeys((current) => (current.includes(activeRoute.key) ? current : [...current, activeRoute.key]));
  }, [activeRoute]);

  return (
    <div className="ivq-shell">
      <Sidebar />
      <section ref={contentRef} className="ivq-shell-content">
        {activeRoute ? (
          ROUTES.map((route) => {
            if (!mountedRouteKeys.includes(route.key)) return null;
            const Component = route.Component;
            const isActive = route.key === activeRoute.key;
            return (
              <div
                key={route.key}
                className={`ivq-shell-route ${isActive ? "is-active" : ""}`}
                style={{ display: isActive ? "block" : "none" }}
              >
                <Component />
              </div>
            );
          })
        ) : (
          <div key={pathname} className="ivq-shell-route is-active">
            {children}
          </div>
        )}
      </section>
    </div>
  );
}
