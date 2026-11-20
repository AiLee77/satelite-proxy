import { createRoot } from "react-dom/client";
import { useState } from "react";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { NavKey } from "../../src/types";
import type { AppSettings, ChainHop, ConnectionView, ExitIpInfo, NodePool, ProxyChain, ProxyNode, ProxyStatus, SubscriptionView } from "../../src/types";
import "../../src/App.css";
import "../../src/ProAppearance.css";
import "../../src/ProMotion.css";
import { setUiMotion } from "../../src/uiMotion";

// 所有数据仅存内存；先安装 IPC mock，再加载真实页面及其 API/Provider。
const params = new URLSearchParams(location.search);
const locale = params.get("locale") === "en" ? "en" : "zh";
const theme = params.get("theme") === "day" ? "day" : "aerospace";
const scenario = params.get("state") ?? "running";
const custom = scenario === "custom";
const short = params.get("sample") === "short";
const menuScenario = params.get("menus") === "true";
const zoom = ["1", "1.5", "2"].includes(params.get("zoom") ?? "") ? Number(params.get("zoom")) : 1;
document.documentElement.style.zoom = String(zoom);
const nodeName = short ? "香港 HK 01" : "香港 Hong Kong · IPv6 Premium Edge · LongNodeName-0123456789 · Complete Node Name ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789";
// 链场景（chain=1）：current_node_id 指向 chain: 虚拟条目，hero 信息行走链分支。
const chainScenario = params.get("chain") === "1";
const chainPageFixture = params.get("page") === "chain";
const profileName = short ? "演示订阅" : "演示订阅 Subscription-Long-Name-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ";
// 保留既有夹具字段名；短场景使用文档专用 IPv4，长场景使用 IPv6。
const ipv6 = short ? "192.0.2.8" : "2001:db8:abcd:1234:5678:90ab:cdef:1234";
const organization = short ? "CMI" : "China Mobile Communications Group Co., Ltd. / Complete Organization Name Without Truncation";
const heroStyle = params.get("hero");
document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
localStorage.setItem("satelite.theme", theme);
localStorage.setItem("satelite.heroStyle", "classic");

