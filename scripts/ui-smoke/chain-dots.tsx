import { createRoot } from "react-dom/client";
import { mockIPC } from "@tauri-apps/api/mocks";
import { LocaleProvider } from "../../src/i18n";
import { ThemeProvider } from "../../src/theme";
import "../../src/App.css";
import "../../src/ProAppearance.css";
import "../../src/ProMotion.css";
import "../../src/components/IpInfoPanel.css";
import "../../src/components/ServiceStatusCard.css";
import "../../src/pages/DashboardPage.css";
import type { NodePool, ProxyNode, SubscriptionView } from "../../src/types";

// Real ChainPage + the complete production CSS surface. All IPC below stays
// in memory; this fixture never starts Satelite, a proxy core, or user data.
const nodes: ProxyNode[] = [
  { id: "fixture-node", name: "节点 A", protocol: "vless", server: "192.0.2.1", port: 443, enabled: true, latency_ms: 42, subscription_id: "fixture-sub", subscription_name: "演示订阅" },
  { id: "fixture-exit", name: "节点 B", protocol: "trojan", server: "192.0.2.2", port: 443, enabled: true, latency_ms: 88, subscription_id: "fixture-sub", subscription_name: "演示订阅" },
  { id: "fixture-pool-node", name: "Second subscription Node", protocol: "http", server: "192.0.2.3", port: 8080, enabled: true, latency_ms: 120, subscription_id: "fixture-sub-two", subscription_name: "第二订阅" },
];
const subscriptions: SubscriptionView[] = [
  { id: "fixture-sub", name: "演示订阅", enabled: true, source_kind: "url", custom_kind: null, source_display: "https://example.test/sub", node_count: 2, skipped_count: 0, last_update: 1_700_000_000, traffic: { upload: 0, download: 0, total: 0 } },
  { id: "fixture-sub-two", name: "第二订阅", enabled: true, source_kind: "url", custom_kind: null, source_display: "https://example.test/sub-two", node_count: 1, skipped_count: 0, last_update: 1_700_000_000, traffic: { upload: 0, download: 0, total: 0 } },
];
const pool: NodePool = { id: "fixture-pool", name: "指定节点池 Fixture pool", mode: { mode: "explicit", node_ids: ["fixture-node"] } };
const copy = <T,>(value: T): T => structuredClone(value);
mockIPC((command, payload) => {
  const args = (payload ?? {}) as Record<string, unknown>;
  switch (command) {
    case "get_settings": return { mixed_port: 2080, api_port: 19090, probe_url: "https://example.test/204", locale: "zh", theme: "aerospace", core_type: "singbox", runtime_source: "generated", current_node_id: "fixture-node" };
    case "get_proxy_status": return { running: false, core_type: "singbox", runtime_source: "generated", current_node_id: "fixture-node" };
    case "list_chain_nodes": return copy(nodes);
    case "list_subscriptions": return copy(subscriptions);
    case "list_pools": return [copy(pool)];
    case "list_chains": return [{ id: "fixture-chain", name: "演示链 Fixture Chain", name_manual: true, hops: [{ kind: "node", node_id: "fixture-node" }, { kind: "node", node_id: "fixture-exit" }] }];
    case "list_chain_usage": return {};
    case "update_pool":
      pool.mode = copy(args.mode as NodePool["mode"]);
      return { pool: copy(pool), pruned: 0 };
    default: throw new Error(`池圆点夹具禁止未声明 IPC：${command}`);
  }
}, { shouldMockEvents: true });

const { ChainPage } = await import("../../src/pages/ChainPage");
createRoot(document.getElementById("root")!).render(
  <ThemeProvider><LocaleProvider>
    <div className="app-shell pro-shell"><main className="main"><ChainPage /></main></div>
  </LocaleProvider></ThemeProvider>,
);
