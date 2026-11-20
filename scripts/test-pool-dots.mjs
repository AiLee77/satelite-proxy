#!/usr/bin/env node
/**
 * 圆点专项返修测试：对比编辑节点池圆点与链卡样板圆点的实际渲染尺寸与层级
 */

import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

async function measureDot(page, description) {
  console.log(`\n=== ${description} ===`);
  
  // 获取圆点中心点
  const dotRect = await page.evaluate((desc) => {
    let dot;
    if (desc.includes('样板')) {
      // 链卡上的样板圆点
      dot = document.querySelector('.chain-station-dot');
    } else if (desc.includes('指定节点')) {
      // 编辑池弹窗 - 指定节点模式的 checkbox
      dot = document.querySelector('.chain-pool-select-dot[type="checkbox"]');
    } else if (desc.includes('整个订阅')) {
      // 编辑池弹窗 - 订阅模式的 radio
      dot = document.querySelector('.chain-pool-select-dot[type="radio"]');
    }
    
    if (!dot) return null;
    
    const rect = dot.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    
    return {
      rect: {
        width: rect.width,
        height: rect.height,
        left: rect.left,
        top: rect.top
      },
      center: { x: centerX, y: centerY }
    };
  }, description);
  
  if (!dotRect) {
    console.log('  ❌ 未找到圆点元素');
    return null;
  }
  
  console.log(`  圆点 rect: ${dotRect.rect.width}×${dotRect.rect.height}px @ (${dotRect.rect.left.toFixed(1)}, ${dotRect.rect.top.toFixed(1)})`);
  console.log(`  中心坐标: (${dotRect.center.x.toFixed(1)}, ${dotRect.center.y.toFixed(1)})`);
  
  // 用 elementFromPoint 获取实际命中的元素链
  const elemChain = await page.evaluate(({ x, y }) => {
    const elem = document.elementFromPoint(x, y);
    if (!elem) return [];
    
    const chain = [];
    let current = elem;
    while (current && current !== document.documentElement) {
      const rect = current.getBoundingClientRect();
      const style = window.getComputedStyle(current);
      
      chain.push({
        tag: current.tagName.toLowerCase(),
        className: current.className || '',
        rect: {
          width: rect.width,
          height: rect.height
        },
        background: style.backgroundColor,
        border: style.border,
        borderRadius: style.borderRadius
      });
      
      current = current.parentElement;
    }
    
    return chain;
  }, dotRect.center);
  
  console.log('  元素链 (从点击命中到根):');
  elemChain.forEach((el, i) => {
    console.log(`    [${i}] <${el.tag}> ${el.className ? `class="${el.className}"` : ''}`);
    console.log(`        rect: ${el.rect.width.toFixed(1)}×${el.rect.height.toFixed(1)}px`);
    console.log(`        background: ${el.background}`);
    if (el.border && el.border !== '0px none rgb(0, 0, 0)') {
      console.log(`        border: ${el.border}`);
    }
    if (el.borderRadius && el.borderRadius !== '0px') {
      console.log(`        borderRadius: ${el.borderRadius}`);
    }
  });
  
  return { dotRect, elemChain };
}

