# 可编辑 PPTX 导出（4 条硬约束 + 流程）

本 skill 的导出轨用 `scripts/html2pptx.js`（vendored from huashu-design）+ `pptxgenjs`，
把**每张独立 HTML 逐元素翻译成真·可编辑 PowerPoint 文本框**（双击能改字）。

> `build-pptx-html.mjs` 已经**自动**按下面 4 条约束生成 HTML，正常流程你不用手写。
> 这份文档解释：为什么可编辑 PPTX 版面会比 HTML 展示稿朴素，以及手改/排错时的规则。

## 画布：960×540pt = 1280×720px，配 `LAYOUT_WIDE`

`pptx-base.css` 已设 `body { width:1280px; height:720px }`，对应 `pres.layout='LAYOUT_WIDE'`（13.333″×7.5″）。
别用 1920×1080px（非标尺寸，投影后字号显得异常小）。

## 4 条硬约束（违反 html2pptx 会报错）

1. **div 里不能直接写文字** → 必须包进 `<p>` 或 `<h1>`-`<h6>`（span 只能在 p/h\* 里做局部样式）。
2. **不支持 CSS 渐变** → 只能纯色（这就是 PPTX 版没有 HTML 版的渐变背景的原因）。
3. **背景/边框/阴影只能在 div 上**，不能加在 `<p>/<h*>` 文字标签上。
4. **div 不能用 `background-image`** → 图片用 `<img>` 标签。

这 4 条是 PowerPoint（OOXML）文件格式的物理约束，不是工具偷懒。本 skill 因此走双轨：展示轨随便渐变动画，导出轨另渲染一份合规 HTML。

合并文本框：给外层 div 加 `data-pptx-merge="true"`，容器内多个 `<p>/<h*>` 合并成**一个**可编辑文本框。

## 三步出 PPTX

```bash
# 1) slide-spec → 合规 HTML（每张独立 960×540pt）
node scripts/build-pptx-html.mjs --spec slide-spec.json --theme reading-warm --out pptx-slides
# 2) 先体检 4 约束（无需 Playwright）
node scripts/validate-pptx-html.mjs pptx-slides
# 3) 导出可编辑 PPTX（需依赖：在 skill 目录 npm install）
node scripts/export-pptx.mjs --slides pptx-slides --out deck.pptx
```

依赖：`playwright pptxgenjs sharp`（macOS 用系统 Chrome，无需 `playwright install`）。
缺依赖时第 3 步会提示安装命令并退出，但第 1、2 步产物已在，装好依赖再跑第 3 步即可。

**导出轨隐私规则**：封面姓名字段可显示在封面/页脚，不能塞进发给图片服务商的 prompt；API Key 不写入 PPTX 备注或日志。

## 常见错误速查

| 报错 | 原因 | 修法 |
|---|---|---|
| `DIV element contains unwrapped text` | div 里有裸文字 | 包进 `<p>`/`<h*>` |
| `CSS gradients are not supported` | 用了渐变 | 改纯色 |
| `Text element <p> has background` | `<p>` 上加了背景 | 背景挪到外层 div |
| `Background images on DIV` | div 用 background-image | 改 `<img>` |
| `content overflows body by Xpt` | 内容超出 540pt | 减内容/缩字号 |

## 已有"视觉稿"却坚持要可编辑 PPTX

视觉驱动的 HTML（渐变/动画/复杂 SVG）直接跑 html2pptx 通过率 <30%。正确做法：
1. 透明告知会丢失什么（渐变→纯色、动画→静态）。
2. 建议二选一：**A. 出 PDF**（浏览器打印 HTML 展示稿即可，视觉 100% 保留）；**B. 以视觉稿为蓝本重写一版合规 HTML** 再导出。
3. 页数 >30 或核心价值是动画时，劝用户出 PDF 而非硬挤 PPTX。
