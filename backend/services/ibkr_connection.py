from __future__ import annotations

import os
import threading
from typing import Any

try:
    from ib_insync import IB  # type: ignore
except Exception:  # pragma: no cover
    IB = None  # type: ignore


_DEFAULT_HOST = os.getenv("IBKR_HOST", "127.0.0.1")
_DEFAULT_PORT = int(os.getenv("IBKR_PORT", "7497"))
_DEFAULT_CLIENT_ID = int(os.getenv("IBKR_CLIENT_ID", "73"))

_IB_INSTANCE: Any | None = None
_IB_LOCK = threading.Lock()


def _is_connected(client: Any | None) -> bool:
    if client is None:
        return False
    try:
        return bool(client.isConnected())
    except Exception:
        return False


def connect_ibkr(
    host: str = _DEFAULT_HOST,
    port: int = _DEFAULT_PORT,
    client_id: int = _DEFAULT_CLIENT_ID,
    *,
    readonly: bool = True,
    timeout: float = 8.0,
) -> Any | None:
    """Return a connected IB client or ``None`` when IBKR API is unavailable."""
    global _IB_INSTANCE

    if IB is None:  # pragma: no cover
        return None

    with _IB_LOCK:
        if _is_connected(_IB_INSTANCE):
            return _IB_INSTANCE

        if _IB_INSTANCE is not None:
            try:
                _IB_INSTANCE.disconnect()
            except Exception:
                pass
            _IB_INSTANCE = None

        ib = IB()
        try:
            ib.connect(
                host=str(host),
                port=int(port),
                clientId=int(client_id),
                timeout=float(timeout),
                readonly=bool(readonly),
            )
        except Exception:
            try:
                ib.disconnect()
            except Exception:
                pass
            return None

        _IB_INSTANCE = ib if _is_connected(ib) else None
        return _IB_INSTANCE


def disconnect_ibkr() -> None:
    """Disconnect global IBKR client."""
    global _IB_INSTANCE

    with _IB_LOCK:
        if _IB_INSTANCE is None:
            return
        try:
            _IB_INSTANCE.disconnect()
        except Exception:
            pass
        _IB_INSTANCE = None


def ensure_ibkr_connection(
    host: str = _DEFAULT_HOST,
    port: int = _DEFAULT_PORT,
    client_id: int = _DEFAULT_CLIENT_ID,
) -> Any | None:
    """Reconnect automatically if IBKR session dropped."""
    client = connect_ibkr(host=host, port=port, client_id=client_id)
    if _is_connected(client):
        return client
    return None
