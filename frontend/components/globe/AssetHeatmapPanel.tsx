import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

import { AssetIcon } from "../../lib/icons";
import { GlobeApi } from "../../lib/api";
import type {
  AssetItem,
  HeatmapAssetsResponse,
  HeatmapCombinedItem,
  HeatmapMacroItem,
  HeatmapSeasonalityItem,
  HeatmapSupplyDemandItem,
  HeatmapValuationItem,
} from "../../types";

type HeatmapMode = "correlation" | "valuation" | "seasonality" | "macro" | "supplyDemand" | "combined";
type CorrTimeframe = "1MIN" | "5MIN" | "30MIN" | "1H" | "4H" | "D" | "W" | "M";
type HeatmapGroup = "ALL" | "ROHSTOFFE" | "FX" | "RISK";

const MODES: Array<{ id: HeatmapMode; label: string }> = [
  { id: "correlation", label: "Correlation" },
  { id: "valuation", label: "Valuation" },
  { id: "seasonality", label: "Seasonality" },
  { id: "macro", label: "Macro" },
  { id: "supplyDemand", label: "Supply & Demand" },
  { id: "combined", label: "Combined Signal" },
];

const CORR_TFS: Array<{ id: CorrTimeframe; label: string }> = [
  { id: "1MIN", label: "1M" },
  { id: "5MIN", label: "5M" },
  { id: "30MIN", label: "30M" },
  { id: "1H", label: "1H" },
  { id: "4H", label: "4H" },
  { id: "D", label: "D" },
  { id: "W", label: "W" },
  { id: "M", label: "M" },
];

const CATEGORY_ORDER = ["FX", "Metals", "Crypto", "Energy", "Agriculture", "Softs", "Livestock"] as const;
const BLOCKED_CATEGORIES = new Set<string>(["Equities", "Stocks", "Equity"]);
const ROHSTOFFE_SET = new Set<string>(["Metals", "Energy", "Agriculture", "Softs", "Livestock"]);
const RISK_SET = new Set<string>(["Crypto"]);
const GROUP_LABEL: Record<HeatmapGroup, string> = {
  ALL: "All",
  ROHSTOFFE: "Rohstoffe",
  FX: "FX",
  RISK: "Risk",
};

type ValDriverKey = "dollar" | "gold" | "us10y" | "combined";

const VAL_DRIVER_META: Record<ValDriverKey, { label: string; short: string; color: string }> = {
  dollar: { label: "Dollar", short: "$", color: "#4CAF50" },
  gold: { label: "Gold", short: "Au", color: "#FFEB3B" },
  us10y: { label: "US10Y", short: "10Y", color: "#FF9800" },
  combined: { label: "Combined", short: "Comb", color: "#2962ff" },
};

const MACRO_COMPONENT_META: Record<"risk" | "fedLiquidity" | "cotIndex" | "cotNet", { short: string; color: string }> = {
  risk: { short: "Risk", color: "#2962ff" },
  fedLiquidity: { short: "Fed", color: "#39ff40" },
  cotIndex: { short: "COTi", color: "#FFEB3B" },
  cotNet: { short: "COTn", color: "#ff384c" },
};

function categoriesForGroup(group: HeatmapGroup): Set<string> {
  if (group === "ALL") return new Set<string>(CATEGORY_ORDER);
  if (group === "ROHSTOFFE") return new Set<string>(ROHSTOFFE_SET);
  if (group === "FX") return new Set<string>(["FX"]);
  return new Set<string>(RISK_SET);
}

const ASSET_ABBR: Record<string, string> = {
  usd_index: "DXY",
  eur: "EUR",
  jpy: "JPY",
  gbp: "GBP",
  chf: "CHF",
  aud: "AUD",
  cad: "CAD",
  nzd: "NZD",
  gold: "XAU",
  silver: "XAG",
  copper: "HG",
  platinum: "PL",
  palladium: "PA",
  aluminum: "ALI",
  sp500: "SPX",
  nasdaq100: "NDX",
  dowjones: "DJI",
  russell2000: "RTY",
  dax40: "DAX",
  bitcoin: "BTC",
  wti_spot: "WTI",
  natgas: "NG",
  gasoline: "RBOB",
  wheat: "ZW",
  corn: "ZC",
  soybeans: "ZS",
  soyoil: "ZL",
  coffee: "KC",
  sugar: "SB",
  cocoa: "CC",
  cotton: "CT",
  orange_juice: "OJ",
  live_cattle: "LE",
  lean_hogs: "HE",
};

type CorrHover = { a: string; b: string; value: number; timeframe: string } | null;
type Size = { w: number; h: number };
type SizeRef<T extends HTMLElement> = (node: T | null) => void;

function shortSymbol(raw: string): string {
  const s = String(raw || "").toUpperCase();
  const cleaned = s.split(":").pop() ?? s;
  return cleaned.length > 10 ? cleaned.slice(0, 10) : cleaned;
}

function compactCode(assetId: string, symbol: string, name: string): string {
  const aid = String(assetId || "").toLowerCase();
  if (ASSET_ABBR[aid]) return ASSET_ABBR[aid];
  const sym = shortSymbol(symbol);
  if (sym === "BTCUSD") return "BTC";
  if (sym === "US500") return "SPX";
  if (sym.length <= 6) return sym;
  return shortSymbol(name).toUpperCase();
}

