import { useEffect, useMemo, useState } from "react";

import { loadWorldFeatures } from "../../lib/overlay";
import type {
  AssetRegionHighlightResponse,
  CommodityRegionItem,
  GeoEventItem,
  GlobalLiquidityRegionItem,
  GlobalRiskRegionItem,
  MarkerPoint,
  OverlayMode,
  OverlayRouteItem,
  ShipTrackingItem,
} from "../../types";

type GeoFeature = {
  properties?: Record<string, unknown>;
  geometry?: {
    type?: string;
    coordinates?: any;
  };
};

type Props = {
  markers: MarkerPoint[];
  selectedAssetId: string;
  selectedAssetCategory: string;
  selectedAssetLocations: Array<{ lat: number; lng: number; label: string }>;
  crossPairColor: string | null;
  geoEvents: GeoEventItem[];
  shipTracking: ShipTrackingItem[];
  overlayRoutes: OverlayRouteItem[];
  commodityRegions: CommodityRegionItem[];
  globalRiskRegions: GlobalRiskRegionItem[];
  globalLiquidityRegions: GlobalLiquidityRegionItem[];
  regionHighlight: AssetRegionHighlightResponse | null;
  selectedOverlay: OverlayMode;
  cameraAltitude: number;
  goldThemeEnabled?: boolean;
  assetUsage: Record<string, number>;
  onSelectPoint: (point: MarkerPoint) => void;
};

const MAP_WIDTH = 1000;
const MAP_HEIGHT = 220;
const MAP_MIN_LAT = -58;
const MAP_MAX_LAT = 84;
const MAP_LAT_RANGE = MAP_MAX_LAT - MAP_MIN_LAT;

function project(lng: number, lat: number) {
  const x = ((lng + 180) / 360) * MAP_WIDTH;
  const clampedLat = Math.max(MAP_MIN_LAT, Math.min(MAP_MAX_LAT, Number(lat)));
  const y = ((MAP_MAX_LAT - clampedLat) / MAP_LAT_RANGE) * MAP_HEIGHT;
  return { x, y };
}

function ringPath(ring: number[][]): string {
  if (!ring?.length) return "";
  let d = "";
  for (let i = 0; i < ring.length; i += 1) {
    const pt = ring[i];
    if (!pt || pt.length < 2) continue;
    const { x, y } = project(Number(pt[0]), Number(pt[1]));
    d += `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)} `;
  }
  return `${d}Z`;
}

function featurePath(feature: GeoFeature): string {
  const g = feature.geometry;
  if (!g?.type || !g.coordinates) return "";
  if (g.type === "Polygon") {
    return (g.coordinates as number[][][]).map((ring) => ringPath(ring)).join(" ");
  }
  if (g.type === "MultiPolygon") {
    return (g.coordinates as number[][][][])
      .flatMap((poly) => poly.map((ring) => ringPath(ring)))
      .join(" ");
  }
  return "";
}

function featureMaxLat(feature: GeoFeature): number {
  const g = feature.geometry;
  if (!g?.type || !g.coordinates) return 90;
  const out: number[] = [];
  if (g.type === "Polygon") {
    for (const ring of g.coordinates as number[][][]) {
      for (const p of ring) {
        if (Array.isArray(p) && p.length >= 2) out.push(Number(p[1]));
      }
    }
  } else if (g.type === "MultiPolygon") {
    for (const poly of g.coordinates as number[][][][]) {
      for (const ring of poly) {
        for (const p of ring) {
          if (Array.isArray(p) && p.length >= 2) out.push(Number(p[1]));
        }
      }
    }
  }
  if (!out.length) return 90;
  return Math.max(...out);
}

function isAntarctica(feature: GeoFeature): boolean {
  const props = feature.properties ?? {};
  const probe = JSON.stringify(props).toLowerCase();
  if (probe.includes("antarctica")) return true;
  return featureMaxLat(feature) < -55;
}

function countryNameOf(feature: GeoFeature): string {
  const p = feature.properties ?? {};
  const candidates = [p.NAME, p.name, p.admin, p.sovereignt, p.NAME_EN];
  for (const c of candidates) {
    const s = String(c ?? "").trim();
    if (s) return s;
  }
  return "";
}

