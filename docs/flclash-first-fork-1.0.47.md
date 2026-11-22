# Satelite 二开首发版 1.0.47 验证报告

验证日期：2026-11-22。分支：`feature-flclash-ui`；接续基准：`40bafedc09c028a8498fb408b2c9ce1c7b8a2c20`。本报告对应工作区续跑完成后的提交；现行 `feature-reskin-topnav` 未作修改。

## 1. 断点盘点与改动映射

接续时 HEAD 与指定基准完全一致，没有来历不明的新提交。工作区有 20 个已修改文件和 1 个未跟踪发布说明，均属以下任务范围：

| 六步任务 | 接续时状态 | 文件与处置 |
| --- | --- | --- |
| 项目地址与更新源 | 基本完成，待审计 | `SettingsPage.tsx`、`core/download.rs`、`commands/core.rs` 已切换；`App.css` 为真实链接补充无下划线样式；本次完成全库审计。 |
| 版本 1.0.47 | 基本完成，待确认 | package/Cargo/锁文件、两个 Windows 工作流、版本校验脚本、诊断 UA、四个 mock 夹具及概览断言已同步；本次核对所有剩余引用。 |
| README | 做了一半 | 已有二开说明、更新日志和 fork 地址；本次取得上游当前 README，核对模板与原保留内容。 |
| 验证 | 断言已写，尚未运行 | 导航脚本已含项目地址断言；本次补充实测值输出，执行红灯/绿灯、Cargo、Node、前端与 10 项浏览器验证。 |
| 构建与发版 | 未开始 | 本次查冲突、构建便携 ZIP、写发布说明并提交推送。 |
| 同步 main | 未开始 | 本次先验证 `cff1205` 为分支祖先，再快进并核对远端。 |

初检 `pnpm build` 与 `cargo check` 均通过，没有发现需要修复的半写坏文件。Cargo 仅报告既有命名、未使用代码等警告。

## 2. 项目地址、更新源与规则源审计

应用的五个功能入口均指向 `AiLee77/satelite-proxy`：

- `src/pages/SettingsPage.tsx`：`PROJECT_URL`、`RELEASES_URL`。
- `src-tauri/src/core/download.rs`：GitHub latest Release API 与 Release 页面。
- `src-tauri/src/commands/core.rs`：`APP_UPDATE_SOURCE`。

`download.rs` 仅替换四个解析测试的仓库样例，URL 分段、query 去除和无 tag 拒绝逻辑未改。设置页项目地址改为带真实 `href` 的 `<a>`，仍通过既有 Tauri opener 打开，不造成 WebView 内导航。

全库检索 `chenzai666/satelite-proxy` 只剩：

1. README 的二开发源署名链接；
2. `docs/release-1.0.47.md` 的二开发源署名链接；
3. `scripts/test-node-clipboard.mjs` 的非节点 URL 拒绝样例。

因此没有遗留在功能代码中的旧项目地址。`chenzai666/sub-ini`、`chenzai666/OverseasAI.list` 内容源，以及 XTLS/Xray-core、MetaCubeX、Loyalsoldier 下载源相对基准均未改动。

## 3. 版本与 README

版本定义已统一为 `1.0.47`：`package.json`、`src-tauri/Cargo.toml`、Cargo.lock 的 `satelite-proxy` 条目、`scripts/check-fixed-version.ps1`、Windows 构建/发布工作流、诊断 User-Agent 和 mock 夹具。`src-tauri/tauri.conf.json` 的 `"version": "../package.json"` 继续从 package 继承，不需要另写常量。Cargo.lock 中 quote crate 自身的 `1.0.47` 是上游 crate 版本，未作人工修改。

其余 `1.0.46` 只存在于历史发布/整合/验证文档与 `AGENTS.md` 历史记录中；`docs/release-1.0.47.md` 对升级前版本的描述是有意保留。固定版本检查通过。

