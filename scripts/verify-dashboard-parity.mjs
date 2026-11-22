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
    await open();
    await page.waitForFunction(() => document.querySelector(".dashboard-app-version")?.textContent === "SATELITE · 1.0.47");
    assert.equal(await page.evaluate(() => window.dashboardFixture.commands.filter(c => c.command === "plugin:app|version").length), 1);
    assert.equal(await page.locator(".dashboard-heading .dashboard-app-version").isVisible(), true);
    checks++;
    // Switching capture still calls the same mock IPC, but never opens the
    // removed restart notice. Run a complete off → system → off → system cycle.
    const capture = page.locator(".dash-capture");
    const restartNotice = page.locator(".system-proxy-restart-modal");
    assert.equal(await restartNotice.count(), 0);
    for (const mode of ["system", "off", "system"]) {
      await capture.getByRole("button", { name: mode === "system" ? "系统" : "关闭", exact: true }).click();
      await page.waitForFunction(expected => window.dashboardFixture.status.capture_mode === expected &&
        !document.querySelector(".dash-capture .lat-spinner"), mode);
      // The fixture status changes before the invoke promise resolves; wait for
      // the resulting React commit instead of sampling the pre-callback DOM.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await restartNotice.count(), 0, `切换到 ${mode} 后不得出现重启提示弹窗`);
    }
    assert.deepEqual(await page.evaluate(() => window.dashboardFixture.commands
      .filter(c => c.command === "set_capture_mode").map(c => c.payload.mode)), ["system", "off", "system"],
    "关闭/系统切换与生效逻辑保持不变");
    await capture.getByRole("button", { name: "关闭", exact: true }).click();
    await page.waitForFunction(() => window.dashboardFixture.status.capture_mode === "off");
    checks++;
    await page.waitForFunction(() => document.querySelector(".dashboard-probe-card")?.getAttribute("aria-busy") === "false");
    const beforeNetwork = await page.evaluate(() => ({
      ip: window.dashboardFixture.exitIpReads,
      latency: window.dashboardFixture.commands.filter(c => c.command === "test_nodes_latency").length,
    }));
    await page.evaluate(() => { window.dashboardFixture.holdExitIp = true; });
    const probe = page.getByRole("button", { name: "网络探测", exact: true });
    await probe.focus();
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => window.dashboardFixture.releaseExitIp !== null);
    assert.equal(await probe.getAttribute("aria-busy"), "true");
    await page.keyboard.press("Enter");
    const duringNetwork = await page.evaluate(() => ({
      ip: window.dashboardFixture.exitIpReads,
      latency: window.dashboardFixture.commands.filter(c => c.command === "test_nodes_latency").length,
    }));
    assert.deepEqual(duringNetwork, { ip: beforeNetwork.ip + 1, latency: beforeNetwork.latency + 1 });
    await page.evaluate(() => {
      window.dashboardFixture.holdExitIp = false;
      window.dashboardFixture.releaseExitIp();
    });
    await page.waitForFunction(() => document.querySelector(".dashboard-probe-card")?.getAttribute("aria-busy") === "false");
    assert.match(await probe.textContent(), /42 ms/);
    checks++;
    // Speed cards consume the same status snapshot, with no extra polling.
    const rate = direction => page.locator(`.dashboard-rate-card[data-direction="${direction}"]`);
    assert.equal(await rate("up").locator(".dashboard-rate-card__rate").getAttribute("title"), "3.0 KB/s");
    assert.equal(await rate("down").locator(".dashboard-rate-card__rate").getAttribute("title"), "12.0 KB/s");
    await rate("up").getByRole("button").click();
    await rate("down").getByRole("button").click();
    assert.equal(await page.evaluate(() => window.dashboardFixture.trafficOpens), 2);
    await page.evaluate(() => {
      const s = window.dashboardFixture.status;
      s.upload_speed = 1024 * 1024;
      s.download_speed = 2 * 1024 * 1024;
    });
    await page.waitForFunction(() => document.querySelector('[data-direction="up"] .dashboard-rate-card__rate')?.title === "1.0 MB/s");
    assert.match(await rate("up").locator(".dashboard-rate-card__stats").textContent(), /1\.0 MB\/s/);
    await page.evaluate(() => {
      const s = window.dashboardFixture.status;
      s.core_started_at++;
      s.upload_speed = 1024;
      s.download_speed = 2048;
    });
    await page.waitForFunction(() => document.querySelector('[data-direction="up"] .dashboard-rate-card__rate')?.title === "1.0 KB/s");
    assert.match(await rate("up").locator(".dashboard-rate-card__stats").textContent(), /1\.0 KB\/s/);
    assert.doesNotMatch(await rate("up").locator(".dashboard-rate-card__stats").textContent(), /MB\/s/);
    await page.getByRole("button", { name: "停止代理", exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[data-direction="up"]')?.dataset.running === "false");
    for (const direction of ["up", "down"]) {
      assert.equal(await rate(direction).locator(".dashboard-rate-card__rate").getAttribute("title"), "0 B/s");
    }
    assert.deepEqual(await page.evaluate(() => window.dashboardFixture.unexpected), []);
    checks++;
    assert.deepEqual(errors, []);
    console.log(`Dashboard parity: ${checks} scenarios passed (mock IPC only)`);
  } finally {
    await browser.close();
    await server.close();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runDashboardParity();
