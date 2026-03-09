from __future__ import annotations

from functools import lru_cache
import threading
import time
from typing import Any, Literal

import numpy as np
import pandas as pd

from data_engine.tradingview_client import tv_get_hist
from backend.services.ibkr_downloader import load_ibkr_market_data
from screener.data_loader import load_daily, load_yahoo

try:
    from screener import data_loader as _dl  # type: ignore
except Exception:  # pragma: no cover
    _dl = None  # type: ignore

try:
    import yfinance as yf  # type: ignore
except Exception:  # pragma: no cover
    yf = None  # type: ignore


DataSource = Literal["tradingview", "dukascopy", "yahoo", "ibkr"]
_VALID_SOURCES: set[str] = {"tradingview", "dukascopy", "yahoo", "ibkr"}

_SYMBOL_ALIAS = {
    "DX-Y.NYB": "DXY",
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

_VALID_TFS = {"D", "W", "M", "1MIN", "5MIN", "30MIN", "1H", "4H"}

_TV_SYMBOL_MAP: dict[str, tuple[str, str]] = {
    "DX-Y.NYB": ("TVC", "DXY"),
    "DXY": ("TVC", "DXY"),
    "^TNX": ("TVC", "US10Y"),
    "^VIX": ("TVC", "VIX"),
    "^VIX3M": ("TVC", "VIX3M"),
    "EURUSD": ("OANDA", "EURUSD"),
    "GBPUSD": ("OANDA", "GBPUSD"),
    "USDJPY": ("OANDA", "USDJPY"),
    "USDCHF": ("OANDA", "USDCHF"),
    "AUDUSD": ("OANDA", "AUDUSD"),
    "USDCAD": ("OANDA", "USDCAD"),
    "NZDUSD": ("OANDA", "NZDUSD"),
    "XAUUSD": ("OANDA", "XAUUSD"),
    "XAGUSD": ("OANDA", "XAGUSD"),
    "COPPER": ("COMEX", "HG1!"),
    "GC1!": ("COMEX", "GC1!"),
    "SI1!": ("COMEX", "SI1!"),
    "HG1!": ("COMEX", "HG1!"),
    "PL1!": ("NYMEX", "PL1!"),
    "PA1!": ("NYMEX", "PA1!"),
    "ALI1!": ("LME", "ALI1!"),
    "ES1!": ("CME_MINI", "ES1!"),
    "NQ1!": ("CME_MINI", "NQ1!"),
    "YM1!": ("CME_MINI", "YM1!"),
    "RTY1!": ("CME_MINI", "RTY1!"),
    "FDAX1!": ("EUREX", "FDAX1!"),
    "BTCUSD": ("BITSTAMP", "BTCUSD"),
    "USOIL": ("TVC", "USOIL"),
    "NG1!": ("NYMEX", "NG1!"),
    "RB1!": ("NYMEX", "RB1!"),
    "ZW1!": ("CBOT", "ZW1!"),
    "ZC1!": ("CBOT", "ZC1!"),
    "ZS1!": ("CBOT", "ZS1!"),
    "ZL1!": ("CBOT", "ZL1!"),
    "KC1!": ("ICEUS", "KC1!"),
    "SB1!": ("ICEUS", "SB1!"),
    "CC1!": ("ICEUS", "CC1!"),
    "CT1!": ("ICEUS", "CT1!"),
    "OJ1!": ("ICEUS", "OJ1!"),
    "LE1!": ("CME", "LE1!"),
    "HE1!": ("CME", "HE1!"),
}


class _TTLCache:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._store: dict[str, tuple[float, pd.DataFrame]] = {}

    def get(self, key: str) -> pd.DataFrame | None:
        now = time.time()
        with self._lock:
            row = self._store.get(key)
            if row is None:
                return None
            exp, value = row
            if exp < now:
                self._store.pop(key, None)
                return None
            return value.copy()

    def set(self, key: str, ttl_sec: int, value: pd.DataFrame) -> None:
        with self._lock:
            self._store[key] = (time.time() + int(max(1, ttl_sec)), value.copy())


_CACHE = _TTLCache()


def normalize_data_source(source: str | None) -> DataSource:
    s = str(source or "dukascopy").strip().lower()
    if s in _VALID_SOURCES:
        return s  # type: ignore[return-value]
    return "dukascopy"


def normalize_timeframe(value: str | None) -> str:
    tf = str(value or "D").strip().upper()
    if tf in _VALID_TFS:
        return tf
    if tf in {"1M", "1MINUTE", "M1"}:
        return "1MIN"
    if tf in {"5M", "5MINUTE", "M5"}:
        return "5MIN"
    if tf in {"30M", "30MINUTE", "M30"}:
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


def _resolve_symbol(symbol: str) -> str:
    s = str(symbol or "").strip().upper()
    return _SYMBOL_ALIAS.get(s, s)


def _to_yahoo_intraday_symbol(symbol: str) -> str:
    s = _resolve_symbol(symbol)
    mapped = _INTRADAY_YAHOO_ALIAS.get(s)
    if mapped:
        return mapped
    if len(s) == 6 and s.isalpha():
        return f"{s}=X"
    return s


def _normalize_ohlc(df: pd.DataFrame) -> pd.DataFrame:
    if df is None or df.empty:
        return pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume"])

    x = df.copy()
    if isinstance(x.columns, pd.MultiIndex):
        x.columns = [str(c[0]).strip() if isinstance(c, tuple) else str(c).strip() for c in x.columns]
    else:
        x.columns = [str(c).strip() for c in x.columns]

    cols = {str(c).lower(): c for c in x.columns}
    idx = pd.to_datetime(x.index, errors="coerce", utc=True)
    x.index = idx
    x = x[~x.index.isna()]
    if x.empty:
        return pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume"])

    def _series(name: str) -> pd.Series:
        col = cols.get(name)
        if col is None:
            return pd.Series(np.nan, index=x.index)
        return pd.to_numeric(x[col], errors="coerce")

    o = _series("open")
    h = _series("high")
    l = _series("low")
    c = _series("close")

    out = pd.DataFrame(index=x.index)
    out["Open"] = o
    out["Close"] = c
    out["High"] = np.maximum.reduce([h.to_numpy(dtype=float), o.to_numpy(dtype=float), c.to_numpy(dtype=float)])
    out["Low"] = np.minimum.reduce([l.to_numpy(dtype=float), o.to_numpy(dtype=float), c.to_numpy(dtype=float)])
    out["Volume"] = _series("volume")

    out = out.replace([np.inf, -np.inf], np.nan)
    out = out.dropna(subset=["Open", "High", "Low", "Close"])
    if out.empty:
        return pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume"])

    out.index = out.index.tz_convert("UTC").tz_localize(None)
    out = out[~out.index.duplicated(keep="last")].sort_index()
    return out


def _resample_ohlc(df: pd.DataFrame, rule: str) -> pd.DataFrame:
    if df is None or df.empty:
        return pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume"])
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
    return _normalize_ohlc(out)


def _intraday_target_bars(tf: str) -> int:
    return {
        "1MIN": 2400,
        "5MIN": 3600,
        "30MIN": 2600,
        "1H": 2200,
        "4H": 1800,
    }.get(tf, 1200)


def _intraday_yahoo_params(tf: str) -> tuple[str, int]:
    if tf == "1MIN":
        return ("1m", 7)
    if tf == "5MIN":
        return ("5m", 60)
    if tf == "30MIN":
        return ("30m", 60)
    return ("60m", 730)


def _tv_resolve(symbol: str) -> tuple[str, str]:
    s = _resolve_symbol(symbol).upper()
    mapped = _TV_SYMBOL_MAP.get(s)
    if mapped:
        return mapped
    if len(s) == 6 and s.isalpha():
        return ("OANDA", s)
    return ("TVC", s)


def _tv_interval(tf: str) -> str:
    return {
        "1MIN": "1m",
        "5MIN": "5m",
        "30MIN": "30m",
        "1H": "1h",
        "4H": "4h",
        "D": "D",
        "W": "W",
        "M": "M",
    }.get(tf, "D")


def _fallback_source_for_symbol(symbol: str) -> DataSource:
    s = _resolve_symbol(symbol).upper()
    if len(s) == 6 and s.isalpha():
        return "dukascopy"
    if s in {"DXY", "DX-Y.NYB"}:
        return "yahoo"
    if s.startswith("6") and s.endswith("1!"):
        return "dukascopy"
    return "yahoo"


def _load_daily_tradingview(symbol: str, years: int) -> pd.DataFrame:
    ex, sym = _tv_resolve(symbol)
    bars = int(max(500, years * 380))
    raw = tv_get_hist(symbol=sym, exchange=ex, interval="D", n_bars=bars)
    out = _normalize_ohlc(raw)
    return out.tail(int(max(260, years * 280)))


def _load_intraday_tradingview(symbol: str, tf: str) -> pd.DataFrame:
    ex, sym = _tv_resolve(symbol)
    interval = _tv_interval(tf)
    bars = int(max(_intraday_target_bars(tf), 3000))
    raw = tv_get_hist(symbol=sym, exchange=ex, interval=interval, n_bars=bars)
    base = _normalize_ohlc(raw)
    if base.empty:
        return base
    if tf == "1MIN":
        return base.tail(_intraday_target_bars(tf))
    if tf == "5MIN":
        return _resample_ohlc(base, "5min").tail(_intraday_target_bars(tf))
    if tf == "30MIN":
        return _resample_ohlc(base, "30min").tail(_intraday_target_bars(tf))
    if tf == "1H":
        return _resample_ohlc(base, "1h").tail(_intraday_target_bars(tf))
    if tf == "4H":
        return _resample_ohlc(base, "4h").tail(_intraday_target_bars(tf))
    return base.tail(_intraday_target_bars(tf))


def _load_daily_dukascopy(symbol: str, years: int) -> pd.DataFrame:
    try:
        df = load_daily(_resolve_symbol(symbol), int(max(2, years)), include_open_today=True)
    except Exception:
        return pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume"])
    return _normalize_ohlc(df)


def _load_daily_yahoo(symbol: str, years: int) -> pd.DataFrame:
    try:
        df = load_yahoo(_resolve_symbol(symbol), int(max(2, years)), include_open_today=True)
    except Exception:
        df = pd.DataFrame()
    out = _normalize_ohlc(df)
    if not out.empty:
        return out
    # fallback keeps behavior resilient if yahoo mapping misses.
    return _load_daily_dukascopy(symbol, years)


def _load_intraday_local(symbol: str, tf: str) -> pd.DataFrame:
    if _dl is None or not hasattr(_dl, "_load_local_any") or not hasattr(_dl, "_normalize_intraday_ohlc"):
        return pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume"])

    cands = [
        str(symbol or "").strip(),
        _resolve_symbol(symbol),
        _to_yahoo_intraday_symbol(symbol),
    ]
    seen: set[str] = set()
    for cand in cands:
        c = str(cand or "").strip()
        if not c or c in seen:
            continue
        seen.add(c)
        try:
            raw_local = _dl._load_local_any(c)  # type: ignore[attr-defined]
        except Exception:
            raw_local = pd.DataFrame()
        if raw_local is None or raw_local.empty:
            continue

        try:
            local_norm = _dl._normalize_intraday_ohlc(raw_local)  # type: ignore[attr-defined]
        except Exception:
            local_norm = pd.DataFrame()
        if local_norm is None or local_norm.empty:
            continue

        local = pd.DataFrame(index=pd.to_datetime(local_norm.index, errors="coerce", utc=True))
        local = local[~local.index.isna()]
        local["Open"] = pd.to_numeric(local_norm.get("open"), errors="coerce")
        local["High"] = pd.to_numeric(local_norm.get("high"), errors="coerce")
        local["Low"] = pd.to_numeric(local_norm.get("low"), errors="coerce")
        local["Close"] = pd.to_numeric(local_norm.get("close"), errors="coerce")
        local["Volume"] = pd.to_numeric(local_norm.get("volume"), errors="coerce")
        local = local.dropna(subset=["Open", "High", "Low", "Close"])
        if local.empty:
            continue
        local = _normalize_ohlc(local)
        if local.empty:
            continue
        if tf == "1MIN":
            return local.tail(_intraday_target_bars(tf))
        rule = {"5MIN": "5min", "30MIN": "30min", "1H": "1h", "4H": "4h"}.get(tf)
        if rule:
            rs = _resample_ohlc(local, rule)
            if not rs.empty:
                return rs.tail(_intraday_target_bars(tf))
        return local.tail(_intraday_target_bars(tf))

    return pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume"])


def _load_intraday_yahoo(symbol: str, tf: str) -> pd.DataFrame:
    if yf is None:
        return pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume"])

    interval, lookback_days = _intraday_yahoo_params(tf)
    ysym = _to_yahoo_intraday_symbol(symbol)
    base = pd.DataFrame()

    if _dl is not None and hasattr(_dl, "_load_yahoo_intraday"):
        try:
            raw = _dl._load_yahoo_intraday(ysym, interval=interval, lookback_days=lookback_days)  # type: ignore[attr-defined]
        except Exception:
            raw = pd.DataFrame()
        base = _normalize_ohlc(raw)

    if base.empty:
        try:
            raw_dl = yf.download(
                ysym,
                period=f"{int(max(2, lookback_days))}d",
                interval=interval,
                auto_adjust=False,
                progress=False,
                threads=False,
            )
        except Exception:
            raw_dl = pd.DataFrame()
        base = _normalize_ohlc(raw_dl)

    if base.empty:
        return pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume"])

    if tf == "1MIN":
        return base.tail(_intraday_target_bars(tf))

    rule = {"5MIN": "5min", "30MIN": "30min", "1H": "1h", "4H": "4h"}.get(tf)
    if rule:
        rs = _resample_ohlc(base, rule)
        if not rs.empty:
            return rs.tail(_intraday_target_bars(tf))
    return base.tail(_intraday_target_bars(tf))


def _load_intraday(source: DataSource, symbol: str, tf: str) -> pd.DataFrame:
    if source == "ibkr":
        # Strict IBKR mode: never silently fall back to non-IB sources.
        # This guarantees that selected IBKR data matches IBKR-origin bars.
        ib = _normalize_ohlc(load_ibkr_market_data(symbol, timeframe=tf, years_daily=10, years_minute=2))
        return ib
    if source == "tradingview":
        tv = _load_intraday_tradingview(symbol, tf)
        if not tv.empty:
            return tv
        fb = _fallback_source_for_symbol(symbol)
        return _load_intraday(fb, symbol, tf)
    if source == "yahoo":
        y = _load_intraday_yahoo(symbol, tf)
        if not y.empty:
            return y
        return _load_intraday_local(symbol, tf)

    # Dukascopy default: prefer local history, then Yahoo fallback.
    local = _load_intraday_local(symbol, tf)
    if not local.empty:
        return local
    return _load_intraday_yahoo(symbol, tf)


def _load_daily(source: DataSource, symbol: str, years: int) -> pd.DataFrame:
    if source == "ibkr":
        # Strict IBKR mode: never silently fall back to non-IB sources.
        ib = _normalize_ohlc(load_ibkr_market_data(symbol, timeframe="D", years_daily=max(2, years), years_minute=2))
        return ib
    if source == "tradingview":
        tv = _load_daily_tradingview(symbol, years)
        if not tv.empty:
            return tv
        fb = _fallback_source_for_symbol(symbol)
        return _load_daily(fb, symbol, years)
    if source == "yahoo":
        return _load_daily_yahoo(symbol, years)
    return _load_daily_dukascopy(symbol, years)


def _cache_ttl(tf: str) -> int:
    _ = tf
    return 40 * 60


def get_market_data(
    asset: str,
    timeframe: str,
    *,
    source: str = "dukascopy",
    years: int = 12,
) -> pd.DataFrame:
    """Unified market-data loader returning standardized OHLC(V) DataFrame."""
    tf = normalize_timeframe(timeframe)
    src = normalize_data_source(source)
    symbol = _resolve_symbol(str(asset or ""))

    cache_key = f"md:v1:{src}:{symbol}:{tf}:{int(max(1, years))}"
    cached = _CACHE.get(cache_key)
    if cached is not None:
        return cached

    if tf in {"1MIN", "5MIN", "30MIN", "1H", "4H"}:
        out = _load_intraday(src, symbol, tf)
    else:
        daily = _load_daily(src, symbol, years)
        if tf == "W":
            out = _resample_ohlc(daily, "W-FRI")
        elif tf == "M":
            out = _resample_ohlc(daily, "ME")
        else:
            out = daily

    out = _normalize_ohlc(out)
    _CACHE.set(cache_key, _cache_ttl(tf), out)
    return out
