from __future__ import annotations

from datetime import datetime, timedelta, timezone
import os
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from backend.services.ibkr_connection import ensure_ibkr_connection

try:
    from ib_insync import ContFuture, Crypto, Forex, Index, util  # type: ignore
except Exception:  # pragma: no cover
    ContFuture = None  # type: ignore
    Crypto = None  # type: ignore
    Forex = None  # type: ignore
    Index = None  # type: ignore
    util = None  # type: ignore


_ROOT = Path(__file__).resolve().parents[2]
_IBKR_ROOT = _ROOT / "data" / "ibkr"
_IBKR_DAILY_DIR = _IBKR_ROOT / "daily"
_IBKR_MINUTE_DIR = _IBKR_ROOT / "minute"

_DEFAULT_HOST = os.getenv("IBKR_HOST", "127.0.0.1")
_DEFAULT_PORT = int(os.getenv("IBKR_PORT", "7497"))
_DEFAULT_CLIENT_ID = int(os.getenv("IBKR_CLIENT_ID", "73"))

_SYMBOL_ALIAS = {
    "DX-Y.NYB": "DXY",
    "US500": "SP500",
    "SPX": "SP500",
    "^GSPC": "SP500",
    "ES1!": "SP500",
    "NQ1!": "NASDAQ100",
    "^IXIC": "NASDAQ100",
    "YM1!": "DOWJONES",
    "^DJI": "DOWJONES",
    "RTY1!": "RUSSELL2000",
    "^RUT": "RUSSELL2000",
    "FDAX1!": "DAX40",
    "^GDAXI": "DAX40",
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
    "PL1!": "PLATINUM",
    "PA1!": "PALLADIUM",
    "USOIL": "WTI",
    "CL=F": "WTI",
    "BRENT": "BRENT",
    "BZ=F": "BRENT",
    "NG1!": "NATGAS",
    "NG=F": "NATGAS",
    "RB1!": "GASOLINE",
    "ZW1!": "WHEAT",
    "ZC1!": "CORN",
    "ZS1!": "SOYBEANS",
    "ZL1!": "SOYOIL",
    "KC1!": "COFFEE",
    "SB1!": "SUGAR",
    "CC1!": "COCOA",
    "CT1!": "COTTON",
    "OJ1!": "ORANGEJUICE",
    "LE1!": "LIVECATTLE",
    "HE1!": "LEANHOGS",
    "BTCUSD": "BTCUSD",
    "BTC-USD": "BTCUSD",
}


def _normalize_timeframe(value: str | None) -> str:
    tf = str(value or "D").strip().upper()
    if tf in {"1M", "1MIN", "1MINUTE", "M1"}:
        return "1MIN"
    if tf in {"5M", "5MIN", "5MINUTE", "M5"}:
        return "5MIN"
    if tf in {"30M", "30MIN", "30MINUTE", "M30"}:
        return "30MIN"
    if tf in {"H1", "1H", "1HOUR"}:
        return "1H"
    if tf in {"H4", "4H", "4HOUR"}:
        return "4H"
    if tf in {"W", "WEEK", "WEEKLY"}:
        return "W"
    if tf in {"M", "MONTH", "MONTHLY"}:
        return "M"
    return "D"


def _canonical_symbol(symbol: str) -> str:
    s = str(symbol or "").strip().upper()
    return _SYMBOL_ALIAS.get(s, s)


def _safe_filename(symbol: str) -> str:
    s = _canonical_symbol(symbol)
    return "".join(ch if ch.isalnum() or ch in {"_", "-"} else "_" for ch in s)


def _daily_path(symbol: str) -> Path:
    return _IBKR_DAILY_DIR / f"{_safe_filename(symbol)}.parquet"


def _minute_path(symbol: str) -> Path:
    return _IBKR_MINUTE_DIR / f"{_safe_filename(symbol)}.parquet"


def _ensure_dirs() -> None:
    _IBKR_DAILY_DIR.mkdir(parents=True, exist_ok=True)
    _IBKR_MINUTE_DIR.mkdir(parents=True, exist_ok=True)


