---
type: feedback
description: DEV-PLAN.md 应输出到 docs/dev/current/ 目录，不放项目根目录
created: 2026-04-28
updated: 2026-04-28
occurrences: 1
graduated: false
source_skill: dev-planner
---

# DEV-PLAN.md 存放路径应为 docs/dev/current/，不放根目录

**问题描述**：dev-planner 生成的 DEV-PLAN.md 被放在项目根目录，而用户要求和 Product-Spec.md、Design-Brief.md 对齐，统一放在 `docs/` 子目录体系下（`docs/dev/current/DEV-PLAN.md`）。用户明确说"dev-plan.md 文档要在 docs/dev/current 下，更新一下 skill"。

**触发场景**：首次执行 /dev-planner 时，输出文件路径未遵循 CLAUDE.md 中 [文件结构] 定义的 `docs/dev/current/DEV-PLAN.md` 路径。用户通过拒绝 ExitPlanMode 纠正。

**教训/建议**：dev-planner skill 必须将 DEV-PLAN.md 输出到 `docs/dev/current/DEV-PLAN.md`，与项目文件结构规范保持一致。这一路径在 CLAUDE.md [文件结构] 中已有定义，skill 执行时应严格遵循，不应偏离。如果 dev-planner SKILL.md 中的路径指引与 CLAUDE.md 不一致，应以 CLAUDE.md 为准并更新 SKILL.md。
