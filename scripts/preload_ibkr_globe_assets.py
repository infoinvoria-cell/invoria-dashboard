from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
import sys
from typing import Any

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
ASSET_CONFIG = ROOT / "config" / "asset_config.json"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.services.ibkr_connection import disconnect_ibkr, ensure_ibkr_connection
from backend.services import ibkr_downloader as dl


@dataclass
class DownloadResult:
    asset_id: str
    symbol: str
    status: str
    daily_rows: int
    minute_rows: int
    daily_start: str
    daily_end: str
    minute_start: str
    minute_end: str
    note: str = ""


def _read_assets(include_cross_pairs: bool = True) -> list[dict[str, Any]]:
    rows = json.loads(ASSET_CONFIG.read_text(encoding="utf-8-sig"))
    if include_cross_pairs:
        return [r for r in rows if isinstance(r, dict)]
    return [r for r in rows if str(r.get("category", "")).strip() != "Cross Pairs"]


def _as_iso(ts: pd.Timestamp | None) -> str:
    if ts is None:
        return "-"
    try:
        return pd.Timestamp(ts).strftime("%Y-%m-%d %H:%M")
    except Exception:
        return "-"


def _daily_needs_reset(symbol: str, start_year: int) -> bool:
    path = dl._daily_path(symbol)  # type: ignore[attr-defined]
    df = dl._read_parquet(path)  # type: ignore[attr-defined]
    if df.empty:
        return False
    cutoff = pd.Timestamp(year=start_year, month=1, day=1)
    return pd.Timestamp(df.index.min()) > cutoff


def _minute_needs_reset(symbol: str, years: int) -> bool:
    path = dl._minute_path(symbol)  # type: ignore[attr-defined]
    df = dl._read_parquet(path)  # type: ignore[attr-defined]
    if df.empty:
        return False
    cutoff = pd.Timestamp.utcnow().tz_localize(None) - pd.DateOffset(years=max(1, int(years)))
    return pd.Timestamp(df.index.min()) > cutoff


def _delete_cache(symbol: str, delete_daily: bool, delete_minute: bool) -> None:
    if delete_daily:
        p = dl._daily_path(symbol)  # type: ignore[attr-defined]
        if p.exists():
            p.unlink()
    if delete_minute:
        p = dl._minute_path(symbol)  # type: ignore[attr-defined]
        if p.exists():
            p.unlink()


def _download_one(asset_id: str, symbol: str, *, years_daily: int, years_minute: int) -> DownloadResult:
    note_parts: list[str] = []

    daily = dl.load_ibkr_market_data(symbol, timeframe="D", years_daily=years_daily, years_minute=years_minute)
    minute = dl.load_ibkr_market_data(symbol, timeframe="1M", years_daily=years_daily, years_minute=years_minute)

    daily_rows = int(len(daily))
    minute_rows = int(len(minute))

    if daily_rows == 0 and minute_rows == 0:
        return DownloadResult(
            asset_id=asset_id,
            symbol=symbol,
            status="failed",
            daily_rows=0,
            minute_rows=0,
            daily_start="-",
            daily_end="-",
            minute_start="-",
            minute_end="-",
            note="no data from IBKR",
        )

    if daily_rows == 0:
        note_parts.append("daily-empty")
    if minute_rows == 0:
        note_parts.append("minute-empty")

    return DownloadResult(
        asset_id=asset_id,
        symbol=symbol,
        status="ok" if daily_rows > 0 and minute_rows > 0 else "partial",
        daily_rows=daily_rows,
        minute_rows=minute_rows,
        daily_start=_as_iso(pd.Timestamp(daily.index.min()) if daily_rows else None),
        daily_end=_as_iso(pd.Timestamp(daily.index.max()) if daily_rows else None),
        minute_start=_as_iso(pd.Timestamp(minute.index.min()) if minute_rows else None),
        minute_end=_as_iso(pd.Timestamp(minute.index.max()) if minute_rows else None),
        note=", ".join(note_parts),
    )


def _verify_live_delta(symbol: str, cached_daily: pd.DataFrame, cached_minute: pd.DataFrame, *, host: str, port: int, client_id: int) -> str:
    try:
        live_daily = dl._download_daily(symbol, full_history=False, host=host, port=port, client_id=client_id)  # type: ignore[attr-defined]
        live_minute = dl._download_minute_tail(symbol, host=host, port=port, client_id=client_id, duration="2 D")  # type: ignore[attr-defined]
    except Exception as err:
        return f"verify-error:{err}"

    parts: list[str] = []
    if not cached_daily.empty and not live_daily.empty:
        cd = float(cached_daily["Close"].iloc[-1])
        ld = float(live_daily["Close"].iloc[-1])
        d_bp = ((cd / ld) - 1.0) * 10_000.0 if abs(ld) > 1e-12 else 0.0
        parts.append(f"DΔbp={d_bp:.2f}")
    if not cached_minute.empty and not live_minute.empty:
        cm = float(cached_minute["Close"].iloc[-1])
        lm = float(live_minute["Close"].iloc[-1])
        m_bp = ((cm / lm) - 1.0) * 10_000.0 if abs(lm) > 1e-12 else 0.0
        parts.append(f"1mΔbp={m_bp:.2f}")
    return " | ".join(parts) if parts else "verify-no-live-bars"


