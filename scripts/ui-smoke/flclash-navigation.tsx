import { useState } from "react";
import { createRoot } from "react-dom/client";
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { AppSettings, NavKey } from "../../src/types";
import { LocaleProvider } from "../../src/i18n";
import { ThemeProvider } from "../../src/theme";
import { UiModeProvider } from "../../src/ui/UiModeContext";
import "../../src/App.css";
import "../../src/ProAppearance.css";
import "../../src/ProMotion.css";

const settings: AppSettings = {
  mixed_port: 2080,
  api_port: 19090,
  probe_url: "https://example.test/204",
  locale: "zh",
  theme: "aerospace",
  core_type: "singbox",
  runtime_source: "generated",
  current_node_id: "entry",
  auto_select: "off",
  multi_core_enabled: false,
  protocol_core_defaults: [],
};
const nodes = ["entry", "exit"].map((id, index) => ({
  id,
  name: index ? "美国出口" : "香港入口",
  protocol: "vless",
  server: "example.test",
  port: 443,
  subscription_id: "sub",
  subscription_name: "演示订阅",
  enabled: true,
  latency_ms: 42,
}));
const state = { unexpected: [] as string[] };
(window as unknown as { navigationFixture: typeof state }).navigationFixture = state;

mockIPC((command, payload) => {
  switch (command) {
    case "set_ui_mode_pref":
    case "plugin:window|set_min_size":
    case "plugin:window|set_max_size":
    case "plugin:window|set_resizable":
    case "plugin:window|set_size": return;
    case "plugin:window|current_monitor": return null;
    case "plugin:window|is_maximized": return false;
    case "plugin:window|inner_size": return {
      width: window.innerWidth * devicePixelRatio,
      height: window.innerHeight * devicePixelRatio,
    };
    case "get_settings": return structuredClone(settings);
    case "get_proxy_status": return {
      running: false,
      core_type: "singbox",
      runtime_source: "generated",
      current_node_id: "entry",
    };
    case "list_chain_nodes": return structuredClone(nodes);
    case "list_subscriptions": return [{
      id: "sub", name: "演示订阅", enabled: true, source_kind: "url", node_count: 2,
    }];
    case "list_pools": return [{
      id: "pool", name: "演示节点池", mode: { mode: "explicit", node_ids: ["entry", "exit"] },
    }];
    case "list_chains": return [{
      id: "chain", name: "香港入口 → 美国出口", name_manual: true, enabled: false,
      hops: [{ kind: "node", node_id: "entry" }, { kind: "node", node_id: "exit" }],
    }];
    case "get_core_info": return { kind: (payload as { kind: string }).kind, version: null };
    case "plugin:app|version": return "1.0.46";
    case "get_app_install_path": return "fixture";
    case "check_app_update": return {
      current_version: "1.0.46", latest_version: null, update_available: false,
    };
    default:
      state.unexpected.push(command);
      throw new Error(`导航夹具禁止未声明 IPC：${command}`);
  }
}, { shouldMockEvents: true });
mockWindows("main");
localStorage.setItem("satelite.uiMode", "pro");
localStorage.setItem("satelite.theme", "aerospace");

const { ChainPage } = await import("../../src/pages/ChainPage");
const { SettingsPage } = await import("../../src/pages/SettingsPage");
const { SideNav } = await import("../../src/components/SideNav");

function NavigationFixture() {
  const [nav, setNav] = useState<NavKey>("dashboard");
  return (
    <div className="app-shell pro-shell">
      <SideNav active={nav} onChange={setNav} />
      <main className="main">
        <div className={`page-enter${nav === "settings" ? " settings-enter" : ""}`} key={nav}>
          {nav === "chains" && <ChainPage />}
          {nav === "settings" && <SettingsPage />}
          {nav !== "chains" && nav !== "settings" && (
            <div className="page"><header className="page-header"><h1>导航验收</h1></header></div>
          )}
        </div>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <ThemeProvider><LocaleProvider><UiModeProvider>
    <NavigationFixture />
  </UiModeProvider></LocaleProvider></ThemeProvider>,
);
