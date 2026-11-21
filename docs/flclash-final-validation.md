# FlClash 分支最终收尾验证

验证日期：2026-11-21。分支 `feature-flclash-ui`，功能源 `feature-reskin-topnav @ 272dade`，CSS 移植前基线 `cff1205`。应用版本保持 `1.0.46`。

## 对账与 Dashboard 落点

开始时已在 `feature-flclash-ui`，HEAD 为 `3c8acc8`，工作区干净。未重做已完成的后端、api/types、ChainPage 和功能层簇。

| 项目 | 本轮提交 | 首页位置及结果 |
| --- | --- | --- |
| 链出口信息 | `8e9aa12` | 顶部状态卡下半部节点信息：恢复 `listChains`，固定尾跳显示链/跳数/出口协议/延迟；池尾跳、失效尾跳不推测出口。虚拟链 ID 不进入单节点测速。 |
| 应用版本 | `e14cf3e` | 首页标题栏右侧 `SATELITE · 1.0.46`；已有实现保留，新增版本读取一次与可见性回归。 |
| 系统代理重启提示 | `1293717` | 快速控制条切入“系统”成功后显示既有提示弹窗；已有实现保留，新增成功切入/关闭/不重复弹出的回归。 |
| 组合网络探测 | `6be6a34` | 中部信息网格“网络探测”卡，同时刷新真实延迟与出口 IP；沿用 FlClash 卡片，新增忙碌防重入和可访问状态，链模式展示固定尾跳延迟。 |
| 流量速率卡逻辑 | `5dea65a` | 顶部上传/下载两卡；已有快照、累计、60 点趋势保留，新增双向速率、跳转流量页、新会话清峰值、停止归零回归。既有 Node 速率卡测试同时覆盖累计、非法值和 60 点窗口。 |

每组提交前均执行 `pnpm build` 并成功。第二、三、五组属于已有实现的确认与回归补证，未虚称新增相同功能。未移入源分支仪表盘布局或 CSS。

## CSS computed 证据

脚本 `scripts/verify-css-parity.mjs` 启动 Vite 与 Playwright，使用真实 Dashboard、SettingsPage、ChainPage 和 mock IPC。对同一元素替换对应 Git 版本的 CSS，关闭动画/过渡以排除取样时刻差异。非链页面只替换 `App.css`，专门隔离三个链类名排除项的影响；链页面替换 `App.css` 和 `ChainPage.css` 与 `272dade` 比对。

共 7 组取样，每组 28 项 computed 属性，差异均为 0。完整双侧值已提交到 [flclash-css-parity.json](validation/flclash-css-parity.json)。这里只表示所列元素与属性一致，不扩张为全页面全属性证明。

| 真实元素 | 参考提交 | 抽查值（两侧相同） |
| --- | --- | --- |
| Dashboard 更多菜单普通按钮 | `cff1205` | 背景 `rgba(0, 0, 0, 0)`；文字 `rgba(255, 255, 255, 0.92)`；圆角 `8px`；padding `7.2px 10.4px`；字号 `12.48px` |
| SettingsPage 普通标签按钮 | `cff1205` | 背景 `rgba(0, 0, 0, 0)`；文字 `rgba(18, 22, 28, 0.92)`；圆角 `999px`；padding `5.12px 11.2px`；字号 `11.52px` |
| 链卡激活按钮 | `272dade` | 全部 28 项相同 |
| 链卡站点圆点 | `272dade` | 全部 28 项相同 |
| 池编辑器选中圆点 | `272dade` | 全部 28 项相同 |
| 池编辑器选中圆点 `::before` | `272dade` | 全部 28 项相同 |
| 池编辑器未选中圆点 | `272dade` | 全部 28 项相同 |

本轮没有修改 `src/App.css` 或 `src/pages/ChainPage.css`。

## 全量验证实际数字

| 检查 | 结果 |
| --- | --- |
| 每组及最终 `pnpm build` | 全部成功 |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | 759 通过 / 0 失败 / 18 忽略 |
| `cargo test --manifest-path src-tauri/Cargo.toml --test parse_subscription` | 5 通过 / 0 失败 |
| 当前分支 `node --test` | 127 项：117 通过 / 10 失败 |
| 当前分支 `node --test scripts/test-*.mjs` | 同为 117 通过 / 10 失败 |
| 独立提取 `cff1205` 后运行相同 scripts/test-*.mjs 清单 | 114 项：104 通过 / 10 失败 |
| `scripts/verify-dashboard-parity.mjs` | 7 个 mock 场景通过 |
| `scripts/verify-css-parity.mjs` | 7 组 × 28 属性，全相同 |
| `D:\Playwright-Portable\run-ui-tests.ps1` | 10 / 10 脚本通过 |
| `scripts/build-windows.ps1 -Bundle portable` | 成功；开跑前删除了同名旧 ZIP |
| `git diff --check` | 通过 |

