import { createRoot } from "react-dom/client";
import { mockIPC } from "@tauri-apps/api/mocks";
import { LocaleProvider } from "../../src/i18n";
import { ThemeProvider } from "../../src/theme";
import "../../src/App.css";
import "../../src/ProAppearance.css";

const nodes = ["a", "b", "c"].map((id, i) => ({ id, name: i ? "Exit" : "Entry", protocol: "vless", server: "example.test", port: 443, subscription_id: "sub", subscription_name: "Fixture", enabled: true, latency_ms: 42 }));
const state = { unexpected: [] as string[] };
(window as unknown as { chainParityFixture: typeof state }).chainParityFixture = state;
mockIPC((command) => {
  switch (command) {
    case "get_settings": return { mixed_port: 2080, api_port: 19090, probe_url: "https://example.test/204", locale: "zh", theme: "day", core_type: "singbox", runtime_source: "generated", current_node_id: "a" };
    case "get_proxy_status": return { running: false, core_type: "singbox", runtime_source: "generated", current_node_id: "a" };
    case "list_chain_nodes": return structuredClone(nodes);
    case "list_subscriptions": return [{ id: "sub", name: "Fixture", enabled: true, source_kind: "url", node_count: 2 }];
    case "list_pools": return [{ id: "pool", name: "Fixture pool", mode: { mode: "explicit", node_ids: ["a", "b"] } }];
    case "list_chains": return [{ id: "chain", name: "Fixture chain", name_manual: true, hops: [{ kind: "node", node_id: "a" }, { kind: "pool", pool_id: "pool" }], enabled: true }];
    default: state.unexpected.push(command); throw new Error(`Unexpected mock IPC: ${command}`);
  }
}, { shouldMockEvents: true });
const { ChainPage } = await import("../../src/pages/ChainPage");
createRoot(document.getElementById("root")!).render(<ThemeProvider><LocaleProvider><div className="app-shell pro-shell"><main className="main"><ChainPage /></main></div></LocaleProvider></ThemeProvider>);
