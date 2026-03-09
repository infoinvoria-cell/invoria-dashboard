import { iconTextForAsset, iconUrlForAsset, shortName } from "./icons";
import type { AssetItem, MarkerPoint } from "../types";

function clampLat(v: number): number {
  return Math.max(-85, Math.min(85, v));
}

function normLng(v: number): number {
  let x = v;
  while (x > 180) x -= 360;
  while (x < -180) x += 360;
  return x;
}

function macroSensitivity(asset: AssetItem): string {
  if (asset.category === "Cross Pairs") return "FX Relative";
  if (asset.category === "FX") return "USD / Rates";
  if (asset.category === "Metals") return "Real Yield";
  if (asset.category === "Equities" || asset.category === "Stocks") return "Risk Beta";
  if (asset.category === "Crypto") return "Liquidity";
  if (asset.category === "Energy") return "Growth / Inflation";
  if (asset.category === "Agriculture") return "Food Inflation";
  if (asset.category === "Softs") return "Supply Weather";
  if (asset.category === "Livestock") return "Feed / Demand";
  return "Macro";
}

function cellDegForAltitude(altitude: number): number {
  if (altitude >= 2.35) return 16;
  if (altitude >= 2.05) return 11;
  if (altitude >= 1.75) return 6.8;
  return 5.2;
}

const SHORT_CODE: Record<string, string> = {
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

function shortCodeForAsset(asset: AssetItem): string {
  const byId = SHORT_CODE[String(asset.id || "").toLowerCase()];
  if (byId) return byId;
  const iconText = String(iconTextForAsset(asset) || "").toUpperCase().trim();
  if (iconText) return iconText.slice(0, 8);
  const raw = String(asset.name || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return raw.slice(0, 8) || "-";
}

export function buildDisplayMarkers(
  assets: AssetItem[],
  enabledAssets: string[],
  categoryEnabled: Record<string, boolean>,
  aiScoreByAssetId: Record<string, number>,
  altitude: number,
): MarkerPoint[] {
  const enabledSet = new Set(enabledAssets);
  const rows: Array<{
    asset: AssetItem;
    markerId: string;
    lat: number;
    lng: number;
    locationLabel: string;
  }> = [];

  for (const asset of assets) {
    if (!enabledSet.has(asset.id)) continue;
    if (asset.category === "Cross Pairs") continue;
    if (asset.showOnGlobe === false) continue;
    if (categoryEnabled[asset.category] === false) continue;
    const locs = Array.isArray(asset.locations) && asset.locations.length ? asset.locations : [{ label: asset.country, lat: asset.lat, lng: asset.lng, weight: 1 }];
    locs.forEach((loc, idx) => {
      rows.push({
        asset,
        markerId: `${asset.id}:${idx}`,
        lat: Number(loc.lat),
        lng: Number(loc.lng),
        locationLabel: String(loc.label || asset.country || "Global"),
      });
    });
  }

  const cell = cellDegForAltitude(altitude);
  const buckets = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = `${Math.round(row.lat / cell)}:${Math.round(row.lng / cell)}`;
    const list = buckets.get(key) ?? [];
    list.push(row);
    buckets.set(key, list);
  }

  const out: MarkerPoint[] = [];
  for (const group of buckets.values()) {
    const uniqueAssetIds = [...new Set(group.map((g) => g.asset.id))];

    if (group.length > 1 && altitude >= 2.25) {
      const lat = group.reduce((acc, g) => acc + g.lat, 0) / group.length;
      const lng = group.reduce((acc, g) => acc + g.lng, 0) / group.length;
      out.push({
        id: `cluster:${uniqueAssetIds.join("|")}`,
        assetId: uniqueAssetIds[0] ?? "",
        assetIds: uniqueAssetIds,
        isCluster: true,
        name: `Cluster (${group.length})`,
        shortName: `${group.length}x`,
        category: "Cluster",
        country: "Mixed",
        locationLabel: "Cluster",
        icon: `${group.length}`,
        iconUrl: undefined,
        color: "#7ec7ff",
        lat: clampLat(lat),
        lng: normLng(lng),
        label: `${group.length} assets`,
        clusterCount: group.length,
        aiScore: 50,
        macroSensitivity: "Mixed",
      });
      continue;
    }

    const centerLat = group.reduce((acc, g) => acc + g.lat, 0) / group.length;
    const centerLng = group.reduce((acc, g) => acc + g.lng, 0) / group.length;
    // Spread nearby markers enough to avoid overlap while staying in-country.
    const radius = group.length > 1 ? 1.75 + Math.min(4.15, group.length * 0.66) : 0;

    group.forEach((row, idx) => {
      const angle = group.length > 1 ? (Math.PI * 2 * idx) / group.length : 0;
      const lat = clampLat(centerLat + Math.sin(angle) * radius);
      const lng = normLng(centerLng + Math.cos(angle) * radius);
      const asset = row.asset;
      const shortCode = shortCodeForAsset(asset);
      out.push({
        id: row.markerId,
        assetId: asset.id,
        assetIds: [asset.id],
        isCluster: false,
        name: asset.name,
        shortName: shortCode || shortName(asset.name, 11),
        category: asset.category,
        country: asset.country,
        locationLabel: row.locationLabel,
        icon: iconTextForAsset(asset),
        iconUrl: iconUrlForAsset(asset),
        color: asset.color,
        lat,
        lng,
        label: `${iconTextForAsset(asset)} ${shortCode || shortName(asset.name, 10)}`,
        clusterCount: group.length,
        aiScore: Number(aiScoreByAssetId[asset.id] ?? 50),
        macroSensitivity: macroSensitivity(asset),
      });
    });
  }

  return out;
}
