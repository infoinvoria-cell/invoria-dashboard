import { NextRequest, NextResponse } from "next/server";

import assetSnapshot from "@/data/asset-snapshot.json";
import geoEventsFallback from "@/data/geo-events-fallback.json";
import heatmapAssetsFallback from "@/data/heatmap-assets-fallback.json";
import macroSnapshot from "@/data/macro-snapshot.json";
import newsAssetFallback from "@/data/news-asset-fallback.json";
import newsGlobalFallback from "@/data/news-global-fallback.json";
import overlaySnapshot from "@/data/overlay-snapshot.json";
import trackRecordComparisonTimeseries from "@/data/track-record-comparison-timeseries.json";
import {
  buildYahooEvaluationPayload,
  buildYahooReferenceTimeseriesPayload,
  buildYahooSeasonalityPayload,
  buildYahooTimeseriesPayload,
} from "@/lib/server/yahooFallback";
import { getFallbackAssetNews, getFallbackGlobalNews } from "@/lib/server/newsFallback";
import { readTimeseriesSnapshot } from "@/lib/server/timeseriesSnapshots";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: {
    path: string[];
  };
};

const BACKEND_API_BASE = (process.env.API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || "").replace(/\/+$/g, "");
const FALLBACK_ASSETS = assetSnapshot.items as Array<{
  id: string;
  name: string;
  country?: string;
  lat?: number;
  lng?: number;
  locations?: Array<{
    label?: string;
    lat?: number;
    lng?: number;
  }>;
}>;

function isoNow(): string {
  return new Date().toISOString();
}

function buildProxyUrl(request: NextRequest, path: string[]): string | null {
  if (!BACKEND_API_BASE) return null;

  const pathname = path.join("/");
  const search = request.nextUrl.search || "";
  return `${BACKEND_API_BASE}/api/${pathname}${search}`;
}

function fallbackNewsForAsset(assetId: string) {
  const key = String(assetId || "").trim().toLowerCase();
  return newsAssetFallback[key as keyof typeof newsAssetFallback] ?? newsGlobalFallback;
}

function fallbackComparisonTimeseries(assetId: string) {
  const key = String(assetId || "").trim().toLowerCase();
  if (key === "sp500" || key === "dax40") {
    return trackRecordComparisonTimeseries[key as keyof typeof trackRecordComparisonTimeseries] ?? null;
  }
  return null;
}

function emptyGeoEvents(layer: string) {
  return {
    updatedAt: assetSnapshot.updatedAt,
    layer,
    items: [],
  };
}

function geoEventsForLayer(layer: string) {
  const key = String(layer || "").trim().toLowerCase();
  if (key === "conflicts" || key === "wildfires" || key === "earthquakes" || key === "news_geo") {
    return geoEventsFallback[key as keyof typeof geoEventsFallback] ?? emptyGeoEvents(key);
  }
  return emptyGeoEvents(key || "geo_events");
}