上游当前 README 通过 GitHub API 取得：blob SHA `469c1e1bbb2a11c1e47ef4576f71a4680c530578`，与基准 README 模板一致。本分支沿用其栏目、版式、图片和末尾原文，新增“二次开发说明”“更新日志”，补齐二开功能清单及 AiLee77 下载地址。`LICENSE` 未改；原友情链接与保留文本未改。最终 `README.md` 为 309 行、32,844 字节，SHA-256 为 `ba9f55f64e137d29212f68bd13247e657eac2011f7ec18e8f9e3ecc8867624dd`，全文随本提交提交。

## 4. 实际验证

全程未启动真实 Satelite 实例或代理内核。

| 验证 | 实测结果 |
| --- | --- |
| `pnpm build` | 初检通过；便携包构建的第二次 tsc + Vite 构建也通过。 |
| `cargo check --manifest-path src-tauri/Cargo.toml` | 通过；只有既有警告。 |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 库测试 **759 passed / 0 failed / 18 ignored**；订阅集成测试 **5 passed**；联网下载测试 1 项按设计 ignored；doc tests 通过。 |
| download Release URL 解析 | 绝对 URL、相对 URL、query 去除、无 tag 拒绝 **4/4 通过**。 |
| 项目地址 mock 红灯 | 用临时 Vite 源码钩子向同一导航回归喂入 `40bafed` 旧设置页；原按钮实测 `href = null`，目标断言以 exit 1 失败。临时脚本随后删除，产品源码未被回写。 |
| 项目地址 mock 绿灯 | 当前真实 `<a>` 实测 `https://github.com/AiLee77/satelite-proxy/`；导航专项 PASS，设置 7 标签，无外部网络或未声明 IPC。 |
| `D:\Playwright-Portable\run-ui-tests.ps1` | 真实执行 **10/10 全部通过**，无跳过。 |
| 工作流 16 组纯 Node 测试 | **158/158 通过**。 |
| 完整 `node --test scripts/test-*.mjs` | 当前 **169 项：158 通过 / 11 失败**；独立 `40bafed` worktree（junction 复用同一 node_modules，用后删除）同为 **158 / 11**。排序后的失败文件名 diff 为空，无新增失败；11 项均是未配置浏览器环境时的既有 browser 脚本拒绝项。 |
| 固定版本检查 | `scripts/check-fixed-version.ps1` 通过。 |
| `git diff --check` | 通过。 |

初次尝试从便携目录启动独立导航 Vite 时得到 404，以及未给临时基线提供 node_modules 时出现加载失败；两次均识别为测试环境错误后重跑，没有计作产品验证结果，也没有据此修改产品代码。

## 5. 冲突检查与便携包

发布前检查：本地标签、origin 远端标签与 `gh release list --repo AiLee77/satelite-proxy` 均无 `1.0.47` 冲突。

使用 Windows PowerShell 执行 `scripts/build-windows.ps1 -Bundle portable`（本机无 `pwsh` 命令），默认仅内置 sing-box，未启动产物：

- 路径：`D:\Gihub_Projects\satelite-proxy\src-tauri\target\release\bundle\portable\Satelite_1.0.47_x64_portable.zip`
- 大小：**31,380,356 字节（约 29.927 MiB）**
- SHA-256：**`b35857c4990dcaae9a00d843171d0a244a166e699131c4d62e9ab96a371b32d5`**
- 完整性：`unzip -t` 的全部 12 个条目通过，无压缩错误。
- Release：<https://github.com/AiLee77/satelite-proxy/releases/tag/1.0.47>

发布说明同时记录二开功能清单、v1.0.47 更新、文件大小与上述 SHA-256。

## 6. main 快进前置条件

发布前本地和远端 main 均为 `cff1205225526f84d29cc87089e781dcc4ed07d3`；`git merge-base --is-ancestor cff1205 feature-flclash-ui` 通过。续跑开始前分支相对 main 为 0 落后、34 领先。最终提交推送后再以新 flclash tip 重验祖先并快进 main，远端 main 必须与该 tip 完全一致。
