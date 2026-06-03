---
type: feedback
description: dev-planner 不应用产品简称做工程目录名，要使用用户指定的项目名
created: 2026-04-28
updated: 2026-04-28
occurrences: 1
graduated: false
source_skill: dev-planner
---

# dev-planner 项目命名：应使用用户指定的项目名，不能自行缩写

**问题描述**：dev-planner 生成 DEV-PLAN 时，将前端工程名写成了 `abmom`（产品简称），而用户明确指定项目名为 `abmom-ai-classroom`。AI 自行简化了工程目录名，没有沿用用户给出的名称。

**触发场景**：首次执行 /dev-planner 生成 DEV-PLAN.md 时，Phase 中涉及的工程目录名使用了缩写而非用户指定的完整项目名。用户通过拒绝 ExitPlanMode 纠正。

**教训/建议**：dev-planner 在生成 DEV-PLAN 时，工程目录名必须使用用户明确指定的项目名称，不能用产品简称、缩写或 AI 自行推断的名称。如果用户没有指定项目名，应主动询问，而非自行决定。
