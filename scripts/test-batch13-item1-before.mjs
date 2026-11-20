/**
 * 批次 13-1 改前测试：节点池编辑器圆点问题诊断
 * 
 * 根因：批次 12 修改了 .chain-pool-select-dot (6px×6px border 1px)，
 * 但该类名仅应用于 explicit 模式的 checkbox。
 * subscription 模式的 radio 按钮**没有该类名**，使用浏览器默认样式（约 13-16px）。
 * 
 * 本测试预期在改前失败（subscription 圆点过大）。
 */
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

if (process.env.CI !== "true") throw new Error("此浏览器测试仅允许在 CI 运行");
if (!process.env.PLAYWRIGHT_MODULE) throw new Error("缺少 PLAYWRIGHT_MODULE");
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);

const base = "http://127.0.0.1:1440";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  serviceWorkers: "block"
});

let blocked = [];
await context.route("**/*", route => {
  const url = new URL(route.request().url());
  if (url.origin === base) return route.continue();
  blocked.push(url.origin);
  return route.abort();
});

const page = await context.newPage();
let errors = [];
page.on("pageerror", err => errors.push(err.message));

try {
  await page.goto(`${base}/scripts/ui-smoke/chain.html`);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1000);

  // ===== 测量样板圆点（链编辑器侧边栏节点行首）=====
  const newChainBtn = page.locator('button').filter({ hasText: "新建代理链" }).first();
  await newChainBtn.click();
  await page.waitForTimeout(500);

  await page.waitForSelector('.chain-candidate-mark', { timeout: 3000 });
  const sampleMark = page.locator('.chain-candidate-mark').first();
  
  const sampleStyles = await sampleMark.evaluate(el => {
    const cs = getComputedStyle(el);
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = range.getClientRects();
    return {
      fontSize: cs.fontSize,
      charWidth: rects.length > 0 ? rects[0].width : 0
    };
  });

  console.log('\n【样板圆点】链编辑器 .chain-candidate-mark（字符 ○/●）:');
  console.log('  fontSize:', sampleStyles.fontSize);
  console.log('  视觉宽度:', sampleStyles.charWidth.toFixed(2), 'px');

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // ===== 测量池编辑器 explicit 模式（checkbox，已应用样式）=====
  const newPoolBtn = page.locator('button').filter({ hasText: "新建节点池" }).first();
  await newPoolBtn.click();
  await page.waitForTimeout(500);

  const explicitBtn = page.locator('.glass-seg button').filter({ hasText: "指定节点" });
  await explicitBtn.click();
  await page.waitForTimeout(300);

  await page.waitForSelector('.chain-pool-select-dot', { timeout: 3000 });
  const checkboxDot = page.locator('.chain-pool-select-dot').first();
  
  const checkboxRect = await checkboxDot.boundingBox();
  const checkboxStyles = await checkboxDot.evaluate(el => {
    const cs = getComputedStyle(el);
    return {
      width: cs.width,
      height: cs.height,
      borderWidth: cs.borderWidth,
      className: el.className,
      tagName: el.tagName,
      type: el.type
    };
  });

  console.log('\n【Explicit 模式】.chain-pool-select-dot (type=checkbox, 已应用样式):');
  console.log('  className:', checkboxStyles.className);
  console.log('  type:', checkboxStyles.type);
  console.log('  computed width:', checkboxStyles.width);
  console.log('  computed height:', checkboxStyles.height);
  console.log('  computed borderWidth:', checkboxStyles.borderWidth);
  console.log('  bounding box:', checkboxRect);

  // explicit 模式应该已是 6px + 2×1px = 8px
  assert.ok(
    checkboxRect && checkboxRect.width >= 6 && checkboxRect.width <= 10,
    `explicit 模式圆点应为 6-10px，实际: ${checkboxRect?.width}px`
  );

  // ===== 切换到 subscription 模式（radio，问题所在）=====
  const subBtn = page.locator('.glass-seg button').filter({ hasText: "整个订阅" });
  await subBtn.click();
  await page.waitForTimeout(300);

  // 找到 radio 按钮
  const radioInput = page.locator('.chain-pool-node-item input[type="radio"]').first();
  await radioInput.waitFor({ state: "visible", timeout: 3000 });

  const radioRect = await radioInput.boundingBox();
  const radioStyles = await radioInput.evaluate(el => {
    const cs = getComputedStyle(el);
    return {
      width: cs.width,
      height: cs.height,
      borderWidth: cs.borderWidth,
      className: el.className,
      tagName: el.tagName,
      type: el.type,
      appearance: cs.appearance || cs.webkitAppearance || 'auto'
    };
  });

  console.log('\n【Subscription 模式】input[type="radio"] (改前，问题所在):');
  console.log('  className:', radioStyles.className);
  console.log('  type:', radioStyles.type);
  console.log('  computed width:', radioStyles.width);
  console.log('  computed height:', radioStyles.height);
  console.log('  computed borderWidth:', radioStyles.borderWidth);
  console.log('  computed appearance:', radioStyles.appearance);
  console.log('  bounding box:', radioRect);

  // 改前：radio 应该使用浏览器默认样式（约 13-16px）
  // 这里断言它比目标 8px 大，说明问题存在
  console.log('\n【根因验证】subscription 模式 radio 圆点过大:');
  console.log('  预期: 应与 checkbox (6-10px) 或样板圆点 (~12-13px) 接近');
  console.log('  实际:', radioRect?.width, 'px');
  console.log('  结论: radio 未应用 .chain-pool-select-dot 样式，使用浏览器默认');

  // 改前应该失败（radio 过大）
  try {
    assert.ok(
      radioRect && radioRect.width >= 6 && radioRect.width <= 10,
      `subscription 模式圆点应为 6-10px（改后），实际: ${radioRect?.width}px`
    );
    console.log('\n【意外】radio 圆点已经正确（可能已修复？）');
  } catch (err) {
    console.log('\n【预期】radio 圆点过大（改前状态确认）:', err.message);
    throw err; // 改前测试预期失败
  }

} finally {
  await browser.close();
  if (blocked.length) console.log('\n阻止的外部请求:', [...new Set(blocked)]);
  if (errors.length) {
    console.error('\n页面错误:', errors);
    process.exit(1);
  }
}
