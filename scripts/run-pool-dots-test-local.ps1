$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$env:PLAYWRIGHT_BROWSERS_PATH = 'D:\Playwright-Portable\browsers'
$env:PLAYWRIGHT_MODULE = 'D:\Playwright-Portable\node_modules\playwright\index.mjs'
$env:CI = 'true'

$Project = 'D:\Gihub_Projects\satelite-proxy'
$Portable = 'D:\Playwright-Portable'
$Base = 'http://127.0.0.1:1440'

Push-Location $Portable
$server = $null
try {
  Write-Host "Starting Vite..." -ForegroundColor Cyan
  $outLog = Join-Path $Portable 'logs/vite-out.log'
  $errLog = Join-Path $Portable 'logs/vite-err.log'
  New-Item -ItemType Directory -Force -Path (Join-Path $Portable 'logs') | Out-Null
  
  $server = Start-Process node -ArgumentList @(
      (Join-Path $Project 'node_modules/vite/bin/vite.js'),
      '--host', '127.0.0.1', '--port', '1440', '--strictPort'
    ) -WorkingDirectory $Project -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $outLog -RedirectStandardError $errLog

  Write-Host "Waiting for Vite..." -ForegroundColor Yellow
  $ready = $false
  for ($i = 1; $i -le 40; $i++) {
    Start-Sleep -Milliseconds 500
    try {
      $resp = Invoke-WebRequest -Uri "$Base/ui-smoke" -TimeoutSec 2 -UseBasicParsing
      if ($resp.StatusCode -eq 200) {
        $ready = $true
        Write-Host "Vite ready" -ForegroundColor Green
        break
      }
    } catch {
      Write-Host "." -NoNewline
    }
  }
  
  if (-not $ready) {
    throw "Vite not ready"
  }
  
  Write-Host "`nRunning dot test..." -ForegroundColor Cyan
  
  $testScript = Join-Path $Project 'scripts/test-pool-dots-fixture.mjs'
  & node $testScript
  
  if ($LASTEXITCODE -ne 0) {
    throw "Test failed (exit $LASTEXITCODE)"
  }
  
  Write-Host "`nTest complete" -ForegroundColor Green
  
} finally {
  if ($server) {
    Write-Host "Closing Vite..." -ForegroundColor Yellow
    Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
  }
  Pop-Location
}