仓库没有 `run-ui-tests.ps1`，使用本机现有 `D:\Playwright-Portable\run-ui-tests.ps1`。该脚本在便携 Playwright 环境按 CI 顺序执行仓库十个浏览器脚本，仅用 mock IPC；截图位于 `D:\Playwright-Portable\test-results`。其中节点布局 24 组、流量统计 72 组、Dashboard 指定配置菜单 12 组、流量表格 36 组均按各脚本断言通过。

Node 的 10 个失败与 `cff1205` 完全同名，均因普通 Node 测试未设 CI/Playwright 环境而拒绝运行浏览器脚本；在上述浏览器套件中这十项全部通过：

- `test-config-activation-browser.mjs`
- `test-core-selection-browser.mjs`
- `test-dashboard-browser.mjs`
- `test-mihomo-groups-browser.mjs`
- `test-node-delete-browser.mjs`
- `test-qr-import-browser.mjs`
- `test-rules-sidebar.mjs`
- `test-traffic-stats-browser.mjs`
- `test-traffic-table-browser.mjs`
- `test-xray-latency-browser.mjs`

原始运行日志在本机 `%TEMP%\flclash-final`，不将构建缓存和浏览器档案加入本次提交。新增脚本的运行示例（`PLAYWRIGHT_MODULE` 指向本机 Playwright 安装）：

```powershell
$env:PLAYWRIGHT_MODULE = 'D:\Playwright-Portable\node_modules\playwright\index.mjs'
node scripts/verify-dashboard-parity.mjs
$env:CSS_EVIDENCE_PATH = "$env:TEMP\flclash-css-parity.json"
node scripts/verify-css-parity.mjs
```

## 便携包

- 应用代码构建提交：`5dea65a08af3bd6760e2f8cec055ddb738130b0b`（后续提交只增加验证夹具、取证与文档）。
- 包路径：`D:\Gihub_Projects\satelite-proxy\src-tauri\target\release\bundle\portable\Satelite_1.0.46_x64_portable.zip`
- 文件大小：32,299,469 字节。
- SHA-256：`4658e2466e3b43d98c0e83922d620163213b2590ba9a91187f46f214b1fed293`
- ZIP 共 12 项，已确认包含 `portable.flag`。
- 默认仅打包 sing-box；未启动 ZIP 内客户端或内核。

## 推送前的未发布历史清理

远端核对仍为 `cff1205`。早期本地提交误含 4903 个 Rust 缓存文件及浏览器产物，其中最大文件为 1,473,717,314 字节，超过 GitHub 单文件限制。因此保留原完整历史到本地备份分支 `backup/flclash-final-with-build-cache-20261121`，从远端基线按原顺序重放 13 个未发布提交，仅排除 `src-tauri/target-codex` 和 `test-results`。重放后对其他全部路径执行 `git diff --exit-code`，源码、测试和文档字节完全一致；额外给上述目录添加 `.gitignore`，本机文件保留。

本次五组提交在清理后对应如下；正文前表保留验证时的原提交号以便溯源：

| 原提交 | 推送提交 | 内容 |
| --- | --- | --- |
| `8e9aa12` | `24096b6` | Dashboard 链出口 |
| `e14cf3e` | `8b25d11` | 应用版本 |
| `1293717` | `a3b87b4` | 系统代理提示 |
| `6be6a34` | `ea692df` | 组合网络探测 |
| `5dea65a` | `d8116da` | 速率卡逻辑验证 |

已完成簇对应：`8c9ac4c` → `9b68809`、`59e4278` → `208a188`、`3c8acc8` → `7b7be11`。本轮测试/文档记录提交 `eb2c77e` → `bac5460`。便携包仍由原验证提交构建，清理后应用源码完全一致。

## 清单外发现与验证边界

- 起始分支已经含有本机 Rust 构建缓存和浏览器测试档案等历史跟踪文件；推送前已按上述方式从未发布历史排除，原历史和本机文件均保留。
- 原 `cff1205` 的 Node 实测通过数是 104；本轮达到用户要求的 117，且未增加失败脚本。
- 开始时应用版本、系统代理提示、组合探测和速率卡已有实现；主要缺口是 Dashboard 链出口 join 与虚拟链测速保护。
- 构建仍输出现有 Rust dead-code 警告与前端大 chunk 提示，没有将其改成错误或隐藏。
- 全程未启动真实 Satelite 实例、系统代理、TUN 或代理内核。Rust 默认忽略的真实内核/live 测试未运行。mock 通过不等于真机通过，最终体验等待用户试用定性。
