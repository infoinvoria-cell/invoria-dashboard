param(
    [int]$Port = 8000,
    [string]$ListenHost = "127.0.0.1",
    [switch]$Bootstrap
)

$ErrorActionPreference = "Stop"

$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ROOT

$RUN_SCRIPT = Join-Path $ROOT "run_backend_api.ps1"
if (-not (Test-Path $RUN_SCRIPT)) {
    throw "run_backend_api.ps1 not found: $RUN_SCRIPT"
}

$argList = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", "`"$RUN_SCRIPT`"",
    "-Port", "$Port",
    "-ListenHost", "$ListenHost"
)
if ($Bootstrap) {
    $argList += "-Bootstrap"
}

$proc = Start-Process -FilePath "powershell.exe" -ArgumentList $argList -WorkingDirectory $ROOT -PassThru

Write-Host "Started backend API in background (PID=$($proc.Id))"
Write-Host "URL: http://${ListenHost}:$Port"
