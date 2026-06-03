# Feedback Index

> 经验教训索引。新建或更新 feedback 文件后，同步更新此索引。
> 格式：每条一行，`- [标题](文件名.md) — 一句话描述`
> 模板：templates/feedback-topic-template.md

- [dev-planner 项目命名：应使用用户指定的项目名](dev-planner-project-naming.md) — dev-planner 不应用产品简称做工程目录名，要使用用户指定的项目名
- [DEV-PLAN.md 存放路径应为 docs/dev/current/](dev-plan-output-path.md) — DEV-PLAN.md 应输出到 docs/dev/current/ 目录，不放项目根目录
- [Electron 桌面应用架构：后端服务 ≠ 本地业务逻辑层](backend-scope-electron-app.md) — Electron 桌面应用中后端服务仅负责激活验证，本地业务逻辑全在前端
- [Git Push 只在用户明确要求时执行](git-push-only-on-explicit-request.md) — AI 不应自动 push，只有用户明确说"push"、"推送"等指令时才执行
- [内置命令不走 Skill 工具](builtin-commands-not-skills.md) — /compact、/clear 等 Claude Code 内置命令不应通过 Skill 工具执行
- [文档更新必须遵循对应 Skill 的变更归档规范](doc-update-must-follow-changelog-archiving.md) — AI 更新文档时跳过了 CHANGELOG + 版本归档步骤，违反 Skill 规范
- [design-brief-builder 和 dev-planner skill 缺少变更归档步骤](skill-changelog-archiving-consistency.md) — 三个核心文档的产出 Skill 必须有统一的 CHANGELOG + 版本归档流程
- [新增功能必须走模块化 PRD 并同步更新 skill 规范](modular-prd-for-feature-iterations.md) — 新增功能先判断主文档/模块文档归属，不能再把细节堆回主 PRD
