#!/usr/bin/env pwsh
# 圆点专项返修测试 - 对比编辑节点池圆点与链卡样板圆点的实际渲染尺寸
$ErrorActionPreference = 'Stop'

Write-Host "启动浏览器测试..." -ForegroundColor Cyan

# 使用 Playwright portable 的 Node
$playwrightNode = "D:\Playwright-Portable\node.exe"
$testScript = Join-Path $PSScriptRoot "test-pool-dots-impl.mjs"

if (-not (Test-Path $playwrightNode)) {
    throw "未找到 Playwright portable Node: $playwrightNode"
}

# 设置环境变量指向 Playwright 模块
$env:PLAYWRIGHT_MODULE = "D:\Playwright-Portable\node_modules\playwright"

& $playwrightNode $testScript
if ($LASTEXITCODE -ne 0) {
    throw "测试脚本执行失败"
}

Write-Host "`n✅ 测试完成" -ForegroundColor Green
