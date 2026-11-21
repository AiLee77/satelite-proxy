import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

// Real ChainPage pool-editor regression. This deliberately exercises the
// complete production CSS surface and trusted pointer/keyboard input; its
// mock result is not a substitute for the user's real-device verification.
if (process.env.CI !== "true") throw new Error("此浏览器测试仅允许在 CI mock 路径运行");
if (!process.env.PLAYWRIGHT_MODULE) throw new Error("缺少 PLAYWRIGHT_MODULE");
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
await mkdir("test-results", { recursive: true });
const browser = await chromium.launch({ headless: false, channel: "msedge" });
const errors = [];
let page;
try {
  const context = await browser.newContext({ viewport: { width: 960, height: 720 }, hasTouch: true, serviceWorkers: "block" });
  const local = url => ["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname);
  await context.route("**/*", route => {
    const url = route.request().url();
    if (/^https?:/.test(url) && !local(url)) return route.abort();
    return route.continue();
  });
  page = await context.newPage();
  page.on("pageerror", error => errors.push(error.stack ?? error.message));

  await page.goto("http://127.0.0.1:1440/scripts/ui-smoke/chain-dots.html?locale=zh&theme=aerospace");
  await page.waitForSelector(".chain-station-dot", { timeout: 10000 });
  const loadedStyles = await page.evaluate(() => Array.from(document.styleSheets).map(sheet => ({
    href: sheet.href,
    source: sheet.ownerNode?.getAttribute?.("data-vite-dev-id") ?? null,
  })));
  const styleEvidence = loadedStyles.map(item => item.href || item.source || "").join("\n");
  for (const required of [
    "App.css", "ProAppearance.css", "ProMotion.css", "IpInfoPanel.css",
    "ServiceStatusCard.css", "DashboardPage.css", "ChainPage.css", "xyflow",
  ]) {
    assert.ok(styleEvidence.includes(required), `夹具缺少生产样式 ${required}:\n${styleEvidence}`);
  }

  const refRect = await page.locator(".chain-station-dot").first().boundingBox();
  assert.ok(refRect, "缺少链卡样板圆点");
  assert.equal(Math.round(refRect.width), 8);
  assert.equal(Math.round(refRect.height), 8);

  // Open the pool through the real row menu and expand its real subscription
  // group. There is no fixture-local copy of PoolEditorModal's DOM.
  await page.locator(".chain-pool-row .rule-menu-trigger").click();
  await page.locator(".chain-menu-pop [role='menuitem']").first().click();
  await page.locator(".modal .chain-pool-select-dot").waitFor({ state: "attached" }).catch(() => {});
  const groupHeads = page.locator(".modal .chain-pool-node-group .chain-candidate-group-head");
  for (let i = 0; i < await groupHeads.count(); i++) {
    if (await groupHeads.nth(i).getAttribute("aria-expanded") === "false") await groupHeads.nth(i).click();
  }
  const firstRow = page.locator(".modal .chain-pool-node-item[data-node-id='fixture-node']");
  const input = firstRow.locator(".chain-pool-select-dot[type='checkbox']");
  await input.waitFor({ state: "visible" });
  assert.equal(await input.isChecked(), true, "真实池夹具的首节点应初始选中");

  const snapshot = locator => locator.evaluate(el => {
    const self = getComputedStyle(el);
    const before = getComputedStyle(el, "::before");
    const after = getComputedStyle(el, "::after");
    const label = el.closest(".chain-pool-node-item");
    const labelStyle = getComputedStyle(label);
    const pick = style => ({
      outline: style.outline,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      outlineOffset: style.outlineOffset,
      border: style.border,
      boxShadow: style.boxShadow,
    });
    return {
      checked: el.checked,
      focused: document.activeElement === el,
      activeElement: document.activeElement?.outerHTML?.slice(0, 240) ?? null,
      input: pick(self), before: pick(before), after: pick(after), label: pick(labelStyle),
      beforeBackground: before.backgroundColor,
    };
  });
  const initial = await snapshot(input);

  // Trusted row clicks: cancel and re-select exactly once each.
  await firstRow.click();
  const cancelled = await snapshot(input);
  assert.equal(cancelled.checked, false, "可信点击应取消勾选");

  // Enumerate every element intersecting the 16×16px box around the dot.
  // Include computed outline/border/shadow and the originating author rules.
  const ringAudit = await input.evaluate(el => {
    const rect = el.getBoundingClientRect();
    const size = 16;
    const ring = {
      left: rect.left + rect.width / 2 - size / 2,
      top: rect.top + rect.height / 2 - size / 2,
      right: rect.left + rect.width / 2 + size / 2,
      bottom: rect.top + rect.height / 2 + size / 2,
    };
    const intersects = r => r.width > 0 && r.height > 0 &&
      r.right >= ring.left && r.left <= ring.right && r.bottom >= ring.top && r.top <= ring.bottom;
    const properties = [
      "outline", "outline-style", "outline-width", "outline-color", "outline-offset",
      "border", "border-top", "border-right", "border-bottom", "border-left", "box-shadow",
    ];
    const computed = style => Object.fromEntries(properties.map(property => [property, style.getPropertyValue(property)]));
    const matchingRules = element => {
      const found = [];
      for (const sheet of document.styleSheets) {
        let rules;
        try { rules = sheet.cssRules; } catch { continue; }
        const source = sheet.href || sheet.ownerNode?.getAttribute?.("data-vite-dev-id") || "inline";
        for (const rule of rules) {
          if (!(rule instanceof CSSStyleRule)) continue;
          const declarations = Object.fromEntries(properties
            .map(property => [property, rule.style.getPropertyValue(property)])
            .filter(([, value]) => value));
          if (Object.keys(declarations).length === 0) continue;
          for (const selector of rule.selectorText.split(",")) {
            try {
              if (element.matches(selector.trim())) {
                found.push({ source, selector: selector.trim(), declarations });
                break;
              }
            } catch { /* Selector lists containing pseudo-elements are not matches()-compatible. */ }
          }
        }
      }
      return found;
    };
    const elements = Array.from(document.querySelectorAll("*")).filter(element => intersects(element.getBoundingClientRect()));
    const globalFocusRules = [];
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }
      const source = sheet.href || sheet.ownerNode?.getAttribute?.("data-vite-dev-id") || "inline";
      for (const rule of rules) {
        if (!(rule instanceof CSSStyleRule)) continue;
        for (const selector of rule.selectorText.split(",")) {
          if (selector.trim() !== ".field input:focus") continue;
          globalFocusRules.push({
            source,
            selector: selector.trim(),
            declarations: { "box-shadow": rule.style.getPropertyValue("box-shadow") },
          });
        }
      }
    }
    return {
      state: { checked: el.checked, focused: document.activeElement === el, focusVisible: el.matches(":focus-visible") },
      ring,
      globalFocusRules,
      input: {
        self: computed(getComputedStyle(el)),
        before: computed(getComputedStyle(el, "::before")),
        after: computed(getComputedStyle(el, "::after")),
      },
      elements: elements.map(element => ({
        tag: element.tagName.toLowerCase(),
        className: typeof element.className === "string" ? element.className : "",
        rect: (() => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })(),
        style: computed(getComputedStyle(element)),
        rules: matchingRules(element),
      })),
    };
  });

  await firstRow.click();
  const selected = await snapshot(input);
  assert.equal(selected.checked, true, "第二次可信点击应重新勾选");

  const report = { loadedStyles, initial, cancelled, selected, focusedUncheckedAudit: ringAudit };
  await writeFile("test-results/pool-dots-ring-audit.json", JSON.stringify(report, null, 2));
  console.log(`✓ 生产样式 ${loadedStyles.length} 份；16px 区域元素 ${ringAudit.elements.length} 个`);
  console.log(`✓ 取证写入 test-results/pool-dots-ring-audit.json`);
  const globalFocusRules = ringAudit.globalFocusRules;
  assert.ok(globalFocusRules.some(rule => rule.declarations["box-shadow"]), "未定位到 App.css 的 .field input:focus 环规则");
  console.log(`✓ 环规则来源: ${globalFocusRules.map(rule => `${rule.source} :: ${rule.selector} :: ${rule.declarations["box-shadow"]}`).join(" | ")}`);

  for (const [state, value] of [["cancelled", cancelled], ["selected", selected]]) {
    for (const part of ["input", "before", "after", "label"]) {
      assert.equal(value[part].boxShadow, "none", `${state} ${part} 不应有 box-shadow 环`);
      assert.equal(value[part].outlineStyle, "none", `${state} ${part} 不应有 outline 环`);
    }
  }
  assert.equal(cancelled.focused, false, "可信取消点击后 input 不应获得焦点");
  assert.equal(selected.focused, false, "可信选中点击后 input 不应获得焦点");

  // Keyboard modality remains intact: Tab from the real group header reaches
  // the first input, and Space toggles twice without losing either behavior.
  await firstRow.locator("..").locator(".chain-candidate-group-head").focus();
  await page.keyboard.press("Tab");
  assert.equal(await input.evaluate(el => document.activeElement === el), true, "Tab 应聚焦池选择 input");
  assert.equal(await input.evaluate(el => el.matches(":focus-visible")), true, "Tab 后应为 focus-visible");
  await page.keyboard.press("Space");
  assert.equal(await input.isChecked(), false, "Space 应取消勾选");
  const keyboardCancelled = await snapshot(input);
  assert.equal(keyboardCancelled.focused, true);
  assert.equal(keyboardCancelled.input.boxShadow, "none", "键盘聚焦未选态也不应显示全局 field 阴影");
  await page.keyboard.press("Space");
  assert.equal(await input.isChecked(), true, "第二次 Space 应重新勾选");

  const checkboxRect = await input.boundingBox();
  assert.ok(
    checkboxRect && Math.round(checkboxRect.width) === 8 && Math.round(checkboxRect.height) === 8,
    `checkbox 应为 8×8，实际 ${JSON.stringify(checkboxRect)}`,
  );
  const uncheckedBg = cancelled.beforeBackground;

  // The subscription picker is also the production radio row implementation.
  await page.locator(".modal .glass-seg-btn").nth(2).click();
  const radioRows = page.locator(".modal .chain-pool-node-item");
  const radio = radioRows.first().locator(".chain-pool-select-dot[type='radio']");
  await radio.waitFor({ state: "visible" });
  await radioRows.first().click();
  assert.equal(await radio.isChecked(), true, "订阅 radio 点击应选中");
  assert.equal(await radio.evaluate(el => document.activeElement === el), false, "radio 鼠标点击不应聚焦");
  const radioRect = await radio.boundingBox();
  assert.ok(radioRect && Math.round(radioRect.width) === 8 && Math.round(radioRect.height) === 8);
  const checkedRadioBg = await radio.evaluate(el => getComputedStyle(el, "::before").backgroundColor);
  const secondRadioRow = radioRows.nth(1);
  const secondRadio = secondRadioRow.locator("input");
  const uncheckedRadioBg = await secondRadio.evaluate(el => getComputedStyle(el, "::before").backgroundColor);
  const touchRect = await secondRadioRow.boundingBox();
  assert.ok(touchRect, "触控 radio 行不可见");
  await page.touchscreen.tap(touchRect.x + touchRect.width / 2, touchRect.y + touchRect.height / 2);
  assert.equal(await secondRadio.isChecked(), true, "可信触控应切换 radio");
  assert.equal(await radio.isChecked(), false, "同名 radio 应保持互斥");
  assert.equal(await secondRadio.evaluate(el => document.activeElement === el), false, "触控不应聚焦 radio");
  assert.notEqual(checkedRadioBg, uncheckedRadioBg, "radio 选中/未选必须可区分");
  assert.notEqual(uncheckedBg, initial.beforeBackground, "checkbox 选中/未选必须可区分");

  await page.screenshot({ path: "test-results/pool-dots-comparison.png", fullPage: false });
  console.log("✓ 鼠标/触控焦点隔离、Tab/Space、节点/订阅圆点尺寸与状态检查通过（mock）");
  assert.equal(errors.length, 0, `页面错误: ${errors.join(", ")}`);
} finally {
  await page?.close();
  await browser.close();
}
