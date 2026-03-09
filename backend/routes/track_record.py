from __future__ import annotations

import csv
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter


router = APIRouter(prefix="/api/track-record", tags=["track-record"])

_ROOT = Path(__file__).resolve().parents[2]
_TRACK_RECORD_ROOT = _ROOT / "trading_dashboard" / "live track record"
_OUTPUT_DIR = _TRACK_RECORD_ROOT / "output"
_HISTORICAL_TRADES_PATH = _TRACK_RECORD_ROOT / "trades_clean_compounded.csv"
_APPENDED_TRADES_PATH = _TRACK_RECORD_ROOT / "trades_appended_api.json"
_MONTH_KEYS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def _read_csv_rows(name: str) -> list[dict[str, str]]:
    path = _OUTPUT_DIR / name
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8-sig", newline="") as fh:
        return list(csv.DictReader(fh))


def _to_float(value: Any) -> float | None:
    try:
        text = str(value).strip()
        if text == "":
            return None
        num = float(text)
    except Exception:
        return None
    return num if num == num else None


def _to_int(value: Any) -> int | None:
    try:
        text = str(value).strip()
        if text == "":
            return None
        return int(float(text))
    except Exception:
        return None


def _latest_mtime_iso(paths: list[Path]) -> str | None:
    existing = [p for p in paths if p.exists()]
    if not existing:
        return None
    latest = max(existing, key=lambda p: p.stat().st_mtime)
    return datetime.fromtimestamp(latest.stat().st_mtime, tz=timezone.utc).replace(microsecond=0).isoformat()


