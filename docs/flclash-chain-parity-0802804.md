# FlClash 代理链功能对账、Lucide 图标与试用包报告

日期：2026-11-21。工作分支：`feature-flclash-ui`；本轮起点：`a1a7e93`；既定底版本：chenzai666 `cff1205`。对照基准：`feature-reskin-topnav @ 0802804ac4d09bc6b1e0e576af17a083c3004acb`。本轮未修改 `feature-reskin-topnav`，未推倒重做 FlClash 分支。

## 1. 逐项对账结论

| 核对项 | 结论 | 基准对照与本轮处理 |
| --- | --- | --- |
| 链增删改与启停 | ☑ 已一致 | `commands/chain.rs`、`commands/config.rs`、`config/builder.rs`、`storage/store.rs`、`runtime.rs`、`state.rs`、`domain/chain.rs`、`api.ts/types.ts` 与基准逐字节一致。补齐订阅删除、订阅刷新、关闭 Mix 三处 `auto_deactivate_dead_chain_exit` 挂钩；自动停用通知从仅链页接收提升为 App 全局接收。手动停用复用后端单源回落，启停和 selector 缓存恢复回归锚均在位。 |
| 链虚拟节点呈现与保护（不可单删/单测） | ☑ 已一致 | `chain:<id>` 与 `chain_hops` 为唯一判定口径；E3 后端、置顶链分组与基准相同。专业/简洁节点页没有链右键删除入口，单点/分组/批量测速过滤链条目，多选与拖拽受保护。补齐专业/简洁选中态弱高亮；Dashboard 不把虚拟链 ID 传给单节点测速。 |
| 三模式节点池：指定节点 / 关键词过滤 / 整个订阅 | ☑ 原本已一致，已复验 | `PoolMode::Subscription` 三模式生成语义、`PoolScope` 双口径与基准逐字节一致。预览纯函数确认：显式池可保留禁用源成员及 stale 槽；关键词只看启用宇宙；订阅池动态展开启用成员、缺失/禁用为空池且不伪报 stale。 |
| 池编辑器：订阅分组、圆点选择无环、悬空自愈 | ☑ 原本已一致，已复验 | `list_chain_nodes` 全量宇宙、`groupNodes(..., "sub")` 订阅分组、点击行/圆点选择、无选中焦点环均保留。`update_pool` 返回 `UpdatePoolResult{pool,pruned}`，前端展示剔除数量；删除节点/删订阅/刷新后的 `sweep_explicit_pool_members` 清扫与基准相同。真实 mock 组件专项通过。 |
| 链出口探测与逐跳延迟 | ☑ 已一致 | `diagnose_chain` 逐跳与出口探测、`checkExitIp` 卡面出口检查、启用后运行态自动探测均保留；卡面与编辑器逐跳延迟复用节点真实延迟，不向池跳虚构单一出口。Dashboard 固定尾跳协议/延迟展示保留。 |
| 链自动命名 | ☑ 已一致 | `name_manual` 前后端贯通；仅自动命名链跟随节点/池改名，手动命名不覆盖。卡面、编辑器与挂载时 `rename_chain_auto` 使用相同 hop-label 推导，复制链转为手动命名并顺延副本名。 |
| 节点删除点击直删 | ☑ 原本已一致，已复验 | 右键删除和 Delete 键都复用有防重入的 `deleteSelected` → `deleteNodes`，无 `window.confirm` / `confirmAction`；输入框、弹窗、只读、修饰键、长按及忙碌保护保留。真实节点页浏览器回归覆盖单删/批删/失败清理直删。 |
| 订阅二维码分享 | ☑ 原本已一致，已补回归 | 仅 `source_kind === "url"` 显示入口；打开 `SubShareModal` 后才拉取 URL，完整 URL 本地生成 QR（224px、M 纠错），无远程识别或列表预取。配置入口/模型/双语文案通过基准 `test-sub-share.mjs` 4 项契约回归。 |
| 池模式徽标全胶囊 | ☑ 已一致 | 真实组件 computed 结果：指定节点、关键字过滤、整个订阅三种徽标均为 `border-radius:999px`、`padding:1.6px 6.4px`、高度 `19.5625px`，样式和内边距一致。 |

补充：文本/mihomo YAML 链导出双入口、规则引用链、复制链、启用前自动补齐所需订阅、显式池悬空成员自愈与链导出真核 ignored 测试入口也在基准扩展契约中核验。`ChainPage.css` 与基准逐字节相同；`ChainPage.tsx` 对基准仅剩一个不多说多余空语句的语法差异，行为无差别。Rust `domain/subscription.rs` 仅剩说明注释差异。

## 2. 缺件移植提交

| 提交 | 内容 |
| --- | --- |
| `9b693aa` | 补齐订阅删除、刷新、关闭 Mix 的失效链出口自动回落挂钩；`commands/subscription.rs` 随后确认与基准逐字节一致。 |
| `0f96dec` | 自动停用通知移到 `AppShell` 全局，删除只在链页生效的订阅，补左下通知样式。 |
| `1ed22d2` | 六个 SideNav 手绘双态图标改为 Lucide 官方同图描边。 |
| `66d4cb8` | 虚拟链选中态弱高亮、删除导出菜单遗留旧键，并回收完整链/分享契约（提交同时含 staged 的专项回收测试）。 |
| `2435da6` | Windows CI 登记链导出、链缓存恢复、链停用计时三项 ignored 真核回归及链/分享 Node 契约。未在本机运行真核测试。 |
| `8dce09c` | Dashboard 动效断言适配 Lucide；新增六图标双态独立 mock 验证与截图脚本。 |

