@echo off
setlocal EnableDelayedExpansion

set TUNNEL_NAME=%CLOUDFLARE_TUNNEL_NAME%
if "%TUNNEL_NAME%"=="" set TUNNEL_NAME=invoria-dashboard

if not "%CLOUDFLARE_TUNNEL_TOKEN%"=="" (
  echo Starting Cloudflare tunnel with token...
  cloudflared tunnel run --token %CLOUDFLARE_TUNNEL_TOKEN%
  goto :eof
)

echo Starting named Cloudflare tunnel: %TUNNEL_NAME%
cloudflared tunnel run %TUNNEL_NAME%

endlocal
