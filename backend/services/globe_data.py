from __future__ import annotations

from datetime import datetime, timedelta, timezone
from functools import lru_cache
import io
import json
import os
import re
from pathlib import Path
import threading
import time
from typing import Any, Awaitable, Callable

import numpy as np
import pandas as pd

from data_engine.globe_loader import get_globe_ohlc_with_meta
from backend.services.market_data_loader import get_market_data, normalize_data_source
from backend.services.news_provider import get_news_provider
from screener.seasonality import perf_path_median, returns_for_hold
from screener.config import YAHOO_ASSET_GROUPS

try:
    from screener import data_loader as _dl  # type: ignore
except Exception:  # pragma: no cover
    _dl = None  # type: ignore

try:
    import yfinance as yf  # type: ignore
except Exception:  # pragma: no cover
    yf = None  # type: ignore

try:
    import requests  # type: ignore
except Exception:  # pragma: no cover
    requests = None  # type: ignore


_ROOT = Path(__file__).resolve().parents[2]
_MOCK_DIR = _ROOT / "backend" / "mock" / "globe"
_ASSET_CONFIG_PATH = _ROOT / "config" / "asset_config.json"
_NEWS_PROVIDER = get_news_provider(_MOCK_DIR)
MARKET_CACHE_SECONDS = 40 * 60
NEWS_CACHE_SECONDS = 5 * 60
VALUATION_CACHE_SECONDS = 40 * 60
SEASONALITY_CACHE_SECONDS = 10 * 365 * 24 * 60 * 60

_SYMBOL_ALIAS = {
    "DXY": "DX-Y.NYB",
    "US500": "^GSPC",
    "SPX": "^GSPC",
    "6E1!": "EURUSD",
    "6J1!": "USDJPY",
    "6B1!": "GBPUSD",
    "6S1!": "USDCHF",
    "6A1!": "AUDUSD",
    "6C1!": "USDCAD",
    "6N1!": "NZDUSD",
    "GC1!": "XAUUSD",
    "SI1!": "XAGUSD",
    "HG1!": "COPPER",
    "PL1!": "PL=F",
    "PA1!": "PA=F",
    "ALI1!": "ALI=F",
    "ES1!": "^GSPC",
    "NQ1!": "^IXIC",
    "YM1!": "^DJI",
    "RTY1!": "^RUT",
    "FDAX1!": "^GDAXI",
    "BTCUSD": "BTC-USD",
    "USOIL": "CL=F",
    "NG1!": "NG=F",
    "RB1!": "RB=F",
    "ZW1!": "ZW=F",
    "WHEAT": "ZW=F",
    "ZC1!": "ZC=F",
    "CORN": "ZC=F",
    "ZS1!": "ZS=F",
    "ZL1!": "ZL=F",
    "KC1!": "KC=F",
    "SB1!": "SB=F",
    "C1!": "CC=F",
    "CC1!": "CC=F",
    "CT1!": "CT=F",
    "OJ1!": "OJ=F",
    "LE1!": "LE=F",
    "HE1!": "HE=F",
}

_INTRADAY_YAHOO_ALIAS = {
    "EURUSD": "EURUSD=X",
    "GBPUSD": "GBPUSD=X",
    "USDJPY": "JPY=X",
    "USDCHF": "CHF=X",
    "AUDUSD": "AUDUSD=X",
    "USDCAD": "CAD=X",
    "NZDUSD": "NZDUSD=X",
    "XAUUSD": "GC=F",
    "XAGUSD": "SI=F",
    "COPPER": "HG=F",
}

_VALID_TFS = {"D", "W", "M", "4H", "1H", "30MIN", "5MIN", "1MIN"}

_CATEGORY_COLORS = {
    "FX": "#2962ff",
    "Metals": "#ffeb3b",
    "Equities": "#84a8ff",
    "Stocks": "#84a8ff",
    "Crypto": "#f0b35a",
    "Energy": "#ff9800",
    "Agriculture": "#c8de70",
    "Softs": "#d6b38a",
    "Livestock": "#bda8ff",
}

_HEATMAP_CLUSTER_ORDER = [
    "FX",
    "Metals",
    "Equities",
    "Crypto",
    "Energy",
    "Agriculture",
    "Softs",
    "Livestock",
]

_NEWS_RELEVANCE_KEYWORDS: tuple[str, ...] = (
    "rate cut",
    "rate hike",
    "inflation",
    "central bank",
    "war",
    "conflict",
    "sanctions",
    "oil disruption",
    "energy crisis",
    "recession",
    "fed",
    "ecb",
    "boj",
    "shipping disruption",
    "suez",
    "panama canal",
    "hormuz",
    "red sea",
    "commodity stress",
    "supply chain",
)

_NEWS_BULL_KEYWORDS: tuple[str, ...] = (
    "rate cut",
    "stimulus",
    "ceasefire",
    "inflation cooling",
    "inflation eases",
    "demand surge",
    "stabilizes",
    "stabilise",
    "de-escalation",
    "peace talks",
    "truce",
    "risk-on",
    "upgrade",
    "beats",
    "rebound",
    "rally",
    "support package",
    "growth surprise",
)

_NEWS_BEAR_KEYWORDS: tuple[str, ...] = (
    "war",
    "attack",
    "sanctions",
    "supply disruption",
    "default",
    "recession",
    "bank collapse",
    "energy crisis",
    "oil disruption",
    "geopolitical tension",
    "hawkish",
    "rate hike",
    "escalation",
    "risk-off",
    "slump",
    "selloff",
    "plunge",
    "downgrade",
    "missile",
    "strike",
    "shipping disruption",
    "canal delay",
    "port congestion",
    "export ban",
)

_NEWS_NEUTRAL_KEYWORDS: tuple[str, ...] = (
    "speech",
    "meeting",
    "report",
    "statement",
    "minutes",
    "commentary",
    "briefing",
)

_NEWS_GEO_LOOKUP: dict[str, dict[str, Any]] = {
    "ukraine": {"location": "Ukraine", "lat": 49.0, "lng": 31.0},
    "russia": {"location": "Russia", "lat": 56.0, "lng": 38.0},
    "black sea": {"location": "Black Sea", "lat": 44.0, "lng": 35.0},
    "red sea": {"location": "Red Sea", "lat": 20.5, "lng": 38.0},
    "middle east": {"location": "Middle East", "lat": 25.0, "lng": 45.0},
    "israel": {"location": "Israel", "lat": 31.2, "lng": 34.8},
    "gaza": {"location": "Gaza", "lat": 31.4, "lng": 34.3},
    "iran": {"location": "Iran", "lat": 32.4, "lng": 53.7},
    "saudi": {"location": "Saudi Arabia", "lat": 23.9, "lng": 45.1},
    "opec": {"location": "OPEC Region", "lat": 24.0, "lng": 47.0},
    "suez": {"location": "Suez", "lat": 30.1, "lng": 32.6},
    "suez canal": {"location": "Suez Canal", "lat": 30.1, "lng": 32.6},
    "panama canal": {"location": "Panama Canal", "lat": 9.1, "lng": -79.7},
    "strait of hormuz": {"location": "Strait of Hormuz", "lat": 26.6, "lng": 56.3},
    "hormuz": {"location": "Strait of Hormuz", "lat": 26.6, "lng": 56.3},
    "taiwan": {"location": "Taiwan", "lat": 23.7, "lng": 121.0},
    "china": {"location": "China", "lat": 35.9, "lng": 104.2},
    "south china sea": {"location": "South China Sea", "lat": 12.0, "lng": 114.0},
    "shanghai": {"location": "Shanghai", "lat": 31.2, "lng": 121.5},
    "singapore": {"location": "Singapore", "lat": 1.3, "lng": 103.8},
    "dubai": {"location": "Dubai", "lat": 25.2, "lng": 55.3},
    "rotterdam": {"location": "Rotterdam", "lat": 51.9, "lng": 4.4},
    "los angeles": {"location": "Los Angeles", "lat": 33.7, "lng": -118.2},
    "japan": {"location": "Japan", "lat": 36.2, "lng": 138.2},
    "korea": {"location": "Korea", "lat": 36.5, "lng": 127.9},
    "tokyo": {"location": "Tokyo", "lat": 35.7, "lng": 139.7},
    "europe": {"location": "Europe", "lat": 50.0, "lng": 10.0},
    "brussels": {"location": "Brussels", "lat": 50.85, "lng": 4.35},
    "germany": {"location": "Germany", "lat": 51.2, "lng": 10.4},
    "frankfurt": {"location": "Frankfurt", "lat": 50.11, "lng": 8.68},
    "france": {"location": "France", "lat": 46.2, "lng": 2.2},
    "uk": {"location": "United Kingdom", "lat": 54.0, "lng": -2.0},
    "united kingdom": {"location": "United Kingdom", "lat": 54.0, "lng": -2.0},
    "london": {"location": "London", "lat": 51.5, "lng": -0.12},
    "usa": {"location": "United States", "lat": 39.8, "lng": -98.6},
    "united states": {"location": "United States", "lat": 39.8, "lng": -98.6},
    "washington": {"location": "Washington DC", "lat": 38.9, "lng": -77.0},
    "federal reserve": {"location": "Washington DC", "lat": 38.9, "lng": -77.0},
    "ecb": {"location": "Frankfurt", "lat": 50.11, "lng": 8.68},
    "bank of japan": {"location": "Tokyo", "lat": 35.7, "lng": 139.7},
    "bank of england": {"location": "London", "lat": 51.5, "lng": -0.12},
    "california": {"location": "California", "lat": 36.8, "lng": -119.4},
    "texas": {"location": "Texas", "lat": 31.0, "lng": -99.0},
    "venezuela": {"location": "Venezuela", "lat": 7.0, "lng": -66.0},
    "brazil": {"location": "Brazil", "lat": -10.0, "lng": -55.0},
    "chile": {"location": "Chile", "lat": -35.0, "lng": -71.0},
    "argentina": {"location": "Argentina", "lat": -38.0, "lng": -63.0},
    "ghana": {"location": "Ghana", "lat": 7.9, "lng": -1.0},
    "ivory coast": {"location": "Cote d'Ivoire", "lat": 7.6, "lng": -5.5},
    "cote d'ivoire": {"location": "Cote d'Ivoire", "lat": 7.6, "lng": -5.5},
    "australia": {"location": "Australia", "lat": -25.0, "lng": 133.0},
}


class _TTLCache:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._store: dict[str, tuple[float, Any]] = {}

    def get(self, key: str) -> Any | None:
        now = time.time()
        with self._lock:
            item = self._store.get(key)
            if item is None:
                return None
            expires, value = item
            if expires < now:
                self._store.pop(key, None)
                return None
            return value

    def set(self, key: str, ttl_seconds: int, value: Any) -> None:
        with self._lock:
            self._store[key] = (time.time() + int(max(1, ttl_seconds)), value)


_CACHE = _TTLCache()


def _cached(key: str, ttl_seconds: int, factory: Callable[[], Any]) -> Any:
    v = _CACHE.get(key)
    if v is not None:
        return v
    out = factory()
    _CACHE.set(key, ttl_seconds, out)
    return out


async def _cached_async(key: str, ttl_seconds: int, factory: Callable[[], Awaitable[Any]]) -> Any:
    v = _CACHE.get(key)
    if v is not None:
        return v
    out = await factory()
    _CACHE.set(key, ttl_seconds, out)
    return out


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _read_json(name: str) -> Any:
    path = _MOCK_DIR / name
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def _read_asset_config() -> list[dict[str, Any]]:
    if not _ASSET_CONFIG_PATH.exists():
        return []
    with _ASSET_CONFIG_PATH.open("r", encoding="utf-8-sig") as fh:
        payload = json.load(fh)
    return payload if isinstance(payload, list) else []


def _yahoo_stock_assets() -> list[dict[str, Any]]:
    """Return the Yahoo stock universe used by the project.

    The full universe is searchable in the watchlist, while only the first 20
    items are featured in the default, non-search view.
    """

    tickers = list(YAHOO_ASSET_GROUPS.get("Top 200 Stocks", {}).keys())
    out: list[dict[str, Any]] = []

    for idx, ticker in enumerate(tickers):
        t = str(ticker or "").strip()
        if not t:
            continue
        asset_id = t.lower().replace(".", "_")

        # Approximate stock headquarters / exchange location for map placement
        country = "United States"
        lat, lng = 40.7128, -74.0060
        if "." in t:
            suffix = t.split(".", 1)[1].upper()
            if suffix == "DE":
                country = "Germany"
                lat, lng = 50.1109, 8.6821
            elif suffix in {"SW", "CH"}:
                country = "Switzerland"
                lat, lng = 47.3769, 8.5417
            elif suffix == "L":
                country = "United Kingdom"
                lat, lng = 51.5074, -0.1278
            else:
                country = "Europe"
                lat, lng = 50.1109, 8.6821

        out.append(
            {
                "id": asset_id,
                "name": t,
                "category": "Stocks",
                "iconKey": "stock",
                "tvSource": t,
                "symbol": t,
                "lat": float(lat),
                "lng": float(lng),
                "country": country,
                "color": _CATEGORY_COLORS.get("Stocks", "#84a8ff"),
                "defaultEnabled": False,
                "watchlistFeatured": idx < 20,
                "showOnGlobe": False,
                "locations": [
                    {"label": country, "lat": float(lat), "lng": float(lng), "weight": 1.0}
                ],
            }
        )
    return out


def _normalize_tv_source(tv_source: str) -> str:
    s = str(tv_source or "").strip()
    if not s:
        return ""
    left = s.split("/")[0].strip()
    if not left:
        left = s
    return left


def _resolve_symbol(symbol: str) -> str:
    s = str(symbol or "").strip().upper()
    return _SYMBOL_ALIAS.get(s, s)


def _normalize_timeframe(value: str | None) -> str:
    tf = str(value or "D").strip().upper()
    if tf in _VALID_TFS:
        return tf
    if tf in {"1M", "1MIN", "1MINUTE", "M1"}:
        return "1MIN"
    if tf in {"5M", "5MIN", "5MINUTE", "M5"}:
        return "5MIN"
    if tf in {"30M", "30MIN", "30MINUTE", "M30"}:
        return "30MIN"
    if tf in {"H1", "1HOUR", "HOURLY"}:
        return "1H"
    if tf in {"H4", "4HOUR"}:
        return "4H"
    if tf in {"DAY", "DAILY"}:
        return "D"
    if tf in {"WEEK", "WEEKLY"}:
        return "W"
    if tf in {"MONTH", "MONTHLY"}:
        return "M"
    return "D"


def _is_intraday_index(idx: pd.Index | pd.DatetimeIndex) -> bool:
    if not isinstance(idx, pd.DatetimeIndex) or idx.size < 2:
        return False
    has_time_component = bool(
        ((idx.hour != 0) | (idx.minute != 0) | (idx.second != 0) | (idx.microsecond != 0)).any()
    )
    has_multi_rows_per_day = bool(idx.normalize().duplicated(keep=False).any())
    return has_time_component or has_multi_rows_per_day


def _intraday_tf_minutes(tf: str) -> int:
    tfn = _normalize_timeframe(tf)
    return {
        "1MIN": 1,
        "5MIN": 5,
        "30MIN": 30,
        "1H": 60,
        "4H": 240,
    }.get(tfn, 60)


def _intraday_target_bars(tf: str) -> int:
    tfn = _normalize_timeframe(tf)
    return {
        "1MIN": 2400,
        "5MIN": 3600,
        "30MIN": 2600,
        "1H": 2200,
        "4H": 1800,
    }.get(tfn, 1200)


def _intraday_yahoo_params(tf: str) -> tuple[str, int]:
    tfn = _normalize_timeframe(tf)
    if tfn == "1MIN":
        return ("1m", 7)  # Yahoo limitation; local Dukascopy data is preferred first.
    if tfn == "5MIN":
        return ("5m", 60)
    if tfn == "30MIN":
        return ("30m", 60)
    if tfn == "1H":
        return ("60m", 730)
    return ("60m", 730)  # 4H from 60m resample


def _heatmap_history_years(tf: str) -> int:
    tfn = _normalize_timeframe(tf)
    if tfn == "M":
        return 16
    if tfn == "W":
        return 14
    if tfn == "D":
        return 14
    if tfn == "4H":
        return 6
    if tfn == "1H":
        return 4
    if tfn == "30MIN":
        return 2
    if tfn == "5MIN":
        return 2
    if tfn == "1MIN":
        return 1
    return 10


def _to_yahoo_intraday_symbol(symbol: str) -> str:
    s = _resolve_symbol(symbol)
    mapped = _INTRADAY_YAHOO_ALIAS.get(s)
    if mapped:
        return mapped
    if re.fullmatch(r"[A-Z]{6}", s or ""):
        return f"{s}=X"
    return s


def _normalize_yf_ohlc(df: pd.DataFrame) -> pd.DataFrame:
    if df is None or df.empty:
        return pd.DataFrame()
    x = df.copy()
    if isinstance(x.columns, pd.MultiIndex):
        x.columns = [str(c[0]).strip() if isinstance(c, tuple) else str(c).strip() for c in x.columns]
    else:
        x.columns = [str(c).strip() for c in x.columns]
    cols = {c.lower(): c for c in x.columns}
    need = ["open", "high", "low", "close"]
    if not all(k in cols for k in need):
        return pd.DataFrame()
    out = pd.DataFrame(index=pd.to_datetime(x.index, errors="coerce"))
    out = out[~out.index.isna()]
    out["Open"] = pd.to_numeric(x[cols["open"]], errors="coerce")
    out["High"] = pd.to_numeric(x[cols["high"]], errors="coerce")
    out["Low"] = pd.to_numeric(x[cols["low"]], errors="coerce")
    out["Close"] = pd.to_numeric(x[cols["close"]], errors="coerce")
    vol_col = cols.get("volume")
    out["Volume"] = pd.to_numeric(x[vol_col], errors="coerce") if vol_col else np.nan
    out = out.dropna(subset=["Open", "High", "Low", "Close"])
    if out.empty:
        return pd.DataFrame()
    if isinstance(out.index, pd.DatetimeIndex):
        if out.index.tz is None:
            out.index = out.index.tz_localize("UTC").tz_convert("UTC").tz_localize(None)
        else:
            out.index = out.index.tz_convert("UTC").tz_localize(None)
    out = out[~out.index.duplicated(keep="last")].sort_index()
    return out


def _resample_ohlc(df: pd.DataFrame, rule: str) -> pd.DataFrame:
    if df is None or df.empty:
        return pd.DataFrame()
    out = df.resample(rule, label="right", closed="right").agg(
        {
            "Open": "first",
            "High": "max",
            "Low": "min",
            "Close": "last",
            "Volume": "sum",
        }
    )
    out = out.dropna(subset=["Open", "High", "Low", "Close"])
    if out.empty:
        return pd.DataFrame()
    out = out[~out.index.duplicated(keep="last")].sort_index()
    return out


