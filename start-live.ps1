param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $root
try {
    $python = Join-Path $root '.venv\Scripts\python.exe'
    if (-not (Test-Path -LiteralPath $python)) {
        $systemPython = Get-Command python -ErrorAction SilentlyContinue
        if (-not $systemPython) {
            $bundledPython = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
            if (Test-Path -LiteralPath $bundledPython) { $pythonBootstrap = $bundledPython }
            else { throw 'Please install Python 3.10+ and run start.bat again.' }
        } else { $pythonBootstrap = $systemPython.Source }
        & $pythonBootstrap -m venv .venv
        if ($LASTEXITCODE -ne 0) { throw 'Unable to create Python environment.' }
    }
    & $python -c "import importlib.util,sys; sys.exit(0 if all(importlib.util.find_spec(name) for name in ('fastapi','uvicorn','pydantic')) else 1)"
    if ($LASTEXITCODE -ne 0) {
        & $python -m pip install -r requirements.txt
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed. Check network and retry.' }
    }
    if (-not (Test-Path -LiteralPath (Join-Path $root '.env'))) {
        Copy-Item -LiteralPath (Join-Path $root '.env.example') -Destination (Join-Path $root '.env')
        Write-Host 'Configure SENOIOT_ACCOUNT and SENOIOT_PASSWORD in .env to enable live readings.'
    }
    if ($NoBrowser) { & $python -m backend.run --no-browser }
    else { & $python -m backend.run }
    $serverExit = $LASTEXITCODE
} finally { Pop-Location }
exit $serverExit
