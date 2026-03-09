import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Globe from "react-globe.gl";
import { Color, MeshPhongMaterial } from "three";

import { countryNameOf, loadWorldFeatures, polygonColor, polygonStrokeColor, volatilityTint } from "../../lib/overlay";
import type {
  AssetRegionHighlightResponse,
  CommodityRegionItem,
  CrossPairPath,
  GeoEventItem,
  GlobeCameraState,
  GlobalLiquidityRegionItem,
  GlobalRiskRegionItem,
  MarkerPoint,
  OverlayMode,
  OverlayRouteItem,
  OverlayToggleState,
  PolicyRateCountryEntry,
  ShipTrackingItem,
} from "../../types";

const DEFAULT_CAMERA: GlobeCameraState = {
  lat: 50,
  lng: 10,
  altitude: 1.95,
};
const MAX_ALTITUDE = 3.1;
const MIN_ALTITUDE = 0.32;

type Props = {
  markers: MarkerPoint[];
  selectedAssetId: string;
  selectedAssetCategory: string;
  selectedAssetLocations: Array<{ lat: number; lng: number; label: string }>;
  crossPairPath: CrossPairPath | null;
  focusAssetId: string | null;
  focusLocation: { lat: number; lng: number } | null;
  selectedOverlay: OverlayMode;
  inflationByCountry: Record<string, number>;
  policyRateByCountry: Record<string, PolicyRateCountryEntry>;
  volatilityScore: number;
  volatilityRegime: string;
  commodityRegionScores: Record<string, number>;
  commodityMode: string;
  geoEvents: GeoEventItem[];
  shipTracking: ShipTrackingItem[];
  overlayRoutes: OverlayRouteItem[];
  commodityRegions: CommodityRegionItem[];
  globalRiskRegions: GlobalRiskRegionItem[];
  globalLiquidityRegions: GlobalLiquidityRegionItem[];
  regionHighlight: AssetRegionHighlightResponse | null;
  overlayState: OverlayToggleState;
  camera: GlobeCameraState;
  autoRotateEnabled: boolean;
  autoRotateSpeed: number;
  goldThemeEnabled?: boolean;
  onCameraChange: (camera: GlobeCameraState) => void;
  onSelectAsset: (assetId: string) => void;
  onFocusHandled: () => void;
  onFocusLocationHandled: () => void;
};

function easeInOutCubic(t: number): number {
  if (t < 0.5) return 4 * t * t * t;
  return 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function toRad(v: number): number {
  return (Number(v) * Math.PI) / 180;
}

function toDeg(v: number): number {
  return (Number(v) * 180) / Math.PI;
}

function normalizeLng(v: number): number {
  let x = Number(v);
  while (x > 180) x -= 360;
  while (x < -180) x += 360;
  return x;
}

function greatCircleDistanceDeg(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const lat1 = toRad(aLat);
  const lon1 = toRad(aLng);
  const lat2 = toRad(bLat);
  const lon2 = toRad(bLng);
  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;
  const s =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(Math.max(0, s)), Math.sqrt(Math.max(0, 1 - s)));
  return toDeg(c);
}

function sphericalMidpoint(aLat: number, aLng: number, bLat: number, bLng: number): { lat: number; lng: number } {
  const lat1 = toRad(aLat);
  const lon1 = toRad(aLng);
  const lat2 = toRad(bLat);
  const lon2 = toRad(bLng);
  const x1 = Math.cos(lat1) * Math.cos(lon1);
  const y1 = Math.cos(lat1) * Math.sin(lon1);
  const z1 = Math.sin(lat1);
  const x2 = Math.cos(lat2) * Math.cos(lon2);
  const y2 = Math.cos(lat2) * Math.sin(lon2);
  const z2 = Math.sin(lat2);
  const x = x1 + x2;
  const y = y1 + y2;
  const z = z1 + z2;
  const lng = normalizeLng(toDeg(Math.atan2(y, x)));
  const hyp = Math.sqrt(x * x + y * y);
  const lat = toDeg(Math.atan2(z, hyp));
  return { lat, lng };
}

function crossPairCamera(path: CrossPairPath): GlobeCameraState {
  const fromLat = Number(path.from.lat);
  const fromLng = Number(path.from.lng);
  const toLat = Number(path.to.lat);
  const toLng = Number(path.to.lng);
  const mid = sphericalMidpoint(fromLat, fromLng, toLat, toLng);
  const dist = greatCircleDistanceDeg(fromLat, fromLng, toLat, toLng);
  const altitude = Math.max(MIN_ALTITUDE, Math.min(MAX_ALTITUDE, 0.9 + (dist / 180) * 2.0));
  return { lat: mid.lat, lng: mid.lng, altitude };
}

const FX_FLAG_CODES: Record<string, string> = {
  USD: "1f1fa-1f1f8",
  EUR: "1f1ea-1f1fa",
  JPY: "1f1ef-1f1f5",
  GBP: "1f1ec-1f1e7",
  CHF: "1f1e8-1f1ed",
  AUD: "1f1e6-1f1fa",
  CAD: "1f1e8-1f1e6",
  NZD: "1f1f3-1f1ff",
};

function twemojiUrl(code: string): string {
  return `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/${code}.svg`;
}

function featureContinent(feature: any): string {
  const p = feature?.properties ?? {};
  const raw = String(p.CONTINENT ?? p.continent ?? p.region_wb ?? p.region ?? "").trim().toLowerCase();
  if (raw.includes("north america")) return "north america";
  if (raw.includes("south america")) return "south america";
  if (raw.includes("europe")) return "europe";
  if (raw.includes("asia")) return "asia";
  if (raw.includes("africa")) return "africa";
  if (raw.includes("oceania")) return "oceania";
  return raw || "other";
}

function continentFromLatLng(lat: number, lng: number): string {
  const x = Number(lng);
  const y = Number(lat);
  if (y > 8 && x >= -170 && x <= -20) return "north america";
  if (y < 13 && x >= -90 && x <= -25) return "south america";
  if (y >= 34 && x >= -25 && x <= 50) return "europe";
  if (y > -35 && y < 36 && x > -20 && x < 55) return "africa";
  if (x > 50 && x < 180) return "asia";
  if (y < -10 && x >= 110 && x <= 180) return "oceania";
  return "other";
}

function countryFromLocationLabel(label: string): string | null {
  const raw = String(label || "");
  const t = raw.trim().toLowerCase();
  if (!t) return null;
  const m = raw.match(/\(([^)]+)\)/);
  if (m?.[1]) return String(m[1]).trim().toLowerCase();
  if (t.includes("europe") || t.includes("eurozone") || t.includes("euro area")) return "europe";
  if (t.includes("new york") || t.includes("texas") || t.includes("louisiana") || t.includes("florida") || t.includes("kansas") || t.includes("iowa") || t.includes("usa")) return "united states";
  if (t.includes("toronto") || t.includes("canada")) return "canada";
  if (t.includes("london") || t.includes("britain") || t.includes("united kingdom")) return "united kingdom";
  if (t.includes("zurich") || t.includes("switzerland")) return "switzerland";
  if (t.includes("tokyo") || t.includes("japan")) return "japan";
  if (t.includes("sydney") || t.includes("australia")) return "australia";
  if (t.includes("auckland") || t.includes("new zealand")) return "new zealand";
  if (t.includes("paris") || t.includes("france")) return "france";
  if (t.includes("berlin") || t.includes("germany")) return "germany";
  if (t.includes("frankfurt")) return "germany";
  if (t.includes("west china") || t.includes("guangzhou") || t.includes("china")) return "china";
  if (t.includes("ukraine")) return "ukraine";
  if (t.includes("south africa")) return "south africa";
  if (t.includes("mexico")) return "mexico";
  if (t.includes("chile")) return "chile";
  if (t.includes("russia")) return "russia";
  if (t.includes("sao paulo") || t.includes("recife") || t.includes("brazil")) return "brazil";
  if (t.includes("argentina")) return "argentina";
  if (t.includes("india")) return "india";
  if (t.includes("cote d'ivoire") || t.includes("ivory coast")) return "cote d'ivoire";
  return null;
}

function normalizeCountryName(value: string): string {
  const t = String(value || "").trim().toLowerCase();
  if (!t) return "";
  if (t === "united states of america" || t === "usa" || t === "u.s.a.") return "united states";
  if (t === "uk") return "united kingdom";
  if (t === "ivory coast") return "cote d'ivoire";
  if (t === "federal republic of germany" || t === "deutschland") return "germany";
  return t;
}

