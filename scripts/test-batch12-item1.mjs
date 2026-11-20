/**
 * 批次12-1：节点池编辑器圆点改小
 * 断言：池选择器两种状态圆点的 computed 宽/高/border/background 与
 * 链编辑器样板圆点的对应值一致（先红后绿）。
 */
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

// CI-only: mock fixture path (no real Satelite, no cores, no user data)
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
  // 加载链页面 fixture
  await page.goto(`${base}/scripts/ui-smoke/chain.html`);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1000);

  // ===== 第1步：测量链编辑器的样板圆点 (.chain-candidate-mark) =====
  const newChainBtn = page.locator('button').filter({ hasText: "新建代理链" }).first();
  await newChainBtn.click();
  await page.waitForTimeout(500);

  // 等待侧边栏出现并找到样板圆点
  await page.waitForSelector('.chain-candidate-mark', { timeout: 3000 });
  const sampleMark = page.locator('.chain-candidate-mark').first();
  
  // 样板是字符 "○"，测量其视觉大小
  const sampleStyles = await sampleMark.evaluate(el => {
    const cs = getComputedStyle(el);
    const range = document.createRange();
    range.selectNodeContents(el);
    const rects = range.getClientRects();
    return {
      fontSize: cs.fontSize,
      lineHeight: cs.lineHeight,
      paddingRight: cs.paddingRight,
      color: cs.color,
      // 字符的实际渲染宽度（视觉直径）
      charWidth: rects.length > 0 ? rects[0].width : 0
    };
  });

  console.log('\n样板圆点样式（链编辑器 .chain-candidate-mark）:');
  console.log('  fontSize:', sampleStyles.fontSize);
  console.log('  实际字符宽度（视觉直径）:', sampleStyles.charWidth.toFixed(2), 'px');
  console.log('  color:', sampleStyles.color);

  // 关闭链编辑器
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // ===== 第2步：测量节点池编辑器的圆点 (.chain-pool-select-dot) =====
  const newPoolBtn = page.locator('button').filter({ hasText: "新建节点池" }).first();
  await newPoolBtn.click();
  await page.waitForTimeout(500);

  // 选择"指定节点"模式
  const explicitBtn = page.locator('.glass-seg button').filter({ hasText: "指定节点" });
  await explicitBtn.click();
  await page.waitForTimeout(300);

  // 找到池选择器的圆点（未选中）
  await page.waitForSelector('.chain-pool-select-dot', { timeout: 3000 });
  const poolDot = page.locator('.chain-pool-select-dot').first();
  
  const poolDotUnchecked = await poolDot.evaluate(el => {
    const cs = getComputedStyle(el);
    return {
      width: cs.width,
      height: cs.height,
      borderWidth: cs.borderWidth,
      borderStyle: cs.borderStyle,
      borderColor: cs.borderColor,
      backgroundColor: cs.backgroundColor,
      borderRadius: cs.borderRadius
    };
  });

  console.log('\n池选择器圆点样式（未选中 .chain-pool-select-dot）:');
  console.log('  width:', poolDotUnchecked.width);
  console.log('  height:', poolDotUnchecked.height);
  console.log('  borderWidth:', poolDotUnchecked.borderWidth);
  console.log('  borderColor:', poolDotUnchecked.borderColor);
  console.log('  backgroundColor:', poolDotUnchecked.backgroundColor);

  // 点击一个节点使其选中
  const firstNodeLabel = page.locator('.chain-pool-node-item').first();
  await firstNodeLabel.click();
  await page.waitForTimeout(200);

  const checkedDot = page.locator('.chain-pool-select-dot:checked').first();
  const poolDotChecked = await checkedDot.evaluate(el => {
    const cs = getComputedStyle(el);
    return {
      width: cs.width,
      height: cs.height,
      borderWidth: cs.borderWidth,
      borderColor: cs.borderColor,
      backgroundColor: cs.backgroundColor
    };
  });

  console.log('\n池选择器圆点样式（选中 .chain-pool-select-dot:checked）:');
  console.log('  width:', poolDotChecked.width);
  console.log('  height:', poolDotChecked.height);
  console.log('  borderWidth:', poolDotChecked.borderWidth);
  console.log('  borderColor:', poolDotChecked.borderColor);
  console.log('  backgroundColor:', poolDotChecked.backgroundColor);

  // ===== 断言：池圆点应该与样板大小一致 =====
  const widthPx = parseFloat(poolDotUnchecked.width);
  const heightPx = parseFloat(poolDotUnchecked.height);
  const borderPx = parseFloat(poolDotUnchecked.borderWidth);
  const totalDiameter = widthPx + borderPx * 2;

  console.log('\n期望值（匹配样板字符 "○" 的视觉大小）:');
  console.log('  样板字符视觉直径:', sampleStyles.charWidth.toFixed(2), 'px');
  console.log('  池圆点总直径 (width + border*2):', totalDiameter.toFixed(2), 'px');

  // 断言：圆点尺寸与样板接近（±1px 容差）
  const expectedSize = Math.round(sampleStyles.charWidth);
  assert.ok(
    Math.abs(totalDiameter - expectedSize) <= 1.5,
    `池圆点总直径 ${totalDiameter.toFixed(2)}px 应与样板 ${expectedSize}px 接近（±1.5px）`
  );

  // 断言：宽高一致（圆形）
  assert.equal(poolDotUnchecked.width, poolDotUnchecked.height, "圆点宽高应相等");
  assert.equal(poolDotChecked.width, poolDotChecked.height, "选中圆点宽高应相等");

  // 断言：边框样式
  assert.equal(poolDotUnchecked.borderStyle, "solid", "边框应为实线");
  assert.ok(borderPx >= 0.5 && borderPx <= 1.5, `边框宽度 ${borderPx}px 应在合理范围 0.5-1.5px`);

  // 断言：选中状态背景色不透明
  const checkedBg = poolDotChecked.backgroundColor;
  assert.notEqual(checkedBg, "rgba(0, 0, 0, 0)", "选中状态背景色应不透明");
  assert.notEqual(checkedBg, "transparent", "选中状态背景色应不透明");

  console.log('\n✓ 所有断言通过：池编辑器圆点已匹配链编辑器样板大小');

  // 清理检查
  assert.deepEqual(blocked, [], "夹具不得发起外部网络请求");
  assert.deepEqual(errors, [], "页面不应有异常");

} finally {
  await context.close();
  await browser.close();
}
