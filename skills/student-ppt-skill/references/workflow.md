# 学生 PPT 工作流

本文件是 student-ppt-skill 触发后的流程控制文件，必须先读，并与 SKILL.md 的"硬性工作流"一致。

## 流程控制原则

- 先判定任务类型，再决定内容发现、视觉方向和生成模式。
- 先选场景与布局，再写页面规格，不能随手生成松散大纲。
- 永远先形成 brief.json 和 slide-spec.json，再生成 HTML、PPT、图片提示词或讲稿。
- 事实、素材、隐私、质量是硬闸门，不是交付后的装饰。
- **HTML 是默认主产物；可编辑 PPTX 只在用户选了才做。**
- 信息不足但不影响第一版时，用明确默认值继续，并把待补充项写入 brief.json。

## 阶段 0：任务路由

进入条件：skill 已触发。

动作：
1. 判断类别：读书报告 / 课程汇报 / 论文课题答辩 / 小组作业 / 实验调研 / 比赛展示 / 普通讲解 / 改已有文件。
2. 含"讲解一遍""课堂展示""中学生视角""分享""演讲稿"或可用于展示的内容，默认进入展示稿流程。
3. 只有用户明确说"不要 PPT/只要文字讲解"才退出。
4. **事实先行**：若主题涉及真实产品/事件/日期/规格、或依赖当下事实而用户没给依据，用 `WebSearch` 核验，无法核验就标"需用户确认"，绝不编造。

产物：route_decision。退出条件：确认进入流程或用户明确退出。

## 阶段 1：建立工作包 + 前置收集封面基本信息

进入条件：route_decision 已确认。

动作：
1. 创建输出目录，建议 `student-ppt/题目-slug/`。
2. **优先一次性收齐封面基本信息**：学生姓名或小组名、学校、年级、班级、课程/学科、指导老师、日期、展示标题/书名、组员与分工（小组）、老师要求（页数/时长/必含栏目/评分标准/是否要参考文献）。姓名/班级/学校等要明确问到，或确认"留空/匿名"。
3. 生成 brief.json，至少含：`topic / scenario / audience_and_grade / duration_or_slide_count / fixed_cover_fields / teacher_requirements / source_materials / output_formats / theme / image_policy / privacy_policy / missing_fields / assumptions`。
4. **结构化选项必须用 `AskUserQuestion` 工具**展示（不要只用文字让用户手动输入）。把格式/主题/配图/时长合并为一次工具调用；文本信息（姓名、学校名等）在工具返回后跟进收集。见 SKILL.md「AskUserQuestion 标准结构」。缺失项用默认值并标 `pending`。

产物：brief.json。退出条件：足以选主题和生成页面规格。

默认值：画幅 16:9；未给时长按 5 分钟；未给页数按 7–9 页；未给输出格式按 **HTML**；未给主题按场景推荐（见阶段 2）。

## 阶段 2：三个选择闸门（必须用 AskUserQuestion 工具展示）

进入条件：brief.json 已存在或草拟。**这一步要主动把选择交给用户，并给优缺点和建议**。

动作：
1. 读 `references/student-ppt-patterns.md`，选场景与页序，给每页定 `layout`（布局类型见 `references/layouts.md`）。
2. **闸门①②③合并 → 用 `AskUserQuestion` 工具一次调用**（4 题）——不要用纯文字列表让用户手动输入。具体选项见 SKILL.md「AskUserQuestion 标准结构」：
   - 输出格式（HTML 展示稿 / 可编辑 PPTX / 两者）
   - 风格主题（4 个按场景排序的选项）
   - 配图方式（不出图 / gpt-image-2）
   - 展示时长（4 档）
3. 工具返回后用跟进文字补齐文本类封面信息。
4. 出现学生身份、学校资料、截图、照片、图片服务、密钥、服务地址时，读 `references/privacy.md`，把 `privacy_policy` 写回 brief.json。
5. 把所有选择写回 `brief.json`（`output_formats / theme / image_policy / privacy_policy`）。

产物：更新后的 brief.json。退出条件：场景、布局、输出格式、主题、图片与隐私策略都明确。

停下规则：要把参考图片/学校资料/内部资料发给第三方服务前，先停下征求许可。

## 阶段 3：先生成页面规格

进入条件：阶段 2 决策完成。