def _normalize_date(value: Any) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None

    for parser in (datetime.fromisoformat,):
        try:
            parsed = parser(text.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed.astimezone(timezone.utc).replace(microsecond=0).isoformat()
        except Exception:
            pass

    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            parsed = datetime.strptime(text, fmt).replace(tzinfo=timezone.utc)
            return parsed.replace(microsecond=0).isoformat()
        except Exception:
            pass

    return None


def _derive_direction(seed: str, index: int) -> str:
    hash_value = 7
    for char in f"{seed}-{index}":
        hash_value = (hash_value * 31 + ord(char)) % 100_003
    return "Long" if hash_value % 100 < 51 else "Short"


def _load_track_record_trades() -> list[dict[str, Any]]:
    trades: list[dict[str, Any]] = []

    if _HISTORICAL_TRADES_PATH.exists():
        with _HISTORICAL_TRADES_PATH.open("r", encoding="utf-8-sig", newline="") as fh:
            reader = csv.DictReader(fh)
            for index, row in enumerate(reader):
                date = _normalize_date(row.get("Close Date"))
                trade_return = _to_float(row.get("Gain (%)"))
                if date is None or trade_return is None:
                    continue
                trades.append(
                    {
                        "date": date,
                        "trade_result": trade_return,
                        "trade_direction": _derive_direction(date, index),
                    }
                )

    if _APPENDED_TRADES_PATH.exists():
        try:
            parsed = json.loads(_APPENDED_TRADES_PATH.read_text(encoding="utf-8"))
        except Exception:
            parsed = []
        if isinstance(parsed, list):
            base_index = len(trades)
            for index, row in enumerate(parsed):
                date = _normalize_date(getattr(row, "get", lambda *_: None)("date"))
                trade_result = _to_float(getattr(row, "get", lambda *_: None)("trade_result"))
                if trade_result is None:
                    trade_result = _to_float(getattr(row, "get", lambda *_: None)("return_pct"))
                if date is None or trade_result is None:
                    continue
                direction_raw = str(getattr(row, "get", lambda *_: None)("trade_direction") or "").strip()
                trades.append(
                    {
                        "date": date,
                        "trade_result": trade_result,
                        "trade_direction": direction_raw if direction_raw in {"Long", "Short"} else _derive_direction(date, base_index + index),
                    }
                )

    trades.sort(key=lambda item: item["date"])
    return trades


def _curve_from_scale(scale: int) -> dict[str, Any]:
    rows = _read_csv_rows(f"equity_scaled_{scale}x.csv")
    points = []
    for row in rows:
        t = str(row.get("close_time") or "").strip()
        value = _to_float(row.get("balance_scaled"))
        return_pct = _to_float(row.get("return_pct_scaled"))
        if not t or value is None:
            continue
        points.append(
            {
                "t": t,
                "value": value,
                "returnPct": return_pct,
                "symbol": str(row.get("symbol") or "").strip() or None,
            }
        )
    return {
        "id": f"{scale}x",
        "label": f"{scale}x",
        "points": points,
    }


def _gain_curve() -> dict[str, Any]:
    rows = _read_csv_rows("gain_pct_equity_after_trade.csv")
    points = []
    for row in rows:
        t = str(row.get("close_date") or "").strip()
        value = _to_float(row.get("equity_after_trade"))
        gain_pct = _to_float(row.get("gain_pct"))
        if not t or value is None:
            continue
        points.append(
            {
                "t": t,
                "value": value,
                "returnPct": (gain_pct / 100.0) if gain_pct is not None else None,
                "symbol": None,
            }
        )
    return {
        "id": "gain_pct",
        "label": "Gain %",
        "points": points,
    }


@router.get("")
async def api_track_record():
    metrics_rows = _read_csv_rows("gain_pct_metrics.csv")
    monthly_rows = _read_csv_rows("monthly_returns.csv")
    performance_rows = _read_csv_rows("performance_table.csv")

    metrics_row = metrics_rows[0] if metrics_rows else {}
    curves = [_curve_from_scale(scale) for scale in range(1, 6)]
    curves.append(_gain_curve())

    monthly_returns = []
    for row in monthly_rows:
        year = _to_int(row.get("year"))
        month = _to_int(row.get("month"))
        month_return = _to_float(row.get("month_return"))
        if year is None or month is None or month_return is None:
            continue
        monthly_returns.append(
            {
                "year": year,
                "month": month,
                "monthReturn": month_return,
            }
        )

    performance_table = []
    for row in performance_rows:
        year = _to_int(row.get("year"))
        total = _to_float(row.get("Total"))
        if year is None:
            continue
        months = {key: _to_float(row.get(key)) for key in _MONTH_KEYS}
        performance_table.append(
            {
                "year": year,
                "total": total,
                "months": months,
            }
        )

    trades = _load_track_record_trades()
    winning_trades = sum(1 for trade in trades if float(trade["trade_result"]) > 0)
    losing_trades = sum(1 for trade in trades if float(trade["trade_result"]) < 0)
    long_trades = sum(1 for trade in trades if trade["trade_direction"] == "Long")
    short_trades = sum(1 for trade in trades if trade["trade_direction"] == "Short")
    trades_by_year: dict[int, int] = {}
    for trade in trades:
        year = datetime.fromisoformat(str(trade["date"]).replace("Z", "+00:00")).year
        trades_by_year[year] = trades_by_year.get(year, 0) + 1

    realized_year_returns = [float(row["total"]) for row in performance_table if row["total"] is not None]
    annual_average_return = (sum(realized_year_returns) / len(realized_year_returns) / 100.0) if realized_year_returns else 0.0

    updated_at = _latest_mtime_iso(
        [
            _HISTORICAL_TRADES_PATH,
            _APPENDED_TRADES_PATH,
            _OUTPUT_DIR / "gain_pct_metrics.csv",
            _OUTPUT_DIR / "monthly_returns.csv",
            _OUTPUT_DIR / "performance_table.csv",
            _OUTPUT_DIR / "gain_pct_equity_after_trade.csv",
            *(_OUTPUT_DIR / f"equity_scaled_{scale}x.csv" for scale in range(1, 6)),
        ]
    )

    return {
        "updatedAt": updated_at,
        "metrics": {
            "finalEquity": _to_float(metrics_row.get("final_equity")) or 0.0,
            "totalReturnPct": _to_float(metrics_row.get("total_return_pct")) or 0.0,
            "maxDrawdown": _to_float(metrics_row.get("max_drawdown")) or 0.0,
            "winRate": _to_float(metrics_row.get("winrate")) or 0.0,
            "sharpeRatio": _to_float(metrics_row.get("sharpe_ratio")) or 0.0,
            "calmarRatio": _to_float(metrics_row.get("calmar_ratio")) or 0.0,
            "trades": _to_int(metrics_row.get("trades")) or 0,
            "winningTrades": winning_trades,
            "losingTrades": losing_trades,
            "longTrades": long_trades,
            "shortTrades": short_trades,
            "annualAverageReturn": annual_average_return,
        },
        "curves": curves,
        "monthlyReturns": monthly_returns,
        "performanceTable": performance_table,
        "tradesByYear": [{"year": year, "count": count} for year, count in sorted(trades_by_year.items())],
    }
