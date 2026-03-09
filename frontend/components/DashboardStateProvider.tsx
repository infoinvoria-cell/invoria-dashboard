"use client";

import DashboardDataBootstrap from "@/components/DashboardDataBootstrap";
export { useDashboardStateStore } from "@/lib/dashboardStore";

export default function DashboardStateProvider({ children }: { children: React.ReactNode }) {
  return (
    <>
      <DashboardDataBootstrap />
      {children}
    </>
  );
}
