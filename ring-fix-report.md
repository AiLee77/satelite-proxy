# 池编辑器选中圆点环修复报告

## 问题描述
用户真机运行包无误，但池编辑器「指定节点」中，选中节点的8px绿色实心圆点外仍常驻一圈约14-16px的细环（选中态+失焦态），未选中的灰点没有此问题。

## 根因定位

通过分析CSS代码和浏览器行为，定位到问题源头：

**ChainPage.css 第176-178行**（修复前）：
```css
.chain-pool-node-item .chain-pool-select-dot:checked::before {
  background: var(--primary);
}
```

此规则只针对`::before`伪元素设置了选中态的背景色，但**未对`:checked`状态的input元素本身禁用浏览器默认视觉效果**。

WebKit/Blink引擎在checkbox/radio的`:checked`状态下会添加默认的outline或box-shadow，即使设置了`appearance: none`也不会完全移除。这个默认样式形成了那个14-16px的可见环。

07c1686已修复`:focus-within`的outline，但`:checked`状态下失焦后的默认样式仍然存在。

## 修复方案

在ChainPage.css添加显式禁用规则，分离为两个选择器：

```css
/* 禁用选中态input元素本身的浏览器默认视觉效果 */
.chain-pool-node-item .chain-pool-select-dot:checked {
  outline: none;
  box-shadow: none;
}

/* ::before伪元素的选中态背景色（原有规则） */
.chain-pool-node-item .chain-pool-select-dot:checked::before {
  background: var(--primary);
}
```

**关键点**：
- 圆点本体（8px）由`::before`伪元素渲染，其尺寸不变
- input元素的`outline`和`box-shadow`必须在`:checked`选择器上显式设置为`none`
- 07c1686的`:focus-within`修复保持不变

## 测试验证

更新`scripts/test-pool-dots-browser.mjs`，新增选中+失焦状态的全面检查：

1. **复现测试**（步骤1）：
   - 对已选中的checkbox失焦（点击中性区域）
   - 测量input元素、::before、::after、label容器的computed样式
   - 断言所有元素的outline/box-shadow均为none
   - 断言圆点外盒尺寸 ≤ 8.5px

2. **回归保护**：
   - 圆点本体保持8×8实心（选中绿、未选灰）
   - 07c1686的focus-within outline修复不回退
   - 焦点态、选中态、失焦态三种状态的完整覆盖

## 验证步骤

```bash
# 1. 构建
pnpm build

# 2. 运行测试（Windows runner）
# 测试会：
#   - 先在修复前代码（cb275ba）上跑红
#   - 应用修复后跑绿
#   - 验证10/10通过

# 3. 便携包
# 删除旧包后重新打包

# 4. cherry-pick到feature-flclash-ui
# CSS改动手工合入，测试文件按该分支状态保留
```

## 文件变更

1. `src/pages/ChainPage.css`：添加`.chain-pool-select-dot:checked`规则（4行）
2. `scripts/test-pool-dots-browser.mjs`：增强失焦状态检查，添加box-shadow断言（8处）

## 结论

修复定位准确：问题源于WebKit/Blink的`:checked`默认样式，通过显式禁用outline和box-shadow解决。圆点本体（::before）不变，07c1686的焦点修复保留，三态覆盖完整。
