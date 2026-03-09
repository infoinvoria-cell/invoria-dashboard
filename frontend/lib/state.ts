import type { PersistedGlobeState } from "../types";

const STORAGE_KEY = "ivq_globe_hybrid_state_v1";

export const EUROPE_DEFAULT_CAMERA = {
  lat: 50,
  lng: 10,
  altitude: 1.78,
} as const;

export const DEFAULT_GLOBE_STATE: PersistedGlobeState = {
  selectedAssetId: "",
  enabledAssets: [],
  selectedOverlay: "none",
  camera: { ...EUROPE_DEFAULT_CAMERA },
};

function encodeState(state: PersistedGlobeState): string {
  const raw = JSON.stringify(state);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeState(value: string): PersistedGlobeState | null {
  if (!value) {
    return null;
  }
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
    const json = atob(normalized + padding);
    const parsed = JSON.parse(json) as Partial<PersistedGlobeState>;
    return sanitizeState(parsed);
  } catch (_err) {
    return null;
  }
}

function sanitizeState(input: Partial<PersistedGlobeState> | null | undefined): PersistedGlobeState {
  const rawOverlay = String(input?.selectedOverlay || "none");
  const validOverlays = new Set<PersistedGlobeState["selectedOverlay"]>([
    "none",
    "inflation",
    "policy_rate",
    "volatility",
    "commodity_shock",
    "geo_events",
    "news_geo",
    "conflicts",
    "wildfires",
    "earthquakes",
    "ship_tracking",
    "oil_routes",
    "container_traffic",
    "commodity_regions",
    "global_risk_layer",
    "global_liquidity_map",
    "shipping_disruptions",
    "commodity_stress_map",
    "regional_asset_highlight",
  ]);
  const selectedOverlay = validOverlays.has(rawOverlay as PersistedGlobeState["selectedOverlay"])
    ? (rawOverlay as PersistedGlobeState["selectedOverlay"])
    : rawOverlay === "usd"
      ? "policy_rate"
      : rawOverlay === "risk"
        ? "volatility"
        : "none";

  const camera = {
    lat: Number.isFinite(Number(input?.camera?.lat)) ? Number(input?.camera?.lat) : EUROPE_DEFAULT_CAMERA.lat,
    lng: Number.isFinite(Number(input?.camera?.lng)) ? Number(input?.camera?.lng) : EUROPE_DEFAULT_CAMERA.lng,
    altitude: Number.isFinite(Number(input?.camera?.altitude))
      ? Number(input?.camera?.altitude)
      : EUROPE_DEFAULT_CAMERA.altitude,
  };

  return {
    selectedAssetId: String(input?.selectedAssetId || ""),
    enabledAssets: Array.isArray(input?.enabledAssets)
      ? input.enabledAssets.map((id) => String(id)).filter(Boolean)
      : [],
    selectedOverlay,
    camera,
  };
}

function readUrlState(): PersistedGlobeState | null {
  try {
    const qp = new URLSearchParams(window.location.search);
    const encoded = qp.get("gls") ?? "";
    return decodeState(encoded);
  } catch (_err) {
    return null;
  }
}

function readLocalState(): PersistedGlobeState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<PersistedGlobeState>;
    return sanitizeState(parsed);
  } catch (_err) {
    return null;
  }
}

export function loadInitialGlobeState(): PersistedGlobeState {
  return readUrlState() ?? readLocalState() ?? { ...DEFAULT_GLOBE_STATE };
}

export function hasPersistedGlobeState(): boolean {
  try {
    const qp = new URLSearchParams(window.location.search);
    if ((qp.get("gls") || "").trim()) {
      return true;
    }
  } catch (_err) {
    // no-op
  }
  try {
    return Boolean(localStorage.getItem(STORAGE_KEY));
  } catch (_err) {
    return false;
  }
}

export function persistGlobeState(state: PersistedGlobeState): void {
  const safe = sanitizeState(state);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
  } catch (_err) {
    // no-op
  }

  try {
    const encoded = encodeState(safe);
    const qp = new URLSearchParams(window.location.search);
    qp.set("gls", encoded);
    const next = `${window.location.pathname}?${qp.toString()}`;
    window.history.replaceState(null, "", next);
    window.parent?.postMessage({ type: "invoria-globe-state", gls: encoded }, "*");
  } catch (_err) {
    // no-op
  }
}
