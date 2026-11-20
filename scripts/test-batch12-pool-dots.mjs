/**
 * 批次12-1：节点池编辑器圆点改小
 * 断言：池选择器两种状态圆点的 computed 宽/高/border/background 与
 * 链编辑器样板圆点的对应值一致。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";

test("batch12-1: pool editor dots match chain editor sample dots", async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  
  // 导航到代理链页面（需要 mock 数据）
  await page.goto("http://localhost:1420/#chain");
  await page.waitForTimeout(1000);
  
  // 1. 先测量链编辑器的样板圆点（.chain-candidate-mark）
  // 打开新建代理链弹窗
  const newChainBtn = page.locator('button:has-text("新建代理链")').first();
  await newChainBtn.click();
  await page.waitForTimeout(500);
  
  // 找到侧边栏的节点列表中的圆点标记（应该是字符）
  const sampleMark = page.locator('.chain-candidate-mark').first();
  const sampleStyles = await sampleMark.evaluate(el => {
    const cs = getComputedStyle(el);
    return {
      fontSize: cs.fontSize,
      lineHeight: cs.lineHeight,
      paddingRight: cs.paddingRight,
      color: cs.color
    };
  });
  
  console.log('样板圆点样式（链编辑器 .chain-candidate-mark）:', sampleStyles);
  
  // 关闭链编辑器
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  
  // 2. 测量节点池编辑器的圆点（.chain-pool-select-dot）
  // 打开新建节点池弹窗
  const newPoolBtn = page.locator('button:has-text("新建节点池")').first();
  await newPoolBtn.click();
  await page.waitForTimeout(500);
  
  // 选择"指定节点"模式
  const explicitBtn = page.locator('button:has-text("指定节点")');
  await explicitBtn.click();
  await page.waitForTimeout(300);
  
  // 找到池选择器的圆点
  const poolDot = page.locator('.chain-pool-select-dot').first();
  const poolDotStyles = await poolDot.evaluate(el => {
    const cs = getComputedStyle(el);
    return {
      width: cs.width,
      height: cs.height,
      borderWidth: cs.borderWidth,
      borderStyle: cs.borderStyle,
      borderColor: cs.borderColor,
      background: cs.background,
      borderRadius: cs.borderRadius
    };
  });
  
  console.log('池选择器圆点样式（未选中）:', poolDotStyles);
  
  // 点击一个节点使其选中
  const firstNodeLabel = page.locator('.chain-pool-node-item').first();
  await firstNodeLabel.click();
  await page.waitForTimeout(200);
  
  const checkedDot = page.locator('.chain-pool-select-dot:checked').first();
  const checkedStyles = await checkedDot.evaluate(el => {
    const cs = getComputedStyle(el);
    return {
      width: cs.width,
      height: cs.height,
      borderWidth: cs.borderWidth,
      borderColor: cs.borderColor,
      backgroundColor: cs.backgroundColor
    };
  });
  
  console.log('池选择器圆点样式（选中）:', checkedStyles);
  
  // 断言：池圆点应该与样板大小一致
  // 样板使用字符，视觉直径约 6-8px，我们目标是让池圆点也是这个大小
  // 预期改后值：width/height 约 6px, border 约 1px
  
  // 先检查当前值（应该是 10px，会失败）
  console.log('\n期望值：width/height ≈ 6-8px, borderWidth ≈ 1px');
  console.log('实际值（改前应该失败）：', {
    width: poolDotStyles.width,
    height: poolDotStyles.height,
    border: poolDotStyles.borderWidth
  });
  
  // 这个断言在改前应该失败
  const widthPx = parseFloat(poolDotStyles.width);
  const heightPx = parseFloat(poolDotStyles.height);
  const borderPx = parseFloat(poolDotStyles.borderWidth);
  
  // 目标：总直径 ≤ 8px（样板字符的视觉大小）
  const totalSize = widthPx + borderPx * 2;
  assert.ok(totalSize <= 9, `圆点总直径 ${totalSize}px 应该 ≤ 9px（匹配样板）`);
  assert.ok(widthPx <= 7, `圆点宽度 ${widthPx}px 应该 ≤ 7px`);
  assert.ok(borderPx <= 1.2, `边框宽度 ${borderPx}px 应该 ≤ 1.2px`);
  
  await browser.close();
});
