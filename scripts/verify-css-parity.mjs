// Compare computed styles on the same real elements; only the referenced CSS changes.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createServer } from "vite";
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const css = (ref, file) => execFileSync("git", ["show", `${ref}:${file}`], { encoding: "utf8", maxBuffer: 2 ** 24 });
const baselineApp = css("cff1205", "src/App.css");
const sourceApp = css("272dade", "src/App.css");
const sourceChain = css("272dade", "src/pages/ChainPage.css");
const server = await createServer({ server: { host: "127.0.0.1", port: 1442, strictPort: true } });
await server.listen();
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.route("**/*", route => new URL(route.request().url()).origin === "http://127.0.0.1:1442" ? route.continue() : route.abort());
  const properties = ["background-color", "background-image", "color", "border-top-color", "border-top-width", "border-top-style", "border-radius", "padding-top", "padding-right", "padding-bottom", "padding-left", "font-family", "font-size", "font-weight", "line-height", "box-shadow", "display", "position", "width", "height", "min-width", "min-height", "opacity", "cursor", "appearance", "outline-style", "outline-width", "transform"];
  async function replaceCss(sources) {
    await page.evaluate(sources => {
      for (const [file, content] of sources) {
        const style = [...document.querySelectorAll("style[data-vite-dev-id]")].find(el => el.dataset.viteDevId.replaceAll("\\", "/").endsWith(file));
        if (!style) throw new Error(`Missing production stylesheet ${file}`);
        style.textContent = content;
      }
    }, sources);
  }
  async function sample(selector, pseudo = null) {
    return page.locator(selector).first().evaluate((el, { properties, pseudo }) => {
      const style = getComputedStyle(el, pseudo);
      return Object.fromEntries(properties.map(name => [name, style.getPropertyValue(name)]));
    }, { properties, pseudo });
  }
  async function compare(label, selector, sources, pseudo = null) {
    const current = await sample(selector, pseudo);
    // Transitions and animations must not turn a CSS comparison into a timing test.
    await replaceCss(sources);
    const reference = await sample(selector, pseudo);
    const differences = Object.keys(current).filter(key => current[key] !== reference[key]);
    results.push({ label, selector, pseudo, current, reference, differences });
    assert.deepEqual(differences, [], `${label}: computed style mismatch`);
    console.log(`PASS ${label}: ${properties.length} computed properties equal`);
  }
  for (const [label, path, selector] of [
    ["Dashboard ordinary menu button vs cff1205", "dashboard.html?sample=short", ".dash-more-menu > button"],
    ["Settings ordinary tab button vs cff1205", "core-selection.html", ".settings-page button"],
  ]) {
    await page.goto(`http://127.0.0.1:1442/scripts/ui-smoke/${path}`);
    if (path.startsWith("dashboard")) {
      await page.locator(".dash-more-btn").click();
    }
    await page.locator(selector).first().waitFor();
    await page.addStyleTag({ content: "*,*::before,*::after { transition: none !important; animation: none !important; }" });
    await compare(label, selector, [["/src/App.css", baselineApp]]);
  }
  await page.goto("http://127.0.0.1:1442/scripts/ui-smoke/chain-parity.html");
  await page.locator(".chain-exit-btn").first().waitFor();
  await page.addStyleTag({ content: "*,*::before,*::after { transition: none !important; animation: none !important; }" });
  const chainSources = [["/src/App.css", sourceApp], ["/src/pages/ChainPage.css", sourceChain]];
  await compare("Chain card activation button vs 272dade", "button.chain-exit-btn", chainSources);
  // Restore current styles before each independent sample.
  await replaceCss([["/src/App.css", css("HEAD", "src/App.css")]]);
  await compare("Chain card pool station dot vs 272dade", ".chain-station-dot", chainSources);
  // Open the actual pool editor, including both selected and unselected dots.
  await replaceCss([["/src/App.css", css("HEAD", "src/App.css")]]);
  const pool = page.locator(".chain-pool-row").first();
  await pool.locator("button").click();
  await page.getByRole("menuitem", { name: "编辑", exact: true }).click();
  await page.locator(".chain-pool-node-group .chain-candidate-group-head").click();
  await page.locator(".chain-pool-select-dot").first().waitFor();
  await compare("Pool editor selected dot vs 272dade", ".chain-pool-select-dot:checked", chainSources);
  await replaceCss([["/src/App.css", css("HEAD", "src/App.css")]]);
  await compare("Pool editor selected dot center vs 272dade", ".chain-pool-select-dot:checked", chainSources, "::before");
  await replaceCss([["/src/App.css", css("HEAD", "src/App.css")]]);
  await compare("Pool editor unselected dot vs 272dade", ".chain-pool-select-dot:not(:checked)", chainSources);
  assert.deepEqual(await page.evaluate(() => window.chainParityFixture.unexpected), []);
  console.log(`Computed CSS parity: ${results.length} elements, ${properties.length} properties each, all equal`);
} finally {
  writeFileSync(process.env.CSS_EVIDENCE_PATH ?? "css-parity-evidence.json", JSON.stringify(results, null, 2) + "\n");
  await browser.close();
  await server.close();
}
