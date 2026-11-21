import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// —— G7：配置页订阅分享二维码（源码结构断言，无浏览器） ——

const page = readFileSync(
  new URL("../src/pages/ConfigPage.tsx", import.meta.url),
  "utf8",
);
const modal = readFileSync(
  new URL("../src/components/SubShareModal.tsx", import.meta.url),
  "utf8",
);
const messages = readFileSync(
  new URL("../src/i18n/messages.ts", import.meta.url),
  "utf8",
);

test("菜单项仅对 url 订阅暴露分享入口，点击只切弹窗状态", () => {
  // 「分享二维码」必须出现在 source_kind === "url" 的同款门控分支里，
  // 文件/文本/手动节点/自写配置订阅不显示入口。
  const gated = page.match(
    /\{item\.source_kind === "url" && \([\s\S]*?\{t\("config\.menuShare"\)\}[\s\S]*?<\/button>[\s\S]*?\)\}/g,
  );
  assert.ok(gated, "menuShare 应出现在 source_kind === \"url\" 门控内");
  // 菜单项点击只设置弹窗目标，不在列表渲染或菜单阶段预取 URL
  //（getSubscription 由 SubShareModal 打开时调用）。
  assert.match(page, /onClick=\{\(\) => \{\s*setMenuId\(null\);\s*setShareProfile\(item\);\s*\}\}/);
  // 常驻 render + 内部 null guard（item === null 时返回 null）。
  assert.match(page, /<SubShareModal/);
  assert.match(page, /item=\{shareProfile\}/);
  assert.match(page, /onClose=\{\(\) => setShareProfile\(null\)\}/);
});

test("SubShareModal：打开才拉 URL，复用 NodeShareModal 形态与 qrcode 参数", () => {
  // URL 拉取只发生在 item 生效的 useEffect 里——列表渲染不预取。
  assert.match(modal, /useEffect\(\(\) => \{\s*if \(!item\) return;/);
  assert.match(modal, /void getSubscription\(item\.id\)/);
  // url 缺失时不渲染二维码，转成 subShareNoUrl 提示。
  assert.match(modal, /if \(detail\.url\) setUrl\(detail\.url\);/);
  assert.match(modal, /else setError\(t\("config\.subShareNoUrl"\)\);/);
  // 不脱敏：完整 URL 直接收进 canvas payload 与只读 textarea。
  assert.match(modal, /QRCode\.toCanvas\(canvas, url, \{/);
  assert.match(modal, /readOnly value=\{url\}/);
  // 二维码参数与 NodeShareModal 逐项一致（既有形态，无新专利值）。
  assert.match(modal, /width: 224,/);
  assert.match(modal, /margin: 1,/);
  assert.match(modal, /errorCorrectionLevel: "M",/);
  // 完全复用 node-share-* 既有样式类，不新增 CSS。
  assert.match(modal, /"modal node-share-modal"/);
  assert.ok(modal.includes("node-share-warning"));
  assert.match(modal, /copyNodeShareText\(url\)/);
  // 打开时复位 copied/error 状态，防上次会话残留。
  assert.match(modal, /setUrl\(null\);\s*\n\s*setError\(null\);\s*\n\s*setCopied\(false\);/);
});

test("凭据警示与双语文案同步", () => {
  const has = (key, value) => {
    const target = `"${key}": "${value}"`;
    assert.ok(messages.includes(target), `missing i18n: ${target}`);
  };
  has("config.menuShare", "Share QR code");
  has("config.menuShare", "分享二维码");
  has("config.subShareTitle", "Share subscription");
  has("config.subShareTitle", "分享订阅");
  // 警示文案必须明说二维码携带完整凭据、仅供本人使用。
  const zhWarn = /"config\.subShareWarning": "[^"]*凭据[^"]*本人使用。"/.test(messages);
  const enWarn = /"config\.subShareWarning": "[^"]*credentials[^"]*your own use only\."/.test(messages);
  assert.ok(zhWarn, "zh 警示缺少凭据/本人使用要点");
  assert.ok(enWarn, "en 警示缺少 credentials/own use 要点");
  has("config.subShareNoUrl", "Subscription URL is not available");
  has("config.subShareNoUrl", "订阅地址不可用");
});

test("菜单门控不与既有 url-only 项混淆（更新项仍在）", () => {
  // menuShare 与 menuUpdate 应各自独立出现，update 不能被吃掉。
  assert.match(page, /\{t\("config\.menuUpdate"\)\}/);
  // i18n 引用出现在 ConfigPage 恰好一次（菜单项本体）。
  assert.equal((page.match(/config\.menuShare/g) ?? []).length, 1);
});