def _normalize_ohlc(df: pd.DataFrame) -> pd.DataFrame:
    if df is None or df.empty:
        return pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume"])

    x = df.copy()
    if isinstance(x.columns, pd.MultiIndex):
        x.columns = [str(c[0]).strip() if isinstance(c, tuple) else str(c).strip() for c in x.columns]
    else:
        x.columns = [str(c).strip() for c in x.columns]

    cols = {str(c).lower(): c for c in x.columns}
    time_col = None
    for candidate in ("date", "datetime", "time", "timestamp"):
        if candidate in cols:
            time_col = cols[candidate]
            break

    if time_col is not None:
        idx = pd.to_datetime(x[time_col], errors="coerce", utc=True)
        x = x.drop(columns=[time_col], errors="ignore")
    else:
        idx = pd.to_datetime(x.index, errors="coerce", utc=True)

    x.index = idx
    x = x[~x.index.isna()]
    if x.empty:
        return pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume"])

    o = pd.to_numeric(x[cols.get("open", "open")] if "open" in cols else np.nan, errors="coerce")
    h = pd.to_numeric(x[cols.get("high", "high")] if "high" in cols else np.nan, errors="coerce")
    l = pd.to_numeric(x[cols.get("low", "low")] if "low" in cols else np.nan, errors="coerce")
    c = pd.to_numeric(x[cols.get("close", "close")] if "close" in cols else np.nan, errors="coerce")

    out = pd.DataFrame(index=x.index)
    out["Open"] = o
    out["High"] = np.maximum.reduce([h.to_numpy(dtype=float), o.to_numpy(dtype=float), c.to_numpy(dtype=float)])
    out["Low"] = np.minimum.reduce([l.to_numpy(dtype=float), o.to_numpy(dtype=float), c.to_numpy(dtype=float)])
    out["Close"] = c
    vol_col = cols.get("volume")
    out["Volume"] = pd.to_numeric(x[vol_col], errors="coerce") if vol_col else np.nan

    out = out.replace([np.inf, -np.inf], np.nan)
    out = out.dropna(subset=["Open", "High", "Low", "Close"])
    if out.empty:
        return pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume"])

    out.index = out.index.tz_convert("UTC").tz_localize(None)
    out = out[~out.index.duplicated(keep="last")].sort_index()
    return out


def _read_parquet(path: Path) -> pd.DataFrame:
    if not path.exists():
        return pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume"])
    try:
        return _normalize_ohlc(pd.read_parquet(path))
    except Exception:
        return pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume"])


def _write_parquet(path: Path, df: pd.DataFrame) -> None:
    clean = _normalize_ohlc(df)
    if clean.empty:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    clean.to_parquet(path)


def _merge_clean(existing: pd.DataFrame, incoming: pd.DataFrame) -> pd.DataFrame:
    if existing.empty:
        return _normalize_ohlc(incoming)
    if incoming.empty:
        return _normalize_ohlc(existing)
    merged = pd.concat([existing, incoming], axis=0)
    merged = _normalize_ohlc(merged)
    return merged


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


def _what_to_show_candidates(symbol: str) -> list[str]:
    s = _canonical_symbol(symbol)
    if len(s) == 6 and s.isalpha():
        return ["MIDPOINT", "BID_ASK", "TRADES"]
    if s in {"DXY", "SP500", "NASDAQ100", "DOWJONES", "RUSSELL2000", "DAX40"}:
        return ["TRADES", "MIDPOINT"]
    if s == "BTCUSD":
        return ["TRADES", "MIDPOINT"]
    return ["TRADES", "MIDPOINT"]