function buildAssetRegionsFallback(assetId: string) {
  const asset = FALLBACK_ASSETS.find((item) => String(item.id || "").trim().toLowerCase() === String(assetId || "").trim().toLowerCase());
  if (!asset) {
    return {
      updatedAt: isoNow(),
      assetId: String(assetId || "").trim().toLowerCase(),
      bias: "neutral",
      score: 0,
      regions: [],
      assetRegionMap: {},
    };
  }

  const locations = Array.isArray(asset.locations) && asset.locations.length
    ? asset.locations
    : [{ label: asset.country || asset.name, lat: asset.lat, lng: asset.lng }];
  const regions = locations
    .map((location, index) => {
      const lat = Number(location?.lat);
      const lng = Number(location?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return null;
      }
      return {
        id: `${asset.id}-${index + 1}`,
        name: String(location?.label || asset.country || asset.name || asset.id).trim(),
        lat,
        lng,
        countries: [String(asset.country || location?.label || asset.name || asset.id).trim()].filter(Boolean),
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  const assetRegionMap = Object.fromEntries(
    regions.map((region) => [region.name, region.countries]),
  );

  return {
    updatedAt: assetSnapshot.updatedAt || isoNow(),
    assetId: asset.id,
    bias: "neutral",
    score: regions.length ? 50 : 0,
    regions,
    assetRegionMap,
  };
}

async function fallbackResponse(path: string[], request: NextRequest): Promise<NextResponse> {
  const normalized = path.map((segment) => String(segment || "").trim().toLowerCase());
  const requestUrl = new URL(request.url);
  const source = String(requestUrl.searchParams.get("source") || "yahoo").toLowerCase();
  const timeframe = String(requestUrl.searchParams.get("tf") || "D").toUpperCase();
  const continuousMode = String(requestUrl.searchParams.get("continuous_mode") || "regular").toLowerCase();

  if (normalized.length === 1 && normalized[0] === "assets") {
    return NextResponse.json(assetSnapshot);
  }

  if ((normalized.length === 1 && normalized[0] === "heatmap") || (normalized.length === 2 && normalized[0] === "heatmap" && normalized[1] === "assets")) {
    return NextResponse.json(heatmapAssetsFallback);
  }

  if (normalized.length === 2 && normalized[0] === "news" && normalized[1] === "global") {
    const live = await getFallbackGlobalNews();
    if (live?.items?.length) {
      return NextResponse.json(live);
    }
    return NextResponse.json({
      updatedAt: assetSnapshot.updatedAt,
      items: newsGlobalFallback,
    });
  }

  if (normalized.length === 3 && normalized[0] === "news" && normalized[1] === "asset") {
    const live = await getFallbackAssetNews(normalized[2]);
    if (live?.items?.length) {
      return NextResponse.json(live);
    }
    return NextResponse.json({
      updatedAt: assetSnapshot.updatedAt,
      items: fallbackNewsForAsset(normalized[2]),
    });
  }

  if (normalized.length === 2 && normalized[0] === "news" && normalized[1] === "translate") {
    return NextResponse.json({
      newsId: String(requestUrl.searchParams.get("news_id") || "").trim(),
      language: String(requestUrl.searchParams.get("target_language") || "DE").toUpperCase(),
      translated: false,
      provider: "fallback",
      title: String(requestUrl.searchParams.get("title") || ""),
      description: String(requestUrl.searchParams.get("description") || ""),
    });
  }

  if (normalized.length === 3 && normalized[0] === "asset" && normalized[2] === "timeseries") {
    const payload = fallbackComparisonTimeseries(normalized[1]);
    if (payload) {
      return NextResponse.json(payload);
    }
    const snapshot = await readTimeseriesSnapshot(source, normalized[1]);
    if (snapshot) {
      return NextResponse.json(snapshot);
    }
    try {
      return NextResponse.json(await buildYahooTimeseriesPayload(normalized[1], timeframe, source, continuousMode));
    } catch (_error) {
      // fall through to generic 503 payload
    }
  }

  if (normalized.length === 3 && normalized[0] === "asset" && normalized[2] === "evaluation") {
    try {
      return NextResponse.json(await buildYahooEvaluationPayload(normalized[1]));
    } catch (_error) {
      // fall through to generic 503 payload
    }
  }

  if (normalized.length === 3 && normalized[0] === "asset" && normalized[2] === "seasonality") {
    try {
      return NextResponse.json(await buildYahooSeasonalityPayload(normalized[1]));
    } catch (_error) {
      // fall through to generic 503 payload
    }
  }

  if (normalized.length === 2 && normalized[0] === "reference" && normalized[1] === "timeseries") {
    const symbol = String(requestUrl.searchParams.get("symbol") || "").trim();
    if (symbol) {
      try {
        return NextResponse.json(await buildYahooReferenceTimeseriesPayload(symbol, timeframe, source, continuousMode));
      } catch (_error) {
        // fall through to generic 503 payload
      }
    }
  }

  if (normalized.length === 2 && normalized[0] === "macro") {
    const key = normalized[1];
    if (key === "inflation" || key === "risk" || key === "policy_rate" || key === "volatility_regime" || key === "commodity_shock" || key === "fundamental") {
      return NextResponse.json(macroSnapshot[key as keyof typeof macroSnapshot]);
    }
  }

  if (normalized.length === 1 && normalized[0] === "macro-overlay") {
    return NextResponse.json({
      inflation: macroSnapshot.inflation,
      policyRate: macroSnapshot.policy_rate,
      risk: macroSnapshot.risk,
      volatilityRegime: macroSnapshot.volatility_regime,
      commodityShock: macroSnapshot.commodity_shock,
      fundamental: macroSnapshot.fundamental,
    });
  }

  if (normalized.length === 2 && normalized[0] === "events") {
    return NextResponse.json(geoEventsForLayer(normalized[1]));
  }

  if (normalized.length === 2 && normalized[0] === "geo" && normalized[1] === "events") {
    return NextResponse.json(geoEventsForLayer(String(requestUrl.searchParams.get("layer") || "geo_events")));
  }

  if (normalized.length === 2 && normalized[0] === "overlay") {
    const key = normalized[1];
    if (key === "ships") return NextResponse.json(overlaySnapshot.ships);
    if (key === "oil_routes") return NextResponse.json(overlaySnapshot.oil_routes);
    if (key === "container_routes") return NextResponse.json(overlaySnapshot.container_routes);
    if (key === "commodity_regions") return NextResponse.json(overlaySnapshot.commodity_regions);
    if (key === "global_risk") return NextResponse.json(overlaySnapshot.global_risk);
    if (key === "global_liquidity") return NextResponse.json(overlaySnapshot.global_liquidity);
    if (key === "shipping_disruptions") return NextResponse.json(overlaySnapshot.shipping_disruptions);
    if (key === "commodity_stress") return NextResponse.json(overlaySnapshot.commodity_stress);
  }

  if (normalized.length === 3 && normalized[0] === "overlay" && normalized[1] === "asset_regions") {
    return NextResponse.json(buildAssetRegionsFallback(normalized[2]));
  }

  return NextResponse.json(
    {
      error: "Backend API is not configured for this endpoint.",
      backendConfigured: Boolean(BACKEND_API_BASE),
      requestedPath: `/api/${path.join("/")}`,
    },
    { status: 503 },
  );
}

export async function GET(request: NextRequest, { params }: RouteContext) {
  const path = params.path ?? [];
  const proxyUrl = buildProxyUrl(request, path);

  if (!proxyUrl) {
    return fallbackResponse(path, request);
  }

  try {
    const upstream = await fetch(proxyUrl, {
      cache: "no-store",
      headers: {
        accept: request.headers.get("accept") ?? "application/json",
      },
    });

    if (!upstream.ok) {
      const fallback = await fallbackResponse(path, request);
      if (fallback.status !== 503) {
        return fallback;
      }
    }

    const text = await upstream.text();
    const contentType = upstream.headers.get("content-type") ?? "application/json; charset=utf-8";

    return new NextResponse(text, {
      status: upstream.status,
      headers: {
        "content-type": contentType,
      },
    });
  } catch (error) {
    console.error("API PROXY ERROR:", {
      proxyUrl,
      error,
    });
    return fallbackResponse(path, request);
  }
}
