from __future__ import annotations

import argparse
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
import sys
from typing import Iterable

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT.parent) not in sys.path:
    sys.path.insert(0, str(ROOT.parent))


FOREX_SYMBOLS = {
    "EURUSD",
    "GBPUSD",
    "USDJPY",
    "USDCHF",
    "AUDUSD",
    "USDCAD",
    "NZDUSD",
}


@dataclass(frozen=True)
class Chunk:
    start: pd.Timestamp
    end: pd.Timestamp


def _to_utc_ts(value: str | pd.Timestamp) -> pd.Timestamp:
    ts = pd.Timestamp(value)
    if ts.tzinfo is None:
      ts = ts.tz_localize("UTC")
    else:
      ts = ts.tz_convert("UTC")
    return ts


def _time_chunks(start: pd.Timestamp, end: pd.Timestamp, months: int) -> Iterable[Chunk]:
    step_months = max(1, int(months))
    cursor = start
    while cursor < end:
        nxt = cursor + pd.DateOffset(months=step_months)
        if nxt > end:
            nxt = end
        yield Chunk(cursor, nxt)
        cursor = nxt


def _resolve_instrument(symbol: str):
    import dukascopy_python.instruments as instruments
    from trading_dashboard.screener.config import DUKASCOPY_ASSET_GROUPS

    symbol_up = str(symbol).upper().strip()
    const_name = symbol_up
    for group in DUKASCOPY_ASSET_GROUPS.values():
        if symbol_up in group:
            const_name = str(group[symbol_up]).strip()
            break
    inst = getattr(instruments, const_name, None)
    if inst is None:
        raise ValueError(f"Unsupported Dukascopy instrument: {symbol_up} ({const_name})")
    return inst


def _resolve_interval():
    import dukascopy_python as d

    for name in ("INTERVAL_HOUR_1", "INTERVAL_H1", "INTERVAL_1H"):
        if hasattr(d, name):
            return getattr(d, name)
    raise RuntimeError("No Dukascopy H1 interval constant found.")


def _normalize_chunk(df: pd.DataFrame) -> pd.DataFrame:
    if df is None or df.empty:
        return pd.DataFrame(columns=["open", "high", "low", "close", "volume"])

    out = df.copy()
    if not isinstance(out.index, pd.DatetimeIndex):
        if "timestamp" in out.columns:
            out.index = pd.to_datetime(out["timestamp"], errors="coerce", utc=True)
        elif "time" in out.columns:
            out.index = pd.to_datetime(out["time"], errors="coerce", utc=True)
        else:
            out.index = pd.to_datetime(out.index, errors="coerce", utc=True)
    else:
        if out.index.tz is None:
            out.index = out.index.tz_localize("UTC")
        else:
            out.index = out.index.tz_convert("UTC")

    out = out.loc[~pd.isna(out.index)].copy()

    ren = {}
    for src, dst in [("Open", "open"), ("High", "high"), ("Low", "low"), ("Close", "close"), ("Volume", "volume")]:
        if src in out.columns and dst not in out.columns:
            ren[src] = dst
    if ren:
        out = out.rename(columns=ren)

    for col in ("open", "high", "low", "close", "volume"):
        if col not in out.columns:
            out[col] = pd.NA
        out[col] = pd.to_numeric(out[col], errors="coerce")

    out = out.dropna(subset=["open", "high", "low", "close"])
    out = out[~out.index.duplicated(keep="last")].sort_index()
    return out[["open", "high", "low", "close", "volume"]]


def _read_existing_parquet(path: Path) -> pd.DataFrame:
    if not path.exists():
        return pd.DataFrame(columns=["open", "high", "low", "close", "volume"])
    try:
        raw = pd.read_parquet(path)
    except Exception:
        return pd.DataFrame(columns=["open", "high", "low", "close", "volume"])

    if "t" in raw.columns:
        raw.index = pd.to_datetime(raw["t"], errors="coerce", utc=True)
    elif "time" in raw.columns:
        raw.index = pd.to_datetime(raw["time"], errors="coerce", utc=True)
    elif not isinstance(raw.index, pd.DatetimeIndex):
        raw.index = pd.to_datetime(raw.index, errors="coerce", utc=True)
    return _normalize_chunk(raw)