def _contract_candidates(symbol: str) -> list[Any]:
    s = _canonical_symbol(symbol)
    out: list[Any] = []

    def _add(value: Any) -> None:
        if value is not None:
            out.append(value)

    if len(s) == 6 and s.isalpha() and Forex is not None:
        _add(Forex(s))

    if ContFuture is not None:
        mapping = {
            "DXY": [ContFuture("DX", exchange="ICEUS")],
            "XAUUSD": [ContFuture("GC", exchange="COMEX")],
            "XAGUSD": [ContFuture("SI", exchange="COMEX")],
            "COPPER": [ContFuture("HG", exchange="COMEX")],
            "PLATINUM": [ContFuture("PL", exchange="NYMEX")],
            "PALLADIUM": [ContFuture("PA", exchange="NYMEX")],
            "WTI": [ContFuture("CL", exchange="NYMEX")],
            "BRENT": [ContFuture("BZ", exchange="NYMEX")],
            "NATGAS": [ContFuture("NG", exchange="NYMEX")],
            "GASOLINE": [ContFuture("RB", exchange="NYMEX")],
            "SP500": [ContFuture("ES", exchange="CME")],
            "NASDAQ100": [ContFuture("NQ", exchange="CME")],
            "DOWJONES": [ContFuture("YM", exchange="CBOT")],
            "RUSSELL2000": [ContFuture("RTY", exchange="CME")],
            "DAX40": [ContFuture("DAX", exchange="EUREX")],
            "WHEAT": [ContFuture("ZW", exchange="CBOT")],
            "CORN": [ContFuture("ZC", exchange="CBOT")],
            "SOYBEANS": [ContFuture("ZS", exchange="CBOT")],
            "SOYOIL": [ContFuture("ZL", exchange="CBOT")],
            "COFFEE": [ContFuture("KC", exchange="ICEUS")],
            "SUGAR": [ContFuture("SB", exchange="ICEUS")],
            "COCOA": [ContFuture("CC", exchange="ICEUS")],
            "COTTON": [ContFuture("CT", exchange="ICEUS")],
            "ORANGEJUICE": [ContFuture("OJ", exchange="ICEUS")],
            "LIVECATTLE": [ContFuture("LE", exchange="CME")],
            "LEANHOGS": [ContFuture("HE", exchange="CME")],
            "BTCUSD": [ContFuture("BRR", exchange="CMECRYPTO")],
        }
        for contract in mapping.get(s, []):
            _add(contract)

    if Index is not None:
        index_map = {
            "SP500": Index("SPX", exchange="CBOE", currency="USD"),
            "NASDAQ100": Index("NDX", exchange="NASDAQ", currency="USD"),
            "DOWJONES": Index("INDU", exchange="NYSE", currency="USD"),
            "DAX40": Index("DAX", exchange="EUREX", currency="EUR"),
        }
        if s in index_map:
            _add(index_map[s])

    if Crypto is not None and s == "BTCUSD":
        _add(Crypto("BTC", exchange="PAXOS", currency="USD"))

    return out


def _qualify_contract(ib: Any, symbol: str) -> Any | None:
    for contract in _contract_candidates(symbol):
        try:
            qualified = ib.qualifyContracts(contract)
        except Exception:
            qualified = []
        if qualified:
            return qualified[0]
    return None


def _request_history(
    ib: Any,
    contract: Any,
    *,
    end_dt: str,
    duration: str,
    bar_size: str,
    what_to_show: str,
    use_rth: bool,
) -> pd.DataFrame:
    try:
        bars = ib.reqHistoricalData(
            contract,
            endDateTime=end_dt,
            durationStr=duration,
            barSizeSetting=bar_size,
            whatToShow=what_to_show,
            useRTH=use_rth,
            formatDate=1,
            keepUpToDate=False,
        )
    except Exception:
        return pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume"])

    if not bars:
        return pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume"])

    if util is None:
        return pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume"])

    try:
        raw = util.df(bars)
    except Exception:
        return pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume"])

    return _normalize_ohlc(raw)


def _download_daily(symbol: str, *, full_history: bool, host: str, port: int, client_id: int) -> pd.DataFrame:
    ib = ensure_ibkr_connection(host=host, port=port, client_id=client_id)
    if ib is None:
        return pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume"])

    contract = _qualify_contract(ib, symbol)
    if contract is None:
        return pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume"])

    duration = "15 Y" if full_history else "30 D"
    # Full-session bars for better alignment with TradingView continuous feeds.
    use_rth = False
    for what in _what_to_show_candidates(symbol):
        df = _request_history(
            ib,
            contract,
            end_dt="",
            duration=duration,
            bar_size="1 day",
            what_to_show=what,
            use_rth=use_rth,
        )
        if not df.empty:
            return df
    return pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume"])


def _download_minute_tail(symbol: str, *, host: str, port: int, client_id: int, duration: str = "7 D") -> pd.DataFrame:
    ib = ensure_ibkr_connection(host=host, port=port, client_id=client_id)
    if ib is None:
        return pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume"])

    contract = _qualify_contract(ib, symbol)
    if contract is None:
        return pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume"])

    use_rth = False
    for what in _what_to_show_candidates(symbol):
        df = _request_history(
            ib,
            contract,
            end_dt="",
            duration=duration,
            bar_size="1 min",
            what_to_show=what,
            use_rth=use_rth,
        )
        if not df.empty:
            return df
    return pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume"])