首轮基准扩展契约为 50/54；失败项逐项对应上述缺失高亮和 CI 登记及两个旧文案，修复后为 54/54。没有通过删除/放宽源断言来绕过失败。Dashboard 浏览器首轮还暴露旧断言写死 `svg path` 与实心 activePath 的问题，已改为官方要求的新语义：Lucide 普通/激活同图、两态均描边。

## 3. Lucide 六图标

来源为官方仓库 `lucide-icons/lucide` 提交 `c1a02a04d4f3f7049d44567d62b8b06cff0b9103` 下 `icons/<name>.svg`，原始图形内联到 `src/components/SideNav.tsx`，**没有新增依赖包**。许可与来源见 `docs/lucide-icons-LICENSE.txt`。

| 页面 | 官方图标 |
| --- | --- |
| 概览 | `layout-grid` |
| 节点 | `waypoints` |
| 配置 | `layers` |
| 流量 | `chart-column` |
| 日志 | `scroll-text` |
| 设置 | `settings` |

旧 `path` / `activePath` 两套手绘数据与激活实心填充逻辑已删除。六图标保持 `viewBox="0 0 24 24"`、`strokeWidth="1.7"`、`stroke="currentColor"`、`fill="none"`；普通态与激活态 SVG markup 完全相同，激活态仅继承 `--primary` 描边色，并沿用现有指示胶囊。折叠按钮与主题切换代码未动。

`scripts/verify-side-nav-icons.mjs` 真实渲染原 SideNav，生成 6×2=12 张截图并断言名称顺序、官方图形节点数、两态 markup、参数、主题激活色、指示胶囊和无外部请求。合成人工复核图：`test-results/side-nav-icons/contact-sheet.png`；六图标均清晰、无变形，普通态中性色、激活态主题绿。

## 4. 实际验证

| 验证 | 结果 |
| --- | --- |
| `pnpm build` | 通过；最终 portable 打包也再次内置前端构建成功。 |
| 基准链与二维码专项 `node --test scripts/test-chain-nodes.mjs scripts/test-sub-share.mjs` | **54/54 通过**。 |
| 全量 `node --test scripts/test-*.mjs`（无 CI/Playwright 环境） | 起点 `a1a7e93`：**128 项，117 通过 / 11 失败**；当前：**169 项，158 通过 / 11 失败**。失败文件名排序 diff 为空，**无新增失败**；新增 41 项全通过。临时基线 worktree 使用同一 `node_modules` 重跑后已删除。 |
| `D:\Playwright-Portable\run-ui-tests.ps1` | 最终 **10/10 通过**。首轮第9项因旧 activePath/path 断言超时；修正新图标语义断言后完整重跑通过，非跳过。 |
| `scripts/test-pool-dots-browser.mjs` | 通过：生产样式8份、16px区域元素13个，鼠标/触控/Tab/Space、订阅/节点圆点与三模式胶囊检查通过。 |
| `scripts/verify-side-nav-icons.mjs` | **6图标 / 12截图通过**；激活色都为 `rgb(85, 200, 154)`（当前 `--primary`），普通/激活 SVG markup 相同。 |
| `git diff --check` | 通过。 |

验证边界：全部浏览器与截图只走 Vite + mock IPC；没有在本机启动真实 Satelite、系统代理、TUN 或代理内核。CI 中登记的 ignored 真核测试未在本机执行。普通 Node 下11个既有失败均为浏览器脚本在未配置 CI/Playwright 时的既有环境拒绝；主10项和池专项已在正确 mock 环境另跑通过。

## 5. FlClash 版试用便携包

**此包是 `feature-flclash-ui` 的 FlClash 版，不是现行 `feature-reskin-topnav` 版的包。**

- 应用源码打包 HEAD：`8dce09c2e4be101fed2ab17425580bbad229d6c8`（后续提交仅增加文档）。
- 命令：先删除同名旧 ZIP，再运行 `./scripts/build-windows.ps1 -Bundle portable`。
- 文件：`D:\Gihub_Projects\satelite-proxy\src-tauri\target\release\bundle\portable\Satelite_1.0.46_x64_portable.zip`
- 大小：**31,380,421 字节（29.927 MiB）**。
- SHA-256：**`1bf64fb4f5c6017e35a9c8fb6b5200a4c660b2ef31c312f68ca8fda509c6a4c6`**。
- 内容：ZIP 共12项，包含 `Satelite-Portable/portable.flag` 与 `Satelite-Portable/satelite-proxy.exe`；CRC 检查无错误。默认仅内置 sing-box，沿用项目现有打包约定。
- 构建只输出既有 Rust dead-code/命名与前端 chunk 提示；未运行 ZIP 内客户端或内核。

## 6. 保留的 FlClash 版差异与清单外说明

- 保留 SideNav、FlClash 仪表盘卡片与排版：基准的顶部文字导航、`DashboardRateCard` 删除/布局换壳等内容没有移植。
- FlClash 继续从“设置 → 代理链”进入完整链页；基准采用 TopNav 直达。这是允许的导航排版差异，不是链功能缺失；六图标 SideNav 也按用户指定保持六项。
- 未把简繁翻译键排序、纯注释或组件 JSX 排版差异视作行为缺口，未做无关全分支覆盖。
- 本轮没有遇到需要超出代理链/指定图标范围另行移植的清单外功能差异。
