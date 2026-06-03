# 布局类型与字段（layouts）

每页 `slide-spec.json` 用 `layout` 指定布局。展示轨（HTML）和导出轨（PPTX）都支持同一套 `layout` 与字段。
通用字段每页都有：`page、layout、kicker、action_title、purpose、content、visual、notes、citations、image_request、privacy_level`。
下表是各 layout 额外读取的**结构化字段**；缺失时会优雅回退到 `content[]` 或占位。

| layout | 用途 | 额外字段 |
|---|---|---|
| `cover` | 封面 | `content[]`（副标题行，≤2）；封面信息取自顶层 `meta` |
| `agenda` / `toc` | 目录/议程 | `items[]`（字符串或 `{title}`）或 `content[]` |
| `claim-bullets` | 一观点 + 要点（默认） | `content[]`（≤6）；`image`（配图路径，有则替换右侧视觉位）或 `visual`（占位说明） |
| `two-column` | 概念 + 例证 / 左右对照 | `columns:{ left, right }`，每列 `{ label?, title?, body? \| items[] }` |
| `timeline` | 时间线/流程/三起三落 | `items[]: { num?, title, body? }`（≤5） |
| `comparison` | 对比 | `compare:{ left:{title,items[]}, right:{title,items[]}, leftKind?, rightKind? }`（kind=`good`/`bad` 上色） |
| `pros-cons` | 正反/利弊 | `compare`（同上）或 `pros[]` / `cons[]` |
| `structure-map` | 结构图/节点链 | `flow[]`（字符串节点，≤5）或 `content[]` |
| `quote` | 引用卡 + 解读 | `quote:{ text, source?, reading? }`（缺则回退 content/citations） |
| `stat-highlight` | 大数字 | `stats[]: { num, label }`（≤4）；可加 `content[]` |
| `key-people` | 人物/角色卡 | `people[]: { name, role?, body? }`（≤3） |
| `reflection` | 反思三要素 | `triad[]: { title, body? }`（3 个）或 `content[]` |
| `summary` | 总结 + 讨论 | `content[]` + `question`（开放讨论题） |

## 字段示例

```json
{ "page": 4, "layout": "timeline", "action_title": "三次买车失败构成主线",
  "items": [
    { "num": 1, "title": "第一次：努力换来希望", "body": "省吃俭用买上车。" },
    { "num": 2, "title": "第二次：积蓄被夺走", "body": "钱被敲诈，努力清零。" }
  ],
  "notes": "用时间线讲结构，避免逐章复述。", "citations": ["老舍《骆驼祥子》"],
  "image_request": false, "privacy_level": "none" }
```

```json
{ "page": 8, "layout": "summary", "action_title": "讨论祥子，是在讨论人如何保住希望",
  "content": ["命运有清晰变化线", "环境压力是关键", "要同时看见个人、环境、选择"],
  "question": "如果祥子第二次失去积蓄后得到一次帮助，结局会变吗？" }
```

## 规则

- 一页一观点；标题写结论，不写"背景/总结"这类空泛词。
- 正文每页约 ≤80 字、要点 ≤6 条；多了就拆页或精简。
- 优先用 timeline / comparison / structure-map / quote / stat / reflection 等结构化布局，而不是堆 bullet。
- `image` 路径要相对输出目录（如 `generated-images/05.png`）；不存在则用占位卡。
- 不编造：数据/年份/DOI/引用没有就写"待补充"。
