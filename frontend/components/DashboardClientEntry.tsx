"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import DashboardLoadingShell from "@/components/DashboardLoadingShell";

const DashboardApp = dynamic(() => import("@/components/DashboardApp"), {
  ssr: false,
});

export default function DashboardClientEntry() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <DashboardLoadingShell />;
  }

  return <DashboardApp />;
}