async function main() {
  console.log('启动浏览器测试...');
  
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1
  });
  const page = await context.newPage();
  
  // 加载应用
  await page.goto('http://localhost:1420');
  await page.waitForTimeout(1000);
  
  // 模拟数据
  await page.evaluate(() => {
    window.__MOCK_SETTINGS__ = {
      locale: 'zh',
      theme_id: 'day',
      accent_color: 'blue'
    };
    window.__MOCK_CHAINS__ = [
      {
        id: 'chain-test',
        name: '测试链',
        hops: [
          { mode: 'node', node_id: 'node-1' },
          { mode: 'node', node_id: 'node-2' }
        ],
        name_manual: true
      }
    ];
    window.__MOCK_POOLS__ = [
      {
        id: 'pool-test',
        name: '测试池',
        mode: { mode: 'explicit', node_ids: ['node-1'] }
      }
    ];
    window.__MOCK_NODES__ = [
      {
        id: 'node-1',
        name: '节点 A',
        protocol: 'vmess',
        server: '1.2.3.4',
        port: 443,
        enabled: true,
        subscription_id: 'sub-1',
        subscription_name: '订阅 A'
      },
      {
        id: 'node-2',
        name: '节点 B',
        protocol: 'vmess',
        server: '5.6.7.8',
        port: 443,
        enabled: true,
        subscription_id: 'sub-1',
        subscription_name: '订阅 A'
      }
    ];
    window.__MOCK_SUBSCRIPTIONS__ = [
      {
        id: 'sub-1',
        name: '订阅 A',
        source_kind: 'url',
        enabled: true,
        node_count: 2
      }
    ];
  });
  
  // 导航到链页面
  await page.click('nav button:has-text("Chains")');
  await page.waitForTimeout(500);
  
  // 1. 测量样板圆点（链卡上的）
  console.log('\n📍 步骤 1: 测量样板圆点');
  const sampleResult = await measureDot(page, '样板圆点（链卡）');
  
  // 2. 打开编辑节点池弹窗 - 指定节点模式
  console.log('\n📍 步骤 2: 打开编辑节点池弹窗（指定节点模式）');
  await page.click('.chain-pool-row button:has-text("编辑")');
  await page.waitForTimeout(300);
  
  // 确保是指定节点模式
  await page.click('.glass-seg button:has-text("指定节点")');
  await page.waitForTimeout(200);
  
  // 测量指定节点模式的 checkbox 圆点
  const explicitResult = await measureDot(page, '编辑池圆点（指定节点模式 checkbox）');
  
  // 截图对比
  await page.screenshot({ 
    path: join(rootDir, 'test-output', 'pool-dots-explicit.png'),
    fullPage: false
  });
  
  // 3. 切换到订阅模式
  console.log('\n📍 步骤 3: 切换到订阅模式');
  await page.click('.glass-seg button:has-text("整个订阅")');
  await page.waitForTimeout(200);
  
  // 测量订阅模式的 radio 圆点
  const subResult = await measureDot(page, '编辑池圆点（整个订阅模式 radio）');
  
  await page.screenshot({ 
    path: join(rootDir, 'test-output', 'pool-dots-subscription.png'),
    fullPage: false
  });
  
  // 4. 对比分析
  console.log('\n' + '='.repeat(60));
  console.log('📊 对比分析');
  console.log('='.repeat(60));
  
  if (sampleResult && explicitResult) {
    const sampleW = sampleResult.dotRect.rect.width;
    const explicitW = explicitResult.dotRect.rect.width;
    const diff = Math.abs(sampleW - explicitW);
    
    console.log(`\n样板圆点尺寸: ${sampleW}×${sampleResult.dotRect.rect.height}px`);
    console.log(`指定节点圆点: ${explicitW}×${explicitResult.dotRect.rect.height}px`);
    console.log(`差异: ${diff.toFixed(2)}px`);
    
    if (diff > 0.5) {
      console.log(`\n⚠️  尺寸不一致！差异 ${diff.toFixed(2)}px 超过阈值 0.5px`);
      
      // 分析根因
      console.log('\n🔍 根因分析:');
      console.log('样板圆点实际渲染层:');
      if (sampleResult.elemChain[0]) {
        console.log(`  <${sampleResult.elemChain[0].tag}> ${sampleResult.elemChain[0].className}`);
        console.log(`  实际尺寸: ${sampleResult.elemChain[0].rect.width.toFixed(1)}×${sampleResult.elemChain[0].rect.height.toFixed(1)}px`);
      }
      
      console.log('\n指定节点圆点实际渲染层:');
      if (explicitResult.elemChain[0]) {
        console.log(`  <${explicitResult.elemChain[0].tag}> ${explicitResult.elemChain[0].className}`);
        console.log(`  实际尺寸: ${explicitResult.elemChain[0].rect.width.toFixed(1)}×${explicitResult.elemChain[0].rect.height.toFixed(1)}px`);
      }
      
      if (explicitResult.elemChain[0].tag === 'input') {
        console.log('\n  ⚠️  checkbox/radio input 可能有浏览器默认最小尺寸限制');
        console.log('      建议修复方案: 改用 <span> 或添加 ::before/::after 伪元素覆盖');
      }
    } else {
      console.log('\n✅ Mock 环境下尺寸一致');
      console.log('   ⚠️  但用户真机报告尺寸大且无状态区分');
      console.log('   🔍 需要检查:');
      console.log('      1. 生产包 CSS 加载顺序');
      console.log('      2. UI zoom 缩放影响');
      console.log('      3. DPR / 系统缩放');
      console.log('      4. 真机浏览器版本特性');
    }
  }
  
  if (subResult) {
    console.log(`\n订阅模式圆点: ${subResult.dotRect.rect.width}×${subResult.dotRect.rect.height}px`);
  }
  
  await browser.close();
  console.log('\n✅ 测试完成');
}

main().catch(console.error);
