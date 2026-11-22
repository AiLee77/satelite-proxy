# Satelite 1.0.47

Satelite 二开首发版（唯一版本）。本项目由 **AiLee77** 基于 [chenzai666/satelite-proxy](https://github.com/chenzai666/satelite-proxy) 二次开发；项目地址、应用更新检查与下载已切换到 [AiLee77/satelite-proxy](https://github.com/AiLee77/satelite-proxy)。上游 Apache License 2.0、原版权与致谢保留。

## 二开功能清单

- **代理链与三模式节点池**：多跳代理链，以及指定节点、关键词过滤、整个订阅三种节点池模式。
- **链虚拟节点与链路诊断**：代理链可作为虚拟出口节点选择，支持出口归属与质量探测、单跳及逐跳累计延迟。
- **FlClash 风格侧边栏**：概览、节点、代理链、配置、流量、日志、设置七项独立导航；使用 Lucide 官方描边图标，日志采用 file-text 图标。
- **FlClash 风格概览**：统一排版、模式徽标胶囊、双向速率与近期趋势；保留真实接管和选核逻辑。
- **节点删除直删**：删除只修改当前存储列表，不新增持久删除标记；手动追加节点删除后不会因订阅刷新恢复。
- **交互修复**：修复池编辑器聚焦环与模式徽标胶囊，移除系统代理成功切入后的重启提示弹窗。

## v1.0.47 本版更新

- 五处应用项目／更新源切换到 `AiLee77/satelite-proxy`；设置页“项目地址”提供真实 `href`，继续通过 Tauri opener 打开。
- sing-box、Xray-core、MetaCubeX、Loyalsoldier 等内核与数据源不变；`chenzai666/sub-ini`、`chenzai666/OverseasAI.list` 两处规则内容源保持原样。
- 应用版本从 `1.0.46` 升级到 `1.0.47`，同步 `package.json`、Cargo 清单／锁文件、版本校验、诊断 User-Agent、浏览器夹具及 Windows 构建发布配置。
- 重写 fork README，保留上游栏目、版权与致谢，新增二次开发说明和本版更新日志。
- 验证覆盖 Cargo 测试（含 download Release URL 解析）、前端构建、Node 基线对比及十项 mock 浏览器回归；未启动真实 Satelite 实例或代理内核。

## 下载

- Windows x64 便携版：`Satelite_1.0.47_x64_portable.zip`
- 文件大小：31,380,356 字节（约 29.927 MiB）。
- 便携版 SHA-256：`b35857c4990dcaae9a00d843171d0a244a166e699131c4d62e9ab96a371b32d5`。
- ZIP 完整性：全部 12 个条目通过 `unzip -t`；未运行包内客户端或内核。
