from __future__ import annotations

from fastapi import APIRouter, HTTPException
from typing import Any

from backend.services.globe_data import (
    get_asset_region_highlight_payload,
    get_commodity_regions_payload,
    get_commodity_stress_map_payload,
    get_container_routes_payload,
    get_diagnostics_payload,
    get_asset_signal_detail_payload,
    get_assets_payload,
    get_global_liquidity_map_payload,
    get_global_risk_layer_payload,
    get_oil_routes_payload,
    get_category_heatmap_payload,
    get_evaluation_payload,
    get_geo_events_payload,
    get_heatmap_assets_payload,
    get_market_alerts_payload,
    get_macro_fundamental_payload,
    get_macro_commodity_shock_payload,
    get_macro_inflation_payload,
    get_macro_policy_rate_payload,
    get_macro_risk_payload,
    get_macro_usd_strength_payload,
    get_macro_volatility_payload,
    get_news_geo_events_payload,
    get_news_asset_payload,
    get_news_global_payload,
    get_opportunities_payload,
    get_shipping_disruptions_payload,
    get_ship_tracking_payload,
    get_seasonality_payload,
    get_timeseries_payload,
    translate_news_item,
)


router = APIRouter(prefix="/api", tags=["globe"])


def _extract_assets_items(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, dict):
        items = payload.get("items")
        if isinstance(items, list):
            return [item for item in items if isinstance(item, dict)]
        return []
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    return []


def _pick_dollar_index_asset(items: list[dict[str, Any]]) -> dict[str, Any] | None:
    for item in items:
        sid = str(item.get("id", "")).strip().lower()
        symbol = str(item.get("symbol", "")).strip().lower()
        name = str(item.get("name", "")).strip().lower()
        if sid == "usd_index" or symbol == "dxy" or "dollar index" in name:
            return item
    return items[0] if items else None


def _pick_default_seasonality_asset_id(items: list[dict[str, Any]]) -> str | None:
    for item in items:
        sid = str(item.get("id", "")).strip()
        if sid.lower().startswith("cross_"):
            return sid
    candidate = _pick_dollar_index_asset(items)
    if candidate:
        return str(candidate.get("id", "")).strip() or None
    return None


@router.get("/assets")
async def api_assets():
    return get_assets_payload()


@router.get("/crosspairs")
async def api_crosspairs():
    payload = get_assets_payload()
    items = _extract_assets_items(payload)
    crosspairs = [
        item
        for item in items
        if str(item.get("id", "")).lower().startswith("cross_")
        or str(item.get("category", "")).strip().lower() in {"cross pairs", "cross pair", "crosspairs"}
    ]
    updated_at = payload.get("updatedAt") if isinstance(payload, dict) else None
    return {
        "items": crosspairs,
        "count": len(crosspairs),
        "updatedAt": updated_at,
    }


@router.get("/globe-assets")
async def api_globe_assets():
    payload = get_assets_payload()
    items = _extract_assets_items(payload)
    updated_at = payload.get("updatedAt") if isinstance(payload, dict) else None
    return {
        "items": items,
        "count": len(items),
        "updatedAt": updated_at,
    }


@router.get("/dollar-index")
async def api_dollar_index(
    tf: str = "D",
    source: str = "dukascopy",
    continuous_mode: str = "backadjusted",
    refresh_bucket: int | None = None,
):
    assets_payload = get_assets_payload()
    items = _extract_assets_items(assets_payload)
    asset = _pick_dollar_index_asset(items)
    if not asset:
        raise HTTPException(status_code=404, detail="No asset available for dollar index.")

    asset_id = str(asset.get("id", "")).strip()
    if not asset_id:
        raise HTTPException(status_code=404, detail="Dollar index asset id missing.")

    try:
        timeseries = get_timeseries_payload(
            asset_id,
            timeframe=tf,
            source=source,
            continuous_mode=continuous_mode,
            refresh_bucket=refresh_bucket,
        )
        evaluation = get_evaluation_payload(asset_id, source=source)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    timeseries_updated = timeseries.get("updatedAt") if isinstance(timeseries, dict) else None
    evaluation_updated = evaluation.get("updatedAt") if isinstance(evaluation, dict) else None

    return {
        "asset": asset,
        "timeseries": timeseries,
        "evaluation": evaluation,
        "updatedAt": timeseries_updated or evaluation_updated,
    }


@router.get("/news")
async def api_news():
    payload = await get_news_global_payload()
    items = payload.get("items") if isinstance(payload, dict) else payload
    if not isinstance(items, list):
        items = []
    updated_at = payload.get("updatedAt") if isinstance(payload, dict) else None
    return {
        "items": items,
        "count": len(items),
        "updatedAt": updated_at,
    }