function featureContinent(feature: GeoFeature): string {
  const p = feature.properties ?? {};
  const raw = String(p.CONTINENT ?? p.continent ?? p.region_wb ?? p.region ?? "").trim().toLowerCase();
  if (raw.includes("north america")) return "north america";
  if (raw.includes("south america")) return "south america";
  if (raw.includes("europe")) return "europe";
  if (raw.includes("asia")) return "asia";
  if (raw.includes("africa")) return "africa";
  if (raw.includes("oceania")) return "oceania";
  return raw || "other";
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

function countryFromLocationLabel(label: string): string | null {
  const raw = String(label || "");
  const t = raw.trim().toLowerCase();
  if (!t) return null;
  const m = raw.match(/\(([^)]+)\)/);
  if (m?.[1]) return normalizeCountryName(String(m[1]).trim());
  if (t.includes("europe") || t.includes("eurozone") || t.includes("euro area")) return "europe";
  if (t.includes("new york") || t.includes("texas") || t.includes("louisiana") || t.includes("florida") || t.includes("kansas") || t.includes("iowa") || t.includes("usa")) return "united states";
  if (t.includes("toronto") || t.includes("canada")) return "canada";
  if (t.includes("london") || t.includes("britain") || t.includes("united kingdom")) return "united kingdom";
  if (t.includes("zurich") || t.includes("switzerland")) return "switzerland";
  if (t.includes("tokyo") || t.includes("japan")) return "japan";
  if (t.includes("sydney") || t.includes("australia")) return "australia";
  if (t.includes("auckland") || t.includes("new zealand")) return "new zealand";
  if (t.includes("paris") || t.includes("france")) return "france";
  if (t.includes("berlin") || t.includes("germany") || t.includes("frankfurt")) return "germany";
  if (t.includes("china")) return "china";
  if (t.includes("ukraine")) return "ukraine";
  if (t.includes("south africa")) return "south africa";
  if (t.includes("mexico")) return "mexico";
  if (t.includes("chile")) return "chile";
  if (t.includes("russia")) return "russia";
  if (t.includes("brazil") || t.includes("sao paulo") || t.includes("recife")) return "brazil";
  if (t.includes("argentina")) return "argentina";
  if (t.includes("india")) return "india";
  if (t.includes("cote d'ivoire") || t.includes("ivory coast")) return "cote d'ivoire";
  return null;
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

function categoryWeight(category: string): number {
  const c = String(category || "").toLowerCase();
  if (c.includes("major fx") || c === "fx") return 56;
  if (c.includes("metals")) return 52;
  if (c.includes("energy")) return 46;
  if (c.includes("equit")) return 44;
  if (c.includes("crypto")) return 40;
  if (c.includes("agri")) return 38;
  if (c.includes("soft")) return 36;
  if (c.includes("livestock")) return 34;
  return 30;
}

function usageWeight(point: MarkerPoint, assetUsage: Record<string, number>): number {
  const ids = (point.assetIds?.length ? point.assetIds : [point.assetId]).map((id) => String(id || "").toLowerCase());
  let best = 0;
  for (const id of ids) {
    best = Math.max(best, Number(assetUsage[id] ?? 0));
  }
  return best;
}

function detailLevelFromAltitude(altitude: number): 1 | 2 | 3 {
  const a = Number(altitude);
  if (a >= 2.05) return 1;
  if (a >= 1.35) return 2;
  return 3;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function riskScoreColor(score: number, alpha = 0.34): string {
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

function liquidityScoreColor(score: number, alpha = 0.34): string {
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

function regionBiasColor(bias: string, alpha = 0.36): string {
  const b = String(bias || "").toLowerCase();
  if (b.includes("bull")) return `rgba(57,255,64,${alpha.toFixed(3)})`;
  if (b.includes("bear")) return `rgba(255,56,76,${alpha.toFixed(3)})`;
  return `rgba(148,163,184,${alpha.toFixed(3)})`;
}

function routeSvgPath(points: Array<{ lat: number; lng: number }>): string {
  if (!Array.isArray(points) || points.length < 2) return "";
  let d = "";
  for (let i = 0; i < points.length; i += 1) {
    const row = points[i];
    const { x, y } = project(Number(row.lng), Number(row.lat));
    d += `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)} `;
  }
  return d.trim();
}

export function MiniWorldMap({
  markers,
  selectedAssetId,
  selectedAssetCategory,
  selectedAssetLocations,
  crossPairColor,
  geoEvents,
  shipTracking,
  overlayRoutes,
  commodityRegions,
  globalRiskRegions,
  globalLiquidityRegions,
  regionHighlight,
  selectedOverlay,
  cameraAltitude,
  goldThemeEnabled = false,
  assetUsage,
  onSelectPoint,
}: Props) {
  const [worldFeatures, setWorldFeatures] = useState<GeoFeature[]>([]);

  useEffect(() => {
    let cancelled = false;
    loadWorldFeatures().then((rows) => {
      if (!cancelled) setWorldFeatures((rows as GeoFeature[]) ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedCountries = useMemo(() => {
    const selectedKey = String(selectedAssetId || "").trim().toLowerCase();
    const isEuroAsset = selectedKey === "eur" || selectedKey === "euro";
    const out = new Set<string>();
    for (const loc of selectedAssetLocations ?? []) {
      const c = countryFromLocationLabel(String(loc.label || ""));
      if (c) out.add(c);
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

  const paths = useMemo(
    () =>
      worldFeatures
        .filter((f) => !isAntarctica(f))
        .map((f) => ({
          d: featurePath(f),
          country: normalizeCountryName(countryNameOf(f)),
          continent: featureContinent(f),
        }))
        .filter((row) => Boolean(row.d)),
    [worldFeatures],
  );

  const assetMarkers = useMemo(() => {
    const bucket = new Map<string, { point: MarkerPoint; left: number; top: number; score: number }>();
    const selected = String(selectedAssetId || "").toLowerCase();

    for (const point of markers) {
      const lng = Math.max(-180, Math.min(180, Number(point.lng)));
      const lat = Math.max(MAP_MIN_LAT, Math.min(MAP_MAX_LAT, Number(point.lat)));
      const u = (lng + 180) / 360;
      const v = (MAP_MAX_LAT - lat) / MAP_LAT_RANGE;
      if (u < 0 || u > 1 || v < 0 || v > 1) continue;

      const px = u * MAP_WIDTH;
      const py = v * MAP_HEIGHT;
      const cellX = Math.round(px / 30);
      const cellY = Math.round(py / 24);
      const key = `${cellX}:${cellY}`;

      const uid = String(point.assetId || "").toLowerCase();
      const score =
        (uid === selected ? 10000 : 0) +
        usageWeight(point, assetUsage) * 150 +
        categoryWeight(point.category) +
        Number(point.aiScore ?? 0) -
        (point.isCluster ? 80 : 0);

      const prev = bucket.get(key);
      if (!prev || score > prev.score) {
        bucket.set(key, {
          point,
          left: px,
          top: py,
          score,
        });
      }
    }

    // Second pass: preserve more labels by moving close markers instead of dropping them.
    const minDistPx = 22;
    const minDistSq = minDistPx * minDistPx;
    const kept: Array<{ point: MarkerPoint; left: number; top: number; score: number }> = [];
    const sorted = [...bucket.values()].sort((a, b) => b.score - a.score);
    for (const candidate of sorted) {
      let placed = { ...candidate };
      let ok = false;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const tooClose = kept.some((row) => {
          const dx = row.left - placed.left;
          const dy = row.top - placed.top;
          return dx * dx + dy * dy < minDistSq;
        });
        if (!tooClose) {
          ok = true;
          break;
        }
        const angle = (Math.PI * 2 * attempt) / 10;
        const radius = 8 + attempt * 3;
        placed = {
          ...placed,
          left: Math.max(10, Math.min(MAP_WIDTH - 10, candidate.left + Math.cos(angle) * radius)),
          top: Math.max(10, Math.min(MAP_HEIGHT - 10, candidate.top + Math.sin(angle) * radius)),
        };
      }
      if (ok) {
        kept.push(placed);
      }
    }

    return kept
      .sort((a, b) => a.score - b.score)
      .map((row) => ({
        ...row,
        leftPct: (row.left / MAP_WIDTH) * 100,
        topPct: (row.top / MAP_HEIGHT) * 100,
      }));
  }, [assetUsage, markers, selectedAssetId]);

  const overlayDetailLevel = useMemo(() => detailLevelFromAltitude(cameraAltitude), [cameraAltitude]);

  const overlayMarkers = useMemo<MarkerPoint[]>(() => {
    const out: MarkerPoint[] = [];

    for (const ev of geoEvents ?? []) {
      const evType = String(ev.event_type || ev.type || "event").toLowerCase();
      const icon = evType.includes("wild") ? "F" : evType.includes("quake") ? "Q" : "!";
      const location = String(ev.location || "Event");
      const severity = String(ev.severity || "");
      const shortName = overlayDetailLevel === 1
        ? icon
        : overlayDetailLevel === 2
          ? `${location.slice(0, 8)} ${severity}`.trim()
          : `${location.slice(0, 10)} ${severity} ${String(ev.timestamp || ev.date || "").slice(5, 10)}`.trim();
      out.push({
        id: `mm-event:${ev.id}`,
        assetId: "",
        assetIds: [],
        isCluster: false,
        name: String(ev.label || location),
        shortName,
        category: "Geo Event",
        country: location,
        locationLabel: location,
        icon,
        color: String(ev.color || "#ff9800"),
        lat: Number(ev.lat),
        lng: Number(ev.lng),
        label: String(ev.label || location),
        clusterCount: 1,
        aiScore: 50,
        macroSensitivity: "Geo Risk",
        kind: "event",
        eventType: evType,
        eventSeverity: severity,
        eventDate: String(ev.date || ""),
        eventTimestamp: String(ev.timestamp || ev.date || ""),
        eventDescription: String(ev.description || ev.headline || ""),
      });
    }

    for (const ship of shipTracking ?? []) {
      const shipType = String(ship.shipType || "").toLowerCase();
      const icon = shipType.includes("oil") ? "OT" : "CS";
      const levelText = overlayDetailLevel === 1
        ? icon
        : overlayDetailLevel === 2
          ? `${icon} ${Math.round(Number(ship.speed || 0))}kt`
          : `${icon} ${Math.round(Number(ship.speed || 0))}kt ${String(ship.destination || "").slice(0, 8)}`.trim();
      out.push({
        id: `mm-ship:${ship.id}`,
        assetId: "",
        assetIds: [],
        isCluster: false,
        name: ship.name,
        shortName: levelText,
        category: "Ship",
        country: String(ship.destination || ""),
        locationLabel: String(ship.destination || ""),
        icon,
        color: shipType.includes("oil") ? "#7dd3fc" : "#bfdbfe",
        lat: Number(ship.lat),
        lng: Number(ship.lng),
        label: ship.name,
        clusterCount: 1,
        aiScore: 50,
        macroSensitivity: "Shipping",
        kind: "ship",
        shipType,
        shipSpeed: Number(ship.speed || 0),
        shipHeading: Number(ship.heading || 0),
        shipDestination: String(ship.destination || ""),
      });
    }

    for (const region of commodityRegions ?? []) {
      const label = overlayDetailLevel === 1
        ? String(region.icon || "C")
        : overlayDetailLevel === 2
          ? `${String(region.commodity || "").slice(0, 4)} ${String(region.icon || "")}`.trim()
          : `${String(region.commodity || "").slice(0, 7)} ${String(region.region || "").slice(0, 8)}`.trim();
      out.push({
        id: `mm-commodity:${region.id}`,
        assetId: "",
        assetIds: [],
        isCluster: false,
        name: `${region.commodity} ${region.region}`.trim(),
        shortName: label,
        category: "Commodity",
        country: String(region.region || ""),
        locationLabel: String(region.region || ""),
        icon: String(region.icon || "C"),
        color: "#facc15",
        lat: Number(region.lat),
        lng: Number(region.lng),
        label: String(region.commodity || "Commodity"),
        clusterCount: 1,
        aiScore: 50,
        macroSensitivity: "Commodity Supply",
        kind: "commodity",
        commodity: String(region.commodity || ""),
        commodityRegion: String(region.region || ""),
      });
    }

    if (overlayDetailLevel >= 2) {
      for (const row of globalRiskRegions ?? []) {
        const score = Number(row.score || 0);
        out.push({
          id: `mm-risk:${row.id}`,
          assetId: "",
          assetIds: [],
          isCluster: false,
          name: row.name,
          shortName: overlayDetailLevel === 2
            ? `${row.name.slice(0, 8)} ${Math.round(score * 100)}`
            : `${row.name.slice(0, 10)} risk ${Math.round(score * 100)}`,
          category: "Risk Region",
          country: row.name,
          locationLabel: row.name,
          icon: score > 0.08 ? "R+" : score < -0.08 ? "R-" : "R0",
          color: riskScoreColor(score, overlayDetailLevel === 2 ? 0.42 : 0.48),
          lat: Number(row.lat),
          lng: Number(row.lng),
          label: row.name,
          clusterCount: 1,
          aiScore: 50,
          macroSensitivity: "Global Macro Risk",
          kind: "region",
          regionId: String(row.id || ""),
          regionScore: score,
          regionBias: score > 0.08 ? "risk_on" : score < -0.08 ? "risk_off" : "neutral",
          regionLabel: row.name,
          regionCountries: Array.isArray(row.countries) ? row.countries : [],
        });
      }

      for (const row of globalLiquidityRegions ?? []) {
        const score = Number(row.score || 0);
        out.push({
          id: `mm-liquidity:${row.id}`,
          assetId: "",
          assetIds: [],
          isCluster: false,
          name: row.name,
          shortName: overlayDetailLevel === 2
            ? `${row.name.slice(0, 8)} ${Math.round(score * 100)}`
            : `${row.name.slice(0, 10)} liq ${Math.round(score * 100)}`,
          category: "Liquidity Region",
          country: row.name,
          locationLabel: row.name,
          icon: score > 0.08 ? "L+" : score < -0.08 ? "L-" : "L0",
          color: liquidityScoreColor(score, overlayDetailLevel === 2 ? 0.42 : 0.48),
          lat: Number(row.lat),
          lng: Number(row.lng),
          label: row.name,
          clusterCount: 1,
          aiScore: 50,
          macroSensitivity: "Global Liquidity",
          kind: "region",
          regionId: String(row.id || ""),
          regionScore: score,
          regionBias: score > 0.08 ? "high_liquidity" : score < -0.08 ? "tightening" : "neutral",
          regionLabel: row.name,
          regionCountries: Array.isArray(row.countries) ? row.countries : [],
        });
      }

      const regionBias = String(regionHighlight?.bias || "neutral").toLowerCase();
      for (const row of regionHighlight?.regions ?? []) {
        out.push({
          id: `mm-asset-region:${row.id}:${regionHighlight?.assetId || ""}`,
          assetId: "",
          assetIds: [],
          isCluster: false,
          name: row.name,
          shortName: overlayDetailLevel === 2
            ? `${row.name.slice(0, 8)} ${regionBias.slice(0, 4)}`
            : `${row.name.slice(0, 10)} ${regionBias}`,
          category: "Asset Region",
          country: row.name,
          locationLabel: row.name,
          icon: "AR",
          color: regionBiasColor(regionBias, overlayDetailLevel === 2 ? 0.44 : 0.5),
          lat: Number(row.lat),
          lng: Number(row.lng),
          label: row.name,
          clusterCount: 1,
          aiScore: 50,
          macroSensitivity: "Seasonality Region Bias",
          kind: "region",
          regionId: String(row.id || ""),
          regionScore: Number(regionHighlight?.score || 0),
          regionBias,
          regionLabel: `${row.name} ${regionBias}`,
          regionCountries: Array.isArray(row.countries) ? row.countries : [],
        });
      }
    }

    return out.filter((row) => Number.isFinite(row.lat) && Number.isFinite(row.lng));
  }, [commodityRegions, geoEvents, globalLiquidityRegions, globalRiskRegions, overlayDetailLevel, regionHighlight, shipTracking]);

  const overlayRoutePaths = useMemo(
    () =>
      (overlayRoutes ?? [])
        .map((route) => ({
          id: route.id,
          d: routeSvgPath(route.path ?? []),
          color: String(route.color || "rgba(145,175,215,0.3)"),
          width: Number(route.lineWidth ?? 0.5),
        }))
        .filter((row) => Boolean(row.d)),
    [overlayRoutes],
  );

  const renderMarkers = useMemo(() => {
    const out = [...assetMarkers];
    for (const point of overlayMarkers) {
      const lng = Math.max(-180, Math.min(180, Number(point.lng)));
      const lat = Math.max(MAP_MIN_LAT, Math.min(MAP_MAX_LAT, Number(point.lat)));
      const left = ((lng + 180) / 360) * MAP_WIDTH;
      const top = ((MAP_MAX_LAT - lat) / MAP_LAT_RANGE) * MAP_HEIGHT;
      out.push({
        point,
        left,
        top,
        score: 9999,
        leftPct: (left / MAP_WIDTH) * 100,
        topPct: (top / MAP_HEIGHT) * 100,
      });
    }
    return out;
  }, [assetMarkers, overlayMarkers]);

  const themePrimaryHex = goldThemeEnabled ? "#d6b24a" : "#2962ff";
  const themePrimaryFill = goldThemeEnabled ? "rgba(214,178,74,0.68)" : "rgba(41,98,255,0.68)";
  const themeStroke = goldThemeEnabled ? "rgba(214,178,74,0.62)" : "rgba(41,98,255,0.62)";
  const themeLandBase = goldThemeEnabled ? "rgba(86,74,43,0.20)" : "rgba(52,86,136,0.22)";

  return (
    <div className="glass-panel glass-panel--flush ivq-subpanel relative h-full min-h-0 w-full overflow-hidden px-1 py-0.5">
      <svg viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`} className="absolute inset-0 h-full w-full" preserveAspectRatio="none">
        <g>
          {paths.map((row, idx) => (
            <path
              key={`p-${idx}`}
              d={row.d}
              fill={(() => {
                const regionBias = String(regionHighlight?.bias || "neutral");
                const regionHit = regionHighlightCountries.has(row.country);
                if (regionHit) {
                  return regionBiasColor(regionBias, overlayDetailLevel === 1 ? 0.22 : overlayDetailLevel === 2 ? 0.3 : 0.38);
                }
                const riskScore = globalRiskCountryScore.get(row.country);
                const liquidityScore = globalLiquidityCountryScore.get(row.country);
                if (Number.isFinite(Number(riskScore))) {
                  if (Number.isFinite(Number(liquidityScore))) {
                    return selectedOverlay === "global_risk_layer"
                      ? riskScoreColor(Number(riskScore), overlayDetailLevel === 1 ? 0.18 : overlayDetailLevel === 2 ? 0.25 : 0.33)
                      : liquidityScoreColor(Number(liquidityScore), overlayDetailLevel === 1 ? 0.18 : overlayDetailLevel === 2 ? 0.25 : 0.33);
                  }
                  return riskScoreColor(Number(riskScore), overlayDetailLevel === 1 ? 0.18 : overlayDetailLevel === 2 ? 0.25 : 0.33);
                }
                if (Number.isFinite(Number(liquidityScore))) {
                  return liquidityScoreColor(Number(liquidityScore), overlayDetailLevel === 1 ? 0.18 : overlayDetailLevel === 2 ? 0.25 : 0.33);
                }
                const countryHit = selectedCountries.has(row.country);
                const continentHit = selectedCountries.has("europe") && selectedContinents.has(row.continent);
                const selectedKey = String(selectedAssetId || "").trim().toLowerCase();
                const euroRegionHit = (selectedKey === "eur" || selectedKey === "euro") && row.continent === "europe";
                if (countryHit || continentHit || euroRegionHit) {
                  if (selectedAssetCategory === "Cross Pairs") return withAlpha(crossPairColor || themePrimaryHex, 0.72);
                  return themePrimaryFill;
                }
                return themeLandBase;
              })()}
              stroke={(() => {
                if (regionHighlightCountries.has(row.country)) {
                  return String(regionHighlight?.bias || "").toLowerCase().includes("bear")
                    ? "rgba(255,95,110,0.82)"
                    : String(regionHighlight?.bias || "").toLowerCase().includes("bull")
                      ? "rgba(103,255,114,0.78)"
                      : "rgba(160,174,194,0.72)";
                }
                const riskScore = globalRiskCountryScore.get(row.country);
                if (Number.isFinite(Number(riskScore))) {
                  const riskStroke = Number(riskScore) > 0.08
                    ? "rgba(85,255,94,0.56)"
                    : Number(riskScore) < -0.08
                      ? "rgba(255,74,94,0.58)"
                      : "rgba(148,163,184,0.48)";
                  const liquidityScore = globalLiquidityCountryScore.get(row.country);
                  if (Number.isFinite(Number(liquidityScore))) {
                    const liqStroke = Number(liquidityScore) > 0.08
                      ? "rgba(85,255,94,0.58)"
                      : Number(liquidityScore) < -0.08
                        ? "rgba(255,74,94,0.6)"
                        : "rgba(148,163,184,0.5)";
                    return selectedOverlay === "global_risk_layer" ? riskStroke : liqStroke;
                  }
                  return riskStroke;
                }
                const liquidityScore = globalLiquidityCountryScore.get(row.country);
                if (Number.isFinite(Number(liquidityScore))) {
                  return Number(liquidityScore) > 0.08
                    ? "rgba(85,255,94,0.58)"
                    : Number(liquidityScore) < -0.08
                      ? "rgba(255,74,94,0.6)"
                      : "rgba(148,163,184,0.5)";
                }
                return themeStroke;
              })()}
              strokeWidth={0.6}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </g>
        {overlayRoutePaths.length ? (
          <g>
            {overlayRoutePaths.map((row) => (
              <path
                key={`route-${row.id}`}
                d={row.d}
                fill="none"
                stroke={row.color}
                strokeWidth={Math.max(0.3, Math.min(1.2, row.width))}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>
        ) : null}
      </svg>

      <div className="absolute inset-0 z-20">
        {renderMarkers.map(({ point, leftPct, topPct }) => {
          const isSelected = point.kind !== "event" && point.kind !== "ship" && point.kind !== "commodity" && point.kind !== "region" && point.assetId === selectedAssetId;
          const title = point.kind === "event"
            ? `${point.locationLabel} | ${point.eventSeverity || ""} | ${point.eventDescription || ""}`.trim()
            : point.kind === "ship"
              ? `${point.name} | ${point.shipType || ""} | ${point.shipSpeed || 0}kt -> ${point.shipDestination || ""}`.trim()
              : point.kind === "commodity"
                ? `${point.commodity || ""} | ${point.commodityRegion || ""}`.trim()
                : point.kind === "region"
                  ? `${point.name} | ${point.regionBias || ""} | ${Math.round(Number(point.regionScore || 0) * 100)}`.trim()
                : "";
          return (
            <button
              key={`mm-${point.id}`}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onSelectPoint(point);
              }}
              className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-md px-1 py-[2px] text-[10px] leading-none shadow-[0_2px_8px_rgba(0,0,0,0.38)] transition ${
                isSelected
                  ? `${goldThemeEnabled ? "border-[#d6b24a]/90 bg-[#d6b24a]/24 text-[#fff3d1]" : "border-[#2962ff]/90 bg-[#2962ff]/28 text-[#e6eeff]"} border`
                  : `border border-slate-600/75 bg-[rgba(8,14,24,0.78)] text-slate-100 ${goldThemeEnabled ? "hover:border-[#d6b24a]/60" : "hover:border-[#2962ff]/60"}`
              }`}
              style={{ left: `${leftPct}%`, top: `${topPct}%` }}
              title={title}
            >
              <span className="inline-flex items-center gap-1">
                {point.iconUrl ? (
                  <img
                    src={point.iconUrl}
                    alt=""
                    className="h-[14px] w-[14px] object-contain"
                    onError={(event) => {
                      const img = event.currentTarget;
                      img.style.display = "none";
                      const parent = img.parentElement;
                      if (!parent) return;
                      const fallback = parent.querySelector("span[data-fallback-icon='1']") as HTMLSpanElement | null;
                      if (fallback) fallback.style.display = "inline-block";
                    }}
                  />
                ) : null}
                <span
                  data-fallback-icon="1"
                  className="text-[13px] leading-none"
                  style={{ display: point.iconUrl ? "none" : "inline-block" }}
                >
                  {point.icon}
                </span>
                {!(overlayDetailLevel === 1 && (point.kind === "event" || point.kind === "ship" || point.kind === "commodity")) ? (
                  <span className="max-w-[42px] truncate text-[9px] font-semibold uppercase tracking-[0.03em]">
                    {String(point.shortName || "").slice(0, overlayDetailLevel === 3 ? 12 : 8)}
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