def main() -> int:
    parser = argparse.ArgumentParser(description="Preload IBKR cache for all Globe assets.")
    parser.add_argument("--start-year", type=int, default=2012, help="Daily data start year target (default: 2012).")
    parser.add_argument("--minute-years", type=int, default=2, help="Minute history window in years (default: 2).")
    parser.add_argument("--exclude-cross-pairs", action="store_true", help="Exclude Cross-Pairs assets (default: include).")
    parser.add_argument("--force-reset", action="store_true", help="Delete existing per-asset IBKR cache before loading.")
    parser.add_argument("--verify-live", action="store_true", help="Compare cached last bars vs fresh IBKR pull.")
    parser.add_argument("--host", default="127.0.0.1", help="IBKR API host")
    parser.add_argument("--port", type=int, default=7497, help="IBKR API port")
    parser.add_argument("--client-id", type=int, default=73, help="IBKR API client id")
    args = parser.parse_args()

    include_cross_pairs = not bool(args.exclude_cross_pairs)
    assets = _read_assets(include_cross_pairs=include_cross_pairs)
    symbols = [(str(r.get("id", "")).strip(), str(r.get("tvSource", "")).strip()) for r in assets]
    symbols = [(aid, sym) for (aid, sym) in symbols if aid and sym]

    years_daily = max(2, datetime.now(timezone.utc).year - int(args.start_year) + 1)

    print(
        f"[IBKR] assets: {len(symbols)} | include-cross-pairs={include_cross_pairs} "
        f"| start-year: {args.start_year} | minute-years: {args.minute_years}"
    )
    client = ensure_ibkr_connection(host=args.host, port=args.port, client_id=args.client_id)
    if client is None:
        print(f"[IBKR] ERROR: cannot connect to IBKR API at {args.host}:{args.port} (clientId={args.client_id}).")
        return 2

    results: list[DownloadResult] = []
    try:
        symbol_cache: dict[str, DownloadResult] = {}
        for idx, (asset_id, symbol) in enumerate(symbols, start=1):
            need_daily_reset = args.force_reset or _daily_needs_reset(symbol, int(args.start_year))
            need_minute_reset = args.force_reset or _minute_needs_reset(symbol, int(args.minute_years))
            if need_daily_reset or need_minute_reset:
                _delete_cache(symbol, delete_daily=need_daily_reset, delete_minute=need_minute_reset)

            print(f"[{idx:02d}/{len(symbols)}] {asset_id} -> {symbol} ...")
            if symbol in symbol_cache:
                shared = symbol_cache[symbol]
                res = DownloadResult(
                    asset_id=asset_id,
                    symbol=symbol,
                    status=shared.status,
                    daily_rows=shared.daily_rows,
                    minute_rows=shared.minute_rows,
                    daily_start=shared.daily_start,
                    daily_end=shared.daily_end,
                    minute_start=shared.minute_start,
                    minute_end=shared.minute_end,
                    note=f"shared-symbol:{symbol}",
                )
            else:
                res = _download_one(asset_id, symbol, years_daily=years_daily, years_minute=int(args.minute_years))
                symbol_cache[symbol] = res
                if args.verify_live:
                    d = dl.load_ibkr_market_data(symbol, timeframe="D", years_daily=years_daily, years_minute=int(args.minute_years))
                    m = dl.load_ibkr_market_data(symbol, timeframe="1MIN", years_daily=years_daily, years_minute=int(args.minute_years))
                    delta_note = _verify_live_delta(symbol, d, m, host=args.host, port=args.port, client_id=args.client_id)
                    res.note = f"{res.note}; {delta_note}".strip("; ").strip()
            results.append(res)
            print(
                f"    {res.status.upper()} | D:{res.daily_rows} ({res.daily_start} -> {res.daily_end}) "
                f"| 1m:{res.minute_rows} ({res.minute_start} -> {res.minute_end})"
                + (f" | {res.note}" if res.note else "")
            )
    finally:
        disconnect_ibkr()

    ok = sum(1 for r in results if r.status == "ok")
    partial = sum(1 for r in results if r.status == "partial")
    failed = sum(1 for r in results if r.status == "failed")
    print(f"[IBKR] done | ok={ok} partial={partial} failed={failed}")

    report_dir = ROOT / "logs"
    report_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    report_path = report_dir / f"ibkr_globe_preload_{stamp}.csv"
    pd.DataFrame([r.__dict__ for r in results]).to_csv(report_path, index=False)
    print(f"[IBKR] report: {report_path}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
