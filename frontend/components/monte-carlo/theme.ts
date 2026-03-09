import type { MonteCarloTheme } from "@/components/monte-carlo/types";

export type MonteCarloPalette = {
  pageBackground: string;
  panelBackground: string;
  panelBackgroundSoft: string;
  border: string;
  glow: string;
  text: string;
  heading: string;
  muted: string;
  accent: string;
  accentSoft: string;
  accentStrong: string;
  positive: string;
  negative: string;
  neutral: string;
  chartGrid: string;
  surfaceLow: string;
  surfaceHigh: string;
};

export const MONTE_CARLO_THEMES: Record<MonteCarloTheme, MonteCarloPalette> = {
  dark: {
    pageBackground:
      "radial-gradient(980px 720px at 10% 10%, rgba(214, 195, 143, 0.15), transparent 60%), radial-gradient(880px 620px at 90% 12%, rgba(214, 195, 143, 0.10), transparent 62%), linear-gradient(180deg, #020203 0%, #08090b 48%, #050506 100%)",
    panelBackground: "linear-gradient(180deg, rgba(14, 12, 9, 0.80) 0%, rgba(8, 7, 6, 0.74) 100%)",
    panelBackgroundSoft: "linear-gradient(180deg, rgba(18, 15, 11, 0.58) 0%, rgba(10, 9, 7, 0.48) 100%)",
    border: "rgba(214, 195, 143, 0.22)",
    glow: "rgba(214, 195, 143, 0.20)",
    text: "#f5f1e6",
    heading: "#fff9eb",
    muted: "#a59a82",
    accent: "#d6c38f",
    accentSoft: "#efe1b6",
    accentStrong: "#fff0c4",
    positive: "#d6c38f",
    negative: "#e05656",
    neutral: "#d9d7d1",
    chartGrid: "rgba(214, 195, 143, 0.10)",
    surfaceLow: "#4c3921",
    surfaceHigh: "#f6e0a8",
  },
  blue: {
    pageBackground:
      "radial-gradient(980px 720px at 10% 10%, rgba(77, 135, 254, 0.18), transparent 60%), radial-gradient(880px 620px at 90% 12%, rgba(94, 156, 255, 0.14), transparent 62%), linear-gradient(180deg, #041022 0%, #091a38 48%, #050c1d 100%)",
    panelBackground: "linear-gradient(180deg, rgba(8, 20, 42, 0.82) 0%, rgba(5, 11, 24, 0.76) 100%)",
    panelBackgroundSoft: "linear-gradient(180deg, rgba(11, 26, 52, 0.58) 0%, rgba(7, 14, 28, 0.48) 100%)",
    border: "rgba(120, 160, 255, 0.24)",
    glow: "rgba(77, 135, 254, 0.22)",
    text: "#eff5ff",
    heading: "#ffffff",
    muted: "#93a8cb",
    accent: "#4d87fe",
    accentSoft: "#8fb6ff",
    accentStrong: "#dce8ff",
    positive: "#39ff40",
    negative: "#ff5e66",
    neutral: "#dbe6fb",
    chartGrid: "rgba(104, 152, 255, 0.10)",
    surfaceLow: "#143980",
    surfaceHigh: "#8bc5ff",
  },
};

export function getMonteCarloPalette(theme: MonteCarloTheme): MonteCarloPalette {
  return MONTE_CARLO_THEMES[theme];
}