const settings: AppSettings = {
  mixed_port: 2080, api_port: 19090, current_node_id: chainScenario ? "chain:fixture-chain" : "fixture-node",
  probe_url: "https://example.test/204", locale, theme, hero_style: heroStyle === "smiley" || heroStyle === "particle" ? heroStyle : "classic",
  accent: "green", glow_color: "accent", glass_frost: false, core_type: "singbox",
  outbound_mode: "rule", auto_select: "off", capture_mode: "off",
  runtime_source: custom ? "singbox:fixture-sub" : "generated",
};
const nodes: ProxyNode[] = [{
  id: "fixture-node", name: nodeName, protocol: "vless", server: "2001:db8::10", port: 443,
  latency_ms: 42, latency_method: "singbox_http", subscription_id: "fixture-sub", subscription_name: profileName,
}];
const chainExitNode: ProxyNode = {
  id: "fixture-exit", name: "美国 US Exit 01", protocol: "http", server: "192.0.2.9", port: 8080,
  latency_ms: 2054, latency_method: "singbox_http", subscription_id: "fixture-sub", subscription_name: profileName,
};
const poolPickNode: ProxyNode = {
  id: "fixture-pool-node", name: "Second subscription Node", protocol: "trojan", server: "198.51.100.12", port: 443,
  latency_ms: 88, latency_method: "singbox_http", subscription_id: "fixture-sub-two", subscription_name: "第二订阅 Second subscription",
};
const chainVirtualNode: ProxyNode = {
  id: "chain:fixture-chain", name: "演示链 Fixture Chain", protocol: "unknown", server: "", port: 0,
  latency_ms: null, subscription_id: "", subscription_name: "", chain_hops: 2,
};
const poolFixture: NodePool = { id: "fixture-pool", name: "指定节点池 Fixture pool", mode: { mode: "explicit", node_ids: ["fixture-node"] } };
const chainHops: ChainHop[] = [
  { kind: "node", node_id: "fixture-node" },
  { kind: "node", node_id: "fixture-exit" },
];
const primaryChain: ProxyChain = { id: "fixture-chain", name: "演示链 Fixture Chain", hops: chainHops };
const editorChain: ProxyChain = { id: "fixture-editor-chain", name: "编辑器指定池 Fixture editor", hops: [
  { kind: "node", node_id: "fixture-node" },
  { kind: "pool", pool_id: "fixture-pool" },
] };
const deadChain: ProxyChain = { id: "fixture-dead-chain", name: "失效链 Fixture dead", hops: [
  { kind: "node", node_id: "missing-node" },
  { kind: "node", node_id: "fixture-exit" },
] };
const chains: ProxyChain[] = chainScenario ? [primaryChain, editorChain, deadChain] : [];
const subscriptions: SubscriptionView[] = [{
  id: "fixture-sub", name: profileName, enabled: true, source_kind: custom ? "custom" : "url",
  custom_kind: custom ? "singbox" : null, source_display: "https://example.test/sub",
  node_count: 1, skipped_count: 0, last_update: 1_700_000_000,
  traffic: { upload: 2 ** 30, download: 5 * 2 ** 30, total: 100 * 2 ** 30 },
}];
if (chainPageFixture) subscriptions.push({
  id: "fixture-sub-two", name: "第二订阅 Second subscription", enabled: true, source_kind: "url",
  custom_kind: null, source_display: "https://example.test/sub-two", node_count: 1, skipped_count: 0,
  last_update: 1_700_000_000, traffic: { upload: 0, download: 0, total: 0 },
});
// 菜单场景独立追加完整配置，不改变既有概览/服务场景的数据。
if (menuScenario) subscriptions.push({
  id: "fixture-menu-profile", name: "菜单配置 Menu profile · Complete long name 0123456789",
  enabled: false, source_kind: "custom", custom_kind: "singbox", source_display: "fixture",
  node_count: 0, skipped_count: 0, last_update: 1_700_000_000,
});
const bucket = (up: number, down: number, upload: number, download: number) => ({
  upload_speed: up, download_speed: down, upload_total: upload, download_total: download,
});
const running = scenario === "running" || custom;
const status: ProxyStatus = {
  running, core_state: running ? "running" : scenario === "starting" ? "starting" : scenario === "error" ? "error" : "stopped",
  system_proxy: false, tun_enabled: false, capture_mode: "off", outbound_mode: "rule",
  mixed_port: 2080, api_port: 19090, core_type: "singbox", current_node_id: chainScenario ? "chain:fixture-chain" : nodes[0].id,
  runtime_source: custom ? "singbox" : "generated", runtime_profile_id: custom ? "fixture-sub" : null,
  runtime_profile_name: custom ? profileName : null, custom_inbound_port: custom ? 2080 : null,
  error: scenario === "error" ? "模拟内核启动失败" : null,
  core_started_at: Math.floor(Date.now() / 1000) - 3661, core_memory_bytes: 48 * 2 ** 20,
  auto_select: "off", connections: running ? 2 : 0,
  ...bucket(running ? 3072 : 0, running ? 12288 : 0, 49152, 98304),
  traffic_breakdown: {
    source: custom ? "unavailable" : "connections",
    proxy: bucket(running ? 2048 : 0, running ? 8192 : 0, 32768, 65536),
    direct: bucket(running ? 1024 : 0, running ? 4096 : 0, 16384, 32768),
    unclassified: bucket(0, 0, 0, 0),
  },
};
const connections: ConnectionView[] = ["node-fixture", "direct"].map((tag, i) => ({
  id: `connection-${i}`, destination: "[2001:db8::80]:443", host: "example.test", network: "tcp",
  conn_type: "Mixed", node_tag: tag, node_name: i ? "direct" : nodeName, chains: [tag],
  chains_display: tag, rule: "fixture", rule_payload: "", process: i ? "browser.exe" : "LongApplicationName-0123456789.exe",
  source: "192.0.2.20:50000", upload: 1024, download: 4096, start: "2026-01-01T00:00:00Z", closed: false,
}));
const state = {
  settings, status, nodes, subscriptions, ipv6, organization, short, commands: [] as { command: string; payload: unknown }[],
  poolWrites: [] as unknown[],
  unexpected: [] as string[], statusReads: 0, connectionReads: 0, trafficOpens: 0,
  holdStart: false, releaseStart: null as null | (() => void),
  serviceFailures: 0,
  claudeStatus: "available", claudeRegion: "US", claudeHttp: 200,
  countryCode: "HK", exitIpReads: 0, holdExitIp: false, releaseExitIp: null as null | (() => void),
  ipOverride: null as string | null, orgOverride: null as string | null,
  holdMetadata: false, releaseMetadata: null as null | (() => void),
  exitSource: "https://example.test/cdn-cgi/trace?format=plain%20text",
  exitCheckedAt: 1_700_000_000_000 as number | undefined,
  setMotion: setUiMotion,
  placeMore(edge: "default" | "right", viewportWidth: number) {
    const owner = document.querySelector<HTMLElement>(".dash-more")!;
    owner.style.transform = "";
    if (edge === "default") return;
    // 仅挪动真实触发容器，菜单 DOM、样式及定位仍由生产组件负责。
    const rect = owner.getBoundingClientRect();
    const main = document.querySelector<HTMLElement>("main")!;
    const mainRect = main.getBoundingClientRect();
    const scale = rect.width / owner.offsetWidth;
    const right = Math.min(viewportWidth, mainRect.left + (main.clientLeft + main.clientWidth) * scale) - 12;
    owner.style.transform = `translateX(${(right - rect.right) / scale}px)`;
  },
};
(window as unknown as { dashboardFixture: typeof state }).dashboardFixture = state;
const copy = <T,>(value: T): T => structuredClone(value);
mockIPC((command, payload) => {
  state.commands.push({ command, payload: copy(payload) });
  const args = (payload ?? {}) as Record<string, unknown>;
  switch (command) {
    // 真实侧栏的 UiModeProvider 仅操作模拟窗口，不改变浏览器视口。
    case "set_ui_mode_pref":
    case "plugin:window|set_min_size":
    case "plugin:window|set_max_size":
    case "plugin:window|set_resizable":
    case "plugin:window|set_size": return;
    case "plugin:window|current_monitor": return null;
    case "plugin:window|is_maximized": return false;
    case "plugin:window|inner_size": return { width: window.innerWidth * devicePixelRatio, height: window.innerHeight * devicePixelRatio };
    case "get_settings": return copy(settings);
    case "get_proxy_status": state.statusReads++; return copy(status);
    case "list_all_nodes": return copy(chainScenario
      ? [...nodes, chainExitNode, ...(chainPageFixture ? [poolPickNode, chainVirtualNode] : [chainVirtualNode])]
      : nodes);
    case "list_subscriptions": return copy(subscriptions);
    case "list_chains": return copy(chains);
    case "list_pools": return copy(chainScenario ? [poolFixture] : []);
    case "list_chain_usage": return {};
    case "update_pool": {
      state.poolWrites.push(copy(args.mode));
      poolFixture.mode = copy(args.mode as NodePool["mode"]);
      return { pool: copy(poolFixture), pruned: 0 };
    }
    // 代理链页候选全量节点（含 enabled 标记）。
    case "list_chain_nodes": return copy(chainScenario
      ? [...nodes, chainExitNode, ...(chainPageFixture ? [poolPickNode] : [])]
      : nodes);
    case "get_subscription": return { ...copy(subscriptions[0]), content: "{}" };
    case "get_core_info": return {
      kind: args.kind, name: args.kind === "singbox" ? "sing-box" : args.kind === "xray" ? "Xray" : "mihomo",
      installed: true, version: "1.13.18", source: "bundled", platform: "windows-amd64", update_available: false,
    };
    case "get_lan_ip": return ipv6;
    case "check_exit_ip": {
      state.exitIpReads++;
      const result: ExitIpInfo = {
        ip: state.ipOverride ?? ipv6, countryCode: state.countryCode, viaProxy: true, source: state.exitSource,
        ...(state.exitCheckedAt === undefined ? {} : { checkedAt: state.exitCheckedAt }),
      };
      if (!state.holdExitIp) return result;
      return new Promise(resolve => { state.releaseExitIp = () => { state.releaseExitIp = null; resolve(result); }; });
    }
    case "check_ip_metadata": {
      const resolveMetadata = () => ({
        ip: state.ipOverride ?? ipv6, organization: state.orgOverride ?? organization,
        isp: "China Mobile Communications", asn: "AS9808", networkType: ["tor", "abuse"].includes(params.get("network") ?? "") ? "business" : params.get("network") ?? "business", residentialInferred: false,
        quality: params.get("network") === "tor" ? "high" : "low",
        ipQuality: ["tor", "abuse"].includes(params.get("network") ?? "") ? "risky" : params.get("network") === "datacenter" ? "normal" : ["isp", "unknown"].includes(params.get("network") ?? "") ? "unknown" : "good",
        riskScore: 5, riskSource: "IPQuery", isVpn: false, isProxy: false, isTor: params.get("network") === "tor", isAbuser: params.get("network") === "abuse", source: "IPQuery / proxycheck.io", checkedAt: 1700000000,
      });
      if (!state.holdMetadata) return resolveMetadata();
      return new Promise(resolve => { state.releaseMetadata = () => { state.releaseMetadata = null; resolve(resolveMetadata()); }; });
    }
    case "check_service_status": {
      const failing = state.serviceFailures > 0;
      if (failing) { state.serviceFailures--; throw new Error("core transitioning"); }
      return {
      results: (args.ids as string[]).map(id => ({ id, status: id === "claude" ? state.claudeStatus : ["youtube", "chatgpt"].includes(id) ? "available" : "reachable",
        checkKind: ["google", "github"].includes(id) ? "reachability" : "availability",
        ...(id === "claude" ? { region: state.claudeRegion || undefined } : ["youtube", "chatgpt"].includes(id) ? { region: "US" } : {}),
        latencyMs: id === "github" ? 576 : 160, httpStatus: id === "claude" ? state.claudeHttp : id === "chatgpt" ? 403 : 200,
        ...(id === "chatgpt" ? { reason: "expected_denial" } : {}),
        routes: [
          { role: "primary", host: `${id}.fixture.test`, matchStatus: "matched", chains: [id === "github" ? "DIRECT" : "US-AI", "服务分流"],
            rule: "DomainSuffix", rulePayload: `${id}.fixture.test`, outboundTag: id === "github" ? "DIRECT" : "US-AI",
            exitIp: id === "github" ? "192.0.2.8" : "2001:db8::8", exitSource: "pinned_outbound_probe", exitCached: false },
          ...(id === "chatgpt" ? [{ role: "auxiliary", host: "chat.openai.com", matchStatus: "matched", chains: ["DIRECT"],
            rule: "DomainSuffix", rulePayload: "chat.openai.com", outboundTag: "DIRECT", exitIp: "198.51.100.9", exitSource: "service_response" }] : []),
        ],
        checkedAt: 1700000000000, viaProxy: status.running })),
      checkedAt: 1700000000000, viaProxy: status.running,
    }; }
    case "list_connection_changes":
      state.connectionReads++;
      return { rows: copy(connections), removed_ids: [], order_ids: connections.map(row => row.id),
        revision: state.connectionReads, order_revision: 1, unchanged: false, full: true };
    case "test_nodes_latency": return {
      results: [{ id: nodes[0].id, name: nodeName, latency_ms: 42, tested_at: 1_700_000_000, method: "singbox_http" }],
      tested: 1, ok: 1, failed: 0,
    };
    case "set_outbound_mode":
      if (!["rule", "global", "direct"].includes(String(args.mode))) throw new Error("非法模式参数");
      settings.outbound_mode = status.outbound_mode = args.mode as "rule" | "global" | "direct";
      return copy(status);
    case "set_runtime_source": {
      if (!menuScenario || !["generated", "singbox:fixture-menu-profile"].includes(String(args.source))) throw new Error("非法夹具配置参数");
      const profile = args.source === "generated" ? null : subscriptions.find(sub => sub.id === "fixture-menu-profile")!;
      settings.runtime_source = String(args.source);
      status.runtime_source = profile ? "singbox" : "generated";
      status.runtime_profile_id = profile?.id ?? null;
      status.runtime_profile_name = profile?.name ?? null;
      status.custom_inbound_port = profile ? settings.mixed_port : null;
      status.traffic_breakdown!.source = profile ? "unavailable" : "connections";
      return copy(settings);
    }
    case "set_capture_mode":
      if (!["off", "system", "tun"].includes(String(args.mode))) throw new Error("非法接管参数");
      settings.capture_mode = status.capture_mode = args.mode as "off" | "system" | "tun";
      status.system_proxy = args.mode === "system";
      settings.tun_enabled = status.tun_enabled = args.mode === "tun";
      return copy(status);
    case "update_settings":
      if (args.autoSelect !== "off" && args.autoSelect !== "kernel") throw new Error("夹具只允许手动/自动切换");
      settings.auto_select = status.auto_select = args.autoSelect;
      return copy(settings);
    case "start_proxy": {
      const finish = () => {
        status.running = true; status.core_state = "running"; status.error = null;
        state.releaseStart = null;
        return copy(status);
      };
      if (!state.holdStart) return finish();
      status.core_state = "starting";
      return new Promise(resolve => { state.releaseStart = () => resolve(finish()); });
    }
    case "stop_proxy":
      status.running = false; status.core_state = "stopped"; status.connections = 0;
      status.upload_speed = status.download_speed = 0;
      for (const row of Object.values(status.traffic_breakdown!).filter(value => typeof value === "object")) {
        row.upload_speed = row.download_speed = 0;
      }
      return copy(status);
    case "plugin:app|version": return "1.0.46";
    default:
      state.unexpected.push(command);
      throw new Error(`概览夹具禁止未声明 IPC：${command}`);
  }
}, { shouldMockEvents: true });
mockWindows("main");

