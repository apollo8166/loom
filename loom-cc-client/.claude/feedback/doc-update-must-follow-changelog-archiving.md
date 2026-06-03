---
type: feedback
description: AI 更新文档时跳过了 CHANGELOG + 版本归档步骤，违反 Skill 规范
created: 2026-05-01
updated: 2026-05-01
occurrences: 1
graduated: false
source_skill: product-spec-builder, design-brief-builder, dev-planner
---

# 文档更新必须遵循对应 Skill 的变更归档规范

**问题描述**：AI 在更新 Product-Spec.md、Design-Brief.md、DEV-PLAN.md 三个核心文档时，直接修改了文件内容就结束了，没有执行对应 Skill 规范中的 CHANGELOG 写入和版本归档步骤。product-spec-builder 明确要求第4步写入 CHANGELOG.md、第5步询问用户确认后归档到 versions/，AI 跳过了这两步。

**触发场景**：迭代模式下更新文档内容时，AI 只关注了文件本身的修改，没有走完 Skill 定义的完整输出流程。

**教训/建议**：每次更新核心文档（Product-Spec.md、Design-Brief.md、DEV-PLAN.md）后，必须在输出正文响应之前先执行对应 Skill 的 CHANGELOG + 版本归档流程。流程步骤不可跳过——修改文件只是第一步，CHANGELOG 追加和版本归档确认是必要的后续步骤。
