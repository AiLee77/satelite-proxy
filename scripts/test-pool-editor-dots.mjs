#!/usr/bin/env node
/**
 * 批次 13 补验 - 池编辑器圆点尺寸对齐
 * 
 * 验证：池编辑器两种模式（指定节点/整个订阅）的圆点尺寸与样板圆点
 * （.chain-station-dot）完全一致。
 * 
 * 样板 = 链卡上每个节点名上方的小圆点（.chain-station-dot 8px×8px 无边框）
 * 目标 = 池编辑器圆点（.chain-pool-select-dot）改为相同尺寸
 * 
 * 该文件由 D:\Playwright-Portable\run-ui-tests.ps1 自动运行
 */

const { test, expect } = require("@playwright/test");

test("池编辑器圆点尺寸与样板对齐", async ({ page }) => {
  // 模拟链数据（包含节点池）
  await page.route("**/list_chains", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "chain-test123",
          name: "测试链",
          name_manual: false,
          hops: [
            { kind: "node", node_id: "node-a1b2c3d4" },
            { kind: "node", node_id: "node-e5f6g7h8" },
          ],
        },
      ]),
    })
  );

  await page.route("**/list_pools", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "pool-test456",
          name: "测试池",
          mode: "explicit",
          node_ids: ["node-a1b2c3d4"],
        },
      ]),
    })
  );

  await page.route("**/list_chain_usage", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({}),
    })
  );

  await page.route("**/list_chain_nodes", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "node-a1b2c3d4",
          name: "HK Node 1",
          protocol: "vmess",
          server: "1.2.3.4",
          port: 443,
          enabled: true,
          subscription_id: "sub-001",
          subscription_name: "Sub A",
        },
        {
          id: "node-e5f6g7h8",
          name: "US Node 2",
          protocol: "vless",
          server: "5.6.7.8",
          port: 443,
          enabled: true,
          subscription_id: "sub-001",
          subscription_name: "Sub A",
        },
      ]),
    })
  );

  await page.route("**/list_subscriptions", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "sub-001",
          name: "Sub A",
          enabled: true,
          source: { type: "url", url: "https://example.com/sub" },
          node_count: 2,
        },
      ]),
    })
  );

  await page.route("**/get_proxy_status", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        running: false,
        core_started_at: null,
        core_type: "singbox",
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
          source: "unavailable",
          proxy_upload: 0,
          proxy_download: 0,
          direct_upload: 0,
          direct_download: 0,
          unclassified_upload: 0,
          unclassified_download: 0,
        },
        memory_mb: 0,
        spark: [],
      }),
    })
  );

  await page.goto("http://localhost:1420/#/chain");
  await page.waitForSelector(".chain-card", { timeout: 5000 });

  // 1. 获取样板圆点（链卡上的 .chain-station-dot）的尺寸
  const templateDot = await page.locator(".chain-station-dot").first();
  await expect(templateDot).toBeVisible();
  const templateRect = await templateDot.boundingBox();
  expect(templateRect).not.toBeNull();

  console.log(
    `样板圆点（.chain-station-dot）: ${templateRect.width}×${templateRect.height}px`
  );

  // 样板圆点应该是 8px×8px（无边框纯实心）
  expect(templateRect.width).toBe(8);
  expect(templateRect.height).toBe(8);

  // 2. 打开第一个池的编辑器
  const poolRow = page.locator(".chain-pool-row").first();
  await poolRow.locator("button.icon-btn").last().click();
  await page.waitForSelector(".modal.rules-form-modal", { timeout: 3000 });

  // 3. 测试 explicit 模式圆点
  const explicitBtn = page.locator(".glass-seg button", {
    hasText: /指定节点|Explicit/,
  });
  await explicitBtn.click();
  await page.waitForTimeout(200);

  const explicitDot = await page
    .locator(".chain-pool-node-item .chain-pool-select-dot")
    .first();
  await expect(explicitDot).toBeVisible();
  const explicitRect = await explicitDot.boundingBox();
  expect(explicitRect).not.toBeNull();

  console.log(
    `Explicit 模式圆点: ${explicitRect.width}×${explicitRect.height}px`
  );

  // 断言：与样板完全一致
  expect(explicitRect.width).toBe(templateRect.width);
  expect(explicitRect.height).toBe(templateRect.height);

  // 4. 测试 subscription 模式圆点
  const subscriptionBtn = page.locator(".glass-seg button", {
    hasText: /整个订阅|Subscription/,
  });
  await subscriptionBtn.click();
  await page.waitForTimeout(200);

  const subscriptionDot = await page
    .locator(".chain-pool-node-item .chain-pool-select-dot")
    .first();
  await expect(subscriptionDot).toBeVisible();
  const subscriptionRect = await subscriptionDot.boundingBox();
  expect(subscriptionRect).not.toBeNull();

  console.log(
    `Subscription 模式圆点: ${subscriptionRect.width}×${subscriptionRect.height}px`
  );

  // 断言：与样板完全一致
  expect(subscriptionRect.width).toBe(templateRect.width);
  expect(subscriptionRect.height).toBe(templateRect.height);

  // 5. 验证选中状态的圆点尺寸不变
  const firstNode = page.locator(".chain-pool-node-item").first();
  await firstNode.click();
  await page.waitForTimeout(100);

  const checkedDot = await firstNode
    .locator(".chain-pool-select-dot")
    .boundingBox();
  expect(checkedDot).not.toBeNull();
  console.log(`选中状态圆点: ${checkedDot.width}×${checkedDot.height}px`);

  expect(checkedDot.width).toBe(templateRect.width);
  expect(checkedDot.height).toBe(templateRect.height);

  console.log("✓ 所有圆点尺寸与样板一致（8px×8px）");
});
