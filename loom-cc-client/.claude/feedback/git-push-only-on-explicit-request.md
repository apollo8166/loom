---
type: feedback
description: AI 不应自动 push，只有用户明确要求时才执行 git push
created: 2026-04-28
updated: 2026-04-28
occurrences: 1
graduated: false
source_skill: dev-builder
scores:
---

# Git Push 只在用户明确要求时执行

**问题描述**：AI 在每次代码修改或 commit 后自动执行 git push，用户没有要求推送。

**触发场景**：开发过程中 AI 完成 commit 后，未经用户确认就自动 push 到远程仓库。

**教训/建议**：git push 是一个需要用户明确授权的操作。AI 不应在 commit 后自动 push。只有当用户明确说出"push 一下"、"推送"、"上传到 Gitee"、"同步到远程"等明确指令时，才执行 push 操作。commit 和 push 是两个独立的动作，commit 可以自动，push 必须等用户开口。
