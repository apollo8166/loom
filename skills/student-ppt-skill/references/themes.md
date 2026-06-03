# 主题（themes）

5 套**锁定配色**主题。纪律来自 guizang："配色搭错画面瞬间变丑"——不要随手改 hex，
用 `build-deck.mjs --theme <名字>` 选其一即可。每套同时有一份导出轨纯色调色板（`assets/themes/palettes.json`），
保证 HTML 展示稿和可编辑 PPTX 视觉一致。

| 主题 | 适合场景 | 气质 | 主色 / 纸色 |
|---|---|---|---|
| `reading-warm` | 读书报告（默认） | 温和书籍质感，标题用衬线 | 青 `#2f6f6d` + 橙 `#b35c2e` / 暖纸 `#f8f2e7` |
| `academic-clean` | 论文/课题答辩 | 克制学术，白底藏青 | 藏青 `#1f4e79` / 白 `#ffffff` |
| `campus-fresh` | 课程汇报 | 清爽校园，友好 | 绿 `#14a06a` + 琥珀 `#ef9f33` / 白 |
| `kid-friendly` | 低龄学生 | 高对比、圆角、活泼（不 emoji 刷屏） | 橙 `#f0683a` + 青 `#2bb0c9` / 暖白 |
| `competition-bold` | 学生比赛/路演 | 暗底强视觉、统治色 | 黄 `#ffcc00` + 红 `#ff4d6d` / 暗 `#14161b` |

## 怎么给用户选（Phase 2 + Phase 4）

1. Phase 2：按场景给**默认推荐**（上表"适合场景"），同时把 5 套都列出来让用户知道可换（用 AskUserQuestion）。
2. Phase 4：用用户**真实封面**渲染 2–3 套候选样张，让用户用眼睛挑（show-don't-tell）。
   ```
   node scripts/build-deck.mjs --spec slide-spec.json --theme reading-warm     --out preview-reading-warm.html
   node scripts/build-deck.mjs --spec slide-spec.json --theme academic-clean   --out preview-academic-clean.html
   node scripts/build-deck.mjs --spec slide-spec.json --theme campus-fresh     --out preview-campus-fresh.html
   ```
3. 选定后把 `theme` 写进 brief.json 和 slide-spec.json 顶层。

## 想要新配色？

不要在页面里写死随意 hex。要扩主题就**新增一个** `assets/themes/<name>.css`（覆盖 `:root` token）
并在 `assets/themes/palettes.json` 加对应纯色调色板，保持"锁定"纪律。token 契约见 `assets/base.css`。
