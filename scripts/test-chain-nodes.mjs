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

test("池候选可展开，点成员行直接入链尾（B 回归，勾选暂存已移除）", () => {
  // 展开开关 + 成员预览必须同时存在，防止后续改动把展开砍成只读列表。
  // 成员预览必须走 chainPoolPreviewMembers（explicit 含跨订阅成员、
  // keyword 仅启用宇宙——与池卡片圆点同语义）。
  const page = readFileSync(
    new URL("../src/pages/ChainPage.tsx", import.meta.url),
    "utf8",
  );
  assert.match(page, /chain-pool-expand/);
  assert.match(page, /chainPoolPreviewMembers\(p, nodes\)/);
  // 点成员行 = individual node hop 直接追加到链尾：与候选节点同一手势
  // （onCandidatePointerDown，<5px 位移即 click → appendHop），拖拽仍可
  // 定位投放。不得再发明一种“部分池”shape：后端只认 ChainHop::Node /
  // ChainHop::Pool。
  const member =
    page.match(
      /onPointerDown=\{\(e\) =>\s*onCandidatePointerDown\(\s*e,\s*\{ kind: "node", node_id: node\.id \},\s*node\.name,\s*\)\s*\}[\s\S]{0,2200}?\{staleCount > 0/s,
    )?.[0] ?? "";
  assert.ok(member, "chain-pool-member 渲染块缺失");
  // 成员行复用候选节点的 on-canvas 淡化口径，hover 提示带全名。
  assert.match(member, /className=\{`chain-pool-member\$\{onCanvas \? " on-canvas" : ""\}`\}/);
  assert.match(page, /const onCanvas = onCanvasNodeIds\.has\(node\.id\);/);
  assert.match(member, /\$\{node\.name\} · \$\{t\("chain\.dragHint"\)\}/);
  // 中段省略保尾：长名拆 head+tail，尾部钉死不弯折。
  assert.match(page, /function EllipsisTail\(/);
  assert.match(page, /chain-item-head/);
  assert.match(page, /chain-item-tail/);
  const css = readFileSync(
    new URL("../src/pages/ChainPage.css", import.meta.url),
    "utf8",
  );
  const headRule = css.match(/\.chain-item-head \{[^}]*\}/s)?.[0] ?? "";
  assert.match(headRule, /text-overflow: ellipsis;/);
  const tailRule = css.match(/\.chain-item-tail \{[^}]*\}/s)?.[0] ?? "";
  assert.match(tailRule, /flex: none;/);
  assert.match(tailRule, /white-space: nowrap;/);
  // 紧凑化：池行/成员行内距与字号收紧。
  assert.match(css, /\.chain-candidate-pool-row \.chain-candidate-item\.pool-drag \{[^}]*padding: 0\.24rem 0\.45rem;/s);
  assert.match(css, /\.chain-pool-member \{[^}]*padding: 0\.1rem 0\.2rem;/s);
  // 负断言：勾选暂存与「添加选中」按钮已彻底移除（含死样式）。
  assert.ok(!page.includes("poolPicks"));
  assert.ok(!page.includes("chain-pool-add"));
  assert.ok(!page.includes("addSelectedHops"));
  assert.ok(!css.includes("chain-pool-add"));
  // 失效成员（explicit 池指向已删节点）只提示，不上画布。
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
  has("chain.expandPoolMembers", "展开/收起池成员");
  has("chain.noPoolMembers", "（当前没有成员）");
  assert.match(
    messages,
    /"chain\.poolStaleHint": "\{n\} referenced node\(s\) no longer exist and can't be picked"/,
  );
  assert.match(messages, /"chain\.poolStaleHint": "\{n\} 个成员节点已不存在，无法选择"/);
  // 「添加选中」键已随勾选暂存一起移除。
  assert.ok(!messages.includes("addSelectedHops"));
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
  // 3) UI 入口（G2 后）：分享/导出移入编辑器 footer，⋮ 菜单瘦成编辑/删除，
  //    诊断上卡面 icon 按钮——回归同时守护新位置与孤儿清理。
  const page = readFileSync(
    new URL("../src/pages/ChainPage.tsx", import.meta.url),
    "utf8",
  );
  assert.match(page, /chain-editor-share/);
  assert.match(page, /onShareText/);
  assert.match(page, /onShareYaml/);
  assert.match(page, /"chain\.copyText"/);
  assert.match(page, /"chain\.exportMihomo"/);
  // ⋮ 菜单项不得再携带诊断/分享/导出（防止退回旧菜单形态）。
  assert.doesNotMatch(page, /key: "diag"/);
  assert.doesNotMatch(page, /key: "copyText"/);
  assert.doesNotMatch(page, /key: "exportMihomo"/);
  // 诊断改为卡面 icon 按钮（icon-btn + 单色脉冲 glyph + tooltip）。
  assert.match(page, /chain-card-diag/);
  assert.match(page, /setDiagFor\(c\)/);
  const messages = readFileSync(
    new URL("../src/i18n/messages.ts", import.meta.url),
    "utf8",
  );
  // G1 遗留 usage 徽标键已随菜单瘦身成为孤儿，必须清理干净。
  assert.doesNotMatch(messages, /chain\.usedByRuleSets|chain\.notUsedByRules/);
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

// —— E3：虚拟链条目（v2rayN 式“链作为出口”） ——

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

test("E3 后端：虚拟条目合入三个列表命令并带显式 wire 标志", () => {
  const config = readFileSync(
    new URL("../src-tauri/src/commands/config.rs", import.meta.url),
    "utf8",
  );
  // 显式标志字段（skip when None）。
  assert.match(config, /pub chain_hops: Option<u8>/);
  // 合成 helper + 门槛：仅 sing-box 主核且 generated 运行来源。
  assert.match(config, /fn chain_virtual_listed_nodes\(/);
  assert.match(config, /!= crate::core::CoreKind::SingBox/);
  assert.match(config, /runtime_source\(\)\.is_custom\(\)/);
  assert.match(config, /crate::domain::chain_virtual_node_id\(&chain\.id\)/);
  // 三个列表命令全部合入。
  assert.equal(
    (config.match(/nodes\.extend\(chain_virtual_listed_nodes\(/g) || []).length,
    3,
    "list_all_nodes / list_nodes_page / list_node_ids 必须全部合入虚拟条目",
  );
  // 占位协议/服务字段绝不作为判定依据（helper 注释红线）。
  assert.match(config, /never be displayed/);
});

test("E3 前端接线：类型、页面守卫与双语文案", () => {
  const types = readFileSync(new URL("../src/types.ts", import.meta.url), "utf8");
  assert.match(types, /chain_hops\?: number \| null;/);
  const nodesPage = readFileSync(
    new URL("../src/pages/NodesPage.tsx", import.meta.url),
    "utf8",
  );
  assert.match(nodesPage, /from "\.\.\/chainVirtualNode"/);
  // 选中链条目必须等待重启生效。
  assert.match(nodesPage, /isChainVirtualId\(id\)[\s\S]{0,400}?setSwitching\(true\)/);
  // 批量测速/全选/拖拽均排除链条目。
  assert.match(nodesPage, /filter\(\(id\) => !isChainVirtualId\(id\)\)/);
  assert.match(nodesPage, /!isChainEntry\(n\)/);
  assert.match(nodesPage, /chains: t\("nodes\.groupChains"\)/);
  const simple = readFileSync(
    new URL("../src/ui/simple/SimpleServersPage.tsx", import.meta.url),
    "utf8",
  );
  assert.match(simple, /from "\.\.\/\.\.\/chainVirtualNode"/);
  assert.match(simple, /isChainVirtualId\(id\)/);
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
  has("nodes.groupChains", "Proxy chains");
  has("nodes.chainBadge", "Chain");
  has("nodes.chainHops", "{n} hops");
  has("nodes.groupChains", "代理链");
  has("nodes.chainBadge", "链");
  has("nodes.chainHops", "{n} 跳");
  assert.match(messages, /"nodes\.chainEntryHint": "Chain exit/);
  assert.match(messages, /"nodes\.chainEntryHint": "代理链出口/);
});

// —— G1：链卡片/编辑器直接启用为出口 ——

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

// —— G6：连线 Handle 热区（纯 CSS 方案 A） ——

test("G6 连线 Handle：本体 24px 透明热区 + ::after 8px 视觉圆点，不碰定位 transform", () => {
  const css = readFileSync(
    new URL("../src/pages/ChainPage.css", import.meta.url),
    "utf8",
  );
  // 本体热区：24px、透明、无边框、crosshair（xyflow 的
  // pointer-events: none/connectionindicator 默认语义保留，点到不可连
  // 状态不产生交互）。
  const box = css.match(/\.chain-hop-node \.react-flow__handle \{[^}]*\}/s)?.[0] ?? "";
  assert.ok(box, "handle 主规则缺失");
  assert.match(box, /width: 24px;/);
  assert.match(box, /height: 24px;/);
  assert.match(box, /background: transparent;/);
  assert.match(box, /cursor: crosshair;/);
  // 圆点几何迁移到 ::after（8px、显隐/放大同层平移）；xyflow 的
  // translate(-50%,-50%) 中心定位在本体上，绝不能被 scale 覆盖。
  const dot = css.match(/\.react-flow__handle::after \{[^}]*\}/s)?.[0] ?? "";
  assert.ok(dot, "handle ::after 规则缺失");
  assert.match(dot, /width: 8px;/);
  assert.match(dot, /opacity: 0;/);
  assert.doesNotMatch(box, /scale\(/);
  // 显形状态 selectors 必须作用在 ::after 上（hover/selected/连线中）。
  assert.match(css, /:hover \.react-flow__handle::after/);
  assert.match(css, /\.selected \.chain-hop-node \.react-flow__handle::after/);
  assert.match(css, /\.connecting::after/);
  // 放大反馈只允许出现在 ::after 规则段（本体不得被 scale 改写定位）。
  const scaleRules = css.match(/transform: scale\(1\.25\);/g) ?? [];
  assert.ok(scaleRules.length > 0, "scale 反馈丢失");
});

// —— G4：候选列表订阅分组 + 默认折叠 + 画布节点淡化 ——

test("G4 候选列表：groupNodes sub 分组、单 map 手动开关、已上画布节点淡化", () => {
  const page = readFileSync(
    new URL("../src/pages/ChainPage.tsx", import.meta.url),
    "utf8",
  );
  // 复用既有 sub 分组口径（与节点页同源），而非另写一套分组。
  assert.match(page, /groupNodes\(candidateNodes, "sub", locale/);
  assert.match(page, /import \{ groupNodes \} from "\.\.\/nodeGroups";/);
  // 单 map 手动开关：缺省 = 无搜索时折叠 / 有搜索时展开，用户最后点击优先。
  assert.match(page, /manualOpenGroups\[g\.key\] : hasQuery;/);
  assert.match(page, /setManualOpenGroups\(\(cur\) => \(\{ \.\.\.cur, \[g\.key\]: !open \}\)\)/);
  // 搜索驱动展开的开关状态存在且只在 ChainFlowEditor 内使用。
  assert.match(page, /const hasQuery = candidateQuery\.trim\(\)\.length > 0;/);
  // 已上画布节点：仅个体跳计入（池跳是池引用，其成员仍可作为独立跳）；
  // 淡化但不素止拖拽（同节点两次入链在 isValidConnection 允许时合法）。
  const onCanvas = page.match(/const onCanvasNodeIds = useMemo\(\(\) => \{[\s\S]*?kind === "node"[\s\S]*?ids\.add\(hop\.node_id\);[\s\S]*?\}, \[flowNodes\]\);/);
  assert.ok(onCanvas, "onCanvasNodeIds 收集个体跳的 useMemo 缺失");
  assert.match(page, /onCanvasNodeIds\.has\(n\.id\)/);
  assert.match(page, /className=\{`chain-candidate-item\$\{onCanvas \? " on-canvas" : ""\}`\}/);
  assert.doesNotMatch(page, /expandedGroups/);
});

test("G4 分组头与层叠样式配套（全局主按钮排除 + 折叠组样式）", () => {
  const appCss = readFileSync(
    new URL("../src/App.css", import.meta.url),
    "utf8",
  );
  const chainCss = readFileSync(
    new URL("../src/pages/ChainPage.css", import.meta.url),
    "utf8",
  );
  // 组头按钮必须进全局主按钮排除列表（项目惯例）。
  const primary = appCss.match(/button:not\([^}]*\) \{/s)?.[0] ?? "";
  assert.ok(primary);
  assert.notEqual(
    primary,
    primary.replace(":not(.chain-candidate-group-head)", ""),
    "App.css 首条主按钮规则未排除 chain-candidate-group-head",
  );
  assert.match(
    appCss,
    /:not\(\.chain-candidate-group-head\):hover:not\(:disabled\) \{/,
  );
  assert.match(chainCss, /\.chain-candidate-group-head \{/);
  assert.match(chainCss, /\.chain-candidate-item\.on-canvas \{\n  opacity: 0\.45;/);
});

test("G4 双语文案同步", () => {
  const messages = readFileSync(
    new URL("../src/i18n/messages.ts", import.meta.url),
    "utf8",
  );
  const has = (key, value) => {
    assert.ok(messages.includes(`"${key}": "${value}"`), `missing i18n: ${key}`);
  };
  has("chain.alreadyOnCanvas", "Already on the chain — same node twice");
  has("chain.alreadyOnCanvas", "已在链上——同一节点重复拖入");
});

test("G1 双语文案与源码同步", () => {
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
  has("chain.useAsExit", "Use as exit");
  has("chain.inUse", "In use");
  has("chain.activating", "Switching…");
  has("chain.useAsExit", "启用为出口");
  has("chain.inUse", "使用中");
  has("chain.activating", "切换中…");
});

// ── G5 订阅整池（PoolMode::Subscription）────────────────────────────────

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

test("G5 Rust 契约锚：builder 原生 arm、store 动态成员表、三入口各传一次", async () => {
  const { readFileSync } = await import("node:fs");
  const chainRs = readFileSync(new URL("../src-tauri/src/domain/chain.rs", import.meta.url), "utf8");
  const storeRs = readFileSync(new URL("../src-tauri/src/storage/store.rs", import.meta.url), "utf8");
  const builderRs = readFileSync(new URL("../src-tauri/src/config/builder.rs", import.meta.url), "utf8");
  const runtimeRs = readFileSync(new URL("../src-tauri/src/runtime.rs", import.meta.url), "utf8");
  const stateRs = readFileSync(new URL("../src-tauri/src/state.rs", import.meta.url), "utf8");
  const cmdCfgRs = readFileSync(new URL("../src-tauri/src/commands/config.rs", import.meta.url), "utf8");
  const mihomoRs = readFileSync(new URL("../src-tauri/src/config/mihomo.rs", import.meta.url), "utf8");
  const msgs = readFileSync(new URL("../src/i18n/messages.ts", import.meta.url), "utf8");

  // wire 契约：serde tag="mode" + snake_case → { mode: "subscription", subscription_id }
  assert.match(chainRs, /Subscription\s*\{\s*subscription_id:\s*String\s*\}/);
  assert.match(storeRs, /PoolMode::Subscription \{ subscription_id \} =>/); // validate 宽容 arm
  assert.match(storeRs, /订阅池必须选择一个订阅/);
  assert.match(storeRs, /enabled_subscription_member_ids/);
  // builder 原生 arm + PoolScope 注入（非构建期展开 id 列表）
  assert.match(builderRs, /PoolMode::Subscription \{\s*subscription_id\s*\} =>/);
  assert.match(builderRs, /subscription_members: Option<&'a std::collections::BTreeMap<String, Vec<String>>>/);
  // 三个构建入口各传一次
  assert.match(runtimeRs, /store\.enabled_subscription_member_ids\(\)/);
  assert.match(cmdCfgRs, /store\.enabled_subscription_member_ids\(\)/);
  assert.match(stateRs, /store\.enabled_subscription_member_ids\(\)/);
  // ensure_chain_selectable 签名 +1 同型参数（state 调用处传动态成员表）
  assert.match(stateRs, /crate::config::ensure_chain_selectable\(\s*chain,/);
  // 差异 3 零改动锚：mihomo 链导出对 Pool 跳硬报错（订阅池自动被拒）
  assert.match(mihomoRs, /ChainHop::Pool \{ \.\. \} =>/);
  // i18n 双语同键（6 新键）：en 段与 zh 段各出现一次
  for (const key of [
    "chain.poolModeSubscription",
    "chain.poolPickSub",
    "chain.poolSubHint",
    "chain.poolSubMissing",
    "chain.poolSubEmptyList",
    "chain.needPoolSub",
  ]) {
    const re = new RegExp(`^\\s*"${key}":`, "gm");
    const hits = (msgs.match(re) || []).length;
    assert.equal(hits, 2, `i18n key ${key} must appear exactly twice (en + zh)`);
  }
});

// ── H 批：链停用 / 出口探测 / 失效标记 ─────────────────────────────────

test("F链停用：后端单源接管，热切不重启不串行拉 detail，停核同序预写配置", () => {
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
  // 停用按钮与「使用中」徽标并置（isActive 分支、同位同风格）。
  assert.match(page, /function deactivateChainExit\(/);
  assert.match(page, /className="chain-exit-btn chain-exit-stop"/);
  assert.match(css, /\.chain-exit-btn\.chain-exit-stop \{/);
  // F 根因修复：前端只调后端命令，不再镜像回落优先级——旧实现的串行
  // 逐订阅 detail 拉取与 30s 死等（热路径永不发的重启事件）全部删掉。
  const body = page.match(
    /async function deactivateChainExit\(chainId: string\) \{[\s\S]*?\n  \}/,
  )?.[0];
  assert.ok(body, "deactivateChainExit 闭包缺失");
  assert.match(body, /deactivateChainExitCmd\(\)/);
  assert.doesNotMatch(body, /listSubscriptions\(\)/);
  assert.doesNotMatch(body, /getSubscription\(/);
  assert.doesNotMatch(body, /setCurrentNode\(\)/);
  // 热路径不重启：waitForCoreRestart 只在 restartNeeded 分支内，停核时
  // 与标准选点流同序预写配置。
  assert.match(body, /else if \(outcome\.restartNeeded\) \{/);
  const restartMatch = body.match(/if \(outcome\.restartNeeded\) \{[\s\S]{0,200}waitForCoreRestart\(\)/);
  assert.ok(restartMatch, "waitForCoreRestart 必须仅在 restartNeeded 分支");
  assert.match(body, /if \(!active\.running\) \{[\s\S]{0,120}generateSingboxConfig\(\)/);
  assert.match(body, /setActive\(\(a\) => \(\{ \.\.\.a, currentNodeId: outcome\.nodeId \}\)\)/);
  // i18n 双语；stopNoNode 已成孤儿键随旧实现删除（负断言）。
  const has = (key, value) => {
    assert.ok(
      messages.includes(`"${key}": "${value}"`),
      `missing i18n: ${key}`,
    );
  };
  has("chain.stopExit", "Deactivate");
  has("chain.stopExit", "停用");
  assert.ok(!messages.includes("chain.stopNoNode"), "stopNoNode 必须已删");
  // 负断言：绝不引入 H1 前置系 API（封存分支的禁区）。
  assert.doesNotMatch(page, /setNodeFront|listNodeFronts|front_node_id|frontNode/);
});

test("D 收官：SubscriptionDetail.current_node_id 读取面已移除（零消费者死字段）", () => {
  const domain = readFileSync(
    new URL("../src-tauri/src/domain/subscription.rs", import.meta.url),
    "utf8",
  );
  const commands = readFileSync(
    new URL("../src-tauri/src/commands/subscription.rs", import.meta.url),
    "utf8",
  );
  const types = readFileSync(
    new URL("../src/types.ts", import.meta.url),
    "utf8",
  );
  // F 根因修复后回落由后端单源接管，H1 的前端读取面整体移除——三处
  // （domain 字段 / get_subscription 按需填充 / TS SubscriptionDetail
  // 可选字段）同步清淨。TS 侧锚限定在 SubscriptionDetail 接口体内——
  // AppSettings.current_node_id 是另一独立字段，不在本清理范围。
  assert.doesNotMatch(domain, /pub current_node_id: Option<String>/);
  assert.doesNotMatch(commands, /detail\.current_node_id/);
  const detailTs = types.match(
    /export interface SubscriptionDetail \{[\s\S]*?\n\}/,
  )?.[0];
  assert.ok(detailTs, "SubscriptionDetail 接口缺失");
  assert.doesNotMatch(detailTs, /current_node_id/);
});

test("H出口探测：仅使用中可点，复用 checkExitIp 既有通道，结果/红错上卡", () => {
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
  // 复用既有 check_exit_ip 诊断通道（经内核实际 HTTP 入口），不新开网络栈。
  assert.match(page, /async function probeChainExit\(/);
  assert.match(page, /await checkExitIp\(\)/);
  // 控件只在 isActive 分支内；停核置灰防误导（直连不经链出口）。
  assert.match(page, /className="chain-exit-btn chain-exit-probe"/);
  assert.match(page, /isBusy \|\|\n\s*!active\.running \|\|\n\s*\(exitProbe\?\.chainId === c\.id && exitProbe\.busy\)/);
  assert.match(page, /chain\.probeStoppedHint/);
  // 结果行：成功显示 IP+地区（viaProxy=false 追加直连提示），失败红字。
  assert.match(page, /probeReading\.err \? " err" : ""/);
  assert.match(page, /countryDisplayName\(info\.countryCode, locale\)/);
  assert.match(page, /chain\.probeDirect/);
  // 只对「使用中」的链渲染读数，且按 chain id 键控不串卡。
  assert.match(page, /exitProbe\.chainId !== c\.id/);
  // CSS：pill 并置 + 结果行 muted/红。
  assert.match(css, /\.chain-exit-btn\.chain-exit-probe \{/);
  assert.match(css, /\.chain-exit-probe-result \{/);
  assert.match(css, /\.chain-exit-probe-result\.err \{\s*\n\s*color: var\(--danger\);/);
  // i18n 双语。
  const has = (key, value) => {
    assert.ok(
      messages.includes(`"${key}": "${value}"`),
      `missing i18n: ${key}`,
    );
  };
  has("chain.probeExit", "Check exit");
  has("chain.probing", "Probing…");
  has("chain.probeIp", "Exit IP");
  has("chain.probeDirect", " (direct, not via proxy)");
  has(
    "chain.probeStoppedHint",
    "Start the proxy first — while the core is stopped the probe goes direct, not through the chain.",
  );
  has("chain.probeExit", "检测出口");
  has("chain.probing", "检测中…");
  has("chain.probeIp", "出口 IP");
  has("chain.probeDirect", "（直连，未走代理）");
  has("chain.probeStoppedHint", "先启动代理：停核时检测走直连，不经过链出口。");
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

test("链名自动跟随：name_manual additive 标记贯穿前后端，仅自动名跟随、手动名永不覆盖", () => {
  const page = readFileSync(
    new URL("../src/pages/ChainPage.tsx", import.meta.url),
    "utf8",
  );
  const types = readFileSync(
    new URL("../src/types.ts", import.meta.url),
    "utf8",
  );
  const api = readFileSync(
    new URL("../src/api.ts", import.meta.url),
    "utf8",
  );
  const lib = readFileSync(
    new URL("../src-tauri/src/lib.rs", import.meta.url),
    "utf8",
  );
  const domain = readFileSync(
    new URL("../src-tauri/src/domain/chain.rs", import.meta.url),
    "utf8",
  );
  const commands = readFileSync(
    new URL("../src-tauri/src/commands/chain.rs", import.meta.url),
    "utf8",
  );
  const store = readFileSync(
    new URL("../src-tauri/src/storage/store.rs", import.meta.url),
    "utf8",
  );
  // Rust：additive 可选字段（宽容读取 + None 不落盘），缺省视作手动名。
  assert.match(
    domain,
    /#\[serde\(default, skip_serializing_if = "Option::is_none"\)\]\s*\n\s*pub name_manual: Option<bool>/,
  );
  assert.match(
    domain,
    /fn is_name_auto\(&self\) -> bool \{\s*self\.name_manual == Some\(false\)\s*\}/,
  );
  // store：仅自动名跟随；手动名/撞名/空名/超长一律 Ok(None) 不动库。
  assert.match(store, /fn rename_chain_auto\(/);
  assert.match(store, /if !chain\.is_name_auto\(\) \|\| chain\.name == name \{\s*return Ok\(None\);/);
  assert.match(store, /chain\.id != id && chain\.name\.eq_ignore_ascii_case\(name\)/);
  // 命令注册 + 实现 + create/update 携带来源标记。
  assert.match(lib, /commands::rename_chain_auto,/);
  assert.match(commands, /pub fn rename_chain_auto\(/);
  assert.match(commands, /store\.rename_chain_auto\(&id, &name\)/);
  assert.match(commands, /store\.create_chain\(&name, hops, name_manual\)/);
  assert.match(commands, /store\.update_chain\(&id, &name, hops, name_manual\)/);
  // 前端类型与桥。
  assert.match(types, /name_manual\?: boolean \| null;/);
  assert.match(api, /invoke<ProxyChain \| null>\("rename_chain_auto"/);
  assert.match(api, /nameManual: nameManual \?\? null/);
  // ChainPage：加载时同步，同一套 chainAutoLabel 口径（card/editor/store 一致）。
  assert.match(page, /function chainAutoLabel\(/);
  assert.match(page, /syncAutoChainNames\(c, nodeMap, poolMap\)/);
  assert.match(page, /await renameChainAuto\(chain\.id, label\)/);
  // 仅 name_manual === false 跟随；含失效跳的链保持原名（避免回退成 id 标签）。
  assert.match(page, /if \(chain\.name_manual !== false\) continue;/);
  assert.match(page, /hopLabel\(h, nodeById, poolById\)\.stale\)\) continue;/);
  // 编辑器：脏标记从 name_manual 初始化，保存时持久化，自动名链在编辑器内继续跟随。
  assert.match(page, /chain\.name_manual !== false : false/);
  assert.match(page, /chain\.name_manual === false/);
  assert.match(page, /updateChain\(chain\.id, trimmed, hops, nameManual\)/);
  assert.match(page, /createChain\(trimmed, hops, nameManual\)/);
});

test("I4：启用链前自动补齐所需订阅（B/I 回归）", () => {
  // 链出口要能生成，链的每一跳都得在启用宇宙里——启用链前先把所需订阅
  // 逐跳收集并自动启用（复用 activateSubscription 现有路径，含 MIX
  // toggle-on）；失败即中止本次链启用，成功以 notice 列出被启用的订阅名。
  const page = readFileSync(
    new URL("../src/pages/ChainPage.tsx", import.meta.url),
    "utf8",
  );
  // 逐跳收集：node hop → 归属订阅；explicit 池 → 成员归属订阅；subscription
  // 池 → 该订阅本身（成员列表为空也算需要）；keyword 池匹配启用宇宙，收集不到。
  assert.match(page, /function requiredSubscriptionIds\(/);
  assert.match(page, /nodeById\.get\(hop\.node_id\)\?\.subscription_id/);
  assert.match(page, /required\.add\(pool\.mode\.subscription_id\)/);
  assert.match(page, /keyword 池只匹配启用宇宙/);
  // 启用链入口先补订阅，成功后列出被自动启用的订阅名。
  assert.match(page, /await ensureChainSubscriptions\(chainId\)/);
  assert.match(page, /"chain\.autoEnabledSubs", \{ names: autoEnabled\.join\("、"\) \}/);
  // 非 Mix 互斥语义：链跨订阅时明确报错提示开 Mix，不静默禁用另一半。
  assert.match(page, /peekSettings\(\)\?\.mix_mode \?\? false/);
  assert.match(page, /"chain\.autoEnableNeedsMix"/);
  // 启用后复查：仍有缺即中止报错（MIX 下“最后一个启用订阅”保护等回落）。
  assert.match(page, /"chain\.autoEnableFailed"/);
  // 停用链出口回落普通节点，不在补订阅路径上（deactivate 不禁用订阅）。
  assert.ok(!/deactivateChainExit[\s\S]{0,200}?activateSubscription/.test(page));
  // 双语键与后端无关（纯前端编排，select_chain_exit 语义未动）。
  const messages = readFileSync(
    new URL("../src/i18n/messages.ts", import.meta.url),
    "utf8",
  );
  for (const key of ["chain.autoEnabledSubs", "chain.autoEnableNeedsMix", "chain.autoEnableFailed"]) {
    assert.ok(messages.includes(`"${key}"`), `missing i18n key: ${key}`);
  }
});
test("I5：节点列表链条款选中/当前态高亮调柔和（纯 CSS）", () => {
  // 链虚拟条目复用通用行高亮（--primary-muted 整行实底）过强——链行降为
  // 轻染 + 左缘细条；以 .sidecar-tag.chain 徽标为 :has() 标记，纯 CSS
  // 不改 JS，普通节点行语义不动。专业列表/网格 + 简洁模式四处同款。
  const css = readFileSync(
    new URL("../src/App.css", import.meta.url),
    "utf8",
  );
  const soft = (rule) =>
    rule.includes("color-mix(in srgb, var(--primary) 14%, transparent)") ||
    rule.includes("color-mix(in srgb, var(--primary) 16%, transparent)");
  for (const sel of [
    ".node-list-row:has(.sidecar-tag.chain).row-active",
    ".node-list-row:has(.sidecar-tag.chain).row-selected",
    ".node-card:has(.sidecar-tag.chain).selected",
    ".simple-node-item:has(.sidecar-tag.chain).selected",
  ]) {
    const i = css.indexOf(sel + " {");
    assert.ok(i >= 0, `missing softened chain-entry rule: ${sel}`);
    const rule = css.slice(i, css.indexOf("}", i) + 1);
    assert.ok(soft(rule), `${sel} 未降为轻染`);
  }
  // 左缘细条：链行 active/selected 用 3px 渐变左缘，区别于普通行的整行实底。
  const rowActive = css.slice(
    css.indexOf(".node-list-row:has(.sidecar-tag.chain).row-active {"),
  );
  assert.match(rowActive, /linear-gradient\(/);
  assert.match(rowActive, /color-mix\(in srgb, var\(--primary\) 55%, transparent\) 0 3px/);
  // 普通节点行的通用高亮保持原语义（--primary-muted 实底带 important）。
  assert.match(
    css,
    /\.node-list-row\.row-selected \{\s*\n\s*background: var\(--primary-muted\) !important;\s*\n\}/,
  );
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
test("I7：链卡菜单「复制」——新 id、名字加后缀、走现有新建链路径", () => {
  const page = readFileSync(
    new URL("../src/pages/ChainPage.tsx", import.meta.url),
    "utf8",
  );
  // 走 createChain（后端新 id），不走 update；名字加后缀、撞名顺延、
  // 超 64 裁长度；name_manual: true 让复制件不跟随自动改名。
  const block = page.slice(page.indexOf("async function copyChain"));
  assert.ok(block, "copyChain 缺失");
  assert.match(page, /async function copyChain\(chain: ProxyChain\)/);
  assert.match(block, /t\("chain\.copySuffix"\)/);
  assert.match(block, /while \(taken\.has\(name\.toLowerCase\(\)\)\)/);
  assert.match(block, /Array\.from\(name\)\.slice\(0, 64\)\.join\(""\)/);
  assert.match(block, /createChain\(base, chain\.hops\.map\(\(h\) => \(\{ \.\.\.h \}\)\), true\)/);
  assert.match(block, /"chain\.copiedNotice", \{ name: created\.name \}/);
  // 菜单项接在编辑与删除之间。
  const menu = page.slice(page.indexOf('id={`chain-${c.id}`}'));
  assert.match(menu, /key: "copy",\s*\n\s*label: t\("chain\.copyChain"\)/);
  const messages = readFileSync(
    new URL("../src/i18n/messages.ts", import.meta.url),
    "utf8",
  );
  for (const key of ["chain.copyChain", "chain.copySuffix", "chain.copiedNotice"]) {
    assert.ok(messages.includes(`"${key}"`), `missing i18n key: ${key}`);
  }
  // 后端 create_chain 语义未动（新 id + 重复名拒绝 + 64 字上限）。
  const store = readFileSync(
    new URL("../src-tauri/src/storage/store.rs", import.meta.url),
    "utf8",
  );
  assert.match(store, /eq_ignore_ascii_case\(name\)/);
  assert.match(store, /name\.chars\(\)\.count\(\) > 64/);
});
test("I8：启用链成功后自动测一次出口（仅内存结果区）", () => {
  // 复用既有 probeChainExit（exitProbe 状态/结果区 UI 不动，不落盘）；
  // 仅内核运行时触发——停核启用只写配置，直连读数会误导。
  const page = readFileSync(
    new URL("../src/pages/ChainPage.tsx", import.meta.url),
    "utf8",
  );
  const block = page.slice(
    page.indexOf("async function activateChainById"),
    page.indexOf("async function deactivateChainExit"),
  );
  assert.ok(block, "activateChainById 块缺失");
  assert.match(
    block,
    /if \(active\.running\) void probeChainExit\(chainId\);/,
  );
  // probeChainExit 本体保持既有 checkExitIp 通道与 exitProbe 内存语义。
  const probe = page.slice(page.indexOf("async function probeChainExit"));
  assert.match(probe, /await checkExitIp\(\)/);
  assert.match(probe, /setExitProbe\(\{ chainId, info, busy: false \}\)/);
});
test("I9：跳序规则——左→右即 1..N、新节点接尾、删中间跳自动重编号、连线对齐上游", () => {
  const page = readFileSync(
    new URL("../src/pages/ChainPage.tsx", import.meta.url),
    "utf8",
  );
  // (c) 删中间跳桥接：有效路径上删除选中跳后按路径序重连前驱→后继，
  // 序号经 graphOrder 自动补位；图无效时退回原过滤行为。
  const block = page.slice(page.indexOf("function removeSelected"));
  assert.ok(block, "removeSelected 缺失");
  assert.match(page, /function removeSelected\(\) \{/);
  assert.match(
    block,
    /graphOrder && graphOrder\.length === flowNodes\.length && removed\.length > 0/,
  );
  assert.match(
    block,
    /setEdges\(keptIds\.slice\(1\)\.map\(\(id, i\) => hopEdge\(keptIds\[i\], id\)\)\)/,
  );
  assert.match(block, /setEdges\(\(cur\) => cur\.filter\(\(e\) => !e\.selected\)\)/);
  // (a)/(b) 序号与追加语义锚：路径序即保存序，布局按序左→右，追加接尾。
  assert.match(page, /position = \{ x: anchor\.position\.x \+ 320, y: anchor\.position\.y \};/);
  assert.match(page, /position: \{ x: 40 \+ i \* 320, y: 60 \}/);
  assert.match(page, /const ordered = hopsFromGraph\(flowNodes, edges\);/);
  // (d) 连线校验与上游逐字一致（自环/平行/重复出边入边/闭环拒绝）。
  assert.match(
    page,
    /if \(edges\.some\(\(e\) => e\.source === source && e\.target !== target\)\) return false;/,
  );
  assert.match(
    page,
    /if \(edges\.some\(\(e\) => e\.target === target && e\.source !== source\)\) return false;/,
  );
  // 上游仓库仅本机存在（/tmp/satelite-upstream-ref，只读）——不在时跳过对齐复核。
  let upstream = "";
  try {
    upstream = readFileSync(
      "/tmp/satelite-upstream-ref/src/pages/ChainPage.tsx",
      "utf8",
    );
  } catch {
    upstream = "";
  }
  if (upstream) {
    assert.match(
      upstream,
      /if \(edges\.some\(\(e\) => e\.source === source && e\.target !== target\)\) return false;/,
      "上游连线校验文本变化，需复核对齐",
    );
  }
});

test("K1：链出口缓存覆盖修复——重启后 selector 补 PUT 识别 chain: 虚拟 id", () => {
  const state = readFileSync(
    new URL("../src-tauri/src/state.rs", import.meta.url),
    "utf8",
  );
  const plan = state.slice(state.indexOf("fn generated_singbox_selector_sync_plan"));
  assert.ok(plan, "generated_singbox_selector_sync_plan 缺失");
  // chain: 虚拟 id 分支存在，且解析到链末跳克隆 tag（cache_file 恢复的
  // 旧选择会覆盖配置 default，重启本身不够——必须有重启后补 PUT）。
  assert.match(plan, /chain_id_from_virtual_node_id\(node_id\)/);
  assert.match(plan, /checked_sub\(1\)/);
  assert.match(plan, /ensure_chain_selectable/);
  assert.match(plan, /chain_hop_outbound_tag\(chain, hop_last\)/);
  // 补 PUT 只能指向刚生成配置里真实存在的 tag：失效链跳过（None），
  // 与普通节点 find_node 失败同口径。
  assert.match(
    state,
    /unresolvable chain is skipped, same as a\s*\/\/ ?deleted node/,
  );
});

test("K1：live 复现剧本（真 sing-box，CI --ignored）与单测双锚", () => {
  const state = readFileSync(
    new URL("../src-tauri/src/state.rs", import.meta.url),
    "utf8",
  );
  // 剧本三段：热切 node-b 落 cache → 停核启用链重启后断言链末跳 →
  // 停核回落 node-a 重启后断言回落 tag。
  assert.match(state, /live_chain_selector_reselects_after_cache_restore/);
  const live = state.slice(
    state.indexOf("fn live_chain_selector_reselects_after_cache_restore"),
  );
  assert.match(live, /select_current_node_serialized\("node-b", true, true\)/);
  assert.match(live, /chain_virtual_node_id\(&chain\.id\)/);
  assert.match(live, /chain_hop_outbound_tag\(&chain, 1\)/);
  // 端口去写死：fixture 显式钉隔离临时端口（不占用、不依赖应用默认
  // 2080/19090），并用「按配置端口新开的独立客户端」旁证补 PUT 打到的
  // 是配置里的控制地址——非默认端口下剧本仍须全过。
  assert.match(state, /fn reserve_loopback_port\(\) -> u16/);
  assert.match(live, /store\.settings\.mixed_port = isolated_mixed_port;/);
  assert.match(live, /store\.settings\.api_port = isolated_api_port;/);
  assert.match(live, /fresh_selector_now = \|state: &AppState\|[\s\S]*?ClashApi::new\("127\.0\.0\.1", port, &secret\)/);
  const freshAsserts = live.match(/fresh_selector_now\(&state\)/g) ?? [];
  assert.ok(
    freshAsserts.length >= 3,
    "三次启动后都要用独立客户端旁证 selector 选择",
  );
  // 纯函数双测：链选择产 PUT（末跳 tag）+ 失效/删除/kernel/xray 全跳过。
  assert.match(state, /fn chain_selector_sync_plan_targets_exit_hop_tag/);
  assert.match(
    state,
    /fn chain_selector_sync_plan_skips_unresolvable_or_foreign_state/,
  );
  // live 剧本挂进 Windows CI 的 ignored 清单。
  const wf = readFileSync(
    new URL("../.github/workflows/build-windows.yml", import.meta.url),
    "utf8",
  );
  assert.match(
    wf,
    /state::kernel_selection_poll_tests::live_chain_selector_reselects_after_cache_restore -- --ignored/,
  );
});

test("A：候选行圆点两态常驻（●/○），切换状态时行内零横移", () => {
  const page = readFileSync(
    new URL("../src/pages/ChainPage.tsx", import.meta.url),
    "utf8",
  );
  const css = readFileSync(
    new URL("../src/pages/ChainPage.css", import.meta.url),
    "utf8",
  );
  // 节点候选行 + 池成员行两处渲染都带 chain-candidate-mark（两态恒渲染：
  // on-canvas ● / off-canvas ○，aria-hidden —— 语义由既有 title 承载，
  // 不新增 i18n 键）。A 常驻：标记不再受 onCanvas 门控。
  const occurrences = page.match(/chain-candidate-mark/g) ?? [];
  assert.ok(occurrences.length === 2, "候选行/池成员行标记渲染缺失");
  assert.doesNotMatch(
    page,
    /\{onCanvas && \(\s*<span className="chain-candidate-mark"/,
    "标记不得只在 on-canvas 态渲染",
  );
  const twoState = page.match(/\{onCanvas \? "●" : "○"\}/g) ?? [];
  assert.ok(twoState.length === 2, "两处标记都必须是两态三元 ●/○");
  // 样式：两处行类型共用，尺寸复用节点列表当前节点圆点
  // （node-select-dot：0.9rem）；颜色两态——默认 ○ 用 --muted（既有 token，
  // 零新造色），on-canvas 覆写为 --primary。
  assert.match(css, /\.chain-candidate-item > \.chain-candidate-mark,/);
  assert.match(css, /\.chain-pool-member > \.chain-candidate-mark \{/);
  const markRule =
    css.match(/\.chain-pool-member > \.chain-candidate-mark \{[^}]*\}/s)?.[0] ??
    "";
  assert.match(markRule, /font-size: 0\.9rem;/);
  assert.match(markRule, /color: var\(--muted\);/);
  assert.match(
    css,
    new RegExp(
      "\\.chain-candidate-item\\.on-canvas > \\.chain-candidate-mark,\\s*" +
        "\\.chain-pool-member\\.on-canvas > \\.chain-candidate-mark \\{[^}]*var\\(--primary\\);",
    ),
  );
  // on-canvas 整行淡化保留，标记是补足而非替代。
  assert.match(css, /\.chain-candidate-item\.on-canvas \{/);
});

test("B：候选行分隔与 hover 语义（hairline 行界 + 主色淡底 + 圆点点亮）", () => {
  const css = readFileSync(
    new URL("../src/pages/ChainPage.css", import.meta.url),
    "utf8",
  );
  const re = (src) => new RegExp(src);
  // 分隔：候选节点行与池成员行都用 --border hairline，last-child 免责。
  assert.match(
    css,
    re(
      "\\.chain-candidate-item:not\\(:last-child\\),\\s*" +
        "\\.chain-pool-member:not\\(:last-child\\) \\{\\s*border-bottom: 1px solid var\\(--border\\);",
    ),
  );
  // hover：主色淡底（既有 --primary token，零新造色），两类行同口径。
  assert.match(
    css,
    re(
      "\\.chain-candidate-item:hover,\\s*\\.chain-pool-member:hover \\{\\s*" +
        "background: color-mix\\(in srgb, var\\(--primary\\) 12%, transparent\\);",
    ),
  );
  // hover 点亮常驻圆点：与 A 两态联动（空心 → 实心预演目标态）。
  assert.match(
    css,
    re(
      "\\.chain-candidate-item:hover > \\.chain-candidate-mark,\\s*" +
        "\\.chain-pool-member:hover > \\.chain-candidate-mark \\{\\s*color: var\\(--primary\\);",
    ),
  );
  // 负断言：旧的 accent-blue hover 已替换。
  assert.doesNotMatch(css, /\.chain-candidate-item:hover \{[^}]*--accent-blue/);
});

test("G：池展开按钮向 icon-btn 设计语言收拢", () => {
  const page = readFileSync(
    new URL("../src/pages/ChainPage.tsx", import.meta.url),
    "utf8",
  );
  // 钉住真实渲染组件：池行右侧展开/收起按钮用 .chain-pool-expand 类、
  // ▴/▾ 箭头、由 expandedPoolId 控制——避免再次改错控件。
  const render = page.match(/className="chain-pool-expand"[\s\S]{0,480}?\{expanded \? "▴" : "▾"\}/)?.[0] ?? "";
  assert.ok(render, "chain-pool-expand 渲染缺失");
  assert.match(render, /setExpandedPoolId\(expanded \? null : p\.id\)/);
  const css = readFileSync(
    new URL("../src/pages/ChainPage.css", import.meta.url),
    "utf8",
  );
  // 形态：border:none + 背景透明 + 最小方形（icon-btn 口径），不再带框。
  const rule = css.match(/\.chain-pool-expand \{[^}]*\}/s)?.[0] ?? "";
  assert.match(rule, /border: none;/);
  assert.match(rule, /background: transparent;/);
  assert.match(rule, /width: 24px;/);
  // icon-btn 口径补齐：高度 24px + 居中布局，且不再存在尾部覆写块。
  assert.match(rule, /height: 24px;/);
  assert.match(rule, /display: inline-flex;/);
  assert.doesNotMatch(css, /\.chain-pool-expand \{[^}]*width: 20px;/);
  // hover：主色淡底（既有 --primary token）。
  assert.match(
    css,
    new RegExp(
      "\\.chain-pool-expand:hover \\{\\s*background: color-mix\\(in srgb, var\\(--primary\\) 12%, transparent\\);",
    ),
  );
  // 展开态：图标收进链页既有主语义 --accent-purple，不再叠边框。
  assert.match(
    css,
    new RegExp(
      "\\.chain-candidate-pool\\.expanded \\.chain-pool-expand \\{\\s*color: var\\(--accent-purple\\);",
    ),
  );
  assert.doesNotMatch(
    css,
    /\.chain-candidate-pool\.expanded \.chain-pool-expand \{[^}]*border-color/,
  );
  assert.doesNotMatch(css, /\.chain-pool-expand \{[^}]*border: 1px solid/);
});

test("H：画布 fit view 手动复位入口与视口策略单源", () => {
  const page = readFileSync(
    new URL("../src/pages/ChainPage.tsx", import.meta.url),
    "utf8",
  );
  // Controls 手动 fit 按钮接线：onFitView 与应用自身 fit 走同一套视口策略
  // （padding/maxZoom 与打开已有链/整理布局两处自动路径逐字一致）。
  const controls = page.match(/<Controls[\s\S]*?\/>/)?.[0] ?? "";
  assert.ok(controls, "Controls 组件缺失");
  assert.match(controls, /onFitView=\{\(\) =>\s*fitView\(\{ padding: 0\.3, duration: 250, maxZoom: 1\.1 \}\)\s*\}/);
  // 负断言：不得引入新的坐标换算/重设（screenToFlowPosition 仅供投放点，
  // 坐标模型未动）。
  assert.doesNotMatch(controls, /screenToFlowPosition/);
});

// ===== E（链毕业批）：使用中链出口的存活破坏 → 自动停用回落 =====

test("E 杀跳路径挂钩一览：九处入口都复检存活，delete_chain 靠既有守卫", () => {
  const hookRe =
    /auto_deactivate_dead_chain_exit\(&?state\)|auto_deactivate_dead_chain_exit\(self\)/g;
  const chain = readFileSync(
    new URL("../src-tauri/src/commands/chain.rs", import.meta.url),
    "utf8",
  );
  const config = readFileSync(
    new URL("../src-tauri/src/commands/config.rs", import.meta.url),
    "utf8",
  );
  const subscription = readFileSync(
    new URL("../src-tauri/src/commands/subscription.rs", import.meta.url),
    "utf8",
  );
  const state = readFileSync(
    new URL("../src-tauri/src/state.rs", import.meta.url),
    "utf8",
  );
  // 删池 ×1、编辑链 ×1、编辑池 ×1 —— 池/链编辑面同样能破坏存活。
  assert.equal((chain.match(hookRe) ?? []).length, 3, "chain.rs 三处挂点");
  // 删单节点 ×1、批量删 ×1。
  assert.equal((config.match(hookRe) ?? []).length, 2, "config.rs 两处挂点");
  // 互斥激活外的三条订阅路径：Mix 关闭、刷新/换源持久化、整订阅删除。
  assert.equal(
    (subscription.match(hookRe) ?? []).length, 3,
    "subscription.rs 三处挂点",
  );
  // activate_subscription（互斥激活/停用）在 AppState 内部直呼 self。
  assert.equal((state.match(hookRe) ?? []).length, 1, "state.rs 一处挂点");
  // delete_chain 不挂：正被选中的链本就拒绝删除（既有守卫，见下方测试锚）。
  const store = readFileSync(
    new URL("../src-tauri/src/storage/store.rs", import.meta.url),
    "utf8",
  );
  assert.match(store, /当前出口/);
});

test("E 检测口径：enabled 宇宙上镜像 ensure_chain_selectable，门控与同步计划一致", () => {
  const store = readFileSync(
    new URL("../src-tauri/src/storage/store.rs", import.meta.url),
    "utf8",
  );
  const death = store.match(
    /pub fn active_chain_exit_death\(\&self\) -> Option<ChainExitDeath> \{[\s\S]*?\n    \}/,
  )?.[0];
  assert.ok(death, "active_chain_exit_death 缺失");
  // 门控三件套镜像 generated_singbox_selector_sync_plan：sing-box 主核、
  // 非 custom 来源、非 kernel 自动模式。
  assert.match(death, /CoreKind::parse\(&self\.settings\.core_type\) != crate::core::CoreKind::SingBox/);
  assert.match(death, /runtime_source\(\)\.is_custom\(\)/);
  assert.match(death, /auto_select\.is_kernel\(\)/);
  // 复检跑在 enabled 宇宙（比 build 宇宙更严：禁用源订阅即杀其跳），
  // 且组域参数与 builder 语义同构。
  assert.match(death, /let nodes = self\.enabled_nodes\(\);/);
  assert.match(death, /let subscription_members = self\.enabled_subscription_member_ids\(\);/);
  assert.match(death, /compute_sidecar_plan\(&self\.settings, &self\.chains, &nodes\)/);
  assert.match(death, /ensure_chain_selectable\(/);
});

test("E 回落单一来源：ensure_current_node_valid 与自动/手动停用共用同一 helper", () => {
  const store = readFileSync(
    new URL("../src-tauri/src/storage/store.rs", import.meta.url),
    "utf8",
  );
  const state = readFileSync(
    new URL("../src-tauri/src/state.rs", import.meta.url),
    "utf8",
  );
  const chainCmd = readFileSync(
    new URL("../src-tauri/src/commands/chain.rs", import.meta.url),
    "utf8",
  );
  // 回落优先级只存在于 chain_exit_fallback_target_in 一处：记忆节点（启用
  // 宇宙内）→ 首个启用节点；三处消费方全部走它，禁止第二套优先级。
  const helper = store.match(
    /pub fn chain_exit_fallback_target_in\([\s\S]*?\n    \}/,
  )?.[0];
  assert.ok(helper, "chain_exit_fallback_target_in 缺失");
  assert.match(helper, /filter\(\|sub\| sub\.enabled && sub\.source\.contributes_nodes\(\)\)/);
  assert.match(helper, /\.find\(\|id\| enabled\.iter\(\)\.any\(\|node\| &node\.id == \*id\)\)/);
  assert.match(helper, /or_else\(\|\| enabled\.first\(\)\.map\(\|node\| node\.id\.clone\(\)\)\)/);
  const ensure = store.match(
    /pub fn ensure_current_node_valid\(&mut self\) \{[\s\S]*?\n    \}/,
  )?.[0];
  assert.ok(ensure, "ensure_current_node_valid 缺失");
  assert.match(ensure, /self\.chain_exit_fallback_target_in\(&enabled\)/);
  const auto = store.match(
    /pub fn auto_deactivate_dead_chain_exit\(&mut self\) -> Option<ChainExitDeath> \{[\s\S]*?\n    \}/,
  )?.[0];
  assert.ok(auto, "auto_deactivate_dead_chain_exit 缺失");
  // 返修③: 自动停用走单源包装 chain_exit_fallback_target()（链出口时排除
  // 该链全部跳），不再绕过包装直调 _in。
  assert.match(auto, /self\.chain_exit_fallback_target\(\)/);
  assert.match(auto, /self\.remember_current_node\(\)/);
  // 返修③: 排除逻辑单源在 chain_exit_fallback_target_in_excluding_chain，
  // 收集被停链全部 ChainHop::Node 的 node_id 后从候选宇宙剔除。
  const excl = store.match(
    /pub fn chain_exit_fallback_target_in_excluding_chain\([\s\S]*?\n    \}/,
  )?.[0];
  assert.ok(excl, "chain_exit_fallback_target_in_excluding_chain 缺失");
  assert.match(excl, /ChainHop::Node \{ node_id \} => Some\(node_id\.as_str\(\)\)/);
  assert.match(excl, /!excluded\.contains\(node\.id\.as_str\(\)\)/);
  // 单源包装：当前出口是链时走排除版，否则走原版——手动/自动停用共用。
  const wrapper = store.match(
    /pub fn chain_exit_fallback_target\(&self\)[\s\S]*?\n    \}/,
  )?.[0];
  assert.ok(wrapper, "chain_exit_fallback_target 缺失");
  assert.match(wrapper, /chain_exit_fallback_target_in_excluding_chain\(&enabled, chain_id\)/);
  // 手动停用命令走 state 侧包装 + 标准选点热路径（select_current_node_serialized），
  // 非链出口返回 None 幂等。
  const manual = state.match(
    /pub fn deactivate_chain_exit_serialized\([\s\S]*?\n    \}/,
  )?.[0];
  assert.ok(manual, "deactivate_chain_exit_serialized 缺失");
  assert.match(manual, /chain_exit_fallback_target\(\)/);
  assert.match(manual, /select_current_node_serialized\(&target, true, true\)/);
  assert.match(manual, /return Ok\(None\)/);
  assert.match(chainCmd, /pub async fn deactivate_chain_exit|pub fn deactivate_chain_exit/);
});

test("E 用户提示：事件、全局通知与双语文案三段接线", () => {
  const state = readFileSync(
    new URL("../src-tauri/src/state.rs", import.meta.url),
    "utf8",
  );
  const api = readFileSync(
    new URL("../src/api.ts", import.meta.url),
    "utf8",
  );
  const app = readFileSync(
    new URL("../src/App.tsx", import.meta.url),
    "utf8",
  );
  const appCss = readFileSync(
    new URL("../src/App.css", import.meta.url),
    "utf8",
  );
  const messages = readFileSync(
    new URL("../src/i18n/messages.ts", import.meta.url),
    "utf8",
  );
  // 后端：camelCase 事件载荷 + APP_HANDLE 发射 + 应用日志。
  assert.match(state, /CHAIN_AUTO_DEACTIVATED_EVENT: &str = "chain-auto-deactivated"/);
  assert.match(state, /#\[serde\(rename_all = "camelCase"\)\]\s*\n?pub struct ChainAutoDeactivatedEvent/);
  assert.match(state, /pub fn auto_deactivate_dead_chain_exit\(state: &AppState\) \{[\s\S]{0,400}app_log::info\(/);
  assert.match(state, /pub fn auto_deactivate_dead_chain_exit\(state: &AppState\) \{[\s\S]{0,700}emit\(\s*CHAIN_AUTO_DEACTIVATED_EVENT/);
  // 前端桥：事件订阅 + 手动停用命令封装（F 根因修复的入口）。
  assert.match(api, /export function onChainAutoDeactivated\(/);
  assert.match(api, /listen<ChainAutoDeactivated>\("chain-auto-deactivated"/);
  assert.match(api, /"deactivate_chain_exit"/);
  // 全局通知挂在 AppShell（任何页面都可能触发，不只链页）。
  assert.match(app, /onChainAutoDeactivated\(\(\{ chainName, reason \}\) =>/);
  assert.match(app, /t\("chain\.autoDeactivated", \{ name: chainName, reason \}\)/);
  assert.match(app, /className="chain-auto-toast"/);
  assert.match(appCss, /\.chain-auto-toast \{/);
  assert.match(appCss, /border-left: 3px solid var\(--danger\)/);
  // 双语。
  assert.match(
    messages,
    /"chain\.autoDeactivated": "Chain exit \\"{name}\\" was deactivated automatically: \{reason\}"/,
  );
  assert.match(
    messages,
    /"chain\.autoDeactivated": "代理链「\{name\}」已自动停用：\{reason\}"/,
  );
});

test("E 双向新测试在位：活动链回落 / 非活动链不动 / live 计时剧本挂 ignored 清单", () => {
  const store = readFileSync(
    new URL("../src-tauri/src/storage/store.rs", import.meta.url),
    "utf8",
  );
  const state = readFileSync(
    new URL("../src-tauri/src/state.rs", import.meta.url),
    "utf8",
  );
  const wf = readFileSync(
    new URL("../.github/workflows/build-windows.yml", import.meta.url),
    "utf8",
  );
  assert.match(store, /fn auto_deactivate_dead_chain_exit_when_hop_subscription_disabled\(\)/);
  assert.match(store, /fn auto_deactivate_dead_chain_exit_ignores_inactive_chains\(\)/);
  assert.match(store, /fn auto_deactivate_dead_chain_exit_covers_pool_and_empty_universe\(\)/);
  // F live 计时剧本：真 sing-box 下分段测量（启用=重建+重启 vs 停用=热 PUT）。
  assert.match(state, /fn live_deactivate_chain_exit_timing\(\)/);
  assert.match(
    wf,
    /state::kernel_selection_poll_tests::live_deactivate_chain_exit_timing -- --ignored/,
  );
});

// —— 追加件1：显式池悬空引用编辑自愈 ——
test("追加1：update_pool 自愈——失效成员剔除后保存，pruned 计数返回，add 不放松", () => {
  const store = readFileSync(
    new URL("../src-tauri/src/storage/store.rs", import.meta.url),
    "utf8",
  );
  const cmd = readFileSync(
    new URL("../src-tauri/src/commands/chain.rs", import.meta.url),
    "utf8",
  );
  // 存储层：heal 在 validate 之前，Explicit healed 结果跳过整单拒绝。
  assert.match(store, /fn heal_explicit_pool_mode\(/);
  assert.match(store, /let \(mode, pruned\) = self\.heal_explicit_pool_mode\(mode\);/);
  assert.match(store, /crate::domain::PoolMode::Explicit \{ \.\. \} => \{\}/);
  // update 返回 (pool, pruned)；create_pool（add）仍走 validate_pool_mode。
  assert.match(store, /\) -> AppResult<\(crate::domain::NodePool, usize\)> \{/);
  assert.match(
    store,
    /pub fn create_pool[\s\S]*?Self::validate_pool_mode\(&mode, &self\.nodes\)\?;/,
  );
  // 命令层：camelCase wire 返回结构。
  assert.match(cmd, /pub struct UpdatePoolResult \{/);
  assert.match(cmd, /pool: NodePool,/);
  assert.match(cmd, /pruned: usize,/);
  assert.match(cmd, /Ok\(UpdatePoolResult \{ pool, pruned \}\)/);
});

test("追加1：前端提示通道——onSaved 携带 pruned，链页全局 notice 展示，双语键在位", () => {
  const page = readFileSync(root, "utf8");
  const api = readFileSync(
    new URL("../src/api.ts", import.meta.url),
    "utf8",
  );
  const types = readFileSync(
    new URL("../src/types.ts", import.meta.url),
    "utf8",
  );
  const messages = readFileSync(
    new URL("../src/i18n/messages.ts", import.meta.url),
    "utf8",
  );
  assert.match(page, /onSaved: \(pruned: number\) => void/);
  assert.match(page, /const result = await updatePool\(pool\.id, trimmed, poolMode\);/);
  assert.match(page, /onSaved\(result\.pruned\);/);
  assert.match(page, /showNotice\(\s*t\("chain\.poolPruned", \{/);
  assert.match(api, /invoke<UpdatePoolResult>\("update_pool"/);
  assert.match(types, /export interface UpdatePoolResult \{/);
  assert.match(messages, /"chain\.poolPruned": "\{name\}: pruned \{n\} missing node\(s\) on save",/);
  assert.match(messages, /"chain\.poolPruned": "「\{name\}」保存时已剔除 \{n\} 个失效节点",/);
});

// —— 追加件2：显式池悬空引用源头清理 ——
test("追加2：sweep_explicit_pool_members 单一收口 + 三挂点（删除/订阅删除/刷新替换）", () => {
  const store = readFileSync(
    new URL("../src-tauri/src/storage/store.rs", import.meta.url),
    "utf8",
  );
  const sub = readFileSync(
    new URL("../src-tauri/src/commands/subscription.rs", import.meta.url),
    "utf8",
  );
  // 收口 helper 只清显式名单（keyword/subscription 模式不碰）。
  assert.match(store, /fn sweep_explicit_pool_members\(&mut self\) -> usize \{/);
  assert.match(store, /node_ids\.retain\(\|id\| live\.contains\(id\.as_str\(\)\)\);/);
  // 挂点1：delete_node（delete_nodes 循环复用同一路径）。
  assert.match(store, /self\.sweep_explicit_pool_members\(\);\s*\n\s*Ok\(stored\.node\)/);
  // 挂点2：remove_subscription。
  assert.match(store, /self\.nodes\.retain\(\|n\| n\.subscription_id != id\);\s*\n\s*\/\/ 追加2：订阅删除即同步清扫显式池名单。/);
  // 挂点3：upsert_subscription 刷新替换——必须在新节点 splice 之后（否则合法
  // 成员被误清）；persist_import_replacing 的替换删除由该挂点顺带覆盖。
  assert.match(
    store,
    /self\.nodes\.splice\(insertion\.\.insertion, replacement\);\s*\n\s*\/\/ 追加2：刷新替换旧节点后同步清扫显式池名单/,
  );
  // persist_import_replacing 不直接清扫——依赖 upsert 挂点，零双份漂移。
  assert.doesNotMatch(sub, /sweep_explicit_pool_members/);
});

test("追加2：Rust 新测试在位——自愈保存/删除清扫/订阅删除+刷新替换", () => {
  const store = readFileSync(
    new URL("../src-tauri/src/storage/store.rs", import.meta.url),
    "utf8",
  );
  assert.match(store, /fn update_pool_heals_dangling_explicit_members\(\)/);
  assert.match(store, /fn delete_node_sweeps_explicit_pool_membership\(\)/);
  assert.match(store, /fn removal_and_refresh_sweep_explicit_pool_membership\(\)/);
});
