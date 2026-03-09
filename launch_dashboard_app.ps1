param(
    [Alias("Port")]
    [int]$ApiPort = 8000,
    [int]$FrontendPort = 3000,
    [string]$ApiHost = "127.0.0.1",
    [string]$FrontendHost = "127.0.0.1",
    [string]$ApiBase = "",
    [switch]$Bootstrap,
    [int]$StartupTimeoutSec = 90,
    [bool]$RestartRunning = $true,
    [switch]$OpenWindow
)

$ErrorActionPreference = "Stop"

$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ROOT

function Get-LocalIPv4 {
    try {
        $ips = Get-NetIPAddress -AddressFamily IPv4 -PrefixOrigin Dhcp,Manual -Type Unicast -ErrorAction Stop |
            Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
            Select-Object -ExpandProperty IPAddress
        return $ips | Select-Object -First 1
    } catch {
        return "127.0.0.1"
    }
}

function Test-PortListening {
    param([int]$CheckPort)

    try {
        $listeners = Get-NetTCPConnection -State Listen -LocalPort $CheckPort -ErrorAction Stop
        return @($listeners).Count -gt 0
    } catch {
        return $false
    }
}

function Stop-PortProcesses {
    param(
        [int]$CheckPort,
        [string]$Label
    )

    $pids = @(
        Get-NetTCPConnection -State Listen -LocalPort $CheckPort -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique
    )

    foreach ($procId in $pids) {
        if ($procId) {
            Write-Host "Stopping $Label on port $CheckPort (PID=$procId)..."
            Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        }
    }
}

function Wait-HttpReady {
    param(
        [string]$CheckUrl,
        [int]$TimeoutSec
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $CheckUrl -UseBasicParsing -Method Get -TimeoutSec 3
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
                return $true
            }
        } catch {
        }
        Start-Sleep -Milliseconds 800
    }
    return $false
}

function Clear-FrontendBuildCache {
    param([string]$RootPath)

    $nextDir = Join-Path $RootPath "trading_dashboard\frontend\.next"
    if (Test-Path $nextDir) {
        Write-Host "Clearing frontend build cache: $nextDir"
        Remove-Item -Path $nextDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

$resolvedFrontendHost = if ($FrontendHost -in @("0.0.0.0", "*")) { Get-LocalIPv4 } else { $FrontendHost }
$resolvedApiHost = if ($ApiHost -in @("0.0.0.0", "*")) { Get-LocalIPv4 } else { $ApiHost }
$apiBaseUrl = if ([string]::IsNullOrWhiteSpace($ApiBase)) { "http://${resolvedApiHost}:$ApiPort" } else { $ApiBase }
$encodedApiBase = [System.Uri]::EscapeDataString($apiBaseUrl)
$dashboardUrl = "http://${resolvedFrontendHost}:$FrontendPort/dashboard?apiBase=$encodedApiBase"
$backendHealthUrl = "http://${resolvedApiHost}:$ApiPort/health"

if ($RestartRunning) {
    Stop-PortProcesses -CheckPort $FrontendPort -Label "dashboard frontend"
    if ($ApiPort -ne $FrontendPort) {
        Stop-PortProcesses -CheckPort $ApiPort -Label "backend API"
    }
    Start-Sleep -Milliseconds 800
    Clear-FrontendBuildCache -RootPath $ROOT
}

if (-not (Test-PortListening -CheckPort $ApiPort)) {
    Write-Host "Starting backend API on port $ApiPort..."
    $startApiScript = Join-Path $ROOT "start_backend_bg.ps1"
    if (-not (Test-Path $startApiScript)) {
        throw "start_backend_bg.ps1 not found: $startApiScript"
    }
    if ($Bootstrap) {
        & $startApiScript -Port $ApiPort -ListenHost $ApiHost -Bootstrap
    } else {
        & $startApiScript -Port $ApiPort -ListenHost $ApiHost
    }
}

if (-not (Wait-HttpReady -CheckUrl $backendHealthUrl -TimeoutSec ([Math]::Min($StartupTimeoutSec, 45)))) {
    Write-Warning "Backend did not become reachable within the expected time."
}

if (-not (Test-PortListening -CheckPort $FrontendPort)) {
    Write-Host "Starting React dashboard frontend on port $FrontendPort..."
    $startFrontendScript = Join-Path $ROOT "start_dashboard_bg.ps1"
    if (-not (Test-Path $startFrontendScript)) {
        throw "start_dashboard_bg.ps1 not found: $startFrontendScript"
    }

    if ($Bootstrap) {
        & $startFrontendScript -ApiPort $ApiPort -FrontendPort $FrontendPort -ApiHost $ApiHost -FrontendHost $FrontendHost -ApiBase $apiBaseUrl -Bootstrap -SkipBackendAutoStart
    } else {
        & $startFrontendScript -ApiPort $ApiPort -FrontendPort $FrontendPort -ApiHost $ApiHost -FrontendHost $FrontendHost -ApiBase $apiBaseUrl -SkipBackendAutoStart
    }
} else {
    Write-Host "Frontend already running on port $FrontendPort."
}

if (-not (Wait-HttpReady -CheckUrl $dashboardUrl -TimeoutSec $StartupTimeoutSec)) {
    Write-Warning "Frontend did not become reachable within $StartupTimeoutSec seconds. Opening anyway."
}

if ($OpenWindow) {
    $browser = Get-Command msedge -ErrorAction SilentlyContinue
    if (-not $browser) {
        $browser = Get-Command chrome -ErrorAction SilentlyContinue
    }

    if ($browser) {
        Start-Process -FilePath $browser.Source -ArgumentList "--app=$dashboardUrl"
    } else {
        Start-Process -FilePath $dashboardUrl
    }
} else {
    Write-Host "Dashboard is ready at: $dashboardUrl"
}
