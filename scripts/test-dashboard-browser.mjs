import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";

// 本机仅 node --check；浏览器与 Vite 服务由 CI 工作流负责。
if (process.env.CI !== "true") throw new Error("此浏览器测试仅允许在 CI 运行");
if (!process.env.PLAYWRIGHT_MODULE) throw new Error("缺少 PLAYWRIGHT_MODULE");
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const base = "http://127.0.0.1:1440";
await mkdir("test-results", { recursive: true });
const browser = await chromium.launch({ headless: true });
let context, page;
let currentCase = "setup";
let errors = [], blocked = [];
const batch10Checks = [];
function checkBatch10(name, passed, detail = "") {
  batch10Checks.push({ name, result: passed ? "绿" : "红", detail: String(detail) });
}
const words = {
  zh: { stop: "停止代理", start: "启动代理", routing: "路由模式", global: "全局", rule: "规则", state: "运行中", config: "指定配置", generated: "系统默认" },
  en: { stop: "Stop", start: "Start", routing: "Routing mode", global: "Global", rule: "Rule", state: "Running", config: "Choose config", generated: "System default" },
};
async function clean() {
  assert.deepEqual(await page.evaluate(() => window.dashboardFixture.unexpected), [], "禁止未声明 IPC");
  assert.deepEqual(blocked, [], "夹具不得发起外部网络请求");
  assert.deepEqual(errors, [], `${currentCase} 页面异常`);
}
async function heroMotion(running) {
  const selector = ".dash-hero .orbit";
  const name = await page.locator(selector).evaluate(el => getComputedStyle(el.querySelector(".orbit-sat")).animationName);
  assert.equal(name, running ? "orbit-spin" : "none", "hero 轨道动效跟随运行状态");
  const spinning = await page.locator(selector).evaluate(el => el.classList.contains("spin"));
  assert.equal(spinning, running, "运行时轨道 spin 类跟随启停");
}
async function open(width, height, locale, theme, state = "running", hero = "classic", network = "business", sample = "long", menuOptions = {}) {
  if (page) await clean();
  if (context) await context.close();
  errors = []; blocked = [];
  currentCase = `${width}x${height}-${locale}-${theme}-${state}-${sample}`;
  context = await browser.newContext({ viewport: { width, height }, serviceWorkers: "block" });
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin === base) return route.continue();
    blocked.push(url.origin);
    return route.abort();
  });
  await context.routeWebSocket("**/*", socket => {
    if (new URL(socket.url()).origin === base.replace("http:", "ws:")) socket.connectToServer();
    else { blocked.push(new URL(socket.url()).origin); socket.close(); }
  });
  page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${base}/scripts/ui-smoke/dashboard.html?${new URLSearchParams({ locale, theme, state, hero, network, sample, ...menuOptions })}`);
  await page.locator(".instrument-grid-6 > :nth-child(4)").waitFor({ state: "attached" });
  await page.waitForFunction(({ theme }) =>
    document.documentElement.dataset.theme === theme &&
    document.querySelector(".dash-hero-title")?.getAttribute("title")?.length > 0 &&
    !document.querySelector(".dashboard-page .skel"),
  { theme });
  await page.evaluate(() => document.fonts.ready);
  // 与 App 相同的 page-enter 会暂时创建 transform 容器；等其退出再测量和截图。
  await page.waitForFunction(() => [...document.querySelectorAll("main > .page-enter")].every(el =>
    el.getAnimations().every(animation => animation.playState === "finished") && getComputedStyle(el).transform === "none"));
}

async function layout() {
  const issues = await page.evaluate(() => {
    const issues = [];
    const root = document.documentElement;
    const dashboard = document.querySelector(".dashboard-page");
    const cards = [...dashboard.querySelectorAll(".dash-hero, .dash-side-rail, .instrument-grid-6 > *")];
    const describe = el => `${el.tagName}.${el.className}`;
    const outside = (r, box) => r.left < box.left - 1.5 || r.right > box.right + 1.5 || r.top < box.top - 1.5 || r.bottom > box.bottom + 1.5;
    for (const el of [root, document.body, document.querySelector("main"), dashboard, ...cards]) {
      if (el.scrollWidth > el.clientWidth + 1) issues.push(`横向溢出 ${describe(el)}`);
    }
    for (const card of cards) {
      const box = card.getBoundingClientRect();
      if (box.width < 1 || box.height < 1) issues.push(`空卡片 ${describe(card)}`);
      if (card.scrollHeight > card.clientHeight + 1) issues.push(`卡片纵向裁切 ${describe(card)}`);
      for (const other of cards) {
        if (card === other || card.contains(other) || other.contains(card)) continue;
        const b = other.getBoundingClientRect();
        if (box.left < b.right - 1.5 && box.right > b.left + 1.5 && box.top < b.bottom - 1.5 && box.bottom > b.top + 1.5) issues.push(`卡片重叠 ${describe(card)} / ${describe(other)}`);
      }
    }
    // 节点标题必须完整换行；统计数值必须完整可见。批次 8-C：组织小字迁
    // IP 信息标签行末尾后为单行省略（ellipsis），不再是「完整换行」口径，
    // 其截断规格由 structure() 的 textOverflow 断言守护，移出本清单。
    const critical = ".dashboard-exit-ip, .dash-hero-title, .traffic-stats-number, .traffic-stats-table th";
    for (const el of dashboard.querySelectorAll(critical)) {
      if (!el.textContent.trim()) { issues.push(`统计为空 ${describe(el)}`); continue; }
      if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) issues.push(`统计裁切 ${describe(el)}`);
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        if (!walker.currentNode.textContent.trim()) continue;
        const range = document.createRange(); range.selectNodeContents(walker.currentNode);
        for (const rect of range.getClientRects()) {
          if (outside(rect, el.getBoundingClientRect())) issues.push(`文字超出统计单元 ${describe(el)}`);
          for (let ancestor = el.parentElement; ancestor && ancestor !== document.querySelector("main"); ancestor = ancestor.parentElement) {
            const style = getComputedStyle(ancestor);
            const box = ancestor.getBoundingClientRect();
            if (style.overflowX !== "visible" && (rect.left < box.left - 1.5 || rect.right > box.right + 1.5)) issues.push(`祖先横向裁字 ${describe(el)}`);
            if (style.overflowY !== "visible" && (rect.top < box.top - 1.5 || rect.bottom > box.bottom + 1.5)) issues.push(`祖先纵向裁字 ${describe(el)}`);
          }
        }
      }
    }
    return [...new Set(issues)];
  });
  assert.deepEqual(issues, [], `${currentCase} 布局/统计文字`);
}
async function heroGeometry() {
  await page.waitForFunction(() => document.querySelector('.dash-hero .dashboard-exit-org')?.textContent === window.dashboardFixture.organization);
  const metrics = await page.evaluate(() => {
    const hero = document.querySelector('.dash-hero');
    const copy = hero.querySelector('.dash-hero-copy');
    const title = copy.querySelector('.dash-hero-title');
    const actions = hero.querySelector('.dash-hero-actions');
    const box = hero.getBoundingClientRect(), content = copy.getBoundingClientRect();
    const a = actions.getBoundingClientRect(), t = title.getBoundingClientRect();
    const style = getComputedStyle(hero), textStyle = getComputedStyle(title);
    const range = document.createRange(); range.selectNodeContents(title);
    const lines = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0);
    const buttons = [...actions.querySelectorAll('.secondary, .dash-more-btn')].map(el => el.getBoundingClientRect());
    return {
      height: box.height, serviceHeight: document.querySelector('.instrument-grid-6 .service-status-card').getBoundingClientRect().height,
      below: a.top >= t.bottom - 1,
      buttonsBelow: buttons.length === 2 && buttons.every(b => b.top >= t.bottom - 1 && b.bottom <= a.bottom + 1),
      fullWidth: Math.abs(t.left - content.left) <= 1 && Math.abs(t.right - content.right) <= 1,
      complete: title.textContent === window.dashboardFixture.nodes[0].name,
      wraps: textStyle.whiteSpace === 'normal' && textStyle.textOverflow === 'clip' && textStyle.webkitLineClamp === 'none',
      lineCount: new Set(lines.map(rect => Math.round(rect.top))).size,
      textInside: lines.every(rect => rect.left >= t.left - 1 && rect.right <= t.right + 1 && rect.top >= t.top - 1 && rect.bottom <= t.bottom + 1),
      // 既检查卡片外部余量，也检查 copy 自身是否被撑高。
      bottomSlack: box.bottom - content.bottom - parseFloat(style.paddingBottom) - parseFloat(style.borderBottomWidth),
      copySlack: content.bottom - a.bottom,
      short: window.dashboardFixture.short,
    };
  });
  assert.equal(metrics.below && metrics.buttonsBelow, true, `${currentCase} 切换节点与更多按钮独立位于节点下方`);
  assert.equal(metrics.fullWidth, true, `${currentCase} 节点标题占满 copy 可用宽度`);
  assert.equal(metrics.complete && metrics.wraps && metrics.textInside, true, `${currentCase} 节点标题完整且无裁切`);
  if (!metrics.short) assert.ok(metrics.lineCount >= 2, `${currentCase} 长节点名称实际换行`);
  assert.ok(Math.abs(metrics.bottomSlack) <= 2 && Math.abs(metrics.copySlack) <= 2, `${currentCase} copy 底部加 padding 后无多余空白 ${JSON.stringify(metrics)}`);
  return metrics;
}

async function serviceRoundTrip(saveScreenshot = false) {
  const settled = async count => page.waitForFunction(count => {
    const rows = [...document.querySelectorAll('.service-status-card-row')];
    return document.querySelector('.dash-hero .dashboard-exit-org')?.textContent === window.dashboardFixture.organization &&
      rows.length === count && rows.every(row => row.querySelector('.service-status-state')?.getAttribute('data-status') ===
        (['chatgpt', 'youtube'].includes(row.getAttribute('data-service-id')) ? 'available' : 'reachable')) &&
      !document.querySelector('.service-status-card .service-status-checking');
  }, count);
  await settled(2);
  const before = await heroGeometry();
  for (const count of [4, 2]) {
    currentCase = currentCase.replace(/-services-\d+$/, '') + `-services-${count}`;
    await page.locator('.service-status-card').click();
    await page.getByRole('dialog').waitFor();
    for (const name of ['YouTube', 'ChatGPT']) {
      await page.getByRole('switch', { name: `在卡片展示 ${name}`, exact: true }).setChecked(count === 4);
    }
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await settled(count);
    const after = await heroGeometry();
    assert.ok(Math.abs(after.height - before.height) <= 2, `${currentCase} 2→4→2 服务不改变 hero 高度 ${before.height} → ${after.height}`);
    if (count === 4) assert.ok(after.serviceHeight > before.serviceHeight + 2, `${currentCase} 服务状态卡确实增高`);
    await layout();
    if (count === 4 && saveScreenshot) await page.screenshot({ path: 'test-results/dashboard-1280-four-services.png' });
  }
}
async function assertExitDetails(source, checkedAt, verifyCopy = false) {
  await page.getByRole('button', { name: 'IP 信息 ↗', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'IP 信息', exact: true });
  await dialog.waitFor();
  const sourceRow = dialog.locator('dt:text-is("出口检测来源") + dd');
  const timeRow = dialog.locator('dt:text-is("出口检测时间") + dd');
  assert.equal(await sourceRow.locator('.ip-exit-source-url').textContent(), source, '显示当前检测返回的完整 URL');
  assert.equal(await dialog.locator('dt:text-is("资料来源") + dd').textContent(), 'IPQuery / proxycheck.io');
  if (checkedAt) assert.equal(await timeRow.locator('time').getAttribute('datetime'), checkedAt, '以 Unix 毫秒解释出口检测时间');
  else assert.equal(await timeRow.textContent(), '—', '兼容没有出口检测时间的旧响应');
  if (verifyCopy) {
    await page.evaluate(() => {
      Object.defineProperty(navigator.clipboard, 'writeText', {
        value: async text => { window.dashboardFixture.copiedExitUrl = text; },
      });
    });
    await sourceRow.getByRole('button', { name: '复制检测 URL' }).click();
    await sourceRow.getByText('已复制', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.dashboardFixture.copiedExitUrl), source, '复制时保留 URL 原文');
  }
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
}
async function countryRefresh() {
  const button = page.locator('.dashboard-country-button');
  await page.waitForFunction(() => document.querySelector('.dashboard-country-button text')?.textContent === 'HK');
  assert.equal(await button.getAttribute('aria-label'), '刷新 出口IP');
  await page.waitForFunction(() => document.querySelector('.dash-hero .dashboard-exit-org')?.textContent === window.dashboardFixture.organization);
  await assertExitDetails('https://example.test/cdn-cgi/trace?format=plain%20text', '2023-11-14T22:13:20.000Z', true);
  const metadataCalls = await page.evaluate(() => window.dashboardFixture.commands.filter(c => c.command === 'check_ip_metadata').length);
  for (const [country, text] of [['US', 'US'], ['', '—'], ['invalid', '—']]) {
    const before = await page.evaluate(country => {
      window.dashboardFixture.countryCode = country;
      window.dashboardFixture.exitSource = 'https://example.test/geoip';
      window.dashboardFixture.exitCheckedAt = country === 'US' ? 1_700_000_001_000 : undefined;
      window.dashboardFixture.holdExitIp = true;
      return window.dashboardFixture.exitIpReads;
    }, country);
    if (country === 'US') await button.click();
    else { await button.focus(); await page.keyboard.press('Enter'); }
    await page.waitForFunction(() => window.dashboardFixture.releaseExitIp !== null);
    assert.equal(await button.isDisabled(), true, '探测中禁止重复点击');
    assert.equal(await button.getAttribute('aria-busy'), 'true');
    assert.equal(await page.locator('.dash-hero .dashboard-exit-org').textContent(), await page.evaluate(() => window.dashboardFixture.organization), '刷新出口期间保留同IP组织信息，不清空闪烁');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => window.dashboardFixture.exitIpReads), before + 1, '每次点击仅发一个 check_exit_ip，忙碌时不重复');
    await page.evaluate(() => {
      window.dashboardFixture.holdExitIp = false;
      window.dashboardFixture.releaseExitIp();
    });
    await page.waitForFunction(() => document.querySelector('.dashboard-country-button')?.getAttribute('aria-busy') === 'false');
    assert.equal(await button.locator('text').textContent(), text, '国家代码来自当前出口结果，未知使用占位');
    assert.equal(await page.locator('.dashboard-exit-ip-address').textContent(), await page.evaluate(() => window.dashboardFixture.ipv6));
    assert.equal(await page.evaluate(() => window.dashboardFixture.commands.filter(c => c.command === 'check_ip_metadata').length), metadataCalls, '相同IP刷新复用元数据缓存');
    if (country === 'US' || country === 'invalid') {
      await assertExitDetails('https://example.test/geoip', country === 'US' ? '2023-11-14T22:13:21.000Z' : null);
    }
  }
  await layout();
}
async function freshServicesOnResume() {
  await page.waitForFunction(() => [...document.querySelectorAll('.service-status-card-row')].length === 2 &&
    [...document.querySelectorAll('.service-status-card-row')].every(row => row.querySelector('[data-status="reachable"]')) &&
    !document.querySelector('.service-status-card .service-status-checking'));
  const counts = await page.evaluate(async () => {
    const count = () => window.dashboardFixture.commands.filter(c => c.command === 'check_service_status').length;
    const before = count();
    const original = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    try {
      for (let i = 0; i < 3; i++) {
        window.dispatchEvent(new Event('focus'));
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
        document.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new Event('focus'));
      }
      await new Promise(resolve => setTimeout(resolve, 150));
      return { before, after: count() };
    } finally {
      if (original) Object.defineProperty(document, 'visibilityState', original);
      else delete document.visibilityState;
    }
  });
  assert.equal(counts.after, counts.before, '近期服务结果在重复 focus / hidden→visible 后不新增 IPC');
}
// 返修 C-3：标签行（含组织）用已有数据立即渲染；换 IP 后元数据请求只做后台刷新——
// busy 期间保留原标签/组织不清空，不重复请求，返回后整体替换。
async function exitIpMetadataBackgroundRefresh() {
  await page.waitForFunction(() => document.querySelector('.dash-hero .dashboard-exit-org')?.textContent === window.dashboardFixture.organization);
  const before = await page.evaluate(() => window.dashboardFixture.commands.filter(c => c.command === 'check_ip_metadata').length);
  await page.evaluate(() => {
    window.dashboardFixture.ipOverride = '198.51.100.77';
    window.dashboardFixture.orgOverride = 'New Exit Org Fixture';
    window.dashboardFixture.holdMetadata = true;
  });
  await page.locator('.dashboard-country-button').click();
  // 出口 IP 随新结果立即渲染，不等元数据往返。
  await page.waitForFunction(() => document.querySelector('.dash-hero .dashboard-exit-ip-address')?.textContent === '198.51.100.77');
  await page.waitForFunction(() => document.querySelector('.ip-info-badges .ip-info-hint')?.textContent === '查询中…');
  assert.equal(await page.locator('.dash-hero .dashboard-exit-org').textContent(), await page.evaluate(() => window.dashboardFixture.organization), '换 IP 后台刷新期间保留已显示组织，不清空闪烁');
  assert.equal(await page.locator('.dash-hero .ip-info-badges .ip-quality-good').count(), 1, '后台刷新期间保留质量标签');
  assert.equal(await page.locator('.dash-hero .ip-info-badges .ip-network-tag').count(), 1, '后台刷新期间保留商业标签');
  await page.evaluate(() => window.dashboardFixture.releaseMetadata());
  await page.waitForFunction(() => document.querySelector('.dash-hero .dashboard-exit-org')?.textContent === 'New Exit Org Fixture');
  const after = await page.evaluate(() => window.dashboardFixture.commands.filter(c => c.command === 'check_ip_metadata').length);
  assert.equal(after, before + 1, '换 IP 仅发一次后台元数据刷新，不重复请求');
  assert.equal(await page.locator('.ip-info-badges .ip-info-hint').count(), 0, '刷新完成不再显示查询中');
}
async function structure(locale) {
  const navigation = page.locator(".app-shell > .topnav-wrap .topnav").getByRole("navigation");
  assert.equal(await navigation.count(), 1, "必须使用真实 TopNav 导航");
  assert.equal(await navigation.getByRole("button").count(), 7, "七个页面入口（含代理链）");
  assert.equal(await navigation.locator(".active").count(), 1);
  assert.equal(await navigation.locator(".active").textContent(), locale === "zh" ? "概览" : "Overview");
  assert.equal(await page.locator(".app-shell > aside").count(), 0, "禁止空白占位侧栏");
  assert.equal(await page.locator(".topnav-tools .topnav-theme-switch").count(), 1);
  assert.equal(await page.locator(".topnav-tools [data-ui-mode-menu]").count(), 1);
  assert.equal(await page.locator(".dashboard-page").count(), 1);
  assert.equal(await page.evaluate(() => document.querySelector(".dashboard-page").classList.contains("dashboard-bento")), false, "恢复原版页面结构，不用 bento 覆盖层");
  assert.equal(await page.locator(".dashboard-heading").count(), 0, "无独立 heading");
  assert.equal(await page.locator(".dash-kicker").count(), 0, "删「● 运行中 · SATELITE」状态行，不留空白");
  assert.equal(await page.evaluate(() => document.querySelector(".dash-hero-copy").firstElementChild?.className), "dashboard-exit-summary", "hero 文案区首行即出口 IP 区，直接从大号 IP 开始");
  assert.equal(await page.locator(".dashboard-page > .dash-hero").count(), 1, "hero 为页面首区块");
  assert.equal(await page.locator(".dashboard-rate-card").count(), 0, "上/下行速率不拆卡");
  assert.equal(await page.locator(".dash-hero > .dash-side-rail").count(), 1, "快捷面板归位 hero 第三列");
  assert.equal(await page.evaluate(() => {
    const ip = document.querySelector('.dash-hero .ip-info-panel').getBoundingClientRect();
    const title = document.querySelector('.dash-hero-title').getBoundingClientRect();
    return ip.bottom <= title.top + 1;
  }), true, "出口信息位于节点标题上方");
  await heroGeometry();
  const exit = await page.locator('.dashboard-exit-ip').evaluate(el => {
    const box = el.getBoundingClientRect();
    const title = document.querySelector('.dash-hero-title').getBoundingClientRect();
    const panel = document.querySelector('.dash-hero .ip-info-panel').getBoundingClientRect();
    const icon = document.querySelector('.dashboard-country-button').getBoundingClientRect();
    const rootSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
    return { text: el.querySelector('.dashboard-exit-ip-address')?.textContent, rem: parseFloat(getComputedStyle(el).fontSize) / rootSize,
      wrap: getComputedStyle(el).overflowWrap, iconWidth: icon.width, iconHeight: icon.height,
      beforeTitle: box.bottom <= title.top + 1, abovePanel: box.bottom <= panel.top + 1 };
  });
  const expectedIp = await page.evaluate(() => window.dashboardFixture.ipv6);
  assert.equal(exit.text, expectedIp, '主视觉保留完整 IPv4/IPv6');
  assert.ok(exit.rem >= (expectedIp.includes(':') ? 1.25 : 1.5) && exit.rem <= 1.7, '大 IP 字体比例');
  assert.equal(exit.wrap, 'anywhere', '长 IPv6 可完整换行');
  assert.ok(exit.iconWidth >= 44 && exit.iconWidth <= 48 && exit.iconHeight >= 44 && exit.iconHeight <= 48, '国家按钮触控尺寸');
  assert.ok(exit.beforeTitle && exit.abovePanel, '出口 IP 位于节点标题与类型徽章上方');
  const badge = await page.locator('.dashboard-country-button').evaluate(el => {
    const b = el.getBoundingClientRect(), svg = el.querySelector('svg').getBoundingClientRect(), text = el.querySelector('text').getBoundingClientRect();
    const style = getComputedStyle(el);
    return { padding: style.padding, background: style.backgroundColor,
      svgOffset: Math.abs(svg.left + svg.width / 2 - b.left - b.width / 2) + Math.abs(svg.top + svg.height / 2 - b.top - b.height / 2),
      textOffset: Math.abs(text.left + text.width / 2 - b.left - b.width / 2) };
  });
  assert.equal(badge.padding, '0px', '国家按钮不能继承通用按钮内边距');
  assert.equal(badge.background, 'rgba(0, 0, 0, 0)', '国家按钮保留 SVG 花形底图');
  assert.ok(badge.svgOffset < 2 && badge.textOffset < 2, '国家图形与代码在按钮内部居中');
  assert.equal(await page.locator(".dash-side-rail").count(), 1);
  assert.equal(await page.locator(".instrument-grid-6 > *").count(), 6, "六卡网格：核心/实时活动/流量统计/服务/订阅/端口");
  // 返修 B：六卡逐卡回原版 9.5rem=152px（±2），两排等高、底边成线；
  // 服务行/未知分类行增多时 minmax(9.5rem, auto) 照旧增长（回归锁不动）。
  const cardHeights = await page.locator(".instrument-grid-6 > *").evaluateAll(els => els.map(el => Math.round(el.getBoundingClientRect().height)));
  assert.ok(cardHeights.every(h => Math.abs(h - 152) <= 2), `六卡逐卡 152px±2（实测 ${cardHeights.join("/")}）`);
  assert.equal(new Set(cardHeights).size, 1, "六卡两排等高，底边成线");
  assert.equal(await page.locator(".dash-hero > .orbit").count(), 1, "hero 左列保留轨道动效");
  assert.equal(await page.locator(".instrument-grid-6 > .traffic-stats-card").count(), 1, "流量统计合卡位于六卡内");
  assert.equal(await page.locator(".instrument-grid-6 > .simple-spark").count(), 1, "实时活动位于六卡内");
  assert.equal(await page.locator(".instrument-grid-6 > .service-status-card").count(), 1, "服务状态卡入六卡网格（原网络探测卡位）");
  await page.waitForFunction(() => document.querySelector('.dash-hero .dashboard-exit-org')?.textContent === window.dashboardFixture.organization);
  // 返修 C-1：四同款胶囊同行（[IP 信息 ↗][商业][质量 优][组织]）；组织胶囊
  // 与商业胶囊同源描边/底色/圆角/字号/内边距，单行截断（截组织）。
  assert.equal(await page.locator('.dash-hero .dashboard-exit-org').evaluate(el => getComputedStyle(el).textOverflow), "ellipsis");
  const pillParity = await page.evaluate(() => {
    const org = document.querySelector('.dash-hero .ip-info-badges .ip-info-org');
    const network = document.querySelector('.dash-hero .ip-info-badges .ip-network-tag');
    if (!org || !network) return null;
    const a = getComputedStyle(org), b = getComputedStyle(network);
    const row = getComputedStyle(document.querySelector('.dash-hero .ip-info-badges'));
    return {
      tagClass: org.classList.contains('ip-info-tag'),
      parity: a.borderTopWidth === b.borderTopWidth && a.borderTopStyle === b.borderTopStyle && a.borderTopColor === b.borderTopColor
        && a.backgroundColor === b.backgroundColor && a.borderRadius === b.borderRadius
        && a.fontSize === b.fontSize && a.paddingTop === b.paddingTop && a.paddingLeft === b.paddingLeft,
      singleLine: a.whiteSpace === 'nowrap' && row.flexWrap === 'nowrap' && (() => {
        const o = org.getBoundingClientRect(), n = network.getBoundingClientRect();
        return o.left > n.left && o.top < n.bottom && o.bottom > n.top;
      })(),
      hugsText: a.textAlign === 'start',
    };
  });
  assert.equal(pillParity && pillParity.tagClass, true, "组织胶囊与 ip-info-tag 同源");
  assert.equal(pillParity && pillParity.parity, true, "组织胶囊描边/底色/圆角/字号/内边距与商业胶囊一致");
  assert.equal(pillParity && pillParity.singleLine, true, "四胶囊同行，组织单行截断不换行");
  assert.equal(pillParity && pillParity.hugsText, true, "组织胶囊贴合文本，不再整行填满右对齐");
  assert.ok((await page.locator('.ip-info-badges').innerText()).includes(locale === "zh" ? "商业" : "Commercial"));
  assert.equal(await page.locator('.service-status-card').count(), 1);
  for (const id of ["proxy", "direct", "total"]) {
    assert.equal(await page.locator(`[data-traffic-row="${id}"]`).isVisible(), true, `分类 ${id} 可见`);
  }
  assert.equal(await page.locator("main").getByRole("button", { name: words[locale].stop, exact: true }).isEnabled(), true);
  assert.equal(await page.locator("h1.dash-hero-title").getAttribute("title"), await page.evaluate(() => window.dashboardFixture.nodes[0].name));
  await page.waitForFunction(() => [...document.querySelectorAll(".instrument-grid-6 .kv-v")].some(el => el.textContent.includes(window.dashboardFixture.ipv6)));
  const coreKinds = await page.evaluate(() => window.dashboardFixture.commands.filter(c => c.command === "get_core_info").map(c => c.payload.kind));
  assert.deepEqual([...new Set(coreKinds)].sort(), ["mihomo", "singbox", "xray"]);
}

// 菜单回归只约束弹层和交互，不把正文的字号、间距或卡片样式带入缩放矩阵。
const menuSides = new Set();
async function settleMenus() {
  await page.evaluate(async () => {
    for (let i = 0; i < 3; i++) await new Promise(resolve => requestAnimationFrame(resolve));
  });
}
async function menuGeometry() {
  await settleMenus();
  // Playwright 视口不受 root zoom 改写 innerWidth 的影响；DOMRect/命中点均使用实际可见坐标。
  const result = await page.evaluate(viewport => {
    const issues = [];
    const tolerance = 2;
    const panels = [...document.querySelectorAll('.dash-more-menu, .dash-more-submenu')];
    const inside = (r, b) => r.left >= b.left - tolerance && r.right <= b.right + tolerance &&
      r.top >= b.top - tolerance && r.bottom <= b.bottom + tolerance;
    const boundsFor = el => {
      const bounds = { left: 0, top: 0, right: viewport.width, bottom: viewport.height };
      for (let parent = el.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent), rect = parent.getBoundingClientRect();
        const scaleX = rect.width / parent.offsetWidth || 1, scaleY = rect.height / parent.offsetHeight || 1;
        if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
          bounds.left = Math.max(bounds.left, rect.left + parent.clientLeft * scaleX);
          bounds.right = Math.min(bounds.right, rect.left + (parent.clientLeft + parent.clientWidth) * scaleX);
        }
        if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
          bounds.top = Math.max(bounds.top, rect.top + parent.clientTop * scaleY);
          bounds.bottom = Math.min(bounds.bottom, rect.top + (parent.clientTop + parent.clientHeight) * scaleY);
        }
      }
      return bounds;
    };
    for (const panel of panels) {
      const box = panel.getBoundingClientRect(), bounds = boundsFor(panel);
      if (box.width < 1 || box.height < 1 || !inside(box, bounds)) issues.push(`菜单越过实际可见范围 ${panel.className}: ${JSON.stringify({ box: box.toJSON(), bounds, style: panel.getAttribute('style'), anchor: panel.parentElement.getBoundingClientRect().toJSON(), window: [innerWidth, innerHeight], main: [document.querySelector('main').clientWidth, document.querySelector('main').offsetWidth] })}`);
      const overflow = getComputedStyle(panel);
      // overflow:visible 的主菜单包括外伸的子菜单，scrollWidth/Height 不代表裁切。
      // 子菜单独立测量实际边界；主菜单自己的按钮仍须全部落在主面板内。
      if (overflow.overflowX !== 'visible' && panel.scrollWidth > panel.clientWidth + 1) issues.push(`菜单横向裁切 ${panel.className}`);
      if (overflow.overflowY !== 'visible' && panel.scrollHeight > panel.clientHeight + 1 && !/(auto|scroll)/.test(overflow.overflowY)) issues.push(`菜单内容无法滚动 ${panel.className}`);
      for (const button of panel.querySelectorAll(':scope > button, :scope > .dash-more-sub > button')) {
        const rect = button.getBoundingClientRect();
        if (panel.classList.contains('dash-more-menu') && !inside(rect, box)) issues.push(`主菜单按钮超出面板 ${button.textContent}`);
        if (button.scrollWidth > button.clientWidth + 1 || button.scrollHeight > button.clientHeight + 1) issues.push(`菜单文字裁切 ${button.textContent}`);
        const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          if (!walker.currentNode.textContent.trim()) continue;
          const range = document.createRange(); range.selectNodeContents(walker.currentNode);
          if ([...range.getClientRects()].some(text => !inside(text, rect))) issues.push(`菜单文字超出按钮 ${button.textContent}`);
        }
      }
    }
    const sub = document.querySelector('.dash-more-submenu');
    if (!sub) return { issues };
    const anchor = sub.parentElement, a = anchor.getBoundingClientRect(), b = sub.getBoundingClientRect();
    const bounds = boundsFor(document.querySelector('.dash-more-menu'));
    const scale = a.width / anchor.offsetWidth;
    const fitsRight = a.right + 4 * scale + b.width <= bounds.right - 8;
    const fitsLeft = a.left - 4 * scale - b.width >= bounds.left + 8;
    // 空间够时检查默认向右/回退向左；空间不够时只要求夹紧且可操作。
    if (fitsRight && b.left < a.right - tolerance) issues.push('有右侧空间却未向右展开');
    if (!fitsRight && fitsLeft && b.right > a.left + tolerance) issues.push('右侧不足时未向左展开');
    return { issues, side: b.left >= a.right - tolerance ? 'right' : b.right <= a.left + tolerance ? 'left' : 'clamped' };
  }, page.viewportSize());
  assert.deepEqual(result.issues, [], `${currentCase} 菜单边界/文字`);
  if (result.side) menuSides.add(result.side);
  return result;
}
async function hoverConfigSubmenu(locale) {
  const root = page.locator('.dash-more-menu');
  const trigger = root.getByRole('menuitem', { name: words[locale].config, exact: true });
  await trigger.hover();
  await page.waitForFunction(() => document.querySelectorAll('.dash-more-submenu').length === 1);
  assert.equal(await trigger.getAttribute('aria-expanded'), 'true', `${currentCase} hover 打开指定配置`);
  await menuGeometry();
  return page.locator('.dash-more-submenu');
}
async function clickMenuOption(option) {
  await option.scrollIntoViewIfNeeded();
  const box = await option.boundingBox();
  assert.ok(box && box.width > 0 && box.height > 0, `${currentCase} 菜单选项非空`);
  // 分步经过真实指针路径，再跨过延迟关闭时限，检验 hover 从父项进入子菜单可持续。
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
  await page.waitForTimeout(320);
  await menuGeometry();
  assert.equal(await option.evaluate(el => {
    const r = el.getBoundingClientRect();
    return [[.1, .2], [.9, .2], [.5, .5], [.1, .8], [.9, .8]].every(([x, y]) =>
      el.contains(document.elementFromPoint(r.left + r.width * x, r.top + r.height * y)));
  }), true, `${currentCase} 选项命中区域未被祖先或相邻卡片遮挡`);
  await option.click();
  await page.locator('.dash-more-menu').waitFor({ state: 'hidden' });
}
async function closeMoreWithEscape() {
  await page.keyboard.press('Escape');
  await page.locator('.dash-more-menu').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.dash-more-submenu').count(), 0);
  assert.equal(await page.locator('.dash-more-btn').getAttribute('aria-expanded'), 'false');
  assert.equal(await page.locator('.dash-more-btn').evaluate(el => document.activeElement === el), true, 'Esc 关闭全部菜单并回焦触发按钮');
}
async function moreMenuRoundTrip(width, locale, zoom) {
  await open(width, 720, locale, locale === 'zh' ? 'day' : 'aerospace', 'running', 'classic', 'business', 'long', { menus: 'true', zoom: String(zoom) });
  const baseCase = `${width}x720-${locale}-zoom${zoom}-more`;
  currentCase = baseCase;
  assert.equal(await page.evaluate(() => Number(getComputedStyle(document.documentElement).zoom)), zoom);
  const more = page.locator('.dash-more-btn');
  for (const placement of ['default', 'right']) {
    currentCase = `${baseCase}-${placement}`;
    await more.scrollIntoViewIfNeeded();
    await page.evaluate(({ placement, width }) => window.dashboardFixture.placeMore(placement, width), { placement, width });
    await more.click();
    assert.equal(await more.getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('.dash-more-submenu').count(), 0, '新打开时无遗留子菜单');
    assert.equal(await page.locator('.dash-more-menu').getByRole('menuitem', {
      name: locale === 'zh' ? '切换内核' : 'Switch core', exact: true,
    }).count(), 0, '首页更多菜单已移除 dashboard.pickCore 重复入口');
    await menuGeometry();
    // 实际点击长配置名，再切回默认配置，验证可点击与选中状态。
    let submenu = await hoverConfigSubmenu(locale);
    if (zoom === 1) assert.equal((await menuGeometry()).side, placement === 'right' ? 'left' : 'right', `${currentCase} 实际展开方向`);
    const profile = await page.evaluate(() => window.dashboardFixture.subscriptions.find(sub => sub.id === 'fixture-menu-profile').name);
    await clickMenuOption(submenu.getByRole('menuitemradio', { name: profile, exact: false }));
    await page.waitForFunction(() => window.dashboardFixture.status.runtime_profile_id === 'fixture-menu-profile' && !document.querySelector('.dashboard-power').disabled);
    await more.click();
    submenu = await hoverConfigSubmenu(locale);
    assert.equal(await submenu.getByRole('menuitemradio', { name: profile, exact: false }).getAttribute('aria-checked'), 'true');
    await clickMenuOption(submenu.getByRole('menuitemradio', { name: words[locale].generated, exact: false }));
    await page.waitForFunction(() => window.dashboardFixture.status.runtime_source === 'generated' && !document.querySelector('.dashboard-power').disabled);
    // 清空刚移除子菜单的 hover 离开计时，再用键盘打开，使 resize/滚动不受指针离开影响。
    await page.mouse.move(1, 1);
    await page.waitForTimeout(320);
    await more.click();
    await page.locator('.dash-more-menu').getByRole('menuitem', { name: words[locale].config, exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.locator('.dash-more-submenu').waitFor();
    currentCase = `${baseCase}-${placement}-resize`;
    await page.setViewportSize({ width: width + 64, height: 640 });
    await menuGeometry();
    assert.equal(await page.locator('.dash-more-submenu').count(), 1, 'resize 保持展开');
    await page.setViewportSize({ width, height: 720 });
    await menuGeometry();
    currentCase = `${baseCase}-${placement}-scroll`;
    const scroll = await page.locator('main').evaluate(el => {
      const before = el.scrollTop;
      el.scrollTop += el.scrollTop > 24 ? -24 : 24;
      return { before, after: el.scrollTop };
    });
    assert.notEqual(scroll.after, scroll.before, '真实页面滚动容器发生滚动');
    await menuGeometry();
    assert.equal(await page.locator('.dash-more-submenu').count(), 1, '滚动后仍可见子菜单');
    await closeMoreWithEscape();
    // Esc 后再打开必须清空 hover 状态，单独主菜单也能关闭并回焦。
    await more.click();
    assert.equal(await page.locator('.dash-more-submenu').count(), 0);
    await closeMoreWithEscape();
  }
  const actions = await page.evaluate(() => window.dashboardFixture.commands.filter(c => c.command === 'set_runtime_source'));
  assert.deepEqual(actions, Array.from({ length: 2 }, () => [
    { command: 'set_runtime_source', payload: { source: 'singbox:fixture-menu-profile' } },
    { command: 'set_runtime_source', payload: { source: 'generated' } },
  ]).flat(), `${baseCase} 每次菜单点击只发一个声明的 mock IPC`);
  await clean();
}

try {
  for (const width of [960, 1280]) for (const locale of ['zh', 'en']) for (const zoom of [1, 1.5, 2]) {
    await moreMenuRoundTrip(width, locale, zoom);
  }
  assert.ok(menuSides.has('right') && menuSides.has('left'), '矩阵实际覆盖向右和向左展开');
  // 保留原两张截图，短场景四服务仅追加一张代表截图。
  for (const [width, height] of [[960, 720], [1280, 900], [1600, 1000]]) {
    for (const [locale, theme] of [["zh", "day"], ["en", "aerospace"]]) {
      await open(width, height, locale, theme);
      await structure(locale);
      await layout();
      if ((width === 960 && locale === "zh") || (width === 1280 && locale === "en")) {
        await page.screenshot({ path: `test-results/dashboard-${width}-${theme}.png` });
      }
    }
  }

  for (const sample of ['short', 'long']) {
    for (const [width, height] of [[960, 720], [1280, 900], [1600, 1000]]) {
      await open(width, height, 'zh', 'aerospace', 'running', 'classic', 'business', sample);
      await structure('zh');
      await serviceRoundTrip(sample === 'short' && width === 1280);
    }
  }

  await open(1280, 900, "zh", "aerospace");
  await countryRefresh();
  await freshServicesOnResume();
  await exitIpMetadataBackgroundRefresh();
  const navButtons = page.locator('.topnav-items .topnav-item');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await navButtons.nth(1).click();
  await page.waitForFunction(index => {
    const active = document.querySelectorAll('.topnav-items .topnav-item')[index];
    const indicator = document.querySelector('.topnav-indicator');
    if (!active || !indicator) return false;
    const a = active.getBoundingClientRect();
    const i = indicator.getBoundingClientRect();
    return Math.abs(a.left - i.left) < 1 && Math.abs(a.right - i.right) < 1 &&
      Math.abs(a.top - i.top) < 1 && Math.abs(a.bottom - i.bottom) < 1;
  }, 1);
  // TopNav 的类名构造为 `topnav-item ${active ? "active" : ""}`，非选中项带尾随空
  // 白；选中态用 classList 语义断言，不依赖完整字符串拼写。
  const navState = i => navButtons.nth(i).evaluate(el => ({ item: el.classList.contains("topnav-item"), active: el.classList.contains("active") }));
  assert.deepEqual(await navState(1), { item: true, active: true }, '文字导航切换为节点页');
  assert.deepEqual(await navState(0), { item: true, active: false }, '概览退出选中态');
  assert.notEqual(await page.locator('.topnav-indicator').evaluate(el => getComputedStyle(el).transitionDuration), '0s', '标准模式保留顶部导航动效');
  for (let index = 2; index < 7; index++) {
    await navButtons.nth(index).click();
    assert.deepEqual(await navState(index), { item: true, active: true });
    assert.deepEqual(await navState(index - 1), { item: true, active: false });
  }
  await page.evaluate(() => window.dashboardFixture.setMotion('reduced'));
  await navButtons.nth(0).click();
  assert.equal(await page.locator('main > .page-enter').evaluate(el => getComputedStyle(el).animationName), 'none');
  assert.equal(await page.locator('.topnav-indicator').evaluate(el => getComputedStyle(el).transitionDuration), '0s', '减少动态关闭指示条过渡');
  assert.equal(await navButtons.nth(0).evaluate(el => getComputedStyle(el).transitionDuration), '0s', '减少动态关闭文字导航过渡');
  await page.evaluate(() => window.dashboardFixture.setMotion('standard'));
  assert.equal(await page.evaluate(() => document.documentElement.dataset.motionReduced), 'false', '应用标准模式独立于系统减少动态');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForFunction(() => [...document.querySelectorAll('main > .page-enter')].every(el => el.getAnimations().every(animation => animation.playState === 'finished')));
  await heroMotion(true);
  await page.evaluate(() => window.dashboardFixture.setMotion('system'));
  await page.emulateMedia({ reducedMotion: "reduce" });
  // matchMedia 的 change 事件在 emulateMedia 应用后的下一帧才派发，
  // 先有界等待监听器落地再断言。
  await page.waitForFunction(() => document.documentElement.dataset.motionReduced === 'true', null, { timeout: 3000 }).catch(() => {});
  assert.equal(await page.evaluate(() => document.documentElement.dataset.motionReduced), 'true', '系统模式跟随系统减少动态');
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.evaluate(() => window.dashboardFixture.setMotion('standard'));
  await heroMotion(true);
  // 等待真实组件的第二轮状态/连接轮询，所有请求仍由内存 mock 响应。
  const reads = await page.evaluate(() => ({ status: window.dashboardFixture.statusReads, connections: window.dashboardFixture.connectionReads }));
  await page.waitForFunction(before => window.dashboardFixture.statusReads > before.status && window.dashboardFixture.connectionReads > before.connections, reads);
  const routing = page.getByRole("group", { name: words.zh.routing, exact: true });
  for (const [mode, label] of [["global", words.zh.global], ["rule", words.zh.rule]]) {
    await routing.getByRole("button", { name: label, exact: true }).click();
    await page.waitForFunction(mode => window.dashboardFixture.status.outbound_mode === mode, mode);
    await page.waitForFunction(label => document.querySelector('.dash-rail-block .glass-seg-btn.active')?.textContent === label, label);
  }
  assert.deepEqual(await page.evaluate(() => window.dashboardFixture.commands.filter(c => c.command === "set_outbound_mode").map(c => c.payload.mode)), ["global", "rule"]);
  await page.getByRole("button", { name: words.zh.stop, exact: true }).click();
  const start = page.getByRole("button", { name: words.zh.start, exact: true });
  await start.waitFor();
  await heroMotion(false);
  await page.waitForFunction(() => document.querySelector(".dashboard-power")?.disabled === false);
  await page.evaluate(() => { window.dashboardFixture.holdStart = true; });
  await start.click();
  await page.waitForFunction(() => window.dashboardFixture.releaseStart !== null);
  assert.equal(await page.locator(".dashboard-power").isDisabled(), true, "启动过渡禁用按钮");
  await page.evaluate(() => window.dashboardFixture.releaseStart());
  await page.getByRole("button", { name: words.zh.stop, exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.dashboardFixture.commands.filter(c => ["start_proxy", "stop_proxy"].includes(c.command)).map(c => c.command)), ["stop_proxy", "start_proxy"]);
  assert.deepEqual(await page.evaluate(() => window.dashboardFixture.commands.find(c => c.command === "start_proxy").payload), { enableSystemProxy: false });

  // 先滚动到趋势卡；展开后必须相对视口定位、越过卡片边界且未被裁切。
  const spark = page.locator(".simple-spark");
  const original = await spark.boundingBox();
  await spark.locator(".simple-spark-fs").click();
  await page.locator(".simple-spark.expanded").waitFor();
  assert.equal(await page.evaluate(() => {
    const spark = document.querySelector(".simple-spark.expanded");
    const box = spark.getBoundingClientRect();
    const backdrop = document.querySelector(".simple-spark-backdrop").getBoundingClientRect();
    return getComputedStyle(spark).position === "fixed" && box.width >= innerWidth * 0.6 && box.height >= innerHeight * 0.5 &&
      box.left >= 0 && box.top >= 0 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1 &&
      backdrop.left <= 1 && backdrop.top <= 1 && backdrop.right >= innerWidth - 1 && backdrop.bottom >= innerHeight - 1 &&
      spark.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2));
  }), true, "趋势全屏及遮罩覆盖视口，不被祖先约束");
  assert.ok((await spark.boundingBox()).width > original.width, "展开宽度应超出原卡片");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector(".simple-spark.expanded, .simple-spark-backdrop") && !document.documentElement.classList.contains("spark-fullscreen-open"));
  assert.equal(await page.evaluate(() => window.dashboardFixture.trafficOpens), 0, "展开/退出不触发流量页导航");
  await layout();

  // 自定义配置的路由/自动选点保持禁用，不扩大测试到配置管理。
  await open(960, 720, "zh", "day", "custom");
  assert.equal(await page.locator('.dash-side-rail .glass-seg').nth(0).locator("button:enabled").count(), 0);
  assert.equal(await page.locator('.dash-side-rail .glass-seg').nth(1).locator("button:enabled").count(), 0);
  await clean();
  await open(1280, 900, "zh", "aerospace", "running", "smiley");
  assert.equal(await page.locator('.dash-hero > .face-orbit').count(), 1);
  await page.getByRole('button', { name: 'IP 信息 ↗', exact: true }).click();
  await page.getByRole('dialog', { name: 'IP 信息', exact: true }).waitFor();
  assert.match(await page.locator('.ip-details-dialog .ip-organization').innerText(), /Without Truncation/);
  await page.keyboard.press('Escape');
  await page.locator('.ip-details-dialog').waitFor({ state: 'hidden' });
  await page.locator('.service-status-card').click();
  await page.getByRole('dialog').waitFor();
  assert.equal(await page.locator('.service-status-list .service-status-row').count(), 13);
  await page.getByRole('switch', { name: '在卡片展示 YouTube', exact: true }).check();
  await page.getByRole('switch', { name: '在卡片展示 ChatGPT', exact: true }).check();
  await page.waitForFunction(() => {
    const rows = [...document.querySelectorAll('.service-status-card-row')];
    return rows.length === 4 && rows.every(row => row.querySelector('[data-status]'));
  });
  assert.match(await page.locator('.service-status-card-row[data-service-id="chatgpt"]').innerText(), /US.*160 ms/s);
  const chatDetails = page.locator('.service-status-list .service-status-row[data-service-id="chatgpt"]');
  const githubDetails = page.locator('.service-status-list .service-status-row[data-service-id="github"]');
  assert.ok((await githubDetails.locator('.service-status-route-fields').first().innerText()).includes('192.0.2.8'));
  const primaryEvidence = await chatDetails.locator('.service-status-route-fields').first().innerText();
  assert.ok(primaryEvidence.includes('2001:db8::8') && primaryEvidence.includes('DomainSuffix') && primaryEvidence.includes('US-AI'), '展示主请求实际规则、策略和独立出口');
  assert.ok(!primaryEvidence.includes('198.51.100.9'), '辅助地区请求出口不能替代主请求出口');
  await chatDetails.locator('.service-status-auxiliary summary').click();
  assert.ok((await chatDetails.locator('.service-status-auxiliary').innerText()).includes('198.51.100.9'));
  assert.match(await chatDetails.locator('.service-status-reasons').innerText(), /预期拒绝响应/);
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: words.zh.stop, exact: true }).click();
  await page.getByRole('button', { name: words.zh.start, exact: true }).waitFor();
  await page.locator('.service-status-card').click();
  await page.waitForFunction(() => document.querySelector('.service-status-row[data-service-id="github"] .service-status-row-meta')?.textContent.includes('直连'));
  assert.equal(await page.locator('.service-status-card-row[data-service-id="github"] .service-status-state').getAttribute('data-status'), 'reachable', 'GitHub直连可达按真实结果展示');
  await page.keyboard.press('Escape');
  const beforeStart = await page.evaluate(() => {
    window.dashboardFixture.serviceFailures = 1;
    return window.dashboardFixture.commands.filter(c => c.command === 'check_service_status').length;
  });
  await page.getByRole('button', { name: words.zh.start, exact: true }).click();
  await page.waitForFunction(count => {
    const calls = window.dashboardFixture.commands.filter(c => c.command === 'check_service_status');
    return calls.length >= count + 2 && document.querySelector('.service-status-card-row[data-service-id="github"] .service-status-state')?.getAttribute('data-status') === 'reachable';
  }, beforeStart);
  const latestServices = await page.evaluate(() => window.dashboardFixture.commands.filter(c => c.command === 'check_service_status').at(-1).payload.ids);
  assert.deepEqual([...latestServices].sort(), ['google', 'github', 'youtube', 'chatgpt'].sort(), '开启代理后全部展示项自动检测并从暂态失败恢复');
  await open(1280, 900, "zh", "aerospace", "running", "particle");
  assert.equal(await page.locator('.dash-hero > .particle-orbit').count(), 1);
  await page.locator('.service-status-card').click();
  await page.getByRole('dialog').waitFor();
  await page.getByRole('switch', { name: '在卡片展示 Claude', exact: true }).check();
  const claude = page.locator('.service-status-card-row[data-service-id="claude"]');
  await page.waitForFunction(() => document.querySelector('.service-status-card-row[data-service-id="claude"] [data-status]')?.getAttribute('data-status') === 'available');
  assert.match(await claude.innerText(), /US.*160 ms/s, 'Claude显示该服务返回的地区和延迟');
  for (const [status, label, code] of [['restricted', 'HTTP 访问受限', 403], ['unsupported_region', '地区不支持', 200], ['blocked', '访问被阻止', 403]]) {
    await page.evaluate(({ status, code }) => { window.dashboardFixture.claudeStatus = status; window.dashboardFixture.claudeHttp = code; }, { status, code });
    await page.getByRole('button', { name: '检测 Claude 状态', exact: true }).click();
    await page.waitForFunction(status => document.querySelector('.service-status-card-row[data-service-id="claude"] [data-status]')?.getAttribute('data-status') === status, status);
    assert.ok((await claude.innerText()).includes(label), 'HTTP拒绝、地区限制及拦截显示各自状态');
  }
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  for (const [network, text, quality] of [["residential", "家宽", "优"], ["business", "商业", "优"], ["mobile", "移动网络", "优"], ["datacenter", "机房", "普通"], ["isp", "ISP 网络", "未知"], ["unknown", "未知", "未知"], ["tor", "商业", "风险"], ["abuse", "商业", "风险"]]) {
    await open(1280, 900, "zh", "aerospace", "running", "classic", network);
    await page.waitForFunction(() => document.querySelector('.ip-organization')?.textContent.includes('Without Truncation'));
    if (["isp", "unknown"].includes(network)) {
      assert.equal(await page.locator('.ip-network-tag').count(), 0, "首页只展示四种明确类型");
      assert.equal(await page.locator('[class*="ip-quality-"]').count(), 0, "未知类型不显示质量标签");
    } else {
      await page.waitForFunction(text => document.querySelector('.ip-info-badges')?.textContent.includes(text), text);
      assert.ok((await page.locator('.ip-info-badges').innerText()).includes(`质量 ${quality}`), "质量与网络类型/风险标记一致");
    }
    assert.doesNotMatch(await page.locator('.ip-info-badges').innerText(), /推测/);
  }
  // 返修 C-2：链激活时 hero 行精确包含链字头和最终分隔符。
  for (const [locale, expected] of [["zh", "链 · 2 跳 ♢ HTTP · 2054 ms"], ["en", "Chain · 2 hops ♢ HTTP · 2054 ms"]]) {
    currentCase = `chain-hero-${locale}`;
    await open(1280, 900, locale, "aerospace", "running", "classic", "business", "long", { chain: "1" });
    assert.equal(await page.locator(".dash-hero-title").textContent(), "演示链 Fixture Chain", `${currentCase} 标题为链名`);
    const actual = await page.locator(".dash-hero-desc").textContent();
    checkBatch10(`${currentCase} 链行逐字格式`, actual === expected, `actual=${actual}; expected=${expected}`);
  }

  currentCase = "hero-ip-labels-and-superscript";
  await open(1280, 900, "zh", "aerospace", "running", "classic", "business", "long");
  await page.waitForFunction(() => document.querySelector(".ip-info-org")?.textContent.includes("Without Truncation"));
  const heroRepairMetrics = await page.evaluate(() => {
    const root = document.querySelector(".dash-hero");
    const row = root.querySelector(".ip-info-badges");
    const selectors = [".ip-info-open", ".ip-network-tag", ".ip-quality-good", ".ip-info-org"];
    const chips = selectors.map(selector => {
      const element = row.querySelector(selector);
      if (!element) return { selector, missing: true };
      const style = getComputedStyle(element);
      const range = document.createRange(); range.selectNodeContents(element);
      const textRects = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0);
      const textTops = [...new Set(textRects.map(rect => Math.round(rect.top)))];
      const rect = element.getBoundingClientRect();
      const rootStyle = getComputedStyle(document.documentElement);
      const rootFontSize = parseFloat(rootStyle.fontSize);
      const inheritedSingleLineHeight = parseFloat(rootStyle.lineHeight) * parseFloat(style.fontSize) / rootFontSize;
      const originalSingleLineHeight = inheritedSingleLineHeight + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) +
        parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
      const lineHeight = style.lineHeight === "normal" ? parseFloat(style.fontSize) * 1.2 : parseFloat(style.lineHeight);
      const singleLineScrollHeight = lineHeight + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      return { selector, missing: false, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight,
        textLines: textTops.length, singleLineScrollHeight, originalSingleLineHeight, computedLineHeight: style.lineHeight,
        height: rect.height, width: rect.width, rowWidth: row.getBoundingClientRect().width,
        flexGrow: style.flexGrow, flexBasis: style.flexBasis, whiteSpace: style.whiteSpace };
    });
    const organizationTag = row.querySelector(".ip-info-org");
    const organizationStyle = getComputedStyle(organizationTag);
    const organization = { text: organizationTag.textContent, title: organizationTag.title,
      expected: window.dashboardFixture.organization, scrollWidth: organizationTag.scrollWidth, clientWidth: organizationTag.clientWidth,
      whiteSpace: organizationStyle.whiteSpace, overflow: organizationStyle.overflow, textOverflow: organizationStyle.textOverflow };
    const quality = row.querySelector(".ip-quality-good");
    const qualityRange = document.createRange(); qualityRange.selectNodeContents(quality);
    const qualityLineTops = [...new Set([...qualityRange.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0).map(rect => Math.round(rect.top)))];
    const rowHeight = row.getBoundingClientRect().height;
    const ip = root.querySelector(".dashboard-exit-ip");
    const ipStyle = getComputedStyle(ip);
    const ipLabel = ip.querySelector(".dashboard-exit-ip-origin");
    const ipAddressRect = ip.querySelector(".dashboard-exit-ip-address").getBoundingClientRect();
    const ipLabelRect = ipLabel?.getBoundingClientRect();
    const ipRect = ip.getBoundingClientRect();
    return { chips, organization, qualityText: quality.textContent.trim(), qualityLines: qualityLineTops.length,
      rowHeight, maxChipHeight: Math.max(...chips.filter(chip => !chip.missing).map(chip => chip.height)),
      ipLabelText: ipLabel?.textContent, ipLabelSameParent: ipLabel?.parentElement === ip,
      ipLabelSameLine: !!ipLabelRect && ipLabelRect.left >= ipAddressRect.right && ipLabelRect.top < ipAddressRect.bottom && ipLabelRect.bottom > ipAddressRect.top,
      ipLabelVerticalAlign: ipLabel ? getComputedStyle(ipLabel).verticalAlign : null,
      ipLabelFontSize: ipLabel ? parseFloat(getComputedStyle(ipLabel).fontSize) : null,
      ipFontSize: parseFloat(ipStyle.fontSize), ipLineHeight: ipStyle.lineHeight, ipRectHeight: ipRect.height };
  });
  for (const chip of heroRepairMetrics.chips) {
    checkBatch10(`${chip.selector} 单行高度`, !chip.missing && chip.scrollHeight <= chip.singleLineScrollHeight + 1 && chip.textLines === 1 && chip.whiteSpace === "nowrap",
      JSON.stringify(chip));
    checkBatch10(`${chip.selector} 内容自适应宽度`, !chip.missing && chip.flexGrow === "0" && chip.flexBasis === "auto" && chip.width < chip.rowWidth,
      JSON.stringify(chip));
    if (chip.selector !== ".ip-info-open") {
      checkBatch10(`${chip.selector} 保持原版单行高度`, !chip.missing && Math.abs(chip.height - chip.originalSingleLineHeight) < 1,
        JSON.stringify(chip));
    }
  }
  checkBatch10("组织胶囊截断且 title 保留完整组织名", heroRepairMetrics.organization.title === heroRepairMetrics.organization.expected &&
    heroRepairMetrics.organization.text === heroRepairMetrics.organization.expected &&
    heroRepairMetrics.organization.scrollWidth > heroRepairMetrics.organization.clientWidth &&
    heroRepairMetrics.organization.whiteSpace === "nowrap" && heroRepairMetrics.organization.overflow === "hidden" &&
    heroRepairMetrics.organization.textOverflow === "ellipsis", JSON.stringify(heroRepairMetrics.organization));
  checkBatch10("质量 优 单行", heroRepairMetrics.qualityText === "质量 优" && heroRepairMetrics.qualityLines === 1,
    JSON.stringify({ text: heroRepairMetrics.qualityText, lines: heroRepairMetrics.qualityLines }));
  checkBatch10("标签整行高度等于单个胶囊高度", Math.abs(heroRepairMetrics.rowHeight - heroRepairMetrics.maxChipHeight) < 1,
    JSON.stringify({ row: heroRepairMetrics.rowHeight, chip: heroRepairMetrics.maxChipHeight }));
  checkBatch10("批次11-1 IP 出口上标不存在", !heroRepairMetrics.ipLabelText,
    JSON.stringify({ actual: heroRepairMetrics.ipLabelText ?? null, expected: null, viewport: "1280x900" }));
  checkBatch10("IP 行高保持改前 28.08px", heroRepairMetrics.ipLineHeight === "28.08px" && Math.abs(heroRepairMetrics.ipRectHeight - 28.08) < 1,
    JSON.stringify({ lineHeight: heroRepairMetrics.ipLineHeight, rectHeight: heroRepairMetrics.ipRectHeight }));
  checkBatch10("普通节点行格式不变", await page.locator(".dash-hero-desc").textContent() === "VLESS · 42 ms",
    await page.locator(".dash-hero-desc").textContent());
  await clean();

  currentCase = "chain-style-computed-parity";
  await open(1280, 900, "zh", "aerospace", "running", "classic", "business", "long", { chain: "1", page: "chain" });
  await page.locator(".chain-page .chain-card").first().waitFor();
  await page.waitForFunction(() => document.querySelector(".node-proto-tags code"));
  await page.waitForFunction(() => document.querySelector(".chain-exit-btn.current"));
  const editorCard = page.locator(".chain-card").filter({ hasText: "编辑器指定池 Fixture editor" });
  await editorCard.getByRole("button", { name: "操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "编辑", exact: true }).click();
  await page.locator(".chain-editor-sidebar .glass-seg-btn").nth(1).click();
  await page.locator(".chain-editor-sidebar .chain-pool-expand").waitFor();
  const chainSurface = await page.evaluate(() => {
    const reference = document.querySelector(".node-proto-tags code");
    const refStyle = reference ? getComputedStyle(reference) : null;
    const referenceColors = refStyle ? {
      background: refStyle.backgroundColor,
      border: refStyle.borderColor,
      color: refStyle.color,
    } : null;
    const selectors = [
      ["链卡使用中出口", ".chain-card .chain-exit-btn.current"],
      ["链卡检测出口", ".chain-card .chain-exit-btn.chain-exit-probe"],
      ["链卡启用为出口", ".chain-card .chain-exit-btn:not(.current):not(.chain-exit-stop):not(.chain-exit-probe):not(.unavailable):not(.chain-exit-dead)"],
      ["节点池卡指定节点标记", ".chain-pool-row .pill.target-node"],
      ["编辑器节点池行尾展开按钮", ".chain-editor-sidebar .chain-pool-expand"],
    ];
    const results = selectors.map(([label, selector]) => {
      const element = document.querySelector(selector);
      if (!element || !refStyle) return { label, missing: true, referenceColors };
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return { label, background: style.backgroundColor, border: style.borderColor, color: style.color,
        referenceColors,
        matches: style.backgroundColor === refStyle.backgroundColor &&
          style.borderColor === refStyle.borderColor && style.color === refStyle.color,
        pillRadius: selector.includes("target-node") ? parseFloat(style.borderTopLeftRadius) >= rect.height / 2 : true };
    });
    const stop = document.querySelector(".chain-card .chain-exit-btn.chain-exit-stop");
    const stopStyle = stop ? getComputedStyle(stop) : null;
    const stopped = stopStyle ? {
      background: stopStyle.backgroundColor, border: stopStyle.borderColor, color: stopStyle.color,
    } : null;
    return { results, referenceColors, stopped };
  });
  for (const result of chainSurface.results) {
    // 批次12-2：检测出口改为样板B（rgba半透明底 + --text色系），不再与协议标签一致
    if (result.label === "链卡检测出口") {
      checkBatch10(`${result.label} computed background-color 等于样板B`,
        !result.missing && result.background === "rgba(255, 255, 255, 0.06)",
        JSON.stringify({ actual: result.background ?? null, expected: "rgba(255, 255, 255, 0.06)", viewport: "1280x900" }));
      checkBatch10(`${result.label} computed border-color 等于样板B`,
        !result.missing && result.border === "rgba(255, 255, 255, 0.09)",
        JSON.stringify({ actual: result.border ?? null, expected: "rgba(255, 255, 255, 0.09)", viewport: "1280x900" }));
      checkBatch10(`${result.label} computed color 等于样板B`,
        !result.missing && result.color === "rgba(255, 255, 255, 0.92)",
        JSON.stringify({ actual: result.color ?? null, expected: "rgba(255, 255, 255, 0.92)", viewport: "1280x900" }));
      continue;
    }
    // 其他按钮保持与协议标签一致
    for (const [property, actual, expected] of [
      ["background-color", result.background, result.referenceColors?.background],
      ["border-color", result.border, result.referenceColors?.border],
      ["color", result.color, result.referenceColors?.color],
    ]) {
      checkBatch10(`${result.label} computed ${property} 等于节点协议标签`,
        !result.missing && actual === expected,
        JSON.stringify({ actual: actual ?? null, expected: expected ?? null, viewport: "1280x900" }));
    }
    if (result.label.includes("指定节点")) {
      checkBatch10(`${result.label} 保持 pill 圆角`, !result.missing && result.pillRadius, JSON.stringify(result));
    }
  }
  const poolExpand = page.locator(".chain-editor-sidebar .chain-pool-expand");
  await poolExpand.click();
  await page.waitForFunction(() => document.querySelector(".chain-editor-sidebar .chain-pool-expand")?.getAttribute("aria-expanded") === "true");
  const expandedArrow = await poolExpand.evaluate(element => {
    const sample = document.querySelector(".node-proto-tags code");
    const sampleStyle = getComputedStyle(sample);
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor, border: style.borderColor, color: style.color,
      expected: { background: sampleStyle.backgroundColor, border: sampleStyle.borderColor, color: sampleStyle.color },
    };
  });
  for (const [property, actual, expected] of [
    ["background-color", expandedArrow.background, expandedArrow.expected.background],
    ["border-color", expandedArrow.border, expandedArrow.expected.border],
    ["expanded arrow color", expandedArrow.color, expandedArrow.expected.color],
  ]) checkBatch10(`展开态池按钮 computed ${property} 等于节点协议标签`, actual === expected,
    JSON.stringify({ actual, expected, viewport: "1280x900" }));
  await poolExpand.click();
  // 批次12-2：停用改为 transparent 背景（样板A）
  const expectedStopBaseline = {
    background: "rgba(0, 0, 0, 0)",
    border: "rgba(214, 139, 88, 0.35)",
    color: "rgb(214, 139, 88)",
  };
  checkBatch10("停用 computed 值符合批次12-2样板A", JSON.stringify(chainSurface.stopped) === JSON.stringify(expectedStopBaseline),
    JSON.stringify({ actual: chainSurface.stopped, expected: expectedStopBaseline, viewport: "1280x900" }));
  checkBatch10("链页仅一个使用中出口标记", await page.locator(".chain-page .chain-exit-btn.current").count() === 1,
    String(await page.locator(".chain-page .chain-exit-btn.current").count()));
  await clean();

  await page.getByRole("button", { name: "取消", exact: true }).click();
  const poolRow = page.locator(".chain-pool-row").filter({ hasText: "指定节点池 Fixture pool" });
  await poolRow.getByRole("button", { name: "操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "编辑", exact: true }).click();
  await page.getByRole("heading", { name: "编辑节点池", exact: true }).waitFor();
  const groupCounts = await page.locator(".rules-form-modal .chain-candidate-group").evaluateAll(groups => groups.map(group => ({
    name: group.querySelector(".chain-candidate-group-name")?.textContent,
    count: group.querySelector(".chain-candidate-group-count")?.textContent,
    expanded: group.querySelector(".chain-candidate-group-head")?.getAttribute("aria-expanded"),
  })));
  checkBatch10("指定节点池按订阅分组并显示组头计数", groupCounts.length === 2 && groupCounts.map(group => group.count).sort().join(",") === "1,2",
    JSON.stringify({ groups: groupCounts, expectedCounts: ["1", "2"], viewport: "1280x900" }));
  const firstPoolGroup = page.locator(".rules-form-modal .chain-candidate-group").filter({ hasText: "演示订阅 Subscription-Long-Name-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ" });
  const firstPoolGroupExists = await firstPoolGroup.count();
  const firstPoolGroupCount = firstPoolGroupExists ? await firstPoolGroup.locator(".chain-candidate-group-count").textContent() : null;
  checkBatch10("指定节点池订阅组默认可收起", groupCounts.length > 0 && groupCounts.every(group => group.expanded === "false"),
    JSON.stringify({ groups: groupCounts, viewport: "1280x900" }));
  if (firstPoolGroupExists > 0) await firstPoolGroup.locator(".chain-candidate-group-head").click();
  const expandedGroupRows = firstPoolGroupExists ? await firstPoolGroup.locator(".chain-pool-node-item").count() : -1;
  checkBatch10("指定节点池分组可展开且计数匹配", String(expandedGroupRows) === firstPoolGroupCount,
    JSON.stringify({ count: firstPoolGroupCount, rows: expandedGroupRows, viewport: "1280x900" }));
  if (firstPoolGroupExists > 0) await firstPoolGroup.locator(".chain-candidate-group-head").click();
  const collapsedRows = firstPoolGroupExists ? await firstPoolGroup.locator(".chain-pool-node-item").count() : -1;
  checkBatch10("指定节点池订阅组可折叠", groupCounts.length > 0 && collapsedRows === 0,
    JSON.stringify({ collapsedRows, viewport: "1280x900" }));
  const poolSearch = page.locator(".rules-form-modal input.search");
  await poolSearch.fill("Second subscription");
  const searchGroups = await page.locator(".rules-form-modal .chain-candidate-group").count();
  const searchRows = await page.locator(".rules-form-modal .chain-pool-node-item").allTextContents();
  checkBatch10("池内搜索按分组过滤并展开命中", searchGroups === 1 && searchRows.length === 1 && searchRows[0].includes("Second subscription Node"),
    JSON.stringify({ groups: searchGroups, rows: searchRows, expected: ["Second subscription Node"], viewport: "1280x900" }));
  const searchChoice = page.locator('.rules-form-modal .chain-pool-node-item input[type="checkbox"]').first();
  const searchChoiceCount = await page.locator('.rules-form-modal .chain-pool-node-item input[type="checkbox"]').count();
  const beforeChoice = searchChoiceCount ? await searchChoice.isChecked() : false;
  const dot = page.locator(".rules-form-modal .chain-pool-select-dot").first();
  const dotCount = await page.locator(".rules-form-modal .chain-pool-select-dot").count();
  const dotBefore = dotCount ? await dot.evaluate(element => ({
    selected: element.checked,
    background: getComputedStyle(element).backgroundColor,
    border: getComputedStyle(element).borderColor,
    radius: getComputedStyle(element).borderRadius,
  })) : null;
  if (searchChoiceCount) await page.locator(".rules-form-modal .chain-pool-node-item").first().click();
  const afterChoice = searchChoiceCount ? await page.locator('.rules-form-modal .chain-pool-node-item input[type="checkbox"]').first().isChecked() : false;
  if (searchChoiceCount && dotCount) await page.waitForFunction(() => {
    const input = document.querySelector(".rules-form-modal .chain-pool-select-dot");
    const sample = document.querySelector(".node-proto-tags code");
    return input instanceof HTMLInputElement && input.checked && getComputedStyle(input).backgroundColor === getComputedStyle(sample).color;
  });
  const dotAfter = dotCount ? await dot.evaluate(element => {
    const style = getComputedStyle(element);
    const sample = document.querySelector(".node-proto-tags code");
    return {
      background: style.backgroundColor,
      border: style.borderColor,
      selected: element.checked,
      expectedColor: getComputedStyle(sample).color,
      radius: style.borderRadius,
    };
  }) : null;
  checkBatch10("指定节点圆点可选中并切换", beforeChoice === false && afterChoice === true && dotCount > 0 &&
    dotBefore?.selected === false && dotAfter?.selected === true && dotAfter?.background === dotAfter?.expectedColor && dotAfter?.border === dotAfter?.expectedColor &&
    dotBefore?.radius === "50%" && dotAfter?.radius === "50%",
    JSON.stringify({ before: beforeChoice, after: afterChoice, dotBefore, dotAfter, viewport: "1280x900" }));
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.waitForFunction(() => window.dashboardFixture.poolWrites.length === 1);
  const savedPoolIds = await page.evaluate(() => window.dashboardFixture.poolWrites[0]);
  checkBatch10("保存的池内节点集合与选中标记集合一致", JSON.stringify(savedPoolIds) === JSON.stringify({ mode: "explicit", node_ids: ["fixture-node", "fixture-pool-node"] }),
    JSON.stringify({ actual: savedPoolIds, expected: { mode: "explicit", node_ids: ["fixture-node", "fixture-pool-node"] }, viewport: "1280x900" }));

  currentCase = "overview-default-viewport-overflow";
  await open(1280, 900, "zh", "aerospace", "running", "classic", "business", "long");
  const overviewOverflow = await page.locator("main").evaluate(el => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }));
  checkBatch10("默认概览视口无纵向滚动溢出", overviewOverflow.scrollHeight <= overviewOverflow.clientHeight,
    `${overviewOverflow.scrollHeight - overviewOverflow.clientHeight}px (${overviewOverflow.scrollHeight}/${overviewOverflow.clientHeight})`);
  await clean();
  console.log(`批次11-2 配色断言（本次运行）：${JSON.stringify(batch10Checks)}`);
  assert.deepEqual(batch10Checks.filter(check => check.result === "红"), [], "批次11配色新断言必须全绿；改前红项与改后绿项均逐项记录");
  console.log("概览回归通过：指定配置菜单12组中英/960与1280/zoom 1与1.5与2，默认与右侧触发、双向展开、hover配置切换、Esc回焦、resize/滚动；真实侧栏、IP、服务、动效、启停与全屏；新增链池样式、标签单行、出口上标、链格式与溢出断言全部通过。");
} catch (error) {
  console.error("概览夹具失败场景", currentCase);
  // 失败最多追加一张；成功最多三张（保留原两张及一张四服务代表图）。
  if (page && !page.isClosed()) await page.screenshot({ path: "test-results/dashboard-failure.png" }).catch(() => {});
  throw error;
} finally {
  await context?.close();
  await browser.close();
}
