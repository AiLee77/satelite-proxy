/**
 * 批次 13-2 改前测试：hero 状态点间距不足
 * 
 * 问题：首页链信息行（.dash-hero-desc）中的运行状态小圆点（.status-dot）
 * 与后面的文字几乎贴上，视觉间距明显小于该行内其他元素（中点「·」）的分隔。
 * 
 * 本测试预期在改前失败（间距过小）。
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

  // 等待 hero 区域加载
  await page.waitForSelector('.dash-hero-desc', { timeout: 3000 });

  const heroDesc = page.locator('.dash-hero-desc').first();
  const statusDot = heroDesc.locator('.status-dot');
  
  // 确保状态点存在
  await statusDot.waitFor({ state: "visible", timeout: 3000 });

  // 获取状态点的位置和样式
  const dotRect = await statusDot.boundingBox();
  const dotStyles = await statusDot.evaluate(el => {
    const cs = getComputedStyle(el);
    return {
      marginRight: cs.marginRight,
      width: cs.width,
      height: cs.height
    };
  });

  console.log('\n【改前状态】.status-dot:');
  console.log('  bounding box:', dotRect);
  console.log('  computed marginRight:', dotStyles.marginRight);
  console.log('  computed width:', dotStyles.width);
  console.log('  computed height:', dotStyles.height);

  // 获取整个 desc 文本和位置
  const descText = await heroDesc.textContent();
  const descRect = await heroDesc.boundingBox();

  console.log('\n【Hero desc 内容】:');
  console.log('  文本:', descText);
  console.log('  容器:', descRect);

  // 查找状态点右边缘到下一个可见文本的距离
  const nextTextNode = await heroDesc.evaluate((el, dotWidth) => {
    const dot = el.querySelector('.status-dot');
    if (!dot) return null;
    
    const dotRect = dot.getBoundingClientRect();
    const dotRightEdge = dotRect.right;
    
    // 获取所有文本节点
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
  }, dotStyles.width);

  console.log('\n【圆点到文字间距】:');
  console.log('  状态点右边缘:', nextTextNode?.dotRight);
  console.log('  下一个文字左边缘:', nextTextNode?.textLeft);
  console.log('  实测间距:', nextTextNode?.gap?.toFixed(2), 'px');
  console.log('  文字内容:', nextTextNode?.text);

  // 查找文本中的中点「·」周围的间距（参考标准）
  const separatorSpacing = await heroDesc.evaluate(el => {
    const text = el.textContent || '';
    if (!text.includes('·')) return null;
    
    // 创建一个测试容器来测量「·」周围的间距
    const testEl = document.createElement('span');
    testEl.style.cssText = getComputedStyle(el).cssText;
    testEl.textContent = 'A · B';
    el.appendChild(testEl);
    
    const range = document.createRange();
    range.setStart(testEl.firstChild!, 0);
    range.setEnd(testEl.firstChild!, 1); // "A"
    const rectA = range.getBoundingClientRect();
    
    range.setStart(testEl.firstChild!, 2);
    range.setEnd(testEl.firstChild!, 3); // "·"
    const rectSep = range.getBoundingClientRect();
    
    range.setStart(testEl.firstChild!, 4);
    range.setEnd(testEl.firstChild!, 5); // "B"
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

  // 改前断言：状态点到文字的间距应该明显小于中点分隔的平均间距
  console.log('\n【根因验证】改前状态点间距过小:');
  console.log('  预期: 状态点到文字间距应接近中点分隔平均间距');
  console.log('  实际: 状态点到文字间距 =', nextTextNode?.gap?.toFixed(2), 'px');
  console.log('  参考: 中点分隔平均间距 =', separatorSpacing?.average?.toFixed(2), 'px');

  if (nextTextNode && separatorSpacing) {
    const ratio = nextTextNode.gap / separatorSpacing.average;
    console.log('  比例:', (ratio * 100).toFixed(0) + '%');
    
    // 改前应该失败（间距过小，比例应 < 80%）
    try {
      assert.ok(
        ratio >= 0.8,
        `状态点间距应 ≥ 中点分隔的 80%，实际: ${(ratio * 100).toFixed(0)}%`
      );
      console.log('\n【意外】状态点间距已经足够（可能已修复？）');
    } catch (err) {
      console.log('\n【预期】状态点间距过小（改前状态确认）:', err.message);
      throw err; // 改前测试预期失败
    }
  } else {
    throw new Error('无法测量间距或参考值');
  }

} finally {
  await browser.close();
  if (blocked.length) console.log('\n阻止的外部请求:', [...new Set(blocked)]);
  if (errors.length) {
    console.error('\n页面错误:', errors);
    process.exit(1);
  }
}
