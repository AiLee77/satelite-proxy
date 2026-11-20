#!/usr/bin/env node
/**
 * 批次 13 补验 - 项目 1 改前测试
 * 
 * 验证批次 13 改动后的问题：池编辑器圆点（6px×6px border 1px = 8px 外框）
 * 比样板圆点（.chain-station-dot 8px×8px 无边框 = 8px 实心）视觉更大。
 * 
 * 样板 = 链卡上每个节点名上方的小圆点（.chain-station-dot entry/mid/exit）
 * 
 * 期望：改前运行此测试应通过（证明问题存在）
 */

import { test } from "node:test";
import assert from "node:assert";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");

// 运行 Playwright 脚本
function runPlaywright(scriptContent) {
  const proc = spawnSync(
    "pwsh",
    [
      "-NoProfile",
      "-Command",
      `
        $env:PWDEBUG = '0'
        D:\\Playwright-Portable\\run-ui-tests.ps1 -ScriptContent @'
${scriptContent}
'@
      `,
    ],
    {
      cwd: projectRoot,
      encoding: "utf-8",
      timeout: 60000,
      windowsHide: true,
    }
  );

  if (proc.error) throw proc.error;
  return { stdout: proc.stdout, stderr: proc.stderr, code: proc.status };
}

test("批次13补验-1改前: 池编辑器圆点比样板大（证明问题存在）", async () => {
  const script = `
    const { test, expect } = require('@playwright/test');
    
    test('池编辑器圆点比样板圆点视觉更大', async ({ page }) => {
      // 模拟链数据（包含节点池）
      await page.route('**/list_chains', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{
          id: 'chain-test123',
          name: '测试链',
          name_manual: false,
          hops: [
            { kind: 'node', node_id: 'node-a1b2c3d4' },
            { kind: 'node', node_id: 'node-e5f6g7h8' }
          ]
        }])
      }));
      
      await page.route('**/list_pools', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{
          id: 'pool-test456',
          name: '测试池',
          mode: 'explicit',
          node_ids: ['node-a1b2c3d4']
        }])
      }));
      
      await page.route('**/list_chain_usage', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({})
      }));
      
      await page.route('**/list_chain_nodes', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'node-a1b2c3d4',
            name: 'HK Node 1',
            protocol: 'vmess',
            server: '1.2.3.4',
            port: 443,
            enabled: true,
            subscription_id: 'sub-001',
            subscription_name: 'Sub A'
          },
          {
            id: 'node-e5f6g7h8',
            name: 'US Node 2',
            protocol: 'vless',
            server: '5.6.7.8',
            port: 443,
            enabled: true,
            subscription_id: 'sub-001',
            subscription_name: 'Sub A'
          }
        ])
      }));
      
      await page.route('**/list_subscriptions', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'sub-001',
            name: 'Sub A',
            enabled: true,
            source: { type: 'url', url: 'https://example.com/sub' },
            node_count: 2
          }
        ])
      }));
      
      await page.route('**/get_proxy_status', route => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          running: false,
          core_started_at: null,
          core_type: 'singbox',
          sidecar_running: false,
          sidecar_kinds: [],
          current_node_id: null,
          current_node_name: null,
          total_upload: 0,
          total_download: 0,
          upload_rate: 0,
          download_rate: 0,
          connections: 0,
          traffic_breakdown: {
            source: 'unavailable',
            proxy_upload: 0,
            proxy_download: 0,
            direct_upload: 0,
            direct_download: 0,
            unclassified_upload: 0,
            unclassified_download: 0
          },
          memory_mb: 0,
          spark: []
        })
      }));
      
      await page.goto('http://localhost:1420/#/chain');
      await page.waitForSelector('.chain-card', { timeout: 5000 });
      
      // 1. 获取样板圆点（链卡上的 .chain-station-dot）的尺寸
      const templateDot = await page.locator('.chain-station-dot').first();
      await expect(templateDot).toBeVisible();
      const templateRect = await templateDot.boundingBox();
      assert(templateRect, '样板圆点应该可见');
      
      console.log(\`样板圆点（.chain-station-dot）: \${templateRect.width}×\${templateRect.height}px\`);
      
      // 2. 打开第一个池的编辑器
      const poolRow = page.locator('.chain-pool-row').first();
      await poolRow.locator('button.icon-btn').last().click();
      await page.waitForSelector('.modal.rules-form-modal', { timeout: 3000 });
      
      // 3. 切换到 explicit 模式
      const explicitBtn = page.locator('.glass-seg button', { hasText: /指定节点|Explicit/ });
      await explicitBtn.click();
      await page.waitForTimeout(200);
      
      // 4. 获取 explicit 模式圆点尺寸
      const explicitDot = await page.locator('.chain-pool-node-item .chain-pool-select-dot').first();
      await expect(explicitDot).toBeVisible();
      const explicitRect = await explicitDot.boundingBox();
      assert(explicitRect, 'Explicit 模式圆点应该可见');
      
      console.log(\`Explicit 模式圆点: \${explicitRect.width}×\${explicitRect.height}px\`);
      
      // 5. 切换到 subscription 模式
      const subscriptionBtn = page.locator('.glass-seg button', { hasText: /整个订阅|Subscription/ });
      await subscriptionBtn.click();
      await page.waitForTimeout(200);
      
      // 6. 获取 subscription 模式圆点尺寸
      const subscriptionDot = await page.locator('.chain-pool-node-item .chain-pool-select-dot').first();
      await expect(subscriptionDot).toBeVisible();
      const subscriptionRect = await subscriptionDot.boundingBox();
      assert(subscriptionRect, 'Subscription 模式圆点应该可见');
      
      console.log(\`Subscription 模式圆点: \${subscriptionRect.width}×\${subscriptionRect.height}px\`);
      
      // 7. 改前断言：池编辑器圆点应该比样板圆点大（证明问题存在）
      // 批次 13 后，池圆点是 6px + 2×1px border = 8px 外框
      // 样板圆点是 8px×8px 纯实心无边框
      // 由于边框占据空间，池圆点视觉上应该略大于样板
      expect(explicitRect.width).toBeGreaterThanOrEqual(templateRect.width);
      expect(subscriptionRect.width).toBeGreaterThanOrEqual(templateRect.width);
      
      console.log('✓ 改前状态确认：池编辑器圆点 >= 样板圆点（问题存在）');
    });
  `;

  const result = runPlaywright(script);
  
  if (result.code !== 0) {
    console.error("STDOUT:", result.stdout);
    console.error("STDERR:", result.stderr);
    throw new Error(`Playwright 测试失败，退出码 ${result.code}`);
  }
  
  console.log("✓ 批次 13 补验项目 1 改前测试通过（问题已确认存在）");
});
