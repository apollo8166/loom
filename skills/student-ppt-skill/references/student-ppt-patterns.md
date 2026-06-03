# Student PPT Patterns

Use this reference only after Phase 2 starts. This file is not a general explanation; it controls page structure and quality gates for student presentation deliverables.

## Flow gates

Do not skip these gates:

1. brief.json exists or has been drafted in the response.
2. mode is selected: image, editable, or mixed.
3. scenario template is selected.
4. slide-spec.json is generated before any HTML/PPT file.
5. speech.md and qa.md are generated with the deck, not after the user asks again.
6. qa-check.md is produced before final delivery.

If the user asks "讲解一遍" and the skill is active, treat it as a classroom presentation unless they explicitly say not to make slides.

## Reading report, default 8 pages

1. Cover: book/topic, student info, course, date.
2. Why this book: reading motivation, background, guiding question.
3. Author and context: author, period, text background, only from known sources.
4. Content structure: chapter, plot, argument, timeline, or structure map.
5. Key people, concepts, or ideas: choose 2-3 truly important points.
6. Most meaningful moment: short quote or event summary plus interpretation.
7. My understanding and real-world link: agreement, question, inspiration, course/life link.
8. Summary and discussion: 3 conclusions and 1-2 discussion questions.

## Course report

- Cover.
- Why this topic matters to the course.
- Core concept explanation.
- Case, material, experiment, or example.
- Analysis: cause, structure, influence, pros/cons.
- Conclusion: no more than 3 takeaways.
- Q&A and references.

## Defense or research presentation

- Cover.
- Research question.
- Significance.
- Gap in existing work.
- Method, data, experiment, or case.
- Main result.
- Contribution.
- Limitations and next steps.
- Q&A.

## Group assignment

- Cover.
- Task goal.
- Team roles.
- Timeline or process.
- Method and material.
- Result.
- Reflection and improvement.
- References.

## Page rules

- One page, one claim.
- Use action titles. Avoid empty titles such as "background" or "summary".
- Body should usually stay under 80 Chinese characters.
- Prefer timeline, map, comparison, structure diagram, quote card, or key visual over long bullets.
- Do not invent author, year, page number, DOI, experiment result, survey data, or school requirement.
- If source is missing, write "source to be confirmed" instead of fabricating a citation.

## Layout per page（每页必须定 layout）

给每页选一个 `layout`（完整清单和字段见 `references/layouts.md`）：
`cover, agenda, claim-bullets, two-column, timeline, comparison, pros-cons, structure-map, quote, stat-highlight, key-people, reflection, summary`。

各场景的推荐 layout 序列：
- **读书报告(8)**：cover → claim-bullets → two-column(作者/背景) → timeline(情节/结构) → claim-bullets(核心观点) → quote(片段解读) → reflection(个人/环境/选择) → summary。
- **课程汇报(7)**：cover → claim-bullets(为何重要) → two-column(核心概念) → claim-bullets或image(案例) → comparison或structure-map(分析) → summary(≤3 结论) → summary(Q&A/参考)。
- **答辩/课题(9)**：cover → claim-bullets(研究问题) → claim-bullets(意义) → comparison(已有工作的缺口) → timeline或two-column(方法/数据) → stat-highlight或claim-bullets(主要结果) → claim-bullets(贡献) → pros-cons或claim-bullets(局限与下一步) → summary(Q&A)。
- **小组作业(8)**：cover → claim-bullets(任务目标) → key-people(分工) → timeline(进度/流程) → two-column(方法与材料) → stat-highlight或claim-bullets(成果) → reflection(反思改进) → summary(参考)。

## Required slide-spec fields

Every slide must include:

- page
- layout
- action_title
- purpose
- content
- visual
- notes
- citations
- image_request
- privacy_level

按 layout 追加结构化字段（可选）：`items`(timeline/agenda)、`columns`(two-column)、`compare`/`pros`/`cons`(comparison)、`quote`、`stats`、`people`、`triad`(reflection)、`flow`(structure-map)、`question`(summary)、`image`(配图路径)。

Missing any required field means Phase 3 is not complete.
