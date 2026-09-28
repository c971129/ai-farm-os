$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Push-Location $root
try {
  $jsFiles = Get-ChildItem -LiteralPath (Join-Path $root "frontend\assets") -Filter "*.js" -File
  foreach ($file in $jsFiles) {
    & node --check $file.FullName
    if ($LASTEXITCODE -ne 0) { throw "JavaScript syntax failed: $($file.Name)" }
  }

  & python -m compileall -q backend
  if ($LASTEXITCODE -ne 0) { throw "Python compile check failed" }

  # Windows PowerShell 5.1 otherwise decodes this UTF-8/no-BOM script with the
  # active ANSI code page, which can corrupt CJK strings before syntax parsing.
  $null = [scriptblock]::Create((Get-Content -LiteralPath (Join-Path $root "start-web.ps1") -Raw -Encoding UTF8))

  & python -m pytest -q
  if ($LASTEXITCODE -ne 0) { throw "Pytest failed" }

  & node --test tests/js/telemetry.test.js
  if ($LASTEXITCODE -ne 0) { throw "Telemetry JavaScript tests failed" }
  $null = [scriptblock]::Create((Get-Content -LiteralPath (Join-Path $root "start-live.ps1") -Raw -Encoding UTF8))

  Write-Host "All verification gates passed." -ForegroundColor Green
}
finally {
  Pop-Location
}
