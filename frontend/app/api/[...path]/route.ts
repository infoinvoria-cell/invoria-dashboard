import { NextRequest, NextResponse } from "next/server";

import assetSnapshot from "@/data/asset-snapshot.json";
import newsAssetFallback from "@/data/news-asset-fallback.json";
import newsGlobalFallback from "@/data/news-global-fallback.json";
import trackRecordComparisonTimeseries from "@/data/track-record-comparison-timeseries.json";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: {
    path: string[];
  };
};

const BACKEND_API_BASE = (process.env.API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL || "").replace(/\/+$/g, "");

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

function fallbackResponse(path: string[]): NextResponse {
  const normalized = path.map((segment) => String(segment || "").trim().toLowerCase());

  if (normalized.length === 1 && normalized[0] === "assets") {
    return NextResponse.json(assetSnapshot);
  }

  if (normalized.length === 2 && normalized[0] === "news" && normalized[1] === "global") {
    return NextResponse.json({
      updatedAt: assetSnapshot.updatedAt,
      items: newsGlobalFallback,
    });
  }

  if (normalized.length === 3 && normalized[0] === "news" && normalized[1] === "asset") {
    return NextResponse.json({
      updatedAt: assetSnapshot.updatedAt,
      items: fallbackNewsForAsset(normalized[2]),
    });
  }

  if (normalized.length === 3 && normalized[0] === "asset" && normalized[2] === "timeseries") {
    const payload = fallbackComparisonTimeseries(normalized[1]);
    if (payload) {
      return NextResponse.json(payload);
    }
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
    return fallbackResponse(path);
  }

  try {
    const upstream = await fetch(proxyUrl, {
      cache: "no-store",
      headers: {
        accept: request.headers.get("accept") ?? "application/json",
      },
    });

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
    return fallbackResponse(path);
  }
}
