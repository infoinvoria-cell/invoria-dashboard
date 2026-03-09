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

$RUN_SCRIPT = Join-Path $ROOT "run_dashboard.ps1"
if (-not (Test-Path $RUN_SCRIPT)) {
    throw "run_dashboard.ps1 not found: $RUN_SCRIPT"
}

$argList = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", "`"$RUN_SCRIPT`"",
    "-ApiPort", "$ApiPort",
    "-FrontendPort", "$FrontendPort",
    "-ApiHost", "$ApiHost",
    "-FrontendHost", "$FrontendHost"
)
if ($ApiBase) {
    $argList += "-ApiBase"
    $argList += "$ApiBase"
}
if ($Bootstrap) {
    $argList += "-Bootstrap"
}
if ($SkipBackendAutoStart) {
    $argList += "-SkipBackendAutoStart"
}

$proc = Start-Process -FilePath "powershell.exe" -ArgumentList $argList -WorkingDirectory $ROOT -PassThru

Write-Host "Started dashboard frontend in background (PID=$($proc.Id))"
Write-Host "URL: http://${FrontendHost}:$FrontendPort"
