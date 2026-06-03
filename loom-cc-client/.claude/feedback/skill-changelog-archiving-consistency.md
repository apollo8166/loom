---
type: feedback
description: design-brief-builder 和 dev-planner 缺少 CHANGELOG + 版本归档步骤，与 product-spec-builder 不一致
created: 2026-05-01
updated: 2026-05-01
occurrences: 1
graduated: false
source_skill: design-brief-builder, dev-planner
---

# design-brief-builder 和 dev-planner skill 缺少变更归档步骤

**问题描述**：design-brief-builder 和 dev-planner 两个 Skill 的输出阶段没有 CHANGELOG 和版本归档步骤，而 product-spec-builder 有完整的第4步（追加变更记录）和第5步（归档旧版本）。三个核心文档的产出 Skill 规范不一致，导致 AI 在执行时没有归档指引。

**触发场景**：用户发现 AI 更新 Design-Brief.md 和 DEV-PLAN.md 后没有归档，检查 Skill 定义后发现这两个 Skill 本身就缺少该流程。

**教训/建议**：三个核心文档（Product-Spec、Design-Brief、DEV-PLAN）的产出 Skill 必须有统一的 CHANGELOG + 版本归档流程，保持规范一致性。新增或修改 Skill 时，应参照已有 Skill 的最佳实践，确保同类流程不遗漏。具体补充内容包括：design-brief-builder 新增第4步（CHANGELOG）+ 第5步（归档）；dev-planner 生成模式新增第5步（CHANGELOG）+ 第6步（归档），迭代模式新增第4步（CHANGELOG）+ 第5步（归档）；CLAUDE.md 文件结构中 design/ 和 dev/ 补全 CHANGELOG.md 和 versions/ 条目。