def _bootstrap_minute_history(symbol: str, *, years: int, host: str, port: int, client_id: int) -> pd.DataFrame:
    ib = ensure_ibkr_connection(host=host, port=port, client_id=client_id)
    if ib is None:
        return pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume"])

    contract = _qualify_contract(ib, symbol)
    if contract is None:
        return pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume"])

    start_limit = datetime.now(timezone.utc) - timedelta(days=int(max(1, years) * 365))
    max_chunks = int(max(6, years * 12 + 2))
    end_cursor = ""
    parts: list[pd.DataFrame] = []

    for _ in range(max_chunks):
        part = pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume"])
        for what in _what_to_show_candidates(symbol):
            part = _request_history(
                ib,
                contract,
                end_dt=end_cursor,
                duration="30 D",
                bar_size="1 min",
                what_to_show=what,
                use_rth=False,
            )
            if not part.empty:
                break
        if part.empty:
            break
        parts.append(part)

        oldest = part.index.min()
        if not isinstance(oldest, pd.Timestamp):
            break
        oldest_utc = oldest.tz_localize("UTC") if oldest.tzinfo is None else oldest.tz_convert("UTC")
        if oldest_utc <= start_limit:
            break
        end_cursor = (oldest_utc - timedelta(seconds=1)).strftime("%Y%m%d %H:%M:%S")

    if not parts:
        return pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume"])

    joined = pd.concat(parts, axis=0)
    return _normalize_ohlc(joined)


def _daily_needs_update(df: pd.DataFrame) -> bool:
    if df.empty:
        return True
    try:
        last_day = pd.Timestamp(df.index.max()).normalize()
    except Exception:
        return True
    today = pd.Timestamp.utcnow().tz_localize(None).normalize()
    return bool((today - last_day).days >= 1)


def _update_daily_cache(symbol: str, *, host: str, port: int, client_id: int) -> pd.DataFrame:
    _ensure_dirs()
    path = _daily_path(symbol)
    existing = _read_parquet(path)

    if _daily_needs_update(existing):
        fresh = _download_daily(symbol, full_history=existing.empty, host=host, port=port, client_id=client_id)
        merged = _merge_clean(existing, fresh)
        if not merged.empty:
            _write_parquet(path, merged)
            return merged

    return existing


def _update_minute_cache(symbol: str, *, years: int, host: str, port: int, client_id: int) -> pd.DataFrame:
    _ensure_dirs()
    path = _minute_path(symbol)
    existing = _read_parquet(path)

    if existing.empty:
        boot = _bootstrap_minute_history(symbol, years=years, host=host, port=port, client_id=client_id)
        if not boot.empty:
            _write_parquet(path, boot)
            return boot
        return existing

    tail = _download_minute_tail(symbol, host=host, port=port, client_id=client_id, duration="7 D")
    merged = _merge_clean(existing, tail)
    if not merged.empty and len(merged) != len(existing):
        _write_parquet(path, merged)
    return merged if not merged.empty else existing


def _trim_years(df: pd.DataFrame, years: int) -> pd.DataFrame:
    if df.empty:
        return df
    cutoff = pd.Timestamp.utcnow().tz_localize(None) - pd.DateOffset(years=int(max(1, years)))
    out = df.loc[df.index >= cutoff]
    return _normalize_ohlc(out)


def load_ibkr_market_data(
    symbol: str,
    timeframe: str = "D",
    *,
    years_daily: int = 10,
    years_minute: int = 3,
    host: str = _DEFAULT_HOST,
    port: int = _DEFAULT_PORT,
    client_id: int = _DEFAULT_CLIENT_ID,
) -> pd.DataFrame:
    """Load IBKR data from local parquet cache and update incrementally when possible."""
    tf = _normalize_timeframe(timeframe)
    canonical = _canonical_symbol(symbol)

    if tf in {"D", "W", "M"}:
        daily = _update_daily_cache(canonical, host=host, port=port, client_id=client_id)
        daily = _trim_years(daily, years_daily)
        if tf == "W":
            return _resample_ohlc(daily, "W-FRI")
        if tf == "M":
            return _resample_ohlc(daily, "ME")
        return _normalize_ohlc(daily)

    minute = _update_minute_cache(canonical, years=years_minute, host=host, port=port, client_id=client_id)
    minute = _trim_years(minute, years_minute)
    if minute.empty:
        return minute

    rule = {
        "1MIN": None,
        "5MIN": "5min",
        "30MIN": "30min",
        "1H": "1h",
        "4H": "4h",
    }.get(tf)
    if rule is None:
        return _normalize_ohlc(minute)
    return _resample_ohlc(minute, rule)
