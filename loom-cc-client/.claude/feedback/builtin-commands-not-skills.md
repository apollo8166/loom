---
name: 内置命令不走 Skill 工具
description: Claude Code 内置命令（/compact、/clear 等）不应通过 Skill 工具执行，否则报错
type: feedback
---

用户输入 `/compact` 时，AI 尝试调用 Skill 工具执行，结果报错"无法通过 Skill 工具执行"。

**Why:** Claude Code 的内置命令由运行时直接处理，不属于自定义 Skill。Skill 工具只接受在 `.claude/skills/` 中定义的技能，对内置命令返回错误。

**How to apply:** 用户输入以下命令时，直接告知"这是 Claude Code 内置命令，在输入框回车执行即可"，不调用 Skill 工具：
`/compact`、`/clear`、`/model`、`/diff`、`/export`、`/help`、`/rename`、`/resume`、`/init`、`/logout`、`/login`、`/fast`、`/cost`、`/vim`、`/memory`、`/doctor`、`/status`、`/config`、`/hooks`、`/mcp`、`/skills`、`/agents`
