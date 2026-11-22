# FlClash 唯一版：日志图标与流量接管提示收尾

日期：2026-11-21。分支：`feature-flclash-ui`；开工 HEAD：`f868cfc29eaa847567213ae041774a3027232cab`，工作区干净。本轮未修改 `feature-reskin-topnav`（本地及远端均保持 `0802804ac4d09bc6b1e0e576af17a083c3004acb`），未启动真实 Satelite 客户端、系统代理、TUN 或任何代理内核；浏览器验证全部使用生产 DOM/CSS + Vite + mock IPC。

## 1. 改动清单

- `src/components/SideNav.tsx`：仅将日志项由 `terminal` 改为 Lucide 官方 `lucide-icons/lucide@c1a02a0/icons/file-text.svg` 的五条原始路径，不新增依赖。保留 `viewBox="0 0 24 24"`、`strokeWidth="1.7"`、普通/激活同图描边、激活态 `--primary` 和现有指示胶囊；其余六图标的源码未改。
- 全库触发点检索确认 `SystemProxyRestartNotice` 只有两个入口：专业概览 `DashboardPage` 和简洁概览 `SimpleConnectPage`。两处 import、专属 state、成功切入系统代理时的触发及 JSX 渲染均已删除。
- 删除无其他引用的 `src/components/SystemProxyRestartNotice.tsx`、四组 `.system-proxy-restart-*` 专属 CSS，以及 `dashboard.restartAppsTitle/Notice/Detail/Acknowledge` 中英文专属文案。
- 共享代码保留且未改变：`useCaptureModeSwitch`（专业页成功后的普通 `reload()` 回调仍使用它）、`GlassButton`、通用 modal 样式和 `dashboard.captureSystemHint`。关闭/系统/TUN 的 UI、`set_capture_mode` IPC、乐观切换与生效/失败恢复逻辑均未改。

## 2. 断言先红后绿

### 弹窗（生产 DashboardPage + 生产 CSS + dashboard mock 夹具）

`scripts/verify-dashboard-parity.mjs` 执行 `off → system → off → system`，等待 mock IPC 和 React commit 后断言 `.system-proxy-restart-modal` 不在 DOM，并核对 IPC 顺序保持 `system/off/system`。

- 改前红：`切换到 system 后不得出现重启提示弹窗`，**实际 1，期望 0**。
- 改后绿：**7 scenarios passed**；三次模式切换后模态数量均为 **0**，IPC 顺序断言通过，随后恢复关闭状态完成原有其余场景。

### 图标（真实 SideNav + 生产 CSS）

`scripts/verify-side-nav-icons.mjs` 断言 logs 的五个 `path d` 与官方 `file-text.svg` 完全相同，并比较 logs 与同列流量项的普通/激活 computed 尺寸和颜色。

- 改前红：实际 Lucide 名 `terminal`，期望 `file-text`。
- 改后绿：**7 图标 / 14 张普通与激活截图通过**，官方路径、24 viewBox、1.7 描边、双态同图、主题色和指示胶囊均通过。

| 状态 | logs 期望 = 实测 | 同列流量项实测 | 对比 |
| --- | --- | --- | --- |
| 普通 | `20px × 20px`；`rgba(255, 255, 255, 0.55)` | `20px × 20px`；`rgba(255, 255, 255, 0.55)` | 完全一致 |
| 激活 | `20px × 20px`；`rgb(85, 200, 154)` | `20px × 20px`；`rgb(85, 200, 154)` | 完全一致 |

普通/激活 SVG markup 相同，`unchanged: true`。

## 3. 其他实际验证

| 验证 | 结果 |
| --- | --- |
| `pnpm build` | 通过；便携包构建的第二次前端构建也通过。 |
| `D:\Playwright-Portable\run-ui-tests.ps1` | **10/10 全部通过**，无跳过。 |
| 当前 `node --test scripts/test-*.mjs` | **169 项：158 通过 / 11 失败**。 |
| 独立 `f868cfc` worktree 基线（复用同一 `node_modules`，用后删除） | **169 项：158 通过 / 11 失败**。 |
| 当前与基线失败文件名排序 diff | **为空，无新增失败**。11 项均为未配置浏览器环境时的既有拒绝项；其中主 10 项已在指定 Playwright 环境全部通过。 |
| `scripts/verify-flclash-chain-navigation.mjs` | 通过：独立链页、设置 7 标签、无外部请求或未声明 IPC。 |
| `git diff --check` | 通过。 |

## 4. FlClash 版便携包

**这是 `feature-flclash-ui` 的 FlClash 版便携包，不是现行 `feature-reskin-topnav` 版的包。**

- 构建前已显式删除同名旧 ZIP，随后运行 `./scripts/build-windows.ps1 -Bundle portable`。
- 文件：`D:\Gihub_Projects\satelite-proxy\src-tauri\target\release\bundle\portable\Satelite_1.0.46_x64_portable.zip`
- 大小：**31,380,204 字节（29.927 MiB）**。
- SHA-256：**`ddf98af0106844961320412e9af6f2621f679dbc8cb5ad69ede7dce463638800`**。
- `unzip -t`：全部条目通过，无压缩数据错误。
- 默认仅内置 sing-box，沿用便携版约定；构建只有既有 Rust dead-code/命名警告和前端 chunk 提示。未运行 ZIP 内客户端或内核。