function withAlpha(color: string, alpha: number): string {
  const c = String(color || "").trim();
  if (!c) return `rgba(148,163,184,${alpha})`;
  if (c.startsWith("rgba(") || c.startsWith("rgb(")) return c;
  const hex = c.replace("#", "");
  if (hex.length !== 6) return c;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, alpha))})`;
}

function eventIcon(type: string): string {
  const t = String(type || "").toLowerCase();
  if (t === "conflict") return "CF";
  if (t === "wildfire") return "WF";
  if (t === "earthquake") return "EQ";
  if (t === "news_geo") return "NW";
  return "EV";
}

function overlayDetailLevel(altitude: number): 1 | 2 | 3 {
  const a = Number(altitude);
  if (a >= 2.05) return 1;
  if (a >= 1.35) return 2;
  return 3;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function riskScoreColor(score: number, alpha = 0.42): string {
  const s = Math.max(-1, Math.min(1, Number(score) || 0));
  if (s >= 0.08) {
    const a = alpha + clamp01(s) * 0.18;
    return `rgba(57,255,64,${a.toFixed(3)})`;
  }
  if (s <= -0.08) {
    const a = alpha + clamp01(Math.abs(s)) * 0.2;
    return `rgba(255,56,76,${a.toFixed(3)})`;
  }
  return `rgba(148,163,184,${alpha.toFixed(3)})`;
}

function liquidityScoreColor(score: number, alpha = 0.4): string {
  const s = Math.max(-1, Math.min(1, Number(score) || 0));
  if (s >= 0.08) {
    const a = alpha + clamp01(s) * 0.2;
    return `rgba(57,255,64,${a.toFixed(3)})`;
  }
  if (s <= -0.08) {
    const a = alpha + clamp01(Math.abs(s)) * 0.2;
    return `rgba(255,56,76,${a.toFixed(3)})`;
  }
  return `rgba(148,163,184,${alpha.toFixed(3)})`;
}

function regionBiasColor(bias: string, alpha = 0.45): string {
  const b = String(bias || "").toLowerCase();
  if (b.includes("bull")) return `rgba(57,255,64,${alpha.toFixed(3)})`;
  if (b.includes("bear")) return `rgba(255,56,76,${alpha.toFixed(3)})`;
  return `rgba(148,163,184,${alpha.toFixed(3)})`;
}

function GlobeCanvasComponent({
  markers,
  selectedAssetId,
  selectedAssetCategory,
  selectedAssetLocations,
  crossPairPath,
  focusAssetId,
  focusLocation,
  selectedOverlay,
  inflationByCountry,
  policyRateByCountry,
  volatilityScore,
  volatilityRegime,
  commodityRegionScores,
  commodityMode,
  geoEvents,
  shipTracking,
  overlayRoutes,
  commodityRegions,
  globalRiskRegions,
  globalLiquidityRegions,
  regionHighlight,
  overlayState,
  camera,
  autoRotateEnabled,
  autoRotateSpeed,
  goldThemeEnabled = false,
  onCameraChange,
  onSelectAsset,
  onFocusHandled,
  onFocusLocationHandled,
}: Props) {
  const globeRef = useRef<any>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const hasInitCamera = useRef(false);
  const animationRef = useRef<number | null>(null);
  const hoverRafRef = useRef<number | null>(null);
  const hoveredPointRef = useRef("");
  const cameraEmitMs = useRef(0);
  const isUserInteractingRef = useRef(false);
  const lastSentCameraRef = useRef<GlobeCameraState | null>(null);
  const [worldFeatures, setWorldFeatures] = useState<any[]>([]);
  const [rings, setRings] = useState<Array<{ lat: number; lng: number; color: string }>>([]);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hoveredPointId, setHoveredPointId] = useState("");
  const [activeEvent, setActiveEvent] = useState<GeoEventItem | null>(null);
  const internalCameraRef = useRef<GlobeCameraState | null>(null);
  const themePrimaryHex = goldThemeEnabled ? "#d6b24a" : "#2962ff";
  const themePrimarySoft = goldThemeEnabled ? "#c9a84a" : "#7ac8ff";
  const themeFillStrong = goldThemeEnabled ? "rgba(214,178,74,0.84)" : "rgba(41,98,255,0.86)";
  const themeFillSoft = goldThemeEnabled ? "rgba(214,178,74,0.70)" : "rgba(41,98,255,0.70)";
  const themeFillOverlay = goldThemeEnabled ? "rgba(214,178,74,0.56)" : "rgba(41,98,255,0.56)";
  const themeStrokeStrong = goldThemeEnabled ? "rgba(214,178,74,0.98)" : "rgba(96,149,255,0.98)";
  const themeUiBg = goldThemeEnabled ? "rgba(17,14,9,0.90)" : "rgba(6,12,22,0.92)";
  const themeUiBorder = goldThemeEnabled ? "rgba(214,178,74,0.55)" : "rgba(109,157,220,0.45)";
  const themeUiText = goldThemeEnabled ? "#fff2d2" : "#dfeaff";
  const themeUiSubText = goldThemeEnabled ? "#e8d5a7" : "#bcd2f5";
  const themeUiMuted = goldThemeEnabled ? "#d6be86" : "#a9bad2";
  const themeHoverBg = goldThemeEnabled ? "rgba(26,20,10,0.92)" : "rgba(12,24,40,0.9)";
  const themeHoverBorder = goldThemeEnabled ? "rgba(214,178,74,0.76)" : "rgba(127,180,255,0.75)";
  const themeDefaultBg = goldThemeEnabled ? "rgba(14,11,8,0.80)" : "rgba(6,12,22,0.76)";
  const themeDefaultBorder = goldThemeEnabled ? "rgba(214,178,74,0.46)" : "rgba(73,108,154,0.5)";
  const logoSrc = goldThemeEnabled ? "/CAPITALIFE_Logo.png" : "/invoria_logo.png";
  const logoFallbackSrc = goldThemeEnabled ? "/CAPITALIFE_Logo.png" : "/invoria_logo.png";
  const logoAlt = goldThemeEnabled ? "Capitalife" : "Invoria Quant";
  const OCEAN_TEXTURE = useMemo(
    () =>
      "data:image/svg+xml;utf8," +
      encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='2' height='2'><rect width='2' height='2' fill='${goldThemeEnabled ? "#070608" : "#081a30"}'/></svg>`),
    [goldThemeEnabled],
  );
  const rendererConfig = useMemo(
    () =>
      ({
        antialias: false,
        alpha: true,
        powerPreference: "high-performance",
      }) as const,
    [],
  );
  const detailLevel = useMemo(
    () => overlayDetailLevel(Number(camera?.altitude ?? DEFAULT_CAMERA.altitude)),
    [camera?.altitude],
  );

  const selectedCountries = useMemo(() => {
    const selectedKey = String(selectedAssetId || "").trim().toLowerCase();
    const isEuroAsset = selectedKey === "eur" || selectedKey === "euro";
    const out = new Set<string>();
    for (const loc of selectedAssetLocations ?? []) {
      const c = countryFromLocationLabel(String(loc.label || ""));
      if (c) out.add(normalizeCountryName(c));
    }
    if (isEuroAsset) {
      out.clear();
      out.add("europe");
    }
    return out;
  }, [selectedAssetId, selectedAssetLocations]);

  const selectedContinents = useMemo(() => {
    const selectedKey = String(selectedAssetId || "").trim().toLowerCase();
    const isEuroAsset = selectedKey === "eur" || selectedKey === "euro";
    const out = new Set<string>();
    for (const loc of selectedAssetLocations ?? []) {
      const cont = continentFromLatLng(Number(loc.lat), Number(loc.lng));
      if (cont && cont !== "other") out.add(cont);
    }
    if (selectedCountries.has("europe") || isEuroAsset) {
      out.clear();
      out.add("europe");
    }
    return out;
  }, [selectedAssetId, selectedAssetLocations, selectedCountries]);

  const globalRiskCountryScore = useMemo(() => {
    const out = new Map<string, number>();
    for (const row of globalRiskRegions ?? []) {
      const score = Number(row.score || 0);
      for (const c of row.countries ?? []) {
        const key = normalizeCountryName(String(c || ""));
        if (!key) continue;
        const prev = out.get(key);
        if (prev === undefined || Math.abs(score) > Math.abs(prev)) {
          out.set(key, score);
        }
      }
    }
    return out;
  }, [globalRiskRegions]);

  const globalLiquidityCountryScore = useMemo(() => {
    const out = new Map<string, number>();
    for (const row of globalLiquidityRegions ?? []) {
      const score = Number(row.score || 0);
      for (const c of row.countries ?? []) {
        const key = normalizeCountryName(String(c || ""));
        if (!key) continue;
        const prev = out.get(key);
        if (prev === undefined || Math.abs(score) > Math.abs(prev)) {
          out.set(key, score);
        }
      }
    }
    return out;
  }, [globalLiquidityRegions]);

  const regionHighlightCountries = useMemo(() => {
    const out = new Set<string>();
    for (const region of regionHighlight?.regions ?? []) {
      for (const c of region.countries ?? []) {
        const key = normalizeCountryName(String(c || ""));
        if (key) out.add(key);
      }
    }
    return out;
  }, [regionHighlight]);

  const regionOverlayPoints = useMemo<MarkerPoint[]>(() => {
    const out: MarkerPoint[] = [];
    if (overlayState.globalRiskLayer && detailLevel >= 2) {
      for (const row of globalRiskRegions ?? []) {
        const tone = Number(row.score || 0);
        const icon = tone > 0.08 ? "R+" : tone < -0.08 ? "R-" : "R0";
        const label = detailLevel === 2
          ? `${row.name} ${Math.round(tone * 100)}`
          : `${row.name} ${Math.round(tone * 100)} | infl ${Math.round(Number(row.components?.inflation || 0) * 100)} | ship ${Math.round(Number(row.components?.shipping || 0) * 100)}`;
        out.push({
          id: `risk-region:${row.id}`,
          assetId: "",
          assetIds: [],
          isCluster: false,
          name: row.name,
          shortName: detailLevel === 2 ? icon : String(row.name || "").slice(0, 12),
          category: "Risk Region",
          country: row.name,
          locationLabel: row.name,
          icon,
          color: riskScoreColor(tone, detailLevel === 2 ? 0.42 : 0.48),
          lat: Number(row.lat),
          lng: Number(row.lng),
          label,
          clusterCount: 1,
          aiScore: 50,
          macroSensitivity: "Global Macro Risk",
          kind: "region",
          regionId: String(row.id || ""),
          regionScore: tone,
          regionBias: tone > 0.08 ? "risk_on" : tone < -0.08 ? "risk_off" : "neutral",
          regionLabel: label,
          regionCountries: Array.isArray(row.countries) ? row.countries : [],
        });
      }
    }
    if (overlayState.globalLiquidityMap && detailLevel >= 2) {
      for (const row of globalLiquidityRegions ?? []) {
        const tone = Number(row.score || 0);
        const icon = tone > 0.08 ? "L+" : tone < -0.08 ? "L-" : "L0";
        const label = detailLevel === 2
          ? `${row.name} ${Math.round(tone * 100)}`
          : `${row.name} ${Math.round(tone * 100)} | CB ${Math.round(Number(row.components?.centralBankLiquidity || 0) * 100)} | USD ${Math.round(Number(row.components?.usdFundingStress || 0) * 100)}`;
        out.push({
          id: `liq-region:${row.id}`,
          assetId: "",
          assetIds: [],
          isCluster: false,
          name: row.name,
          shortName: detailLevel === 2 ? icon : String(row.name || "").slice(0, 12),
          category: "Liquidity Region",
          country: row.name,
          locationLabel: row.name,
          icon,
          color: liquidityScoreColor(tone, detailLevel === 2 ? 0.42 : 0.48),
          lat: Number(row.lat),
          lng: Number(row.lng),
          label,
          clusterCount: 1,
          aiScore: 50,
          macroSensitivity: "Global Liquidity",
          kind: "region",
          regionId: String(row.id || ""),
          regionScore: tone,
          regionBias: tone > 0.08 ? "high_liquidity" : tone < -0.08 ? "tightening" : "neutral",
          regionLabel: label,
          regionCountries: Array.isArray(row.countries) ? row.countries : [],
        });
      }
    }
    if (overlayState.regionalAssetHighlight && detailLevel >= 2 && regionHighlight?.regions?.length) {
      const bias = String(regionHighlight.bias || "neutral").toLowerCase();
      for (const row of regionHighlight.regions) {
        const label = detailLevel === 2
          ? `${row.name} ${bias === "bullish" ? "Bull" : bias === "bearish" ? "Bear" : "Neutral"}`
          : `${row.name} | ${bias} | score ${Math.round(Number(regionHighlight.score || 0) * 100)}`;
        out.push({
          id: `asset-region:${row.id}:${regionHighlight.assetId}`,
          assetId: "",
          assetIds: [],
          isCluster: false,
          name: `${row.name} (${String(regionHighlight.assetId || "").toUpperCase()})`,
          shortName: detailLevel === 2 ? "AR" : String(row.name || "").slice(0, 12),
          category: "Asset Region",
          country: row.name,
          locationLabel: row.name,
          icon: "AR",
          color: regionBiasColor(bias, detailLevel === 2 ? 0.44 : 0.5),
          lat: Number(row.lat),
          lng: Number(row.lng),
          label,
          clusterCount: 1,
          aiScore: 50,
          macroSensitivity: "Seasonality Region Bias",
          kind: "region",
          regionId: String(row.id || ""),
          regionScore: Number(regionHighlight.score || 0),
          regionBias: bias,
          regionLabel: label,
          regionCountries: Array.isArray(row.countries) ? row.countries : [],
        });
      }
    }
    return out;
  }, [
    detailLevel,
    globalLiquidityRegions,
    globalRiskRegions,
    overlayState.globalLiquidityMap,
    overlayState.globalRiskLayer,
    overlayState.regionalAssetHighlight,
    regionHighlight,
  ]);

  const crossEndpointMarkers = useMemo<MarkerPoint[]>(() => {
    if (!crossPairPath) return [];
    const baseCode = String(crossPairPath.from.code || "").toUpperCase();
    const quoteCode = String(crossPairPath.to.code || "").toUpperCase();
    const baseIconCode = FX_FLAG_CODES[baseCode];
    const quoteIconCode = FX_FLAG_CODES[quoteCode];
    return [
      {
        id: `cross-endpoint:${crossPairPath.assetId}:from`,
        assetId: crossPairPath.assetId,
        assetIds: [crossPairPath.assetId],
        isCluster: false,
        name: `${baseCode} Endpoint`,
        shortName: baseCode,
        category: "Cross Pairs",
        country: crossPairPath.from.label,
        locationLabel: crossPairPath.from.label,
        icon: baseCode,
        iconUrl: baseIconCode ? twemojiUrl(baseIconCode) : undefined,
        color: crossPairPath.color || themePrimaryHex,
        lat: Number(crossPairPath.from.lat),
        lng: Number(crossPairPath.from.lng),
        label: baseCode,
        clusterCount: 1,
        aiScore: 50,
        macroSensitivity: "FX Relative",
        isCrossEndpoint: true,
      },
      {
        id: `cross-endpoint:${crossPairPath.assetId}:to`,
        assetId: crossPairPath.assetId,
        assetIds: [crossPairPath.assetId],
        isCluster: false,
        name: `${quoteCode} Endpoint`,
        shortName: quoteCode,
        category: "Cross Pairs",
        country: crossPairPath.to.label,
        locationLabel: crossPairPath.to.label,
        icon: quoteCode,
        iconUrl: quoteIconCode ? twemojiUrl(quoteIconCode) : undefined,
        color: crossPairPath.color || themePrimaryHex,
        lat: Number(crossPairPath.to.lat),
        lng: Number(crossPairPath.to.lng),
        label: quoteCode,
        clusterCount: 1,
        aiScore: 50,
        macroSensitivity: "FX Relative",
        isCrossEndpoint: true,
      },
    ];
  }, [crossPairPath, themePrimaryHex]);

  const geoLayerEnabled = useMemo(
    () => Boolean(overlayState.conflicts || overlayState.wildfires || overlayState.earthquakes || overlayState.shippingDisruptions),
    [overlayState.conflicts, overlayState.earthquakes, overlayState.shippingDisruptions, overlayState.wildfires],
  );

  const geoEventPoints = useMemo(() => {
    if (!geoLayerEnabled) return [];
    const layerRows = Array.isArray(geoEvents) ? geoEvents : [];
    const clusterMode = detailLevel === 1;
    if (!clusterMode) {
      return layerRows.map((ev) => ({
        id: `event:${ev.id}`,
        assetId: `event:${ev.id}`,
        assetIds: [],
        isCluster: false,
        name: String(ev.label || `${ev.type} - ${ev.location}` || ev.location || ev.type || "Event"),
        shortName:
          detailLevel === 2
            ? `${String(ev.location || ev.type || "Event").slice(0, 12)} ${String(ev.severity || "").slice(0, 8)}`.trim()
            : `${String(ev.location || ev.type || "Event").slice(0, 12)} ${String(ev.timestamp || ev.date || "").slice(0, 10)}`.trim(),
        category: "Geo Event",
        country: String(ev.location || ""),
        locationLabel: String(ev.location || ""),
        icon: eventIcon(ev.type),
        iconUrl: undefined,
        color: String(ev.color || "#ff9800"),
        lat: Number(ev.lat),
        lng: Number(ev.lng),
        label: String(ev.label || `${ev.type} - ${ev.location}`),
        clusterCount: 1,
        aiScore: 50,
        macroSensitivity: "Geo Risk",
        kind: "event",
        eventType: String(ev.event_type || ev.type || "event"),
        eventDate: String(ev.date || ""),
        eventTimestamp: String(ev.timestamp || ev.date || ""),
        eventSeverity: String(ev.severity || ""),
        eventHeadline: String(ev.headline || ""),
        eventDescription: String(ev.description || ev.headline || ""),
        eventUrl: String(ev.url || ""),
        eventSentiment: String(ev.sentiment || ""),
        eventConfidence: Number(ev.confidence || 0),
      }));
    }
    const buckets = new Map<string, GeoEventItem[]>();
    for (const ev of layerRows) {
      const lat = Number(ev.lat);
      const lng = Number(ev.lng);
      const key = `${Math.round(lat / 9)}:${Math.round(lng / 9)}`;
      const list = buckets.get(key) ?? [];
      list.push(ev);
      buckets.set(key, list);
    }
    const clustered: any[] = [];
    for (const [key, list] of buckets.entries()) {
      const lat = list.reduce((a, x) => a + Number(x.lat), 0) / Math.max(1, list.length);
      const lng = list.reduce((a, x) => a + Number(x.lng), 0) / Math.max(1, list.length);
      const types = new Set(list.map((x) => String(x.type || "event")));
      clustered.push({
        id: `event-cluster:${key}`,
        assetId: `event-cluster:${key}`,
        assetIds: [],
        isCluster: list.length > 1,
        name: list.length > 1 ? `Events (${list.length})` : String(list[0]?.location || "Event"),
        shortName: list.length > 1 ? `${list.length}x` : eventIcon(String(list[0]?.type || "")),
        category: "Geo Event",
        country: "Geo",
        locationLabel: list.length > 1 ? "Clustered events" : String(list[0]?.location || ""),
        icon: list.length > 1 ? `${list.length}` : eventIcon(String(list[0]?.type || "")),
        iconUrl: undefined,
        color: list.length > 1 ? "#ff9800" : String(list[0]?.color || "#ff9800"),
        lat,
        lng,
        label: list.length > 1 ? `${list.length} events` : `${String(list[0]?.type || "")} ${String(list[0]?.severity || "")}`,
        clusterCount: list.length,
        aiScore: 50,
        macroSensitivity: "Geo Risk",
        kind: "event",
        eventType: list.length > 1 ? "cluster" : String(list[0]?.event_type || list[0]?.type || "event"),
        eventDate: String(list[0]?.date || ""),
        eventTimestamp: String(list[0]?.timestamp || list[0]?.date || ""),
        eventSeverity: list.length > 1 ? "mixed" : String(list[0]?.severity || ""),
        eventHeadline: list.length > 1 ? "" : String(list[0]?.headline || ""),
        eventDescription: list.length > 1 ? "" : String(list[0]?.description || list[0]?.headline || ""),
        eventUrl: list.length > 1 ? "" : String(list[0]?.url || ""),
        eventSentiment: list.length > 1 ? "" : String(list[0]?.sentiment || ""),
        eventConfidence: list.length > 1 ? 0 : Number(list[0]?.confidence || 0),
      });
    }
    return clustered;
  }, [detailLevel, geoEvents, geoLayerEnabled]);

  const shipPoints = useMemo(() => {
    if (!overlayState.shipTracking) return [];
    return (shipTracking ?? []).map((ship) => {
      const shipType = String(ship.shipType || "").toLowerCase();
      const icon = shipType.includes("oil") ? "OT" : "CS";
      const shortName =
        detailLevel === 1
          ? icon
          : detailLevel === 2
            ? `${icon} ${Math.round(Number(ship.speed || 0))}kt`
            : `${icon} ${Math.round(Number(ship.speed || 0))}kt ${String(ship.destination || "").slice(0, 10)}`.trim();
      return {
        id: `ship:${ship.id}`,
        assetId: `ship:${ship.id}`,
        assetIds: [],
        isCluster: false,
        name: String(ship.name || "Vessel"),
        shortName,
        category: "Ship",
        country: String(ship.destination || ""),
        locationLabel: String(ship.destination || ""),
        icon,
        iconUrl: undefined,
        color: shipType.includes("oil") ? "#7dd3fc" : "#bfdbfe",
        lat: Number(ship.lat),
        lng: Number(ship.lng),
        label: String(ship.name || "Vessel"),
        clusterCount: 1,
        aiScore: 50,
        macroSensitivity: "Shipping",
        kind: "ship",
        shipType,
        shipSpeed: Number(ship.speed || 0),
        shipHeading: Number(ship.heading || 0),
        shipDestination: String(ship.destination || ""),
      };
    });
  }, [detailLevel, overlayState.shipTracking, shipTracking]);

  const commodityPoints = useMemo(() => {
    if (!overlayState.commodityRegions) return [];
    return (commodityRegions ?? []).map((row) => {
      const shortName =
        detailLevel === 1
          ? String(row.icon || "C")
          : detailLevel === 2
            ? `${String(row.commodity || "").slice(0, 5)} ${String(row.icon || "")}`.trim()
            : `${String(row.commodity || "").slice(0, 8)} ${String(row.region || "").slice(0, 10)}`.trim();
      return {
        id: `commodity:${row.id}`,
        assetId: `commodity:${row.id}`,
        assetIds: [],
        isCluster: false,
        name: `${row.commodity} - ${row.region}`.trim(),
        shortName,
        category: "Commodity",
        country: String(row.region || ""),
        locationLabel: String(row.region || ""),
        icon: String(row.icon || "C"),
        iconUrl: undefined,
        color: "#facc15",
        lat: Number(row.lat),
        lng: Number(row.lng),
        label: String(row.commodity || "Commodity"),
        clusterCount: 1,
        aiScore: 50,
        macroSensitivity: "Commodity Supply",
        kind: "commodity",
        commodity: String(row.commodity || ""),
        commodityRegion: String(row.region || ""),
        eventDescription: String(row.description || ""),
      };
    });
  }, [commodityRegions, detailLevel, overlayState.commodityRegions]);

  const overlayArcSegments = useMemo(() => {
    if (!overlayRoutes?.length) return [];
    const out: Array<{
      id: string;
      startLat: number;
      startLng: number;
      endLat: number;
      endLng: number;
      color: string;
      altitude: number;
      label: string;
      kind: "overlay";
      dashLength: number;
      dashGap: number;
      animateTime: number;
    }> = [];
    for (const route of overlayRoutes) {
      const path = Array.isArray(route.path) ? route.path : [];
      if (path.length < 2) continue;
      const baseColor = String(route.color || "rgba(145,175,215,0.35)");
      const isOil = String(route.id || "").toLowerCase().includes("oil");
      const isContainer = String(route.id || "").toLowerCase().includes("cont");
      for (let i = 0; i < path.length - 1; i += 1) {
        const a = path[i];
        const b = path[i + 1];
        out.push({
          id: `overlay-arc:${route.id}:${i}`,
          startLat: Number(a.lat),
          startLng: Number(a.lng),
          endLat: Number(b.lat),
          endLng: Number(b.lng),
          color: baseColor,
          altitude: isOil ? 0.1 : 0.08,
          label: String(route.name || route.id || "Route"),
          kind: "overlay",
          dashLength: isOil ? 0.45 : 0.35,
          dashGap: isContainer ? 0.95 : 0.65,
          animateTime: isOil ? 1800 : 2200,
        });
      }
    }
    return out;
  }, [overlayRoutes]);

  const pointData = useMemo(
    () => [...markers, ...crossEndpointMarkers, ...geoEventPoints, ...shipPoints, ...commodityPoints, ...regionOverlayPoints],
    [markers, crossEndpointMarkers, geoEventPoints, shipPoints, commodityPoints, regionOverlayPoints],
  );

  const htmlLabelData = useMemo(() => {
    if (detailLevel === 1) {
      return pointData.filter((d: any) => d.assetId === selectedAssetId || d.isCluster || d.isCrossEndpoint || d.kind === "event" || d.kind === "ship" || d.kind === "commodity");
    }
    if (detailLevel === 2) {
      return pointData.filter((d: any) => d.assetId === selectedAssetId || d.isCrossEndpoint || !d.isCluster || d.kind === "event" || d.kind === "ship" || d.kind === "commodity" || d.kind === "region");
    }
    return pointData;
  }, [detailLevel, pointData, selectedAssetId]);

  const crossArcs = useMemo(
    () =>
      crossPairPath
        ? [
            {
              id: `arc:${crossPairPath.assetId}`,
              startLat: Number(crossPairPath.from.lat),
              startLng: Number(crossPairPath.from.lng),
              endLat: Number(crossPairPath.to.lat),
              endLng: Number(crossPairPath.to.lng),
              color: crossPairPath.color || themePrimaryHex,
              altitude: Math.max(
                0.16,
                Math.min(
                  0.58,
                  0.14 +
                    greatCircleDistanceDeg(
                      Number(crossPairPath.from.lat),
                      Number(crossPairPath.from.lng),
                      Number(crossPairPath.to.lat),
                      Number(crossPairPath.to.lng),
                    ) /
                      360,
                ),
              ),
              label: `${crossPairPath.name}`,
            },
          ]
        : [],
    [crossPairPath],
  );
  const allArcs = useMemo(
    () => [...crossArcs, ...overlayArcSegments],
    [crossArcs, overlayArcSegments],
  );

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const syncSize = () => {
      const rect = stage.getBoundingClientRect();
      setSize({ width: Math.max(1, Math.floor(rect.width)), height: Math.max(1, Math.floor(rect.height)) });
    };
    syncSize();
    const observer = new ResizeObserver(syncSize);
    observer.observe(stage);
    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    loadWorldFeatures().then((rows) => setWorldFeatures(rows));
  }, []);

  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;
    const controls = globe.controls?.();
    if (!controls) return;

    controls.autoRotate = Boolean(autoRotateEnabled);
    controls.autoRotateSpeed = Math.max(0.05, Math.min(1.2, Number(autoRotateSpeed || 0.22)));
    controls.enableDamping = true;
    controls.dampingFactor = 0.045;
    controls.rotateSpeed = 0.82;
    controls.zoomSpeed = 1.35;
    controls.minDistance = 24;
    controls.maxDistance = 900;
    controls.enablePan = false;
    controls.enableZoom = true;
    if (typeof controls.zoomToCursor === "boolean") {
      controls.zoomToCursor = true;
    }

    const syncCamera = (force = false) => {
      const now = Date.now();
      const pov = globe.pointOfView?.() ?? DEFAULT_CAMERA;
      const clampedAltitude = Math.max(MIN_ALTITUDE, Math.min(MAX_ALTITUDE, Number(pov.altitude ?? DEFAULT_CAMERA.altitude)));
      if (Math.abs(clampedAltitude - Number(pov.altitude ?? DEFAULT_CAMERA.altitude)) > 0.002) {
        globe.pointOfView?.(
          {
            lat: Number(pov.lat ?? DEFAULT_CAMERA.lat),
            lng: Number(pov.lng ?? DEFAULT_CAMERA.lng),
            altitude: clampedAltitude,
          },
          0,
        );
      }
      const nextCamera = {
        lat: Number(pov.lat ?? DEFAULT_CAMERA.lat),
        lng: Number(pov.lng ?? DEFAULT_CAMERA.lng),
        altitude: clampedAltitude,
      };
      internalCameraRef.current = nextCamera;

      const last = lastSentCameraRef.current;
      if (last) {
        const dLat = Math.abs(Number(last.lat) - nextCamera.lat);
        const dLng = Math.abs(Number(last.lng) - nextCamera.lng);
        const dAlt = Math.abs(Number(last.altitude) - nextCamera.altitude);
        if (!force && dLat < 0.2 && dLng < 0.2 && dAlt < 0.015) {
          return;
        }
      }
      if (!force && now - cameraEmitMs.current < 420) {
        return;
      }

      cameraEmitMs.current = now;
      lastSentCameraRef.current = nextCamera;
      onCameraChange(nextCamera);
    };

    const onStart = () => {
      isUserInteractingRef.current = true;
    };
    const onChange = () => {
      syncCamera(false);
    };
    const onEnd = () => {
      isUserInteractingRef.current = false;
      syncCamera(true);
    };

    controls.addEventListener("start", onStart);
    controls.addEventListener("change", onChange);
    controls.addEventListener("end", onEnd);
    return () => {
      controls.removeEventListener("start", onStart);
      controls.removeEventListener("change", onChange);
      controls.removeEventListener("end", onEnd);
    };
  }, [autoRotateEnabled, autoRotateSpeed, onCameraChange]);

  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;
    const controls = globe.controls?.();
    if (!controls) return;
    controls.autoRotate = Boolean(autoRotateEnabled);
    controls.autoRotateSpeed = Math.max(0.05, Math.min(1.2, Number(autoRotateSpeed || 0.22)));
    controls.update?.();
  }, [autoRotateEnabled, autoRotateSpeed]);

  useEffect(() => {
    if (hasInitCamera.current) return;
    const globe = globeRef.current;
    if (!globe) return;
    hasInitCamera.current = true;
    globe.pointOfView?.(camera ?? DEFAULT_CAMERA, 0);
  }, [camera]);

  useEffect(() => {
    if (!hasInitCamera.current) return;
    const globe = globeRef.current;
    if (!globe) return;
    if (isUserInteractingRef.current) return;
    const pov = globe.pointOfView?.() ?? DEFAULT_CAMERA;
    const nextAltitude = Math.max(MIN_ALTITUDE, Math.min(MAX_ALTITUDE, Number(camera.altitude ?? DEFAULT_CAMERA.altitude)));
    const dLat = Math.abs(Number(pov.lat ?? DEFAULT_CAMERA.lat) - Number(camera.lat ?? DEFAULT_CAMERA.lat));
    const dLng = Math.abs(Number(pov.lng ?? DEFAULT_CAMERA.lng) - Number(camera.lng ?? DEFAULT_CAMERA.lng));
    const dAlt = Math.abs(Number(pov.altitude ?? DEFAULT_CAMERA.altitude) - nextAltitude);
    const internal = internalCameraRef.current;
    if (internal) {
      const iLat = Math.abs(Number(internal.lat) - Number(camera.lat ?? DEFAULT_CAMERA.lat));
      const iLng = Math.abs(Number(internal.lng) - Number(camera.lng ?? DEFAULT_CAMERA.lng));
      const iAlt = Math.abs(Number(internal.altitude) - nextAltitude);
      if (iLat < 0.28 && iLng < 0.28 && iAlt < 0.02) return;
    }
    if (dLat < 0.2 && dLng < 0.2 && dAlt < 0.02) return;
    globe.pointOfView?.(
      {
        lat: Number(camera.lat ?? DEFAULT_CAMERA.lat),
        lng: Number(camera.lng ?? DEFAULT_CAMERA.lng),
        altitude: nextAltitude,
      },
      90,
    );
  }, [camera.altitude, camera.lat, camera.lng]);

  useEffect(() => {
    const globe = globeRef.current;
    if (!globe) return;

    const applyLook = () => {
      const material = globe.globeMaterial?.() as MeshPhongMaterial | undefined;
      if (material) {
        material.map = null;
        material.bumpMap = null;
        material.normalMap = null;
        material.specularMap = null;
        material.color = new Color(goldThemeEnabled ? "#1a1711" : "#0f2541");
        material.emissive = new Color(goldThemeEnabled ? "#2a2215" : "#132946");
        material.emissiveIntensity = 0.44;
        material.shininess = 0;
        material.specular = new Color("#000000");
        material.needsUpdate = true;
      }

    };

    window.setTimeout(applyLook, 0);
  }, [goldThemeEnabled]);

  useEffect(() => {
    return () => {
      if (animationRef.current != null) {
        cancelAnimationFrame(animationRef.current);
      }
      if (hoverRafRef.current != null) {
        cancelAnimationFrame(hoverRafRef.current);
      }
    };
  }, []);

  const onPointHover = useCallback((point: MarkerPoint | null) => {
    const nextId = point?.id ?? "";
    if (hoveredPointRef.current === nextId) return;
    hoveredPointRef.current = nextId;
    if (hoverRafRef.current != null) {
      cancelAnimationFrame(hoverRafRef.current);
      hoverRafRef.current = null;
    }
    hoverRafRef.current = requestAnimationFrame(() => {
      setHoveredPointId(nextId);
      hoverRafRef.current = null;
    });
  }, []);

  const tweenCamera = useCallback((target: GlobeCameraState, durationMs = 1500) => {
    const globe = globeRef.current;
    if (!globe) return;

    if (animationRef.current != null) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }

    const from = globe.pointOfView?.() ?? DEFAULT_CAMERA;
    const start = performance.now();
    const origin = {
      lat: Number(from.lat ?? DEFAULT_CAMERA.lat),
      lng: Number(from.lng ?? DEFAULT_CAMERA.lng),
      altitude: Number(from.altitude ?? DEFAULT_CAMERA.altitude),
    };

    const run = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const k = easeInOutCubic(t);
      globe.pointOfView?.(
        {
          lat: origin.lat + (target.lat - origin.lat) * k,
          lng: origin.lng + (target.lng - origin.lng) * k,
          altitude: origin.altitude + (target.altitude - origin.altitude) * k,
        },
        0,
      );
      if (t < 1) {
        animationRef.current = requestAnimationFrame(run);
      } else {
        animationRef.current = null;
      }
    };

    animationRef.current = requestAnimationFrame(run);
  }, []);

  useEffect(() => {
    if (!focusAssetId) return;
    let crossView: GlobeCameraState | null = null;
    let targetPoint =
      markers.find((m) => !m.isCluster && m.assetId === focusAssetId) ??
      markers.find((m) => m.assetIds.includes(focusAssetId));
    if (!targetPoint && crossPairPath && focusAssetId === crossPairPath.assetId) {
      crossView = crossPairCamera(crossPairPath);
      targetPoint = {
        lat: crossView.lat,
        lng: crossView.lng,
        color: String(crossPairPath.color || themePrimaryHex),
      } as MarkerPoint;
    }
    if (!targetPoint) return;

    tweenCamera(
      crossView ?? {
        lat: Number(targetPoint.lat),
        lng: Number(targetPoint.lng),
        altitude: 1.48,
      },
      1325,
    );
    setRings([{ lat: Number(targetPoint.lat), lng: Number(targetPoint.lng), color: targetPoint.color }]);
    window.setTimeout(() => setRings([]), 1800);
    onFocusHandled();
  }, [crossPairPath, focusAssetId, markers, onFocusHandled, tweenCamera]);

  useEffect(() => {
    if (!focusLocation) return;
    tweenCamera(
      {
        lat: Number(focusLocation.lat),
        lng: Number(focusLocation.lng),
        altitude: 1.55,
      },
      1225,
    );
    setRings([{ lat: Number(focusLocation.lat), lng: Number(focusLocation.lng), color: themePrimaryHex }]);
    window.setTimeout(() => setRings([]), 1600);
    onFocusLocationHandled();
  }, [focusLocation, onFocusLocationHandled, tweenCamera]);

  useEffect(() => {
    setActiveEvent(null);
  }, [selectedOverlay]);

  const onPointClick = useCallback(
    (point: any) => {
      if (!point?.id) return;
      if (point.kind === "event") {
        if (point.isCluster) {
          tweenCamera(
            {
              lat: Number(point.lat),
              lng: Number(point.lng),
              altitude: 1.55,
            },
            980,
          );
          return;
        }
        setActiveEvent({
          id: String(point.id || ""),
          type: String(point.eventType || "event"),
          date: String(point.eventDate || ""),
          timestamp: String(point.eventTimestamp || point.eventDate || ""),
          location: String(point.locationLabel || point.country || "Event"),
          severity: String(point.eventSeverity || ""),
          lat: Number(point.lat),
          lng: Number(point.lng),
          color: String(point.color || "#ff9800"),
          headline: String(point.eventHeadline || ""),
          description: String(point.eventDescription || ""),
          url: String(point.eventUrl || ""),
          sentiment: String(point.eventSentiment || ""),
          confidence: Number(point.eventConfidence || 0),
          label: String(point.label || ""),
        });
        return;
      }
      if (point.kind === "ship" || point.kind === "commodity") {
        setActiveEvent(null);
        tweenCamera(
          {
            lat: Number(point.lat),
            lng: Number(point.lng),
            altitude: point.kind === "ship" ? 1.28 : 1.35,
          },
          900,
        );
        setRings([{ lat: Number(point.lat), lng: Number(point.lng), color: String(point.color || themePrimaryHex) }]);
        window.setTimeout(() => setRings([]), 1400);
        return;
      }
      if (point.kind === "region") {
        setActiveEvent(null);
        tweenCamera(
          {
            lat: Number(point.lat),
            lng: Number(point.lng),
            altitude: detailLevel === 3 ? 1.18 : 1.35,
          },
          900,
        );
        setRings([{ lat: Number(point.lat), lng: Number(point.lng), color: String(point.color || themePrimaryHex) }]);
        window.setTimeout(() => setRings([]), 1400);
        return;
      }
      if (point.isCrossEndpoint && crossPairPath) {
        setActiveEvent(null);
        onSelectAsset(crossPairPath.assetId);
        tweenCamera(
          {
            lat: Number(point.lat),
            lng: Number(point.lng),
            altitude: 1.18,
          },
          980,
        );
        setRings([{ lat: Number(point.lat), lng: Number(point.lng), color: String(crossPairPath.color || themePrimaryHex) }]);
        window.setTimeout(() => setRings([]), 1400);
        return;
      }
      if (point.isCluster || point.assetIds.length > 1) {
        setActiveEvent(null);
        tweenCamera(
          {
            lat: Number(point.lat),
            lng: Number(point.lng),
            altitude: 1.62,
          },
          1100,
        );
        return;
      }
      setActiveEvent(null);
      onSelectAsset(point.assetId);
      tweenCamera(
        {
          lat: Number(point.lat),
          lng: Number(point.lng),
          altitude: 1.42,
        },
        1400,
      );
      setRings([{ lat: Number(point.lat), lng: Number(point.lng), color: point.color }]);
      window.setTimeout(() => setRings([]), 2000);
    },
    [crossPairPath, detailLevel, onSelectAsset, themePrimaryHex, tweenCamera],
  );

  const legend = useMemo(() => {
    const hasUnifiedOverlay =
      geoEvents.length > 0 ||
      (overlayState.globalRiskLayer && globalRiskRegions.length > 0) ||
      (overlayState.globalLiquidityMap && globalLiquidityRegions.length > 0) ||
      (overlayState.shippingDisruptions && geoEvents.some((e) => String(e.event_type || e.type || "").toLowerCase().includes("shipping_disruption"))) ||
      (overlayState.commodityStressMap && commodityRegions.some((r: any) => Number((r as any).stressScore ?? 0) > 0.1)) ||
      (overlayState.regionalAssetHighlight && Boolean(regionHighlight?.regions?.length)) ||
      (overlayState.shipTracking && shipTracking.length > 0) ||
      (overlayState.oilRoutes && overlayRoutes.some((r) => String(r.id || "").toLowerCase().includes("oil"))) ||
      (overlayState.containerTraffic && overlayRoutes.some((r) => String(r.id || "").toLowerCase().includes("cont"))) ||
      (overlayState.commodityRegions && commodityRegions.length > 0);

    if (hasUnifiedOverlay) {
      const zoomLabel = detailLevel === 1 ? "L1 Icons" : detailLevel === 2 ? "L2 Labels" : "L3 Full";
      const oilCount = overlayRoutes.filter((r) => String(r.id || "").toLowerCase().includes("oil")).length;
      const containerCount = overlayRoutes.filter((r) => String(r.id || "").toLowerCase().includes("cont")).length;
      const shippingWarnCount = geoEvents.filter((e) => String(e.event_type || e.type || "").toLowerCase().includes("shipping_disruption")).length;
      const stressCount = commodityRegions.filter((r: any) => Number((r as any).stressScore ?? 0) > 0.1).length;
      return (
        <div className="absolute bottom-2 right-2 z-10 rounded-lg border border-slate-600/55 bg-transparent px-2 py-1.5 text-[10px]">
          <div className="mb-1 font-semibold uppercase tracking-[0.12em] text-slate-200">Overlay Stack</div>
          {overlayState.globalRiskLayer ? <div className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[#9ca3af]" />Global Risk Regions: {globalRiskRegions.length}</div> : null}
          {overlayState.globalLiquidityMap ? <div className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[#5bff64]" />Global Liquidity: {globalLiquidityRegions.length}</div> : null}
          {overlayState.conflicts ? <div className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[#ff384c]" />Conflicts: {geoEvents.filter((e) => String(e.type || "").includes("conflict")).length}</div> : null}
          {overlayState.wildfires ? <div className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[#ff9800]" />Wildfires: {geoEvents.filter((e) => String(e.type || "").includes("wildfire")).length}</div> : null}
          {overlayState.earthquakes ? <div className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[#ffeb3b]" />Earthquakes: {geoEvents.filter((e) => String(e.type || "").includes("earthquake")).length}</div> : null}
          {overlayState.shippingDisruptions ? <div className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[#ffac4d]" />Shipping Warnings: {shippingWarnCount}</div> : null}
          {overlayState.shipTracking ? <div className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[#7dd3fc]" />Ships: {shipTracking.length}</div> : null}
          {overlayState.oilRoutes ? <div className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[#93c5fd]" />Oil Routes: {oilCount}</div> : null}
          {overlayState.containerTraffic ? <div className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[#bfdbfe]" />Container Routes: {containerCount}</div> : null}
          {overlayState.commodityRegions ? <div className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[#facc15]" />Commodity Regions: {commodityRegions.length}</div> : null}
          {overlayState.commodityStressMap ? <div className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[#ff7a47]" />Commodity Stress: {stressCount}</div> : null}
          {overlayState.regionalAssetHighlight ? <div className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full bg-[#6ee7b7]" />Asset Regions: {(regionHighlight?.regions ?? []).length}</div> : null}
          <div className="mt-1 border-t border-slate-700/45 pt-1 text-slate-300">Detail: {zoomLabel}</div>
        </div>
      );
    }
    if (selectedOverlay === "inflation") {
      return (
        <div className="absolute bottom-2 right-2 z-10 rounded-lg border border-slate-600/55 bg-transparent px-2 py-1.5 text-[10px]">
          <div className="mb-1 font-semibold uppercase tracking-[0.12em] text-slate-200">Inflation</div>
          <div className="flex items-center gap-1"><span className="h-2.5 w-3 rounded-sm bg-[rgba(24,46,92,0.60)]" />&lt;2%</div>
          <div className="flex items-center gap-1"><span className="h-2.5 w-3 rounded-sm bg-[rgba(76,175,80,0.60)]" />2-4%</div>
          <div className="flex items-center gap-1"><span className="h-2.5 w-3 rounded-sm bg-[rgba(255,235,59,0.60)]" />4-6%</div>
          <div className="flex items-center gap-1"><span className="h-2.5 w-3 rounded-sm bg-[rgba(255,152,0,0.60)]" />6-8%</div>
          <div className="flex items-center gap-1"><span className="h-2.5 w-3 rounded-sm bg-[rgba(255,56,76,0.60)]" />&gt;8%</div>
        </div>
      );
    }
    if (selectedOverlay === "policy_rate") {
      return (
        <div className="absolute bottom-2 right-2 z-10 rounded-lg border border-slate-600/55 bg-transparent px-2 py-1.5 text-[10px]">
          <div className="mb-1 font-semibold uppercase tracking-[0.12em] text-slate-200">Policy Rate</div>
          <div className="flex items-center gap-1"><span className="h-2.5 w-3 rounded-sm bg-[rgba(55,173,255,0.58)]" />Low Rate</div>
          <div className="flex items-center gap-1"><span className="h-2.5 w-3 rounded-sm bg-[rgba(255,115,96,0.62)]" />High Rate</div>
          <div className="mt-1.5 border-t border-slate-700/45 pt-1 text-slate-300">Up move = red glow | Down move = green glow</div>
        </div>
      );
    }
    if (selectedOverlay === "commodity_shock") {
      return (
        <div className="absolute bottom-2 right-2 z-10 rounded-lg border border-slate-600/55 bg-transparent px-2 py-1.5 text-[10px]">
          <div className="mb-1 font-semibold uppercase tracking-[0.12em] text-slate-200">Commodity Shock</div>
          <div className="flex items-center gap-1"><span className="h-2.5 w-3 rounded-sm bg-[rgba(255,149,64,0.48)]" />Moderate</div>
          <div className="flex items-center gap-1"><span className="h-2.5 w-3 rounded-sm bg-[rgba(255,149,64,0.68)]" />High</div>
          <div className="mt-1.5 border-t border-slate-700/45 pt-1 text-slate-300">Mode: {commodityMode || "Normal"}</div>
        </div>
      );
    }
    return null;
  }, [
    commodityMode,
    commodityRegions.length,
    detailLevel,
    geoEvents,
    globalLiquidityRegions.length,
    globalRiskRegions.length,
    overlayRoutes,
    overlayState.commodityStressMap,
    overlayState.commodityRegions,
    overlayState.conflicts,
    overlayState.containerTraffic,
    overlayState.earthquakes,
    overlayState.globalLiquidityMap,
    overlayState.globalRiskLayer,
    overlayState.oilRoutes,
    overlayState.regionalAssetHighlight,
    overlayState.shipTracking,
    overlayState.shippingDisruptions,
    overlayState.wildfires,
    regionHighlight?.regions,
    selectedOverlay,
    shipTracking.length,
  ]);

  return (
    <div ref={hostRef} className="relative h-full w-full overflow-hidden rounded-lg bg-transparent">
      {selectedOverlay === "volatility" && (
        <div className="pointer-events-none absolute inset-0 z-[2]" style={{ background: volatilityTint(volatilityScore) }} />
      )}
      {selectedOverlay === "volatility" && (
        <div className="absolute right-2 top-2 z-20 rounded-md border border-slate-500/50 bg-transparent px-2 py-1 text-[11px] text-slate-100">
          Vol Regime: {volatilityRegime || "Neutral"} ({Math.round(volatilityScore)})
        </div>
      )}

      <div
        ref={stageRef}
        className="absolute inset-0 z-[3]"
        style={{ filter: `drop-shadow(0 0 10px ${goldThemeEnabled ? "rgba(214,178,74,0.22)" : "rgba(190,214,255,0.2)"})` }}
      >
        <Globe
          ref={globeRef}
          animateIn={false}
          waitForGlobeReady={false}
          rendererConfig={rendererConfig as any}
          width={size.width}
          height={size.height}
          globeImageUrl={OCEAN_TEXTURE}
          backgroundColor="rgba(0,0,0,0)"
          showAtmosphere
          atmosphereColor={themePrimaryHex}
          atmosphereAltitude={0.032}
          polygonsTransitionDuration={0}
          showGraticules={false}
          pointsData={pointData}
          pointLat="lat"
          pointLng="lng"
          pointColor={(d: any) => (d.id === hoveredPointId ? themePrimaryHex : d.color)}
          pointAltitude={(d: any) => {
            if (d.kind === "event") return 0.022;
            if (d.kind === "ship") return 0.02;
            if (d.kind === "commodity") return 0.026;
            if (d.kind === "region") return 0.018;
            return d.assetId === selectedAssetId ? 0.042 : 0.028;
          }}
          pointRadius={(d: any) => {
            if (d.kind === "event") {
              if (d.id === hoveredPointId) return d.isCluster ? 0.5 : 0.46;
              return d.isCluster ? 0.43 : 0.37;
            }
            if (d.kind === "ship") {
              return d.id === hoveredPointId ? 0.44 : 0.34;
            }
            if (d.kind === "commodity") {
              return d.id === hoveredPointId ? 0.46 : 0.36;
            }
            if (d.kind === "region") {
              return d.id === hoveredPointId ? 0.42 : 0.33;
            }
            if (d.id === hoveredPointId) return d.isCluster ? 0.6 : 0.56;
            return d.isCluster ? 0.52 : d.assetId === selectedAssetId ? 0.5 : 0.43;
          }}
          pointLabel={(d: any) => {
            if (d.kind === "event") {
              const lvl = detailLevel;
              const textBlock =
                lvl === 1
                  ? `<div>Type: ${String(d.eventType || "event")}</div>`
                  : lvl === 2
                    ? `<div>Severity: ${String(d.eventSeverity || "-")}</div><div>Time: ${String(d.eventTimestamp || d.eventDate || "-").slice(0, 16)}</div>`
                    : `<div>Severity: ${String(d.eventSeverity || "-")}</div><div>Time: ${String(d.eventTimestamp || d.eventDate || "-")}</div><div style="margin-top:3px;color:${themeUiSubText};">${String(d.eventDescription || d.eventHeadline || "-")}</div>`;
              return `
                <div style="padding:6px 8px;background:${themeUiBg};border:1px solid ${themeUiBorder};border-radius:8px;font-size:11px;color:${themeUiText};">
                  <div style="font-weight:700;margin-bottom:2px;">${eventIcon(String(d.eventType || ""))} ${d.name}</div>
                  ${textBlock}
                </div>
              `;
            }
            if (d.kind === "ship") {
              return `
                <div style="padding:6px 8px;background:${themeUiBg};border:1px solid ${themeUiBorder};border-radius:8px;font-size:11px;color:${themeUiText};">
                  <div style="font-weight:700;margin-bottom:2px;">SH ${String(d.name || "Ship")}</div>
                  <div>Type: ${String(d.shipType || "-")}</div>
                  <div>Speed: ${Number(d.shipSpeed || 0).toFixed(1)} kn | Heading: ${Math.round(Number(d.shipHeading || 0))} deg</div>
                  <div style="color:${themeUiSubText};">Destination: ${String(d.shipDestination || "-")}</div>
                </div>
              `;
            }
            if (d.kind === "commodity") {
              return `
                <div style="padding:6px 8px;background:${themeUiBg};border:1px solid ${themeUiBorder};border-radius:8px;font-size:11px;color:${themeUiText};">
                  <div style="font-weight:700;margin-bottom:2px;">CM ${String(d.commodity || "Commodity")}</div>
                  <div>Region: ${String(d.commodityRegion || d.locationLabel || "-")}</div>
                  ${String(d.eventDescription || "").trim() ? `<div style="color:${themeUiSubText};">${String(d.eventDescription || "")}</div>` : ""}
                </div>
              `;
            }
            if (d.kind === "region") {
              return `
                <div style="padding:6px 8px;background:${themeUiBg};border:1px solid ${themeUiBorder};border-radius:8px;font-size:11px;color:${themeUiText};">
                  <div style="font-weight:700;margin-bottom:2px;">RG ${String(d.name || "Region")}</div>
                  <div>Bias: ${String(d.regionBias || "-")} | Score: ${Math.round(Number(d.regionScore || 0) * 100)}</div>
                  <div style="color:${themeUiSubText};">${String(d.regionLabel || "")}</div>
                </div>
              `;
            }
            const score = Number(d.aiScore ?? 50).toFixed(1);
            const iconHtml = d.iconUrl
              ? `<img src="${d.iconUrl}" alt="" style="width:12px;height:12px;object-fit:contain;display:inline-block;vertical-align:middle;margin-right:5px;" onerror="this.style.display='none';this.nextElementSibling.style.display='inline-block';" /><span style="display:none;min-width:14px;margin-right:5px;">${d.icon}</span>`
              : `<span style="display:inline-block;min-width:14px;margin-right:5px;">${d.icon}</span>`;
            return `
              <div style="padding:6px 8px;background:${themeUiBg};border:1px solid ${themeUiBorder};border-radius:8px;font-size:11px;color:${themeUiText};">
                <div style="font-weight:700;margin-bottom:2px;">${iconHtml}${d.name}</div>
                <div>AI Score: ${score}</div>
                <div style="color:${themeUiMuted}">${d.locationLabel} | ${d.category}</div>
                <div style="color:${themeUiSubText}">${d.macroSensitivity}</div>
              </div>
            `;
          }}
          htmlElementsData={htmlLabelData}
          htmlLat="lat"
          htmlLng="lng"
          htmlAltitude={() => 0.015}
          htmlElement={(d: any) => {
            const el = document.createElement("div");
            el.style.display = "flex";
            el.style.alignItems = "center";
            el.style.justifyContent = "center";
            el.style.gap = "4px";
            el.style.whiteSpace = "nowrap";
            el.style.pointerEvents = "none";
            el.style.padding = "2px 6px";
            el.style.borderRadius = "6px";
            el.style.background = d.id === hoveredPointId ? themeHoverBg : themeDefaultBg;
            el.style.border = d.id === hoveredPointId ? `1px solid ${themeHoverBorder}` : `1px solid ${themeDefaultBorder}`;
            if (d.kind === "event") {
              const icon = document.createElement("span");
              icon.innerText = d.isCluster ? `${d.clusterCount}x` : eventIcon(String(d.eventType || ""));
              icon.style.fontSize = "10px";
              icon.style.color = goldThemeEnabled ? "#ffd58a" : "#ffd287";
              icon.style.fontWeight = "700";
              el.appendChild(icon);
              if (detailLevel >= 2) {
                const tx = document.createElement("span");
                tx.innerText = d.isCluster
                  ? `${d.clusterCount} events`
                  : detailLevel === 2
                    ? `${String(d.locationLabel || d.shortName || "Event").slice(0, 12)} ${String(d.eventSeverity || "").slice(0, 6)}`.trim()
                    : `${String(d.locationLabel || d.shortName || "Event").slice(0, 14)} ${String(d.eventTimestamp || d.eventDate || "").slice(5, 16)}`.trim();
                tx.style.fontSize = "9px";
                tx.style.color = themeUiText;
                tx.style.fontWeight = "600";
                el.appendChild(tx);
              }
              return el;
            }
            if (d.kind === "ship") {
              const icon = document.createElement("span");
              icon.innerText = "SH";
              icon.style.fontSize = "10px";
              icon.style.color = "#bde8ff";
              icon.style.fontWeight = "700";
              el.appendChild(icon);
              if (detailLevel >= 2) {
                const tx = document.createElement("span");
                tx.innerText =
                  detailLevel === 2
                    ? `${String(d.shortName || "").slice(0, 14)}`
                    : `${String(d.shortName || "").slice(0, 18)} ${String(d.shipDestination || "").slice(0, 10)}`.trim();
                tx.style.fontSize = "9px";
                tx.style.color = themeUiText;
                tx.style.fontWeight = "600";
                el.appendChild(tx);
              }
              return el;
            }
            if (d.kind === "commodity") {
              const icon = document.createElement("span");
              icon.innerText = String(d.icon || "C");
              icon.style.fontSize = "10px";
              icon.style.color = "#facc15";
              icon.style.fontWeight = "700";
              el.appendChild(icon);
              if (detailLevel >= 2) {
                const tx = document.createElement("span");
                tx.innerText = detailLevel === 2
                  ? `${String(d.commodity || "").slice(0, 8)}`
                  : `${String(d.commodity || "").slice(0, 8)} ${String(d.commodityRegion || "").slice(0, 12)}`.trim();
                tx.style.fontSize = "9px";
                tx.style.color = themeUiText;
                tx.style.fontWeight = "600";
                el.appendChild(tx);
              }
              return el;
            }
            if (d.kind === "region") {
              const icon = document.createElement("span");
              icon.innerText = "RG";
              icon.style.fontSize = "10px";
              icon.style.color =
                d.regionBias === "bearish" || d.regionBias === "risk_off" || d.regionBias === "tightening"
                  ? "#ff7a86"
                  : d.regionBias === "bullish" || d.regionBias === "risk_on" || d.regionBias === "high_liquidity"
                    ? "#68ff72"
                    : "#cbd5e1";
              icon.style.fontWeight = "700";
              el.appendChild(icon);
              if (detailLevel >= 2) {
                const tx = document.createElement("span");
                tx.innerText = detailLevel === 2
                  ? `${String(d.shortName || d.country || "Region").slice(0, 14)}`
                  : `${String(d.regionLabel || d.country || "Region").slice(0, 28)}`;
                tx.style.fontSize = "9px";
                tx.style.color = themeUiText;
                tx.style.fontWeight = "600";
                el.appendChild(tx);
              }
              return el;
            }
            if (d.isCluster) {
              const tx = document.createElement("span");
              tx.innerText = `${d.clusterCount}x`;
              tx.style.fontSize = "10px";
              tx.style.color = themeUiText;
              tx.style.fontWeight = "700";
              el.appendChild(tx);
              return el;
            }
            if (d.iconUrl) {
              const img = document.createElement("img");
              img.src = d.iconUrl;
              img.alt = "";
              img.width = 12;
              img.height = 12;
              img.style.width = "12px";
              img.style.height = "12px";
              img.style.objectFit = "contain";
              img.onerror = () => {
                img.style.display = "none";
                fallback.style.display = "inline-block";
              };
              el.appendChild(img);
            }
            const fallback = document.createElement("span");
            fallback.innerText = d.icon;
            fallback.style.fontSize = "10px";
            fallback.style.color = themeUiText;
            fallback.style.display = d.iconUrl ? "none" : "inline-block";
            el.appendChild(fallback);
            const name = document.createElement("span");
            name.innerText = String(d.shortName || "").toUpperCase();
            name.style.fontSize = "9px";
            name.style.color = themeUiText;
            name.style.fontWeight = d.assetId === selectedAssetId ? "700" : "600";
            el.appendChild(name);
            return el;
          }}
          polygonsData={worldFeatures}
          polygonCapColor={(f: any) => {
            const base = polygonColor(selectedOverlay, f, inflationByCountry, policyRateByCountry, commodityRegionScores);
            const continent = featureContinent(f);
            const country = normalizeCountryName(String(countryNameOf(f) || ""));
            const riskScore = globalRiskCountryScore.get(country);
            const riskTint = overlayState.globalRiskLayer && Number.isFinite(Number(riskScore))
              ? riskScoreColor(Number(riskScore), detailLevel === 1 ? 0.2 : detailLevel === 2 ? 0.27 : 0.34)
              : null;
            const liquidityScore = globalLiquidityCountryScore.get(country);
            const liquidityTint = overlayState.globalLiquidityMap && Number.isFinite(Number(liquidityScore))
              ? liquidityScoreColor(Number(liquidityScore), detailLevel === 1 ? 0.2 : detailLevel === 2 ? 0.27 : 0.34)
              : null;
            const regionBias = String(regionHighlight?.bias || "neutral");
            const regionHit = overlayState.regionalAssetHighlight && regionHighlightCountries.has(country);
            const regionTint = regionHit
              ? regionBiasColor(regionBias, detailLevel === 1 ? 0.24 : detailLevel === 2 ? 0.3 : 0.38)
              : null;
            const countryHit = selectedCountries.has(country);
            const continentHit = selectedCountries.has("europe") && selectedContinents.has(continent);
            const selectedKey = String(selectedAssetId || "").trim().toLowerCase();
            const euroRegionHit = (selectedKey === "eur" || selectedKey === "euro") && continent === "europe";
            if (regionTint) return regionTint;
            if (countryHit || continentHit || euroRegionHit) {
              if (selectedAssetCategory === "Cross Pairs") {
                return withAlpha(String(crossPairPath?.color || themePrimaryHex), 0.72);
              }
              if (selectedKey === "eur" || selectedKey === "euro") {
                return selectedOverlay === "none" ? themeFillStrong : themeFillSoft;
              }
              return selectedOverlay === "none" ? themeFillSoft : themeFillOverlay;
            }
            if (liquidityTint && riskTint) {
              return selectedOverlay === "global_risk_layer" ? riskTint : liquidityTint;
            }
            if (liquidityTint) return liquidityTint;
            if (riskTint) return riskTint;
            if (goldThemeEnabled && selectedOverlay === "none") {
              return "rgba(116,97,54,0.32)";
            }
            return base;
          }}
          polygonSideColor={() => "rgba(0,0,0,0)"}
          polygonStrokeColor={(f: any) => {
            const continent = featureContinent(f);
            const country = normalizeCountryName(String(countryNameOf(f) || ""));
            const riskScore = globalRiskCountryScore.get(country);
            const riskStroke =
              overlayState.globalRiskLayer && Number.isFinite(Number(riskScore))
                ? (Number(riskScore) >= 0.08
                    ? "rgba(57,255,64,0.55)"
                    : Number(riskScore) <= -0.08
                      ? "rgba(255,56,76,0.58)"
                      : "rgba(148,163,184,0.46)")
                : null;
            const liquidityScore = globalLiquidityCountryScore.get(country);
            const liquidityStroke =
              overlayState.globalLiquidityMap && Number.isFinite(Number(liquidityScore))
                ? (Number(liquidityScore) >= 0.08
                    ? "rgba(57,255,64,0.58)"
                    : Number(liquidityScore) <= -0.08
                      ? "rgba(255,56,76,0.6)"
                      : "rgba(148,163,184,0.5)")
                : null;
            const regionHit = overlayState.regionalAssetHighlight && regionHighlightCountries.has(country);
            const countryHit = selectedCountries.has(country);
            const continentHit = selectedCountries.has("europe") && selectedContinents.has(continent);
            const selectedKey = String(selectedAssetId || "").trim().toLowerCase();
            const euroRegionHit = (selectedKey === "eur" || selectedKey === "euro") && continent === "europe";
            if (regionHit) {
              return String(regionHighlight?.bias || "").toLowerCase().includes("bear")
                ? "rgba(255,92,108,0.8)"
                : String(regionHighlight?.bias || "").toLowerCase().includes("bull")
                  ? "rgba(94,255,103,0.76)"
                  : "rgba(160,174,194,0.7)";
            }
            if (countryHit || continentHit || euroRegionHit) {
              return themeStrokeStrong;
            }
            if (liquidityStroke && riskStroke) {
              return selectedOverlay === "global_risk_layer" ? riskStroke : liquidityStroke;
            }
            if (liquidityStroke) return liquidityStroke;
            if (riskStroke) return riskStroke;
            if (goldThemeEnabled && selectedOverlay === "none") {
              return "rgba(214,178,74,0.58)";
            }
            return polygonStrokeColor(selectedOverlay, f, policyRateByCountry);
          }}
          polygonAltitude={detailLevel === 3 ? 0.0045 : detailLevel === 2 ? 0.0036 : 0.003}
          arcsData={allArcs}
          arcStartLat="startLat"
          arcStartLng="startLng"
          arcEndLat="endLat"
          arcEndLng="endLng"
          arcColor={(d: any) => [String(d.color || themePrimaryHex), String(d.color || themePrimaryHex)]}
          arcStroke={(d: any) => (d.kind === "overlay" ? 0.45 : 0.75)}
          arcAltitude={(d: any) => Number(d.altitude ?? 0.26)}
          arcDashLength={(d: any) => Number(d.dashLength ?? 1)}
          arcDashGap={(d: any) => Number(d.dashGap ?? 0)}
          arcDashAnimateTime={(d: any) => Number(d.animateTime ?? 0)}
          arcLabel={(d: any) => String(d.label || "")}
          ringsData={rings}
          ringColor={(d: { color: string }) => d.color || themePrimarySoft}
          ringMaxRadius={2.8}
          ringPropagationSpeed={2.8}
          ringRepeatPeriod={900}
          onPointClick={(point: MarkerPoint) => onPointClick(point)}
          onPointHover={onPointHover}
        />
      </div>

      <div className="pointer-events-none absolute bottom-2 left-2 z-20">
        <img
          src={logoSrc}
          alt={logoAlt}
          className="h-10 w-auto opacity-70"
          onError={(e) => {
            const img = e.currentTarget;
            if (!img.src.endsWith(logoFallbackSrc)) {
              img.src = logoFallbackSrc;
            }
          }}
        />
      </div>

      {activeEvent ? (
        <div className="absolute left-2 top-[78px] z-20 max-w-[260px] rounded-md border border-slate-600/55 bg-[rgba(6,12,22,0.88)] p-2 text-[10px] text-slate-100 shadow-[0_8px_30px_rgba(0,0,0,0.35)]">
          <div className="mb-0.5 flex items-center justify-between gap-2">
            <span className="font-semibold uppercase tracking-[0.08em] text-slate-200">
              {eventIcon(activeEvent.type)} {String(activeEvent.type || "event")}
            </span>
            <button
              type="button"
              onClick={() => setActiveEvent(null)}
              className={`rounded border border-slate-700/60 px-1 py-0 text-[9px] text-slate-300 transition ${goldThemeEnabled ? "hover:border-[#d6b24a]/55 hover:text-[#fff3d1]" : "hover:border-[#2962ff]/55 hover:text-[#dce8ff]"}`}
            >
              close
            </button>
          </div>
          <div className="text-slate-300">{activeEvent.location || "-"}</div>
          <div className="mt-1 grid grid-cols-[auto_1fr] gap-x-1 gap-y-0.5 text-slate-300">
            <span className="text-slate-500">Timestamp</span>
            <span>{activeEvent.timestamp || activeEvent.date || "-"}</span>
            <span className="text-slate-500">Severity</span>
            <span>{activeEvent.severity || "-"}</span>
            {String(activeEvent.sentiment || "").trim() ? (
              <>
                <span className="text-slate-500">Sentiment</span>
                <span>{activeEvent.sentiment} ({Math.max(0, Math.min(100, Number(activeEvent.confidence || 0)))}%)</span>
              </>
            ) : null}
          </div>
          {String(activeEvent.headline || "").trim() ? (
            <div className="mt-1.5 border-t border-slate-700/45 pt-1 text-slate-200">{activeEvent.headline}</div>
          ) : null}
          {String(activeEvent.description || "").trim() ? (
            <div className="mt-1 text-slate-300">{activeEvent.description}</div>
          ) : null}
          {String(activeEvent.url || "").trim() ? (
            <a
              href={String(activeEvent.url)}
              target="_blank"
              rel="noreferrer"
              className={`mt-1 inline-block text-[10px] underline underline-offset-2 ${goldThemeEnabled ? "text-[#ffd58a] decoration-[#d6b24a]/65" : "text-[#9fc2ff] decoration-[#2962ff]/65"}`}
            >
              Open source
            </a>
          ) : null}
        </div>
      ) : null}

      {legend}
    </div>
  );
}

export const GlobeCanvas = memo(GlobeCanvasComponent);
GlobeCanvas.displayName = 'GlobeCanvas';

