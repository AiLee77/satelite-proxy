// Local/CI mock-only regression. Never launches Satelite or a proxy core.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { createServer } from "vite";

export async function runDashboardParity() {
  if (!process.env.PLAYWRIGHT_MODULE) throw new Error("Set PLAYWRIGHT_MODULE to playwright/index.mjs");
  const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
  const server = await createServer({ server: { host: "127.0.0.1", port: 1441, strictPort: true } });
  await server.listen();
  const browser = await chromium.launch({ headless: true });
  let checks = 0;
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => new URL(route.request().url()).origin === "http://127.0.0.1:1441"
      ? route.continue() : route.abort());
    async function open(query = "") {
      await page.goto(`http://127.0.0.1:1441/scripts/ui-smoke/dashboard.html?sample=short&${query}`);
      await page.waitForFunction(() => document.querySelector(".dash-hero-title")?.textContent.trim() && !document.querySelector(".dashboard-page .skel"));
      await page.waitForFunction(() => !document.querySelector(".dashboard-probe-card [aria-label='正在探测']"));
    }
    for (const [chain, protocol] of [["node", true], ["pool", false], ["missing", false]]) {
      await open(`chain=${chain}`);
      const description = await page.locator(".dash-hero-desc").textContent();
      assert.match(description, /链 · 2 跳/);
      assert.equal(description.includes("TROJAN"), protocol);
      assert.equal(description.includes("87 ms"), protocol);
      await page.locator(".dashboard-probe-card").click();
      assert.equal(await page.evaluate(() => window.dashboardFixture.commands.some(c => c.command === "test_nodes_latency")), false);
      assert.deepEqual(await page.evaluate(() => window.dashboardFixture.unexpected), []);
      checks++;
    }
    assert.deepEqual(errors, []);
    console.log(`Dashboard parity: ${checks} scenarios passed (mock IPC only)`);
  } finally {
    await browser.close();
    await server.close();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runDashboardParity();
