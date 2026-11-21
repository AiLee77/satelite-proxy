import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  chainHasDeadHop,
  chainPoolPreviewMembers,
  enabledUniverse,
  parseKeywords,
  poolKeywordMatch,
} from "../src/chainNodeUniverse.ts";
import {
  CHAIN_NODE_ID_PREFIX,
  isChainEntry,
  isChainVirtualId,
} from "../src/chainVirtualNode.ts";
import { groupNodes } from "../src/nodeGroups.ts";

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
const chainEntry = (id, name, hops = 2) => ({
  id: `chain:${id}`,
  name,
  protocol: "unknown",
  server: "",
  port: 0,
  chain_hops: hops,
});

test("chainVirtualNode：id 前缀与显式 wire 标志是唯一判定口径", () => {
  assert.equal(CHAIN_NODE_ID_PREFIX, "chain:");
  assert.equal(isChainVirtualId("chain:chain-ab12"), true);
  assert.equal(isChainVirtualId("aabbccddeeff0011"), false);
  assert.equal(isChainEntry(chainEntry("c1", "美转港")), true);
  assert.equal(isChainEntry(node("a", "东京 01")), false);
  assert.equal(isChainEntry({ chain_hops: null }), false);
});

test("groupNodes：分组视图下链条目收入首个“代理链”组，不落入协议/订阅/国家组", () => {
  const labels = { other: "其他", noSub: "未分组", chains: "代理链" };
  const a = node("a", "🇯🇵 东京 01", { subscription_name: "机场A" });
  const b = node("b", "香港 02", { subscription_name: "机场A" });
  const c = chainEntry("chain-1", "美转港", 3);
  const nodes = [a, b, c];
  for (const by of ["sub", "proto", "country"]) {
    const groups = groupNodes(nodes, by, "zh", labels);
    assert.equal(groups[0].key, "__chains", `${by}: 链组必须在最前`);
    assert.equal(groups[0].label, "代理链");
    assert.deepEqual(groups[0].nodes.map((n) => n.id), [c.id]);
    // 链条目不得再出现在任何常规分组（尤其 proto 的 unknown 组）。
    for (const g of groups.slice(1)) {
      assert.ok(
        g.nodes.every((n) => n.id !== c.id),
        `${by}: 链条目混入组 ${g.key}`,
      );
    }
    // 常规节点仍正常分组。
    assert.ok(groups.slice(1).some((g) => g.nodes.some((n) => n.id === "a")));
  }
  // 默认（平铺）视图不分组：链条目保持在列表原位。
  const flat = groupNodes(nodes, "default", "zh", labels);
  assert.equal(flat.length, 1);
  assert.deepEqual(flat[0].nodes.map((n) => n.id), ["a", "b", c.id]);
  // 没有链条目时不产生空链组。
  const noChains = groupNodes([a, b], "sub", "zh", labels);
  assert.ok(noChains.every((g) => g.key !== "__chains"));
});
test("G1 链页启用控件：setCurrentNode 走 chain:<id>，非 sing-box 隐藏并说明", () => {
  const page = readFileSync(
    new URL("../src/pages/ChainPage.tsx", import.meta.url),
    "utf8",
  );
  // 复用 E2 通道：虚拟 id 前缀 + setCurrentNode，运行中必须走重启等待。
  assert.match(page, /chainVirtualNodeId\(/);
  assert.match(page, /setCurrentNode\(chainVirtualNodeId\(/);
  assert.match(page, /waitForCoreRestart\(\)/);
  assert.match(page, /settings\.coreSwitchWaitFailed/);
  // 当前出口链显示「使用中」，非 sing-box 隐藏控件并给说明。
  assert.match(page, /"chain\.inUse"/);
  assert.match(page, /"chain\.exitSingboxOnly"/);
  assert.match(page, /active\.coreType === "singbox"/);
  // 「启用为出口」卡面控件复用 E2 通道；编辑器仅保存
  // （保存并启用已删除：启用统一走链列表卡「启用为出口」）。
  assert.match(page, /activateChainById/);
});
test("G5 订阅池预览：仅取该订阅的启用节点，store 顺序、无订阅=空池、永不 stale", () => {
  const nodes = [
    node("a", "香港 01", { enabled: true, subscription_id: "sub-a" }),
    node("b", "香港 02", { enabled: false, subscription_id: "sub-a" }),
    node("c", "东京 01", { enabled: true, subscription_id: "sub-b" }),
    node("d", "东京 02", { enabled: true, subscription_id: "sub-a" }),
  ];
  const pool = { mode: { mode: "subscription", subscription_id: "sub-a" } };
  const members = chainPoolPreviewMembers(pool, nodes);
  assert.deepEqual(members.map((m) => m.node.id), ["a", "d"]); // store 顺序，禁用 b 剔除
  assert.ok(members.every((m) => m.stale === false)); // 订阅池永不标 stale

  const missing = chainPoolPreviewMembers(
    { mode: { mode: "subscription", subscription_id: "gone" } },
    nodes,
  );
  assert.deepEqual(missing, []); // 订阅缺失 = 空池而非报错
  assert.deepEqual(
    chainPoolPreviewMembers({ mode: { mode: "subscription", subscription_id: "sub-b" } }, nodes)
      .map((m) => m.node.id),
    ["c"],
  );
});

test("G5 ChainPage 订阅池接线：三分支池行/编辑器订阅单选/页面拉订阅列表", () => {
  assert.match(source, /poolMode === "subscription"[\s\S]{0,40}t\("chain\.poolModeSubscription"\)/); // HopNode modeText 三分支
  assert.match(source, /pool\.mode\.mode === "subscription"/); // PoolRow 三分支
  assert.match(source, /s\.source_kind !== "custom"/); // 订阅下拉排除 custom（contributes_nodes() == false）
  assert.match(source, /subscription_id: subscriptionId\.trim\(\)/); // 提交构造 subscription arm
  assert.match(source, /t\("chain\.needPoolSub"\)/); // 空校验
  assert.match(source, /type="radio"\s*\n\s*name="chain-pool-subscription"/); // 订阅单选列表
  assert.match(source, /listSubscriptions\(\),/); // reload 并拉订阅
  assert.match(source, /setSubscriptionId/); // 编辑器订阅 state
  assert.match(source, /t\("chain\.poolSubMissing"\)/); // 订阅缺失提示（行/编辑器共用）
});
test("H已失效判定（纯函数）：任一跳引用已删除节点/池即失效；实体存在不算", () => {
  const chain = (hops) => ({ hops });
  const nodeIds = new Set(["n1", "n2"]);
  const poolIds = new Set(["p1", "p2"]);
  // 全部存在 → 不失效。
  assert.equal(
    chainHasDeadHop(
      chain([{ kind: "node", node_id: "n1" }, { kind: "pool", pool_id: "p1" }]),
      nodeIds,
      poolIds,
    ),
    false,
  );
  // 节点跳引用已删除节点 → 失效。
  assert.equal(
    chainHasDeadHop(
      chain([{ kind: "node", node_id: "n1" }, { kind: "node", node_id: "gone" }]),
      nodeIds,
      poolIds,
    ),
    true,
  );
  // 池跳引用已删除池 → 失效（与 stepper 逐跳 stale 同口径）。
  assert.equal(
    chainHasDeadHop(
      chain([{ kind: "pool", pool_id: "p1" }, { kind: "pool", pool_id: "gone" }]),
      nodeIds,
      poolIds,
    ),
    true,
  );
  // 池存在（哪怕成员为空）→ 不失效：空池/订阅禁用等存活性问题交给后端点击报错。
  assert.equal(
    chainHasDeadHop(chain([{ kind: "pool", pool_id: "p2" }]), nodeIds, poolIds),
    false,
  );
  // 空链无跳 → 不失效（后端「至少两跳」校验另管）。
  assert.equal(chainHasDeadHop(chain([]), nodeIds, poolIds), false);
});
test("H已失效上卡：红 pill + 禁用「使用」，全量列表本地比对零新 IPC", () => {
  const page = readFileSync(
    new URL("../src/pages/ChainPage.tsx", import.meta.url),
    "utf8",
  );
  const css = readFileSync(
    new URL("../src/pages/ChainPage.css", import.meta.url),
    "utf8",
  );
  const messages = readFileSync(
    new URL("../src/i18n/messages.ts", import.meta.url),
    "utf8",
  );
  // 本地比对：页面已加载的链详情 + 全量节点/池列表（list_chain_nodes 返回
  // 全部存储节点，含禁用订阅成员——id 集绝不能取 enabledUniverse 子集）。
  assert.match(page, /const dead = chainHasDeadHop\(c, nodeIdSet, poolIdSet\)/);
  assert.match(page, /new Set\(nodes\.map\(\(n\) => n\.id\)\)/);
  assert.match(page, /new Set\(pools\.map\(\(p\) => p\.id\)\)/);
  // 卡上红 pill 徽标 + 「使用」按钮禁用（非 sing-box 的说明性徽标不变）。
  assert.match(page, /className="chain-exit-btn chain-exit-dead"/);
  assert.match(page, /title=\{t\("chain\.deadHint"\)\}/);
  assert.match(page, /disabled=\{isBusy \|\| dead\}/);
  // 「停用」不受失效影响——回落不依赖链有效性，救生通道保持可用。
  const stopBtn =
    page.match(/chain-exit-stop[\s\S]{0,900}?(?=chain-exit-probe)/s)?.[0] ?? "";
  assert.match(stopBtn, /disabled=\{isBusy\}/);
  // CSS：红 pill 非交互。
  const dead = css.match(/\.chain-exit-btn\.chain-exit-dead \{[^}]*\}/s)?.[0] ?? "";
  assert.ok(dead, "chain-exit-dead 规则缺失");
  assert.match(dead, /color: var\(--danger\);/);
  assert.match(dead, /pointer-events: none;/);
  // i18n 双语。
  const has = (key, value) => {
    assert.ok(
      messages.includes(`"${key}": "${value}"`),
      `missing i18n: ${key}`,
    );
  };
  has("chain.dead", "Invalid");
  has(
    "chain.deadHint",
    "A hop references a node or pool that no longer exists — edit the chain to fix its hops.",
  );
  has("chain.dead", "已失效");
  has("chain.deadHint", "链中引用的节点或节点池已不存在，请编辑修复各跳。");
});
test("I6：链卡每跳名字旁显示该节点最近延迟（纯显示）", () => {
  // 复用既有 latency_ms 缓存，不触发探测；池跳没有单一延迟保持原样。
  // 编辑器跳卡的 latency 展示已在 B/I 回归锚定（hopCardData latencyMs）。
  const page = readFileSync(
    new URL("../src/pages/ChainPage.tsx", import.meta.url),
    "utf8",
  );
  const stepper = page.slice(page.indexOf("const stepper ="));
  const block = page.slice(
    page.indexOf('className={`chain-station${stale ? " stale" : ""}`}'),
    page.indexOf('chain-flow-type'),
  );
  assert.ok(block, "chain-station 渲染块缺失");
  assert.match(page, /const latencyMs = isPool\s*\n\s*\?\s*null\s*\n\s*: \(nodeById\.get\(hop\.node_id\)\?\.latency_ms \?\? null\);/);
  assert.match(page, /chain-station-latency/);
  assert.match(page, /latencyMs != null && latencyMs > 0/);
  const css = readFileSync(
    new URL("../src/pages/ChainPage.css", import.meta.url),
    "utf8",
  );
  const rule = css.slice(css.indexOf(".chain-station-latency {"));
  assert.match(rule, /margin-left: 0\.3rem;/);
  assert.match(rule, /color: var\(--muted\);/);
});
