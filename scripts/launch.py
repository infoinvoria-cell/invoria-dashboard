from __future__ import annotations

from pathlib import Path
import subprocess


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    frontend_dir = root / "frontend"
    if not frontend_dir.exists():
        raise FileNotFoundError(f"frontend directory not found: {frontend_dir}")

    cmd = [
        "npm",
        "run",
        "dev",
    ]
    return subprocess.call(cmd, cwd=str(frontend_dir))


if __name__ == "__main__":
    raise SystemExit(main())
