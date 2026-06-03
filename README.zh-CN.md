# Loom

[English](README.md)

Loom 是一个桌面端 AI 工作台，面向全局 Chat、项目工作区、记忆、定时任务和可复用 Skills。项目基于 Next.js、Electron、React 和 Claude Agent SDK 构建。

> 当前状态：早期开源版本。API、本地数据格式和 Skill 工作流仍可能调整。

## 核心能力

- 在同一个桌面应用里使用全局 Chat 和项目 Chat。
- 项目工作区支持文件、记忆、定时任务和上下文面板。
- 内置 Skills 目录，包括 Skill 创建器和学生 PPT 工作流。
- 支持授权确认和结构化用户选择 UI。
- 本地优先保存项目数据，并支持配置模型提供商。
- 支持 macOS 和 Windows 桌面打包。

## 仓库结构

```text
loom/
├── loom-cc-client/   # Next.js + Electron 桌面客户端
├── skills/           # Loom 内置 Skills 目录
├── docs/             # 开源项目文档
└── .github/          # CI 与贡献模板
```

## 环境要求

- Node.js 22 或更高版本
- pnpm 10 或更高版本
- macOS、Windows 或 Linux 开发环境
- 根据你的配置，需要模型服务商密钥，或本地 Claude CLI/SDK 授权

## 快速开始

```bash
cd loom-cc-client
pnpm install
pnpm dev
```

常用检查：

```bash
pnpm typecheck
pnpm build
```

可选本地环境变量模板：

```bash
cp .env.example .env.local
```

模型服务商也可以直接在应用设置里配置。

## 桌面安装包

当前基线版本的 macOS 安装包会生成在 `loom-cc-client/release/`：

- `Loom CC-0.1.0-arm64.dmg`：适用于 Apple Silicon / M 系列。
- `Loom CC-0.1.0.dmg`：适用于 Intel Mac。

当前本地构建包尚未使用 Developer ID 签名，也未 notarize。首次打开时 macOS Gatekeeper 可能会提示风险。

## 文档

- [安装说明](docs/installation.md)
- [开发指南](docs/development.md)
- [架构说明](docs/architecture.md)
- [Skills 说明](docs/skills.md)
- [发布流程](docs/release.md)
- [更新日志](CHANGELOG.md)

## Skills

Loom 内置 Skills 位于 `skills/`。Skills 菜单优先展示仓库目录中的 catalog 内容，已安装副本只用于合并安装状态。

当前内置示例：

- `skill-builder`：创建和优化 Loom Skill。
- `student-ppt-skill`：生成学生汇报、读书报告、课程展示等 PPT/HTML 工作流。

## 版本

当前开源基线版本：`v0.1.0`。

版本说明：[docs/releases/v0.1.0.md](docs/releases/v0.1.0.md)。

## 参与贡献

请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 安全问题

如果发现敏感安全问题，请不要直接提交公开 Issue。请阅读 [SECURITY.md](SECURITY.md)。

## 开源协议

本项目使用 [Apache License 2.0](LICENSE)。