动作：
1. 先生成 slide-spec.json（顶层含 `type/scene/theme/mode/meta`），不要直接写 HTML/PPT/图片提示词。
2. 每页必含：`page、layout、action_title、purpose、content、visual、notes、citations、image_request、privacy_level`；按 `layout` 补结构化字段（`items/columns/compare/quote/stats/people/triad/flow/question`，见 `references/layouts.md`）。
3. 内容要有深度：读 `references/content-depth.md`，解读优于复述、观点带证据。
4. 同步生成 outline.md。需要图片则生成 image_prompts.json（去除姓名/学校/班级/年级/学号/老师/电话/邮箱/住址）。
5. 不确定事实、缺引用、用户未提供的信息一律标"待补充/需用户确认"，**不编造**。

产物：slide-spec.json、outline.md；需要图片时含 image_prompts.json。退出条件：每页字段完整、无伪造。

## 阶段 4：样张/预览闸门（show-don't-tell + Junior-pass）

进入条件：slide-spec.json 已存在。

动作：
1. **看图挑**：用用户真实封面渲染 3 套候选主题的样张（`build-deck.mjs` 各跑一次 --theme，或只渲染封面页），让用户用眼睛挑。**样张上不要印"方案A/样张"等字样**。
2. **Junior-pass**：填真内容前先给"假设 + 占位（诚实灰块"待补"）+ 理由 + 选定布局骨架"，让用户早纠偏。
3. 自检：像不像真实学生展示、文字密度能否上台讲、风格合不合年级场景、隐私字段没进图片 prompt。
4. 用户说"直接生成"可跳过人工确认，但仍执行自检。

产物：preview 决策 / 样张文件。退出条件：视觉方向、文字密度、严肃度可用。

## 阶段 5：生成展示稿、讲稿、问答（按选择产出 PPTX）

进入条件：阶段 4 通过。

动作：
1. **展示轨（默认）**：`node scripts/build-deck.mjs --spec slide-spec.json --theme <主题> --out student-ppt.html`
2. **讲稿/问答**：读 `references/presenter-and-speech.md`，生成 `speech.md`（逐字稿三铁律：提示信号非全文、核心词加粗、过渡句独立成段、每页 150–300 字）和 `qa.md`（≥3 题，口语化，不编造数据/出处）。
3. **导出轨（仅当 output_formats 含 pptx）**：
   - `node scripts/build-pptx-html.mjs --spec slide-spec.json --theme <主题> --out pptx-slides`
   - `node scripts/validate-pptx-html.mjs pptx-slides`（先体检 4 约束）
   - `node scripts/export-pptx.mjs --slides pptx-slides --out deck.pptx`
   - 缺依赖：保留 pptx-slides/*.html + 体检结果，给安装命令 `npm install`（在 skill 目录），不阻塞。
4. **图片（仅当 image_policy≠none 且本地已配置）**：`node scripts/generate-images.mjs --input image_prompts.json --out generated-images`；未配置则保留占位 manifest，不阻塞。

产物：student-ppt.html、speech.md、qa.md；按选择含 deck.pptx；涉及图片含 image_manifest.json。

停下规则：不要让用户手动改 HTML 补姓名/班级/学校等基本信息；应写进页面规格由排版处理。

## 阶段 6：验证和交付

进入条件：产物已存在。

动作：
1. `node scripts/render-check.mjs student-ppt.html`（查缺页/文字过密/缺逐字稿/低对比/隐私泄露/疑似编造），生成/参考 qa-check.json。
2. 选了 PPTX：确认 `validate-pptx-html.mjs` 0 违规、PowerPoint 双击文字可编辑。
3. 对照 `references/checklist.md`（P0–P3）做最后自检。
4. 生成 qa-check.md，记录通过项/失败项/已知限制/下一步。

退出条件：最终回复列出生成文件路径、剩余风险和待补充项。

## 首次回复行为

不要复述整套流程。信息足够时：说明任务路由、默认值、三个选择（输出格式/主题/出图）、隐私策略，然后直接创建阶段产物。
信息部分缺失但可安全默认时：说明默认值并推进。会大量返工时最多问 3 个问题并给推荐默认。
skill 已激活且请求可合理转成展示任务时，禁止只输出文章/大纲/知识讲解。