@router.get("/usd-news")
async def api_usd_news():
    assets_payload = get_assets_payload()
    items = _extract_assets_items(assets_payload)
    asset = _pick_dollar_index_asset(items)
    if not asset:
        return {"items": [], "count": 0, "updatedAt": None}

    asset_id = str(asset.get("id", "")).strip()
    if not asset_id:
        return {"items": [], "count": 0, "updatedAt": None}

    payload = await get_news_asset_payload(asset_id)
    rows = payload.get("items") if isinstance(payload, dict) else payload
    if not isinstance(rows, list):
        rows = []
    updated_at = payload.get("updatedAt") if isinstance(payload, dict) else None
    return {
        "items": rows,
        "count": len(rows),
        "updatedAt": updated_at,
        "asset": asset,
    }


@router.get("/seasonality")
async def api_seasonality(asset_id: str | None = None, source: str = "dukascopy"):
    assets_payload = get_assets_payload()
    items = _extract_assets_items(assets_payload)

    chosen_asset_id = (asset_id or "").strip()
    if not chosen_asset_id:
        chosen_asset_id = _pick_default_seasonality_asset_id(items) or ""
    if not chosen_asset_id:
        raise HTTPException(status_code=404, detail="No asset available for seasonality.")

    chosen_asset = next((item for item in items if str(item.get("id", "")).strip() == chosen_asset_id), None)

    try:
        payload = get_seasonality_payload(chosen_asset_id, source=source)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    if isinstance(payload, dict):
        data = dict(payload)
        data["asset"] = chosen_asset
        data["requestedAssetId"] = asset_id
        return data

    return {
        "asset": chosen_asset,
        "requestedAssetId": asset_id,
        "payload": payload,
    }


