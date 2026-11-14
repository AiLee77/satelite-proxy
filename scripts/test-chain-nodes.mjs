import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  chainPoolPreviewMembers,
  enabledUniverse,
  parseKeywords,
  poolKeywordMatch,
} from "../src/chainNodeUniverse.ts";

const node = (id, name, extra = {}) => ({
  id, name, protocol: "vmess", server: "s", port: 1, subscription_id: "sub-a", ...extra,
});

const root = new URL("../src/pages/ChainPage.tsx", import.meta.url);
const source = readFileSync(root, "utf8");

test("enabledUniverse 只保留启用订阅节点，缺省字段视为启用", () => {
  const a = node("a", "东京 01");
  const b = node("b", "香港 02", { enabled: true });
  const c = node("c", "大阪 03", { enabled: false });
  const out = enabledUniverse([a, b, c]);
  assert.deepEqual(out.map((n) => n.id), ["a", "b"]);
});

test("关键词池预览仅在启用订阅宇宙内匹配，与运行时语义一致", () => {
  const nodes = [
    node("a", "日本 Osaka", { enabled: true }),
    node("b", "日本 Tokyo", { enabled: false }),
    node("c", "香港 HK", { enabled: true }),
  ];
  const pool = { mode: { mode: "keyword", include: ["日本"], exclude: [] } };
  assert.deepEqual(
    chainPoolPreviewMembers(pool, nodes).map((m) => m.node.id),
    ["a"],
  );
});

test("explicit 池预览列出全部成员（含未启用订阅），失效 ID 保留 stale 槽", () => {
  const nodes = [
    node("a", "日本 Tokyo", { enabled: false }),
    node("b", "日本 Osaka", { enabled: true }),
  ];
  const pool = { mode: { mode: "explicit", node_ids: ["b", "a", "gone"] } };
  const members = chainPoolPreviewMembers(pool, nodes);
  assert.deepEqual(
    members.map((m) => (m.stale ? null : m.node.id)),
    ["b", "a", null],
  );
});

test("parseKeywords / poolKeywordMatch 基本行为", () => {
  assert.deepEqual(parseKeywords("  a b   c "), ["a", "b", "c"]);
  assert.equal(poolKeywordMatch("日本 Tokyo", ["日本"], ["hkd"]), true);
  assert.equal(poolKeywordMatch("香港 HKD", ["日本"], []), false);
  assert.equal(poolKeywordMatch("日本 Osaka", ["日本"], ["osaka"]), false);
});