function fmt(value: number | null | undefined, digits = 1): string {
  const v = Number(value);
  return Number.isFinite(v) ? v.toFixed(digits) : "-";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function correlationCellColor(value: number): string {
  const v = clamp(Number(value) || 0, -100, 100);
  const absV = Math.abs(v);
  if (absV < 20) {
    const neutralAlpha = 0.03 + (absV / 20) * 0.20;
    return `rgba(70,88,122,${neutralAlpha.toFixed(3)})`;
  }
  const strength = Math.pow((absV - 20) / 80, 0.78);
  const alpha = 0.24 + strength * 0.72;
  if (v > 0) {
    return `rgba(57,255,64,${alpha.toFixed(3)})`;
  }
  return `rgba(255,56,76,${alpha.toFixed(3)})`;
}

function valuationCardStyle(score: number): { bg: string; border: string; text: string } {
  const s = clamp(Number(score) || 0, -100, 100);
  const trigger = 75;
  const absS = Math.abs(s);
  if (absS < trigger) {
    const soft = Math.pow(absS / trigger, 1.2);
    const tint = s >= 0 ? `rgba(96,58,68,${(0.08 + soft * 0.14).toFixed(3)})` : `rgba(48,88,70,${(0.08 + soft * 0.14).toFixed(3)})`;
    return { bg: tint, border: "rgba(116,136,170,0.45)", text: "#e7edf9" };
  }
  const intensity = Math.pow((absS - trigger) / (100 - trigger), 0.75);
  if (s > 0) {
    const bgA = 0.26 + intensity * 0.66;
    const brA = 0.40 + intensity * 0.48;
    return { bg: `rgba(162,30,52,${bgA.toFixed(3)})`, border: `rgba(255,88,120,${brA.toFixed(3)})`, text: "#ffe7ec" };
  }
  const bgA = 0.24 + intensity * 0.68;
  const brA = 0.38 + intensity * 0.50;
  return { bg: `rgba(18,130,56,${bgA.toFixed(3)})`, border: `rgba(84,255,142,${brA.toFixed(3)})`, text: "#eafff1" };
}

function supplyDemandCardStyle(status: string, score: number): { bg: string; border: string } {
  const intensity = Math.pow(clamp(Math.abs(score), 0, 100) / 100, 0.8);
  if (status === "demand") {
    return {
      bg: `rgba(20,118,56,${(0.30 + intensity * 0.56).toFixed(3)})`,
      border: `rgba(108,255,158,${(0.42 + intensity * 0.42).toFixed(3)})`,
    };
  }
  if (status === "supply") {
    return {
      bg: `rgba(136,34,55,${(0.34 + intensity * 0.56).toFixed(3)})`,
      border: `rgba(255,114,138,${(0.42 + intensity * 0.42).toFixed(3)})`,
    };
  }
  return {
    bg: `rgba(13,39,86,${(0.58 + intensity * 0.24).toFixed(3)})`,
    border: `rgba(82,126,206,${(0.46 + intensity * 0.22).toFixed(3)})`,
  };
}

function combinedCardStyle(score: number): { bg: string; border: string; text: string } {
  const s = clamp(Number(score) || 0, 0, 100);
  const dist = Math.abs(s - 50);
  if (dist <= 8) {
    return { bg: "rgba(37,52,78,0.36)", border: "rgba(114,134,170,0.44)", text: "#ebf1ff" };
  }
  if (s >= 50) {
    const intensity = Math.pow((s - 58) / 42, 0.84);
    return {
      bg: `rgba(20,124,55,${(0.28 + intensity * 0.60).toFixed(3)})`,
      border: `rgba(96,255,154,${(0.42 + intensity * 0.44).toFixed(3)})`,
      text: "#ebfff2",
    };
  }
  const intensity = Math.pow((42 - s) / 42, 0.84);
  return {
    bg: `rgba(136,36,53,${(0.30 + intensity * 0.60).toFixed(3)})`,
    border: `rgba(255,116,136,${(0.42 + intensity * 0.44).toFixed(3)})`,
    text: "#ffe7ec",
  };
}

function macroCardStyle(scoreSigned: number): { bg: string; border: string; line: string; text: string; ringTrack: string } {
  const s = clamp(Number(scoreSigned) || 0, -100, 100);
  const absS = Math.abs(s);
  const intensity = Math.pow(absS / 100, 0.86);
  const isBull = s >= 0;
  const dark = isBull ? "#1f6a43" : "#7a2430";
  const bright = isBull ? "#39ff40" : "#ff384c";
  const line = mixHex(dark, bright, intensity);
  const bg = isBull
    ? `rgba(18,110,52,${(0.06 + intensity * 0.68).toFixed(3)})`
    : `rgba(128,32,49,${(0.06 + intensity * 0.68).toFixed(3)})`;
  const border = isBull
    ? `rgba(84,255,142,${(0.16 + intensity * 0.66).toFixed(3)})`
    : `rgba(255,108,132,${(0.16 + intensity * 0.66).toFixed(3)})`;
  return {
    bg,
    border,
    line,
    text: "#eaf1ff",
    ringTrack: isBull ? "rgba(22,58,43,0.62)" : "rgba(66,24,33,0.62)",
  };
}

function mixHex(a: string, b: string, t: number): string {
  const clampT = clamp(t, 0, 1);
  const toRgb = (hex: string) => {
    const clean = String(hex || "").replace("#", "").padEnd(6, "0").slice(0, 6);
    return {
      r: parseInt(clean.slice(0, 2), 16),
      g: parseInt(clean.slice(2, 4), 16),
      b: parseInt(clean.slice(4, 6), 16),
    };
  };
  const ar = toRgb(a);
  const br = toRgb(b);
  const r = Math.round(ar.r + (br.r - ar.r) * clampT);
  const g = Math.round(ar.g + (br.g - ar.g) * clampT);
  const b2 = Math.round(ar.b + (br.b - ar.b) * clampT);
  return `rgb(${r}, ${g}, ${b2})`;
}

function seasonalityTone(row: HeatmapSeasonalityItem): {
  direction: "LONG" | "SHORT";
  hit: number;
  intensity: number;
  signal: number;
  line: string;
  bg: string;
  border: string;
  ringTrack: string;
} {
  const direction = String(row.direction || "LONG").toUpperCase() === "SHORT" ? "SHORT" : "LONG";
  const hit = clamp(Number(row.hitRate ?? 0), 0, 100);
  const directionSign = direction === "SHORT" ? -1 : 1;
  const expected = Number(row.expectedReturn ?? 0);
  // Stable signal model: direction + hit-rate edge (+small expected-return boost).
  // This keeps strongest bullish items on top and bearish items at the bottom.
  const hitEdge = clamp((hit - 50) * 2, -100, 100);
  const expectedBoost = clamp(Math.abs(expected) * 6, 0, 20);
  const signal = clamp(directionSign * hitEdge + directionSign * expectedBoost, -100, 100);

  const intensity = Math.pow(clamp(Math.abs(hit - 50) / 50, 0, 1), 1.05);
  const isBull = signal >= 0;
  const dark = isBull ? "#1f6a43" : "#7a2430";
  const bright = isBull ? "#39ff40" : "#ff384c";
  const line = mixHex(dark, bright, intensity);
  const bg = isBull
    ? `rgba(18,110,52,${(0.05 + intensity * 0.72).toFixed(3)})`
    : `rgba(128,32,49,${(0.05 + intensity * 0.72).toFixed(3)})`;
  const border = isBull
    ? `rgba(84,255,142,${(0.14 + intensity * 0.70).toFixed(3)})`
    : `rgba(255,108,132,${(0.14 + intensity * 0.70).toFixed(3)})`;
  const ringTrack = isBull ? "rgba(22,58,43,0.62)" : "rgba(66,24,33,0.62)";

  return { direction, hit, intensity, signal, line, bg, border, ringTrack };
}

function seasonalityLineColor(row: HeatmapSeasonalityItem): string {
  return seasonalityTone(row).line;
}

function seasonalitySignedStrength(row: HeatmapSeasonalityItem): number {
  return seasonalityTone(row).signal;
}

function buildSparkline(curve: number[]): { line: string; area: string } {
  const values = curve.map((v) => Number(v)).filter((v) => Number.isFinite(v));
  if (values.length < 2) return { line: "", area: "" };

  const width = 100;
  const height = 30;
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const range = Math.max(1e-6, maxV - minV);

  const points = values.map((v, i) => {
    const x = (i / Math.max(1, values.length - 1)) * width;
    const y = height - ((v - minV) / range) * height;
    return { x, y };
  });
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ");
  const area = `${line} L${width} ${height} L0 ${height} Z`;
  return { line, area };
}

function valueBar(value: number): string {
  const pct = Math.max(0, Math.min(100, Number(value) || 0));
  return `${pct}%`;
}

function signedBarColor(value: number): string {
  return Number(value) >= 0 ? "#39ff40" : "#ff384c";
}

function signedBarWidth(value: number): string {
  return `${clamp(Math.abs(Number(value) || 0), 0, 100)}%`;
}

function normalized100(value: number): number {
  return clamp(Number(value) || 0, 0, 100);
}

function fitCardsGrid(
  itemCount: number,
  width: number,
  height: number,
  gap: number,
  maxCols?: number,
): { cols: number; rows: number; cardH: number; compact: boolean } {
  const n = Math.max(1, itemCount);
  const w = Math.max(360, width);
  const h = Math.max(180, height);
  const colsLimit = Math.max(1, Math.min(n, Number.isFinite(maxCols) ? Number(maxCols) : n));

  // Search a grid that fully fits into the container with no internal scrolling.
  let best = { cols: 1, rows: n, cardH: Math.max(28, Math.floor((h - (n - 1) * gap) / n)) };
  let bestScore = -Infinity;

  for (let cols = 1; cols <= colsLimit; cols += 1) {
    const rows = Math.ceil(n / cols);
    const cardW = (w - (cols - 1) * gap) / cols;
    const cardH = Math.floor((h - (rows - 1) * gap) / rows);
    if (cardW < 104 || cardH < 42) continue;
    // prefer larger cards and balanced aspect ratio
    const ratioPenalty = Math.abs((cardW / Math.max(1, cardH)) - 1.6);
    const score = cardW * cardH - ratioPenalty * 1200;
    if (score > bestScore) {
      bestScore = score;
      best = { cols, rows, cardH };
    }
  }

  const compact = best.cardH < 86;
  return { ...best, compact };
}

function useElementSize<T extends HTMLElement>(): { ref: SizeRef<T>; size: Size } {
  const [node, setNode] = useState<T | null>(null);
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  const ref = useCallback((el: T | null) => {
    setNode(el);
  }, []);

  useEffect(() => {
    if (!node) return;
    const update = () => {
      setSize({ w: node.clientWidth, h: node.clientHeight });
    };
    update();
    const rafIds: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      rafIds.push(
        window.requestAnimationFrame(() => {
          update();
        }),
      );
    }
    const observer = new ResizeObserver(update);
    observer.observe(node);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      rafIds.forEach((id) => window.cancelAnimationFrame(id));
    };
  }, [node]);

  return { ref, size };
}