def _fallback_intraday_from_daily(daily: pd.DataFrame, timeframe: str, seed_key: str | None = None) -> pd.DataFrame:
    if daily is None or daily.empty:
        return pd.DataFrame()
    tf = _normalize_timeframe(timeframe)
    step_min = _intraday_tf_minutes(tf)
    bars_per_day = max(1, int((24 * 60) // max(1, step_min)))
    source_days = 6 if step_min <= 5 else (14 if step_min <= 30 else 40)
    source = daily.tail(source_days).copy()
    rows: list[dict[str, Any]] = []
    idx: list[pd.Timestamp] = []
    base_seed = abs(hash(f"{seed_key or 'fallback'}|{tf}|intraday_v2")) % (2**32 - 1)
    for ts in source.index:
        row = source.loc[ts]
        base = pd.Timestamp(ts).floor("D")
        o = float(row["Open"])
        h = float(row["High"])
        l = float(row["Low"])
        c = float(row["Close"])
        if not all(np.isfinite([o, h, l, c])):
            continue
        daily_range = max(1e-9, abs(h - l))
        day_seed = abs(hash(f"{base_seed}|{base.date()}")) % (2**32 - 1)
        phase = (day_seed % 360) * (np.pi / 180.0)
        amp = daily_range * (0.05 if step_min >= 60 else (0.07 if step_min >= 30 else 0.1))
        for i in range(bars_per_day):
            start_ratio = i / bars_per_day
            end_ratio = (i + 1) / bars_per_day
            t0 = start_ratio * (2.0 * np.pi)
            t1 = end_ratio * (2.0 * np.pi)
            wave0 = np.sin(t0 + phase) * amp
            wave1 = np.sin(t1 + phase) * amp
            io = o + (c - o) * start_ratio + wave0
            ic = o + (c - o) * end_ratio + wave1
            io = float(np.clip(io, l, h))
            ic = float(np.clip(ic, l, h))
            hi = max(h, io, ic)
            lo = min(l, io, ic)
            idx.append(base + pd.Timedelta(minutes=i * step_min))
            rows.append(
                {
                    "Open": float(io),
                    "High": float(hi),
                    "Low": float(lo),
                    "Close": float(ic),
                    "Volume": np.nan,
                }
            )
    if not rows:
        return pd.DataFrame()
    out = pd.DataFrame(rows, index=pd.DatetimeIndex(idx))
    out = out[~out.index.duplicated(keep="last")].sort_index()
    return out.tail(_intraday_target_bars(tf))


def _load_intraday_ohlc(
    symbol: str,
    timeframe: str,
    source: str = "dukascopy",
    *,
    purpose: str = "chart",
    asset_id: str | None = None,
    continuous_mode: str = "backadjusted",
) -> pd.DataFrame:
    tf = _normalize_timeframe(timeframe)
    if tf not in {"1MIN", "5MIN", "30MIN", "1H", "4H"}:
        return pd.DataFrame()
    src = normalize_data_source(source)
    aid = str(asset_id or _asset_id_from_symbol(symbol) or "").strip().lower()
    cache_key = f"intraday_ohlc_v8:{_resolve_symbol(symbol)}:{tf}:{src}:{purpose}:{aid}:{continuous_mode}"

    def _factory() -> pd.DataFrame:
        if src == "tradingview" and aid:
            wanted_tf = {
                "1MIN": "1m",
                "5MIN": "5m",
                "30MIN": "30m",
                "1H": "1h",
                "4H": "4h",
            }.get(tf, "1h")
            df_tv, _meta = get_globe_ohlc_with_meta(
                aid,
                wanted_tf,
                preferred_source="tradingview",
                purpose=purpose,
                allow_fallback=True,
                continuous_mode=continuous_mode,
            )
            if df_tv is not None and not df_tv.empty:
                out = df_tv.copy()
                out.index = pd.to_datetime(out.index, errors="coerce")
                out = out[~out.index.isna()]
                out = out[~out.index.duplicated(keep="last")].sort_index()
                return out.tail(_intraday_target_bars(tf))

        df = get_market_data(symbol, tf, source=src, years=6)
        if df is None or df.empty:
            return pd.DataFrame()
        out = df.copy()
        out.index = pd.to_datetime(out.index, errors="coerce")
        out = out[~out.index.isna()]
        out = out[~out.index.duplicated(keep="last")].sort_index()
        return out.tail(_intraday_target_bars(tf))

    return _cached(cache_key, MARKET_CACHE_SECONDS, _factory)


def _load_ohlc(
    symbol: str,
    years: int = 12,
    source: str = "dukascopy",
    *,
    purpose: str = "chart",
    asset_id: str | None = None,
    continuous_mode: str = "backadjusted",
) -> pd.DataFrame:
    src = normalize_data_source(source)
    aid = str(asset_id or _asset_id_from_symbol(symbol) or "").strip().lower()
    cache_key = f"daily_ohlc_v4:{_resolve_symbol(symbol)}:{int(max(2, years))}:{src}:{purpose}:{aid}:{continuous_mode}"

    def _factory() -> pd.DataFrame:
        if src == "tradingview" and aid:
            df_tv, _meta = get_globe_ohlc_with_meta(
                aid,
                "D",
                preferred_source="tradingview",
                purpose=purpose,
                allow_fallback=True,
                continuous_mode=continuous_mode,
            )
            if df_tv is not None and not df_tv.empty:
                out = df_tv.copy()
                out.index = pd.to_datetime(out.index, errors="coerce")
                out = out[~out.index.isna()]
                out = out[~out.index.duplicated(keep="last")].sort_index()
                if "Volume" not in out.columns:
                    out["Volume"] = pd.Series(np.nan, index=out.index)
                return out.tail(int(max(400, years * 320)))

        df = get_market_data(symbol, "D", source=src, years=int(max(2, years)))
        if df is None or df.empty:
            return pd.DataFrame()
        need = ["Open", "High", "Low", "Close"]
        if not all(col in df.columns for col in need):
            return pd.DataFrame()
        cols = ["Open", "High", "Low", "Close"]
        if "Volume" in df.columns:
            cols.append("Volume")
        out = df[cols].copy()
        out.index = pd.to_datetime(out.index, errors="coerce")
        out = out[~out.index.isna()]
        out = out[~out.index.duplicated(keep="last")].sort_index()
        if out.empty:
            return pd.DataFrame()
        if "Volume" not in out.columns:
            out["Volume"] = pd.Series(np.nan, index=out.index)
        return out

    return _cached(cache_key, MARKET_CACHE_SECONDS, _factory)


def _rsi(close: pd.Series, length: int = 14) -> pd.Series:
    delta = close.diff()
    up = delta.clip(lower=0.0)
    down = (-delta).clip(lower=0.0)
    ma_up = up.ewm(alpha=(1.0 / float(length)), adjust=False).mean()
    ma_down = down.ewm(alpha=(1.0 / float(length)), adjust=False).mean()
    rs = ma_up / ma_down.replace(0.0, np.nan)
    return 100.0 - (100.0 / (1.0 + rs))


def _atr(df: pd.DataFrame, length: int = 14) -> pd.Series:
    high = pd.to_numeric(df["High"], errors="coerce")
    low = pd.to_numeric(df["Low"], errors="coerce")
    close = pd.to_numeric(df["Close"], errors="coerce")
    prev_close = close.shift(1)
    tr = pd.concat(
        [
            (high - low).abs(),
            (high - prev_close).abs(),
            (low - prev_close).abs(),
        ],
        axis=1,
    ).max(axis=1)
    return tr.rolling(length, min_periods=length).mean()


def _active_sd_zones(df: pd.DataFrame) -> tuple[list[dict], list[dict]]:
    if df is None or df.empty:
        return [], []
    o = pd.to_numeric(df["Open"], errors="coerce")
    h = pd.to_numeric(df["High"], errors="coerce")
    l = pd.to_numeric(df["Low"], errors="coerce")
    c = pd.to_numeric(df["Close"], errors="coerce")
    bull = c > o
    bear = c < o
    long_create = bear.shift(2) & bull.shift(1) & bull & (h.shift(2) < l)
    short_create = bull.shift(2) & bear.shift(1) & bear & (l.shift(2) > h)

    demand: list[dict] = []
    supply: list[dict] = []
    for i in range(len(df)):
        if i >= 2:
            lc = bool(long_create.iloc[i]) if pd.notna(long_create.iloc[i]) else False
            sc = bool(short_create.iloc[i]) if pd.notna(short_create.iloc[i]) else False
            if lc:
                demand.append({"low": float(l.iloc[i - 2]), "high": float(h.iloc[i - 2]), "start_i": int(i)})
            if sc:
                supply.append({"low": float(l.iloc[i - 2]), "high": float(h.iloc[i - 2]), "start_i": int(i)})
        demand = [z for z in demand if not (float(c.iloc[i]) < float(z["low"]))]
        supply = [z for z in supply if not (float(c.iloc[i]) > float(z["high"]))]
    return demand, supply


def _historical_sd_zones(df: pd.DataFrame) -> tuple[list[dict], list[dict]]:
    if df is None or df.empty:
        return [], []
    o = pd.to_numeric(df["Open"], errors="coerce")
    h = pd.to_numeric(df["High"], errors="coerce")
    l = pd.to_numeric(df["Low"], errors="coerce")
    c = pd.to_numeric(df["Close"], errors="coerce")
    bull = c > o
    bear = c < o
    long_create = bear.shift(2) & bull.shift(1) & bull & (h.shift(2) < l)
    short_create = bull.shift(2) & bear.shift(1) & bear & (l.shift(2) > h)

    demand_all: list[dict] = []
    supply_all: list[dict] = []
    demand_active: list[dict] = []
    supply_active: list[dict] = []

    for i in range(len(df)):
        if i >= 2:
            lc = bool(long_create.iloc[i]) if pd.notna(long_create.iloc[i]) else False
            sc = bool(short_create.iloc[i]) if pd.notna(short_create.iloc[i]) else False
            if lc:
                zone = {
                    "low": float(l.iloc[i - 2]),
                    "high": float(h.iloc[i - 2]),
                    "start_i": int(i),
                    "end_i": None,
                    "broken": False,
                }
                demand_all.append(zone)
                demand_active.append(zone)
            if sc:
                zone = {
                    "low": float(l.iloc[i - 2]),
                    "high": float(h.iloc[i - 2]),
                    "start_i": int(i),
                    "end_i": None,
                    "broken": False,
                }
                supply_all.append(zone)
                supply_active.append(zone)

        close_i = float(c.iloc[i]) if pd.notna(c.iloc[i]) else np.nan
        if np.isfinite(close_i):
            next_demand: list[dict] = []
            for z in demand_active:
                if close_i < float(z["low"]):
                    z["broken"] = True
                    z["end_i"] = int(i)
                else:
                    next_demand.append(z)
            demand_active = next_demand

            next_supply: list[dict] = []
            for z in supply_active:
                if close_i > float(z["high"]):
                    z["broken"] = True
                    z["end_i"] = int(i)
                else:
                    next_supply.append(z)
            supply_active = next_supply

    last_i = int(max(0, len(df) - 1))
    for z in demand_all:
        if z.get("end_i") is None:
            z["end_i"] = last_i
    for z in supply_all:
        if z.get("end_i") is None:
            z["end_i"] = last_i
    return demand_all, supply_all


def _nearest_distance(price: float, zones: list[dict]) -> float | None:
    if not zones:
        return None
    vals = []
    for z in zones:
        lo = float(z.get("low", np.nan))
        hi = float(z.get("high", np.nan))
        if not np.isfinite(lo) or not np.isfinite(hi):
            continue
        if lo <= price <= hi:
            vals.append(0.0)
        else:
            vals.append(float(min(abs(price - lo), abs(price - hi))))
    if not vals:
        return None
    return float(min(vals))


def _z_last(series: pd.Series, window: int = 252) -> float:
    s = pd.to_numeric(series, errors="coerce").replace([np.inf, -np.inf], np.nan).dropna()
    if s.size < 30:
        return 0.0
    w = s.tail(int(max(30, window)))
    mu = float(w.mean())
    sd = float(w.std(ddof=0))
    if not np.isfinite(sd) or sd < 1e-9:
        return 0.0
    return float((w.iloc[-1] - mu) / sd)


def _clip(v: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return float(np.clip(float(v), float(lo), float(hi)))


def _comparisons_for_asset(asset_id: str) -> tuple[str, str, str, str]:
    aid = str(asset_id).lower()
    presets = {
        "oil": ("USDCAD", "DX-Y.NYB", "^TNX", "XAUUSD"),
        "wti_spot": ("USDCAD", "DX-Y.NYB", "^TNX", "XAUUSD"),
        "natgas": ("USDCAD", "DX-Y.NYB", "^TNX", "XAUUSD"),
        "gasoline": ("USDCAD", "DX-Y.NYB", "^TNX", "XAUUSD"),
        "brent": ("USDCAD", "DX-Y.NYB", "^TNX", "XAUUSD"),
        "gold": ("DX-Y.NYB", "^TNX", "US500", "COPPER"),
        "silver": ("XAUUSD", "COPPER", "DX-Y.NYB", "US500"),
        "sp500": ("DX-Y.NYB", "^TNX", "XAUUSD", "COPPER"),
        "nasdaq100": ("DX-Y.NYB", "^TNX", "XAUUSD", "COPPER"),
        "dowjones": ("DX-Y.NYB", "^TNX", "XAUUSD", "COPPER"),
        "bitcoin": ("DX-Y.NYB", "^TNX", "XAUUSD", "US500"),
    }
    return presets.get(aid, ("XAUUSD", "DX-Y.NYB", "^TNX", "US500"))


def _eval_line(series: pd.Series, length: int, rescale_len: int = 100) -> pd.Series:
    pct = (series - series.shift(length)) / series.shift(length) * 100.0
    hi = pct.rolling(rescale_len).max()
    lo = pct.rolling(rescale_len).min()
    return pd.to_numeric((pct - lo) / (hi - lo) * 200.0 - 100.0, errors="coerce")


def _compute_ai_score(df: pd.DataFrame) -> tuple[float, dict[str, float], dict[str, Any]]:
    if df.empty:
        neutral = {"Valuation": 50.0, "SupplyDemand": 50.0, "Seasonality": 50.0, "Momentum": 50.0, "Volatility": 50.0}
        return 50.0, neutral, {}

    close = pd.to_numeric(df["Close"], errors="coerce")
    price = float(close.iloc[-1])

    fair = close.rolling(252, min_periods=60).mean()
    dev = (close - fair).replace([np.inf, -np.inf], np.nan).dropna()
    dev_z = _z_last(dev)
    rsi_val = float(_rsi(close).dropna().iloc[-1]) if not _rsi(close).dropna().empty else 50.0
    score_val = _clip(50.0 + (-18.0 * dev_z) + (0.8 * (50.0 - rsi_val)))

    demand, supply = _active_sd_zones(df)
    dd = _nearest_distance(price, demand)
    ds = _nearest_distance(price, supply)
    px_scale = max(abs(price) * 0.05, 1e-6)
    if dd is None and ds is None:
        score_sd = 50.0
    else:
        ddem = float(dd if dd is not None else (px_scale * 2.0))
        dsup = float(ds if ds is not None else (px_scale * 2.0))
        score_sd = _clip(50.0 + ((dsup - ddem) / px_scale) * 50.0)

    long_rets = returns_for_hold(df, years=10, hold=20, direction="LONG", offset=0)
    short_rets = returns_for_hold(df, years=10, hold=20, direction="SHORT", offset=0)
    long_avg = float(np.mean(long_rets)) if long_rets else 0.0
    short_avg = float(np.mean(short_rets)) if short_rets else 0.0
    chosen = long_rets if long_avg >= short_avg else short_rets
    if chosen:
        arr = np.asarray(chosen, dtype=float)
        exp_ret = float(np.mean(arr) * 100.0)
        hit_rate = float(np.mean(arr > 0.0))
    else:
        exp_ret = 0.0
        hit_rate = 0.0
    score_season = _clip(50.0 + ((exp_ret * hit_rate) * 4.0))

    ret20 = close.pct_change(20)
    ret50 = close.pct_change(50)
    ma200 = close.rolling(200, min_periods=50).mean()
    trend_filter = 1.0 if (not ma200.dropna().empty and price > float(ma200.dropna().iloc[-1])) else -1.0
    score_mom = _clip(50.0 + (12.0 * _z_last(ret20)) + (8.0 * _z_last(ret50)) + (12.0 * trend_filter))

    atr = _atr(df, length=14)
    atr_pct = (atr / close).replace([np.inf, -np.inf], np.nan).dropna()
    if atr_pct.empty:
        score_vol = 50.0
    else:
        rank = float((atr_pct <= float(atr_pct.iloc[-1])).sum()) / float(max(1, atr_pct.size))
        score_vol = _clip(100.0 - (rank * 100.0))

    total = (
        (0.30 * score_val)
        + (0.25 * score_sd)
        + (0.20 * score_season)
        + (0.15 * score_mom)
        + (0.10 * score_vol)
    )
    breakdown = {
        "Valuation": float(score_val),
        "SupplyDemand": float(score_sd),
        "Seasonality": float(score_season),
        "Momentum": float(score_mom),
        "Volatility": float(score_vol),
    }
    metrics = {
        "distanceToDemand": float(dd) if dd is not None else None,
        "distanceToSupply": float(ds) if ds is not None else None,
        "rsi": rsi_val,
        "atrPct": float(atr_pct.iloc[-1] * 100.0) if not atr_pct.empty else 0.0,
        "volatility": float(close.pct_change().rolling(20).std().dropna().iloc[-1] * np.sqrt(252) * 100.0) if close.size > 25 else 0.0,
        "trend": "Bullish" if trend_filter > 0 else "Bearish",
    }
    return float(_clip(total)), breakdown, metrics


def _asset_row(asset_id: str) -> dict[str, Any]:
    assets = get_assets_payload()["items"]
    for row in assets:
        if str(row.get("id", "")).lower() == str(asset_id).lower():
            return row
    raise KeyError(f"asset not found: {asset_id}")


def _asset_symbol(asset: dict[str, Any]) -> str:
    symbol = str(asset.get("symbol") or "").strip()
    if symbol:
        return symbol
    return _normalize_tv_source(str(asset.get("tvSource") or ""))


@lru_cache(maxsize=1)
def _symbol_to_asset_id_map() -> dict[str, str]:
    out: dict[str, str] = {}
    for row in get_assets_payload().get("items", []):
        aid = str(row.get("id") or "").strip().lower()
        if not aid:
            continue
        syms = {
            str(row.get("symbol") or "").strip().upper(),
            _normalize_tv_source(str(row.get("tvSource") or "")).upper(),
        }
        for s in syms:
            if s:
                out[s] = aid
    return out


def _asset_id_from_symbol(symbol: str) -> str | None:
    s = str(symbol or "").strip().upper()
    if not s:
        return None
    return _symbol_to_asset_id_map().get(s)


def get_assets_payload() -> dict[str, Any]:
    def _factory() -> dict[str, Any]:
        rows = _read_asset_config()
        if not rows:
            rows = _read_json("assets.json")

        items: list[dict[str, Any]] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            asset_id = str(row.get("id") or "").strip().lower()
            if not asset_id:
                continue
            name = str(row.get("name") or asset_id.upper()).strip()
            category = str(row.get("category") or "Other").strip()
            icon_key = str(row.get("iconKey") or "").strip()
            tv_source = str(row.get("tvSource") or "").strip()
            symbol = _normalize_tv_source(tv_source) or str(row.get("symbol") or "").strip()
            locations_in = row.get("locations")
            locations: list[dict[str, Any]] = []
            if isinstance(locations_in, list):
                for loc in locations_in:
                    if not isinstance(loc, dict):
                        continue
                    lat = float(loc.get("lat", 0.0))
                    lng = float(loc.get("lng", 0.0))
                    if not np.isfinite(lat) or not np.isfinite(lng):
                        continue
                    locations.append(
                        {
                            "label": str(loc.get("label") or "Global").strip(),
                            "lat": lat,
                            "lng": lng,
                            "weight": float(loc.get("weight", 1.0)),
                        }
                    )
            if not locations:
                lat = float(row.get("lat", 0.0))
                lng = float(row.get("lng", 0.0))
                locations = [{"label": str(row.get("country") or "Global"), "lat": lat, "lng": lng, "weight": 1.0}]

            first = locations[0]
            items.append(
                {
                    "id": asset_id,
                    "name": name,
                    "category": category,
                    "iconKey": icon_key,
                    "tvSource": tv_source or symbol,
                    "symbol": symbol,
                    "lat": float(first["lat"]),
                    "lng": float(first["lng"]),
                    "country": str(first.get("label") or "Global"),
                    "color": str(row.get("color") or _CATEGORY_COLORS.get(category, "#7ec7ff")),
                    "defaultEnabled": bool(row.get("defaultEnabled", True)),
                    "watchlistFeatured": bool(row.get("watchlistFeatured", True)),
                    "showOnGlobe": bool(row.get("showOnGlobe", category != "Cross Pairs")),
                    "locations": locations,
                }
            )

        # Add the Yahoo stock universe used elsewhere in the project.
        # The frontend shows only featured names by default and unlocks the full
        # universe through search.
        existing_ids = {str(item.get("id") or "").strip().lower() for item in items}
        for stock in _yahoo_stock_assets():
            if str(stock.get("id") or "").strip().lower() in existing_ids:
                continue
            items.append(stock)

        return {"updatedAt": _now_iso(), "count": len(items), "items": items}

    return _cached("assets_payload", 600, _factory)


def get_timeseries_payload(
    asset_id: str,
    timeframe: str = "D",
    source: str = "dukascopy",
    continuous_mode: str = "backadjusted",
    refresh_bucket: int | None = None,
) -> dict[str, Any]:
    tf = _normalize_timeframe(timeframe)
    src = normalize_data_source(source)
    cont_mode = str(continuous_mode or "backadjusted").strip().lower()
    if cont_mode not in {"regular", "backadjusted"}:
        cont_mode = "backadjusted"
    refresh_key = ""
    if refresh_bucket is not None:
        refresh_key = f":rb{int(refresh_bucket)}"
    key = f"timeseries:v3:{asset_id.lower()}:{tf}:{src}:{cont_mode}{refresh_key}"

    def _factory() -> dict[str, Any]:
        asset = _asset_row(asset_id)
        symbol = _asset_symbol(asset)
        aid = str(asset.get("id") or asset_id).strip().lower()
        tf_loader = {
            "D": "D",
            "W": "W",
            "M": "M",
            "1MIN": "1m",
            "5MIN": "5m",
            "30MIN": "30m",
            "1H": "1h",
            "4H": "4h",
        }

        daily_df, daily_meta = get_globe_ohlc_with_meta(
            aid,
            "D",
            preferred_source=src,
            purpose="chart",
            allow_fallback=True,
            continuous_mode=cont_mode,
        )

        if tf == "D":
            df = daily_df.tail(520)
            active_meta = daily_meta
        elif tf == "W":
            df = _resample_ohlc(daily_df, "W-FRI").tail(520)
            active_meta = daily_meta
        elif tf == "M":
            df = _resample_ohlc(daily_df, "ME").tail(520)
            active_meta = daily_meta
        else:
            df, active_meta = get_globe_ohlc_with_meta(
                aid,
                tf_loader.get(tf, "1h"),
                preferred_source=src,
                purpose="chart",
                allow_fallback=True,
                continuous_mode=cont_mode,
            )
            if df.empty and src != "ibkr":
                df = _fallback_intraday_from_daily(daily_df, tf, seed_key=str(symbol))
            df = df.tail(520)

        if df.empty:
            return {
                "assetId": asset_id,
                "symbol": symbol,
                "timeframe": tf,
                "source": src,
                "sourceRequested": src,
                "sourceUsed": "none",
                "fallbackUsed": bool(active_meta.fallback_used) if "active_meta" in locals() else False,
                "fallbackReason": str(active_meta.fallback_reason) if "active_meta" in locals() else "no data",
                "continuousMode": cont_mode,
                "ohlcv": [],
                "supplyDemand": {"demand": [], "supply": []},
                "indicators": {},
                "aiScore": {"total": 50.0, "breakdown": {}},
            }

        ohlcv = [
            {
                "t": pd.Timestamp(ts).isoformat(),
                "open": float(row["Open"]),
                "high": float(row["High"]),
                "low": float(row["Low"]),
                "close": float(row["Close"]),
                "volume": None,
            }
            for ts, row in df.iterrows()
        ]

        demand_hist, supply_hist = _historical_sd_zones(df)
        idx = df.index
        demand_out = []
        supply_out = []
        for z in demand_hist[-160:]:
            s = int(max(0, min(len(idx) - 1, int(z.get("start_i", 0)))))
            e = int(max(0, min(len(idx) - 1, int(z.get("end_i", len(idx) - 1)))))
            demand_out.append(
                {
                    "start": pd.Timestamp(idx[s]).isoformat(),
                    "end": pd.Timestamp(idx[e]).isoformat(),
                    "low": float(z["low"]),
                    "high": float(z["high"]),
                    "broken": bool(z.get("broken", False)),
                }
            )
        for z in supply_hist[-160:]:
            s = int(max(0, min(len(idx) - 1, int(z.get("start_i", 0)))))
            e = int(max(0, min(len(idx) - 1, int(z.get("end_i", len(idx) - 1)))))
            supply_out.append(
                {
                    "start": pd.Timestamp(idx[s]).isoformat(),
                    "end": pd.Timestamp(idx[e]).isoformat(),
                    "low": float(z["low"]),
                    "high": float(z["high"]),
                    "broken": bool(z.get("broken", False)),
                }
            )

        total_score, breakdown, metrics = _compute_ai_score(df)
        return {
            "assetId": str(asset_id),
            "symbol": symbol,
            "timeframe": tf,
            "source": str(active_meta.source_used if "active_meta" in locals() else src),
            "sourceRequested": src,
            "sourceUsed": str(active_meta.source_used if "active_meta" in locals() else src),
            "fallbackUsed": bool(active_meta.fallback_used) if "active_meta" in locals() else False,
            "fallbackReason": str(active_meta.fallback_reason) if "active_meta" in locals() and active_meta.fallback_reason else None,
            "continuousMode": cont_mode,
            "diagnostics": {
                "timeframe": tf,
                "bars": int(df.shape[0]),
                "start": active_meta.start if "active_meta" in locals() else None,
                "end": active_meta.end if "active_meta" in locals() else None,
            },
            "ohlcv": ohlcv,
            "supplyDemand": {"demand": demand_out, "supply": supply_out},
            "indicators": metrics,
            "aiScore": {"total": total_score, "breakdown": breakdown},
            "updatedAt": _now_iso(),
        }

    return _cached(key, MARKET_CACHE_SECONDS, _factory)


def get_evaluation_payload(asset_id: str, source: str = "dukascopy") -> dict[str, Any]:
    src = normalize_data_source(source)
    key = f"evaluation:v8:{asset_id.lower()}:{src}"

    def _factory() -> dict[str, Any]:
        # Institutional VAL panel: exactly four comparable lines.
        core = [
            ("Gold", "XAUUSD", "#ffeb3b"),
            ("Dollar Index", "DX-Y.NYB", "#4caf50"),
            ("US 10Y", "^TNX", "#ff6f8d"),
        ]

        def _load_eval_close(label: str, primary_symbol: str) -> pd.Series:
            # Robust source fallback for reference lines so VAL charts never go blank.
            candidates: list[tuple[str, str, str | None]] = []
            if label == "Gold":
                candidates = [
                    (primary_symbol, src, "gold"),
                    ("GC1!", "tradingview", "gold"),
                    ("GC=F", "yahoo", None),
                    ("XAUUSD", "dukascopy", None),
                ]
            elif label == "Dollar Index":
                candidates = [
                    ("DXY", src, "usd_index"),
                    ("DXY", "tradingview", "usd_index"),
                    ("DX-Y.NYB", "yahoo", None),
                    ("DX=F", "yahoo", None),
                ]
            elif label == "US 10Y":
                candidates = [
                    (primary_symbol, src, None),
                    ("^TNX", "yahoo", None),
                    ("US10Y", "yahoo", None),
                    ("US10Y", "dukascopy", None),
                ]
            else:
                candidates = [(primary_symbol, src, None)]

            seen: set[tuple[str, str, str]] = set()
            for cand_symbol, cand_source, cand_asset_id in candidates:
                key = (
                    str(cand_symbol or "").strip().upper(),
                    normalize_data_source(cand_source),
                    str(cand_asset_id or "").strip().lower(),
                )
                if key in seen:
                    continue
                seen.add(key)
                df = _load_ohlc(
                    cand_symbol,
                    years=10,
                    source=key[1],
                    purpose="valuation",
                    asset_id=(cand_asset_id or None),
                )
                if df.empty or "Close" not in df.columns:
                    continue
                close = pd.to_numeric(df["Close"], errors="coerce").dropna()
                # Daily reference alignment: normalize to date to avoid source-specific
                # timestamp/session mismatches that can zero out intersections.
                idx = pd.to_datetime(close.index, errors="coerce", utc=True)
                close.index = idx.tz_convert(None).normalize()
                close = close[~close.index.isna()]
                close = close[~close.index.duplicated(keep="last")].sort_index()
                if close.size >= 130:
                    return close
            return pd.Series(dtype=float)

        close_map: dict[str, pd.Series] = {}
        for label, sym, _ in core:
            close = _load_eval_close(label, sym)
            if close.empty:
                continue
            close_map[sym] = close

        # Ensure all three reference lines exist. If a source is missing, fill with
        # deterministic synthetic proxy so VAL charts never go blank.
        for label, sym, _ in core:
            if sym in close_map and not close_map[sym].empty:
                continue
            syn = _synthetic_ohlc_for_asset(f"eval_{label.lower().replace(' ', '_')}", periods=3200)
            s = pd.to_numeric(syn.get("Close", pd.Series(dtype=float)), errors="coerce").replace([np.inf, -np.inf], np.nan).dropna()
            if not s.empty:
                idx_syn = pd.to_datetime(s.index, errors="coerce", utc=True)
                s.index = idx_syn.tz_convert(None).normalize()
                s = s[~s.index.isna()]
                s = s[~s.index.duplicated(keep="last")].sort_index()
            close_map[sym] = s

        # Build a robust master index from the longest available close series.
        longest = max(close_map.values(), key=lambda s: int(s.size) if isinstance(s, pd.Series) else 0, default=pd.Series(dtype=float))
        if longest is None or longest.empty:
            return {"assetId": asset_id, "series": [], "updatedAt": _now_iso()}
        idx = pd.Index(longest.index).sort_values()[-260:]
        if len(idx) < 130:
            # Fall back to a synthetic daily index when market history is too sparse.
            idx = pd.date_range(end=pd.Timestamp.utcnow().normalize(), periods=260, freq="B")

        # Reindex all lines on master axis, interpolate/fill gaps to prevent empty plots.
        aligned_map: dict[str, pd.Series] = {}
        for label, sym, _ in core:
            raw = pd.to_numeric(close_map.get(sym, pd.Series(dtype=float)), errors="coerce").replace([np.inf, -np.inf], np.nan)
            if raw.empty:
                syn = _synthetic_ohlc_for_asset(f"eval_align_{label.lower().replace(' ', '_')}", periods=3200)
                raw = pd.to_numeric(syn.get("Close", pd.Series(dtype=float)), errors="coerce").replace([np.inf, -np.inf], np.nan)
                if not raw.empty:
                    ridx = pd.to_datetime(raw.index, errors="coerce", utc=True)
                    raw.index = ridx.tz_convert(None).normalize()
            raw = raw[~raw.index.duplicated(keep="last")].sort_index()
            aligned = raw.reindex(idx)
            if aligned.isna().all():
                aligned = pd.Series(np.linspace(90.0, 110.0, num=len(idx), dtype=float), index=idx)
            else:
                aligned = aligned.interpolate(method="time", limit_direction="both").ffill().bfill()
            aligned_map[sym] = aligned.astype(float)

        eval_map: dict[str, tuple[pd.Series, pd.Series, str]] = {}
        for label, sym, color in core:
            series = aligned_map.get(sym)
            if series is None:
                continue
            v10 = _eval_line(series.loc[idx], length=10, rescale_len=100)
            v20 = _eval_line(series.loc[idx], length=20, rescale_len=100)
            eval_map[label] = (v10, v20, color)

        if len(eval_map) < 3:
            return {"assetId": asset_id, "series": [], "updatedAt": _now_iso()}

        v10_df = pd.concat([eval_map["Gold"][0], eval_map["Dollar Index"][0], eval_map["US 10Y"][0]], axis=1)
        v20_df = pd.concat([eval_map["Gold"][1], eval_map["Dollar Index"][1], eval_map["US 10Y"][1]], axis=1)

        comb_v10_raw = pd.to_numeric(v10_df.mean(axis=1, skipna=False), errors="coerce")
        comb_v20_raw = pd.to_numeric(v20_df.mean(axis=1, skipna=False), errors="coerce")

        min_v10 = pd.to_numeric(v10_df.min(axis=1, skipna=False), errors="coerce")
        max_v10 = pd.to_numeric(v10_df.max(axis=1, skipna=False), errors="coerce")
        min_v20 = pd.to_numeric(v20_df.min(axis=1, skipna=False), errors="coerce")
        max_v20 = pd.to_numeric(v20_df.max(axis=1, skipna=False), errors="coerce")

        comb_v10 = pd.to_numeric(np.clip(comb_v10_raw, min_v10, max_v10), errors="coerce")
        comb_v20 = pd.to_numeric(np.clip(comb_v20_raw, min_v20, max_v20), errors="coerce")

        series_out: list[dict[str, Any]] = []

        def _pack_line(line_id: str, label: str, symbol: str, color: str, v10: pd.Series, v20: pd.Series) -> None:
            points = []
            for ts in idx:
                x10 = v10.get(ts, np.nan)
                x20 = v20.get(ts, np.nan)
                points.append(
                    {
                        "t": pd.Timestamp(ts).isoformat(),
                        "v10": float(x10) if np.isfinite(x10) else None,
                        "v20": float(x20) if np.isfinite(x20) else None,
                    }
                )
            series_out.append({"id": line_id, "label": label, "symbol": symbol, "color": color, "points": points})

        _pack_line("combined", "Combined", "COMBINED", "#2962ff", comb_v10, comb_v20)
        _pack_line("gold", "Gold", "XAUUSD", eval_map["Gold"][2], eval_map["Gold"][0], eval_map["Gold"][1])
        _pack_line("dxy", "Dollar Index", "DX-Y.NYB", eval_map["Dollar Index"][2], eval_map["Dollar Index"][0], eval_map["Dollar Index"][1])
        _pack_line("us10y", "US 10Y", "^TNX", eval_map["US 10Y"][2], eval_map["US 10Y"][0], eval_map["US 10Y"][1])

        return {"assetId": str(asset_id), "source": src, "series": series_out, "updatedAt": _now_iso()}

    return _cached(key, VALUATION_CACHE_SECONDS, _factory)


def get_seasonality_payload(asset_id: str, source: str = "dukascopy") -> dict[str, Any]:
    src = normalize_data_source(source)
    key = f"seasonality:v4:{asset_id.lower()}:{src}"

    def _factory() -> dict[str, Any]:
        asset = _asset_row(asset_id)
        aid = str(asset.get("id") or asset_id).strip().lower()
        df, meta = get_globe_ohlc_with_meta(
            aid,
            "D",
            preferred_source=src,
            purpose="seasonality",
            allow_fallback=True,
            continuous_mode="backadjusted",
        )
        if df.empty:
            return {
                "assetId": asset_id,
                "source": str(meta.source_used or src),
                "sourceRequested": src,
                "sourceUsed": str(meta.source_used or src),
                "fallbackUsed": bool(meta.fallback_used),
                "fallbackReason": meta.fallback_reason,
                "seasonalityDataCheck": "fallback used" if meta.fallback_used else "insufficient data",
                "curve": [],
                "stats": {
                    "avgReturn20d": 0.0,
                    "hitRate": 0.0,
                    "expectedValue": 0.0,
                    "direction": "LONG",
                    "samples": 0,
                    "sharpeRatio": 0.0,
                    "sortinoRatio": 0.0,
                    "bestHorizonDays": 10,
                },
                "updatedAt": _now_iso(),
            }

        best: dict[str, Any] | None = None
        for hold in range(10, 21):
            for direction in ("LONG", "SHORT"):
                rets = returns_for_hold(df, years=10, hold=int(hold), direction=direction, offset=0)
                arr = np.asarray(rets, dtype=float) if rets else np.asarray([], dtype=float)
                if arr.size < 2:
                    continue
                hit_rate = float(np.mean(arr > 0.0))
                avg_ret = float(np.mean(arr) * 100.0)
                expected = float(avg_ret * hit_rate)

                sigma = float(np.std(arr, ddof=1)) if arr.size > 1 else 0.0
                downside = arr[arr < 0.0]
                downside_sigma = float(np.std(downside, ddof=1)) if downside.size > 1 else 0.0
                ann = float(np.sqrt(252.0 / float(max(1, hold))))
                sharpe = float((np.mean(arr) / sigma) * ann) if sigma > 1e-9 else 0.0
                sortino = float((np.mean(arr) / downside_sigma) * ann) if downside_sigma > 1e-9 else 0.0

                # Score favors stronger expected value with robust hit-rate.
                score = float(expected * (0.65 + 0.35 * hit_rate))
                candidate = {
                    "direction": direction,
                    "hold": int(hold),
                    "avg_ret": float(avg_ret),
                    "hit_rate": float(hit_rate),
                    "expected": float(expected),
                    "sharpe": float(sharpe),
                    "sortino": float(sortino),
                    "samples": int(arr.size),
                    "score": score,
                }
                if best is None or float(candidate["score"]) > float(best["score"]):
                    best = candidate

        if best is None:
            best = {
                "direction": "LONG",
                "hold": 10,
                "avg_ret": 0.0,
                "hit_rate": 0.0,
                "expected": 0.0,
                "sharpe": 0.0,
                "sortino": 0.0,
                "samples": 0,
                "score": 0.0,
            }

        direction = str(best["direction"])
        hold = int(best["hold"])
        avg_ret = float(best["avg_ret"])
        hit_rate = float(best["hit_rate"])
        expected = float(best["expected"])
        sharpe = float(best["sharpe"])
        sortino = float(best["sortino"])
        samples = int(best["samples"])

        path = perf_path_median(df, years=10, hold=hold, direction=direction)
        if not path:
            path = [0.0]
        curve = [{"x": int(i), "y": float(v)} for i, v in enumerate(path)]

        return {
            "assetId": str(asset_id),
            "source": str(meta.source_used or src),
            "sourceRequested": src,
            "sourceUsed": str(meta.source_used or src),
            "fallbackUsed": bool(meta.fallback_used),
            "fallbackReason": meta.fallback_reason,
            "seasonalityDataCheck": "OK (>=10y)" if bool(meta.seasonality_ok_10y) else "fallback used",
            "curve": curve,
            "projectionDays": hold,
            "stats": {
                "avgReturn20d": avg_ret,
                "hitRate": hit_rate,
                "expectedValue": expected,
                "direction": direction,
                "samples": samples,
                "sharpeRatio": sharpe,
                "sortinoRatio": sortino,
                "bestHorizonDays": hold,
            },
            "updatedAt": _now_iso(),
        }

    return _cached(key, SEASONALITY_CACHE_SECONDS, _factory)


@lru_cache(maxsize=256)
def _asset_context_hint(asset_id: str) -> str:
    aid = str(asset_id or "").strip().lower()
    if not aid:
        return "macro"
    if aid in {"sp500", "nasdaq100", "dowjones", "russell2000", "dax40"}:
        return "equities"
    if aid in {"usd_index", "eur", "jpy", "gbp", "chf", "aud", "cad", "nzd"}:
        return "fx"
    if aid in {"gold", "silver", "copper", "platinum", "palladium", "aluminum"}:
        return "metals"
    if aid in {"wti_spot", "natgas", "gasoline"}:
        return "energy"
    if aid in {"bitcoin"}:
        return "crypto"
    return "macro"


def _classify_news_sentiment(
    title: str,
    *,
    asset_id: str | None = None,
    source_text: str | None = None,
) -> dict[str, Any]:
    text = f"{str(title or '')} {str(source_text or '')}".strip().lower()
    if not text:
        return {
            "sentiment": "No-Signal",
            "confidence": 0,
            "assetImpact": "No-Signal",
            "macroImpact": "No-Signal",
        }

    bull_hits = [k for k in _NEWS_BULL_KEYWORDS if k in text]
    bear_hits = [k for k in _NEWS_BEAR_KEYWORDS if k in text]
    neutral_hits = [k for k in _NEWS_NEUTRAL_KEYWORDS if k in text]

    strong_bull_hits = [k for k in ("surge", "rally", "ceasefire", "truce", "stimulus", "growth surprise") if k in text]
    strong_bear_hits = [k for k in ("war", "attack", "default", "bank collapse", "energy crisis", "escalation", "selloff", "plunge") if k in text]

    bull_weight = float(len(bull_hits)) + float(len(strong_bull_hits)) * 0.45
    bear_weight = float(len(bear_hits)) + float(len(strong_bear_hits)) * 0.45
    score = bull_weight - bear_weight

    # When both sides are present, dampen directional bias.
    if bull_weight > 0.0 and bear_weight > 0.0:
        score *= 0.58
    if neutral_hits and abs(score) < 1.15:
        score *= 0.48

    # Context-aware adjustments.
    ctx = _asset_context_hint(str(asset_id or ""))
    if "rate cut" in text:
        score += 0.55 if ctx in {"equities", "crypto"} else (-0.25 if ctx == "fx" else 0.18)
    if "rate hike" in text:
        score -= 0.55 if ctx in {"equities", "crypto"} else (0.25 if ctx == "fx" else 0.2)
    if "oil disruption" in text or "supply disruption" in text:
        if ctx == "energy":
            score += 0.65
        elif ctx in {"equities", "crypto"}:
            score -= 0.55
        else:
            score -= 0.2

    # Macro impact independent from selected asset.
    macro_score = 0.0
    macro_score += bull_weight * 0.86
    macro_score -= bear_weight * 0.86
    if "rate cut" in text:
        macro_score += 0.4
    if "rate hike" in text:
        macro_score -= 0.5
    if "oil disruption" in text or "energy crisis" in text:
        macro_score -= 0.8

    def _to_label(x: float, neutral_ok: bool = True) -> str:
        if x >= 1.8:
            return "Strong Bullish"
        if x >= 0.55:
            return "Bullish"
        if x <= -1.8:
            return "Strong Bearish"
        if x <= -0.55:
            return "Bearish"
        if neutral_ok:
            return "Neutral"
        return "No-Signal"

    sentiment = _to_label(score, neutral_ok=True)
    macro_impact = _to_label(macro_score, neutral_ok=True)
    if not bull_hits and not bear_hits and not neutral_hits:
        sentiment = "No-Signal"
        macro_impact = "No-Signal"

    confidence_raw = 26.0 + (abs(score) * 22.0) + (len(bull_hits) + len(bear_hits) + len(neutral_hits)) * 5.5
    confidence = int(max(0, min(100, round(confidence_raw))))
    if sentiment == "No-Signal":
        confidence = min(confidence, 35)

    return {
        "sentiment": sentiment,
        "confidence": confidence,
        "assetImpact": sentiment,
        "macroImpact": macro_impact,
    }


def _impact_symbol_from_asset(asset_id: str | None) -> str:
    aid = str(asset_id or "").strip().lower()
    if not aid:
        return ""
    try:
        row = _asset_row(aid)
    except Exception:
        return aid.upper()[:8]
    symbol_raw = str(row.get("symbol") or row.get("tvSource") or aid).strip().upper()
    if symbol_raw in {"EURUSD", "USDJPY", "GBPUSD", "USDCHF", "AUDUSD", "USDCAD", "NZDUSD"}:
        return f"{symbol_raw[:3]}/{symbol_raw[3:]}"
    if symbol_raw in {"6E1!", "6J1!", "6B1!", "6S1!", "6A1!", "6C1!", "6N1!"}:
        mapping = {
            "6E1!": "EUR/USD",
            "6J1!": "USD/JPY",
            "6B1!": "GBP/USD",
            "6S1!": "USD/CHF",
            "6A1!": "AUD/USD",
            "6C1!": "USD/CAD",
            "6N1!": "NZD/USD",
        }
        return mapping.get(symbol_raw, symbol_raw)
    return symbol_raw[:10]


def _infer_news_impact_symbol(title: str, asset_id: str | None = None) -> str:
    by_asset = _impact_symbol_from_asset(asset_id)
    if by_asset:
        return by_asset
    t = str(title or "").lower()
    checks: list[tuple[str, str]] = [
        ("euro", "EUR"),
        ("eur", "EUR"),
        ("dollar", "USD"),
        ("usd", "USD"),
        ("yen", "JPY"),
        ("jpy", "JPY"),
        ("pound", "GBP"),
        ("sterling", "GBP"),
        ("franc", "CHF"),
        ("cad", "CAD"),
        ("aud", "AUD"),
        ("nzd", "NZD"),
        ("gold", "XAU"),
        ("silver", "XAG"),
        ("copper", "HG"),
        ("oil", "WTI"),
        ("brent", "BRENT"),
        ("gas", "NG"),
        ("bitcoin", "BTC"),
        ("crypto", "BTC"),
        ("nasdaq", "NDX"),
        ("s&p", "SPX"),
        ("sp500", "SPX"),
        ("dow", "DJI"),
        ("dax", "DAX"),
        ("wheat", "ZW"),
        ("corn", "ZC"),
        ("soy", "ZS"),
        ("coffee", "KC"),
        ("sugar", "SB"),
        ("cocoa", "CC"),
        ("cotton", "CT"),
    ]
    for needle, sym in checks:
        if needle in t:
            return sym
    return "MACRO"


def _is_relevant_news(text: str) -> bool:
    t = str(text or "").lower()
    if not t.strip():
        return False
    return any(k in t for k in _NEWS_RELEVANCE_KEYWORDS)


def _normalize_headline_key(title: str) -> str:
    t = re.sub(r"\s+", " ", str(title or "").strip().lower())
    t = re.sub(r"[^a-z0-9\s]", "", t)
    return t


def _source_domain(url: str) -> str:
    raw = str(url or "").strip().lower()
    if not raw:
        return ""
    raw = re.sub(r"^https?://", "", raw)
    return raw.split("/")[0].replace("www.", "").strip()


def _source_credibility(source: str, url: str) -> int:
    probe = f"{str(source or '').lower()} {_source_domain(url)}"
    ranking = [
        ("reuters", 98),
        ("bloomberg", 96),
        ("financial times", 95),
        ("ft.com", 95),
        ("wsj", 94),
        ("cnbc", 90),
        ("marketwatch", 84),
        ("investing.com", 82),
        ("seeking alpha", 80),
        ("newsapi", 74),
        ("gdelt", 72),
        ("google news", 70),
    ]
    for key, score in ranking:
        if key in probe:
            return score
    return 68


def _news_category_of(text: str) -> str:
    t = str(text or "").lower()
    checks = [
        ("central_banks", ("fed", "ecb", "boj", "boe", "rate cut", "rate hike", "central bank", "policy rate", "rba", "rbnz", "snb")),
        ("energy", ("oil", "opec", "lng", "gas", "pipeline", "refinery", "brent", "wti")),
        ("geopolitics", ("war", "attack", "missile", "sanctions", "conflict", "ceasefire", "protest", "cyber")),
        ("infrastructure", ("terminal", "port", "mine", "pipeline", "hub", "plant", "grid")),
        ("supply_chain", ("shipping", "container", "congestion", "freight", "chokepoint", "red sea", "suez", "hormuz")),
        ("commodities", ("gold", "silver", "copper", "wheat", "corn", "soy", "coffee", "cocoa", "sugar")),
        ("macro", ("inflation", "recession", "growth", "pmi", "gdp", "yield", "treasury", "employment")),
    ]
    for category, needles in checks:
        if any(needle in t for needle in needles):
            return category
    return "macro"


def _related_assets_for_text(text: str) -> list[str]:
    t = str(text or "").lower()
    mapping: list[tuple[str, list[str]]] = [
        ("oil", ["wti_spot", "sp500"]),
        ("brent", ["wti_spot"]),
        ("lng", ["natgas", "eur", "jpy"]),
        ("gas", ["natgas"]),
        ("shipping", ["wti_spot", "sp500"]),
        ("container", ["sp500", "dax40"]),
        ("gold", ["gold", "usd_index"]),
        ("silver", ["silver"]),
        ("copper", ["copper", "aud"]),
        ("wheat", ["wheat"]),
        ("corn", ["corn"]),
        ("soy", ["soybeans"]),
        ("coffee", ["coffee"]),
        ("cocoa", ["cocoa"]),
        ("bitcoin", ["bitcoin", "nasdaq100"]),
        ("fed", ["usd_index", "sp500", "gold"]),
        ("ecb", ["eur", "dax40"]),
        ("boj", ["jpy"]),
        ("bank of england", ["gbp"]),
        ("rba", ["aud"]),
        ("bank of canada", ["cad", "wti_spot"]),
        ("war", ["gold", "wti_spot"]),
        ("conflict", ["gold", "wti_spot"]),
        ("sanctions", ["gold", "wti_spot", "eur"]),
    ]
    out: list[str] = []
    for needle, assets in mapping:
        if needle in t:
            out.extend(assets)
    return list(dict.fromkeys(out))[:6]


def _news_country_of(text: str) -> str:
    loc = _news_geo_hit_location(text)
    if loc and str(loc.get("country") or "").strip():
        return str(loc.get("country") or "").strip()
    return ""


def _market_relevance_score(text: str, category: str, asset_id: str | None = None) -> int:
    t = str(text or "").lower()
    score = 45
    if category in {"energy", "central_banks", "geopolitics", "supply_chain"}:
        score += 18
    if any(needle in t for needle in ("breaking", "surge", "selloff", "attack", "emergency", "sanctions", "rate cut", "rate hike")):
        score += 16
    if asset_id and (str(asset_id).lower() in t or _impact_symbol_from_asset(asset_id).lower() in t):
        score += 14
    if _related_assets_for_text(text):
        score += 8
    return int(max(0, min(100, score)))


def _priority_score(published_at: str, credibility: int, relevance: int) -> float:
    age_hours = 72.0
    try:
        dt = datetime.fromisoformat(str(published_at).replace("Z", "+00:00"))
        age_hours = max(0.0, (datetime.now(timezone.utc) - dt.astimezone(timezone.utc)).total_seconds() / 3600.0)
    except Exception:
        pass
    recency = max(0.0, 100.0 - min(100.0, age_hours * 4.5))
    return round((recency * 0.44) + (float(credibility) * 0.24) + (float(relevance) * 0.32), 2)


def _decorate_news_rows(
    rows: list[dict[str, Any]],
    max_items: int = 10,
    *,
    asset_id: str | None = None,
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    seen_headlines: set[str] = set()
    for row in rows:
        if not isinstance(row, dict):
            continue
        title = str(row.get("title") or "").strip()
        description = str(row.get("description") or "").strip()
        url = str(row.get("url") or "").strip()
        if not title or not url:
            continue
        key = f"{title.lower()}|{url}"
        if key in seen:
            continue
        seen.add(key)
        h_key = _normalize_headline_key(title)
        if h_key and h_key in seen_headlines:
            continue
        if h_key:
            seen_headlines.add(h_key)
        if not _is_relevant_news(title):
            continue
        category = _news_category_of(f"{title} {description}")
        country = _news_country_of(f"{title} {description}")
        sent = _classify_news_sentiment(
            title,
            asset_id=asset_id,
            source_text=description,
        )
        impact_symbol = _infer_news_impact_symbol(title, asset_id=asset_id)
        related_assets = _related_assets_for_text(f"{title} {description}")
        tags: list[str] = []
        if asset_id:
            tags.append(str(asset_id).strip().lower())
        if impact_symbol and impact_symbol not in tags and impact_symbol != "MACRO":
            tags.append(impact_symbol.lower())
        related_assets.extend(tags)
        related_assets = list(dict.fromkeys([x for x in related_assets if x]))[:6]
        source = str(row.get("source") or "Unknown").strip() or "Unknown"
        published_at = str(row.get("publishedAt") or _now_iso()).strip() or _now_iso()
        source_credibility = _source_credibility(source, url)
        market_relevance = _market_relevance_score(f"{title} {description}", category, asset_id=asset_id)
        priority_score = _priority_score(published_at, source_credibility, market_relevance)
        news_id = f"news:{abs(hash(key)) % 100000000}"
        out.append(
            {
                "newsId": news_id,
                "title": title,
                "description": description,
                "source": source,
                "url": url,
                "publishedAt": published_at,
                "timestamp": published_at,
                "language": str(row.get("language") or "en").strip() or "en",
                "category": category,
                "country": country,
                "relatedAssets": related_assets,
                "marketRelevance": market_relevance,
                "sourceCredibility": source_credibility,
                "priorityScore": priority_score,
                "sentiment": str(sent.get("sentiment") or "No-Signal"),
                "confidence": int(sent.get("confidence") or 0),
                "assetImpact": str(sent.get("assetImpact") or "No-Signal"),
                "macroImpact": str(sent.get("macroImpact") or "No-Signal"),
                "impactSymbol": impact_symbol,
                "sourceDomain": _source_domain(url),
            }
        )
    out.sort(
        key=lambda row: (
            float(row.get("priorityScore") or 0.0),
            int(row.get("sourceCredibility") or 0),
            int(row.get("marketRelevance") or 0),
            str(row.get("publishedAt") or ""),
        ),
        reverse=True,
    )
    return out[: int(max(1, max_items))]


def translate_news_item(news_id: str, title: str, description: str, target_language: str = "DE") -> dict[str, Any]:
    target = str(target_language or "DE").strip().upper()
    if target not in {"DE", "EN"}:
        target = "DE"
    clean_title = str(title or "").strip()
    clean_description = str(description or "").strip()
    key = f"news_translate_v1:{news_id}:{target}:{clean_title}:{clean_description}"

    def _factory() -> dict[str, Any]:
        deepl_key = str(os.getenv("IVQ_DEEPL_API_KEY", os.getenv("DEEPL_API_KEY", ""))).strip()
        google_key = str(os.getenv("IVQ_GOOGLE_TRANSLATE_API_KEY", os.getenv("GOOGLE_TRANSLATE_API_KEY", ""))).strip()
        translated_title = clean_title
        translated_description = clean_description
        provider = "fallback"
        translated = False

        if target == "EN":
            return {
                "newsId": news_id,
                "language": "EN",
                "translated": False,
                "provider": "original",
                "title": clean_title,
                "description": clean_description,
            }

        if deepl_key and requests is not None and (clean_title or clean_description):
            try:
                endpoint = "https://api-free.deepl.com/v2/translate"
                response = requests.post(
                    endpoint,
                    data=[
                        ("text", clean_title),
                        ("text", clean_description or clean_title),
                        ("target_lang", target),
                    ],
                    headers={"Authorization": f"DeepL-Auth-Key {deepl_key}"},
                    timeout=10,
                )
                response.raise_for_status()
                payload = response.json()
                translations = payload.get("translations", []) if isinstance(payload, dict) else []
                if isinstance(translations, list) and translations:
                    translated_title = str((translations[0] or {}).get("text") or clean_title).strip() or clean_title
                    translated_description = str((translations[1] or {}).get("text") or clean_description).strip() or clean_description
                    provider = "deepl"
                    translated = True
            except Exception:
                pass

        if not translated and google_key and requests is not None and (clean_title or clean_description):
            try:
                response = requests.post(
                    "https://translation.googleapis.com/language/translate/v2",
                    params={"key": google_key},
                    data={
                        "q": [clean_title, clean_description or clean_title],
                        "target": target.lower(),
                        "format": "text",
                    },
                    timeout=10,
                )
                response.raise_for_status()
                payload = response.json()
                data = ((payload.get("data") or {}).get("translations") if isinstance(payload, dict) else None) or []
                if isinstance(data, list) and data:
                    translated_title = str((data[0] or {}).get("translatedText") or clean_title).strip() or clean_title
                    translated_description = str((data[1] or {}).get("translatedText") or clean_description).strip() or clean_description
                    provider = "google"
                    translated = True
            except Exception:
                pass

        return {
            "newsId": news_id,
            "language": target,
            "translated": translated,
            "provider": provider,
            "title": translated_title,
            "description": translated_description,
        }

    return _cached(key, 24 * 60 * 60, _factory)


async def get_news_global_payload() -> dict[str, Any]:
    async def _factory() -> dict[str, Any]:
        items = await _NEWS_PROVIDER.get_global_news(max_items=10, days=5)
        return {"items": _decorate_news_rows(items[:40], max_items=10), "updatedAt": _now_iso()}

    return await _cached_async("news_global", NEWS_CACHE_SECONDS, _factory)


async def get_news_asset_payload(asset_id: str) -> dict[str, Any]:
    key = f"news_asset:{asset_id.lower()}"

    async def _factory() -> dict[str, Any]:
        rows = await _NEWS_PROVIDER.get_asset_news(asset_id=asset_id, max_items=10, days=5)
        picked = _decorate_news_rows(rows[:40], max_items=10, asset_id=asset_id)
        if not picked:
            global_rows = await _NEWS_PROVIDER.get_global_news(max_items=10, days=5)
            if not global_rows:
                mock_rows = _read_json("news_global.json")
                if isinstance(mock_rows, list):
                    global_rows = [
                        {
                            "title": str(r.get("title", "")).strip(),
                            "source": str(r.get("source", "Unknown")).strip() or "Unknown",
                            "url": str(r.get("url", "")).strip(),
                            "publishedAt": str(r.get("publishedAt", "")).strip() or _now_iso(),
                        }
                        for r in mock_rows
                        if isinstance(r, dict) and str(r.get("title", "")).strip() and str(r.get("url", "")).strip()
                    ]
            asset_name = str(asset_id).upper()
            try:
                asset_name = str(_asset_row(asset_id).get("name") or asset_name)
            except Exception:
                pass
            fallback_rows = []
            for item in global_rows[:10]:
                title = str(item.get("title", "")).strip()
                url = str(item.get("url", "")).strip()
                if not title or not url:
                    continue
                fallback_rows.append(
                    {
                        "title": f"{asset_name}: {title}",
                        "source": str(item.get("source", "Macro Desk")).strip() or "Macro Desk",
                        "url": url,
                        "publishedAt": str(item.get("publishedAt", _now_iso())).strip() or _now_iso(),
                    }
                )
            picked = _decorate_news_rows(fallback_rows, max_items=10, asset_id=asset_id)
        return {"assetId": str(asset_id), "items": picked[:10], "updatedAt": _now_iso()}

    return await _cached_async(key, NEWS_CACHE_SECONDS, _factory)


def _pct_change_20d(symbol: str) -> float:
    df = _load_ohlc(symbol, years=2)
    if df is None or df.empty:
        return 0.0
    close = pd.to_numeric(df["Close"], errors="coerce").dropna()
    if close.size < 25:
        return 0.0
    base = float(close.iloc[-21])
    last = float(close.iloc[-1])
    if not np.isfinite(base) or abs(base) < 1e-12:
        return 0.0
    return float((last / base - 1.0) * 100.0)


def get_macro_policy_rate_payload() -> dict[str, Any]:
    return _cached("macro_policy_rate", 1800, lambda: _read_json("macro_policy_rate.json"))


def get_macro_volatility_payload() -> dict[str, Any]:
    payload = _cached("macro_volatility_regime", 1800, lambda: _read_json("macro_volatility_regime.json"))
    if not isinstance(payload, dict):
        payload = {}
    score = float(payload.get("volScore", 50.0))
    if score >= 67.0:
        regime = "Stress"
    elif score >= 40.0:
        regime = "Neutral"
    else:
        regime = "Low"
    payload["volScore"] = score
    payload["regime"] = str(payload.get("regime") or regime)
    payload["updatedAt"] = str(payload.get("updatedAt") or _now_iso())
    return payload


def get_macro_commodity_shock_payload() -> dict[str, Any]:
    def _factory() -> dict[str, Any]:
        oil_20d = _pct_change_20d("CL=F")
        wheat_20d = _pct_change_20d("ZW=F")
        copper_20d = _pct_change_20d("HG=F")
        gas_20d = _pct_change_20d("NG=F")

        signals = [
            {
                "id": "oil",
                "label": "Oil 20D",
                "region": "Middle East",
                "threshold": 10.0,
                "change20d": oil_20d,
                "active": bool(oil_20d > 10.0),
            },
            {
                "id": "wheat",
                "label": "Wheat 20D",
                "region": "Eastern Europe",
                "threshold": 15.0,
                "change20d": wheat_20d,
                "active": bool(wheat_20d > 15.0),
            },
            {
                "id": "copper",
                "label": "Copper 20D",
                "region": "Chile",
                "threshold": 8.0,
                "change20d": copper_20d,
                "active": bool(copper_20d > 8.0),
            },
            {
                "id": "natgas",
                "label": "Natural Gas 20D",
                "region": "Europe",
                "threshold": 12.0,
                "change20d": gas_20d,
                "active": bool(gas_20d > 12.0),
            },
        ]

        def _norm(change: float, threshold: float) -> float:
            if change <= threshold:
                return 0.0
            return float(np.clip((change - threshold) / max(1e-9, threshold), 0.12, 1.0))

        oil_n = _norm(oil_20d, 10.0)
        wheat_n = _norm(wheat_20d, 15.0)
        copper_n = _norm(copper_20d, 8.0)
        gas_n = _norm(gas_20d, 12.0)

        # Major-8 mapping (EUR as Europe) for frontend overlays.
        region_scores: dict[str, float] = {
            "United States": float(max(oil_n, wheat_n * 0.75, copper_n * 0.45)),
            "Europe": float(max(gas_n, wheat_n, oil_n * 0.55)),
            "Japan": float(max(oil_n * 0.72, gas_n * 0.35)),
            "United Kingdom": float(max(gas_n * 0.78, oil_n * 0.5)),
            "Switzerland": float(max(copper_n * 0.32, oil_n * 0.22)),
            "Australia": float(max(copper_n * 0.58, wheat_n * 0.44)),
            "Canada": float(max(oil_n, gas_n * 0.7)),
            "New Zealand": float(wheat_n * 0.72),
        }
        region_scores = {k: float(np.clip(v, 0.0, 1.0)) for k, v in region_scores.items()}

        active_count = sum(1 for row in signals if bool(row["active"]))
        mode = "Normal"
        if active_count >= 3:
            mode = "Severe Shock"
        elif active_count >= 1:
            mode = "Localized Shock"

        return {
            "updatedAt": _now_iso(),
            "mode": mode,
            "signals": signals,
            "regionScores": region_scores,
        }

    return _cached("macro_commodity_shock", 600, _factory)


def get_macro_inflation_payload() -> dict[str, Any]:
    return _cached("macro_inflation", 1800, lambda: _read_json("macro_inflation.json"))


def get_macro_usd_strength_payload() -> dict[str, Any]:
    return _cached("macro_usd_strength", 1800, lambda: _read_json("macro_usd_strength.json"))


def get_macro_risk_payload() -> dict[str, Any]:
    return _cached("macro_risk", 1800, lambda: _read_json("macro_risk.json"))


def _load_ohlc_any(symbol: str, years: int = 6) -> pd.DataFrame:
    df = _load_ohlc(symbol, years=years)
    if df is not None and not df.empty:
        return df
    if yf is None:
        return pd.DataFrame()
    ysym = _resolve_symbol(symbol)
    period = f"{int(max(1, years))}y"
    try:
        raw = yf.download(ysym, period=period, interval="1d", auto_adjust=False, progress=False, threads=False)
    except Exception:
        return pd.DataFrame()
    norm = _normalize_yf_ohlc(raw)
    if norm is None or norm.empty:
        return pd.DataFrame()
    return norm.tail(1600)


def _to_points(series: pd.Series, limit: int = 260) -> list[dict[str, Any]]:
    s = pd.to_numeric(series, errors="coerce").replace([np.inf, -np.inf], np.nan).dropna().tail(limit)
    out: list[dict[str, Any]] = []
    for ts, v in s.items():
        try:
            out.append({"t": pd.Timestamp(ts).isoformat(), "v": float(v)})
        except Exception:
            continue
    return out


def _rolling_index_0_100(series: pd.Series, lookback: int = 26) -> pd.Series:
    s = pd.to_numeric(series, errors="coerce").replace([np.inf, -np.inf], np.nan)
    lo = s.rolling(lookback, min_periods=max(8, lookback // 3)).min()
    hi = s.rolling(lookback, min_periods=max(8, lookback // 3)).max()
    den = (hi - lo).replace(0.0, np.nan)
    idx = ((s - lo) / den) * 100.0
    return idx.replace([np.inf, -np.inf], np.nan).fillna(50.0).clip(0.0, 100.0)


def _z_rolling(series: pd.Series, lookback: int = 120) -> pd.Series:
    s = pd.to_numeric(series, errors="coerce").replace([np.inf, -np.inf], np.nan)
    mu = s.rolling(lookback, min_periods=max(20, lookback // 4)).mean()
    sd = s.rolling(lookback, min_periods=max(20, lookback // 4)).std(ddof=0).replace(0.0, np.nan)
    z = (s - mu) / sd
    return z.replace([np.inf, -np.inf], np.nan).fillna(0.0)


def _clip_series(series: pd.Series, lo: float = -100.0, hi: float = 100.0) -> pd.Series:
    s = pd.to_numeric(series, errors="coerce").replace([np.inf, -np.inf], np.nan).fillna(0.0)
    return s.clip(lo, hi)


def get_macro_fundamental_payload() -> dict[str, Any]:
    def _factory() -> dict[str, Any]:
        dxy = _load_ohlc_any("DXY", years=6)
        gold = _load_ohlc_any("GC1!", years=6)
        us10 = _load_ohlc_any("^TNX", years=6)
        if us10.empty:
            us10 = _load_ohlc_any("US10Y", years=6)
        spx = _load_ohlc_any("^GSPC", years=6)

        frame = pd.DataFrame()
        for key, df in (("dxy", dxy), ("gold", gold), ("us10", us10), ("spx", spx)):
            if df is None or df.empty:
                continue
            close = pd.to_numeric(df["Close"], errors="coerce").dropna()
            if close.empty:
                continue
            frame[key] = close

        if frame.empty:
            idx = pd.date_range(end=pd.Timestamp.utcnow().normalize(), periods=260, freq="B")
            x = np.linspace(0.0, 8.0 * np.pi, len(idx))
            comm = pd.Series(25.0 * np.sin(x) - 8.0 * np.cos(x * 0.6), index=idx)
            large = pd.Series(22.0 * np.cos(x * 0.9) + 6.0 * np.sin(x * 0.4), index=idx)
            small = pd.Series(-(comm + large) * 0.6, index=idx)
            c_idx = _rolling_index_0_100(comm, lookback=26)
            l_idx = _rolling_index_0_100(large, lookback=26)
            s_idx = _rolling_index_0_100(small, lookback=26)
            liq = pd.Series(35.0 * np.sin(x * 0.42) - 14.0 * np.cos(x * 0.2), index=idx)
            vix = pd.Series(19.0 + 5.5 * (1.0 + np.sin(x * 0.55)), index=idx)
            vix3m = pd.Series(21.0 + 3.8 * (1.0 + np.cos(x * 0.45)), index=idx)
            ratio_osc = _clip_series(_z_rolling(vix / vix3m, lookback=60) * 38.0)
        else:
            frame = frame.replace([np.inf, -np.inf], np.nan).dropna(how="all").ffill().dropna(how="all")
            ret_dxy = frame.get("dxy", pd.Series(dtype=float)).pct_change().fillna(0.0)
            ret_gold = frame.get("gold", pd.Series(dtype=float)).pct_change().fillna(0.0)
            ret_spx = frame.get("spx", pd.Series(dtype=float)).pct_change().fillna(0.0)
            chg_us10 = frame.get("us10", pd.Series(dtype=float)).diff().fillna(0.0)

            # COT-style synthetic proxies (stable, data-driven fallback).
            commercial = ((-_z_rolling(ret_dxy.rolling(5).mean(), 120)) + (0.5 * _z_rolling(chg_us10, 120))) * 55.0
            large_specs = ((_z_rolling(ret_gold.rolling(5).mean(), 120)) + (0.35 * _z_rolling(ret_spx, 120))) * 52.0
            small_traders = -(commercial + large_specs) * 0.6

            comm = _clip_series(commercial, -140.0, 140.0)
            large = _clip_series(large_specs, -140.0, 140.0)
            small = _clip_series(small_traders, -140.0, 140.0)
            c_idx = _rolling_index_0_100(comm, lookback=26)
            l_idx = _rolling_index_0_100(large, lookback=26)
            s_idx = _rolling_index_0_100(small, lookback=26)

            liq_raw = (_z_rolling(ret_spx, 120) - _z_rolling(ret_dxy, 120) - 0.7 * _z_rolling(chg_us10, 120)) * 35.0
            liq = _clip_series(liq_raw.rolling(3, min_periods=1).mean(), -100.0, 100.0)

            vix_df = _load_ohlc_any("^VIX", years=4)
            vix3_df = _load_ohlc_any("^VIX3M", years=4)
            if vix3_df.empty:
                vix3_df = _load_ohlc_any("VIX3M", years=4)
            if not vix_df.empty and not vix3_df.empty:
                vix = pd.to_numeric(vix_df["Close"], errors="coerce")
                vix3m = pd.to_numeric(vix3_df["Close"], errors="coerce")
                pair = pd.concat([vix.rename("vix"), vix3m.rename("vix3m")], axis=1).dropna()
                if not pair.empty:
                    vix = pair["vix"]
                    vix3m = pair["vix3m"]
                else:
                    vix = pd.Series(20.0, index=frame.index)
                    vix3m = pd.Series(22.0, index=frame.index)
            else:
                vol_proxy = ret_spx.rolling(20, min_periods=10).std().fillna(0.0) * np.sqrt(252.0)
                vol_z = _z_rolling(vol_proxy, 60)
                vix = (20.0 + vol_z * 4.0).clip(10.0, 80.0)
                vix3m = (22.0 + vol_z * 2.6).clip(10.0, 80.0)
            ratio_osc = _clip_series(_z_rolling(vix / vix3m.replace(0.0, np.nan), lookback=60) * 38.0)

        latest = float(ratio_osc.dropna().iloc[-1]) if ratio_osc.dropna().size else 0.0
        regime = "Neutral"
        if latest >= 35.0:
            regime = "Stress"
        elif latest <= -20.0:
            regime = "Low"

        return {
            "updatedAt": _now_iso(),
            "cot": {
                "net": {
                    "commercials": _to_points(comm),
                    "largeSpecs": _to_points(large),
                    "smallTraders": _to_points(small),
                },
                "index": {
                    "commercials": _to_points(c_idx),
                    "largeSpecs": _to_points(l_idx),
                    "smallTraders": _to_points(s_idx),
                },
            },
            "fedLiquidity": {
                "net": _to_points(liq),
            },
            "vix": {
                "vix": _to_points(vix),
                "vix3m": _to_points(vix3m),
                "ratioOsc": _to_points(ratio_osc),
                "regime": regime,
            },
        }

    return _cached("macro_fundamental_panel", 900, _factory)


def _heatmap_assets_universe() -> list[dict[str, Any]]:
    rows = [a for a in get_assets_payload().get("items", []) if str(a.get("category", "")) != "Cross Pairs"]
    rows = [a for a in rows if str(a.get("id", "")).strip()]
    rows.sort(key=lambda x: (str(x.get("category") or ""), str(x.get("name") or "")))
    return rows


def _synthetic_ohlc_for_asset(asset_id: str, periods: int = 3200) -> pd.DataFrame:
    seed = abs(hash(f"{asset_id}|heatmap_ohlc_v3")) % (2**32 - 1)
    rng = np.random.default_rng(seed)
    idx = pd.date_range(end=pd.Timestamp.utcnow().normalize(), periods=int(max(260, periods)), freq="B")
    ret = rng.normal(loc=0.00012, scale=0.009, size=len(idx))
    close = 100.0 * np.exp(np.cumsum(ret))
    open_ = np.concatenate(([close[0]], close[:-1]))
    high = np.maximum(open_, close) * (1.0 + rng.uniform(0.0006, 0.012, size=len(idx)))
    low = np.minimum(open_, close) * (1.0 - rng.uniform(0.0006, 0.012, size=len(idx)))
    out = pd.DataFrame(
        {
            "Open": pd.to_numeric(open_, errors="coerce"),
            "High": pd.to_numeric(high, errors="coerce"),
            "Low": pd.to_numeric(low, errors="coerce"),
            "Close": pd.to_numeric(close, errors="coerce"),
            "Volume": np.nan,
        },
        index=idx,
    )
    return out


def _heatmap_df_map(timeframe: str = "D", source: str = "dukascopy") -> dict[str, pd.DataFrame]:
    tf = _normalize_timeframe(timeframe)
    src = normalize_data_source(source)
    cache_key = f"heatmap_df_map_v8:{src}:{tf}"

    def _factory() -> dict[str, pd.DataFrame]:
        out: dict[str, pd.DataFrame] = {}
        years = _heatmap_history_years(tf)
        for asset in _heatmap_assets_universe():
            aid = str(asset.get("id", "")).strip().lower()
            symbol = _asset_symbol(asset)
            x = pd.DataFrame()

            if tf in {"D", "W", "M"}:
                base = _load_ohlc(symbol, years=years, source=src, purpose="heatmap", asset_id=aid, continuous_mode="backadjusted")
                if (base is None or base.empty) and src != "ibkr":
                    base = _synthetic_ohlc_for_asset(aid)
                if tf == "W":
                    x = _resample_ohlc(base, "W-FRI")
                elif tf == "M":
                    x = _resample_ohlc(base, "ME")
                else:
                    x = base.copy()
            else:
                base_daily = _load_ohlc(
                    symbol,
                    years=max(4, years),
                    source=src,
                    purpose="correlation",
                    asset_id=aid,
                    continuous_mode="backadjusted",
                )
                x = _load_intraday_ohlc(
                    symbol,
                    tf,
                    source=src,
                    purpose="correlation",
                    asset_id=aid,
                    continuous_mode="backadjusted",
                )
                if x.empty and src != "ibkr" and base_daily is not None and not base_daily.empty:
                    x = _fallback_intraday_from_daily(base_daily, tf, seed_key=str(symbol))

            cols = [c for c in ("Open", "High", "Low", "Close", "Volume") if c in x.columns]
            y = x[cols].copy() if cols else x.copy()
            idx = pd.to_datetime(y.index, errors="coerce", utc=True)
            valid_mask = ~idx.isna()
            y = y.loc[valid_mask].copy()
            idx = idx[valid_mask]
            if isinstance(idx, pd.DatetimeIndex):
                idx = idx.tz_convert(None)
            if tf in {"D", "W", "M"}:
                idx = idx.normalize()
            elif tf == "1MIN":
                idx = idx.floor("min")
            elif tf == "5MIN":
                idx = idx.floor("5min")
            elif tf == "30MIN":
                idx = idx.floor("30min")
            elif tf == "1H":
                idx = idx.floor("h")
            elif tf == "4H":
                idx = idx.floor("4h")
            y.index = idx
            for col in ("Open", "High", "Low", "Close"):
                if col not in y.columns:
                    y[col] = np.nan
                y[col] = pd.to_numeric(y[col], errors="coerce")
            y = y.dropna(subset=["Open", "High", "Low", "Close"])
            y = y[~y.index.duplicated(keep="last")].sort_index()

            if y.empty and src != "ibkr":
                syn = _synthetic_ohlc_for_asset(aid)
                if tf in {"W", "M"}:
                    y = _resample_ohlc(syn, "W-FRI" if tf == "W" else "ME")
                elif tf in {"1MIN", "5MIN", "30MIN", "1H", "4H"}:
                    y = _fallback_intraday_from_daily(syn, tf, seed_key=str(aid))
                else:
                    y = syn

            if tf == "M":
                out[aid] = y.tail(420)
            elif tf == "W":
                out[aid] = y.tail(1200)
            elif tf == "D":
                out[aid] = y.tail(3200)
            else:
                out[aid] = y.tail(_intraday_target_bars(tf))
        return out

    return _cached(cache_key, MARKET_CACHE_SECONDS, _factory)


def _heatmap_daily_df_map(source: str = "dukascopy") -> dict[str, pd.DataFrame]:
    return _heatmap_df_map("D", source=source)


def _last_finite(series: pd.Series, default: float = 0.0) -> float:
    s = pd.to_numeric(series, errors="coerce").replace([np.inf, -np.inf], np.nan).dropna()
    if s.empty:
        return float(default)
    return float(s.iloc[-1])


def _last_point_value(points: Any, default: float = 0.0) -> float:
    if not isinstance(points, list) or not points:
        return float(default)
    for row in reversed(points):
        if not isinstance(row, dict):
            continue
        v = pd.to_numeric(row.get("v"), errors="coerce")
        if np.isfinite(v):
            return float(v)
    return float(default)


def _as_meta(asset: dict[str, Any]) -> dict[str, Any]:
    return {
        "assetId": str(asset.get("id", "")).strip().lower(),
        "symbol": str(asset.get("symbol") or asset.get("tvSource") or "").strip(),
        "name": str(asset.get("name") or "").strip(),
        "category": str(asset.get("category") or "Other").strip(),
    }


def _cluster_sorted_meta(assets: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rank = {cat: idx for idx, cat in enumerate(_HEATMAP_CLUSTER_ORDER)}
    meta = [_as_meta(a) for a in assets]
    meta.sort(
        key=lambda m: (
            int(rank.get(str(m.get("category") or ""), len(_HEATMAP_CLUSTER_ORDER))),
            str(m.get("name") or "").lower(),
            str(m.get("symbol") or "").lower(),
            str(m.get("assetId") or ""),
        )
    )
    return meta


def _cluster_ranges(meta_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    ranges: list[dict[str, Any]] = []
    if not meta_rows:
        return ranges
    rank = {cat: idx for idx, cat in enumerate(_HEATMAP_CLUSTER_ORDER)}
    names = sorted({str(m.get("category") or "Other") for m in meta_rows}, key=lambda c: int(rank.get(c, len(_HEATMAP_CLUSTER_ORDER))))
    for cname in names:
        idxs = [idx for idx, m in enumerate(meta_rows) if str(m.get("category") or "Other") == cname]
        if not idxs:
            continue
        start = int(min(idxs))
        end = int(max(idxs)) + 1
        ranges.append({"name": cname, "start": start, "end": end, "count": int(end - start)})
    return ranges


def _build_heatmap_valuation_tab(source: str = "dukascopy") -> dict[str, Any]:
    src = normalize_data_source(source)

    def _factory() -> dict[str, Any]:
        assets = _heatmap_assets_universe()
        df_map = _heatmap_daily_df_map(source=src)
        gold_close = pd.to_numeric(
            df_map.get("gold", pd.DataFrame()).get("Close", pd.Series(dtype=float)),
            errors="coerce",
        ).replace([np.inf, -np.inf], np.nan).dropna()
        dxy_close = pd.to_numeric(
            df_map.get("usd_index", pd.DataFrame()).get("Close", pd.Series(dtype=float)),
            errors="coerce",
        ).replace([np.inf, -np.inf], np.nan).dropna()
        us10_df = _load_ohlc("^TNX", years=12, source=src, purpose="heatmap", asset_id="us10y")
        us10_close = pd.to_numeric(
            us10_df.get("Close", pd.Series(dtype=float)),
            errors="coerce",
        ).replace([np.inf, -np.inf], np.nan).dropna()

        def _driver_score(base: pd.Series, benchmark: pd.Series) -> float:
            if base.empty or benchmark.empty:
                return 0.0
            aligned = pd.concat(
                [
                    pd.to_numeric(base, errors="coerce"),
                    pd.to_numeric(benchmark, errors="coerce"),
                ],
                axis=1,
                join="inner",
            ).dropna()
            if aligned.shape[0] < 40:
                return 0.0
            ratio = (aligned.iloc[:, 0] / aligned.iloc[:, 1]).replace([np.inf, -np.inf], np.nan).dropna()
            if ratio.size < 40:
                return 0.0
            return float(
                np.clip(
                    _last_finite(_eval_line(ratio, length=20, rescale_len=100), 0.0),
                    -100.0,
                    100.0,
                )
            )

        items: list[dict[str, Any]] = []
        for asset in assets:
            meta = _as_meta(asset)
            aid = str(meta["assetId"])
            df = df_map.get(aid, pd.DataFrame())
            close = pd.to_numeric(df.get("Close", pd.Series(dtype=float)), errors="coerce").dropna()

            val10 = _last_finite(_eval_line(close, length=10, rescale_len=100), 0.0)
            val20 = _last_finite(_eval_line(close, length=20, rescale_len=100), 0.0)
            score = float(np.clip((val10 + val20) / 2.0, -100.0, 100.0))

            fair = close.rolling(252, min_periods=60).mean()
            fair_last = _last_finite(fair, np.nan)
            price = _last_finite(close, np.nan)
            if np.isfinite(price) and np.isfinite(fair_last) and abs(fair_last) > 1e-12:
                deviation_pct = float(((price / fair_last) - 1.0) * 100.0)
            else:
                deviation_pct = 0.0

            driver_dollar = _driver_score(close, dxy_close)
            driver_gold = _driver_score(close, gold_close)
            driver_us10 = _driver_score(close, us10_close)
            driver_combined = float(np.clip((driver_dollar + driver_gold + driver_us10) / 3.0, -100.0, 100.0))
            drivers = {
                "dollar": float(driver_dollar),
                "gold": float(driver_gold),
                "us10y": float(driver_us10),
                "combined": float(driver_combined),
            }
            dominant = max(drivers.items(), key=lambda kv: abs(float(kv[1])))[0] if drivers else "combined"

            items.append(
                {
                    **meta,
                    "val10": float(val10),
                    "val20": float(val20),
                    "score": float(score),
                    "deviationPct": float(deviation_pct),
                    "drivers": drivers,
                    "dominantDriver": str(dominant),
                }
            )
        return {"updatedAt": _now_iso(), "items": items}

    return _cached(f"heatmap_tab_valuation_v6:{src}", VALUATION_CACHE_SECONDS, _factory)


def _build_heatmap_correlation_tab(timeframe: str = "D", source: str = "dukascopy") -> dict[str, Any]:
    tf = _normalize_timeframe(timeframe)
    src = normalize_data_source(source)
    cache_key = f"heatmap_tab_correlation_v9:{src}:{tf}"
    lookback_by_tf = {
        "1MIN": 600,
        "5MIN": 600,
        "30MIN": 400,
        "1H": 300,
        "4H": 200,
        "D": 120,
        "W": 104,
        "M": 60,
    }
    rolling_window_by_tf = {
        "1MIN": 120,
        "5MIN": 120,
        "30MIN": 100,
        "1H": 80,
        "4H": 60,
        "D": 60,
        "W": 52,
        "M": 36,
    }
    ttl_by_tf = {
        "1MIN": MARKET_CACHE_SECONDS,
        "5MIN": MARKET_CACHE_SECONDS,
        "30MIN": MARKET_CACHE_SECONDS,
        "1H": MARKET_CACHE_SECONDS,
        "4H": MARKET_CACHE_SECONDS,
        "D": MARKET_CACHE_SECONDS,
        "W": MARKET_CACHE_SECONDS,
        "M": MARKET_CACHE_SECONDS,
    }

    def _factory() -> dict[str, Any]:
        assets = _heatmap_assets_universe()
        meta = _cluster_sorted_meta(assets)
        lookback_bars = int(lookback_by_tf.get(tf, 120))
        rolling_window = int(rolling_window_by_tf.get(tf, 60))
        min_periods = max(12, int(rolling_window * 0.6))

        def _returns_from_df_map(df_map_local: dict[str, pd.DataFrame]) -> tuple[pd.DataFrame, int]:
            returns_cols: dict[str, pd.Series] = {}
            for m in meta:
                aid = str(m["assetId"])
                close = pd.to_numeric(
                    df_map_local.get(aid, pd.DataFrame()).get("Close", pd.Series(dtype=float)),
                    errors="coerce",
                ).replace([np.inf, -np.inf], np.nan).dropna()
                if close.empty:
                    returns_cols[aid] = pd.Series(dtype=float)
                    continue
                px = close.tail(lookback_bars + 1)
                if px.size < 3:
                    returns_cols[aid] = pd.Series(dtype=float)
                    continue
                logr = np.log(px / px.shift(1)).replace([np.inf, -np.inf], np.nan).dropna()
                returns_cols[aid] = logr.tail(lookback_bars)
            returns_df_local = pd.DataFrame(returns_cols).sort_index()
            returns_df_local = returns_df_local.replace([np.inf, -np.inf], np.nan)
            returns_df_local = returns_df_local.dropna(how="all")
            usable_cols = int((returns_df_local.count(axis=0) >= max(8, min_periods)).sum()) if not returns_df_local.empty else 0
            return returns_df_local, usable_cols

        # Choose the most complete source automatically when requested source is sparse.
        source_fallback_order: dict[str, list[str]] = {
            "ibkr": ["tradingview", "dukascopy", "yahoo"],
            "tradingview": ["dukascopy", "yahoo"],
            "dukascopy": ["tradingview", "yahoo"],
            "yahoo": ["tradingview", "dukascopy"],
        }
        source_candidates = [src] + [s for s in source_fallback_order.get(src, []) if s != src]
        best_returns = pd.DataFrame()
        best_source = src
        best_usable = -1
        best_rows = -1
        for cand_source in source_candidates:
            cand_map = _heatmap_df_map(tf, source=cand_source)
            cand_returns, cand_usable = _returns_from_df_map(cand_map)
            cand_rows = int(cand_returns.shape[0]) if not cand_returns.empty else 0
            if (cand_usable > best_usable) or (cand_usable == best_usable and cand_rows > best_rows):
                best_returns = cand_returns
                best_source = cand_source
                best_usable = cand_usable
                best_rows = cand_rows
            if cand_usable >= max(3, int(len(meta) * 0.45)) and cand_rows >= min_periods:
                break

        returns_df = best_returns

        # Rolling correlation on timeframe-specific returns.
        # Use the latest rolling window correlation matrix to reduce noise.
        if returns_df.shape[0] >= min_periods:
            rolling_corr = returns_df.rolling(window=rolling_window, min_periods=min_periods).corr(pairwise=True)
            if rolling_corr is not None and not rolling_corr.empty:
                idx_lv0 = rolling_corr.index.get_level_values(0)
                last_key = idx_lv0[-1]
                corr_df = rolling_corr.xs(last_key, level=0)
            else:
                corr_df = returns_df.corr(method="pearson", min_periods=min_periods)
        else:
            corr_df = returns_df.corr(method="pearson", min_periods=min_periods)

        if corr_df is None or corr_df.empty:
            corr_df = pd.DataFrame(np.eye(len(meta), dtype=float), index=[str(m["assetId"]) for m in meta], columns=[str(m["assetId"]) for m in meta])

        order = [str(m["assetId"]) for m in meta]
        corr_df = corr_df.reindex(index=order, columns=order)
        corr_vals = corr_df.to_numpy(dtype=float)
        corr_vals = np.where(np.isfinite(corr_vals), corr_vals, 0.0)
        corr_vals = np.clip(corr_vals, -1.0, 1.0)
        np.fill_diagonal(corr_vals, 1.0)
        matrix = (corr_vals * 100.0).round(4).tolist()

        return {
            "updatedAt": _now_iso(),
            "timeframe": tf,
            "source": best_source,
            "requestedSource": src,
            "windowBars": int(lookback_bars),
            "rollingWindow": int(rolling_window),
            "assets": meta,
            "clusters": _cluster_ranges(meta),
            "assetSymbols": [str(m.get("symbol") or m.get("assetId") or "").strip() for m in meta],
            "matrix": matrix,
        }

    return _cached(cache_key, int(ttl_by_tf.get(tf, 1800)), _factory)


def _seasonality_best_for_df(df: pd.DataFrame) -> dict[str, Any]:
    best: dict[str, Any] | None = None
    for hold in range(10, 21):
        for direction in ("LONG", "SHORT"):
            rets = returns_for_hold(df, years=10, hold=int(hold), direction=direction, offset=0)
            arr = np.asarray(rets, dtype=float) if rets else np.asarray([], dtype=float)
            if arr.size < 2:
                continue
            avg_ret = float(np.mean(arr) * 100.0)
            hit_rate = float(np.mean(arr > 0.0) * 100.0)
            expected = float(avg_ret * (hit_rate / 100.0))
            strength = float(abs(expected) * 1.1 + abs(avg_ret) * 0.45 + max(0.0, hit_rate - 50.0) * 0.08)
            candidate = {
                "direction": direction,
                "bestHoldPeriod": int(hold),
                "expectedReturn": float(avg_ret),
                "hitRate": float(hit_rate),
                "expectedValue": float(expected),
                "strength": float(strength),
            }
            if best is None or float(candidate["strength"]) > float(best["strength"]):
                best = candidate
    if best is None:
        return {
            "direction": "LONG",
            "bestHoldPeriod": 10,
            "expectedReturn": 0.0,
            "hitRate": 0.0,
            "expectedValue": 0.0,
            "strength": 0.0,
            "curve": [0.0, 0.0],
            "score": 0.0,
        }

    curve = perf_path_median(df, years=10, hold=int(best["bestHoldPeriod"]), direction=str(best["direction"]))
    if not curve:
        curve = [0.0, 0.0]
    signed_exp = float(best["expectedReturn"])
    if str(best["direction"]).upper() == "SHORT":
        signed_exp = -signed_exp
    score = float(np.clip(signed_exp * max(0.45, float(best["hitRate"]) / 100.0) * 3.8, -100.0, 100.0))
    return {**best, "curve": [float(v) for v in curve], "score": score}


def _build_heatmap_seasonality_tab(source: str = "dukascopy") -> dict[str, Any]:
    src = normalize_data_source(source)

    def _factory() -> dict[str, Any]:
        assets = _heatmap_assets_universe()
        df_map = _heatmap_daily_df_map(source=src)
        items: list[dict[str, Any]] = []
        for asset in assets:
            meta = _as_meta(asset)
            aid = str(meta["assetId"])
            df = df_map.get(aid, pd.DataFrame())
            best = _seasonality_best_for_df(df)
            items.append({**meta, **best})
        return {"updatedAt": _now_iso(), "items": items}

    return _cached(f"heatmap_tab_seasonality_v5:{src}", SEASONALITY_CACHE_SECONDS, _factory)


def _build_heatmap_supply_demand_tab(source: str = "dukascopy") -> dict[str, Any]:
    src = normalize_data_source(source)

    def _factory() -> dict[str, Any]:
        assets = _heatmap_assets_universe()
        df_map = _heatmap_daily_df_map(source=src)
        threshold_pct = 0.8
        items: list[dict[str, Any]] = []
        for asset in assets:
            meta = _as_meta(asset)
            aid = str(meta["assetId"])
            df = df_map.get(aid, pd.DataFrame())
            close = pd.to_numeric(df.get("Close", pd.Series(dtype=float)), errors="coerce").dropna()
            price = _last_finite(close, np.nan)
            demand, supply = _active_sd_zones(df)
            dd = _nearest_distance(price, demand) if np.isfinite(price) else None
            ds = _nearest_distance(price, supply) if np.isfinite(price) else None

            threshold_abs = abs(float(price)) * (threshold_pct / 100.0) if np.isfinite(price) else np.nan
            status = "neutral"
            if dd is not None and np.isfinite(threshold_abs) and float(dd) <= float(threshold_abs):
                status = "demand"
            elif ds is not None and np.isfinite(threshold_abs) and float(ds) <= float(threshold_abs):
                status = "supply"

            if dd is None and ds is None:
                sd_score = 0.0
            else:
                scale = max(abs(float(price)) * 0.05, 1e-9) if np.isfinite(price) else 1.0
                ddem = float(dd if dd is not None else (scale * 2.0))
                dsup = float(ds if ds is not None else (scale * 2.0))
                sd_score = float(np.clip(((dsup - ddem) / max(1e-9, ddem + dsup)) * 100.0, -100.0, 100.0))

            dd_pct = float((float(dd) / abs(float(price))) * 100.0) if (dd is not None and np.isfinite(price) and abs(float(price)) > 1e-12) else None
            ds_pct = float((float(ds) / abs(float(price))) * 100.0) if (ds is not None and np.isfinite(price) and abs(float(price)) > 1e-12) else None

            items.append(
                {
                    **meta,
                    "status": status,
                    "distanceToDemand": float(dd) if dd is not None else None,
                    "distanceToSupply": float(ds) if ds is not None else None,
                    "distanceToDemandPct": dd_pct,
                    "distanceToSupplyPct": ds_pct,
                    "score": sd_score,
                }
            )
        return {"updatedAt": _now_iso(), "thresholdPct": threshold_pct, "items": items}

    return _cached(f"heatmap_tab_sd_v4:{src}", 1800, _factory)


def _macro_profile_weights(asset_id: str, category: str) -> dict[str, float]:
    aid = str(asset_id or "").lower()
    cat = str(category or "")
    # Factors:
    # - risk: positive when risk-on
    # - fedLiquidity: positive when liquidity is expanding
    # - cotIndex / cotNet: positioning risk appetite proxies
    if cat == "FX":
        if aid in {"usd_index", "jpy", "chf"}:
            return {"risk": -0.46, "fedLiquidity": -0.34, "cotIndex": -0.14, "cotNet": -0.06}
        return {"risk": 0.42, "fedLiquidity": 0.30, "cotIndex": 0.20, "cotNet": 0.08}
    if cat == "Metals":
        if aid == "gold":
            return {"risk": -0.18, "fedLiquidity": 0.46, "cotIndex": 0.22, "cotNet": 0.14}
        if aid == "silver":
            return {"risk": 0.05, "fedLiquidity": 0.38, "cotIndex": 0.33, "cotNet": 0.24}
        return {"risk": 0.44, "fedLiquidity": 0.24, "cotIndex": 0.20, "cotNet": 0.12}
    if cat == "Equities":
        return {"risk": 0.46, "fedLiquidity": 0.33, "cotIndex": 0.15, "cotNet": 0.06}
    if cat == "Crypto":
        return {"risk": 0.56, "fedLiquidity": 0.30, "cotIndex": 0.10, "cotNet": 0.04}
    if cat == "Energy":
        return {"risk": 0.30, "fedLiquidity": 0.24, "cotIndex": 0.30, "cotNet": 0.16}
    if cat == "Agriculture":
        return {"risk": 0.20, "fedLiquidity": 0.20, "cotIndex": 0.34, "cotNet": 0.26}
    if cat == "Softs":
        return {"risk": 0.18, "fedLiquidity": 0.22, "cotIndex": 0.34, "cotNet": 0.26}
    if cat == "Livestock":
        return {"risk": 0.20, "fedLiquidity": 0.21, "cotIndex": 0.30, "cotNet": 0.29}
    return {"risk": 0.30, "fedLiquidity": 0.30, "cotIndex": 0.24, "cotNet": 0.16}


def _build_heatmap_macro_tab() -> dict[str, Any]:
    def _factory() -> dict[str, Any]:
        assets = _heatmap_assets_universe()
        macro = get_macro_fundamental_payload()

        cot_idx = macro.get("cot", {}).get("index", {}) if isinstance(macro, dict) else {}
        cot_net = macro.get("cot", {}).get("net", {}) if isinstance(macro, dict) else {}
        fed = macro.get("fedLiquidity", {}) if isinstance(macro, dict) else {}
        vix = macro.get("vix", {}) if isinstance(macro, dict) else {}

        comm_idx = _last_point_value(cot_idx.get("commercials", []), 50.0)
        large_idx = _last_point_value(cot_idx.get("largeSpecs", []), 50.0)
        small_idx = _last_point_value(cot_idx.get("smallTraders", []), 50.0)

        comm_net = _last_point_value(cot_net.get("commercials", []), 0.0)
        large_net = _last_point_value(cot_net.get("largeSpecs", []), 0.0)
        small_net = _last_point_value(cot_net.get("smallTraders", []), 0.0)

        fed_signal = float(np.clip(_last_point_value(fed.get("net", []), 0.0), -100.0, 100.0))
        vix_ratio_osc = float(np.clip(_last_point_value(vix.get("ratioOsc", []), 0.0), -100.0, 100.0))
        risk_signal = float(np.clip(-vix_ratio_osc, -100.0, 100.0))

        cot_index_signal = float(
            np.clip(((large_idx - comm_idx) * 0.85) + ((small_idx - 50.0) * 0.30), -100.0, 100.0)
        )
        net_scale = max(abs(comm_net), abs(large_net), abs(small_net), 1.0)
        cot_net_signal = float(np.clip(((large_net - comm_net) / net_scale) * 100.0, -100.0, 100.0))

        factors = {
            "risk": risk_signal,
            "fedLiquidity": fed_signal,
            "cotIndex": cot_index_signal,
            "cotNet": cot_net_signal,
        }

        items: list[dict[str, Any]] = []
        for asset in assets:
            meta = _as_meta(asset)
            aid = str(meta.get("assetId", ""))
            weights = _macro_profile_weights(aid, str(meta.get("category", "")))
            c_risk = float(weights.get("risk", 0.0) * factors["risk"])
            c_fed = float(weights.get("fedLiquidity", 0.0) * factors["fedLiquidity"])
            c_cot_idx = float(weights.get("cotIndex", 0.0) * factors["cotIndex"])
            c_cot_net = float(weights.get("cotNet", 0.0) * factors["cotNet"])
            signed = float(np.clip(c_risk + c_fed + c_cot_idx + c_cot_net, -100.0, 100.0))
            score = float(np.clip((signed + 100.0) / 2.0, 0.0, 100.0))
            direction = "LONG" if signed >= 0.0 else "SHORT"
            items.append(
                {
                    **meta,
                    "direction": direction,
                    "score": signed,
                    "macroScore": score,
                    "strength": float(abs(signed)),
                    "components": {
                        "risk": c_risk,
                        "fedLiquidity": c_fed,
                        "cotIndex": c_cot_idx,
                        "cotNet": c_cot_net,
                    },
                }
            )

        return {
            "updatedAt": _now_iso(),
            "factors": factors,
            "items": items,
        }

    return _cached("heatmap_tab_macro_v1", 900, _factory)


def _momentum_signed_score(close: pd.Series) -> float:
    c = pd.to_numeric(close, errors="coerce").replace([np.inf, -np.inf], np.nan).dropna()
    if c.size < 40:
        return 0.0
    z20 = _z_last(c.pct_change(20), 252)
    z50 = _z_last(c.pct_change(50), 252)
    ma200 = c.rolling(200, min_periods=80).mean()
    trend = 1.0 if (not ma200.dropna().empty and float(c.iloc[-1]) > float(ma200.dropna().iloc[-1])) else -1.0
    return float(np.clip((22.0 * z20) + (14.0 * z50) + (18.0 * trend), -100.0, 100.0))


def _volatility_component_score(df: pd.DataFrame) -> float:
    close = pd.to_numeric(df.get("Close", pd.Series(dtype=float)), errors="coerce")
    atr_pct = (_atr(df, length=14) / close).replace([np.inf, -np.inf], np.nan).dropna()
    if atr_pct.empty:
        return 50.0
    rank = float((atr_pct <= float(atr_pct.iloc[-1])).sum()) / float(max(1, atr_pct.size))
    return float(np.clip(100.0 - (rank * 100.0), 0.0, 100.0))


def _build_heatmap_combined_tab(source: str = "dukascopy") -> dict[str, Any]:
    src = normalize_data_source(source)

    def _factory() -> dict[str, Any]:
        assets = _heatmap_assets_universe()
        df_map = _heatmap_daily_df_map(source=src)
        val_rows = {str(x["assetId"]): x for x in _build_heatmap_valuation_tab(source=src).get("items", [])}
        seas_rows = {str(x["assetId"]): x for x in _build_heatmap_seasonality_tab(source=src).get("items", [])}
        sd_rows = {str(x["assetId"]): x for x in _build_heatmap_supply_demand_tab(source=src).get("items", [])}

        items: list[dict[str, Any]] = []
        for asset in assets:
            meta = _as_meta(asset)
            aid = str(meta["assetId"])
            df = df_map.get(aid, pd.DataFrame())
            close = pd.to_numeric(df.get("Close", pd.Series(dtype=float)), errors="coerce").dropna()

            valuation_signed = float(val_rows.get(aid, {}).get("score", 0.0))
            season_signed = float(seas_rows.get(aid, {}).get("score", 0.0))
            sd_signed = float(sd_rows.get(aid, {}).get("score", 0.0))
            momentum_signed = _momentum_signed_score(close)
            volatility_score = _volatility_component_score(df)

            valuation_score = float(np.clip((valuation_signed + 100.0) / 2.0, 0.0, 100.0))
            sd_score = float(np.clip((sd_signed + 100.0) / 2.0, 0.0, 100.0))
            seasonality_score = float(np.clip((season_signed + 100.0) / 2.0, 0.0, 100.0))
            momentum_score = float(np.clip((momentum_signed + 100.0) / 2.0, 0.0, 100.0))
            volatility_component = float(np.clip(volatility_score, 0.0, 100.0))

            ai_score = float(
                np.clip(
                    (0.30 * valuation_score)
                    + (0.25 * sd_score)
                    + (0.20 * seasonality_score)
                    + (0.15 * momentum_score)
                    + (0.10 * volatility_component),
                    0.0,
                    100.0,
                )
            )

            items.append(
                {
                    **meta,
                    "aiScore": ai_score,
                    "subscores": {
                        "valuation": valuation_score,
                        "supplyDemand": sd_score,
                        "seasonality": seasonality_score,
                        "momentum": momentum_score,
                        "volatility": volatility_component,
                    },
                    "signed": {
                        "valuation": valuation_signed,
                        "supplyDemand": sd_signed,
                        "seasonality": season_signed,
                        "momentum": momentum_signed,
                    },
                }
            )
        return {"updatedAt": _now_iso(), "items": items}

    return _cached(f"heatmap_tab_combined_v5:{src}", VALUATION_CACHE_SECONDS, _factory)


def get_heatmap_assets_payload(timeframe: str = "D", source: str = "dukascopy") -> dict[str, Any]:
    tf = _normalize_timeframe(timeframe)
    src = normalize_data_source(source)
    assets = _heatmap_assets_universe()
    corr = _build_heatmap_correlation_tab(tf, source=src)
    valuation = _build_heatmap_valuation_tab(source=src)
    seasonality = _build_heatmap_seasonality_tab(source=src)
    supply_demand = _build_heatmap_supply_demand_tab(source=src)
    combined = _build_heatmap_combined_tab(source=src)
    macro = _build_heatmap_macro_tab()

    combined_map = {str(x.get("assetId", "")): x for x in combined.get("items", [])}
    valuation_map = {str(x.get("assetId", "")): x for x in valuation.get("items", [])}
    seasonality_map = {str(x.get("assetId", "")): x for x in seasonality.get("items", [])}
    supply_map = {str(x.get("assetId", "")): x for x in supply_demand.get("items", [])}
    macro_map = {str(x.get("assetId", "")): x for x in macro.get("items", [])}

    # Backward-compatible compact list used by legacy frontend rendering paths.
    legacy_items: list[dict[str, Any]] = []
    for asset in assets:
        aid = str(asset.get("id", "")).strip().lower()
        c_row = combined_map.get(aid, {})
        v_row = valuation_map.get(aid, {})
        s_row = seasonality_map.get(aid, {})
        sd_row = supply_map.get(aid, {})
        m_row = macro_map.get(aid, {})
        legacy_items.append(
            {
                "assetId": aid,
                "name": str(asset.get("name") or aid.upper()),
                "symbol": str(asset.get("symbol") or asset.get("tvSource") or ""),
                "category": str(asset.get("category") or "Other"),
                "values": {
                    "correlation": 0.0,  # pair-based view in matrix tab
                    "valuation": float(v_row.get("score", 0.0)),
                    "seasonality": float(s_row.get("score", 0.0)),
                    "supplyDemand": float(sd_row.get("score", 0.0)),
                    "macro": float(m_row.get("score", 0.0)),
                    "combined": float((float(c_row.get("aiScore", 50.0)) - 50.0) * 2.0),
                    "aiScore": float(c_row.get("aiScore", 50.0)),
                },
            }
        )

    return {
        "updatedAt": _now_iso(),
        "count": len(assets),
        "timeframe": tf,
        "source": src,
        "assets": [_as_meta(a) for a in assets],
        "tabs": {
            "correlation": corr,
            "valuation": valuation,
            "seasonality": seasonality,
            "supplyDemand": supply_demand,
            "macro": macro,
            "combined": combined,
        },
        "items": legacy_items,
    }


def _clip01(value: float) -> float:
    return float(np.clip(float(value), 0.0, 1.0))


def _to_location(asset: dict[str, Any]) -> tuple[float, float]:
    locs = asset.get("locations", [])
    if isinstance(locs, list) and locs:
        first = locs[0] if isinstance(locs[0], dict) else {}
        lat = float(first.get("lat", asset.get("lat", 0.0)))
        lng = float(first.get("lng", asset.get("lng", 0.0)))
        return lat, lng
    return float(asset.get("lat", 0.0)), float(asset.get("lng", 0.0))


def _signal_rows_payload(source: str = "dukascopy") -> list[dict[str, Any]]:
    src = normalize_data_source(source)

    def _factory() -> list[dict[str, Any]]:
        assets = _heatmap_assets_universe()
        combined = _build_heatmap_combined_tab(source=src).get("items", [])
        seasonality = _build_heatmap_seasonality_tab(source=src).get("items", [])
        supply_demand = _build_heatmap_supply_demand_tab(source=src).get("items", [])
        corr = _build_heatmap_correlation_tab("D", source=src)
        df_map = _heatmap_daily_df_map(source=src)

        comb_map = {str(x.get("assetId", "")): x for x in combined if isinstance(x, dict)}
        seas_map = {str(x.get("assetId", "")): x for x in seasonality if isinstance(x, dict)}
        sd_map = {str(x.get("assetId", "")): x for x in supply_demand if isinstance(x, dict)}

        corr_assets = [str(x.get("assetId", "")) for x in corr.get("assets", []) if isinstance(x, dict)]
        corr_idx_map = {aid: idx for idx, aid in enumerate(corr_assets)}
        corr_matrix = corr.get("matrix", [])

        rows: list[dict[str, Any]] = []
        for asset in assets:
            meta = _as_meta(asset)
            aid = str(meta["assetId"])
            comb = comb_map.get(aid, {})
            seas = seas_map.get(aid, {})
            sd = sd_map.get(aid, {})
            df = df_map.get(aid, pd.DataFrame())

            close = pd.to_numeric(df.get("Close", pd.Series(dtype=float)), errors="coerce").replace([np.inf, -np.inf], np.nan).dropna()
            bars = int(close.size)

            ai_score = float(np.clip(comb.get("aiScore", 50.0), 0.0, 100.0))
            momentum_signed = float(comb.get("signed", {}).get("momentum", 0.0))
            valuation_signed = float(comb.get("signed", {}).get("valuation", 0.0))
            season_signed = float(comb.get("signed", {}).get("seasonality", 0.0))
            sd_signed = float(comb.get("signed", {}).get("supplyDemand", 0.0))
            volatility_component = float(comb.get("subscores", {}).get("volatility", 50.0))
            sd_status = str(sd.get("status", "neutral")).lower()

            signal_strength = _clip01(abs(ai_score - 50.0) / 50.0)
            data_quality = _clip01(0.55 + min(1.0, bars / 420.0) * 0.45)

            direction_sign = 1.0 if ai_score >= 50.0 else -1.0
            vals = np.asarray([valuation_signed, season_signed, sd_signed, momentum_signed], dtype=float)
            aligned = float(np.mean((vals * direction_sign) >= 5.0))
            opposed = float(np.mean((vals * direction_sign) <= -5.0))
            regime_alignment = _clip01(0.35 + aligned * 0.55 - opposed * 0.25)

            corr_support = 0.55
            i = corr_idx_map.get(aid)
            if i is not None and isinstance(corr_matrix, list) and i < len(corr_matrix):
                row_vals = []
                for j, v in enumerate(corr_matrix[i]):
                    if i == j:
                        continue
                    try:
                        x = abs(float(v))
                    except Exception:
                        x = np.nan
                    if np.isfinite(x):
                        row_vals.append(x)
                if row_vals:
                    top_abs = sorted(row_vals, reverse=True)[:5]
                    corr_support = _clip01(0.30 + (float(np.mean(top_abs)) / 100.0) * 0.70)

            confidence = float(
                np.clip(
                    signal_strength * data_quality * regime_alignment * corr_support * 100.0,
                    0.0,
                    100.0,
                )
            )

            if confidence >= 78:
                signal_quality = "High"
            elif confidence >= 58:
                signal_quality = "Medium"
            elif confidence >= 38:
                signal_quality = "Moderate"
            else:
                signal_quality = "Low"

            if valuation_signed <= -15:
                valuation_text = "Undervalued"
            elif valuation_signed >= 15:
                valuation_text = "Overvalued"
            else:
                valuation_text = "Fair Value"

            if season_signed >= 5:
                season_text = "Bullish Bias"
            elif season_signed <= -5:
                season_text = "Bearish Bias"
            else:
                season_text = "Neutral Bias"

            if momentum_signed >= 5:
                momentum_text = "Positive"
            elif momentum_signed <= -5:
                momentum_text = "Negative"
            else:
                momentum_text = "Flat"

            if sd_status == "demand":
                sd_text = "Near Demand"
            elif sd_status == "supply":
                sd_text = "Near Supply"
            else:
                sd_text = "No Active Zone"

            if volatility_component >= 65:
                vol_text = "Low/Compressed"
            elif volatility_component <= 35:
                vol_text = "Elevated"
            else:
                vol_text = "Normal"

            lat, lng = _to_location(asset)
            rows.append(
                {
                    **meta,
                    "lat": float(lat),
                    "lng": float(lng),
                    "aiScore": ai_score,
                    "confidenceScore": confidence,
                    "signalQuality": signal_quality,
                    "momentum": float(momentum_signed),
                    "direction": "LONG" if ai_score >= 50 else "SHORT",
                    "components": {
                        "signalStrength": float(signal_strength),
                        "dataQuality": float(data_quality),
                        "regimeAlignment": float(regime_alignment),
                        "correlationSupport": float(corr_support),
                    },
                    "whySignal": [
                        {"label": "Valuation", "value": valuation_text},
                        {"label": "Seasonality Bias", "value": season_text},
                        {"label": "Momentum", "value": momentum_text},
                        {"label": "Supply/Demand Proximity", "value": sd_text},
                        {"label": "Volatility Regime", "value": vol_text},
                    ],
                }
            )
        return rows

    return _cached(f"signal_rows_v2:{src}", 300, _factory)


def get_category_heatmap_payload(category: str = "FX", sort_by: str = "ai_score", source: str = "dukascopy") -> dict[str, Any]:
    cat = str(category or "FX").strip()
    sort_key = str(sort_by or "ai_score").strip().lower()
    src = normalize_data_source(source)

    def _factory() -> dict[str, Any]:
        rows = _signal_rows_payload(source=src)
        categories = [c for c in _HEATMAP_CLUSTER_ORDER if any(str(x.get("category")) == c for x in rows)]
        selected = cat if cat in categories else (categories[0] if categories else "FX")
        picked = [x for x in rows if str(x.get("category")) == selected]

        if sort_key in {"confidence", "confidence_score"}:
            picked.sort(key=lambda x: float(x.get("confidenceScore", 0.0)), reverse=True)
        elif sort_key in {"momentum"}:
            picked.sort(key=lambda x: float(x.get("momentum", 0.0)), reverse=True)
        else:
            picked.sort(key=lambda x: float(x.get("aiScore", 0.0)), reverse=True)

        tiles = []
        for row in picked:
            ai = float(row.get("aiScore", 50.0))
            if ai >= 80:
                tone = "strong_bullish"
            elif ai >= 60:
                tone = "bullish"
            elif ai >= 40:
                tone = "neutral"
            elif ai >= 20:
                tone = "bearish"
            else:
                tone = "strong_bearish"
            tiles.append(
                {
                    "assetId": str(row.get("assetId", "")),
                    "name": str(row.get("name", "")),
                    "category": str(row.get("category", "")),
                    "aiScore": ai,
                    "confidenceScore": float(row.get("confidenceScore", 0.0)),
                    "momentum": float(row.get("momentum", 0.0)),
                    "signalQuality": str(row.get("signalQuality", "Low")),
                    "tone": tone,
                }
            )
        return {
            "updatedAt": _now_iso(),
            "category": selected,
            "sortBy": sort_key,
            "categories": categories,
            "items": tiles,
        }

    return _cached(f"category_heatmap_v2:{src}:{cat}:{sort_key}", 300, _factory)


def get_opportunities_payload(source: str = "dukascopy") -> dict[str, Any]:
    src = normalize_data_source(source)

    def _factory() -> dict[str, Any]:
        rows = _signal_rows_payload(source=src)
        long_rows = [x for x in rows if float(x.get("aiScore", 0.0)) >= 50.0]
        short_rows = [x for x in rows if float(x.get("aiScore", 0.0)) < 50.0]
        long_rows.sort(
            key=lambda x: (
                float(x.get("aiScore", 0.0)),
                float(x.get("confidenceScore", 0.0)),
                float(x.get("momentum", 0.0)),
            ),
            reverse=True,
        )
        short_rows.sort(
            key=lambda x: (
                float(x.get("aiScore", 50.0)),
                -float(x.get("confidenceScore", 0.0)),
                float(x.get("momentum", 0.0)),
            )
        )

        def _pack(row: dict[str, Any]) -> dict[str, Any]:
            return {
                "assetId": str(row.get("assetId", "")),
                "name": str(row.get("name", "")),
                "symbol": str(row.get("symbol", "")),
                "category": str(row.get("category", "")),
                "aiScore": float(row.get("aiScore", 50.0)),
                "confidenceScore": float(row.get("confidenceScore", 0.0)),
                "lat": float(row.get("lat", 0.0)),
                "lng": float(row.get("lng", 0.0)),
            }

        return {
            "updatedAt": _now_iso(),
            "long": [_pack(x) for x in long_rows[:5]],
            "short": [_pack(x) for x in short_rows[:5]],
        }

    return _cached(f"opportunities_v2:{src}", 300, _factory)


def get_asset_signal_detail_payload(asset_id: str, source: str = "dukascopy") -> dict[str, Any]:
    aid = str(asset_id or "").strip().lower()
    src = normalize_data_source(source)

    def _factory() -> dict[str, Any]:
        rows = _signal_rows_payload(source=src)
        row = next((x for x in rows if str(x.get("assetId", "")) == aid), None)
        if row is None:
            raise KeyError(f"asset not found: {asset_id}")

        corr = _build_heatmap_correlation_tab("D", source=src)
        assets = [x for x in corr.get("assets", []) if isinstance(x, dict)]
        matrix = corr.get("matrix", [])
        idx_map = {str(x.get("assetId", "")): idx for idx, x in enumerate(assets)}
        i = idx_map.get(aid)
        pos: list[dict[str, Any]] = []
        neg: list[dict[str, Any]] = []
        if i is not None and isinstance(matrix, list) and i < len(matrix):
            vals = []
            for j, v in enumerate(matrix[i]):
                if j == i:
                    continue
                try:
                    x = float(v)
                except Exception:
                    continue
                if not np.isfinite(x):
                    continue
                meta = assets[j] if j < len(assets) else {}
                vals.append(
                    {
                        "assetId": str(meta.get("assetId", "")),
                        "name": str(meta.get("name", "")),
                        "symbol": str(meta.get("symbol", "")),
                        "value": float(x),
                    }
                )
            pos = sorted([x for x in vals if x["value"] > 0], key=lambda x: x["value"], reverse=True)[:5]
            neg = sorted([x for x in vals if x["value"] < 0], key=lambda x: x["value"])[:5]

        return {
            "assetId": aid,
            "aiScore": float(row.get("aiScore", 50.0)),
            "confidenceScore": float(row.get("confidenceScore", 0.0)),
            "signalQuality": str(row.get("signalQuality", "Low")),
            "components": row.get("components", {}),
            "whySignal": row.get("whySignal", []),
            "miniCorrelation": {
                "timeframe": "D",
                "positive": pos,
                "negative": neg,
            },
            "source": src,
            "updatedAt": _now_iso(),
        }

    return _cached(f"asset_signal_detail_v3:{src}:{aid}", VALUATION_CACHE_SECONDS, _factory)


def get_market_alerts_payload(source: str = "dukascopy") -> dict[str, Any]:
    src = normalize_data_source(source)

    def _factory() -> dict[str, Any]:
        rows = _signal_rows_payload(source=src)
        alerts: list[dict[str, Any]] = []
        for row in rows:
            aid = str(row.get("assetId", ""))
            name = str(row.get("name", aid.upper()))
            ai = float(row.get("aiScore", 50.0))
            conf = float(row.get("confidenceScore", 0.0))
            why = {str(x.get("label", "")): str(x.get("value", "")) for x in row.get("whySignal", []) if isinstance(x, dict)}

            if ai >= 80 and conf >= 60:
                alerts.append({"assetId": aid, "title": f"{name}: Strong Long Setup", "tone": "bull"})
            if ai <= 20 and conf >= 60:
                alerts.append({"assetId": aid, "title": f"{name}: Strong Short Setup", "tone": "bear"})
            if "Near Demand" in why.get("Supply/Demand Proximity", "") and ai >= 55:
                alerts.append({"assetId": aid, "title": f"{name} entering Demand Zone", "tone": "bull"})
            if "Near Supply" in why.get("Supply/Demand Proximity", "") and ai <= 45:
                alerts.append({"assetId": aid, "title": f"{name} near Supply Zone", "tone": "bear"})

        uniq: list[dict[str, Any]] = []
        seen: set[str] = set()
        for row in alerts:
            key = f"{row.get('assetId')}|{row.get('title')}"
            if key in seen:
                continue
            seen.add(key)
            uniq.append(row)
            if len(uniq) >= 5:
                break
        return {"updatedAt": _now_iso(), "items": uniq[:5]}

    return _cached(f"market_alerts_v2:{src}", 300, _factory)


def _mock_geo_events() -> dict[str, list[dict[str, Any]]]:
    now = datetime.now(timezone.utc)
    return {
        "conflicts": [
            {
                "id": "conflict:ukr:1",
                "type": "conflict",
                "date": (now - timedelta(days=1)).isoformat(),
                "location": "Eastern Europe",
                "severity": "high",
                "lat": 48.6,
                "lng": 35.0,
                "color": "#ff384c",
            },
            {
                "id": "conflict:me:1",
                "type": "conflict",
                "date": (now - timedelta(days=2)).isoformat(),
                "location": "Middle East",
                "severity": "medium",
                "lat": 25.2,
                "lng": 55.3,
                "color": "#ff384c",
            },
        ],
        "wildfires": [
            {
                "id": "wildfire:aus:1",
                "type": "wildfire",
                "date": (now - timedelta(hours=9)).isoformat(),
                "location": "Australia",
                "severity": "moderate",
                "lat": -33.9,
                "lng": 151.2,
                "color": "#ff9800",
            },
            {
                "id": "wildfire:usa:1",
                "type": "wildfire",
                "date": (now - timedelta(hours=18)).isoformat(),
                "location": "California",
                "severity": "high",
                "lat": 36.8,
                "lng": -119.4,
                "color": "#ff9800",
            },
        ],
        "earthquakes": [],
    }


def _fetch_usgs_earthquakes(days: int = 7, min_magnitude: float = 4.5) -> list[dict[str, Any]]:
    if requests is None:
        return []
    window_days = int(max(1, days))
    feed_name = "all_day.geojson" if window_days <= 1 else ("all_week.geojson" if window_days <= 7 else "all_month.geojson")
    try:
        res = requests.get(f"https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/{feed_name}", timeout=8)
        res.raise_for_status()
        payload = res.json()
    except Exception:
        return []

    rows = payload.get("features", []) if isinstance(payload, dict) else []
    out: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        geom = row.get("geometry", {})
        coords = geom.get("coordinates", []) if isinstance(geom, dict) else []
        if not isinstance(coords, list) or len(coords) < 2:
            continue
        lng = float(coords[0])
        lat = float(coords[1])
        props = row.get("properties", {}) if isinstance(row.get("properties"), dict) else {}
        mag = float(props.get("mag", 0.0) or 0.0)
        if mag < float(min_magnitude):
            continue
        place = str(props.get("place", "Earthquake")).strip() or "Earthquake"
        ts = props.get("time")
        dt = datetime.fromtimestamp(float(ts) / 1000.0, tz=timezone.utc).isoformat() if ts is not None else _now_iso()
        out.append(
            {
                "id": f"quake:{row.get('id', len(out))}",
                "type": "earthquake",
                "event_type": "earthquake",
                "date": dt,
                "timestamp": dt,
                "location": place,
                "severity": f"M{mag:.1f}",
                "description": f"USGS earthquake event M{mag:.1f} near {place}",
                "magnitude": round(mag, 2),
                "depth": round(float(coords[2]), 2) if len(coords) >= 3 and np.isfinite(_safe_float(coords[2], np.nan)) else None,
                "lat": lat,
                "lng": lng,
                "color": "#ff384c",
                "source": "USGS",
                "related_assets": ["gold"],
            }
        )
    return out


def _fetch_acled_conflicts(days: int = 7) -> list[dict[str, Any]]:
    if requests is None:
        return []
    key = str(os.getenv("IVQ_ACLED_KEY", "")).strip()
    email = str(os.getenv("IVQ_ACLED_EMAIL", "")).strip()
    if not key or not email:
        return []
    since = (datetime.now(timezone.utc) - timedelta(days=int(max(1, days)))).strftime("%Y-%m-%d")
    try:
        res = requests.get(
            "https://api.acleddata.com/acled/read",
            params={
                "key": key,
                "email": email,
                "event_date": since,
                "event_date_where": ">=",
                "limit": 200,
                "format": "json",
            },
            timeout=10,
        )
        res.raise_for_status()
        payload = res.json()
    except Exception:
        return []
    rows = payload.get("data", []) if isinstance(payload, dict) else []
    out: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        try:
            lat = float(row.get("latitude", np.nan))
            lng = float(row.get("longitude", np.nan))
        except Exception:
            continue
        if not np.isfinite(lat) or not np.isfinite(lng):
            continue
        fatalities = float(row.get("fatalities", 0.0) or 0.0)
        event_type = str(row.get("event_type") or "conflict").strip()
        event_date = str(row.get("event_date") or _now_iso()).strip() or _now_iso()
        location = str(row.get("location") or row.get("country") or "Conflict").strip() or "Conflict"
        severity = "high" if fatalities >= 10 else ("medium" if fatalities >= 1 else "low")
        out.append(
            {
                "id": f"acled:{row.get('event_id_cnty', len(out))}",
                "type": "conflict",
                "event_type": event_type,
                "date": event_date,
                "timestamp": event_date,
                "location": location,
                "country": str(row.get("country") or "").strip(),
                "severity": severity,
                "fatalities": int(max(0.0, fatalities)),
                "description": f"{event_type} in {location} (fatalities: {int(max(0.0, fatalities))})",
                "lat": lat,
                "lng": lng,
                "color": "#ff384c",
                "source": "ACLED",
                "related_assets": _related_assets_for_text(f"{event_type} {location}"),
            }
        )
    return out


def _fetch_gdelt_conflicts(days: int = 7) -> list[dict[str, Any]]:
    if requests is None:
        return []
    try:
        res = requests.get(
            "https://api.gdeltproject.org/api/v2/doc/doc",
            params={
                "query": '"conflict" OR war OR attack OR protest OR cyberattack OR sanctions',
                "mode": "ArtList",
                "format": "json",
                "sort": "DateDesc",
                "maxrecords": 80,
                "timespan": f"{int(max(1, days))}d",
            },
            timeout=10,
        )
        res.raise_for_status()
        payload = res.json()
    except Exception:
        return []
    rows = payload.get("articles", []) if isinstance(payload, dict) else []
    out: list[dict[str, Any]] = []
    for idx, row in enumerate(rows):
        if not isinstance(row, dict):
            continue
        title = str(row.get("title") or "").strip()
        if not title:
            continue
        loc = _news_geo_hit_location(title)
        if not loc:
            continue
        text = title.lower()
        if "cyber" in text:
            ev_type = "cyber"
        elif "protest" in text:
            ev_type = "protest"
        else:
            ev_type = "conflict"
        severity = "high" if any(term in text for term in ("war", "attack", "escalation", "missile", "sanctions")) else "medium"
        related_assets = _related_assets_for_text(title)
        out.append(
            {
                "id": f"gdelt:{idx}:{abs(hash(title)) % 1000000}",
                "type": "conflict",
                "event_type": ev_type,
                "date": str(row.get("seendate") or _now_iso()),
                "timestamp": str(row.get("seendate") or _now_iso()),
                "location": str(loc.get("location") or "Geopolitical Hotspot"),
                "country": str(loc.get("country") or ""),
                "severity": severity,
                "description": title,
                "lat": float(loc.get("lat") or 0.0),
                "lng": float(loc.get("lng") or 0.0),
                "color": "#ff384c" if severity == "high" else "#ff9f43",
                "headline": title,
                "title": title,
                "source": str(row.get("source") or row.get("domain") or "GDELT").strip() or "GDELT",
                "url": str(row.get("url") or "").strip(),
                "confidence": 62 if severity == "high" else 48,
                "related_assets": related_assets,
            }
        )
    return out


def _fetch_wildfires_last_48h() -> list[dict[str, Any]]:
    if requests is None:
        return []
    # Prefer FIRMS when configured, fallback to NASA EONET open events.
    firms_key = str(os.getenv("IVQ_FIRMS_KEY", "")).strip()
    out: list[dict[str, Any]] = []
    if firms_key:
        try:
            res = requests.get(
                f"https://firms.modaps.eosdis.nasa.gov/api/area/json/{firms_key}/VIIRS_SNPP_NRT/world/2",
                timeout=10,
            )
            if res.ok:
                payload = res.json()
                if isinstance(payload, list):
                    cutoff = datetime.now(timezone.utc) - timedelta(hours=48)
                    for idx, row in enumerate(payload[:300]):
                        if not isinstance(row, dict):
                            continue
                        try:
                            lat = float(row.get("latitude", np.nan))
                            lng = float(row.get("longitude", np.nan))
                        except Exception:
                            continue
                        if not np.isfinite(lat) or not np.isfinite(lng):
                            continue
                        acq = str(row.get("acq_date", "")).strip()
                        acq_t = str(row.get("acq_time", "")).strip().zfill(4)
                        dt_iso = _now_iso()
                        try:
                            if acq:
                                dt = datetime.fromisoformat(acq).replace(tzinfo=timezone.utc)
                                hh = int(acq_t[:2])
                                mm = int(acq_t[2:])
                                dt = dt.replace(hour=hh, minute=mm)
                                dt_iso = dt.isoformat()
                                if dt < cutoff:
                                    continue
                        except Exception:
                            pass
                        brightness = _safe_float(row.get("bright_ti4", row.get("brightness", np.nan)), np.nan)
                        frp = _safe_float(row.get("frp", 0.0), 0.0)
                        if np.isfinite(brightness):
                            intensity = float(np.clip((brightness - 300.0) / 120.0, 0.0, 1.0))
                        else:
                            intensity = float(np.clip(frp / 40.0, 0.0, 1.0))
                        severity = "high" if intensity >= 0.66 else ("moderate" if intensity >= 0.3 else "low")
                        out.append(
                            {
                                "id": f"firms:{idx}",
                                "type": "wildfire",
                                "event_type": "wildfire",
                                "date": dt_iso,
                                "timestamp": dt_iso,
                                "location": "Wildfire",
                                "severity": severity,
                                "brightness": None if not np.isfinite(brightness) else round(float(brightness), 2),
                                "description": f"NASA FIRMS wildfire detection (intensity {int(round(intensity * 100))}%).",
                                "lat": lat,
                                "lng": lng,
                                "color": "#ff9800",
                                "source": "NASA FIRMS",
                                "related_assets": ["corn", "wheat", "soybeans"],
                            }
                        )
        except Exception:
            pass
    if out:
        return out
    try:
        res = requests.get(
            "https://eonet.gsfc.nasa.gov/api/v3/events",
            params={"status": "open", "category": "wildfires", "days": 2},
            timeout=8,
        )
        res.raise_for_status()
        payload = res.json()
    except Exception:
        return []
    rows = payload.get("events", []) if isinstance(payload, dict) else []
    for row in rows:
        if not isinstance(row, dict):
            continue
        geoms = row.get("geometry", [])
        if not isinstance(geoms, list) or not geoms:
            continue
        last = geoms[-1] if isinstance(geoms[-1], dict) else {}
        coords = last.get("coordinates", [])
        if not isinstance(coords, list) or len(coords) < 2:
            continue
        lng = float(coords[0])
        lat = float(coords[1])
        out.append(
            {
                "id": f"eonet:{row.get('id', len(out))}",
                "type": "wildfire",
                "event_type": "wildfire",
                "date": str(last.get("date") or _now_iso()),
                "timestamp": str(last.get("date") or _now_iso()),
                "location": str(row.get("title") or "Wildfire"),
                "severity": "moderate",
                "brightness": None,
                "description": str(row.get("title") or "NASA EONET wildfire event"),
                "lat": lat,
                "lng": lng,
                "color": "#ff9800",
                "source": "NASA EONET",
                "related_assets": ["corn", "wheat", "soybeans"],
            }
        )
    return out


def _safe_float(value: Any, fallback: float = 0.0) -> float:
    try:
        out = float(value)
    except Exception:
        out = fallback
    if not np.isfinite(out):
        return float(fallback)
    return float(out)


def _normalize_geo_event_item(row: dict[str, Any], idx: int) -> dict[str, Any]:
    ev_type = str(row.get("event_type") or row.get("type") or "event").strip().lower() or "event"
    lat = _safe_float(row.get("latitude", row.get("lat", 0.0)), 0.0)
    lng = _safe_float(row.get("longitude", row.get("lng", 0.0)), 0.0)
    timestamp = str(row.get("timestamp") or row.get("date") or _now_iso()).strip() or _now_iso()
    location = str(row.get("location") or row.get("name") or "Global").strip() or "Global"
    severity = str(row.get("severity") or "medium").strip() or "medium"
    description = str(row.get("description") or row.get("headline") or f"{ev_type.title()} event").strip()
    color = str(row.get("color") or "#ff9800").strip() or "#ff9800"
    event_id = str(row.get("id") or f"{ev_type}:{idx}").strip() or f"{ev_type}:{idx}"
    sentiment = str(row.get("sentiment") or "").strip()
    out = {
        "event_id": event_id,
        "id": event_id,
        "type": ev_type,
        "event_type": ev_type,
        "date": timestamp,
        "timestamp": timestamp,
        "title": str(row.get("title") or row.get("headline") or location).strip() or location,
        "source": str(row.get("source") or "Invoria").strip() or "Invoria",
        "country": str(row.get("country") or "").strip(),
        "location": location,
        "severity": severity,
        "description": description,
        "lat": lat,
        "lng": lng,
        "latitude": lat,
        "longitude": lng,
        "color": color,
        "headline": str(row.get("headline") or description).strip(),
        "url": str(row.get("url") or "").strip(),
        "sentiment": sentiment,
        "confidence": int(_safe_float(row.get("confidence", 0), 0.0)),
        "related_assets": [str(x).strip() for x in row.get("related_assets", row.get("relatedAssets", [])) if str(x).strip()] if isinstance(row.get("related_assets", row.get("relatedAssets", [])), list) else [],
        "relatedAssets": [str(x).strip() for x in row.get("related_assets", row.get("relatedAssets", [])) if str(x).strip()] if isinstance(row.get("related_assets", row.get("relatedAssets", [])), list) else [],
        "magnitude": _safe_float(row.get("magnitude"), np.nan) if row.get("magnitude") is not None else None,
        "depth": _safe_float(row.get("depth"), np.nan) if row.get("depth") is not None else None,
        "clusterKey": str(row.get("clusterKey") or f"{ev_type}:{round(lat, 1)}:{round(lng, 1)}").strip(),
        "label": str(row.get("label") or f"{ev_type.title()} - {location}").strip(),
    }
    if sentiment:
        out["description"] = f"{description} | sentiment: {sentiment}"
    return out


def _fetch_fred_series_csv(series_id: str, max_points: int = 520) -> list[dict[str, Any]]:
    sid = str(series_id or "").strip().upper()
    if not sid or requests is None:
        return []

    def _factory() -> list[dict[str, Any]]:
        try:
            res = requests.get(
                "https://fred.stlouisfed.org/graph/fredgraph.csv",
                params={"id": sid},
                timeout=8,
            )
            res.raise_for_status()
            text = str(res.text or "").strip()
            if not text:
                return []
            frame = pd.read_csv(io.StringIO(text))
            if frame.empty or frame.shape[1] < 2:
                return []
            col_date = frame.columns[0]
            col_value = frame.columns[1]
            dates = frame[col_date].astype(str)
            values = pd.to_numeric(frame[col_value], errors="coerce")
            out: list[dict[str, Any]] = []
            for d, v in zip(dates.tolist(), values.tolist()):
                fv = _safe_float(v, np.nan)
                if not np.isfinite(fv):
                    continue
                out.append({"t": str(d), "v": float(fv)})
            if max_points > 0 and len(out) > max_points:
                out = out[-int(max_points):]
            return out
        except Exception:
            return []

    return _cached(f"fred_csv_v1:{sid}:{int(max_points)}", 60 * 60, _factory)


def _series_latest_value(points: list[dict[str, Any]]) -> float:
    if not points:
        return np.nan
    return _safe_float(points[-1].get("v"), np.nan)


def _series_pct_change(points: list[dict[str, Any]], lookback: int) -> float:
    if not points:
        return np.nan
    lb = int(max(1, lookback))
    if len(points) <= lb:
        return np.nan
    latest = _safe_float(points[-1].get("v"), np.nan)
    prev = _safe_float(points[-1 - lb].get("v"), np.nan)
    if not np.isfinite(latest) or not np.isfinite(prev) or abs(prev) < 1e-12:
        return np.nan
    return float(((latest / prev) - 1.0) * 100.0)


def _series_zscore(points: list[dict[str, Any]], window: int = 180) -> float:
    if not points:
        return np.nan
    vals = [_safe_float(row.get("v"), np.nan) for row in points]
    vals = [float(v) for v in vals if np.isfinite(v)]
    if len(vals) < 8:
        return np.nan
    arr = np.asarray(vals[-int(max(8, window)):], dtype=float)
    mu = float(np.mean(arr))
    sd = float(np.std(arr))
    if not np.isfinite(sd) or sd < 1e-9:
        return np.nan
    return float((arr[-1] - mu) / sd)


def _global_liquidity_real_proxies() -> dict[str, Any]:
    walcl = _fetch_fred_series_csv("WALCL", max_points=260)
    ted = _fetch_fred_series_csv("TEDRATE", max_points=260)
    dxy = _fetch_fred_series_csv("DTWEXBGS", max_points=520)
    sofr = _fetch_fred_series_csv("SOFR", max_points=260)
    spx = _fetch_fred_series_csv("SP500", max_points=520)

    walcl_13w = _series_pct_change(walcl, 13)
    ted_latest = _series_latest_value(ted)
    dxy_20d = _series_pct_change(dxy, 20)
    sofr_latest = _series_latest_value(sofr)
    spx_20d = _series_pct_change(spx, 20)
    ted_z = _series_zscore(ted, window=200)
    sofr_z = _series_zscore(sofr, window=200)
    dxy_z = _series_zscore(dxy, window=200)

    central_bank_liquidity = float(np.clip((walcl_13w + 4.0) / 10.0, 0.0, 1.0)) if np.isfinite(walcl_13w) else 0.5
    usd_funding_stress = 0.0
    if np.isfinite(ted_latest):
        usd_funding_stress += float(np.clip(ted_latest / 1.25, 0.0, 1.0)) * 0.48
    elif np.isfinite(ted_z):
        usd_funding_stress += float(np.clip((ted_z + 2.0) / 4.0, 0.0, 1.0)) * 0.48
    else:
        usd_funding_stress += 0.24

    if np.isfinite(dxy_20d):
        usd_funding_stress += float(np.clip(max(0.0, dxy_20d) / 4.0, 0.0, 1.0)) * 0.28
    elif np.isfinite(dxy_z):
        usd_funding_stress += float(np.clip((dxy_z + 2.0) / 4.0, 0.0, 1.0)) * 0.28
    else:
        usd_funding_stress += 0.14

    if np.isfinite(sofr_latest):
        usd_funding_stress += float(np.clip((sofr_latest - 2.0) / 4.5, 0.0, 1.0)) * 0.24
    elif np.isfinite(sofr_z):
        usd_funding_stress += float(np.clip((sofr_z + 2.0) / 4.0, 0.0, 1.0)) * 0.24
    else:
        usd_funding_stress += 0.12
    usd_funding_stress = float(np.clip(usd_funding_stress, 0.0, 1.0))

    if np.isfinite(spx_20d):
        global_capital_flows = float(np.clip(0.5 + (spx_20d / 10.0) - (usd_funding_stress * 0.18), 0.0, 1.0))
    else:
        global_capital_flows = float(np.clip(0.58 - (usd_funding_stress * 0.22), 0.0, 1.0))

    available = bool(walcl or ted or dxy or sofr or spx)
    return {
        "source": "fred_csv",
        "available": available,
        "series": {
            "WALCL": walcl[-5:] if walcl else [],
            "TEDRATE": ted[-5:] if ted else [],
            "DTWEXBGS": dxy[-5:] if dxy else [],
            "SOFR": sofr[-5:] if sofr else [],
            "SP500": spx[-5:] if spx else [],
        },
        "raw": {
            "walclChange13wPct": None if not np.isfinite(walcl_13w) else round(float(walcl_13w), 4),
            "tedRate": None if not np.isfinite(ted_latest) else round(float(ted_latest), 4),
            "dxyChange20dPct": None if not np.isfinite(dxy_20d) else round(float(dxy_20d), 4),
            "sofr": None if not np.isfinite(sofr_latest) else round(float(sofr_latest), 4),
            "sp500Change20dPct": None if not np.isfinite(spx_20d) else round(float(spx_20d), 4),
        },
        "scores": {
            "centralBankLiquidity": round(central_bank_liquidity, 4),
            "usdFundingStress": round(usd_funding_stress, 4),
            "globalCapitalFlows": round(global_capital_flows, 4),
        },
    }


_OIL_ROUTE_ROWS: list[dict[str, Any]] = [
    {
        "id": "oil_pg_asia",
        "name": "Persian Gulf to Asia",
        "from": "Persian Gulf",
        "to": "Asia",
        "path": [
            {"lat": 25.2, "lng": 55.3},
            {"lat": 17.0, "lng": 61.0},
            {"lat": 10.0, "lng": 72.0},
            {"lat": 1.5, "lng": 103.5},
            {"lat": 22.3, "lng": 114.2},
        ],
        "color": "rgba(90,170,255,0.50)",
        "lineWidth": 0.58,
        "animationSpeed": 0.7,
    },
    {
        "id": "oil_pg_eu",
        "name": "Persian Gulf to Europe",
        "from": "Persian Gulf",
        "to": "Europe",
        "path": [
            {"lat": 25.2, "lng": 55.3},
            {"lat": 20.0, "lng": 49.0},
            {"lat": 15.5, "lng": 43.0},
            {"lat": 12.0, "lng": 43.8},
            {"lat": 30.1, "lng": 32.6},
            {"lat": 36.0, "lng": 14.8},
            {"lat": 51.9, "lng": 4.4},
        ],
        "color": "rgba(90,170,255,0.48)",
        "lineWidth": 0.58,
        "animationSpeed": 0.62,
    },
    {
        "id": "oil_usg_eu",
        "name": "US Gulf to Europe",
        "from": "US Gulf",
        "to": "Europe",
        "path": [
            {"lat": 29.3, "lng": -94.8},
            {"lat": 31.2, "lng": -78.0},
            {"lat": 36.0, "lng": -55.0},
            {"lat": 45.0, "lng": -20.0},
            {"lat": 51.9, "lng": 4.4},
        ],
        "color": "rgba(90,170,255,0.44)",
        "lineWidth": 0.55,
        "animationSpeed": 0.57,
    },
    {
        "id": "oil_usg_asia",
        "name": "US Gulf to Asia",
        "from": "US Gulf",
        "to": "Asia",
        "path": [
            {"lat": 29.3, "lng": -94.8},
            {"lat": 9.5, "lng": -79.6},
            {"lat": -2.0, "lng": -98.0},
            {"lat": 1.3, "lng": 103.8},
            {"lat": 22.3, "lng": 114.2},
        ],
        "color": "rgba(90,170,255,0.42)",
        "lineWidth": 0.55,
        "animationSpeed": 0.53,
    },
]


_CONTAINER_ROUTE_ROWS: list[dict[str, Any]] = [
    {
        "id": "cont_sh_sg",
        "name": "Shanghai to Singapore",
        "from": "Shanghai",
        "to": "Singapore",
        "path": [
            {"lat": 31.2, "lng": 121.5},
            {"lat": 24.0, "lng": 118.5},
            {"lat": 12.0, "lng": 108.0},
            {"lat": 1.3, "lng": 103.8},
        ],
        "color": "rgba(150,210,255,0.35)",
        "lineWidth": 0.48,
        "animationSpeed": 0.55,
    },
    {
        "id": "cont_sg_rt",
        "name": "Singapore to Rotterdam",
        "from": "Singapore",
        "to": "Rotterdam",
        "path": [
            {"lat": 1.3, "lng": 103.8},
            {"lat": 6.0, "lng": 78.0},
            {"lat": 12.0, "lng": 43.5},
            {"lat": 30.1, "lng": 32.6},
            {"lat": 36.0, "lng": 14.8},
            {"lat": 43.0, "lng": 2.0},
            {"lat": 51.9, "lng": 4.4},
        ],
        "color": "rgba(150,210,255,0.34)",
        "lineWidth": 0.5,
        "animationSpeed": 0.52,
    },
    {
        "id": "cont_sh_la",
        "name": "Shanghai to Los Angeles",
        "from": "Shanghai",
        "to": "Los Angeles",
        "path": [
            {"lat": 31.2, "lng": 121.5},
            {"lat": 35.0, "lng": 150.0},
            {"lat": 35.0, "lng": 170.0},
            {"lat": 34.2, "lng": -140.0},
            {"lat": 33.7, "lng": -118.2},
        ],
        "color": "rgba(150,210,255,0.33)",
        "lineWidth": 0.48,
        "animationSpeed": 0.5,
    },
    {
        "id": "cont_db_rt",
        "name": "Dubai to Rotterdam",
        "from": "Dubai",
        "to": "Rotterdam",
        "path": [
            {"lat": 25.2, "lng": 55.3},
            {"lat": 20.0, "lng": 49.0},
            {"lat": 12.0, "lng": 43.8},
            {"lat": 30.1, "lng": 32.6},
            {"lat": 36.0, "lng": 14.8},
            {"lat": 51.9, "lng": 4.4},
        ],
        "color": "rgba(150,210,255,0.30)",
        "lineWidth": 0.46,
        "animationSpeed": 0.48,
    },
]


_COMMODITY_REGION_ROWS: list[dict[str, Any]] = [
    {"id": "comm_oil_me", "commodity": "Oil", "region": "Middle East", "lat": 24.0, "lng": 45.0, "icon": "OIL"},
    {"id": "comm_oil_us", "commodity": "Oil", "region": "United States", "lat": 31.0, "lng": -97.0, "icon": "OIL"},
    {"id": "comm_oil_ru", "commodity": "Oil", "region": "Russia", "lat": 61.0, "lng": 90.0, "icon": "OIL"},
    {"id": "comm_gold_za", "commodity": "Gold", "region": "South Africa", "lat": -26.2, "lng": 28.0, "icon": "AUX"},
    {"id": "comm_gold_au", "commodity": "Gold", "region": "Australia", "lat": -25.0, "lng": 133.0, "icon": "AUX"},
    {"id": "comm_gold_ca", "commodity": "Gold", "region": "Canada", "lat": 55.0, "lng": -106.0, "icon": "AUX"},
    {"id": "comm_wheat_ua", "commodity": "Wheat", "region": "Ukraine", "lat": 49.0, "lng": 31.0, "icon": "WHT"},
    {"id": "comm_wheat_us", "commodity": "Wheat", "region": "United States", "lat": 39.0, "lng": -98.0, "icon": "WHT"},
    {"id": "comm_wheat_ru", "commodity": "Wheat", "region": "Russia", "lat": 54.0, "lng": 40.0, "icon": "WHT"},
    {"id": "comm_copper_cl", "commodity": "Copper", "region": "Chile", "lat": -30.0, "lng": -71.0, "icon": "CU"},
    {"id": "comm_copper_pe", "commodity": "Copper", "region": "Peru", "lat": -9.0, "lng": -75.0, "icon": "CU"},
    {"id": "comm_coffee_br", "commodity": "Coffee", "region": "Brazil", "lat": -15.0, "lng": -47.0, "icon": "COF"},
    {"id": "comm_coffee_co", "commodity": "Coffee", "region": "Colombia", "lat": 4.5, "lng": -74.0, "icon": "COF"},
    {"id": "comm_cocoa_ci", "commodity": "Cocoa", "region": "Ivory Coast", "lat": 7.6, "lng": -5.5, "icon": "COC"},
    {"id": "comm_cocoa_gh", "commodity": "Cocoa", "region": "Ghana", "lat": 7.9, "lng": -1.0, "icon": "COC"},
]


_SHIP_TRACKING_SEED: list[dict[str, Any]] = [
    {"id": "ship_ot_1", "name": "Atlas Dawn", "shipType": "oil_tanker", "speed": 13.8, "heading": 68, "destination": "Singapore", "routeId": "oil_pg_asia", "progress": 0.16},
    {"id": "ship_ot_2", "name": "Persian Horizon", "shipType": "oil_tanker", "speed": 12.5, "heading": 295, "destination": "Rotterdam", "routeId": "oil_pg_eu", "progress": 0.44},
    {"id": "ship_ot_3", "name": "Gulf Meridian", "shipType": "oil_tanker", "speed": 14.2, "heading": 51, "destination": "Rotterdam", "routeId": "oil_usg_eu", "progress": 0.31},
    {"id": "ship_ot_4", "name": "Liberty Tanker", "shipType": "oil_tanker", "speed": 13.1, "heading": 258, "destination": "Hong Kong", "routeId": "oil_usg_asia", "progress": 0.71},
    {"id": "ship_ct_1", "name": "Pacific Aurora", "shipType": "container", "speed": 17.3, "heading": 212, "destination": "Los Angeles", "routeId": "cont_sh_la", "progress": 0.39},
    {"id": "ship_ct_2", "name": "Silk Current", "shipType": "container", "speed": 16.1, "heading": 247, "destination": "Rotterdam", "routeId": "cont_sg_rt", "progress": 0.22},
    {"id": "ship_ct_3", "name": "Harbor Link", "shipType": "container", "speed": 15.8, "heading": 224, "destination": "Singapore", "routeId": "cont_sh_sg", "progress": 0.65},
    {"id": "ship_ct_4", "name": "Desert Gate", "shipType": "container", "speed": 16.7, "heading": 314, "destination": "Rotterdam", "routeId": "cont_db_rt", "progress": 0.48},
]


def _route_lookup_rows() -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for row in [*_OIL_ROUTE_ROWS, *_CONTAINER_ROUTE_ROWS]:
        out[str(row.get("id") or "")] = row
    return out


def _interpolate_path(path: list[dict[str, Any]], progress: float) -> tuple[float, float]:
    if not path:
        return 0.0, 0.0
    if len(path) == 1:
        p = path[0]
        return _safe_float(p.get("lat"), 0.0), _safe_float(p.get("lng"), 0.0)

    p = max(0.0, min(0.9999, float(progress)))
    segments = len(path) - 1
    scaled = p * segments
    idx = int(np.floor(scaled))
    frac = float(scaled - idx)
    a = path[idx]
    b = path[min(idx + 1, len(path) - 1)]
    lat = _safe_float(a.get("lat"), 0.0) + (_safe_float(b.get("lat"), 0.0) - _safe_float(a.get("lat"), 0.0)) * frac
    lng = _safe_float(a.get("lng"), 0.0) + (_safe_float(b.get("lng"), 0.0) - _safe_float(a.get("lng"), 0.0)) * frac
    return float(lat), float(lng)


def _arcgis_ship_type(code: int) -> str:
    if 80 <= int(code) <= 89:
        return "oil_tanker"
    if 70 <= int(code) <= 79:
        return "container"
    return "other"


def _normalize_route_points(points: list[dict[str, Any]], max_points: int = 8) -> list[dict[str, float]]:
    out: list[dict[str, float]] = []
    last_key: tuple[int, int] | None = None
    for row in points:
        lat = _safe_float(row.get("lat"), np.nan)
        lng = _safe_float(row.get("lng"), np.nan)
        if not np.isfinite(lat) or not np.isfinite(lng):
            continue
        key = (int(round(lat * 1000)), int(round(lng * 1000)))
        if last_key == key:
            continue
        out.append({"lat": float(lat), "lng": float(lng)})
        last_key = key
        if len(out) >= int(max(2, max_points)):
            break
    return out


def _drift_geo_point(lat: float, lng: float, heading_deg: float, speed_knots: float, seed: int) -> tuple[float, float]:
    # Small deterministic drift so markers move subtly between refreshes.
    speed = max(0.0, float(speed_knots))
    heading = np.deg2rad(float(heading_deg) % 360.0)
    phase = (time.time() / 90.0) + float(seed % 360)
    amp = min(0.06, max(0.005, speed * 0.0018))
    delta = amp * np.sin(phase)
    dlat = float(np.cos(heading) * delta)
    dlng = float(np.sin(heading) * delta / max(0.25, np.cos(np.deg2rad(lat))))
    return float(lat + dlat), float(lng + dlng)


def _fallback_ship_tracking_items() -> list[dict[str, Any]]:
    routes = _route_lookup_rows()
    tick = float(int(time.time() // 60))
    out: list[dict[str, Any]] = []
    for row in _SHIP_TRACKING_SEED:
        route_id = str(row.get("routeId") or "")
        route = routes.get(route_id) or {}
        path = route.get("path") if isinstance(route.get("path"), list) else []
        speed = _safe_float(row.get("speed"), 14.0)
        base_progress = _safe_float(row.get("progress"), 0.0)
        progress = (base_progress + (tick * max(0.02, speed * 0.00042))) % 1.0
        lat, lng = _interpolate_path(path, progress)
        out.append(
            {
                "id": str(row.get("id") or f"ship:{len(out)}"),
                "name": str(row.get("name") or "Vessel"),
                "shipType": str(row.get("shipType") or "container"),
                "speed": round(speed, 1),
                "heading": int(_safe_float(row.get("heading"), 0.0)) % 360,
                "destination": str(row.get("destination") or route.get("to") or "Unknown"),
                "routeId": route_id,
                "routeName": str(route.get("name") or route_id),
                "route": path,
                "lat": lat,
                "lng": lng,
                "progress": round(progress, 5),
                "updatedAt": _now_iso(),
            }
        )
    return out


def _fetch_ais_ship_tracking_rows(max_records: int = 2600, max_ships: int = 80) -> list[dict[str, Any]]:
    if requests is None:
        return []
    base_url = str(
        os.getenv(
            "IVQ_AIS_ARCGIS_URL",
            "https://servicesdev.arcgis.com/LkFyxb9zDq7vAOAm/ArcGIS/rest/services/ShipPositions/FeatureServer/0/query",
        )
    ).strip()
    if not base_url:
        return []

    vessel_codes = ",".join([str(x) for x in [*range(70, 80), *range(80, 90)]])
    params = {
        "where": f"VesselType IN ({vessel_codes})",
        "outFields": "MMSI,Name,VesselType,SOG,COG,Heading,Destination,BaseDateTime,Longitude,Latitude",
        "orderByFields": "BaseDateTime DESC",
        "resultRecordCount": int(max(200, max_records)),
        "outSR": 4326,
        "f": "json",
    }
    try:
        res = requests.get(base_url, params=params, timeout=14)
        res.raise_for_status()
        payload = res.json()
    except Exception:
        return []

    feats = payload.get("features", []) if isinstance(payload, dict) else []
    if not isinstance(feats, list) or not feats:
        return []

    grouped: dict[str, list[dict[str, Any]]] = {}
    for feat in feats:
        if not isinstance(feat, dict):
            continue
        attrs = feat.get("attributes", {}) if isinstance(feat.get("attributes"), dict) else {}
        geom = feat.get("geometry", {}) if isinstance(feat.get("geometry"), dict) else {}
        mmsi_raw = attrs.get("MMSI")
        mmsi = str(int(_safe_float(mmsi_raw, 0.0))) if _safe_float(mmsi_raw, 0.0) > 0 else ""
        if not mmsi:
            mmsi = str(attrs.get("OBJECTID") or "")
        if not mmsi:
            continue
        vessel_type_code = int(_safe_float(attrs.get("VesselType"), -1))
        ship_type = _arcgis_ship_type(vessel_type_code)
        if ship_type not in {"oil_tanker", "container"}:
            continue
        lat = _safe_float(attrs.get("Latitude", geom.get("y")), np.nan)
        lng = _safe_float(attrs.get("Longitude", geom.get("x")), np.nan)
        if not np.isfinite(lat) or not np.isfinite(lng):
            continue

        ts = attrs.get("BaseDateTime")
        if ts is None:
            dt_iso = _now_iso()
        else:
            try:
                dt_iso = datetime.fromtimestamp(float(ts) / 1000.0, tz=timezone.utc).isoformat()
            except Exception:
                dt_iso = _now_iso()
        speed = max(0.0, _safe_float(attrs.get("SOG"), 0.0))
        heading = int(_safe_float(attrs.get("Heading", attrs.get("COG", 0.0)), 0.0)) % 360
        grouped.setdefault(mmsi, []).append(
            {
                "mmsi": mmsi,
                "name": str(attrs.get("Name") or "").strip(),
                "shipType": ship_type,
                "shipTypeCode": vessel_type_code,
                "speed": speed,
                "heading": heading,
                "destination": str(attrs.get("Destination") or "").strip(),
                "timestamp": dt_iso,
                "lat": float(lat),
                "lng": float(lng),
            }
        )

    rows: list[dict[str, Any]] = []
    for mmsi, points in grouped.items():
        if not points:
            continue
        points = sorted(points, key=lambda r: str(r.get("timestamp") or ""), reverse=True)
        latest = points[0]
        route = _normalize_route_points(points, max_points=8)
        if len(route) < 2:
            route = _normalize_route_points(
                [
                    {"lat": latest.get("lat"), "lng": latest.get("lng")},
                    {
                        "lat": _safe_float(latest.get("lat"), 0.0) - 0.22,
                        "lng": _safe_float(latest.get("lng"), 0.0) - 0.18,
                    },
                ],
                max_points=2,
            )
        rows.append(
            {
                "id": f"ais:{mmsi}",
                "mmsi": mmsi,
                "name": str(latest.get("name") or f"Vessel {mmsi[-4:]}"),
                "shipType": str(latest.get("shipType") or "container"),
                "speed": round(_safe_float(latest.get("speed"), 0.0), 1),
                "heading": int(_safe_float(latest.get("heading"), 0.0)) % 360,
                "destination": str(latest.get("destination") or "Unknown"),
                "route": list(reversed(route)),
                "lat": _safe_float(latest.get("lat"), 0.0),
                "lng": _safe_float(latest.get("lng"), 0.0),
                "updatedAt": _now_iso(),
                "source": "marine_cadastre_arcgis",
            }
        )
    rows = sorted(rows, key=lambda r: (_safe_float(r.get("speed"), 0.0), str(r.get("id") or "")), reverse=True)
    if max_ships > 0 and len(rows) > max_ships:
        rows = rows[: int(max_ships)]
    return rows


def _ship_tracking_items() -> list[dict[str, Any]]:
    rows = _fetch_ais_ship_tracking_rows(max_records=2600, max_ships=72)
    if not rows:
        return _fallback_ship_tracking_items()
    out: list[dict[str, Any]] = []
    for row in rows:
        lat = _safe_float(row.get("lat"), 0.0)
        lng = _safe_float(row.get("lng"), 0.0)
        heading = _safe_float(row.get("heading"), 0.0)
        speed = _safe_float(row.get("speed"), 0.0)
        seed = int(_safe_float(str(row.get("mmsi") or "0")[-3:], 0.0))
        dlat, dlng = _drift_geo_point(lat, lng, heading, speed, seed)
        route = row.get("route") if isinstance(row.get("route"), list) else []
        route_name = str(row.get("destination") or "AIS route")
        out.append(
            {
                "id": str(row.get("id") or f"ship:{len(out)}"),
                "name": str(row.get("name") or "Vessel"),
                "shipType": str(row.get("shipType") or "container"),
                "speed": round(speed, 1),
                "heading": int(heading) % 360,
                "destination": str(row.get("destination") or "Unknown"),
                "routeId": str(row.get("mmsi") or row.get("id") or ""),
                "routeName": route_name,
                "route": route,
                "lat": dlat,
                "lng": dlng,
                "progress": float(np.clip(_safe_float(row.get("speed"), 0.0) / 30.0, 0.0, 0.99)),
                "updatedAt": _now_iso(),
                "source": str(row.get("source") or "ais"),
            }
        )
    return out


def get_ship_tracking_payload() -> dict[str, Any]:
    def _factory() -> dict[str, Any]:
        return {"updatedAt": _now_iso(), "items": load_ship_tracking()}

    return _cached("overlay_ship_tracking_v1", 300, _factory)


def get_oil_routes_payload() -> dict[str, Any]:
    def _factory() -> dict[str, Any]:
        rows = [dict(x) for x in _OIL_ROUTE_ROWS]
        return {"updatedAt": _now_iso(), "items": rows}

    return _cached("overlay_oil_routes_v1", 3 * 60 * 60, _factory)


def get_container_routes_payload() -> dict[str, Any]:
    def _factory() -> dict[str, Any]:
        rows = [dict(x) for x in _CONTAINER_ROUTE_ROWS]
        return {"updatedAt": _now_iso(), "items": rows}

    return _cached("overlay_container_routes_v1", 3 * 60 * 60, _factory)


def get_commodity_regions_payload() -> dict[str, Any]:
    def _factory() -> dict[str, Any]:
        rows: list[dict[str, Any]] = []
        for row in _COMMODITY_REGION_ROWS:
            rows.append(
                {
                    "id": str(row.get("id") or f"commodity:{len(rows)}"),
                    "commodity": str(row.get("commodity") or "Commodity"),
                    "region": str(row.get("region") or "Region"),
                    "lat": _safe_float(row.get("lat"), 0.0),
                    "lng": _safe_float(row.get("lng"), 0.0),
                    "icon": str(row.get("icon") or "C"),
                    "description": f"{row.get('commodity')} production region: {row.get('region')}",
                }
            )
        return {"updatedAt": _now_iso(), "items": rows}

    # Static geography: refresh very rarely.
    return _cached("overlay_commodity_regions_v1", 7 * 24 * 60 * 60, _factory)


_REGION_DEFINITIONS: dict[str, dict[str, Any]] = {
    "USA": {
        "name": "United States",
        "lat": 39.8,
        "lng": -98.6,
        "countries": ["United States"],
        "inflationProxy": ["United States", "Canada"],
        "commodityProxy": ["United States", "Canada"],
        "usdProxy": "North America",
        "shippingExposure": ["panama_canal"],
    },
    "EUROPE": {
        "name": "Europe",
        "lat": 50.0,
        "lng": 10.0,
        "countries": [
            "France",
            "Germany",
            "Italy",
            "Spain",
            "Netherlands",
            "Belgium",
            "Austria",
            "Poland",
            "Ukraine",
            "United Kingdom",
            "Sweden",
            "Norway",
            "Denmark",
            "Switzerland",
            "Romania",
        ],
        "inflationProxy": ["Europe", "United Kingdom", "Switzerland"],
        "commodityProxy": ["Europe", "United Kingdom"],
        "usdProxy": "Europe",
        "shippingExposure": ["suez_canal", "red_sea"],
    },
    "JAPAN": {
        "name": "Japan",
        "lat": 36.2,
        "lng": 138.2,
        "countries": ["Japan"],
        "inflationProxy": ["Japan"],
        "commodityProxy": ["Japan"],
        "usdProxy": "Asia",
        "shippingExposure": ["hormuz_strait", "red_sea"],
    },
    "INDIA": {
        "name": "India",
        "lat": 21.0,
        "lng": 78.0,
        "countries": ["India"],
        "inflationProxy": ["Asia", "Europe"],
        "commodityProxy": ["Asia"],
        "usdProxy": "Asia",
        "shippingExposure": ["hormuz_strait", "red_sea", "suez_canal"],
    },
    "BRAZIL": {
        "name": "Brazil",
        "lat": -14.2,
        "lng": -51.9,
        "countries": ["Brazil", "Colombia"],
        "inflationProxy": ["South America", "United States"],
        "commodityProxy": ["South America", "United States"],
        "usdProxy": "South America",
        "shippingExposure": ["panama_canal"],
    },
    "UKRAINE": {
        "name": "Ukraine",
        "lat": 49.0,
        "lng": 31.0,
        "countries": ["Ukraine"],
        "inflationProxy": ["Europe"],
        "commodityProxy": ["Europe"],
        "usdProxy": "Europe",
        "shippingExposure": ["black_sea", "suez_canal"],
    },
    "CHILE_PERU": {
        "name": "Chile / Peru",
        "lat": -19.0,
        "lng": -72.0,
        "countries": ["Chile", "Peru"],
        "inflationProxy": ["South America"],
        "commodityProxy": ["South America", "United States"],
        "usdProxy": "South America",
        "shippingExposure": ["panama_canal"],
    },
    "MIDDLE_EAST": {
        "name": "Middle East",
        "lat": 25.0,
        "lng": 45.0,
        "countries": ["Saudi Arabia", "United Arab Emirates", "Iraq", "Iran", "Qatar", "Kuwait", "Oman"],
        "inflationProxy": ["Middle East", "Europe"],
        "commodityProxy": ["Middle East", "Europe"],
        "usdProxy": "Middle East",
        "shippingExposure": ["hormuz_strait", "red_sea", "suez_canal"],
    },
    "RUSSIA": {
        "name": "Russia",
        "lat": 60.0,
        "lng": 90.0,
        "countries": ["Russia"],
        "inflationProxy": ["Europe", "Asia"],
        "commodityProxy": ["Europe"],
        "usdProxy": "Europe",
        "shippingExposure": ["black_sea", "suez_canal"],
    },
    "WEST_AFRICA": {
        "name": "West Africa",
        "lat": 7.8,
        "lng": -4.0,
        "countries": ["Cote d'Ivoire", "Ghana"],
        "inflationProxy": ["Africa"],
        "commodityProxy": ["Africa"],
        "usdProxy": "Africa",
        "shippingExposure": ["suez_canal"],
    },
}


_ASSET_REGION_MAP: dict[str, str | list[str]] = {
    "EUR": "EUROPE",
    "USD": "USA",
    "USD_INDEX": "USA",
    "JPY": "JAPAN",
    "GBP": "EUROPE",
    "CHF": "EUROPE",
    "CAD": "USA",
    "AUD": "USA",
    "NZD": "USA",
    "COTTON": "INDIA",
    "COFFEE": "BRAZIL",
    "WHEAT": ["USA", "UKRAINE"],
    "COPPER": "CHILE_PERU",
    "GOLD": ["MIDDLE_EAST", "CHILE_PERU", "WEST_AFRICA"],
    "SILVER": "CHILE_PERU",
    "COCOA": "WEST_AFRICA",
    "OIL": ["MIDDLE_EAST", "USA", "RUSSIA"],
    "WTI_SPOT": ["USA", "MIDDLE_EAST"],
    "NATGAS": ["USA", "EUROPE"],
    "SP500": "USA",
    "NASDAQ100": "USA",
    "DOWJONES": "USA",
    "DAX40": "EUROPE",
}


_SHIPPING_DISRUPTION_ZONES: list[dict[str, Any]] = [
    {
        "id": "suez_canal",
        "name": "Suez Canal Congestion",
        "lat": 30.1,
        "lng": 32.6,
        "radiusKm": 760.0,
        "baseRisk": 0.44,
        "regions": ["EUROPE", "MIDDLE_EAST"],
        "path": [
            {"lat": 29.7, "lng": 32.2},
            {"lat": 27.8, "lng": 33.1},
            {"lat": 24.0, "lng": 37.0},
            {"lat": 16.0, "lng": 43.5},
        ],
    },
    {
        "id": "panama_canal",
        "name": "Panama Canal Delays",
        "lat": 9.1,
        "lng": -79.7,
        "radiusKm": 780.0,
        "baseRisk": 0.38,
        "regions": ["USA", "BRAZIL", "CHILE_PERU"],
        "path": [
            {"lat": 9.1, "lng": -79.7},
            {"lat": 18.5, "lng": -87.0},
            {"lat": 30.0, "lng": -95.0},
        ],
    },
    {
        "id": "hormuz_strait",
        "name": "Strait of Hormuz Tensions",
        "lat": 26.6,
        "lng": 56.3,
        "radiusKm": 700.0,
        "baseRisk": 0.52,
        "regions": ["MIDDLE_EAST", "INDIA", "JAPAN"],
        "path": [
            {"lat": 26.6, "lng": 56.3},
            {"lat": 24.3, "lng": 58.3},
            {"lat": 19.0, "lng": 63.0},
            {"lat": 14.0, "lng": 69.0},
        ],
    },
    {
        "id": "red_sea",
        "name": "Red Sea Shipping Risks",
        "lat": 20.5,
        "lng": 38.0,
        "radiusKm": 900.0,
        "baseRisk": 0.5,
        "regions": ["MIDDLE_EAST", "EUROPE", "INDIA", "JAPAN"],
        "path": [
            {"lat": 12.5, "lng": 43.2},
            {"lat": 17.0, "lng": 40.0},
            {"lat": 24.0, "lng": 36.0},
            {"lat": 30.1, "lng": 32.6},
        ],
    },
    {
        "id": "black_sea",
        "name": "Black Sea Export Frictions",
        "lat": 44.0,
        "lng": 35.0,
        "radiusKm": 720.0,
        "baseRisk": 0.36,
        "regions": ["EUROPE", "UKRAINE", "RUSSIA"],
        "path": [
            {"lat": 45.4, "lng": 30.7},
            {"lat": 44.0, "lng": 35.0},
            {"lat": 42.7, "lng": 40.2},
        ],
    },
]


def _norm_key(value: str) -> str:
    t = re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()
    if t == "united states of america":
        return "united states"
    if t == "usa":
        return "united states"
    if t == "uk":
        return "united kingdom"
    if t == "ivory coast":
        return "cote d ivoire"
    return t


def _case_lookup(table: dict[str, Any], key: str) -> Any:
    if not isinstance(table, dict):
        return None
    direct = table.get(key)
    if direct is not None:
        return direct
    nk = _norm_key(key)
    for k, v in table.items():
        if _norm_key(str(k)) == nk:
            return v
    return None


def _country_from_location_label(label: str) -> str:
    raw = str(label or "")
    t = raw.strip().lower()
    if not t:
        return ""
    m = re.search(r"\(([^)]+)\)", raw)
    if m and m.group(1):
        return str(m.group(1)).strip()
    if "europe" in t or "eurozone" in t or "euro area" in t:
        return "Europe"
    if any(x in t for x in ("new york", "texas", "louisiana", "florida", "kansas", "iowa", "usa", "united states")):
        return "United States"
    if "tokyo" in t or "japan" in t:
        return "Japan"
    if "india" in t:
        return "India"
    if "brazil" in t or "sao paulo" in t or "recife" in t:
        return "Brazil"
    if "ukraine" in t:
        return "Ukraine"
    if "chile" in t:
        return "Chile"
    if "peru" in t:
        return "Peru"
    if "russia" in t:
        return "Russia"
    if "ghana" in t:
        return "Ghana"
    if "ivory coast" in t or "cote d'ivoire" in t:
        return "Cote d'Ivoire"
    return ""


def _country_to_region_ids(country: str) -> list[str]:
    ck = _norm_key(country)
    if not ck:
        return []
    out: list[str] = []
    for rid, meta in _REGION_DEFINITIONS.items():
        for c in meta.get("countries", []):
            if _norm_key(str(c)) == ck:
                out.append(rid)
                break
    if ck == "europe" and "EUROPE" not in out:
        out.append("EUROPE")
    return out


def _asset_region_ids(asset_id: str) -> list[str]:
    aid = str(asset_id or "").strip().lower()
    if not aid:
        return []
    try:
        row = _asset_row(aid)
    except Exception:
        row = {}

    tokens: set[str] = set()
    tokens.add(aid.upper())
    tokens.add(aid.replace("-", "_").upper())
    if isinstance(row, dict):
        sym = str(row.get("symbol") or row.get("tvSource") or "").strip().upper()
        if sym:
            tokens.add(sym)
            tokens.add(sym.replace("/", "_"))
        nm = re.sub(r"[^A-Z0-9]+", "_", str(row.get("name") or "").upper()).strip("_")
        if nm:
            tokens.add(nm)

    out: list[str] = []
    for token in tokens:
        mapped = _ASSET_REGION_MAP.get(token)
        if mapped is None:
            continue
        if isinstance(mapped, list):
            for rid in mapped:
                key = str(rid).strip().upper()
                if key in _REGION_DEFINITIONS and key not in out:
                    out.append(key)
        else:
            key = str(mapped).strip().upper()
            if key in _REGION_DEFINITIONS and key not in out:
                out.append(key)

    if not out and isinstance(row, dict):
        locations = row.get("locations", [])
        if isinstance(locations, list):
            for loc in locations:
                if not isinstance(loc, dict):
                    continue
                country = _country_from_location_label(str(loc.get("label") or ""))
                for rid in _country_to_region_ids(country):
                    if rid not in out:
                        out.append(rid)
    return out


def _seasonality_bias_score(asset_id: str) -> tuple[str, float]:
    try:
        season = get_seasonality_payload(asset_id)
    except Exception:
        return "neutral", 0.0
    stats = season.get("stats", {}) if isinstance(season, dict) else {}
    direction = str(stats.get("direction") or "").strip().upper()
    hit = _safe_float(stats.get("hitRate"), 0.5)
    if hit > 1.5:
        hit = hit / 100.0
    hit = float(np.clip(hit, 0.0, 1.0))
    strength = float(np.clip(abs(hit - 0.5) * 2.0, 0.0, 1.0))
    signed = strength if direction == "LONG" else (-strength if direction == "SHORT" else 0.0)
    if abs(signed) < 0.12:
        return "neutral", 0.0
    return ("bullish", signed) if signed > 0 else ("bearish", signed)


def _geo_distance_km(lat_a: float, lng_a: float, lat_b: float, lng_b: float) -> float:
    la1 = np.radians(_safe_float(lat_a, 0.0))
    lo1 = np.radians(_safe_float(lng_a, 0.0))
    la2 = np.radians(_safe_float(lat_b, 0.0))
    lo2 = np.radians(_safe_float(lng_b, 0.0))
    d_lat = la2 - la1
    d_lng = lo2 - lo1
    h = np.sin(d_lat / 2.0) ** 2 + np.cos(la1) * np.cos(la2) * (np.sin(d_lng / 2.0) ** 2)
    c = 2.0 * np.arctan2(np.sqrt(max(0.0, h)), np.sqrt(max(0.0, 1.0 - h)))
    return float(6371.0 * c)


def _shipping_zone_scores() -> dict[str, float]:
    try:
        conflict_rows = get_geo_events_payload("conflicts").get("items", [])
    except Exception:
        conflict_rows = []
    try:
        ship_rows = get_ship_tracking_payload().get("items", [])
    except Exception:
        ship_rows = []

    out: dict[str, float] = {}
    for zone in _SHIPPING_DISRUPTION_ZONES:
        z_lat = _safe_float(zone.get("lat"), 0.0)
        z_lng = _safe_float(zone.get("lng"), 0.0)
        radius_km = _safe_float(zone.get("radiusKm"), 700.0)

        conflict_hits = 0
        for row in conflict_rows:
            if not isinstance(row, dict):
                continue
            lat = _safe_float(row.get("lat"), np.nan)
            lng = _safe_float(row.get("lng"), np.nan)
            if not np.isfinite(lat) or not np.isfinite(lng):
                continue
            if _geo_distance_km(z_lat, z_lng, lat, lng) <= radius_km:
                conflict_hits += 1

        zone_ships: list[dict[str, Any]] = []
        for ship in ship_rows:
            if not isinstance(ship, dict):
                continue
            lat = _safe_float(ship.get("lat"), np.nan)
            lng = _safe_float(ship.get("lng"), np.nan)
            if not np.isfinite(lat) or not np.isfinite(lng):
                continue
            if _geo_distance_km(z_lat, z_lng, lat, lng) <= (radius_km * 1.1):
                zone_ships.append(ship)
        slow = sum(1 for s in zone_ships if _safe_float(s.get("speed"), 16.0) < 13.0)
        congestion = float(slow) / float(max(1, len(zone_ships)))

        base = _safe_float(zone.get("baseRisk"), 0.35)
        score = base + min(0.36, conflict_hits * 0.018) + (congestion * 0.32)
        out[str(zone.get("id") or "")] = float(np.clip(score, 0.0, 1.0))
    return out


def get_shipping_disruptions_payload() -> dict[str, Any]:
    def _factory() -> dict[str, Any]:
        scores = _shipping_zone_scores()
        items_raw: list[dict[str, Any]] = []
        routes: list[dict[str, Any]] = []
        now = _now_iso()

        for idx, zone in enumerate(_SHIPPING_DISRUPTION_ZONES):
            zid = str(zone.get("id") or f"zone:{idx}")
            score = float(np.clip(scores.get(zid, _safe_float(zone.get("baseRisk"), 0.3)), 0.0, 1.0))
            sev = "high" if score >= 0.66 else ("medium" if score >= 0.4 else "low")
            color = "#ff384c" if sev == "high" else ("#ff9800" if sev == "medium" else "#facc15")
            items_raw.append(
                {
                    "id": f"shipping:{zid}",
                    "type": "shipping_disruption",
                    "event_type": "shipping_disruption",
                    "date": now,
                    "timestamp": now,
                    "location": str(zone.get("name") or "Shipping Disruption"),
                    "severity": sev,
                    "description": f"{str(zone.get('name') or 'Shipping risk')} score {int(round(score * 100))}%.",
                    "lat": _safe_float(zone.get("lat"), 0.0),
                    "lng": _safe_float(zone.get("lng"), 0.0),
                    "color": color,
                    "source": "Shipping Intelligence",
                    "country": str(zone.get("country") or ""),
                    "related_assets": ["wti_spot", "natgas", "sp500"],
                    "label": f"Shipping - {str(zone.get('name') or 'risk')}",
                }
            )
            path = zone.get("path") if isinstance(zone.get("path"), list) else []
            if path and len(path) >= 2:
                routes.append(
                    {
                        "id": f"shipping-route:{zid}",
                        "name": str(zone.get("name") or zid),
                        "from": str(path[0].get("lat") if isinstance(path[0], dict) else ""),
                        "to": str(path[-1].get("lat") if isinstance(path[-1], dict) else ""),
                        "path": path,
                        "color": f"rgba(255,132,68,{0.22 + (score * 0.34):.3f})",
                        "lineWidth": float(0.44 + (score * 0.26)),
                        "animationSpeed": float(0.5 + (score * 0.45)),
                    }
                )

        items = [_normalize_geo_event_item(row, idx) for idx, row in enumerate(items_raw)]
        return {"updatedAt": now, "items": items, "routes": routes}

    return _cached("overlay_shipping_disruptions_v1", 600, _factory)


def get_commodity_stress_map_payload() -> dict[str, Any]:
    def _factory() -> dict[str, Any]:
        macro = get_macro_commodity_shock_payload()
        signals = macro.get("signals", []) if isinstance(macro, dict) else []
        region_scores = macro.get("regionScores", {}) if isinstance(macro, dict) else {}
        zone_scores = _shipping_zone_scores()

        signal_strength: dict[str, float] = {}
        for row in signals:
            if not isinstance(row, dict):
                continue
            sid = str(row.get("id") or "").strip().lower()
            ch = _safe_float(row.get("change20d"), 0.0)
            th = max(1e-9, _safe_float(row.get("threshold"), 10.0))
            val = float(np.clip((ch / th) - 1.0, 0.0, 1.0))
            signal_strength[sid] = max(signal_strength.get(sid, 0.0), val)

        zone_region_scores: dict[str, float] = {}
        for zone in _SHIPPING_DISRUPTION_ZONES:
            zscore = float(zone_scores.get(str(zone.get("id") or ""), 0.0))
            for rid in zone.get("regions", []):
                key = str(rid).strip().upper()
                if not key:
                    continue
                zone_region_scores[key] = max(zone_region_scores.get(key, 0.0), zscore)

        out_rows: list[dict[str, Any]] = []
        by_region: dict[str, float] = {}
        for row in _COMMODITY_REGION_ROWS:
            commodity = str(row.get("commodity") or "").strip().lower()
            region_name = str(row.get("region") or "").strip()
            region_ids = _country_to_region_ids(region_name)
            rid = region_ids[0] if region_ids else ""

            base_signal = 0.0
            if commodity == "oil":
                base_signal = signal_strength.get("oil", 0.0)
            elif commodity == "wheat":
                base_signal = signal_strength.get("wheat", 0.0)
            elif commodity == "copper":
                base_signal = signal_strength.get("copper", 0.0)
            elif commodity == "gold":
                base_signal = max(signal_strength.get("copper", 0.0) * 0.55, signal_strength.get("oil", 0.0) * 0.4)
            elif commodity == "coffee":
                base_signal = max(signal_strength.get("wheat", 0.0) * 0.48, signal_strength.get("oil", 0.0) * 0.22)
            elif commodity == "cocoa":
                base_signal = signal_strength.get("wheat", 0.0) * 0.52

            regional_macro = 0.0
            if rid in _REGION_DEFINITIONS:
                proxy = _REGION_DEFINITIONS[rid].get("commodityProxy", [])
                if isinstance(proxy, list):
                    regional_macro = max((_safe_float(_case_lookup(region_scores, str(x)), 0.0) for x in proxy), default=0.0)

            shipping = zone_region_scores.get(rid, 0.0)
            stress = float(np.clip(max(base_signal, regional_macro * 0.9) + (shipping * 0.22), 0.0, 1.0))
            level = "high" if stress >= 0.65 else ("medium" if stress >= 0.36 else "low")
            glow = bool(stress >= 0.45)
            out_rows.append(
                {
                    "id": f"stress:{str(row.get('id') or len(out_rows))}",
                    "commodity": str(row.get("commodity") or "Commodity"),
                    "region": region_name,
                    "lat": _safe_float(row.get("lat"), 0.0),
                    "lng": _safe_float(row.get("lng"), 0.0),
                    "icon": str(row.get("icon") or "C"),
                    "description": f"{str(row.get('commodity') or 'Commodity')} supply stress in {region_name}: {int(round(stress * 100))}%",
                    "stressScore": round(stress, 4),
                    "stressLevel": level,
                    "glow": glow,
                }
            )
            by_region[region_name] = max(by_region.get(region_name, 0.0), stress)

        return {
            "updatedAt": _now_iso(),
            "mode": str(macro.get("mode") or "Localized Stress") if isinstance(macro, dict) else "Localized Stress",
            "regionScores": by_region,
            "items": out_rows,
        }

    return _cached("overlay_commodity_stress_v1", 2 * 60 * 60, _factory)


def get_global_liquidity_map_payload() -> dict[str, Any]:
    def _factory() -> dict[str, Any]:
        macro_usd = get_macro_usd_strength_payload()
        macro_vol = get_macro_volatility_payload()
        macro_risk = get_macro_risk_payload()
        macro_policy = get_macro_policy_rate_payload()
        macro_infl = get_macro_inflation_payload()
        macro_fundamental = get_macro_fundamental_payload()
        macro_commodity = get_macro_commodity_shock_payload()
        shipping = get_shipping_disruptions_payload()

        usd_score = _safe_float(macro_usd.get("usdScore"), 0.0) if isinstance(macro_usd, dict) else 0.0
        usd_regions = macro_usd.get("regions", {}) if isinstance(macro_usd, dict) else {}
        vol_score = _safe_float(macro_vol.get("volScore"), 50.0) if isinstance(macro_vol, dict) else 50.0
        risk_score = _safe_float(macro_risk.get("riskScore"), 50.0) if isinstance(macro_risk, dict) else 50.0
        risk_mode = str(macro_risk.get("riskMode") or "").lower() if isinstance(macro_risk, dict) else ""
        policy_map = macro_policy.get("countryPolicyRate", {}) if isinstance(macro_policy, dict) else {}
        infl_map = macro_infl.get("countryCpiYoY", {}) if isinstance(macro_infl, dict) else {}
        commodity_map = macro_commodity.get("regionScores", {}) if isinstance(macro_commodity, dict) else {}
        shipping_rows = shipping.get("items", []) if isinstance(shipping, dict) else []
        shipping_zone_scores = _shipping_zone_scores()
        real_liquidity = _global_liquidity_real_proxies()
        real_scores = real_liquidity.get("scores", {}) if isinstance(real_liquidity, dict) else {}
        real_cb_liq = _safe_float(_case_lookup(real_scores, "centralBankLiquidity"), 0.5)
        real_usd_stress = _safe_float(_case_lookup(real_scores, "usdFundingStress"), 0.5)
        real_cap_flows = _safe_float(_case_lookup(real_scores, "globalCapitalFlows"), 0.5)

        fed_liquidity_points = []
        if isinstance(macro_fundamental, dict):
            fed_liquidity_points = (
                (macro_fundamental.get("fedLiquidity", {}) or {}).get("net", [])
                if isinstance(macro_fundamental.get("fedLiquidity"), dict)
                else []
            )
        fed_liquidity_latest = 0.0
        if isinstance(fed_liquidity_points, list) and fed_liquidity_points:
            last = fed_liquidity_points[-1]
            if isinstance(last, dict):
                fed_liquidity_latest = _safe_float(last.get("v"), 0.0)
        fed_liquidity_norm = float(np.clip((fed_liquidity_latest + 100.0) / 200.0, 0.0, 1.0))

        global_rates: list[float] = []
        if isinstance(policy_map, dict):
            for row in policy_map.values():
                if not isinstance(row, dict):
                    continue
                rate = _safe_float(row.get("rate"), np.nan)
                if np.isfinite(rate):
                    global_rates.append(float(rate))
        global_rate = float(np.mean(global_rates)) if global_rates else 3.0

        indicators = {
            "centralBankLiquidity": {},
            "usdFundingStress": {},
            "globalCapitalFlows": {},
        }
        regions: list[dict[str, Any]] = []

        for rid, meta in _REGION_DEFINITIONS.items():
            name = str(meta.get("name") or rid)
            usd_proxy = str(meta.get("usdProxy") or "")
            usd_region_raw = _safe_float(_case_lookup(usd_regions, usd_proxy), usd_score)
            usd_funding_stress = float(
                np.clip(
                    abs(float(np.clip(usd_region_raw, -1.0, 1.0))) * 0.78
                    + (max(0.0, (vol_score - 50.0) / 50.0) * 0.24)
                    + (max(0.0, (risk_score - 50.0) / 50.0) * 0.22)
                    + (real_usd_stress * 0.28)
                    + (0.12 if "risk-off" in risk_mode else 0.0),
                    0.0,
                    1.0,
                )
            )
            if rid == "USA":
                usd_funding_stress = float(np.clip(usd_funding_stress * 0.78, 0.0, 1.0))

            infl_proxy = meta.get("inflationProxy", [])
            infl_vals: list[float] = []
            if isinstance(infl_proxy, list):
                for key in infl_proxy:
                    v = _case_lookup(infl_map, str(key))
                    if v is None:
                        continue
                    vv = _safe_float(v, np.nan)
                    if np.isfinite(vv):
                        infl_vals.append(float(vv))
            global_infl = [_safe_float(v, np.nan) for v in infl_map.values()] if isinstance(infl_map, dict) else []
            global_infl = [float(x) for x in global_infl if np.isfinite(x)]
            infl_avg = float(np.mean(infl_vals)) if infl_vals else (float(np.mean(global_infl)) if global_infl else 2.5)
            inflation_hot = float(np.clip((infl_avg - 2.2) / 5.0, 0.0, 1.0))

            region_rates: list[float] = []
            for country in meta.get("countries", []):
                row = _case_lookup(policy_map, str(country)) if isinstance(policy_map, dict) else None
                if not isinstance(row, dict):
                    continue
                rr = _safe_float(row.get("rate"), np.nan)
                if np.isfinite(rr):
                    region_rates.append(float(rr))
            avg_rate = float(np.mean(region_rates)) if region_rates else global_rate
            rate_tightening = float(np.clip((avg_rate - 2.0) / 5.5, 0.0, 1.0))

            shipping_headwind = 0.0
            exposure = meta.get("shippingExposure", [])
            if isinstance(exposure, list) and exposure:
                vals = [shipping_zone_scores.get(str(zid), 0.0) for zid in exposure]
                shipping_headwind = float(np.clip(max(vals) if vals else 0.0, 0.0, 1.0))

            centroid_lat = _safe_float(meta.get("lat"), 0.0)
            centroid_lng = _safe_float(meta.get("lng"), 0.0)
            near_shipping = 0
            for row in shipping_rows:
                if not isinstance(row, dict):
                    continue
                lat = _safe_float(row.get("lat"), np.nan)
                lng = _safe_float(row.get("lng"), np.nan)
                if not np.isfinite(lat) or not np.isfinite(lng):
                    continue
                if _geo_distance_km(centroid_lat, centroid_lng, lat, lng) <= 1800.0:
                    near_shipping += 1
            shipping_headwind = float(np.clip(shipping_headwind + min(0.14, near_shipping * 0.018), 0.0, 1.0))

            commodity_headwind = 0.0
            commodity_proxy = meta.get("commodityProxy", [])
            if isinstance(commodity_proxy, list):
                cvals = [_safe_float(_case_lookup(commodity_map, str(k)), 0.0) for k in commodity_proxy]
                commodity_headwind = float(np.clip(max(cvals) if cvals else 0.0, 0.0, 1.0))

            central_bank_liquidity = float(
                np.clip(
                    (fed_liquidity_norm * 0.74)
                    + ((1.0 - rate_tightening) * 0.22)
                    + ((real_cb_liq - 0.5) * 0.30)
                    - (inflation_hot * 0.18)
                    + (0.04 if rid in {"USA", "EUROPE", "JAPAN"} else 0.0),
                    0.0,
                    1.0,
                )
            )

            risk_on_bias = float(np.clip((50.0 - risk_score) / 42.0, -1.0, 1.0))
            risk_on_bias += float(np.clip((50.0 - vol_score) / 55.0, -1.0, 1.0)) * 0.4
            if "risk-on" in risk_mode:
                risk_on_bias += 0.16
            elif "risk-off" in risk_mode:
                risk_on_bias -= 0.2
            risk_on_bias = float(np.clip(risk_on_bias, -1.0, 1.0))

            capital_flows = float(
                np.clip(
                    0.34
                    + (real_cap_flows * 0.30)
                    + (risk_on_bias * 0.22)
                    - (usd_funding_stress * 0.24)
                    - (shipping_headwind * 0.12)
                    - (commodity_headwind * 0.10)
                    - (inflation_hot * 0.08)
                    + (0.04 if rid in {"USA", "EUROPE", "JAPAN"} else 0.0),
                    0.0,
                    1.0,
                )
            )

            liquidity_index = (
                (central_bank_liquidity * 0.42)
                + ((1.0 - usd_funding_stress) * 0.33)
                + (capital_flows * 0.25)
            )
            score = float(np.clip((liquidity_index - 0.5) * 2.0, -1.0, 1.0))
            signal = "high_liquidity" if score > 0.15 else ("tightening" if score < -0.15 else "neutral")
            severity = "high" if abs(score) >= 0.64 else ("medium" if abs(score) >= 0.34 else "low")

            regions.append(
                {
                    "id": rid,
                    "name": name,
                    "lat": _safe_float(meta.get("lat"), 0.0),
                    "lng": _safe_float(meta.get("lng"), 0.0),
                    "score": round(score, 4),
                    "signal": signal,
                    "severity": severity,
                    "countries": [str(x) for x in meta.get("countries", []) if str(x).strip()],
                    "components": {
                        "centralBankLiquidity": round(central_bank_liquidity, 4),
                        "usdFundingStress": round(usd_funding_stress, 4),
                        "capitalFlows": round(capital_flows, 4),
                    },
                }
            )
            indicators["centralBankLiquidity"][name] = round(central_bank_liquidity, 4)
            indicators["usdFundingStress"][name] = round(usd_funding_stress, 4)
            indicators["globalCapitalFlows"][name] = round(capital_flows, 4)

        return {
            "updatedAt": _now_iso(),
            "indicators": indicators,
            "sourceInputs": real_liquidity,
            "regions": regions,
        }

    return _cached("overlay_global_liquidity_map_v1", 60 * 60, _factory)


def get_global_risk_layer_payload() -> dict[str, Any]:
    def _factory() -> dict[str, Any]:
        macro_risk = get_macro_risk_payload()
        macro_vol = get_macro_volatility_payload()
        macro_usd = get_macro_usd_strength_payload()
        macro_infl = get_macro_inflation_payload()
        macro_commodity = get_macro_commodity_shock_payload()
        shipping = get_shipping_disruptions_payload()
        conflict_rows = load_conflicts()[:240]
        news_geo_rows = _mock_news_geo_items()[:120]

        risk_score = _safe_float(macro_risk.get("riskScore"), 50.0) if isinstance(macro_risk, dict) else 50.0
        risk_mode = str(macro_risk.get("riskMode") or "").lower() if isinstance(macro_risk, dict) else ""
        vol_score = _safe_float(macro_vol.get("volScore"), 50.0) if isinstance(macro_vol, dict) else 50.0
        usd_score = _safe_float(macro_usd.get("usdScore"), 0.0) if isinstance(macro_usd, dict) else 0.0
        usd_regions = macro_usd.get("regions", {}) if isinstance(macro_usd, dict) else {}
        infl_map = macro_infl.get("countryCpiYoY", {}) if isinstance(macro_infl, dict) else {}
        commodity_map = macro_commodity.get("regionScores", {}) if isinstance(macro_commodity, dict) else {}

        shipping_rows = shipping.get("items", []) if isinstance(shipping, dict) else []
        shipping_zone_scores = _shipping_zone_scores()

        indicators = {
            "riskOnOff": {},
            "inflationHotspots": {},
            "shippingDisruptions": {},
            "commodityStress": {},
            "conflicts": {},
            "economicNews": {},
        }
        regions: list[dict[str, Any]] = []

        for rid, meta in _REGION_DEFINITIONS.items():
            name = str(meta.get("name") or rid)
            usd_proxy = str(meta.get("usdProxy") or "")
            usd_region_raw = _safe_float(_case_lookup(usd_regions, usd_proxy), usd_score)
            base_risk = float(np.clip((risk_score - 50.0) / 40.0, -1.0, 1.0))
            if "risk-off" in risk_mode:
                base_risk -= 0.24
            elif "risk-on" in risk_mode:
                base_risk += 0.14
            vol_adj = float(np.clip((55.0 - vol_score) / 55.0, -1.0, 1.0)) * 0.34
            usd_adj = -float(np.clip(usd_region_raw, -1.0, 1.0)) * 0.28
            if rid == "USA":
                usd_adj *= -0.36
            risk_on_off = float(np.clip((base_risk * 0.72) + vol_adj + usd_adj, -1.0, 1.0))

            infl_proxy = meta.get("inflationProxy", [])
            infl_vals = []
            if isinstance(infl_proxy, list):
                for key in infl_proxy:
                    v = _case_lookup(infl_map, str(key))
                    if v is None:
                        continue
                    infl_vals.append(_safe_float(v, np.nan))
            infl_vals = [x for x in infl_vals if np.isfinite(x)]
            global_infl = [_safe_float(v, np.nan) for v in infl_map.values()] if isinstance(infl_map, dict) else []
            global_infl = [x for x in global_infl if np.isfinite(x)]
            infl_avg = float(np.mean(infl_vals)) if infl_vals else (float(np.mean(global_infl)) if global_infl else 2.5)
            inflation_hot = float(np.clip((infl_avg - 2.2) / 4.8, 0.0, 1.0))

            shipping_hot = 0.0
            exposure = meta.get("shippingExposure", [])
            if isinstance(exposure, list) and exposure:
                vals = [shipping_zone_scores.get(str(zid), 0.0) for zid in exposure]
                shipping_hot = float(np.clip(max(vals) if vals else 0.0, 0.0, 1.0))

            # Add a small impulse from actual shipping disruption markers near the region centroid.
            centroid_lat = _safe_float(meta.get("lat"), 0.0)
            centroid_lng = _safe_float(meta.get("lng"), 0.0)
            near_shipping = 0
            for row in shipping_rows:
                if not isinstance(row, dict):
                    continue
                lat = _safe_float(row.get("lat"), np.nan)
                lng = _safe_float(row.get("lng"), np.nan)
                if not np.isfinite(lat) or not np.isfinite(lng):
                    continue
                if _geo_distance_km(centroid_lat, centroid_lng, lat, lng) <= 1900.0:
                    near_shipping += 1
            shipping_hot = float(np.clip(shipping_hot + min(0.16, near_shipping * 0.02), 0.0, 1.0))

            commodity_hot = 0.0
            commodity_proxy = meta.get("commodityProxy", [])
            if isinstance(commodity_proxy, list):
                cvals = [_safe_float(_case_lookup(commodity_map, str(k)), 0.0) for k in commodity_proxy]
                commodity_hot = float(np.clip(max(cvals) if cvals else 0.0, 0.0, 1.0))
            if rid in {"MIDDLE_EAST", "CHILE_PERU", "UKRAINE", "WEST_AFRICA", "RUSSIA"}:
                commodity_hot = float(np.clip(commodity_hot + 0.1, 0.0, 1.0))

            region_countries = {
                str(x).strip().lower()
                for x in meta.get("countries", [])
                if str(x).strip()
            }
            conflict_near = 0
            for row in conflict_rows:
                if not isinstance(row, dict):
                    continue
                lat = _safe_float(row.get("lat"), np.nan)
                lng = _safe_float(row.get("lng"), np.nan)
                if not np.isfinite(lat) or not np.isfinite(lng):
                    continue
                row_country = str(row.get("country") or "").strip().lower()
                if row_country and row_country in region_countries:
                    conflict_near += 2
                    continue
                if _geo_distance_km(centroid_lat, centroid_lng, lat, lng) <= 2200.0:
                    conflict_near += 1
            conflict_hot = float(np.clip(min(1.0, conflict_near * 0.08), 0.0, 1.0))

            news_near = 0
            for row in news_geo_rows:
                if not isinstance(row, dict):
                    continue
                lat = _safe_float(row.get("lat"), np.nan)
                lng = _safe_float(row.get("lng"), np.nan)
                if not np.isfinite(lat) or not np.isfinite(lng):
                    continue
                row_country = str(row.get("country") or "").strip().lower()
                if row_country and row_country in region_countries:
                    news_near += 2
                    continue
                if _geo_distance_km(centroid_lat, centroid_lng, lat, lng) <= 2200.0:
                    news_near += 1
            economic_news_hot = float(np.clip(min(1.0, news_near * 0.06), 0.0, 1.0))

            score = float(
                np.clip(
                    risk_on_off
                    - (inflation_hot * 0.38)
                    - (shipping_hot * 0.24)
                    - (commodity_hot * 0.28)
                    - (conflict_hot * 0.34)
                    - (economic_news_hot * 0.16),
                    -1.0,
                    1.0,
                )
            )
            signal = "risk_on" if score > 0.15 else ("risk_off" if score < -0.15 else "neutral")
            severity = "high" if abs(score) >= 0.64 else ("medium" if abs(score) >= 0.34 else "low")
            regions.append(
                {
                    "id": rid,
                    "name": name,
                    "lat": _safe_float(meta.get("lat"), 0.0),
                    "lng": _safe_float(meta.get("lng"), 0.0),
                    "score": round(score, 4),
                    "signal": signal,
                    "severity": severity,
                    "countries": [str(x) for x in meta.get("countries", []) if str(x).strip()],
                    "components": {
                        "riskOnOff": round(risk_on_off, 4),
                        "inflation": round(inflation_hot, 4),
                        "shipping": round(shipping_hot, 4),
                        "commodity": round(commodity_hot, 4),
                        "conflicts": round(conflict_hot, 4),
                        "economicNews": round(economic_news_hot, 4),
                    },
                }
            )
            indicators["riskOnOff"][name] = round(risk_on_off, 4)
            indicators["inflationHotspots"][name] = round(inflation_hot, 4)
            indicators["shippingDisruptions"][name] = round(shipping_hot, 4)
            indicators["commodityStress"][name] = round(commodity_hot, 4)
            indicators["conflicts"][name] = round(conflict_hot, 4)
            indicators["economicNews"][name] = round(economic_news_hot, 4)

        return {
            "updatedAt": _now_iso(),
            "indicators": indicators,
            "regions": regions,
        }

    return _cached("overlay_global_risk_layer_v2", 3 * 60 * 60, _factory)


def get_asset_region_highlight_payload(asset_id: str) -> dict[str, Any]:
    aid = str(asset_id or "").strip().lower()
    if not aid:
        raise KeyError("asset not found")
    # ensure consistent 404 behavior for invalid IDs
    _ = _asset_row(aid)
    key = f"overlay_asset_region_highlight_v1:{aid}"

    def _factory() -> dict[str, Any]:
        region_ids = _asset_region_ids(aid)
        if not region_ids:
            region_ids = ["EUROPE"]
        bias, score = _seasonality_bias_score(aid)
        regions: list[dict[str, Any]] = []
        for rid in region_ids:
            meta = _REGION_DEFINITIONS.get(rid)
            if not isinstance(meta, dict):
                continue
            regions.append(
                {
                    "id": rid,
                    "name": str(meta.get("name") or rid),
                    "lat": _safe_float(meta.get("lat"), 0.0),
                    "lng": _safe_float(meta.get("lng"), 0.0),
                    "countries": [str(x) for x in meta.get("countries", []) if str(x).strip()],
                }
            )
        if not regions:
            fallback = _REGION_DEFINITIONS["EUROPE"]
            regions = [
                {
                    "id": "EUROPE",
                    "name": str(fallback.get("name") or "Europe"),
                    "lat": _safe_float(fallback.get("lat"), 50.0),
                    "lng": _safe_float(fallback.get("lng"), 10.0),
                    "countries": [str(x) for x in fallback.get("countries", []) if str(x).strip()],
                }
            ]
        return {
            "updatedAt": _now_iso(),
            "assetId": aid,
            "bias": bias,
            "score": round(score, 4),
            "regions": regions,
            "assetRegionMap": _ASSET_REGION_MAP,
        }

    return _cached(key, 2 * 60 * 60, _factory)


def _news_geo_hit_location(text: str) -> dict[str, Any] | None:
    t = str(text or "").lower()
    if not t:
        return None
    for key, value in _NEWS_GEO_LOOKUP.items():
        if key in t:
            return value
    return None


def _news_geo_impact_score(text: str) -> float:
    t = str(text or "").lower()
    if not t:
        return 0.0
    score = 0.0
    for k in _NEWS_BEAR_KEYWORDS:
        if k in t:
            score += 1.3
    for k in _NEWS_BULL_KEYWORDS:
        if k in t:
            score += 0.8
    if "high impact" in t or "emergency" in t:
        score += 1.1
    return score


def _to_news_geo_items(rows: list[dict[str, Any]], max_items: int = 120) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for idx, row in enumerate(rows):
        if not isinstance(row, dict):
            continue
        title = str(row.get("title") or "").strip()
        if not title:
            continue
        loc = _news_geo_hit_location(f"{title} {str(row.get('description') or '')}")
        if not loc:
            continue
        impact = _news_geo_impact_score(title)
        if impact < 0.9:
            continue
        s = str(row.get("sentiment") or "Neutral")
        s_low = s.lower()
        if "bear" in s_low:
            color = "#ff384c"
        elif "bull" in s_low:
            color = "#39ff40"
        elif "neutral" in s_low:
            color = "#2962ff"
        else:
            color = "#94a3b8"
        key = f"{loc.get('location')}|{_normalize_headline_key(title)}"
        if key in seen:
            continue
        seen.add(key)
        sev = "high" if impact >= 2.0 else "medium"
        out.append(
            {
                "id": f"news_geo:{idx}:{abs(hash(key)) % 1000000}",
                "type": "news_geo",
                "date": str(row.get("publishedAt") or _now_iso()),
                "timestamp": str(row.get("publishedAt") or _now_iso()),
                "title": title,
                "location": str(loc.get("location") or "Macro Hotspot"),
                "country": str(loc.get("country") or ""),
                "severity": sev,
                "lat": float(loc.get("lat") or 0.0),
                "lng": float(loc.get("lng") or 0.0),
                "color": color,
                "headline": title,
                "source": str(row.get("source") or "News Intelligence"),
                "url": str(row.get("url") or ""),
                "sentiment": s,
                "confidence": int(row.get("confidence") or 0),
                "related_assets": [str(x).strip() for x in row.get("relatedAssets", []) if str(x).strip()] if isinstance(row.get("relatedAssets"), list) else _related_assets_for_text(title),
                "label": f"Geo-News - {str(loc.get('location') or 'Hotspot')}",
            }
        )
        if len(out) >= int(max(1, max_items)):
            break
    return out


async def get_news_geo_events_payload() -> dict[str, Any]:
    async def _factory() -> dict[str, Any]:
        try:
            rows = await _NEWS_PROVIDER.get_global_news(max_items=40, days=5)
        except Exception:
            rows = []
        decorated = _decorate_news_rows(rows[:80], max_items=40)
        items = _to_news_geo_items(decorated, max_items=120)
        return {"updatedAt": _now_iso(), "layer": "news_geo", "items": items}

    return await _cached_async("events_news_geo_v1", NEWS_CACHE_SECONDS, _factory)


def _mock_news_geo_items() -> list[dict[str, Any]]:
    try:
        rows = _read_json("news_global.json")
    except Exception:
        rows = []
    if not isinstance(rows, list):
        rows = []
    decorated = _decorate_news_rows(rows[:80], max_items=30)
    return _to_news_geo_items(decorated, max_items=80)


def load_earthquakes() -> list[dict[str, Any]]:
    rows = _fetch_usgs_earthquakes(days=1, min_magnitude=0.0)
    return rows[:240]


def load_wildfires() -> list[dict[str, Any]]:
    rows = _fetch_wildfires_last_48h()
    return rows[:260]


def load_conflicts() -> list[dict[str, Any]]:
    rows = _fetch_acled_conflicts(days=7)
    if not rows:
        rows = _fetch_gdelt_conflicts(days=7)
    return rows[:220]


def load_ship_tracking() -> list[dict[str, Any]]:
    return _ship_tracking_items()


def load_liquidity_map() -> dict[str, Any]:
    return get_global_liquidity_map_payload()


_COMMODITY_INFRASTRUCTURE_ROWS: list[dict[str, Any]] = [
    {"id": "infra:permian", "title": "Permian Basin Hub", "country": "United States", "location": "Permian Basin", "type": "energy", "event_type": "energy_hub", "lat": 31.7, "lng": -102.2, "severity": "medium", "source": "Static Infrastructure", "related_assets": ["wti_spot", "natgas"]},
    {"id": "infra:henry_hub", "title": "Henry Hub", "country": "United States", "location": "Louisiana", "type": "energy", "event_type": "energy_hub", "lat": 31.8, "lng": -93.3, "severity": "medium", "source": "Static Infrastructure", "related_assets": ["natgas", "wti_spot"]},
    {"id": "infra:sabine_pass", "title": "Sabine Pass LNG", "country": "United States", "location": "Sabine Pass", "type": "infrastructure", "event_type": "lng_terminal", "lat": 29.73, "lng": -93.87, "severity": "high", "source": "Static Infrastructure", "related_assets": ["natgas", "eur", "jpy"]},
    {"id": "infra:freeport_lng", "title": "Freeport LNG", "country": "United States", "location": "Freeport", "type": "infrastructure", "event_type": "lng_terminal", "lat": 28.95, "lng": -95.35, "severity": "high", "source": "Static Infrastructure", "related_assets": ["natgas", "gbp", "eur"]},
    {"id": "infra:ras_laffan", "title": "Ras Laffan LNG Hub", "country": "Qatar", "location": "Ras Laffan", "type": "infrastructure", "event_type": "lng_terminal", "lat": 25.92, "lng": 51.62, "severity": "high", "source": "Static Infrastructure", "related_assets": ["natgas", "wti_spot", "eur"]},
    {"id": "infra:rotterdam", "title": "Rotterdam Energy Hub", "country": "Netherlands", "location": "Rotterdam", "type": "energy", "event_type": "energy_hub", "lat": 51.95, "lng": 4.14, "severity": "medium", "source": "Static Infrastructure", "related_assets": ["wti_spot", "natgas", "dax40"]},
    {"id": "infra:cushing", "title": "Cushing Storage Hub", "country": "United States", "location": "Cushing", "type": "energy", "event_type": "energy_hub", "lat": 35.98, "lng": -96.76, "severity": "medium", "source": "Static Infrastructure", "related_assets": ["wti_spot"]},
    {"id": "infra:escondida", "title": "Escondida Mine", "country": "Chile", "location": "Atacama", "type": "infrastructure", "event_type": "mine", "lat": -24.27, "lng": -69.08, "severity": "medium", "source": "Static Infrastructure", "related_assets": ["copper", "aud"]},
    {"id": "infra:pilbara", "title": "Pilbara Iron Ore Hub", "country": "Australia", "location": "Pilbara", "type": "infrastructure", "event_type": "mine", "lat": -22.5, "lng": 118.0, "severity": "medium", "source": "Static Infrastructure", "related_assets": ["aud", "sp500"]},
    {"id": "infra:druzhba", "title": "Druzhba Pipeline", "country": "Poland", "location": "Druzhba Corridor", "type": "infrastructure", "event_type": "pipeline", "lat": 52.1, "lng": 21.1, "severity": "high", "source": "Static Infrastructure", "related_assets": ["wti_spot", "eur", "dax40"]},
]


def load_commodity_infrastructure() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for row in _COMMODITY_INFRASTRUCTURE_ROWS:
        item = dict(row)
        item["date"] = _now_iso()
        item["timestamp"] = _now_iso()
        item["description"] = str(item.get("description") or f"{item.get('title')} monitored as strategic commodity infrastructure.")
        item["label"] = str(item.get("title") or item.get("location") or "Infrastructure")
        item["confidence"] = int(item.get("confidence") or (78 if str(item.get("severity") or "").lower() == "high" else 64))
        out.append(item)
    return out


def get_geo_events_payload(layer: str = "geo_events") -> dict[str, Any]:
    mode = str(layer or "geo_events").strip().lower()
    if mode not in {"geo_events", "conflicts", "wildfires", "earthquakes", "news_geo", "infrastructure", "intelligence"}:
        mode = "geo_events"

    def _factory() -> dict[str, Any]:
        mock = _mock_geo_events()
        if mode == "conflicts":
            items_raw = load_conflicts() or mock["conflicts"]
        elif mode == "wildfires":
            items_raw = load_wildfires() or mock["wildfires"]
        elif mode == "earthquakes":
            quakes = load_earthquakes()
            if not quakes:
                quakes = [
                    {
                        "id": "quake:mock:1",
                        "type": "earthquake",
                        "event_type": "earthquake",
                        "date": _now_iso(),
                        "location": "Pacific Ring of Fire",
                        "severity": "M5.1",
                        "description": "Fallback earthquake marker (USGS unavailable).",
                        "lat": 37.2,
                        "lng": 142.3,
                        "color": "#ff384c",
                    }
                ]
            items_raw = quakes
        elif mode == "news_geo":
            items_raw = _mock_news_geo_items()[:120]
        elif mode == "infrastructure":
            items_raw = load_commodity_infrastructure()[:120]
        elif mode == "intelligence":
            conflicts = load_conflicts() or mock["conflicts"]
            wildfires = load_wildfires() or mock["wildfires"]
            quakes = load_earthquakes() or []
            news_geo = _mock_news_geo_items()[:120]
            infrastructure = load_commodity_infrastructure()[:120]
            shipping = (get_shipping_disruptions_payload().get("items", []) if isinstance(get_shipping_disruptions_payload(), dict) else [])[:40]
            items_raw = [*conflicts, *wildfires, *quakes, *news_geo, *shipping, *infrastructure]
        else:
            conflicts = load_conflicts() or mock["conflicts"]
            wildfires = load_wildfires() or mock["wildfires"]
            quakes = load_earthquakes()
            if not quakes:
                quakes = []
            news_geo = _mock_news_geo_items()[:120]
            infrastructure = load_commodity_infrastructure()[:120]
            items_raw = [*conflicts, *wildfires, *quakes, *news_geo, *infrastructure]

        items = [
            _normalize_geo_event_item(row, idx)
            for idx, row in enumerate(items_raw[:350])
            if isinstance(row, dict)
        ]
        return {"updatedAt": _now_iso(), "layer": mode, "items": items}

    ttl_by_mode = {
        "conflicts": 60 * 60,     # 1h
        "wildfires": 30 * 60,     # 30m
        "earthquakes": 10 * 60,   # 10m
        "news_geo": 600,      # 10m
        "infrastructure": 6 * 60 * 60,
        "intelligence": 10 * 60,
        "geo_events": 600,    # 10m aggregate
    }
    ttl = int(ttl_by_mode.get(mode, 900))
    return _cached(f"geo_events_v2:{mode}", ttl, _factory)


def get_diagnostics_payload() -> dict[str, Any]:
    def _factory() -> dict[str, Any]:
        required_fields = {"id", "name", "category", "iconKey", "locations"}
        raw_assets = _read_asset_config()
        missing_fields: list[dict[str, Any]] = []
        duplicate_coords: list[dict[str, Any]] = []
        coord_seen: dict[tuple[float, float], str] = {}
        missing_locations = 0

        for row in raw_assets:
            if not isinstance(row, dict):
                continue
            aid = str(row.get("id") or "").strip()
            missing = sorted([f for f in required_fields if f not in row])
            if missing:
                missing_fields.append({"assetId": aid or "unknown", "missing": missing})
            locs = row.get("locations")
            if not isinstance(locs, list) or not locs:
                missing_locations += 1
                continue
            for loc in locs:
                if not isinstance(loc, dict):
                    continue
                lat = float(loc.get("lat") or np.nan)
                lng = float(loc.get("lng") or np.nan)
                if not np.isfinite(lat) or not np.isfinite(lng):
                    continue
                key = (round(lat, 4), round(lng, 4))
                prev = coord_seen.get(key)
                if prev and prev != aid:
                    duplicate_coords.append({"coord": {"lat": key[0], "lng": key[1]}, "assets": [prev, aid]})
                else:
                    coord_seen[key] = aid

        # Seasonality sanity checks
        seasonality_empty: list[str] = []
        seasonality_bad_horizon: list[str] = []
        seasonality_pending: list[str] = []
        for row in _heatmap_assets_universe()[:12]:
            aid = str(row.get("id") or "")
            cached = _CACHE.get(f"seasonality:v2:{aid.lower()}:dukascopy")
            if cached is None:
                seasonality_pending.append(aid)
                continue
            try:
                seas = cached if isinstance(cached, dict) else get_seasonality_payload(aid)
            except Exception:
                seasonality_empty.append(aid)
                continue
            curve = seas.get("curve") if isinstance(seas, dict) else None
            horizon = int((seas.get("projectionDays") or 0) if isinstance(seas, dict) else 0)
            if not isinstance(curve, list) or not curve:
                seasonality_empty.append(aid)
                continue
            if horizon > 0 and len(curve) < min(4, horizon):
                seasonality_bad_horizon.append(aid)

        # Timeframe correlation freshness / shape (cache-only, no heavy recompute).
        tf_rows: list[dict[str, Any]] = []
        default_source = "dukascopy"
        for tf in ["1MIN", "5MIN", "30MIN", "1H", "4H", "D", "W", "M"]:
            cache_key = f"heatmap_tab_correlation_v9:{default_source}:{tf}"
            corr = _CACHE.get(cache_key)
            matrix = corr.get("matrix") if isinstance(corr, dict) else []
            size = len(matrix) if isinstance(matrix, list) else 0
            tf_rows.append(
                {
                    "timeframe": tf,
                    "updatedAt": str(corr.get("updatedAt") or "") if isinstance(corr, dict) else "",
                    "windowBars": int(corr.get("windowBars") or 0) if isinstance(corr, dict) else 0,
                    "rollingWindow": int(corr.get("rollingWindow") or 0) if isinstance(corr, dict) else 0,
                    "matrixSize": size,
                    "status": "ok" if isinstance(corr, dict) else "not_warmed",
                    "source": "cache" if isinstance(corr, dict) else "none",
                }
            )

        def _cached_updated_at(key: str) -> str:
            row = _CACHE.get(key)
            if isinstance(row, dict):
                return str(row.get("updatedAt") or "")
            return ""

        return {
            "updatedAt": _now_iso(),
            "assetMap": {
                "totalAssets": len(raw_assets),
                "missingFieldCount": len(missing_fields),
                "missingFields": missing_fields[:40],
                "missingLocations": int(missing_locations),
                "duplicateCoordinateCount": len(duplicate_coords),
                "duplicateCoordinates": duplicate_coords[:40],
            },
            "seasonality": {
                "checkedAssets": 12,
                "emptySeriesCount": len(seasonality_empty),
                "badHorizonCount": len(seasonality_bad_horizon),
                "pendingCount": len(seasonality_pending),
                "emptyAssets": seasonality_empty[:40],
                "badHorizonAssets": seasonality_bad_horizon[:40],
                "pendingAssets": seasonality_pending[:40],
            },
            "timeframes": tf_rows,
            "freshness": {
                "assetsUpdatedAt": _cached_updated_at("assets_payload"),
                "newsGlobalUpdatedAt": _cached_updated_at("news_global"),
                "fundamentalUpdatedAt": _cached_updated_at("macro_fundamental_panel"),
                "heatmapDailyUpdatedAt": _cached_updated_at("heatmap_tab_correlation_v9:dukascopy:D"),
            },
        }

    return _cached("diagnostics_v1", 300, _factory)
