#!/usr/bin/env bash
set -euo pipefail

TUNNEL_NAME="${CLOUDFLARE_TUNNEL_NAME:-invoria-dashboard}"
TUNNEL_TOKEN="${CLOUDFLARE_TUNNEL_TOKEN:-}"

if [[ -n "$TUNNEL_TOKEN" ]]; then
  echo "Starting Cloudflare tunnel with token..."
  exec cloudflared tunnel run --token "$TUNNEL_TOKEN"
fi

echo "Starting named Cloudflare tunnel: $TUNNEL_NAME"
exec cloudflared tunnel run "$TUNNEL_NAME"