test("ChainPage 使用 list_chain_nodes 全量节点并显式传递 keywordNodes", () => {
  // UI 解耦（切换订阅后池/链仍完整可见）：链页节点来源必须是全量命令，
  // 且关键词池预览统一走 enabledUniverse，不得退回 listAllNodes。
  assert.match(source, /listChainNodes\(\)/);
  assert.doesNotMatch(source, /listAllNodes/);
  assert.match(source, /from "\.\.\/chainNodeUniverse"/);
  assert.match(source, /keywordNodes=\{enabledNodes\}/);
  assert.match(source, /enabledUniverse\(keyNodes\)|enabledUniverse\(keywordNodes\)/);
  // 关键词预览不直接扫全量 nodeById：防止把语义改宽。
  assert.doesNotMatch(
    source,
    /Array\.from\(nodeById\.values\(\)\)\.filter\(\(n\) =>\s*poolKeywordMatch/,
  );
});

test("后端命令与注册一览：list_chain_nodes 已接线", async () => {
  const lib = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
  const chainCmd = readFileSync(
    new URL("../src-tauri/src/commands/chain.rs", import.meta.url),
    "utf8");
  const api = readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");
  assert.match(lib, /commands::list_chain_nodes,/);
  assert.match(chainCmd, /pub fn list_chain_nodes/);
  assert.match(chainCmd, /ordered_nodes\(\)/);
  // wire_node 至少剥离 raw 原文并镜像 favorite/enabled 字段。
  assert.match(chainCmd, /wire_node\(stored\.node\.clone\(\)\)/);
  assert.match(api, /invoke<ProxyNode\[\]>\("list_chain_nodes"\)/);
});

test("池候选可展开勾选并逐个添加为节点跳（B 回归）", () => {
  // 展开开关 + 成员预览 + 批量添加必须同时存在，防止后续改动把展开
  // 砍成只读列表。成员预览必须走 chainPoolPreviewMembers（explicit 含
  // 跨订阅成员、keyword 仅启用宇宙——与池卡片圆点同语义）。
  const page = readFileSync(
    new URL("../src/pages/ChainPage.tsx", import.meta.url),
    "utf8",
  );
  assert.match(page, /chain-pool-expand/);
  assert.match(page, /chainPoolPreviewMembers\(p, nodes\)/);
  assert.match(page, /function appendHops\(/);
  assert.match(page, /"chain\.addSelectedHops", \{ n: picks\.length \}\)/);
  // 勾选成员只能以 individual node hop 形式上画布——不得再发明一种
  // “部分池”shape：后端只认 ChainHop::Node / ChainHop::Pool。
  assert.match(
    page,
    /picks\.map\(\s*\(nodeId\): ChainHop => \(\{ kind: "node", node_id: nodeId \}\),/,
  );
  // 失效成员（explicit 池指向已删节点）只提示，不勾选不上画布。
  assert.match(page, /preview\.length - liveMembers\.length/);
});

test("池展开双语文案与源码同步（B 回归）", () => {
  const messages = readFileSync(
    new URL("../src/i18n/messages.ts", import.meta.url),
    "utf8",
  );
  const has = (key, value) => {
    assert.ok(
      messages.includes(`"${key}": "${value}"`),
      `missing i18n: ${key}`,
    );
  };
  has("chain.expandPoolMembers", "Show/hide pool members");
  has("chain.noPoolMembers", "(no members right now)");
  has("chain.addSelectedHops", "Add selected ({n})");
  has("chain.expandPoolMembers", "展开/收起池成员");
  has("chain.noPoolMembers", "（当前没有成员）");
  has("chain.addSelectedHops", "添加选中（{n}）");
  assert.match(
    messages,
    /"chain\.poolStaleHint": "\{n\} referenced node\(s\) no longer exist and can't be picked"/,
  );
  assert.match(messages, /"chain\.poolStaleHint": "\{n\} 个成员节点已不存在，无法勾选"/);
});

test("链导出双入口已全链路接线：mihomo YAML 与链文本（D 回归）", async () => {
  // 1) 后端：导出器只产 dialer-proxy 接线，池跳硬报错而非静默展开。
  const mihomo = readFileSync(
    new URL("../src-tauri/src/config/mihomo.rs", import.meta.url),
    "utf8",
  );
  assert.match(mihomo, /pub fn build_mihomo_chain_export\(/);
  // 池跳拒绝信息必须保留“换具体节点”指引，不允许改成静默展开。
  assert.match(mihomo, /无法表达动态池/);
  assert.match(mihomo, /先把该跳换成具体节点/);
  // 入口跳剥离原文 dialer-proxy —— 防止链外泄露路径。
  assert.match(mihomo, /mapping\.remove\(str_yaml\("dialer-proxy"\)\)/);
  // 2) commands + 注册 + api 桥。
  const lib = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
  const chainCmd = readFileSync(
    new URL("../src-tauri/src/commands/chain.rs", import.meta.url),
    "utf8",
  );
  const api = readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");
  assert.match(lib, /commands::export_chain_mihomo_yaml,/);
  assert.match(lib, /commands::export_chain_text,/);
  assert.match(chainCmd, /pub fn export_chain_mihomo_yaml/);
  assert.match(chainCmd, /pub fn export_chain_text/);
  // 导出用链感知节点宇宙：禁用订阅里的链跳也必须可导。
  assert.match(chainCmd, /enabled_nodes_with_chain_refs\(\)/);
  assert.match(api, /invoke<string>\("export_chain_mihomo_yaml"/);
  assert.match(api, /invoke<string>\("export_chain_text"/);
  // 3) UI 菜单双入口 + 文案双语。
  const page = readFileSync(
    new URL("../src/pages/ChainPage.tsx", import.meta.url),
    "utf8",
  );
  assert.match(page, /"chain\.copyText"/);
  assert.match(page, /"chain\.exportMihomo"/);
  const messages = readFileSync(
    new URL("../src/i18n/messages.ts", import.meta.url),
    "utf8",
  );
  const has = (key, value) => {
    assert.ok(
      messages.includes(`"${key}": "${value}"`),
      `missing i18n: ${key}`,
    );
  };
  has("chain.copyText", "Copy chain text");
  has("chain.exportMihomo", "Export mihomo YAML");
  has("chain.textCopied", "Chain text copied");
  has("chain.yamlCopied", "mihomo chain YAML copied to clipboard");
  has("chain.copyText", "复制链文本");
  has("chain.exportMihomo", "导出 mihomo YAML");
  has("chain.textCopied", "链文本已复制");
  has("chain.yamlCopied", "mihomo 链 YAML 已复制到剪贴板");
  // live 验证挂在 Actions（本机无内核）。
  assert.match(mihomo, /fn live_exported_chain_config_validates\(/);
  const wf = readFileSync(
    new URL("../.github/workflows/build-windows.yml", import.meta.url),
    "utf8",
  );
  assert.match(wf, /live_exported_chain_config_validates -- --ignored/);
});
