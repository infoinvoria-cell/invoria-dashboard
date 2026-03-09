import type { PolicyRateCountryEntry, OverlayMode } from "../types";

type GeoFeature = {
  properties?: Record<string, unknown>;
};

let worldFeaturesPromise: Promise<GeoFeature[]> | null = null;

const REGION_KEY_MAP: Record<string, string> = {
  europe: "Europe",
  asia: "Asia",
  africa: "Africa",
  oceania: "Asia",
  antarctica: "Asia",
  "north america": "North America",
  "south america": "South America",
  "middle east": "Middle East",
};

const MIDDLE_EAST_COUNTRIES = new Set([
  "saudi arabia",
  "united arab emirates",
  "uae",
  "qatar",
  "kuwait",
  "iran",
  "iraq",
  "israel",
  "oman",
  "yemen",
  "jordan",
  "bahrain",
  "syria",
  "lebanon",
]);

const EASTERN_EUROPE_COUNTRIES = new Set([
  "ukraine",
  "poland",
  "romania",
  "hungary",
  "slovakia",
  "czechia",
  "czech republic",
  "bulgaria",
  "belarus",
  "moldova",
  "lithuania",
  "latvia",
  "estonia",
]);

const COUNTRY_ALIASES: Record<string, string[]> = {
  "united states of america": ["United States"],
  "united kingdom": ["United Kingdom", "UK"],
  "cote d'ivoire": ["Cote d'Ivoire", "Ivory Coast"],
  "czechia": ["Czech Republic"],
};

const MAJOR_BUCKETS = new Set([
  "United States",
  "Europe",
  "Japan",
  "United Kingdom",
  "Switzerland",
  "Australia",
  "Canada",
  "New Zealand",
]);

