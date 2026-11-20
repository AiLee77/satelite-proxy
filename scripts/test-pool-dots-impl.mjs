/**
 * 圆点专项返修测试实现 - 实际测量圆点尺寸
 */
import { pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

if (!process.env.PLAYWRIGHT_MODULE) {
  throw new Error('需要 PLAYWRIGHT_MODULE 环境变量');
}

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);

await mkdir('test-output', { recursive: true });

async function measureDot(page, description, selector) {
  console.log(`\n=== ${description} ===`);
  
  // 检查元素是否存在
  const exists = await page.locator(selector).count();
  if (exists === 0) {
    console.log(`  ❌ 未找到元素: ${selector}`);
    return null;
  }
  
  // 获取圆点的 rect 和中心点
  const dotInfo = await page.locator(selector).evaluate((dot) => {
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
  });
  
  console.log(`  圆点 rect: ${dotInfo.rect.width}×${dotInfo.rect.height}px @ (${dotInfo.rect.left.toFixed(1)}, ${dotInfo.rect.top.toFixed(1)})`);
  console.log(`  中心坐标: (${dotInfo.center.x.toFixed(1)}, ${dotInfo.center.y.toFixed(1)})`);
  
  // 用 elementFromPoint 获取实际命中的元素链
  const elemChain = await page.evaluate(({ x, y }) => {
    const elem = document.elementFromPoint(x, y);
    if (!elem) return [];
    
    const chain = [];
    let current = elem;
    let depth = 0;
    while (current && current !== document.documentElement && depth < 10) {
      const rect = current.getBoundingClientRect();
      const style = window.getComputedStyle(current);
      
      chain.push({
        tag: current.tagName.toLowerCase(),
        className: current.className || '',
        type: current.type || '',
        rect: {
          width: rect.width,
          height: rect.height
        },
        background: style.backgroundColor,
        border: style.border,
        borderRadius: style.borderRadius,
        appearance: style.appearance,
        display: style.display
      });
      
      current = current.parentElement;
      depth++;
    }
    
    return chain;
  }, dotInfo.center);
  
  console.log('  元素链 (从点击命中到根):');
  elemChain.forEach((el, i) => {
    console.log(`    [${i}] <${el.tag}${el.type ? ` type="${el.type}"` : ''}> ${el.className ? `class="${el.className}"` : ''}`);
    console.log(`        rect: ${el.rect.width.toFixed(1)}×${el.rect.height.toFixed(1)}px`);
    console.log(`        background: ${el.background}`);
    console.log(`        appearance: ${el.appearance}`);
    if (el.border && el.border !== '0px none rgb(0, 0, 0)') {
      console.log(`        border: ${el.border}`);
    }
    if (el.borderRadius && el.borderRadius !== '0px') {
      console.log(`        borderRadius: ${el.borderRadius}`);
    }
  });
  
  return { dotInfo, elemChain };
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 1
});
const page = await context.newPage();

