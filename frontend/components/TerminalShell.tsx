import type { ReactNode } from "react";

import Sidebar from "@/components/Sidebar";

export default function TerminalShell({ children }: { children: ReactNode }) {
  return (
    <div className="ivq-shell">
      <Sidebar />
      <section className="ivq-shell-content">{children}</section>
    </div>
  );
}
