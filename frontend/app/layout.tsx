import type { Metadata } from "next";
import "./globals.css";
import "../styles/globals.css";
import "../styles/dashboard.css";
import DashboardStateProvider from "@/components/DashboardStateProvider";
import TerminalShell from "@/components/TerminalShell";

export const metadata: Metadata = {
  title: "Invoria Dashboard",
  description: "Next.js trading dashboard frontend for Invoria backend APIs.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <DashboardStateProvider>
          <TerminalShell>{children}</TerminalShell>
        </DashboardStateProvider>
      </body>
    </html>
  );
}
