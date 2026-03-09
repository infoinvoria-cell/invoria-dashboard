param(
    [int]$ApiPort = 8000,
    [int]$FrontendPort = 3000,
    [string]$ApiHost = "0.0.0.0",
    [string]$FrontendHost = "0.0.0.0",
    [switch]$OpenWindow
)

$ErrorActionPreference = "Stop"
$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path
$launcher = Join-Path $ROOT "..\trading_dashboard\launch_dashboard_app.ps1"

if (-not (Test-Path $launcher)) {
    throw "Launcher script not found: $launcher"
}

if (-not $OpenWindow) {
    $OpenWindow = $true
}

& $launcher -ApiPort $ApiPort -FrontendPort $FrontendPort -ApiHost $ApiHost -FrontendHost $FrontendHost -OpenWindow:$OpenWindow
