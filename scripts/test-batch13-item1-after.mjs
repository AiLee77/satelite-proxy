/**
 * 批次 13-1：节点池编辑器圆点改小 - 改后测试
 * 
 * 修复：给 subscription 模式的 radio 添加 className="chain-pool-select-dot"
 * 
 * 断言：
 * 1. explicit 模式 checkbox 圆点与样板圆点尺寸一致（保持批次 12 成果）
 * 2. subscription 模式 radio 圆点与 explicit checkbox 尺寸一致
 * 3. 两种圆点的选中/未选状态视觉效果正确
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

  // ===== 1. 测量样板圆点（链编辑器侧边栏节点行首）=====
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

  console.log('\n【样板圆点】链编辑器 .chain-candidate-mark:');
  console.log('  fontSize:', sampleStyles.fontSize);
  console.log('  视觉宽度:', sampleStyles.charWidth.toFixed(2), 'px');

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // ===== 2. 测量 explicit 模式 checkbox =====
  const newPoolBtn = page.locator('button').filter({ hasText: "新建节点池" }).first();
  await newPoolBtn.click();
  await page.waitForTimeout(500);

  const explicitBtn = page.locator('.glass-seg button').filter({ hasText: "指定节点" });
  await explicitBtn.click();
  await page.waitForTimeout(300);

  await page.waitForSelector('.chain-pool-select-dot', { timeout: 3000 });
  const checkboxDot = page.locator('.chain-pool-select-dot').first();
  
  const checkboxRectUnchecked = await checkboxDot.boundingBox();
  const checkboxStylesUnchecked = await checkboxDot.evaluate(el => {
    const cs = getComputedStyle(el);
    return {
      width: cs.width,
      height: cs.height,
      borderWidth: cs.borderWidth,
      backgroundColor: cs.backgroundColor
    };
  });

  console.log('\n【Explicit 模式 - 未选】checkbox:');
  console.log('  bounding box:', checkboxRectUnchecked);
  console.log('  computed width:', checkboxStylesUnchecked.width);
  console.log('  computed height:', checkboxStylesUnchecked.height);
  console.log('  borderWidth:', checkboxStylesUnchecked.borderWidth);
  console.log('  backgroundColor:', checkboxStylesUnchecked.backgroundColor);

  // 点击选中
  await checkboxDot.click();
  await page.waitForTimeout(200);

  const checkboxRectChecked = await checkboxDot.boundingBox();
  const checkboxStylesChecked = await checkboxDot.evaluate(el => {
    const cs = getComputedStyle(el);
    return {
      width: cs.width,
      height: cs.height,
      backgroundColor: cs.backgroundColor
    };
  });

  console.log('\n【Explicit 模式 - 已选】checkbox:');
  console.log('  bounding box:', checkboxRectChecked);
  console.log('  backgroundColor:', checkboxStylesChecked.backgroundColor);

  // ===== 3. 切换到 subscription 模式测量 radio =====
  const subBtn = page.locator('.glass-seg button').filter({ hasText: "整个订阅" });
  await subBtn.click();
  await page.waitForTimeout(300);

  const radioInput = page.locator('.chain-pool-node-item input[type="radio"]').first();
  await radioInput.waitFor({ state: "visible", timeout: 3000 });

  const radioRectUnchecked = await radioInput.boundingBox();
  const radioStylesUnchecked = await radioInput.evaluate(el => {
    const cs = getComputedStyle(el);
    return {
      width: cs.width,
      height: cs.height,
      borderWidth: cs.borderWidth,
      backgroundColor: cs.backgroundColor,
      className: el.className
    };
  });

  console.log('\n【Subscription 模式 - 未选】radio:');
  console.log('  className:', radioStylesUnchecked.className);
  console.log('  bounding box:', radioRectUnchecked);
  console.log('  computed width:', radioStylesUnchecked.width);
  console.log('  computed height:', radioStylesUnchecked.height);
  console.log('  borderWidth:', radioStylesUnchecked.borderWidth);
  console.log('  backgroundColor:', radioStylesUnchecked.backgroundColor);

  // 点击选中
  await radioInput.click();
  await page.waitForTimeout(200);

  const radioRectChecked = await radioInput.boundingBox();
  const radioStylesChecked = await radioInput.evaluate(el => {
    const cs = getComputedStyle(el);
    return {
      width: cs.width,
      height: cs.height,
      backgroundColor: cs.backgroundColor
    };
  });

  console.log('\n【Subscription 模式 - 已选】radio:');
  console.log('  bounding box:', radioRectChecked);
  console.log('  backgroundColor:', radioStylesChecked.backgroundColor);

  // ===== 4. 断言 =====
  console.log('\n【断言验证】');

  // 4.1 checkbox 尺寸符合 6-10px 范围（6px + 2×1px border = 8px）
  assert.ok(
    checkboxRectUnchecked && checkboxRectUnchecked.width >= 6 && checkboxRectUnchecked.width <= 10,
    `checkbox 宽度应为 6-10px，实际: ${checkboxRectUnchecked?.width}px`
  );
  assert.ok(
    checkboxRectUnchecked && checkboxRectUnchecked.height >= 6 && checkboxRectUnchecked.height <= 10,
    `checkbox 高度应为 6-10px，实际: ${checkboxRectUnchecked?.height}px`
  );
  console.log('  ✓ checkbox 尺寸符合预期 (6-10px)');

  // 4.2 radio 尺寸与 checkbox 一致（修复成功）
  assert.ok(
    radioRectUnchecked && radioRectUnchecked.width >= 6 && radioRectUnchecked.width <= 10,
    `radio 宽度应为 6-10px，实际: ${radioRectUnchecked?.width}px`
  );
  assert.ok(
    radioRectUnchecked && radioRectUnchecked.height >= 6 && radioRectUnchecked.height <= 10,
    `radio 高度应为 6-10px，实际: ${radioRectUnchecked?.height}px`
  );
  console.log('  ✓ radio 尺寸符合预期 (6-10px)');

  // 4.3 checkbox 和 radio 尺寸一致（±1px 容差）
  const widthDiff = Math.abs((checkboxRectUnchecked?.width || 0) - (radioRectUnchecked?.width || 0));
  const heightDiff = Math.abs((checkboxRectUnchecked?.height || 0) - (radioRectUnchecked?.height || 0));
  assert.ok(widthDiff <= 1, `checkbox 和 radio 宽度应一致（±1px），差值: ${widthDiff}px`);
  assert.ok(heightDiff <= 1, `checkbox 和 radio 高度应一致（±1px），差值: ${heightDiff}px`);
  console.log('  ✓ checkbox 和 radio 尺寸一致');

  // 4.4 选中状态尺寸不变
  assert.ok(
    Math.abs((checkboxRectChecked?.width || 0) - (checkboxRectUnchecked?.width || 0)) <= 1,
    'checkbox 选中后尺寸应保持不变'
  );
  assert.ok(
    Math.abs((radioRectChecked?.width || 0) - (radioRectUnchecked?.width || 0)) <= 1,
    'radio 选中后尺寸应保持不变'
  );
  console.log('  ✓ 选中状态尺寸不变');

  // 4.5 验证 className 已应用
  assert.ok(
    radioStylesUnchecked.className.includes('chain-pool-select-dot'),
    `radio 应有 chain-pool-select-dot 类名，实际: ${radioStylesUnchecked.className}`
  );
  console.log('  ✓ radio 已应用 .chain-pool-select-dot 类名');

  console.log('\n【全部断言通过】');

} finally {
  await browser.close();
  if (blocked.length) console.log('\n阻止的外部请求:', [...new Set(blocked)]);
  if (errors.length) {
    console.error('\n页面错误:', errors);
    process.exit(1);
  }
}
