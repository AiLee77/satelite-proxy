# FlClash 唯一版：代理链侧栏入口与定版图标收尾报告

日期：2026-11-21。分支：`feature-flclash-ui`；任务基准 HEAD：`3298549`。本轮没有修改 `feature-reskin-topnav`，没有启动真实 Satelite 客户端、系统代理、TUN 或任何代理内核；浏览器验证全部使用 Vite + mock IPC。

## 1. 定版改动

- `src/components/SideNav.tsx`：在节点之后新增 `{ key: "chains", labelKey: "nav.chains" }`，导航顺序固定为 **概览 / 节点 / 代理链 / 配置 / 流量 / 日志 / 设置**。
- `src/i18n/messages.ts`：补齐 `nav.chains` 中英文文案 `Proxy Chains` / `代理链`。
- `src/App.tsx`：懒加载并独立渲染非 embedded 的 `<ChainPage />`；快捷键与现行版对齐为 `1` 概览、`2` 节点、`3` 代理链、`4` 配置、`5` 流量、`6` 日志。
- `src/pages/SettingsPage.tsx`：移除 chain 标签类型、标签定义、custom 禁用项与提示、错误显示例外、滚动样式联动及 `<ChainPage embedded />` 渲染；其余设置标签和行为不变。
- 图标全部内联自 Lucide 官方 `lucide-icons/lucide@c1a02a0` 原始 SVG，不新增依赖；保留 `viewBox="0 0 24 24"`、`strokeWidth="1.7"`、普通/激活同图描边、激活态 `--primary` 与既有指示胶囊。

| 页面 | Lucide 图标 |
| --- | --- |
| 概览 | `layout-grid`（不变） |
| 节点 | `network` |
| 代理链 | `link` |
| 配置 | `sliders-horizontal` |
| 流量 | `activity` |
| 日志 | `terminal` |
| 设置 | `settings`（不变） |

同步更新 `scripts/test-dashboard-browser.mjs` 的七入口断言和图标遍历，以及 `scripts/verify-side-nav-icons.mjs` 的官方图形节点数、七图标顺序和双态截图断言。新增 `scripts/verify-flclash-chain-navigation.mjs` 与 `scripts/ui-smoke/flclash-navigation.*`，覆盖真实 SideNav、ChainPage、SettingsPage 的 mock 导航验收。

## 2. 实际验证

| 验证 | 结果 |
| --- | --- |
| `pnpm build` | 通过；便携包构建中的第二次前端构建也通过。 |
| `D:\Playwright-Portable\run-ui-tests.ps1` | **10/10 全部通过**，无跳过。 |
| `node --test scripts/test-*.mjs` | **169 项：158 通过 / 11 失败**。与基准 `3298549` 的既有记录相同；11 项仍为未配置浏览器环境时拒绝运行的同一组 browser 脚本，无新增失败。 |
| `scripts/verify-side-nav-icons.mjs` | **7 图标 / 14 张普通与激活截图通过**；名称顺序、官方图形节点数、24 viewBox、1.7 描边、同图 markup、主题色及指示胶囊均通过。 |
| `scripts/verify-flclash-chain-navigation.mjs` | 通过：侧栏点击代理链进入 `.page.chain-page`，不存在 `.chain-embed`；设置页保留其余 7 个标签，代理链标签数量为 0；无页面异常、外部请求或未声明 IPC。 |
| 截图人工复核 | `test-results/side-nav-icons/contact-sheet.png`、`test-results/flclash-navigation/chain-page.png`、`settings-page.png`：七图标两态清晰无变形，激活胶囊正常；链页与设置页渲染符合清单。 |
| `git diff --check` | 通过。 |

普通 Node 环境下的 11 个既有失败文件为：`test-config-activation-browser.mjs`、`test-core-selection-browser.mjs`、`test-dashboard-browser.mjs`、`test-mihomo-groups-browser.mjs`、`test-node-delete-browser.mjs`、`test-pool-dots-browser.mjs`、`test-qr-import-browser.mjs`、`test-rules-sidebar.mjs`、`test-traffic-stats-browser.mjs`、`test-traffic-table-browser.mjs`、`test-xray-latency-browser.mjs`。其中主 10 项已在指定 Playwright 环境全部实跑通过，池专项属于既有环境拒绝项，并非本轮新增回归。

## 3. FlClash 版便携包

**这是 `feature-flclash-ui` 的 FlClash 版便携包，不是现行 `feature-reskin-topnav` 版的包。**

- 构建前已删除同名旧 ZIP，随后运行 `./scripts/build-windows.ps1 -Bundle portable`。
- 文件：`D:\Gihub_Projects\satelite-proxy\src-tauri\target\release\bundle\portable\Satelite_1.0.46_x64_portable.zip`
- 大小：**31,380,560 字节（29.927 MiB）**。
- SHA-256：**`7816367ed3f0ab2424ef6f08b704d5018b053376f74bcb4674930dd1bae8bb72`**。
- `unzip -t`：全部条目 CRC 检查通过，无压缩数据错误。
- 默认仅内置 sing-box，沿用项目便携版约定；构建只有既有 Rust dead-code/命名警告和前端 chunk 提示。未运行 ZIP 内客户端或内核。
