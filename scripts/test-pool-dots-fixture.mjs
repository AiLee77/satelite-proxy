/**
 * 圆点专项返修测试 - 使用独立夹具
 */
import { pathToFileURL } from 'node:url';
import { mkdir } from 'node:fs/promises';

if (!process.env.PLAYWRIGHT_MODULE) {
  throw new Error('需要 PLAYWRIGHT_MODULE 环境变量');
}

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
await mkdir('test-output', { recursive: true });

const base = 'http://127.0.0.1:1440';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 1
});
const page = await context.newPage();

try {
  // 加载夹具页面
  console.log('加载链页面圆点测试夹具...');
  await page.goto(`${base}/scripts/ui-smoke/chain-dots.html?locale=zh&theme=day`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
  
  // 等待链卡渲染
  console.log('等待页面元素渲染...');
  await page.locator('.chain-station-dot').first().waitFor({ state: 'visible', timeout: 5000 });
  
  // 1. 测量样板圆点（链卡上的）
  console.log('\n=== 步骤 1: 测量样板圆点（链卡） ===');
  const sampleDot = page.locator('.chain-station-dot').first();
  const sampleBox = await sampleDot.boundingBox();
  
  if (!sampleBox) {
    throw new Error('未找到样板圆点');
  }
  
  console.log(`样板圆点尺寸: ${sampleBox.width}×${sampleBox.height}px`);
  console.log(`位置: (${sampleBox.x.toFixed(1)}, ${sampleBox.y.toFixed(1)})`);
  
  // 获取样板圆点的计算样式
  const sampleStyle = await sampleDot.evaluate(el => {
    const style = window.getComputedStyle(el);
    return {
      width: style.width,
      height: style.height,
      background: style.backgroundColor,
      borderRadius: style.borderRadius,
      appearance: style.appearance
    };
  });
  console.log('样板圆点样式:', sampleStyle);
  
  // 2. 测量编辑池 checkbox 圆点（页面直接渲染，无弹窗）
  console.log('\n=== 步骤 2: 测量编辑池 checkbox 圆点 ===');
  const checkboxDot = page.locator('.chain-pool-select-dot[type="checkbox"]').first();
  await checkboxDot.waitFor({ state: 'visible' });
  
  const checkboxBox = await checkboxDot.boundingBox();
  if (!checkboxBox) {
    throw new Error('未找到 checkbox 圆点');
  }
  
  console.log(`checkbox 圆点尺寸: ${checkboxBox.width}×${checkboxBox.height}px`);
  console.log(`位置: (${checkboxBox.x.toFixed(1)}, ${checkboxBox.y.toFixed(1)})`);
  
  const checkboxStyle = await checkboxDot.evaluate(el => {
    const style = window.getComputedStyle(el);
    const beforeStyle = window.getComputedStyle(el, '::before');
    return {
      width: style.width,
      height: style.height,
      background: style.backgroundColor,
      beforeBackground: beforeStyle.backgroundColor,
      beforeWidth: beforeStyle.width,
      beforeHeight: beforeStyle.height,
      borderRadius: style.borderRadius,
      appearance: style.appearance,
      type: el.type,
      checked: el.checked
    };
  });
  console.log('checkbox 圆点样式:', checkboxStyle);
  console.log('  -> ::before 伪元素:', {
    background: checkboxStyle.beforeBackground,
    size: `${checkboxStyle.beforeWidth}×${checkboxStyle.beforeHeight}`
  });
  
  // 3. 测量第二个 checkbox（已选中）
  console.log('\n=== 步骤 3: 测量已选中的 checkbox ===');
  const checkedDot = page.locator('.chain-pool-select-dot[type="checkbox"]:checked');
  const checkedStyle = await checkedDot.evaluate(el => {
    const style = window.getComputedStyle(el);
    const beforeStyle = window.getComputedStyle(el, '::before');
    return {
      background: style.backgroundColor,
      beforeBackground: beforeStyle.backgroundColor,
      checked: el.checked
    };
  });
  console.log('已选中样式:', checkedStyle);
  
  // 4. 测量 radio 圆点
  console.log('\n=== 步骤 4: 测量订阅模式 radio 圆点 ===');
  const radioDot = page.locator('.chain-pool-select-dot[type="radio"]').first();
  const radioBox = await radioDot.boundingBox();
  if (radioBox) {
    console.log(`radio 圆点尺寸: ${radioBox.width}×${radioBox.height}px`);
  }
  
  const radioStyle = await radioDot.evaluate(el => {
    const style = window.getComputedStyle(el);
    const beforeStyle = window.getComputedStyle(el, '::before');
    return {
      width: style.width,
      height: style.height,
      background: style.backgroundColor,
      beforeBackground: beforeStyle.backgroundColor,
      checked: el.checked
    };
  });
  console.log('radio 圆点样式:', radioStyle);
  
  const checkedRadio = page.locator('.chain-pool-select-dot[type="radio"]:checked');
  const checkedRadioStyle = await checkedRadio.evaluate(el => {
    const beforeStyle = window.getComputedStyle(el, '::before');
    return {
      background: window.getComputedStyle(el).backgroundColor,
      beforeBackground: beforeStyle.backgroundColor
    };
  });
  console.log('已选中 radio 样式:', checkedRadioStyle);
  console.log('\n' + '='.repeat(60));
  console.log('📊 对比分析');
  console.log('='.repeat(60));
  
  const sampleW = sampleBox.width;
  const sampleH = sampleBox.height;
  const checkboxW = checkboxBox.width;
  const checkboxH = checkboxBox.height;
  const diffW = Math.abs(sampleW - checkboxW);
  const diffH = Math.abs(sampleH - checkboxH);
  
  console.log(`\n样板圆点: ${sampleW}×${sampleH}px`);
  console.log(`编辑池圆点: ${checkboxW}×${checkboxH}px`);
  console.log(`宽度差异: ${diffW.toFixed(2)}px`);
  console.log(`高度差异: ${diffH.toFixed(2)}px`);
  
  if (diffW > 0.5 || diffH > 0.5) {
    console.log(`\n⚠️  尺寸不一致！差异超过阈值 0.5px`);
    console.log('\n原因分析:');
    console.log('  • 样板使用 <span> 元素');
    console.log('  • 编辑池使用 <input type="checkbox">');
    console.log('  • input 元素可能有浏览器默认最小尺寸');
    console.log(`  • appearance: ${checkboxStyle.appearance} (应为 none)`);
  } else {
    console.log(`\n✅ Mock 环境下尺寸一致`);
  }
  
  // 检查状态区分
  console.log('\n🎨 状态区分检查:');
  const uncheckedBg = checkboxStyle.beforeBackground;
  const checkedBg = checkedStyle.beforeBackground;
  console.log(`  未选中 checkbox::before: ${uncheckedBg}`);
  console.log(`  已选中 checkbox::before: ${checkedBg}`);
  console.log(`  未选中 radio::before: ${radioStyle.beforeBackground}`);
  console.log(`  已选中 radio::before: ${checkedRadioStyle.beforeBackground}`);
  
  const checkboxSame = uncheckedBg === checkedBg;
  const radioSame = radioStyle.beforeBackground === checkedRadioStyle.beforeBackground;
  
  if (checkboxSame || radioSame) {
    console.log('\n  ⚠️  状态区分问题:');
    if (checkboxSame) {
      console.log(`     checkbox 选中/未选背景色相同: ${uncheckedBg}`);
    }
    if (radioSame) {
      console.log(`     radio 选中/未选背景色相同: ${radioStyle.background}`);
    }
    console.log('     需要修复: 选中状态应使用主题色');
  } else {
    console.log('\n  ✅ 选中/未选背景色不同');
  }
  
  console.log('\n🔍 真机问题分析:');
  console.log('  用户报告:');
  console.log('  • 编辑池圆点明显大于样板（8px）');
  console.log('  • 选中/未选同为灰色，无法区分');
  console.log('\n  Mock 环境测量结果:');
  console.log(`  • 尺寸差异: ${diffW.toFixed(2)}px`);
  console.log(`  • 状态区分: ${checkboxSame ? '✗ 相同' : '✓ 不同'}`);
  
  if (diffW <= 0.5 && !checkboxSame) {
    console.log('\n  ⚠️  Mock 与真机不一致！');
    console.log('  可能原因:');
    console.log('  1. 生产包 CSS 加载顺序/优先级问题');
    console.log('  2. input checkbox 的浏览器默认样式在不同环境差异大');
    console.log('  3. appearance: none 在某些浏览器版本未完全生效');
    console.log('  4. UI zoom 缩放可能放大了 input 的最小尺寸');
    console.log('  5. 打包后 CSS 压缩/合并导致选择器优先级变化');
  }
  
  console.log('\n💡 建议修复方案:');
  console.log('  方案 1: 使用 ::before 伪元素覆盖（推荐）');
  console.log('    优点: 保留 input 语义和键盘可访问性');
  console.log('    实现: 用绝对定位的伪元素完全遮盖 input 默认渲染');
  console.log('\n  方案 2: 改用 <span> + role="checkbox"');
  console.log('    优点: 彻底避免 input 元素的默认行为');
  console.log('    注意: 需要手动处理键盘导航和 ARIA 状态');
  
  // 截图
  await page.screenshot({
    path: 'test-output/pool-dots-comparison.png',
    fullPage: false
  });
  
} catch (err) {
  console.error('\n❌ 测试失败:', err.message);
  console.error(err.stack);
  process.exit(1);
} finally {
  await browser.close();
}

console.log('\n✅ 测试完成');
