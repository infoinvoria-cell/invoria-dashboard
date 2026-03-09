import type { PineScreenerRow, MacroAlignmentState, ScreenerMacroSnapshot } from "@/lib/screener/types";

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function macroClass(row: Pick<PineScreenerRow, "assetGroup" | "category" | "name">): "commodity" | "bond" | "equity" | "fx" | "other" {
  const group = String(row.assetGroup).toLowerCase();
  const category = String(row.category).toLowerCase();
  const name = String(row.name).toLowerCase();
  if (group.includes("metal") || group.includes("commodit") || category.includes("metal") || category.includes("soft") || category.includes("agriculture") || category.includes("commodity")) {
    return "commodity";
  }
  if (category.includes("bond") || name.includes("10y")) return "bond";
  if (group.includes("aktien") || group.includes("indice") || category.includes("stock") || category.includes("equit") || name.includes("s&p") || name.includes("nasdaq") || name.includes("dax")) {
    return "equity";
  }
  if (group.includes("forex") || group.includes("fx") || category === "fx" || category.includes("currency")) return "fx";
  return "other";
}

function directionalState(signalDirection: PineScreenerRow["signalDirection"], bullishSupport: boolean, bearishSupport: boolean): MacroAlignmentState {
  if (signalDirection === "LONG") {
    if (bullishSupport) return "supportive";
    if (bearishSupport) return "contradicting";
    return "neutral";
  }
  if (signalDirection === "SHORT") {
    if (bearishSupport) return "supportive";
    if (bullishSupport) return "contradicting";
    return "neutral";
  }
  return "neutral";
}

function cpiState(row: PineScreenerRow, cpiHot: boolean): MacroAlignmentState {
  const cls = macroClass(row);
  if (!cpiHot) return "neutral";
  if (cls === "commodity") return directionalState(row.signalDirection, true, true);
  if (cls === "bond") return directionalState(row.signalDirection, false, true);
  if (cls === "equity") return "neutral";
  return "neutral";
}

function ppiState(row: PineScreenerRow, ppiHot: boolean): MacroAlignmentState {
  const cls = macroClass(row);
  if (!ppiHot) return "neutral";
  if (cls === "commodity") return directionalState(row.signalDirection, true, true);
  if (cls === "equity") return directionalState(row.signalDirection, false, true);
  return "neutral";
}

function cotState(row: PineScreenerRow, cotNet: number): MacroAlignmentState {
  if (!Number.isFinite(cotNet) || Math.abs(cotNet) < 18) return "neutral";
  return directionalState(row.signalDirection, cotNet > 0, cotNet < 0);
}

function riskState(row: PineScreenerRow, riskMode: "risk_on" | "risk_off" | "neutral"): MacroAlignmentState {
  const cls = macroClass(row);
  if (riskMode === "neutral") return "neutral";
  if (cls === "equity") return directionalState(row.signalDirection, riskMode === "risk_on", riskMode === "risk_off");
  if (cls === "commodity") return directionalState(row.signalDirection, riskMode === "risk_on", riskMode === "risk_off");
  if (cls === "bond") return directionalState(row.signalDirection, riskMode === "risk_off", riskMode === "risk_on");
  return "neutral";
}

function inferRiskMode(snapshot: ScreenerMacroSnapshot | null | undefined): "risk_on" | "risk_off" | "neutral" {
  const riskScore = Number(snapshot?.risk?.riskScore ?? 0);
  const riskMode = String(snapshot?.risk?.riskMode ?? "").toLowerCase();
  const volRegime = String(snapshot?.volatility?.regime ?? "").toLowerCase();
  const volScore = Number(snapshot?.volatility?.volScore ?? 0);
  if (riskMode.includes("off") || volRegime.includes("stress") || volScore >= 65 || riskScore <= -0.2) return "risk_off";
  if (riskMode.includes("on") || volRegime.includes("low") || volScore <= 35 || riskScore >= 0.2) return "risk_on";
  return "neutral";
}

export function buildMacroAlignment(row: PineScreenerRow, snapshot: ScreenerMacroSnapshot | null | undefined): Pick<PineScreenerRow, "cpiAlignment" | "ppiAlignment" | "cotCommercialsAlignment" | "riskAlignment"> {
  const cpiSeries = Object.values(snapshot?.inflation?.countryCpiYoY ?? {}).map((value) => Number(value)).filter(Number.isFinite);
  const cpiHot = average(cpiSeries) >= 3.0;
  const commodityShock = Object.values(snapshot?.commodityShock?.regionScores ?? {}).map((value) => Number(value)).filter(Number.isFinite);
  const ppiHot = average(commodityShock) >= 0.15 || (snapshot?.commodityShock?.signals ?? []).some((signal) => signal.active && Number(signal.change20d) > 0);
  const cotNet = Number(snapshot?.fundamental?.cot?.net?.commercials?.at(-1)?.v ?? 0);
  const riskMode = inferRiskMode(snapshot);

  return {
    cpiAlignment: cpiState(row, cpiHot),
    ppiAlignment: ppiState(row, ppiHot),
    cotCommercialsAlignment: cotState(row, cotNet),
    riskAlignment: riskState(row, riskMode),
  };
}
