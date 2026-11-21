# 批次 14：池编辑器聚焦环第四轮取证

起点：`feature-reskin-topnav@2fc3dee`。本轮只允许 mock，不启动真实 Satelite、代理内核或用户数据。

## 生产 CSS 与旧夹具差集

首次 `pnpm build` 成功。生产构建实际生成并由入口/链页动态 chunk 加载的 CSS 为：

| 构建产物 | 大小 | 组成 |
| --- | ---: | --- |
| `dist/assets/index-CTFFAsN2.css` | 167,571 B | `App.css`、`ProAppearance.css`、`ProMotion.css`、`IpInfoPanel.css`、`ServiceStatusCard.css`、`DashboardPage.css` |
| `dist/assets/ChainPage-D1efneAp.css` | 35,915 B | `@xyflow/react/dist/style.css`、`ChainPage.css` |

旧 `chain-dots.tsx` 只加载 `App.css` 与 `ChainPage.css`。相对生产链页所缺的差集为：

- `ProAppearance.css`
- `ProMotion.css`
- `IpInfoPanel.css`
- `ServiceStatusCard.css`
- `DashboardPage.css`
- `@xyflow/react/dist/style.css`

新夹具使用独立的纯内存 mock IPC 宿主，进入真实 `ChainPage`，显式加载全部生产样式，并通过真实池行菜单打开 `PoolEditorModal`。浏览器现场确认加载上述 8 份样式，不再维护手写池编辑器 DOM，也不依赖任一分支的 dashboard mock 是否支持链页。

## 聚焦 + 未选状态取证

可信点击取消选中后，测试以圆点中心建立 16×16px 区域，记录与其相交的全部 21 个元素，以及 input、::before、::after、label、分组和列表容器的 computed outline、四边 border、box-shadow；同时扫描匹配到的作者规则及来源。明细由测试写入未入库的 `test-results/pool-dots-ring-audit.json`。

定位结果：**整包 CSS 下存在画环规则**，不是 WebView 的神秘原生描边：

```css
/* src/App.css */
.field input:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px var(--primary-muted);
}
```

真实取消点击后的 input computed box-shadow 为 `rgba(85, 200, 154, 0.14) 0px 0px 0px 3px`。8px 圆点加两侧各 3px 即 14px。此前 `:checked { box-shadow: none }` 只在选中态遮挡它；取消选中后，全局 `.field input:focus` 重新生效，因此出现点击闪现及取消后残留。此前测试只检查 outline 和失焦后的部分元素，没有检查聚焦未选态的 box-shadow，所以 mock 全绿也未覆盖实因。

真实 DOM 还证明 `.field input` 的 `padding: 0.5rem 0.65rem` 会把 input 外盒扩为约 20.78×16px；旧手写夹具不在 `.field` 内，所以此前一直误测为 8×8。第一层修复只在 `.chain-pool-node-item .chain-pool-select-dot` 及其 `:focus-within` 状态中设置 `box-sizing:border-box`、`padding:0` 并中和 box-shadow，不修改普通 `.field` 输入框的尺寸或焦点反馈。修复后环与 8×8 外盒断言通过；可信点击后的 activeElement 新断言在尚未加入焦点管理的旧行为上按预期跑红。

## 第二层：指针焦点管理与真实输入回归

节点行与订阅行的 primary `mousedown` 调用 `preventDefault`。实测 Edge 仍可能从 label 默认激活转发 input click，因此非 input 发起的 label click 会阻止默认激活，并显式调用与原生 onChange 相同的状态 updater；直接点击 input 和键盘 Space 不经过这条手动分支，避免双切换。

专项 mock 使用真实 ChainPage DOM、Edge 和可信输入事件验证：

- 鼠标取消与重新选中各一次，勾选状态正确，且两次后 `document.activeElement` 都不是该 input；未加第二层的旧行为在该断言上实测失败。
- 另一订阅 radio 经可信 touchscreen tap 后选中、互斥正确，activeElement 同样不是 input。
- 从真实分组头按 Tab 可以聚焦选择 input，Space 连续两次正确取消/恢复；键盘聚焦未选态也没有全局 field 阴影。
- 节点 checkbox 与订阅 radio 外盒均为 8×8，选中/未选颜色可区分；最终独立夹具完整记录 16px 区域内的全部 13 个相交元素（数量只反映宿主 DOM 层级）。

本分支最终 `pnpm build` 通过，`powershell -File run-ui-tests.ps1` 实测 10/10。概览旧断言原先要求点击后获得主题色焦点边框，已改为验证非聚焦边框不随点击变化，同时保留勾选状态、协议色填充和圆角检查。

> 本轮任何 mock 绿结果都不作为真机修复结论；最终以用户真机判定为准。
