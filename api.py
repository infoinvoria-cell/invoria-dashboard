"""ASGI entrypoint for `uvicorn api:app --reload`."""

import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent
_TRADING_DASHBOARD_ROOT = _ROOT / "trading_dashboard"
if _TRADING_DASHBOARD_ROOT.exists():
    trading_dashboard_path = str(_TRADING_DASHBOARD_ROOT)
    if trading_dashboard_path not in sys.path:
        sys.path.insert(0, trading_dashboard_path)

from backend.main import app

