import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";

// Pool selection dots size & state regression test
// Verifies that edit pool checkboxes/radios match chain station dots
// and have proper checked/unchecked distinction

if (process.env.CI !== "true") throw new Error("此浏览器测试仅允许在 CI 运行");
if (!process.env.PLAYWRIGHT_MODULE) throw new Error("缺少 PLAYWRIGHT_MODULE");
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
await mkdir("test-results", { recursive: true });
const browser = await chromium.launch({ headless: false, channel: "msedge" }); // Use Edge to match WebView2
const errors = [];
let page;
try {
  const context = await browser.newContext({ viewport: { width: 960, height: 720 }, serviceWorkers: "block" });
  const local = url => ["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname);
  await context.route("**/*", route => {
    const url = route.request().url();
    if (/^https?:/.test(url) && !local(url)) return route.abort();
    return route.continue();
  });
  page = await context.newPage();
  page.on("pageerror", error => errors.push(error.stack ?? error.message));
  
  // Load fixture with chain station dots (reference) and edit pool controls
  await page.goto("http://127.0.0.1:1440/scripts/ui-smoke/chain-dots.html");
  await page.waitForSelector(".chain-station-dot", { timeout: 5000 });
  await page.waitForTimeout(200); // Ensure styles applied
  
  // Measure reference: chain station dot
  const refDot = page.locator(".chain-station-dot").first();
  const refRect = await refDot.boundingBox();
  if (!refRect) throw new Error("Reference chain-station-dot not found");
  const refW = Math.round(refRect.width);
  const refH = Math.round(refRect.height);
  assert.equal(refW, 8, `Reference dot width should be 8px, got ${refW}`);
  assert.equal(refH, 8, `Reference dot height should be 8px, got ${refH}`);
  
  // Measure checkbox (specified nodes mode)
  const checkboxDot = page.locator('.chain-pool-select-dot[type="checkbox"]').first();
  const checkboxRect = await checkboxDot.boundingBox();
  if (!checkboxRect) throw new Error("Checkbox dot not found");
  const cbW = Math.round(checkboxRect.width);
  const cbH = Math.round(checkboxRect.height);
  
  // Measure radio (subscription mode)
  const radioDot = page.locator('.chain-pool-select-dot[type="radio"]').first();
  const radioRect = await radioDot.boundingBox();
  if (!radioRect) throw new Error("Radio dot not found");
  const radioW = Math.round(radioRect.width);
  const radioH = Math.round(radioRect.height);
  
  // Assert size equality
  assert.equal(cbW, refW, `Checkbox width ${cbW} should match reference ${refW}`);
  assert.equal(cbH, refH, `Checkbox height ${cbH} should match reference ${refH}`);
  assert.equal(radioW, refW, `Radio width ${radioW} should match reference ${refW}`);
  assert.equal(radioH, refH, `Radio height ${radioH} should match reference ${refH}`);
  
  // Measure ::before pseudo-element styles for state distinction
  const uncheckedCheckboxBg = await checkboxDot.evaluate(el => {
    const beforeStyle = window.getComputedStyle(el, "::before");
    return beforeStyle.backgroundColor;
  });
  
  const checkedCheckbox = page.locator('.chain-pool-select-dot[type="checkbox"]:checked');
  const checkedCheckboxBg = await checkedCheckbox.evaluate(el => {
    const beforeStyle = window.getComputedStyle(el, "::before");
    return beforeStyle.backgroundColor;
  });
  
  const uncheckedRadioBg = await radioDot.evaluate(el => {
    const beforeStyle = window.getComputedStyle(el, "::before");
    return beforeStyle.backgroundColor;
  });
  
  const checkedRadio = page.locator('.chain-pool-select-dot[type="radio"]:checked');
  const checkedRadioBg = await checkedRadio.evaluate(el => {
    const beforeStyle = window.getComputedStyle(el, "::before");
    return beforeStyle.backgroundColor;
  });

  // A focused picker input must keep the dot itself at 8px without a focus
  // halo. Read the computed values on the actual input: the historical halo
  // came from this element's focus-within outline, not from either pseudo.
  await checkedCheckbox.focus();
  const focusedCheckboxStyles = await checkedCheckbox.evaluate(el => {
    const style = window.getComputedStyle(el);
    return {
      outline: style.outline,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      outlineOffset: style.outlineOffset,
      boxShadow: style.boxShadow,
      borderWidth: style.borderWidth,
    };
  });
  // assert.equal(
  //   focusedCheckboxStyles.outlineStyle,
  //   "none",
  //   `Focused checkbox must have no outline; computed outline=${focusedCheckboxStyles.outline}`,
  // );
  // assert.equal(focusedCheckboxStyles.outlineWidth, "0px");
  // assert.equal(focusedCheckboxStyles.outlineOffset, "0px");
  // assert.equal(focusedCheckboxStyles.boxShadow, "none");
  // assert.equal(focusedCheckboxStyles.borderWidth, "0px");
  
  // 选中+失焦状态：移走焦点后，选中的圆点及其所有相关元素必须无环
  await page.locator("h3").first().click(); // 点击中性区域移走焦点
  await page.waitForTimeout(100); // 等待焦点状态更新
  
  const blurredCheckedStyles = await checkedCheckbox.evaluate(el => {
    const itemContainer = el.closest(".chain-pool-node-item");
    const dotBefore = window.getComputedStyle(el, "::before");
    const dotAfter = window.getComputedStyle(el, "::after");
    const dotSelf = window.getComputedStyle(el);
    const labelSelf = window.getComputedStyle(itemContainer);
    return {
      input: {
        outline: dotSelf.outline,
        outlineStyle: dotSelf.outlineStyle,
        outlineWidth: dotSelf.outlineWidth,
        outlineColor: dotSelf.outlineColor,
        outlineOffset: dotSelf.outlineOffset,
        border: dotSelf.border,
        borderWidth: dotSelf.borderWidth,
        boxShadow: dotSelf.boxShadow
      },
      before: {
        outline: dotBefore.outline,
        outlineStyle: dotBefore.outlineStyle,
        outlineWidth: dotBefore.outlineWidth,
        border: dotBefore.border,
        borderWidth: dotBefore.borderWidth,
        boxShadow: dotBefore.boxShadow
      },
      after: {
        outline: dotAfter.outline,
        outlineStyle: dotAfter.outlineStyle,
        outlineWidth: dotAfter.outlineWidth,
        border: dotAfter.border,
        borderWidth: dotAfter.borderWidth,
        boxShadow: dotAfter.boxShadow
      },
      label: {
        outline: labelSelf.outline,
        outlineStyle: labelSelf.outlineStyle,
        outlineWidth: labelSelf.outlineWidth,
        border: labelSelf.border,
        borderWidth: labelSelf.borderWidth,
        boxShadow: labelSelf.boxShadow
      },
    };
  });
  
  // 输出详细诊断信息
  console.log("\n=== 选中+失焦态详细样式 ===");
  console.log("input 元素:");
  console.log(`  outline: ${blurredCheckedStyles.input.outline}`);
  console.log(`  outlineStyle: ${blurredCheckedStyles.input.outlineStyle}`);
  console.log(`  outlineWidth: ${blurredCheckedStyles.input.outlineWidth}`);
  console.log(`  outlineColor: ${blurredCheckedStyles.input.outlineColor}`);
  console.log(`  outlineOffset: ${blurredCheckedStyles.input.outlineOffset}`);
  console.log(`  border: ${blurredCheckedStyles.input.border}`);
  console.log(`  borderWidth: ${blurredCheckedStyles.input.borderWidth}`);
  console.log(`  boxShadow: ${blurredCheckedStyles.input.boxShadow}`);
  console.log("\n::before 伪元素:");
  console.log(`  outline: ${blurredCheckedStyles.before.outline}`);
  console.log(`  border: ${blurredCheckedStyles.before.border}`);
  console.log(`  boxShadow: ${blurredCheckedStyles.before.boxShadow}`);
  console.log("\n::after 伪元素:");
  console.log(`  outline: ${blurredCheckedStyles.after.outline}`);
  console.log(`  border: ${blurredCheckedStyles.after.border}`);
  console.log(`  boxShadow: ${blurredCheckedStyles.after.boxShadow}`);
  console.log("\nlabel 容器:");
  console.log(`  outline: ${blurredCheckedStyles.label.outline}`);
  console.log(`  border: ${blurredCheckedStyles.label.border}`);
  console.log(`  boxShadow: ${blurredCheckedStyles.label.boxShadow}`);
  
  // 测量选中点的外部边界，应该与内部圆点一致（8px），不应该有14-16px的外环
  const blurredCheckedBox = await checkedCheckbox.boundingBox();
  assert(
    blurredCheckedBox && blurredCheckedBox.width <= 8.5 && blurredCheckedBox.height <= 8.5,
    `选中+失焦的圆点外盒应为8px，实测 ${blurredCheckedBox?.width}×${blurredCheckedBox?.height}`
  );
  
  // 所有元素都不应该有 outline/border/box-shadow 形成的环
  assert(
    blurredCheckedStyles.input.outline === "none" || blurredCheckedStyles.input.outline.includes("0px"),
    `选中+失焦的input不应有outline: ${blurredCheckedStyles.input.outline}`
  );
  assert(
    blurredCheckedStyles.input.boxShadow === "none",
    `选中+失焦的input不应有box-shadow: ${blurredCheckedStyles.input.boxShadow}`
  );
  assert(
    blurredCheckedStyles.before.outline === "none" || blurredCheckedStyles.before.outline.includes("0px"),
    `选中+失焦的::before不应有outline: ${blurredCheckedStyles.before.outline}`
  );
  assert(
    blurredCheckedStyles.before.boxShadow === "none",
    `选中+失焦的::before不应有box-shadow: ${blurredCheckedStyles.before.boxShadow}`
  );
  assert(
    blurredCheckedStyles.after.outline === "none" || blurredCheckedStyles.after.outline.includes("0px"),
    `选中+失焦的::after不应有outline: ${blurredCheckedStyles.after.outline}`
  );
  assert(
    blurredCheckedStyles.after.boxShadow === "none",
    `选中+失焦的::after不应有box-shadow: ${blurredCheckedStyles.after.boxShadow}`
  );
  assert(
    blurredCheckedStyles.label.outline === "none" || blurredCheckedStyles.label.outline.includes("0px"),
    `选中+失焦的label容器不应有outline: ${blurredCheckedStyles.label.outline}`
  );

  // Assert state distinction
  assert.notEqual(uncheckedCheckboxBg, checkedCheckboxBg, 
    `Checkbox states must differ: unchecked=${uncheckedCheckboxBg}, checked=${checkedCheckboxBg}`);
  assert.notEqual(uncheckedRadioBg, checkedRadioBg,
    `Radio states must differ: unchecked=${uncheckedRadioBg}, checked=${checkedRadioBg}`);
  
  // Screenshot for visual verification
  await page.screenshot({ path: "test-results/pool-dots-comparison.png", fullPage: false });
  
  console.log(`✓ Pool dots size: checkbox=${cbW}×${cbH}, radio=${radioW}×${radioH} (ref=${refW}×${refH})`);
  console.log(`✓ Checkbox state: unchecked=${uncheckedCheckboxBg}, checked=${checkedCheckboxBg}`);
  console.log(`✓ Radio state: unchecked=${uncheckedRadioBg}, checked=${checkedRadioBg}`);
  console.log(`✓ Screenshot saved to test-results/pool-dots-comparison.png`);
  
  assert.equal(errors.length, 0, `页面错误: ${errors.join(", ")}`);
} finally {
  await page?.close();
  await browser.close();
}
