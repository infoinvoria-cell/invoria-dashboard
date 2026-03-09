param(
    [int]$Port = 8000,
    [string]$ListenHost = "127.0.0.1",
    [switch]$Bootstrap
)

$ErrorActionPreference = "Stop"

$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ROOT

$venvCandidates = @(
    (Join-Path $ROOT ".venv"),
    (Join-Path $ROOT ".venv_new")
)

$VENV_DIR = $null
foreach ($candidate in $venvCandidates) {
    $activatePath = Join-Path $candidate "Scripts\Activate.ps1"
    if (Test-Path $activatePath) {
        $VENV_DIR = $candidate
        break
    }
}

if (-not $VENV_DIR) {
    $VENV_DIR = Join-Path $ROOT ".venv"
    Write-Host "No virtual environment found. Creating $VENV_DIR ..."
    python -m venv $VENV_DIR
}

$PYTHON_EXE = Join-Path $VENV_DIR "Scripts\python.exe"
$BOOTSTRAP_STAMP = Join-Path $VENV_DIR ".invoria_bootstrapped"

if (-not (Test-Path $PYTHON_EXE)) {
    throw "Python executable not found in virtual environment: $PYTHON_EXE"
}

$needsBootstrap = $Bootstrap -or -not (Test-Path $BOOTSTRAP_STAMP)
if ($needsBootstrap) {
    Write-Host "Installing backend dependencies..."
    & $PYTHON_EXE -m pip install --upgrade pip

    if (Test-Path (Join-Path $ROOT "requirements.txt")) {
        & $PYTHON_EXE -m pip install -r requirements.txt
    }
    if (Test-Path (Join-Path $ROOT "backend\requirements.txt")) {
        & $PYTHON_EXE -m pip install -r backend\requirements.txt
    }
    if (Test-Path (Join-Path $ROOT "pyproject.toml")) {
        & $PYTHON_EXE -m pip install -e .
    }

    New-Item -Path $BOOTSTRAP_STAMP -ItemType File -Force | Out-Null
}

try {
    & $PYTHON_EXE -c "import fastapi, uvicorn" 1>$null 2>$null
    $depExit = $LASTEXITCODE
} catch {
    $depExit = 1
}

if ($depExit -ne 0) {
    Write-Host "Backend dependencies missing. Installing FastAPI stack..."
    if (Test-Path (Join-Path $ROOT "backend\requirements.txt")) {
        & $PYTHON_EXE -m pip install -r backend\requirements.txt
    } else {
        & $PYTHON_EXE -m pip install "fastapi>=0.100" "uvicorn[standard]>=0.20"
    }
}

Write-Host "Starting FastAPI backend on http://${ListenHost}:$Port"
& $PYTHON_EXE -m uvicorn api:app --host $ListenHost --port $Port
