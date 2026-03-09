import type { TrackRecordTheme } from "@/components/track-record/metrics";

export type TrackRecordPalette = {
  id: TrackRecordTheme;
  name: string;
  watermarkLogo: string;
  pageBackground: string;
  panelBackground: string;
  panelBackgroundStrong: string;
  panelBorder: string;
  panelGlow: string;
  panelShadow: string;
  text: string;
  heading: string;
  muted: string;
  accent: string;
  accentSoft: string;
  accentStrong: string;
  positive: string;
  success: string;
  negative: string;
  neutral: string;
  grid: string;
  tableHeader: string;
  chart: {
    curve1x: string;
    curve2x: string;
    curve3x: string;
    curve4x: string;
    curve5x: string;
    compareSp500: string;
    compareDax40: string;
  };
};

export const TRACK_RECORD_THEMES: Record<TrackRecordTheme, TrackRecordPalette> = {
  dark: {
    id: "dark",
    name: "Dark",
    watermarkLogo: "/CAPITALIFE_Logo.png",
    pageBackground:
      "radial-gradient(1200px 860px at 12% 16%, rgba(255,224,156,0.16), transparent 62%), radial-gradient(980px 720px at 88% 14%, rgba(224,186,88,0.14), transparent 66%), radial-gradient(920px 680px at 22% 88%, rgba(196,155,64,0.12), transparent 72%), radial-gradient(860px 620px at 78% 80%, rgba(210,168,74,0.10), transparent 72%), linear-gradient(180deg, #010102 0%, #060608 44%, #0b0b0d 72%, #020203 100%)",
    panelBackground: "linear-gradient(180deg, rgba(16,13,9,0.76) 0%, rgba(9,8,7,0.72) 100%)",
    panelBackgroundStrong: "linear-gradient(180deg, rgba(15,12,8,0.84) 0%, rgba(8,7,6,0.78) 100%)",
    panelBorder: "rgba(214,195,143,0.22)",
    panelGlow: "rgba(214,195,143,0.28)",
    panelShadow: "0 16px 44px rgba(0,0,0,0.50), 0 0 28px rgba(214,195,143,0.10), inset 0 1px 0 rgba(255,244,214,0.05)",
    text: "#ffffff",
    heading: "#fffaf0",
    muted: "#8f98a3",
    accent: "#D6C38F",
    accentSoft: "#efe1b6",
    accentStrong: "#f6eac9",
    positive: "#D6C38F",
    success: "#D6C38F",
    negative: "#e05656",
    neutral: "#d7dce3",
    grid: "rgba(214,195,143,0.10)",
    tableHeader: "rgba(7,9,13,0.92)",
    chart: {
      curve1x: "#ffffff",
      curve2x: "#efe1b6",
      curve3x: "#D6C38F",
      curve4x: "#b99953",
      curve5x: "#f5d47b",
      compareSp500: "#ff4d6d",
      compareDax40: "#9d5cff",
    },
  },
  blue: {
    id: "blue",
    name: "Blue",
    watermarkLogo: "/invoria_logo.png",
    pageBackground:
      "radial-gradient(1200px 860px at 12% 16%, rgba(120,182,255,0.20), transparent 62%), radial-gradient(1020px 760px at 88% 14%, rgba(102,164,250,0.16), transparent 66%), radial-gradient(940px 700px at 22% 88%, rgba(84,142,242,0.13), transparent 72%), radial-gradient(920px 700px at 78% 80%, rgba(92,150,246,0.11), transparent 72%), radial-gradient(760px 560px at 50% 50%, rgba(80,136,228,0.09), transparent 76%), linear-gradient(180deg, #040b1f 0%, #0b1c37 45%, #132a4c 72%, #050d21 100%)",
    panelBackground: "linear-gradient(180deg, rgba(8,18,40,0.78) 0%, rgba(5,11,24,0.72) 100%)",
    panelBackgroundStrong: "linear-gradient(180deg, rgba(9,20,44,0.84) 0%, rgba(4,9,22,0.78) 100%)",
    panelBorder: "rgba(120,160,255,0.22)",
    panelGlow: "rgba(120,160,255,0.28)",
    panelShadow: "0 16px 44px rgba(0,0,0,0.46), 0 0 30px rgba(77,135,254,0.12), inset 0 1px 0 rgba(190,216,255,0.05)",
    text: "#ffffff",
    heading: "#eef4ff",
    muted: "#92a6c8",
    accent: "#4d87fe",
    accentSoft: "#8fb6ff",
    accentStrong: "#dce8ff",
    positive: "#8fb6ff",
    success: "#39ff40",
    negative: "#e05656",
    neutral: "#d7dce3",
    grid: "rgba(88,145,255,0.10)",
    tableHeader: "rgba(8,14,28,0.94)",
    chart: {
      curve1x: "#ffffff",
      curve2x: "#bfd4ff",
      curve3x: "#78a8ff",
      curve4x: "#3f6fdf",
      curve5x: "#4dc8ff",
      compareSp500: "#ff4d6d",
      compareDax40: "#9d5cff",
    },
  },
};

export function getTrackRecordThemePalette(theme: TrackRecordTheme): TrackRecordPalette {
  return TRACK_RECORD_THEMES[theme];
}
