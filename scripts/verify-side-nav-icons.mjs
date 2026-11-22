// Mock-only visual regression. This starts Vite and Chromium, never Satelite
// or a proxy core. Run with the same Playwright environment as the UI suite.
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createServer } from "vite";

if (process.env.CI !== "true") throw new Error("仅允许在 CI/mock 路径运行");
if (!process.env.PLAYWRIGHT_MODULE) throw new Error("缺少 PLAYWRIGHT_MODULE");
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const base = "http://127.0.0.1:1441";
const output = "test-results/side-nav-icons";
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const server = await createServer({ server: { host: "127.0.0.1", port: 1441, strictPort: true } });
await server.listen();
const browser = await chromium.launch({ headless: true });
const expected = {
  "layout-grid": { path: 0, rect: 4, circle: 0 },
  network: { path: 2, rect: 3, circle: 0 },
  link: { path: 2, rect: 0, circle: 0 },
  "sliders-horizontal": { path: 9, rect: 0, circle: 0 },
  activity: { path: 1, rect: 0, circle: 0 },
  "file-text": { path: 5, rect: 0, circle: 0 },
  settings: { path: 1, rect: 0, circle: 1 },
};
// Exact children of the official lucide-icons/lucide@c1a02a0 file-text.svg.
const FILE_TEXT_PATHS = [
  "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z",
  "M14 2v5a1 1 0 0 0 1 1h5",
  "M10 9H8",
  "M16 13H8",
  "M16 17H8",
];
const names = Object.keys(expected);
const evidence = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
  const errors = [];
  const blocked = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin === base) return route.continue();
    blocked.push(url.origin);
    return route.abort();
  });
  await page.goto(`${base}/scripts/ui-smoke/dashboard.html?sample=short&locale=zh&theme=aerospace`);
  await page.locator(".side-nav-items [data-lucide]").first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  // Screenshot the terminal states, never a frame of the intentional 200ms
  // SideNav color/indicator transition. Production CSS is not modified.
  await page.addStyleTag({ content: ".pro-shell .side-nav *, main > .page-enter { transition: none !important; animation: none !important; }" });
  const primaryColor = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--primary)";
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  const buttons = page.locator(".side-nav-items .side-nav-item");
  assert.equal(await buttons.count(), 7, "真实 SideNav 七个入口");
  assert.deepEqual(await page.locator(".side-nav-items [data-lucide]").evaluateAll(
    icons => icons.map(icon => icon.getAttribute("data-lucide")),
  ), names, "七个 Lucide 名称及顺序");

  for (let index = 0; index < names.length; index++) {
    const name = names[index];
    const button = buttons.nth(index);
    // Make the target inactive first; the dashboard starts active by default.
    if (await button.getAttribute("aria-current") === "page") {
      await buttons.nth((index + 1) % names.length).click();
    }
    const svg = button.locator("svg[data-lucide]");
    const snapshot = () => svg.evaluate(icon => ({
      markup: icon.innerHTML,
      viewBox: icon.getAttribute("viewBox"),
      fill: icon.getAttribute("fill"),
      stroke: icon.getAttribute("stroke"),
      strokeWidth: icon.getAttribute("stroke-width"),
      color: getComputedStyle(icon).color,
      counts: {
        path: icon.querySelectorAll("path").length,
        rect: icon.querySelectorAll("rect").length,
        circle: icon.querySelectorAll("circle").length,
      },
      solidChild: icon.querySelector('[fill="currentColor"], [stroke="none"]') !== null,
      width: getComputedStyle(icon).width,
      height: getComputedStyle(icon).height,
    }));
    await page.mouse.move(0, 0);
    const normal = await snapshot();
    assert.equal(normal.viewBox, "0 0 24 24", `${name}: viewBox`);
    assert.equal(normal.fill, "none", `${name}: 无实心切换`);
    assert.equal(normal.stroke, "currentColor", `${name}: 描边跟随文字色`);
    assert.equal(normal.strokeWidth, "1.7", `${name}: 描边宽`);
    assert.equal(normal.solidChild, false, `${name}: 不存在 activePath 实心数据`);
    assert.deepEqual(normal.counts, expected[name], `${name}: 官方图形节点数`);
    if (name === "file-text") {
      assert.deepEqual(await svg.locator("path").evaluateAll(paths => paths.map(path => path.getAttribute("d"))),
        FILE_TEXT_PATHS, "logs: Lucide 官方 file-text 原始路径");
    }
    await button.screenshot({ path: `${output}/${String(index + 1).padStart(2, "0")}-${name}-normal.png` });

    await button.click();
    assert.equal(await button.getAttribute("aria-current"), "page", `${name}: 激活`);
    const active = await snapshot();
    assert.equal(active.markup, normal.markup, `${name}: 激活前后同一 SVG`);
    assert.equal(active.color, primaryColor, `${name}: 激活描边必须为主题色`);
    assert.notEqual(active.color, normal.color, `${name}: 普通/激活颜色不同`);
    await page.waitForFunction(i => {
      const button = document.querySelectorAll(".side-nav-items .side-nav-item")[i];
      const indicator = document.querySelector(".side-nav-indicator");
      return getComputedStyle(indicator).visibility === "visible" &&
        indicator.getBoundingClientRect().width === button.getBoundingClientRect().width;
    }, index);
    await button.screenshot({ path: `${output}/${String(index + 1).padStart(2, "0")}-${name}-active.png` });
    evidence.push({
      name,
      normalStyle: { width: normal.width, height: normal.height, color: normal.color },
      activeStyle: { width: active.width, height: active.height, color: active.color },
      unchanged: active.markup === normal.markup,
    });
  }
  const logs = evidence.find(icon => icon.name === "file-text");
  const peer = evidence.find(icon => icon.name === "activity");
  assert.deepEqual(logs.normalStyle, peer.normalStyle, "logs 普通态 computed 尺寸/颜色与同列流量项一致");
  assert.deepEqual(logs.activeStyle, peer.activeStyle, "logs 激活态 computed 尺寸/颜色与同列流量项一致");
  assert.deepEqual(errors, [], "页面异常");
  assert.deepEqual(blocked, [], "禁止外部网络");
  assert.deepEqual(await page.evaluate(() => window.dashboardFixture.unexpected), [], "禁止未声明 IPC");
  console.log(JSON.stringify({ result: "PASS", icons: evidence.length, screenshots: evidence.length * 2, evidence }, null, 2));
} finally {
  await browser.close();
  await server.close();
}
