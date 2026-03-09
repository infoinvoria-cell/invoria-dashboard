param(
    [int]$ApiPort = 8000,
    [int]$FrontendPort = 3000,
    [string]$ApiHost = "127.0.0.1",
    [string]$FrontendHost = "127.0.0.1",
    [string]$ApiBase = "",
    [switch]$Bootstrap,
    [switch]$SkipBackendAutoStart
)

$ErrorActionPreference = "Stop"

$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ROOT

function Test-PortListening {
    param([int]$CheckPort)

    try {
        $listeners = Get-NetTCPConnection -State Listen -LocalPort $CheckPort -ErrorAction Stop
        return @($listeners).Count -gt 0
    } catch {
        return $false
    }
}

if (-not $SkipBackendAutoStart -and -not (Test-PortListening -CheckPort $ApiPort)) {
    $startApiScript = Join-Path $ROOT "start_backend_bg.ps1"
    if (-not (Test-Path $startApiScript)) {
        throw "start_backend_bg.ps1 not found: $startApiScript"
    }
    Write-Host "Starting FastAPI backend on port $ApiPort..."
    if ($Bootstrap) {
        & $startApiScript -Port $ApiPort -ListenHost $ApiHost -Bootstrap
    } else {
        & $startApiScript -Port $ApiPort -ListenHost $ApiHost
    }
}

$frontendDir = Join-Path $ROOT "trading_dashboard\frontend"
if (-not (Test-Path $frontendDir)) {
    throw "frontend directory not found: $frontendDir"
}

Set-Location $frontendDir

$NPM_CMD = "npm.cmd"
$NEXT_CMD = Join-Path $frontendDir "node_modules\.bin\next.cmd"
$NEXT_BUILD_MANIFEST = Join-Path $frontendDir ".next\BUILD_ID"

if ($Bootstrap -or -not (Test-Path (Join-Path $frontendDir "node_modules"))) {
    Write-Host "Installing frontend dependencies..."
    & $NPM_CMD install
}

if (-not (Test-Path $NEXT_CMD)) {
    Write-Host "Next.js CLI missing. Reinstalling frontend dependencies..."
    & $NPM_CMD install
}

if (-not (Test-Path $NEXT_CMD)) {
    throw "Next.js CLI not found after install: $NEXT_CMD"
}

if (-not (Test-Path $NEXT_BUILD_MANIFEST)) {
    Write-Host "Creating production frontend build..."
    & $NPM_CMD run build
}

$apiBaseUrl = if ([string]::IsNullOrWhiteSpace($ApiBase)) { "http://${ApiHost}:$ApiPort" } else { $ApiBase }
$env:NEXT_PUBLIC_API_BASE_URL = $apiBaseUrl
$env:API_BASE_URL = $apiBaseUrl

Write-Host "Starting Next.js frontend on http://${FrontendHost}:$FrontendPort (API base: $apiBaseUrl)"
& $NEXT_CMD start --hostname $FrontendHost --port $FrontendPort