def _write_outputs(symbol: str, df: pd.DataFrame, out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    parquet_path = out_dir / f"{symbol}_H1.parquet"
    json_path = out_dir / f"{symbol}_H1.json"

    out = df.copy()
    out.index = out.index.tz_convert("UTC").tz_localize(None)
    out["t"] = out.index.map(lambda value: pd.Timestamp(value).isoformat() + "Z")
    out.to_parquet(parquet_path, index=False)

    payload = {
        "symbol": symbol,
        "timeframe": "H1",
        "source": "dukascopy",
        "updatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "bars": [
            {
                "t": row["t"],
                "open": float(row["open"]),
                "high": float(row["high"]),
                "low": float(row["low"]),
                "close": float(row["close"]),
                "volume": None if pd.isna(row["volume"]) else float(row["volume"]),
            }
            for _, row in out.iterrows()
        ],
    }
    json_path.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")


def refresh_symbol(
    symbol: str,
    start: str,
    end: str | None,
    out_dir: Path,
    chunk_months: int,
) -> tuple[str, int, str | None, str | None]:
    import dukascopy_python as d

    symbol_up = str(symbol).upper().strip()
    if symbol_up not in FOREX_SYMBOLS:
        raise ValueError(f"Unsupported optimizer FX symbol: {symbol_up}")

    interval = _resolve_interval()
    instrument = _resolve_instrument(symbol_up)
    side = getattr(d, "OFFER_SIDE_BID", None)
    if side is None:
        raise RuntimeError("Dukascopy bid side constant not found.")

    parquet_path = out_dir / f"{symbol_up}_H1.parquet"
    existing = _read_existing_parquet(parquet_path)

    start_ts = _to_utc_ts(start)
    end_ts = _to_utc_ts(end or pd.Timestamp.now(tz="UTC"))
    frames = [existing] if not existing.empty else []
    download_windows: list[Chunk] = []
    if existing.empty:
        download_windows.append(Chunk(start_ts, end_ts))
    else:
        existing_start = existing.index.min().tz_convert("UTC")
        existing_end = existing.index.max().tz_convert("UTC")
        if start_ts < existing_start:
            download_windows.append(Chunk(start_ts, existing_start))
        refresh_start = max(start_ts, existing_end - pd.Timedelta(days=10))
        if refresh_start < end_ts:
            download_windows.append(Chunk(refresh_start, end_ts))

    for window in download_windows:
        for chunk in _time_chunks(window.start, window.end, chunk_months):
            raw = d.fetch(instrument, interval, side, chunk.start.to_pydatetime(), chunk.end.to_pydatetime())
            normalized = _normalize_chunk(raw)
            if not normalized.empty:
                normalized = normalized.loc[(normalized.index >= chunk.start) & (normalized.index < chunk.end)].copy()
                frames.append(normalized)

    if not frames:
        raise RuntimeError(f"No Dukascopy H1 data returned for {symbol_up}")

    merged = pd.concat(frames, axis=0)
    merged = merged[~merged.index.duplicated(keep="last")].sort_index()
    merged = merged.loc[merged.index >= _to_utc_ts("2012-01-01")].copy()
    _write_outputs(symbol_up, merged, out_dir)
    first = merged.index.min().isoformat() if not merged.empty else None
    last = merged.index.max().isoformat() if not merged.empty else None
    return symbol_up, int(len(merged)), first, last


def main() -> None:
    parser = argparse.ArgumentParser(description="Build local Dukascopy H1 cache for optimizer FX assets.")
    parser.add_argument("--symbols", required=True, help="Comma-separated FX symbols.")
    parser.add_argument("--start", default="2012-01-01", help="UTC start date.")
    parser.add_argument("--end", default=None, help="UTC end date.")
    parser.add_argument("--out-dir", default=str(ROOT / "data" / "forex"), help="Output cache directory.")
    parser.add_argument("--chunk-months", type=int, default=12, help="Months per Dukascopy fetch chunk.")
    parser.add_argument("--workers", type=int, default=3, help="Parallel symbol downloads.")
    args = parser.parse_args()

    out_dir = Path(args.out_dir)
    symbols = [item.strip().upper() for item in str(args.symbols).split(",") if item.strip()]
    if not symbols:
        raise SystemExit("No symbols provided.")

    workers = max(1, min(int(args.workers), len(symbols)))
    if workers == 1:
        for symbol in symbols:
            sym, rows, first, last = refresh_symbol(symbol, args.start, args.end, out_dir, int(args.chunk_months))
            print(f"[optimizer-forex-cache] {sym} rows={rows} start={first} end={last}")
        return

    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = {
            executor.submit(refresh_symbol, symbol, args.start, args.end, out_dir, int(args.chunk_months)): symbol
            for symbol in symbols
        }
        for future in as_completed(futures):
            sym, rows, first, last = future.result()
            print(f"[optimizer-forex-cache] {sym} rows={rows} start={first} end={last}")


if __name__ == "__main__":
    main()
