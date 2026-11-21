// Mock-only navigation acceptance. Never starts Satelite or a proxy core.
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createServer } from "vite";

if (process.env.CI !== "true") throw new Error("仅允许在 CI/mock 路径运行");
if (!process.env.PLAYWRIGHT_MODULE) throw new Error("缺少 PLAYWRIGHT_MODULE");
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const base = "http://127.0.0.1:1442";
const output = "test-results/flclash-navigation";
await mkdir(output, { recursive: true });

const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
const settingsSource = await readFile(new URL("../src/pages/SettingsPage.tsx", import.meta.url), "utf8");
assert.match(appSource, /\{nav === "chains" && <ChainPage \/>\}/, "App 独立渲染非 embedded 链页");
assert.doesNotMatch(settingsSource, /ChainPage|visibleTab === "chain"|id: "chain"/, "设置页无链页残留");

const server = await createServer({ server: { host: "127.0.0.1", port: 1442, strictPort: true } });
await server.listen();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, serviceWorkers: "block" });
  const errors = [];
  const blocked = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin === base) return route.continue();
    blocked.push(url.origin);
    return route.abort();
  });
  await page.goto(`${base}/scripts/ui-smoke/flclash-navigation.html`);
  const chainNav = page.locator(".side-nav-item").filter({ has: page.locator('[data-lucide="link"]') });
  await chainNav.click();
  await page.locator(".page.chain-page").waitFor();
  assert.equal(await chainNav.getAttribute("aria-current"), "page", "侧栏代理链进入激活态");
  assert.equal(await page.locator(".chain-embed").count(), 0, "链页不是设置页 embedded 模式");
  assert.equal(await page.locator(".chain-page h1").innerText(), "代理链");
  await page.locator(".chain-card").first().waitFor();
  await page.screenshot({ path: `${output}/chain-page.png`, fullPage: true });

  await page.getByRole("button", { name: "设置", exact: true }).click();
  const settings = page.locator(".settings-page");
  await settings.waitFor();
  const tabs = settings.locator(":scope > .glass-seg");
  assert.equal(await tabs.getByRole("button").count(), 7, "设置页保留其余七个标签页");
  assert.equal(await tabs.getByRole("button", { name: "代理链", exact: true }).count(), 0, "设置页不再出现代理链标签");
  await page.screenshot({ path: `${output}/settings-page.png`, fullPage: true });

  assert.deepEqual(errors, [], "页面异常");
  assert.deepEqual(blocked, [], "禁止外部网络");
  assert.deepEqual(await page.evaluate(() => window.navigationFixture.unexpected), [], "禁止未声明 IPC");
  console.log(JSON.stringify({
    result: "PASS",
    chainPage: "non-embedded",
    settingsTabs: 7,
    chainSettingsTab: false,
    screenshots: [`${output}/chain-page.png`, `${output}/settings-page.png`],
  }, null, 2));
} finally {
  await browser.close();
  await server.close();
}