try {
  // 加载 Vite 开发服务器
  await page.goto('http://127.0.0.1:1440');
  await page.waitForLoadState('networkidle');
  
  // 注入 mock 数据
  await page.evaluate(() => {
    window.__MOCK_CHAINS__ = [{
      id: 'chain-test',
      name: '测试链',
      hops: [
        { mode: { mode: 'node', node_id: 'node-1' } },
        { mode: { mode: 'node', node_id: 'node-2' } }
      ],
      name_manual: true
    }];
    window.__MOCK_POOLS__ = [{
      id: 'pool-test',
      name: '测试池',
      mode: { mode: 'explicit', node_ids: ['node-1'] }
    }];
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
    window.__MOCK_SUBSCRIPTIONS__ = [{
      id: 'sub-1',
      name: '订阅 A',
      source_kind: 'url',
      enabled: true,
      node_count: 2
    }];
  });
  
  // 导航到链页面
  const chainsTab = page.locator('nav button', { hasText: 'Chains' });
  if (await chainsTab.count() === 0) {
    throw new Error('未找到 Chains 导航按钮');
  }
  await chainsTab.click();
  await page.waitForTimeout(800);
  
  // 1. 测量样板圆点（链卡上的）
  console.log('\n📍 步骤 1: 测量样板圆点（链卡）');
  const sampleResult = await measureDot(page, '样板圆点（链卡）', '.chain-station-dot');
  
  // 2. 点击编辑节点池
  console.log('\n📍 步骤 2: 打开编辑节点池弹窗');
  const editPoolBtn = page.locator('.chain-pool-row button', { hasText: '编辑' });
  if (await editPoolBtn.count() === 0) {
    console.log('⚠️  未找到编辑池按钮，尝试查找其他入口');
    const poolRow = page.locator('.chain-pool-row').first();
    await poolRow.locator('button').first().click();
  } else {
    await editPoolBtn.first().click();
  }
  await page.waitForTimeout(500);
  
  // 确保是指定节点模式
  const explicitModeBtn = page.locator('.glass-seg button', { hasText: '指定节点' });
  if (await explicitModeBtn.count() > 0) {
    await explicitModeBtn.click();
    await page.waitForTimeout(300);
  }
  
  // 3. 测量指定节点模式的 checkbox 圆点
  console.log('\n📍 步骤 3: 测量指定节点模式圆点');
  const explicitResult = await measureDot(
    page,
    '编辑池圆点（指定节点模式 checkbox）',
    '.chain-pool-select-dot[type="checkbox"]'
  );
  
  // 截图
  await page.screenshot({
    path: 'test-output/pool-dots-explicit.png',
    fullPage: false
  });
  
  // 4. 切换到订阅模式
  console.log('\n📍 步骤 4: 切换到订阅模式');
  const subModeBtn = page.locator('.glass-seg button', { hasText: '整个订阅' });
  if (await subModeBtn.count() > 0) {
    await subModeBtn.click();
    await page.waitForTimeout(300);
    
    const subResult = await measureDot(
      page,
      '编辑池圆点（整个订阅模式 radio）',
      '.chain-pool-select-dot[type="radio"]'
    );
    
    await page.screenshot({
      path: 'test-output/pool-dots-subscription.png',
      fullPage: false
    });
  }
  
  // 5. 对比分析
  console.log('\n' + '='.repeat(60));
  console.log('📊 对比分析');
  console.log('='.repeat(60));
  
  if (!sampleResult || !explicitResult) {
    console.log('\n❌ 未能获取完整测量数据');
  } else {
    const sampleW = sampleResult.dotInfo.rect.width;
    const sampleH = sampleResult.dotInfo.rect.height;
    const explicitW = explicitResult.dotInfo.rect.width;
    const explicitH = explicitResult.dotInfo.rect.height;
    const diff = Math.abs(sampleW - explicitW);
    
    console.log(`\n样板圆点尺寸: ${sampleW}×${sampleH}px`);
    console.log(`指定节点圆点: ${explicitW}×${explicitH}px`);
    console.log(`差异: ${diff.toFixed(2)}px`);
    
    if (diff > 0.5) {
      console.log(`\n⚠️  尺寸不一致！差异 ${diff.toFixed(2)}px 超过阈值 0.5px`);
      
      console.log('\n🔍 根因分析:');
      console.log('\n样板圆点实际渲染层:');
      if (sampleResult.elemChain[0]) {
        const el = sampleResult.elemChain[0];
        console.log(`  <${el.tag}> ${el.className}`);
        console.log(`  实际尺寸: ${el.rect.width.toFixed(1)}×${el.rect.height.toFixed(1)}px`);
        console.log(`  appearance: ${el.appearance}`);
      }
      
      console.log('\n指定节点圆点实际渲染层:');
      if (explicitResult.elemChain[0]) {
        const el = explicitResult.elemChain[0];
        console.log(`  <${el.tag}${el.type ? ` type="${el.type}"` : ''}> ${el.className}`);
        console.log(`  实际尺寸: ${el.rect.width.toFixed(1)}×${el.rect.height.toFixed(1)}px`);
        console.log(`  appearance: ${el.appearance}`);
      }
      
      if (explicitResult.elemChain[0].tag === 'input') {
        console.log('\n  ⚠️  input 元素可能有浏览器默认最小尺寸或内置样式');
        console.log('      建议修复方案:');
        console.log('      1. 用 ::before 或 ::after 伪元素覆盖渲染');
        console.log('      2. 改用 <span> + 自定义样式');
        console.log('      3. 确保 appearance: none 生效');
      }
    } else {
      console.log('\n✅ Mock 环境下尺寸一致 (差异 ≤ 0.5px)');
      console.log('\n   但用户真机报告:');
      console.log('   • 圆点明显大于样板');
      console.log('   • 选中/未选同为灰色，无区分');
      console.log('\n🔍 需要检查:');
      console.log('   1. 生产包 CSS 加载顺序 / 级联优先级');
      console.log('   2. UI zoom 缩放影响 (useViewportScale)');
      console.log('   3. 真机浏览器版本 / 引擎差异');
      console.log('   4. 打包后 CSS 合并/压缩导致的选择器变化');
    }
    
    // 检查状态样式
    console.log('\n🎨 样式状态检查:');
    
    // 获取未选中状态
    const uncheckedStyle = await page.locator('.chain-pool-select-dot[type="checkbox"]').first().evaluate(el => {
      const style = window.getComputedStyle(el);
      return {
        background: style.backgroundColor,
        checked: el.checked
      };
    });
    console.log(`  未选中状态: background=${uncheckedStyle.background}, checked=${uncheckedStyle.checked}`);
    
    // 点击选中
    await page.locator('.chain-pool-node-item').first().click();
    await page.waitForTimeout(100);
    
    const checkedStyle = await page.locator('.chain-pool-select-dot[type="checkbox"]:checked').first().evaluate(el => {
      const style = window.getComputedStyle(el);
      return {
        background: style.backgroundColor,
        checked: el.checked
      };
    });
    console.log(`  选中状态: background=${checkedStyle.background}, checked=${checkedStyle.checked}`);
    
    if (uncheckedStyle.background === checkedStyle.background) {
      console.log('\n  ⚠️  选中/未选背景色相同！需要修复状态区分');
    } else {
      console.log('\n  ✅ 选中/未选背景色不同');
    }
  }
  
} catch (err) {
  console.error('\n❌ 测试执行失败:', err.message);
  console.error(err.stack);
  process.exit(1);
} finally {
  await browser.close();
}

console.log('\n✅ 测试执行完成');