@router.get("/asset/{asset_id}/timeseries")
async def api_asset_timeseries(
    asset_id: str,
    tf: str = "D",
    source: str = "dukascopy",
    continuous_mode: str = "backadjusted",
    refresh_bucket: int | None = None,
):
    try:
        return get_timeseries_payload(
            asset_id,
            timeframe=tf,
            source=source,
            continuous_mode=continuous_mode,
            refresh_bucket=refresh_bucket,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/asset/{asset_id}/evaluation")
async def api_asset_evaluation(asset_id: str, source: str = "dukascopy"):
    try:
        return get_evaluation_payload(asset_id, source=source)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


def _valuation_slice(payload: Any, mode_key: str) -> dict[str, Any]:
    if not isinstance(payload, dict):
        return {"mode": mode_key, "series": [], "updatedAt": None}
    series = payload.get("series")
    if not isinstance(series, list):
        series = []

    normalized = str(mode_key or "").strip().lower()
    wanted_ids = {"v10"} if normalized == "v10" else {"v20"}
    filtered = [row for row in series if str(row.get("id", "")).strip().lower() in wanted_ids]
    if not filtered:
        filtered = series
    return {
        "mode": "valuation10" if normalized == "v10" else "valuation20",
        "series": filtered,
        "updatedAt": payload.get("updatedAt"),
        "assetId": payload.get("assetId"),
        "assetName": payload.get("assetName"),
        "source": payload.get("source"),
    }


@router.get("/valuation10")
async def api_valuation10(asset_id: str | None = None, source: str = "dukascopy"):
    assets_payload = get_assets_payload()
    items = _extract_assets_items(assets_payload)
    asset = next((item for item in items if str(item.get("id", "")).strip() == str(asset_id or "").strip()), None)
    if not asset:
        asset = _pick_dollar_index_asset(items)
    if not asset:
        raise HTTPException(status_code=404, detail="No asset available for valuation.")

    selected_asset_id = str(asset.get("id", "")).strip()
    payload = get_evaluation_payload(selected_asset_id, source=source)
    data = _valuation_slice(payload, "v10")
    data["asset"] = asset
    return data


@router.get("/valuation20")
async def api_valuation20(asset_id: str | None = None, source: str = "dukascopy"):
    assets_payload = get_assets_payload()
    items = _extract_assets_items(assets_payload)
    asset = next((item for item in items if str(item.get("id", "")).strip() == str(asset_id or "").strip()), None)
    if not asset:
        asset = _pick_dollar_index_asset(items)
    if not asset:
        raise HTTPException(status_code=404, detail="No asset available for valuation.")

    selected_asset_id = str(asset.get("id", "")).strip()
    payload = get_evaluation_payload(selected_asset_id, source=source)
    data = _valuation_slice(payload, "v20")
    data["asset"] = asset
    return data


@router.get("/asset/{asset_id}/seasonality")
async def api_asset_seasonality(asset_id: str, source: str = "dukascopy"):
    try:
        return get_seasonality_payload(asset_id, source=source)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/news/global")
async def api_news_global():
    return await get_news_global_payload()


@router.get("/news/asset/{asset_id}")
async def api_news_asset(asset_id: str):
    return await get_news_asset_payload(asset_id)


@router.get("/macro/inflation")
async def api_macro_inflation():
    return get_macro_inflation_payload()


@router.get("/macro/usd_strength")
async def api_macro_usd_strength():
    return get_macro_usd_strength_payload()


@router.get("/macro/risk")
async def api_macro_risk():
    return get_macro_risk_payload()


@router.get("/macro/policy_rate")
async def api_macro_policy_rate():
    return get_macro_policy_rate_payload()


@router.get("/macro/volatility_regime")
async def api_macro_volatility_regime():
    return get_macro_volatility_payload()


@router.get("/macro/commodity_shock")
async def api_macro_commodity_shock():
    return get_macro_commodity_shock_payload()


@router.get("/macro/fundamental")
async def api_macro_fundamental():
    return get_macro_fundamental_payload()


@router.get("/macro-overlay")
async def api_macro_overlay():
    return {
        "inflation": get_macro_inflation_payload(),
        "policyRate": get_macro_policy_rate_payload(),
        "usdStrength": get_macro_usd_strength_payload(),
        "risk": get_macro_risk_payload(),
        "volatilityRegime": get_macro_volatility_payload(),
        "commodityShock": get_macro_commodity_shock_payload(),
        "fundamental": get_macro_fundamental_payload(),
    }


@router.get("/weather-signal")
async def api_weather_signal():
    volatility = get_macro_volatility_payload()
    risk = get_macro_risk_payload()
    events = get_geo_events_payload(layer="geo_events")
    entries = events.get("items") if isinstance(events, dict) else []
    if not isinstance(entries, list):
        entries = []

    critical = sum(1 for item in entries if str(item.get("severity", "")).lower() in {"high", "critical"})
    impact_score = min(100, critical * 10)
    regime = str((volatility or {}).get("regimeLabel", "Neutral"))
    risk_mode = str((risk or {}).get("riskMode", "Balanced"))

    return {
        "regime": regime,
        "riskMode": risk_mode,
        "criticalEvents": critical,
        "impactScore": impact_score,
        "eventsCount": len(entries),
        "updatedAt": (volatility or {}).get("updatedAt") or (risk or {}).get("updatedAt"),
    }


@router.get("/opportunities")
async def api_opportunities(source: str = "dukascopy"):
    return get_opportunities_payload(source=source)


@router.get("/heatmap/category")
async def api_heatmap_category(category: str = "FX", sort_by: str = "ai_score", source: str = "dukascopy"):
    return get_category_heatmap_payload(category=category, sort_by=sort_by, source=source)


@router.get("/asset/{asset_id}/signal_detail")
async def api_asset_signal_detail(asset_id: str, source: str = "dukascopy"):
    try:
        return get_asset_signal_detail_payload(asset_id, source=source)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/alerts")
async def api_alerts(source: str = "dukascopy"):
    return get_market_alerts_payload(source=source)


@router.get("/geo/events")
async def api_geo_events(layer: str = "geo_events"):
    return get_geo_events_payload(layer=layer)


@router.get("/events/conflicts")
async def api_events_conflicts():
    return get_geo_events_payload(layer="conflicts")


@router.get("/events/wildfires")
async def api_events_wildfires():
    return get_geo_events_payload(layer="wildfires")


@router.get("/events/earthquakes")
async def api_events_earthquakes():
    return get_geo_events_payload(layer="earthquakes")


@router.get("/events/news_geo")
async def api_events_news_geo():
    return await get_news_geo_events_payload()


@router.get("/events/infrastructure")
async def api_events_infrastructure():
    return get_geo_events_payload(layer="infrastructure")


@router.get("/events/intelligence")
async def api_events_intelligence():
    return get_geo_events_payload(layer="intelligence")


@router.get("/overlay/ships")
async def api_overlay_ships():
    return get_ship_tracking_payload()


@router.get("/overlay/oil_routes")
async def api_overlay_oil_routes():
    return get_oil_routes_payload()


@router.get("/overlay/container_routes")
async def api_overlay_container_routes():
    return get_container_routes_payload()


@router.get("/overlay/commodity_regions")
async def api_overlay_commodity_regions():
    return get_commodity_regions_payload()


@router.get("/overlay/global_risk")
async def api_overlay_global_risk():
    return get_global_risk_layer_payload()


@router.get("/overlay/global_liquidity")
async def api_overlay_global_liquidity():
    return get_global_liquidity_map_payload()


@router.get("/overlay/shipping_disruptions")
async def api_overlay_shipping_disruptions():
    return get_shipping_disruptions_payload()


@router.get("/overlay/commodity_stress")
async def api_overlay_commodity_stress():
    return get_commodity_stress_map_payload()


@router.get("/overlay/asset_regions/{asset_id}")
async def api_overlay_asset_regions(asset_id: str):
    try:
        return get_asset_region_highlight_payload(asset_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/diagnostics")
async def api_diagnostics():
    return get_diagnostics_payload()


@router.get("/news/translate")
async def api_news_translate(
    news_id: str,
    title: str,
    description: str = "",
    target_language: str = "DE",
):
    return translate_news_item(
        news_id=news_id,
        title=title,
        description=description,
        target_language=target_language,
    )


@router.get("/heatmap/assets")
async def api_heatmap_assets(tf: str = "D", source: str = "dukascopy"):
    return get_heatmap_assets_payload(timeframe=tf, source=source)


@router.get("/heatmap")
async def api_heatmap(tf: str = "D", source: str = "dukascopy"):
    return get_heatmap_assets_payload(timeframe=tf, source=source)