const { DashboardPage } = await import("../../src/pages/DashboardPage");
const { ChainPage } = await import("../../src/pages/ChainPage");
const { NodesPage } = await import("../../src/pages/NodesPage");
const { LocaleProvider } = await import("../../src/i18n");
const { ThemeProvider } = await import("../../src/theme");
const { UiModeProvider } = await import("../../src/ui/UiModeContext");
const { TopNav } = await import("../../src/components/TopNav");
localStorage.setItem("satelite.uiMode", "pro");
function DashboardFixture() {
  const [nav, setNav] = useState<NavKey>(chainPageFixture ? "chains" : "dashboard");
  return (
    <div className="app-shell">
      <TopNav active={nav} onChange={setNav} />
      <main className="main">
        <div className={`page-enter${nav === "settings" ? " settings-enter" : ""}`} key="dashboard" style={chainPageFixture ? { position: "fixed", left: "-10000px", visibility: "hidden", pointerEvents: "none" } : undefined}>
          <DashboardPage onGoTraffic={() => { state.trafficOpens++; }} />
        </div>
        {chainPageFixture && nav === "chains" && <ChainPage />}
        {chainPageFixture && <div style={{ position: "fixed", left: "-10000px", visibility: "hidden", pointerEvents: "none" }}><NodesPage /></div>}
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <ThemeProvider><LocaleProvider><UiModeProvider>
    <DashboardFixture />
  </UiModeProvider></LocaleProvider></ThemeProvider>,
);
