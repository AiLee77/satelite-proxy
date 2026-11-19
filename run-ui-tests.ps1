# Local UI browser regression entry: same mock path as the
# "rules sidebar browser regression" step in build-windows.yml -
# installs playwright@1.55.0 into .ui-test-deps (gitignored cache),
# serves the ui-smoke fixtures via vite on 127.0.0.1:1440, then runs the
# ten browser scripts in CI order. Fixtures only use simulated IPC:
# no real Satelite instance, no cores, no user data.
# Usage:  powershell -File run-ui-tests.ps1 [-Filter <script-substring>]
param(
  [string]$Filter = ""
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
Set-Location $root

# Browser scripts gate on the CI flag ("CI only"); setting it locally is the
# explicit declaration that we run the mock fixture path.
$env:CI = "true"

$deps = Join-Path $root ".ui-test-deps"
$playwrightModule = Join-Path $deps "node_modules/playwright/index.mjs"
if (-not (Test-Path $playwrightModule)) {
  Write-Host "==> Installing playwright@1.55.0 into .ui-test-deps ..."
  npm install --prefix $deps --no-audit --no-fund playwright@1.55.0
  if ($LASTEXITCODE -ne 0) { throw "playwright install failed" }
  node (Join-Path $deps "node_modules/playwright/cli.js") install chromium
  if ($LASTEXITCODE -ne 0) { throw "chromium download failed" }
}
$env:PLAYWRIGHT_MODULE = $playwrightModule

$tests = @(
  "test-rules-sidebar.mjs",
  "test-node-delete-browser.mjs",
  "test-mihomo-groups-browser.mjs",
  "test-xray-latency-browser.mjs",
  "test-qr-import-browser.mjs",
  "test-traffic-stats-browser.mjs",
  "test-core-selection-browser.mjs",
  "test-config-activation-browser.mjs",
  "test-dashboard-browser.mjs",
  "test-traffic-table-browser.mjs"
)
if ($Filter) { $tests = $tests | Where-Object { $_ -like "*$Filter*" } }

Write-Host "==> Starting vite dev server (127.0.0.1:1440) ..."
$server = Start-Process node -ArgumentList @('node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '1440', '--strictPort') -WindowStyle Hidden -PassThru
$pass = 0; $fail = 0; $failed = @()
try {
  $ready = $false
  for ($i = 0; $i -lt 30; $i++) {
    try {
      Invoke-WebRequest 'http://127.0.0.1:1440/scripts/ui-smoke/index.html' -UseBasicParsing > $null
      $ready = $true; break
    } catch { Start-Sleep -Seconds 1 }
  }
  if (-not $ready) { throw "UI test server not ready" }

  foreach ($t in $tests) {
    Write-Host ""
    Write-Host "==> node scripts/$t"
    node (Join-Path "scripts" $t)
    if ($LASTEXITCODE -eq 0) {
      $pass++
      Write-Host "    [PASS] $t"
    } else {
      $fail++
      $failed += $t
      Write-Host "    [FAIL] $t" -ForegroundColor Red
    }
  }
} finally {
  Stop-Process -Id $server.Id -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "==> UI browser regression: $pass/$($tests.Count) passed"
if ($fail -gt 0) {
  Write-Host "    failed: $($failed -join ', ')" -ForegroundColor Red
  exit 1
}
