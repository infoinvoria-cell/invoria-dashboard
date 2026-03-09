param(
    [string]$ShortcutName = "Invoria Dashboard.lnk",
    [int]$ApiPort = 8000,
    [int]$FrontendPort = 3000
)

$ErrorActionPreference = "Stop"

$ROOT = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$scriptPath = Join-Path $ROOT "scripts\start-dashboard.ps1"
if (-not (Test-Path $scriptPath)) {
    throw "start-dashboard.ps1 not found: $scriptPath"
}

# Generate a custom .ico file (fallback to default if generation fails)
$iconSource = Join-Path $ROOT "frontend\public\invoria_icon.png"
$iconTarget = Join-Path $ROOT "invoria_dashboard.ico"
if ((-not (Test-Path $iconTarget)) -and (Test-Path $iconSource)) {
    try {
        Add-Type -AssemblyName System.Drawing
        $bitmap = [System.Drawing.Bitmap]::FromFile($iconSource)
        $icon = [System.Drawing.Icon]::FromHandle($bitmap.GetHicon())
        $stream = [System.IO.File]::Create($iconTarget)
        $icon.Save($stream)
        $stream.Close()
        $icon.Dispose()
        $bitmap.Dispose()
        Write-Host "Generated icon file: $iconTarget"
    } catch {
        Write-Warning "Failed to generate .ico from PNG: $_"
    }
}

$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktop $ShortcutName

$wshShell = New-Object -ComObject WScript.Shell
$shortcut = $wshShell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "powershell.exe"
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$scriptPath`" -ApiPort $ApiPort -FrontendPort $FrontendPort -ApiHost 127.0.0.1 -FrontendHost 127.0.0.1 -OpenWindow"
$shortcut.WorkingDirectory = $ROOT
$iconLocation = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe,0"
if (Test-Path $iconTarget) {
    $iconLocation = $iconTarget
}
$shortcut.IconLocation = $iconLocation
$shortcut.Description = "Startet Invoria Dashboard (Backend + Frontend)"
$shortcut.Save()

Write-Host "Desktop shortcut created:"
Write-Host $shortcutPath
