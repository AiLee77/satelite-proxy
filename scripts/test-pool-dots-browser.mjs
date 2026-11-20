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
const browser = await chromium.launch({ headless: true });
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