function fitMatrix(n: number, width: number, height: number): { labelW: number; headerH: number; cellW: number; cellH: number } {
  const w = Math.max(320, width);
  const h = Math.max(220, height);
  const labelW = Math.max(20, Math.min(50, Math.round(w * 0.068)));
  const headerH = Math.max(14, Math.min(24, Math.round(h * 0.06)));
  const cellW = Math.max(6, (w - labelW) / Math.max(1, n));
  const cellH = Math.max(6, (h - headerH) / Math.max(1, n));
  return { labelW, headerH, cellW, cellH };
}

function iconForRow(row: { assetId: string; name: string; category: string }, assetMap: Record<string, AssetItem>) {
  const asset = assetMap[row.assetId];
  if (!asset) {
    return <span className="inline-block h-[9px] w-[9px] rounded-full bg-[var(--ivq-primary)]/80" />;
  }
  return <AssetIcon iconKey={asset.iconKey} category={asset.category} assetName={asset.name} className="h-[12px] w-[12px]" />;
}

export function AssetHeatmapPanel({
  selectedAssetId,
  dataSource = "tradingview",
  goldThemeEnabled = false,
  enabled = false,
}: {
  selectedAssetId?: string;
  dataSource?: "tradingview" | "dukascopy" | "yahoo";
  goldThemeEnabled?: boolean;
  enabled?: boolean;
}) {
  const [mode, setMode] = useState<HeatmapMode>("combined");
  const [corrTf, setCorrTf] = useState<CorrTimeframe>("D");
  const [activeGroup, setActiveGroup] = useState<HeatmapGroup>("ALL");
  const [payload, setPayload] = useState<HeatmapAssetsResponse | null>(null);
  const [assetMap, setAssetMap] = useState<Record<string, AssetItem>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [corrHover, setCorrHover] = useState<CorrHover>(null);
  const accentColor = goldThemeEnabled ? "#d6b24a" : "#2962ff";

  const matrixBox = useElementSize<HTMLDivElement>();
  const cardsBox = useElementSize<HTMLDivElement>();

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    Promise.allSettled([GlobeApi.getHeatmapAssets(corrTf, dataSource), GlobeApi.getAssets()])
      .then(([heatmapRes, assetsRes]) => {
        if (cancelled) return;
        if (heatmapRes.status === "fulfilled") {
          setPayload(heatmapRes.value);
          // Diagnostics trace: confirms timeframe-specific matrix refresh.
          // eslint-disable-next-line no-console
          console.info(
            "[IVQ][Correlation] timeframe update",
            String(heatmapRes.value?.tabs?.correlation?.timeframe || corrTf),
            "updatedAt:",
            String(heatmapRes.value?.tabs?.correlation?.updatedAt || ""),
          );
        } else {
          setPayload(null);
          setError(heatmapRes.reason instanceof Error ? heatmapRes.reason.message : "Heatmap load failed");
        }
        if (assetsRes.status === "fulfilled") {
          const rows = assetsRes.value.items ?? [];
          const map: Record<string, AssetItem> = {};
          for (const row of rows) {
            map[String(row.id || "").toLowerCase()] = row;
          }
          setAssetMap(map);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setPayload(null);
          setError(err instanceof Error ? err.message : "Heatmap load failed");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [corrTf, dataSource, enabled]);

  const count = Number(payload?.count ?? payload?.assets?.length ?? 0);
  const tabs = payload?.tabs;
  const availableCategories = useMemo(() => {
    const base = new Set<string>();
    for (const row of payload?.assets ?? []) {
      const cat = String(row.category || "").trim();
      if (cat) base.add(cat);
    }
    for (const cat of CATEGORY_ORDER) {
      if (!BLOCKED_CATEGORIES.has(cat)) {
        base.add(cat);
      }
    }
    return Array.from(base);
  }, [payload?.assets]);

  useEffect(() => {
    setCorrHover(null);
  }, [corrTf, mode, payload?.tabs?.correlation?.updatedAt, activeGroup]);

  const activeCategorySet = useMemo(() => {
    const allowed = categoriesForGroup(activeGroup);
    const available = new Set(availableCategories);
    if (activeGroup === "ALL") {
      return available;
    }
    const filtered = new Set<string>();
    for (const cat of allowed) {
      if (available.has(cat)) filtered.add(cat);
    }
    return filtered.size ? filtered : available;
  }, [activeGroup, availableCategories]);
  const includesCategory = useCallback((category: string) => {
    const normalized = String(category || "");
    if (BLOCKED_CATEGORIES.has(normalized)) return false;
    return activeCategorySet.has(normalized);
  }, [activeCategorySet]);

  const valuationItems = useMemo(
    () => [...(tabs?.valuation?.items ?? [])].sort((a, b) => Number(a.score ?? 0) - Number(b.score ?? 0)),
    [tabs?.valuation?.items],
  );
  const seasonalityItems = useMemo(
    () =>
      [...(tabs?.seasonality?.items ?? [])].sort((a, b) => {
        const sb = seasonalitySignedStrength(b);
        const sa = seasonalitySignedStrength(a);
        if (sb !== sa) return sb - sa; // strongest bullish top, strongest bearish bottom
        const hb = Number(b.hitRate ?? 0);
        const ha = Number(a.hitRate ?? 0);
        if (hb !== ha) return hb - ha;
        return Number(b.expectedReturn ?? 0) - Number(a.expectedReturn ?? 0);
      }),
    [tabs?.seasonality?.items],
  );
  const supplyItems = useMemo(
    () =>
      [...(tabs?.supplyDemand?.items ?? [])].sort((a, b) => {
        const aw = a.status === "demand" ? 0 : a.status === "supply" ? 1 : 2;
        const bw = b.status === "demand" ? 0 : b.status === "supply" ? 1 : 2;
        if (aw !== bw) return aw - bw;
        return String(a.name).localeCompare(String(b.name));
      }),
    [tabs?.supplyDemand?.items],
  );
  const macroItems = useMemo(() => [...(tabs?.macro?.items ?? [])].sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0)), [tabs?.macro?.items]);
  const combinedItems = useMemo(() => [...(tabs?.combined?.items ?? [])].sort((a, b) => Number(b.aiScore ?? 0) - Number(a.aiScore ?? 0)), [tabs?.combined?.items]);
  const filteredValuationItems = useMemo(() => valuationItems.filter((row) => includesCategory(row.category)), [includesCategory, valuationItems]);
  const filteredSeasonalityItems = useMemo(() => seasonalityItems.filter((row) => includesCategory(row.category)), [includesCategory, seasonalityItems]);
  const filteredSupplyItems = useMemo(() => supplyItems.filter((row) => includesCategory(row.category)), [includesCategory, supplyItems]);
  const filteredMacroItems = useMemo(() => macroItems.filter((row) => includesCategory(row.category)), [includesCategory, macroItems]);
  const filteredCombinedItems = useMemo(() => combinedItems.filter((row) => includesCategory(row.category)), [combinedItems, includesCategory]);
  const seasonalityByAsset = useMemo(() => {
    const map: Record<string, HeatmapSeasonalityItem> = {};
    for (const row of tabs?.seasonality?.items ?? []) {
      map[String(row.assetId || "").toLowerCase()] = row;
    }
    return map;
  }, [tabs?.seasonality?.items]);
  const macroByAsset = useMemo(() => {
    const map: Record<string, HeatmapMacroItem> = {};
    for (const row of tabs?.macro?.items ?? []) {
      map[String(row.assetId || "").toLowerCase()] = row;
    }
    return map;
  }, [tabs?.macro?.items]);
  const sdByAsset = useMemo(() => {
    const map: Record<string, HeatmapSupplyDemandItem> = {};
    for (const row of tabs?.supplyDemand?.items ?? []) {
      map[String(row.assetId || "").toLowerCase()] = row;
    }
    return map;
  }, [tabs?.supplyDemand?.items]);
  const correlationIndices = useMemo(() => {
    const corr = tabs?.correlation;
    const assets = corr?.assets ?? [];
    if (!assets.length) return [] as number[];
    const out: number[] = [];
    for (let i = 0; i < assets.length; i += 1) {
      const cat = String(assets[i]?.category || "");
      if (includesCategory(cat)) out.push(i);
    }
    return out.length ? out : assets.map((_, i) => i);
  }, [includesCategory, tabs?.correlation]);

  const corrTooltip = corrHover ? `${corrHover.a} vs ${corrHover.b}: ${fmt(corrHover.value, 1)} (${corrHover.timeframe})` : "";
  const visibleCount = useMemo(() => {
    if (mode === "correlation") {
      return correlationIndices.length;
    }
    if (mode === "valuation") return filteredValuationItems.length;
    if (mode === "seasonality") return filteredSeasonalityItems.length;
    if (mode === "macro") return filteredMacroItems.length;
    if (mode === "supplyDemand") return filteredSupplyItems.length;
    return filteredCombinedItems.length;
  }, [correlationIndices.length, filteredCombinedItems.length, filteredMacroItems.length, filteredSeasonalityItems.length, filteredSupplyItems.length, filteredValuationItems.length, mode]);

  const renderCorrelation = () => {
    const corr = tabs?.correlation;
    if (!corr?.assets?.length || !corr.matrix?.length) {
      return <div className="grid h-full place-items-center text-[10px] text-slate-400">No correlation data</div>;
    }

    const keepIdx: number[] = correlationIndices;
    if (!keepIdx.length) {
      return <div className="grid h-full place-items-center text-[10px] text-slate-400">No assets selected</div>;
    }
    const assets = keepIdx.map((idx) => corr.assets[idx]);
    const matrix = keepIdx.map((i) => keepIdx.map((j) => Number(corr.matrix?.[i]?.[j] ?? (i === j ? 100 : 0))));
    const n = assets.length;
    const selectedAid = String(selectedAssetId || "").toLowerCase();
    const timeframeLabel = String(corr.timeframe || corrTf);
    const corrHeaderBg = goldThemeEnabled ? "rgba(22,18,12,0.95)" : "rgba(8,18,34,1)";
    const corrHeaderBgActive = goldThemeEnabled ? "rgba(64,49,20,0.95)" : "rgba(22,45,84,0.95)";
    const corrHeaderText = goldThemeEnabled ? "#ead7ab" : "#cfe0ff";
    const corrHeaderTextActive = goldThemeEnabled ? "#fff3d1" : "#dce8ff";
    const corrClusterBg = goldThemeEnabled ? "rgba(22,18,12,0.72)" : "rgba(8,18,34,0.72)";
    const corrClusterLine = goldThemeEnabled ? "rgba(214,178,74,0.36)" : "rgba(71,85,105,0.88)";
    const corrGridLine = goldThemeEnabled ? "rgba(214,178,74,0.22)" : "rgba(30,41,59,0.65)";
    const clusters: Array<{ name: string; start: number; end: number; count: number }> = [];
    let start = 0;
    while (start < n) {
      const cname = String(assets[start]?.category || "Other");
      let end = start + 1;
      while (end < n && String(assets[end]?.category || "Other") === cname) end += 1;
      clusters.push({ name: cname, start, end, count: end - start });
      start = end;
    }
    const boundaryAfter = new Set<number>();
    clusters.forEach((c) => {
      const idx = c.end - 1;
      if (idx >= 0 && idx < n - 1) boundaryAfter.add(idx);
    });
    const m = fitMatrix(n, matrixBox.size.w, matrixBox.size.h);
    const valueFont = Math.max(7, Math.min(10, Math.floor(Math.min(m.cellW, m.cellH) * 0.60)));
    const headFont = Math.max(7, Math.min(10, Math.floor(Math.min(m.cellW, m.headerH) * 0.58)));

    return (
      <div key={`corr-${timeframeLabel}-${String(corr.updatedAt || "")}-${keepIdx.length}`} className="flex min-h-0 flex-1 w-full flex-col gap-1 overflow-hidden">
        <div className="flex h-[16px] w-full overflow-hidden rounded border border-slate-700/55" style={{ background: corrClusterBg }}>
          {clusters.map((cluster, idx) => (
            <div
              key={`cluster-${cluster.name}-${cluster.start}`}
              className="truncate px-1 text-center text-[8px] font-semibold uppercase tracking-[0.08em] text-slate-300"
              style={{
                width: `${(cluster.count / Math.max(1, n)) * 100}%`,
                lineHeight: "14px",
                borderRight: idx < clusters.length - 1 ? `1px solid ${corrClusterLine}` : undefined,
              }}
              title={`${cluster.name} (${cluster.count})`}
            >
              {cluster.name}
            </div>
          ))}
        </div>
        <div ref={matrixBox.ref} className="relative flex min-h-0 flex-1 w-full overflow-hidden rounded border border-slate-700/55 bg-transparent">
          <div
            className="absolute inset-0"
            style={{
              display: "grid",
              gridTemplateColumns: `${m.labelW}px repeat(${n}, minmax(0, 1fr))`,
              gridTemplateRows: `${m.headerH}px repeat(${n}, minmax(0, 1fr))`,
            }}
          >
            <div className="border-b border-r border-slate-700/70 px-[2px] uppercase tracking-[0.04em] text-slate-300" style={{ background: corrHeaderBg, color: corrHeaderText, fontSize: `${headFont}px`, lineHeight: `${m.headerH - 2}px` }}>A</div>
            {assets.map((col, j) => (
              <div
                key={`col-${col.assetId}`}
                className="border-b border-r border-slate-700/70 px-[1px] text-center font-semibold text-slate-200"
                style={{
                  fontSize: `${headFont}px`,
                  lineHeight: `${Math.max(8, m.headerH - 2)}px`,
                  borderRightWidth: boundaryAfter.has(j) ? "2px" : "1px",
                  borderRightColor: boundaryAfter.has(j) ? corrClusterLine : corrGridLine,
                  color: String(col.assetId || "").toLowerCase() === selectedAid ? corrHeaderTextActive : corrHeaderText,
                  backgroundColor: String(col.assetId || "").toLowerCase() === selectedAid ? corrHeaderBgActive : corrHeaderBg,
                }}
                title={col.name}
              >
                <div className="flex items-center justify-center gap-[2px]">
                  <span className="inline-flex h-[11px] w-[11px] items-center justify-center text-[8px] leading-none">
                    {iconForRow(col, assetMap)}
                  </span>
                  <span className="truncate">{compactCode(col.assetId, col.symbol, col.name)}</span>
                </div>
              </div>
            ))}

            {assets.map((rowAsset, i) => (
              <Fragment key={`row-${rowAsset.assetId}`}>
                <div
                  key={`row-head-${rowAsset.assetId}`}
                  className="border-b border-r border-slate-700/65 px-[2px] font-semibold text-slate-200"
                  style={{
                    fontSize: `${headFont}px`,
                    lineHeight: `${Math.max(8, Math.floor(m.cellH) - 2)}px`,
                    borderBottomWidth: boundaryAfter.has(i) ? "2px" : "1px",
                    borderBottomColor: boundaryAfter.has(i) ? corrClusterLine : corrGridLine,
                    color: String(rowAsset.assetId || "").toLowerCase() === selectedAid ? corrHeaderTextActive : corrHeaderText,
                    backgroundColor: String(rowAsset.assetId || "").toLowerCase() === selectedAid ? corrHeaderBgActive : corrHeaderBg,
                  }}
                  title={rowAsset.name}
                >
                  <div className="flex items-center gap-[2px]">
                    <span className="inline-flex h-[11px] w-[11px] items-center justify-center text-[8px] leading-none">
                      {iconForRow(rowAsset, assetMap)}
                    </span>
                    <span className="truncate">{compactCode(rowAsset.assetId, rowAsset.symbol, rowAsset.name)}</span>
                  </div>
                </div>
                {assets.map((colAsset, j) => {
                  const isDiagonal = i === j;
                  const value = Number(matrix?.[i]?.[j] ?? (i === j ? 100 : 0));
                  return (
                    <div
                      key={`${rowAsset.assetId}-${colAsset.assetId}`}
                      className="cursor-default border-b border-r border-slate-800/65 text-center font-semibold text-slate-100"
                      style={{
                        backgroundColor: isDiagonal ? "transparent" : correlationCellColor(value),
                        fontSize: `${valueFont}px`,
                        lineHeight: `${Math.max(8, Math.floor(m.cellH) - 2)}px`,
                        borderRightWidth: "1px",
                        borderBottomWidth: "1px",
                        borderRightColor: corrGridLine,
                        borderBottomColor: corrGridLine,
                      }}
                      title={isDiagonal ? "" : `Asset A: ${rowAsset.name}\nAsset B: ${colAsset.name}\nCorrelation: ${fmt(value, 1)}\nTimeframe: ${timeframeLabel}`}
                      onMouseEnter={() => {
                        if (!isDiagonal) setCorrHover({ a: rowAsset.name, b: colAsset.name, value, timeframe: timeframeLabel });
                      }}
                      onMouseLeave={() => {
                        if (!isDiagonal) setCorrHover(null);
                      }}
                    >
                      {isDiagonal ? "" : fmt(value, 0)}
                    </div>
                  );
                })}
              </Fragment>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const renderValuationCard = (row: HeatmapValuationItem, compact: boolean) => {
    const tone = valuationCardStyle(Number(row.score ?? 0));
    const fallbackDrivers = {
      dollar: Number(row.val20 ?? 0) * 0.88,
      gold: Number(row.val20 ?? 0) * 0.74,
      us10y: Number(row.val20 ?? 0) * 0.62,
      combined: Number(row.score ?? 0),
    };
    const drivers = {
      dollar: Number(row.drivers?.dollar ?? fallbackDrivers.dollar),
      gold: Number(row.drivers?.gold ?? fallbackDrivers.gold),
      us10y: Number(row.drivers?.us10y ?? fallbackDrivers.us10y),
      combined: Number(row.drivers?.combined ?? fallbackDrivers.combined),
    };
    const entries = (Object.keys(VAL_DRIVER_META) as ValDriverKey[]).map((key) => ({
      key,
      ...VAL_DRIVER_META[key],
      color: key === "combined" ? accentColor : VAL_DRIVER_META[key].color,
      value: clamp(drivers[key], -100, 100),
    }));
    const dominant = String(row.dominantDriver || "").toLowerCase();
    const topKey = (entries
      .slice()
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))[0]?.key ?? "combined") as ValDriverKey;
    return (
      <div
        key={row.assetId}
        className="ivq-tile flex h-full flex-col overflow-hidden rounded px-1.5 py-1"
        style={{ backgroundColor: tone.bg, borderColor: tone.border, color: tone.text }}
        title={`Val10: ${fmt(row.val10)}\nVal20: ${fmt(row.val20)}\nDeviation: ${fmt(row.deviationPct, 2)}%`}
      >
        <div className="mb-[1px] flex items-center justify-between gap-1">
          <div className="flex min-w-0 items-center gap-1">
            {iconForRow(row, assetMap)}
            <div className="truncate text-[9px] font-semibold">{compactCode(row.assetId, row.symbol, row.name)}</div>
          </div>
          <div className="text-[10px] font-semibold">{fmt(row.score, 0)}</div>
        </div>
        {!compact && <div className="truncate text-[8px] text-slate-100/90">{row.name}</div>}
        <div className="truncate text-[7px] uppercase tracking-[0.06em] text-slate-200/80">{row.category}</div>
        <div className="mt-[3px] flex flex-1 flex-col justify-evenly gap-[3px]">
          {entries.map((entry) => {
            const active = entry.key === dominant || entry.key === topKey;
            return (
              <div key={entry.key} className={`rounded px-[4px] py-[2px] ${active ? "bg-slate-900/35" : "bg-slate-900/20"}`}>
                <div className="mb-[1px] flex items-center justify-between gap-1 text-[7px]">
                  <span style={{ color: entry.color }} className="font-semibold">
                    {entry.short}
                  </span>
                  <span className="text-slate-100">{fmt(entry.value, 0)}</span>
                </div>
                <div className="h-[4px] rounded-full bg-slate-950/45">
                  <div
                    className="h-[4px] rounded-full"
                    style={{
                      width: signedBarWidth(entry.value),
                      background: entry.color,
                      boxShadow: active ? `0 0 8px ${entry.color}80` : undefined,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderSeasonalityCard = (row: HeatmapSeasonalityItem, compact: boolean) => {
    const tone = seasonalityTone(row);
    const stroke = tone.line;
    const signed = tone.signal;
    const hit = tone.hit;
    const spark = buildSparkline(row.curve ?? []);
    return (
      <div
        key={row.assetId}
        className="ivq-tile flex h-full flex-col overflow-hidden rounded px-1.5 py-1"
        style={{ backgroundColor: tone.bg, borderColor: tone.border }}
        title={`Best Hold: ${fmt(row.bestHoldPeriod, 0)}d\nExpected Return: ${fmt(row.expectedReturn, 2)}%\nHit Rate: ${fmt(row.hitRate, 1)}%`}
      >
        <div className="mb-[1px] flex items-center justify-between gap-1">
          <div className="flex min-w-0 items-center gap-1">
            {iconForRow(row, assetMap)}
            <div className="truncate text-[9px] font-semibold text-slate-100">{compactCode(row.assetId, row.symbol, row.name)}</div>
          </div>
          <div className="text-[8px] font-semibold" style={{ color: stroke }}>{tone.direction}</div>
        </div>
        <div className={`w-full overflow-hidden rounded border border-slate-700/45 bg-[rgba(4,10,20,0.6)] ${compact ? "h-[16px]" : "h-[24px]"}`}>
          <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-full w-full">
            {spark.area ? <path d={spark.area} fill={stroke} fillOpacity={0.2} /> : null}
            {spark.line ? <path d={spark.line} fill="none" stroke={stroke} strokeWidth={1.6} /> : null}
          </svg>
        </div>
        <div className="mt-[3px] grid flex-1 grid-cols-[30px_1fr] items-center gap-2">
          <div
            className="grid h-7 w-7 place-items-center rounded-full border border-slate-200/35 text-[8px] font-semibold text-slate-100"
            style={{
              background: `conic-gradient(${stroke} ${hit}%, ${tone.ringTrack} ${hit}% 100%)`,
              boxShadow: `0 0 ${Math.round(4 + tone.intensity * 6)}px ${stroke}55`,
            }}
          >
            <span className="grid h-[18px] w-[18px] place-items-center rounded-full bg-[#06101d] text-[7px]">{hit.toFixed(0)}</span>
          </div>
          <div className="grid grid-cols-3 gap-1 text-[7px]">
            <div className="rounded bg-slate-900/35 px-[3px] py-[2px] text-slate-300">
              <div className="text-[6px] uppercase text-slate-400">Hold</div>
              <div className="font-semibold text-slate-100">{fmt(row.bestHoldPeriod, 0)}d</div>
            </div>
            <div className="rounded bg-slate-900/35 px-[3px] py-[2px] text-slate-300">
              <div className="text-[6px] uppercase text-slate-400">Exp</div>
              <div className="font-semibold" style={{ color: stroke }}>{fmt(row.expectedReturn, 2)}%</div>
            </div>
            <div className="rounded bg-slate-900/35 px-[3px] py-[2px] text-slate-300">
              <div className="text-[6px] uppercase text-slate-400">Sig</div>
              <div className="font-semibold text-slate-100">{signed >= 0 ? "Bull" : "Bear"}</div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderSupplyDemandCard = (row: HeatmapSupplyDemandItem, compact: boolean) => {
    const tone = supplyDemandCardStyle(String(row.status || "neutral"), Number(row.score ?? 0));
    return (
      <div
        key={row.assetId}
        className="ivq-tile h-full overflow-hidden rounded px-1.5 py-1 text-slate-100"
        style={{ backgroundColor: tone.bg, borderColor: tone.border }}
        title={`Distance to Demand: ${fmt(row.distanceToDemand, 3)}\nDistance to Supply: ${fmt(row.distanceToSupply, 3)}`}
      >
        <div className="mb-[1px] flex items-center justify-between gap-1">
          <div className="flex min-w-0 items-center gap-1">
            {iconForRow(row, assetMap)}
            <div className="truncate text-[9px] font-semibold">{compactCode(row.assetId, row.symbol, row.name)}</div>
          </div>
          <div className="text-[8px] uppercase tracking-[0.06em] text-slate-200">{row.status}</div>
        </div>
        {!compact && <div className="truncate text-[9px] text-slate-100">{row.name}</div>}
        <div className="mt-[2px] grid grid-cols-2 gap-1 text-[8px] text-slate-200/90">
          <div className="truncate">D: {fmt(row.distanceToDemand, 2)}</div>
          <div className="truncate">S: {fmt(row.distanceToSupply, 2)}</div>
        </div>
      </div>
    );
  };

  const renderMacroCard = (row: HeatmapMacroItem, compact: boolean) => {
    const tone = macroCardStyle(Number(row.score ?? 0));
    const score = clamp(Number(row.macroScore ?? ((Number(row.score ?? 0) + 100) / 2)), 0, 100);
    const signed = clamp(Number(row.score ?? 0), -100, 100);
    const components = row.components ?? { risk: 0, fedLiquidity: 0, cotIndex: 0, cotNet: 0 };
    const compEntries = (Object.keys(MACRO_COMPONENT_META) as Array<keyof typeof MACRO_COMPONENT_META>).map((key) => ({
      key,
      short: MACRO_COMPONENT_META[key].short,
      hintColor: key === "risk" ? accentColor : MACRO_COMPONENT_META[key].color,
      value: Number(components[key] ?? 0),
    }));
    const topComp = compEntries.slice().sort((a, b) => Math.abs(b.value) - Math.abs(a.value))[0]?.key;
    return (
      <div
        key={row.assetId}
        className="ivq-tile flex h-full flex-col overflow-hidden rounded px-1.5 py-1"
        style={{ backgroundColor: tone.bg, borderColor: tone.border, color: tone.text }}
        title={`Macro Score: ${fmt(score, 1)}\nRisk: ${fmt(components.risk, 1)}\nFed: ${fmt(components.fedLiquidity, 1)}\nCOT Index: ${fmt(components.cotIndex, 1)}\nCOT Net: ${fmt(components.cotNet, 1)}`}
      >
        <div className="mb-[1px] flex items-center justify-between gap-1">
          <div className="flex min-w-0 items-center gap-1">
            {iconForRow(row, assetMap)}
            <div className="truncate text-[9px] font-semibold">{compactCode(row.assetId, row.symbol, row.name)}</div>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[8px] font-semibold" style={{ color: tone.line }}>
              {String(row.direction || (signed >= 0 ? "LONG" : "SHORT")).toUpperCase()}
            </span>
            <div
              className="grid h-5 w-5 place-items-center rounded-full border border-slate-200/35 text-[8px] font-semibold text-slate-100"
              style={{
                background: `conic-gradient(${tone.line} ${score}%, ${tone.ringTrack} ${score}% 100%)`,
                boxShadow: `0 0 ${Math.round(4 + (Math.abs(signed) / 100) * 6)}px ${tone.line}55`,
              }}
            >
              <span className="grid h-3.5 w-3.5 place-items-center rounded-full bg-[#06101d] text-[7px]">{score.toFixed(0)}</span>
            </div>
          </div>
        </div>
        {!compact && <div className="truncate text-[8px] text-slate-100/90">{row.name}</div>}
        <div className="mt-[3px] flex flex-1 flex-col justify-evenly gap-[3px]">
          {compEntries.map((entry) => (
            <div key={entry.key} className={`rounded px-[4px] py-[2px] ${entry.key === topComp ? "bg-slate-900/35" : "bg-slate-900/20"}`}>
              <div className="mb-[1px] flex items-center justify-between text-[7px]">
                <span style={{ color: entry.hintColor }} className="font-semibold">{entry.short}</span>
                <span className="text-slate-100">{fmt(entry.value, 0)}</span>
              </div>
              <div className="h-[4px] rounded-full bg-slate-950/45">
                <div
                  className="h-[4px] rounded-full"
                  style={{
                    width: signedBarWidth(entry.value),
                    background: signedBarColor(entry.value),
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderCombinedCard = (row: HeatmapCombinedItem, compact: boolean) => {
    const tone = combinedCardStyle(Number(row.aiScore ?? 50));
    const sub = row.subscores ?? { valuation: 50, supplyDemand: 50, seasonality: 50, momentum: 50, volatility: 50 };
    const aid = String(row.assetId || "").toLowerCase();
    const macro = macroByAsset[aid];
    const season = seasonalityByAsset[aid];
    const sd = sdByAsset[aid];
    const macroScore = normalized100(Number(macro?.macroScore ?? ((Number(macro?.score ?? 0) + 100) / 2)));
    const seasonTone = season ? seasonalityTone(season) : null;
    const seasonHit = seasonTone ? seasonTone.hit : 50;
    const seasonLine = seasonTone ? seasonTone.line : "#8aa5d6";
    const seasonTrack = seasonTone ? seasonTone.ringTrack : "rgba(30,50,78,0.62)";
    const scoreBars = [
      { key: "val", label: "Val", value: normalized100(sub.valuation), color: accentColor },
      { key: "macro", label: "Macro", value: macroScore, color: signedBarColor(Number(macro?.score ?? 0)) },
      { key: "sd", label: "S/D", value: normalized100(sub.supplyDemand), color: String(sd?.status || "") === "supply" ? "#ff384c" : "#39ff40" },
      { key: "mom", label: "Mom", value: normalized100(sub.momentum), color: signedBarColor(Number(row.signed?.momentum ?? 0)) },
    ];
    return (
      <div
        key={row.assetId}
        className="ivq-tile flex h-full flex-col overflow-hidden rounded px-1.5 py-1"
        style={{ backgroundColor: tone.bg, borderColor: tone.border, color: tone.text }}
        title={`Valuation: ${fmt(sub.valuation, 1)}\nSeasonality: ${fmt(sub.seasonality, 1)}\nSupply/Demand: ${fmt(sub.supplyDemand, 1)}\nMacro: ${fmt(macroScore, 1)}\nMomentum: ${fmt(sub.momentum, 1)}\nVolatility: ${fmt(sub.volatility, 1)}`}
      >
        <div className="mb-[1px] flex items-center justify-between gap-1">
          <div className="flex min-w-0 items-center gap-1">
            {iconForRow(row, assetMap)}
            <div className="truncate text-[9px] font-semibold">{compactCode(row.assetId, row.symbol, row.name)}</div>
          </div>
          <div className="text-[10px] font-semibold">{fmt(row.aiScore, 0)}</div>
        </div>
        {!compact && <div className="truncate text-[8px] text-slate-100/90">{row.name}</div>}
        <div className="mt-[3px] grid flex-1 grid-cols-[32px_1fr] items-center gap-2">
          <div
            className="grid h-7 w-7 place-items-center rounded-full border border-slate-200/35 text-[8px] font-semibold text-slate-100"
            style={{
              background: `conic-gradient(${seasonLine} ${seasonHit}%, ${seasonTrack} ${seasonHit}% 100%)`,
              boxShadow: `0 0 8px ${seasonLine}55`,
            }}
          >
            <span className="grid h-[18px] w-[18px] place-items-center rounded-full bg-[#06101d] text-[7px]">{seasonHit.toFixed(0)}</span>
          </div>
          <div className="flex flex-col justify-evenly gap-[3px]">
            {scoreBars.map((entry) => (
              <div key={entry.key} className="rounded bg-slate-900/25 px-[4px] py-[2px]">
                <div className="mb-[1px] flex items-center justify-between text-[7px]">
                  <span className="font-semibold" style={{ color: entry.color }}>
                    {entry.label}
                  </span>
                  <span className="text-slate-100">{fmt(entry.value, 0)}</span>
                </div>
                <div className="h-[4px] rounded-full bg-slate-950/45">
                  <div className="h-[4px] rounded-full" style={{ width: valueBar(entry.value), background: entry.color }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const renderCardsNoScroll = (items: Array<HeatmapValuationItem | HeatmapSeasonalityItem | HeatmapMacroItem | HeatmapSupplyDemandItem | HeatmapCombinedItem>, modeId: HeatmapMode) => {
    if (!items.length) {
      return <div className="grid h-full place-items-center text-[10px] text-slate-400">No assets selected</div>;
    }
    const containerW = Math.max(420, cardsBox.size.w || 0);
    const containerH = Math.max(220, cardsBox.size.h || 0);
    const gap = activeGroup === "ALL" ? 14 : 18;
    const fit = fitCardsGrid(items.length, containerW, containerH, gap, activeGroup === "ALL" ? 5 : 4);
    const cols = fit.cols;
    const cardH = fit.cardH;
    const compact = fit.compact;

    return (
      <div ref={cardsBox.ref} className="flex min-h-0 flex-1 w-full overflow-hidden px-2">
        <div
          className="grid h-full w-full"
          style={{
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            gridAutoRows: `${cardH}px`,
            gap: `${gap}px`,
          }}
        >
          {items.map((row) => {
            if (modeId === "valuation") return renderValuationCard(row as HeatmapValuationItem, compact);
            if (modeId === "seasonality") return renderSeasonalityCard(row as HeatmapSeasonalityItem, compact);
            if (modeId === "macro") return renderMacroCard(row as HeatmapMacroItem, compact);
            if (modeId === "supplyDemand") return renderSupplyDemandCard(row as HeatmapSupplyDemandItem, compact);
            return renderCombinedCard(row as HeatmapCombinedItem, compact);
          })}
        </div>
      </div>
    );
  };

  const content = useMemo(() => {
    if (loading) return <div className="grid h-full place-items-center text-[10px] text-slate-400">Loading heatmap...</div>;
    if (error) return <div className="grid h-full place-items-center text-[10px] text-red-300/90">{error}</div>;
    if (!tabs) return <div className="grid h-full place-items-center text-[10px] text-slate-400">No heatmap data</div>;
    if (mode === "correlation") return renderCorrelation();
    if (mode === "valuation") return renderCardsNoScroll(filteredValuationItems, "valuation");
    if (mode === "seasonality") return renderCardsNoScroll(filteredSeasonalityItems, "seasonality");
    if (mode === "macro") return renderCardsNoScroll(filteredMacroItems, "macro");
    if (mode === "supplyDemand") return renderCardsNoScroll(filteredSupplyItems, "supplyDemand");
    return renderCardsNoScroll(filteredCombinedItems, "combined");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    loading,
    error,
    tabs,
    mode,
    corrTf,
    selectedAssetId,
    correlationIndices,
    filteredValuationItems,
    filteredSeasonalityItems,
    filteredMacroItems,
    filteredSupplyItems,
    filteredCombinedItems,
    assetMap,
    seasonalityByAsset,
    macroByAsset,
    sdByAsset,
    matrixBox.size,
    cardsBox.size,
    includesCategory,
  ]);

  const groupButtons = useMemo(() => {
    const hasFx = availableCategories.includes("FX");
    const hasRisk = availableCategories.some((c) => RISK_SET.has(c));
    const hasRoh = availableCategories.some((c) => ROHSTOFFE_SET.has(c));
    const out: HeatmapGroup[] = ["ALL"];
    if (hasRoh) out.push("ROHSTOFFE");
    if (hasFx) out.push("FX");
    if (hasRisk) out.push("RISK");
    return out;
  }, [availableCategories]);
  const activeBtnClass = goldThemeEnabled
    ? "border-[#d6b24a]/85 bg-[#d6b24a]/24 text-[#fff3d1]"
    : "border-[#2962ff]/85 bg-[#2962ff]/25 text-[#dce8ff]";
  const idleBtnClass = goldThemeEnabled
    ? "border-slate-700/70 bg-[rgba(7,13,24,0.42)] text-slate-300 hover:border-[#d6b24a]/55 hover:text-[#fff3d1]"
    : "border-slate-700/70 bg-[rgba(7,13,24,0.42)] text-slate-300 hover:border-[#2962ff]/55 hover:text-[#dce8ff]";

  return (
    <div className="glass-panel ivq-panel flex h-full min-h-0 flex-col overflow-hidden p-[18px]">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="ivq-section-label mb-0">Asset Heatmap</div>
        <div className="text-[10px] text-slate-400">
          {visibleCount}/{count} assets
          {mode === "correlation"
            ? ` | ${tabs?.correlation?.windowBars ?? 60}P | roll ${tabs?.correlation?.rollingWindow ?? 60}${tabs?.correlation?.timeframe ? ` | TF ${tabs.correlation.timeframe}` : ""}${tabs?.correlation?.updatedAt ? ` | updated ${String(tabs.correlation.updatedAt).replace("T", " ").slice(0, 16)}` : ""}`
            : ""}
        </div>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 min-[480px]:grid-cols-3 min-[769px]:grid-cols-6">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => setMode(m.id)}
            className={`rounded border px-1 py-[3px] text-[9px] font-semibold transition ${
              mode === m.id ? activeBtnClass : idleBtnClass
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {mode === "correlation" ? (
        <div className="mb-3 grid grid-cols-4 gap-2 min-[769px]:grid-cols-8">
          {CORR_TFS.map((tf) => (
            <button
              key={tf.id}
              type="button"
              onClick={() => setCorrTf(tf.id)}
              className={`rounded border px-1 py-[3px] text-[9px] font-semibold transition ${
                corrTf === tf.id ? activeBtnClass : idleBtnClass
              }`}
            >
              {tf.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="mb-3 grid grid-cols-2 gap-2 min-[769px]:grid-cols-4">
        {groupButtons.map((group) => (
          <button
            key={group}
            type="button"
            onClick={() => setActiveGroup(group)}
            className={`rounded border px-1 py-[3px] text-[9px] font-semibold transition ${
              activeGroup === group ? activeBtnClass : idleBtnClass
            }`}
          >
            {GROUP_LABEL[group]}
          </button>
        ))}
      </div>

      <div className="mb-2 min-h-[12px] text-[9px] text-slate-400">{mode === "correlation" ? corrTooltip : ""}</div>

      <div className="flex min-h-0 flex-1 overflow-hidden">{content}</div>
    </div>
  );
}