function str(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeName(value: unknown): string {
  return str(value).toLowerCase();
}

function normalizeMapValue<T>(table: Record<string, T>, country: string): T | undefined {
  if (!country) return undefined;
  if (country in table) return table[country];
  const norm = normalizeName(country);
  for (const [key, value] of Object.entries(table)) {
    if (normalizeName(key) === norm) return value;
  }
  const aliases = COUNTRY_ALIASES[norm] ?? [];
  for (const alias of aliases) {
    const direct = table[alias];
    if (direct !== undefined) return direct;
    const aliasNorm = normalizeName(alias);
    for (const [key, value] of Object.entries(table)) {
      if (normalizeName(key) === aliasNorm) return value;
    }
  }
  return undefined;
}

function continentOf(feature: GeoFeature): string {
  const p = feature.properties ?? {};
  const candidates = [p.CONTINENT, p.continent, p.region, p.region_un, p.region_wb];
  for (const c of candidates) {
    const key = normalizeName(c);
    if (REGION_KEY_MAP[key]) {
      return REGION_KEY_MAP[key];
    }
  }
  const region = str(p.region_wb);
  if (region) {
    return REGION_KEY_MAP[normalizeName(region)] ?? region;
  }
  return "Europe";
}

export function countryNameOf(feature: GeoFeature): string {
  const p = feature.properties ?? {};
  const candidates = [p.NAME, p.name, p.admin, p.sovereignt, p.NAME_EN];
  for (const c of candidates) {
    const out = str(c);
    if (out) {
      return out;
    }
  }
  return "";
}

export function inflationColor(v: number | undefined): string {
  if (v == null || Number.isNaN(v)) return "rgba(56, 80, 110, 0.20)";
  if (v < 2) return "rgba(24, 46, 92, 0.62)";
  if (v < 4) return "rgba(76, 175, 80, 0.60)";
  if (v < 6) return "rgba(255, 235, 59, 0.60)";
  if (v < 8) return "rgba(255, 152, 0, 0.62)";
  return "rgba(255, 56, 76, 0.64)";
}

export function policyRateColor(rate: number | undefined): string {
  if (rate == null || Number.isNaN(rate)) return "rgba(56, 80, 110, 0.20)";
  const r = Math.max(0, Math.min(12, Number(rate)));
  const t = r / 12;
  const red = Math.round(46 + t * 200);
  const green = Math.round(98 + (1 - t) * 75);
  const blue = Math.round(255 - t * 210);
  return `rgba(${red}, ${green}, ${blue}, 0.58)`;
}

export function policyRateStroke(move: string | undefined): string {
  const m = String(move || "hold").toLowerCase();
  if (m === "up") return "rgba(255,56,76,0.84)";
  if (m === "down") return "rgba(57,255,64,0.84)";
  return "rgba(41,98,255,0.56)";
}

function commodityRegionOf(feature: GeoFeature): string {
  const major = majorBucketOf(feature);
  if (major) return major;
  const country = normalizeName(countryNameOf(feature));
  if (country === "chile") return "Chile";
  if (MIDDLE_EAST_COUNTRIES.has(country)) return "Middle East";
  if (EASTERN_EUROPE_COUNTRIES.has(country)) return "Eastern Europe";
  const continent = continentOf(feature);
  if (continent === "Europe") return "Europe";
  return continent;
}

function majorBucketOf(feature: GeoFeature): string {
  const country = normalizeName(countryNameOf(feature));
  if (country === "united states" || country === "united states of america" || country === "usa") return "United States";
  if (country === "japan") return "Japan";
  if (country === "united kingdom" || country === "uk") return "United Kingdom";
  if (country === "switzerland") return "Switzerland";
  if (country === "australia") return "Australia";
  if (country === "canada") return "Canada";
  if (country === "new zealand") return "New Zealand";
  const continent = continentOf(feature);
  if (continent === "Europe") return "Europe";
  return "";
}

function commodityColor(value: number | undefined): string {
  if (value == null || Number.isNaN(value) || Number(value) <= 0) return "rgba(52, 86, 136, 0.24)";
  const v = Math.max(0, Math.min(1, Number(value)));
  const alpha = 0.45 + v * 0.22;
  return `rgba(255, 149, 64, ${alpha.toFixed(3)})`;
}

export function polygonColor(
  mode: OverlayMode,
  feature: GeoFeature,
  inflationByCountry: Record<string, number>,
  policyRateByCountry: Record<string, PolicyRateCountryEntry>,
  commodityByRegion: Record<string, number>,
  goldThemeEnabled = false,
): string {
  const defaultBlue = "rgba(52, 86, 136, 0.24)";
  const defaultGold = "rgba(116,97,54,0.32)";
  if (mode === "none" || mode === "volatility") {
    return goldThemeEnabled ? defaultGold : defaultBlue;
  }
  if (mode === "inflation") {
    const bucket = majorBucketOf(feature);
    if (!bucket || !MAJOR_BUCKETS.has(bucket)) return goldThemeEnabled ? defaultGold : defaultBlue;
    const value = normalizeMapValue(inflationByCountry, bucket);
    return inflationColor(value);
  }
  if (mode === "policy_rate") {
    const bucket = majorBucketOf(feature);
    if (!bucket || !MAJOR_BUCKETS.has(bucket)) return goldThemeEnabled ? defaultGold : defaultBlue;
    const item = normalizeMapValue(policyRateByCountry, bucket);
    return policyRateColor(item?.rate);
  }
  if (mode === "commodity_shock") {
    const region = commodityRegionOf(feature);
    const value = Number(commodityByRegion[region] ?? 0);
    return commodityColor(value);
  }
  return goldThemeEnabled ? defaultGold : defaultBlue;
}

export function polygonStrokeColor(
  mode: OverlayMode,
  feature: GeoFeature,
  policyRateByCountry: Record<string, PolicyRateCountryEntry>,
  goldThemeEnabled = false,
): string {
  if (mode !== "policy_rate") {
    return goldThemeEnabled ? "rgba(214,178,74,0.58)" : "rgba(41,98,255,0.58)";
  }
  const bucket = majorBucketOf(feature);
  if (!bucket || !MAJOR_BUCKETS.has(bucket)) return "rgba(41,98,255,0.34)";
  const item = normalizeMapValue(policyRateByCountry, bucket);
  return policyRateStroke(item?.lastMove);
}

export function volatilityTint(volScore: number): string {
  const v = Math.max(0, Math.min(100, Number(volScore) || 50));
  if (v < 40) {
    const alpha = 0.08 + ((40 - v) / 40) * 0.10;
    return `rgba(57, 255, 64, ${alpha.toFixed(3)})`;
  }
  if (v < 67) {
    const alpha = 0.08 + ((v - 40) / 27) * 0.10;
    return `rgba(255, 235, 59, ${alpha.toFixed(3)})`;
  }
  const alpha = 0.10 + ((v - 67) / 33) * 0.14;
  return `rgba(255, 56, 76, ${alpha.toFixed(3)})`;
}

export async function loadWorldFeatures(): Promise<GeoFeature[]> {
  if (!worldFeaturesPromise) {
    worldFeaturesPromise = fetch("https://raw.githubusercontent.com/holtzy/D3-graph-gallery/master/DATA/world.geojson")
      .then((res) => {
        if (!res.ok) {
          throw new Error(`world geojson ${res.status}`);
        }
        return res.json();
      })
      .then((payload: { features?: GeoFeature[] }) => payload.features ?? [])
      .catch(() => []);
  }
  return worldFeaturesPromise;
}
