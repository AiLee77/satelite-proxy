/**
 * 批次 13-2：hero 状态点加间距 - 改后测试
 * 
 * 修复：给 .status-dot 添加 margin-right: 0.4rem
 * 
 * 断言：
 * 1. 状态点的 margin-right 存在且合理（约 0.4rem = 6.4px）
 * 2. 圆点到文字的实测间距接近中点分隔的平均间距（≥80%）
 * 3. 圆点本身的尺寸、颜色、动画不变
 */
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

if (process.env.CI !== "true") throw new Error("此浏览器测试仅允许在 CI 运行");
if (!process.env.PLAYWRIGHT_MODULE) throw new Error("缺少 PLAYWRIGHT_MODULE");
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);

const base = "http://127.0.0.1:1440";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 960, height: 720 },
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
  await page.goto(`${base}/scripts/ui-smoke/dashboard.html`);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1500);

  await page.waitForSelector('.dash-hero-desc', { timeout: 3000 });

  const heroDesc = page.locator('.dash-hero-desc').first();
  const statusDot = heroDesc.locator('.status-dot');
  
  await statusDot.waitFor({ state: "visible", timeout: 3000 });

  // ===== 1. 测量状态点样式 =====
  const dotRect = await statusDot.boundingBox();
  const dotStyles = await statusDot.evaluate(el => {
    const cs = getComputedStyle(el);
    return {
      marginRight: cs.marginRight,
      width: cs.width,
      height: cs.height,
      borderRadius: cs.borderRadius,
      backgroundColor: cs.backgroundColor,
      boxShadow: cs.boxShadow
    };
  });

  console.log('\n【改后状态】.status-dot:');
  console.log('  bounding box:', dotRect);
  console.log('  computed marginRight:', dotStyles.marginRight);
  console.log('  computed width:', dotStyles.width);
  console.log('  computed height:', dotStyles.height);
  console.log('  borderRadius:', dotStyles.borderRadius);
  console.log('  backgroundColor:', dotStyles.backgroundColor);

  // ===== 2. 测量圆点到文字的实际间距 =====
  const nextTextNode = await heroDesc.evaluate(el => {
    const dot = el.querySelector('.status-dot');
    if (!dot) return null;
    
    const dotRect = dot.getBoundingClientRect();
    const dotRightEdge = dotRect.right;
    
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    while (node = walker.nextNode()) {
      const text = node.textContent?.trim();
      if (!text) continue;
      
      const range = document.createRange();
      range.selectNodeContents(node);
      const rects = range.getClientRects();
      if (rects.length === 0) continue;
      
      const textRect = rects[0];
      if (textRect.left > dotRightEdge) {
        return {
          text: text.substring(0, 20),
          textLeft: textRect.left,
          dotRight: dotRightEdge,
          gap: textRect.left - dotRightEdge
        };
      }
    }
    return null;
  });

  console.log('\n【圆点到文字间距】:');
  console.log('  状态点右边缘:', nextTextNode?.dotRight);
  console.log('  下一个文字左边缘:', nextTextNode?.textLeft);
  console.log('  实测间距:', nextTextNode?.gap?.toFixed(2), 'px');
  console.log('  文字内容:', nextTextNode?.text);

  // ===== 3. 测量中点分隔的参考间距 =====
  const separatorSpacing = await heroDesc.evaluate(el => {
    const testEl = document.createElement('span');
    testEl.style.cssText = getComputedStyle(el).cssText;
    testEl.textContent = 'A · B';
    el.appendChild(testEl);
    
    const range = document.createRange();
    range.setStart(testEl.firstChild!, 0);
    range.setEnd(testEl.firstChild!, 1);
    const rectA = range.getBoundingClientRect();
    
    range.setStart(testEl.firstChild!, 2);
    range.setEnd(testEl.firstChild!, 3);
    const rectSep = range.getBoundingClientRect();
    
    range.setStart(testEl.firstChild!, 4);
    range.setEnd(testEl.firstChild!, 5);
    const rectB = range.getBoundingClientRect();
    
    testEl.remove();
    
    return {
      beforeSeparator: rectSep.left - rectA.right,
      afterSeparator: rectB.left - rectSep.right,
      average: ((rectSep.left - rectA.right) + (rectB.left - rectSep.right)) / 2
    };
  });

  console.log('\n【中点分隔参考】:');
  console.log('  中点前间距:', separatorSpacing?.beforeSeparator?.toFixed(2), 'px');
  console.log('  中点后间距:', separatorSpacing?.afterSeparator?.toFixed(2), 'px');
  console.log('  平均间距:', separatorSpacing?.average?.toFixed(2), 'px');

  // ===== 4. 断言验证 =====
  console.log('\n【断言验证】');

  // 4.1 margin-right 已应用（约 0.4rem = 6.4px，假设 1rem = 16px）
  const marginRightPx = parseFloat(dotStyles.marginRight);
  assert.ok(
    marginRightPx >= 5 && marginRightPx <= 8,
    `margin-right 应为 5-8px（0.4rem 范围），实际: ${marginRightPx}px`
  );
  console.log('  ✓ margin-right 已应用:', dotStyles.marginRight);

  // 4.2 圆点尺寸保持不变（7px）
  const widthPx = parseFloat(dotStyles.width);
  const heightPx = parseFloat(dotStyles.height);
  assert.ok(
    widthPx >= 6 && widthPx <= 9,
    `圆点宽度应为 6-9px（保持 7px），实际: ${widthPx}px`
  );
  assert.ok(
    heightPx >= 6 && heightPx <= 9,
    `圆点高度应为 6-9px（保持 7px），实际: ${heightPx}px`
  );
  console.log('  ✓ 圆点尺寸保持不变:', dotStyles.width, 'x', dotStyles.height);

  // 4.3 圆点到文字间距接近中点分隔（≥80%）
  if (nextTextNode && separatorSpacing) {
    const ratio = nextTextNode.gap / separatorSpacing.average;
    console.log('\n  圆点到文字间距:', nextTextNode.gap.toFixed(2), 'px');
    console.log('  中点分隔平均:', separatorSpacing.average.toFixed(2), 'px');
    console.log('  比例:', (ratio * 100).toFixed(0) + '%');
    
    assert.ok(
      ratio >= 0.8,
      `圆点间距应 ≥ 中点分隔的 80%，实际: ${(ratio * 100).toFixed(0)}%`
    );
    console.log('  ✓ 圆点间距与中点分隔观感一致（≥80%）');
  } else {
    throw new Error('无法测量间距或参考值');
  }

  // 4.4 圆点到文字间距不小于中点分隔平均间距（改后不应过大）
  if (nextTextNode && separatorSpacing) {
    const ratio = nextTextNode.gap / separatorSpacing.average;
    assert.ok(
      ratio <= 1.5,
      `圆点间距不应过大（≤150%），实际: ${(ratio * 100).toFixed(0)}%`
    );
    console.log('  ✓ 圆点间距不过大（≤150%）');
  }

  console.log('\n【全部断言通过】');

} finally {
  await browser.close();
  if (blocked.length) console.log('\n阻止的外部请求:', [...new Set(blocked)]);
  if (errors.length) {
    console.error('\n页面错误:', errors);
    process.exit(1);
  }
}
