# Loom

**面向普通用户的本地 AI Agent 工作台。**

Loom 基于 **Claude Agent SDK** 构建，把 Claude Code 级别的 Agent 能力带到桌面应用中。它面向日常 Chat、项目工作区、工具调用、文件上下文、Memory、Skills 和可视化授权确认，目标是在本地桌面体验中覆盖一部分 Claude Code 与 Claude Desktop 的常用场景。

Loom 既是一个可以直接使用的本地 AI 工作台，也是一套帮助用户理解、学习和掌握 AI Agent 的工具。用户可以在 Claude Agent SDK 的基础上配置不同模型服务商，例如 Claude、ChatGPT、Qwen、Doubao、DeepSeek、GLM 或自定义端点。

[![GitHub release](https://img.shields.io/github/v/release/apollo8166/loom)](https://github.com/apollo8166/loom/releases)
[![Platform](https://img.shields.io/badge/platform-macOS-lightgrey)](https://github.com/apollo8166/loom/releases)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

[English](README.md)

[下载安装](#下载安装) | [快速开始](#快速开始) | [为什么选择-Loom](#为什么选择-loom) | [核心功能](#核心功能) | [Memory](#memory-与上下文管理) | [Skills](#skills) | [开发](#开发)

> 当前状态：早期开源版本。Loom 已具备桌面 Chat、项目工作区、Token 统计、Skills、记忆、定时任务、MCP / Agents 管理、图像生成和飞书 / Lark 通道基础能力；Harness、Marketplace 和插件系统仍在持续完善。

<a id="screenshot-workbench-main"></a>

<p align="center">
  <img src="docs/assets/screenshots/workbench-main.png" alt="Loom 主工作台全景" width="1020" />
</p>

---

## 为什么选择 Loom

### 对小白用户更友好

Claude Code 很强，但终端门槛并不低。Loom 的目标是让没有编程知识的用户也能快速上手 Agent：打开桌面应用，选择项目或全局 Chat，上传资料、截图、切换模型、查看工具调用和 Token 用量。

用户不需要一开始理解 CLI、工作目录、上下文压缩、MCP、Skills、Sub-Agent 等概念。Loom 会把这些能力放进可视化界面里，让用户先用起来，再逐步学会 AI Agent 是如何工作的。

### Token 用量透明且可控

Agent 的成本和效果，很大程度取决于上下文管理。Loom 把 Token 使用情况直接展示在 Chat 页面：

- 当前 Session 的上下文占用。
- 输入 Token、输出 Token 和回答耗时。
- 发送给模型的上下文组成分类：历史消息、附件、记忆、Skills、工具、MCP、系统上下文等。
- `/compact` 压缩建议和压缩记录。
- SDK Context 用量和 Auto Compact 状态。

这让用户不仅能看到“AI 回答了什么”，还能看清“AI 为什么消耗了这些 Token”。

### 项目可以自我进化

Loom 不只是一个临时聊天窗口。每个项目都可以沉淀自己的工作方式：

- 项目工作目录。
- 项目级 `.claude/` 配置。
- 项目记忆与会话历史。
- 项目 Skills 和 Agents。
- Git、worktree 与工作状态。
- 定时任务和长期运行的工作流。

随着使用次数增加，项目会逐渐形成自己的上下文、规则、记忆和技能。Loom 希望把这种能力变成“项目管理”的一部分，而不是散落在一次次对话里。

### Memory 是项目持续变聪明的核心

Loom 的 Memory 不是把聊天记录简单摘抄进一个文件，而是一套面向长期项目工作的上下文管理系统。

它会把“发生过什么”和“项目长期应该如何理解”分开处理：

- **L0 事实记录**：消息、操作、确认、拒绝等只增不改的事实留痕。
- **L1 近期观察**：最近对话中出现的偏好、风险、纠正和状态信号。
- **L2 语义记忆**：跨多次观察后形成的稳定规律、项目规则和重复反馈。
- **L3 Project Dossier**：当前项目的阶段性理解摘要，用于后续上下文注入。

Loom 通过价值过滤、置信过滤、晋升/去重过滤三道闸门，控制什么该记、什么该丢、什么需要用户确认。普通对话尽量走低成本路径，不让“自我进化”变成每轮额外消耗一次模型调用。

### Harness：把业务场景打包成可复用运行环境

Loom 中的 Harness 可以理解为面向某个业务场景的 Agent 运行套件。一个 Harness 不只是一个提示词，而是可以包含：

- 项目规则。
- Skills。
- Sub-Agents。
- MCP 配置。
- 权限策略。
- 目录结构。
- 模板文件。
- 示例任务。
- 行业工作流。

例如“学生 PPT 生成”“产品需求分析”“投研资料整理”“课程教案生成”“自动化浏览器测试”都可以被沉淀成不同 Harness。用户选择一个 Harness，就能快速得到适合该行业场景的 Agent 工作方式。

### Skills：内容能力与 Skill Builder

Loom 内置 Skills 系统。Skill 可以是一种内容能力，例如学生 PPT、报告生成、行业分析、写作模板；也可以是一种工具流程，例如文件整理、审查规范、自动化检查。

更重要的是，Loom 内置了 **Skill 创建器**。它不是简单生成一段提示词，而是通过轻量对话帮助用户提炼：

- 任务边界。
- 触发条件。
- 输入输出。
- 领域维度。
- 执行策略。
- 工作流程。
- 质量标准。
- 风险边界。
- Token 压缩方式。

目标是让普通用户也能把自己的经验、流程和行业方法沉淀成专业、可靠、省 Token 的 Skill。

### Marketplace：面向行业的模板市场

Loom 的 Marketplace 方向不是只卖单个插件，而是提供面向不同行业和业务的 Harness 模板能力。

一个 Marketplace 模板可以包含一整套工作方案：项目规则、Skills、Agents、MCP、素材模板、流程说明和权限建议。用户可以直接导入模板，快速开始某个垂直业务场景。

当前 Marketplace 仍在建设中，后续会逐步支持更多行业模板和导入能力。

### 插件能力：走向可扩展 Agent 生态

Loom 未来会支持更完整的插件系统。插件可以内置或扩展运行环境，例如：

- 启动浏览器运行环境。
- 执行浏览器自动化任务。
- 接入外部服务。
- 提供行业工具。
- 扩展 Agent 的工作流能力。

这部分未来可以参考 Codex 插件市场的方向，让 Loom 成为可扩展的本地 Agent 平台。

---

## 快速开始

### 路径 A：下载安装

1. 打开 [Releases](https://github.com/apollo8166/loom/releases/latest)。
2. 根据设备下载对应安装包：
   - `loom-cc-v0.2.3-mac-arm64.dmg`：Apple Silicon / M 系列 Mac。
   - `loom-cc-v0.2.3-mac-x64.dmg`：Intel Mac。
3. 安装并打开 Loom。
4. 在设置中配置模型服务商。
5. 新建全局 Chat 或选择项目工作目录。

> 当前 macOS 构建包已完成 Developer ID 签名、notarize、staple，并在发布前通过 Gatekeeper 验证。

### 路径 B：从源码运行

| 前置依赖 | 最低版本 |
|---|---|
| Node.js | 22+ |
| pnpm | 10+ |
| Git | 任意现代版本 |

```bash
git clone https://github.com/apollo8166/loom.git
cd loom/loom-cc-client
pnpm install
pnpm dev
```

常用检查：

```bash
pnpm typecheck
pnpm build
```

桌面打包：

```bash
pnpm build:mac:arm64
pnpm build:mac:x64
pnpm build:win
```

---

## 核心功能

### Chat 输入区

<a id="screenshot-chat-input"></a>

<p align="center">
  <img src="docs/assets/screenshots/screenshot-chat-input.png" alt="Loom Chat 输入区" width="1020" />
</p>

| 功能 | 说明 |
|---|---|
| 附件锚定 | 可以把文件固定到当前 Session，让 Agent 持续参考。 |
| 附件预览 | 支持 Office 文档、PDF、Markdown、图片、TXT 等常见文件。 |
| 快速截图 | 可以把截图直接发送给当前 Session。 |
| 模式切换 | 支持权限模式、计划模式等工作方式切换。 |
| 推理切换 | 支持不同 Thinking / 推理强度选择。 |
| 模型切换 | 在当前会话中快速切换模型。 |
| Token 显示 | 显示当前 Session 的上下文使用量。 |
| 工作目录 | 支持快速创建或选择工作目录。 |
| Git / worktree 状态 | 展示当前项目的 Git 与 worktree 状态。 |
| 斜杠命令 | 支持 `/clear`、`/compact`、`/skills`、`/agents`、`/mcp` 等命令。 |

### Chat 显示区

<a id="screenshot-chat-display"></a>

<p align="center">
  <img src="docs/assets/screenshots/screenshot-chat-display.png" alt="Loom Chat 显示区" width="1020" />
</p>

| 功能 | 说明 |
|---|---|
| Token 统计 | 展示输入、输出和上下文 Token。 |
| 工具调用 UI | `tool_use`、工具结果、Agent、Skill、Workflow 命令都有结构化展示。 |
| AskUserQuestion | 支持在 Chat 页面可视化选择，并持久化用户选择。 |
| 权限确认 | 对需要授权的操作提供可视化确认 UI。 |
| Copy | 支持复制 AI 回答内容。 |
| 导出 | 支持一键导出聊天内容。 |
| 耗时显示 | 展示 AI 回答耗时。 |
| Token 分类 | 支持查看本轮输入 Token 的组成，让用户理解上下文成本。 |

### 项目工作区

<a id="screenshot-project-list"></a>

<p align="center">
  <img src="docs/assets/screenshots/screenshot-project-list.png" alt="Loom 项目列表" width="1020" />
</p>

<a id="screenshot-project-workspace"></a>

<p align="center">
  <img src="docs/assets/screenshots/screenshot-project-workspace.png" alt="Loom 项目工作区" width="1020" />
</p>

| 功能 | 说明 |
|---|---|
| 全局 Chat | 没有明确项目时，也可以在默认工作目录中对话。 |
| 项目 Chat | 每个项目拥有自己的会话、工作目录和上下文。 |
| 多会话 | 同一个项目可以维护多个 Session。 |
| 工作目录 | Agent 可以围绕真实文件夹工作。 |
| `.claude/` 支持 | 项目规则、Skills、Agents、MCP 等能力可随项目沉淀。 |
| Memory / Evolution Center | 支持全局记忆、项目记忆、L1/L2/L3 项目进化和待处理事项。 |
| 定时任务 | 支持项目级定时任务和自动化执行。 |

### Memory 与上下文管理

<a id="screenshot-memory-panel"></a>

<p align="center">
  <img src="docs/assets/screenshots/screenshot-memory-panel.png" alt="Loom Memory 与 Evolution Center" width="1020" />
</p>

Loom 的核心优势之一是 Memory 与上下文管理。这里的“上下文”不是越多越好，而是让 AI 在回答前看到当前任务真正需要的信息。

一次 AI 回复可能包含：当前输入、会话历史、项目工作区、附件、Skills、Agents、MCP、工具权限、Compact 摘要、全局记忆、项目记忆和项目进化信息。Loom 会把这些信息组织、压缩、筛选和展示出来，避免用户只能猜 AI 到底看到了什么。

| 能力 | 说明 |
|---|---|
| 全局记忆 | 保存跨项目通用的用户偏好、输出习惯、工作方式和常见纠错。 |
| 项目记忆 | 保存当前项目目标、业务规则、关键决策、用户反馈、复盘结论和项目术语。 |
| L0 事实记录 | 记录发生过的消息、操作、确认/拒绝等事实，只增不改，作为证据来源。 |
| L1 Recent Observations | 记录最近对话中有价值的观察，例如偏好、风险、纠正和状态信号。 |
| L2 Semantic Memories | 多次观察后晋升出的稳定规律、项目规则和长期认知。 |
| L3 Project Dossier | 当前项目的阶段性理解摘要，包括目标、偏好、稳定规则、近期风险和下一步。 |
| 三道闸门 | 通过价值过滤、置信过滤、晋升/去重过滤，控制记忆质量。 |
| Negative Prior | 用户否决过的错误理解会降低同类候选再次出现的概率。 |
| 生命周期 | 记忆会随证据增强，也会在长期没有新证据时 stale、archived 或 deprecated。 |
| 注入预览 | 用户可以查看本轮将注入的项目档案、稳定记忆、近期观察和规则。 |

Loom 的 Memory 面板不是普通文件列表，而是一个 **Evolution Center**：

- 展示需处理事项、L2 规律数量、L1 观察数量、Active 规则数量。
- 展示 L3 Project Dossier，帮助用户理解 Loom 当前如何看待这个项目。
- 展示 L2 Semantic Memories，让用户看到哪些稳定规律会影响 AI。
- 展示 L1 Recent Observations，让用户看到近期有哪些有价值信号。
- 只把高影响、冲突、低置信或用户明确要求的事项放到“需要处理”区域。
- 支持查看 `loom_context` 注入预览，用来调试为什么 AI 这样回答。

这套机制让项目可以长期进化，但不会把所有历史、证据和记忆无脑塞进每次输入。

### Token 与上下文管理

<a id="screenshot-token-panel"></a>

<p align="center">
  <img src="docs/assets/screenshots/screenshot-token-panel.png" alt="Loom Token 与上下文面板" width="1020" />
</p>

Loom 把 Token 从“看不见的成本”变成“可观察、可学习、可管理的上下文”。Memory 与 Token 管理是联动的：项目可以长期积累记忆，但每次只按预算注入当前任务相关的部分。

| 功能 | 说明 |
|---|---|
| Session Token | 当前会话上下文使用量。 |
| 输入 / 输出统计 | 每条 AI 回复的输入、输出 Token。 |
| 上下文分类 | 展示系统、项目、历史、Compact、Memory、Skills、工具、MCP、附件和当前输入等组成。 |
| Memory Token 控制 | 不把全部记忆塞进 prompt，优先注入 L3，再按相关性选择 L2、Active Rules 和少量 L1。 |
| 工具结果瘦身 | 长工具输出可以在 UI 中展示，但后续上下文只保留必要摘要和关键结论。 |
| 附件治理 | 附件会按大小和类型处理，避免单个文件撑爆上下文。 |
| `/compact` | 手动压缩会话历史，保留目标、决策、进度、待办和重要约束。 |
| Auto Compact | 显示 SDK 自动压缩状态。 |
| 压缩边界 | 在聊天记录中显示压缩节点和压缩前后信息。 |

### Skills

<a id="screenshot-skills"></a>
<a id="screenshot-skills-list"></a>

<p align="center">
  <img src="docs/assets/screenshots/screenshot-skills-list.png" alt="Loom Skills 列表" width="1020" />
</p>

Loom 的 Skills 是可复用的能力包。一个 Skill 通常包含：

```text
skill-name/
├── SKILL.md
└── loom.skill.json
```

按需还可以包含：

```text
references/  长资料、领域规则、案例库
scripts/     稳定、重复、容易出错的确定性操作
assets/      模板、图片、字体、示例素材
```

当前内置示例：

| Skill | 说明 |
|---|---|
| `skill-builder` | 创建、优化和标准化 Loom Skill。 |
| `student-ppt-skill` | 面向学生汇报、读书报告、课程展示等场景生成 PPT / HTML 工作流。 |

Skill 菜单优先展示仓库 `skills/` 目录中的官方目录，安装状态会与用户或项目本地副本合并。

<a id="screenshot-skills-skill"></a>

<p align="center">
  <img src="docs/assets/screenshots/screenshot-skills-skill.png" alt="Loom Skill 详情" width="1020" />
</p>

### Skill Builder

<a id="screenshot-skill-builder"></a>
<!-- 截图锚点：Skill Builder 创建流程，展示需求确认、标准卡、预览确认 -->

Skill Builder 的重点不是“写一段长提示词”，而是帮助用户把一个重复任务变成高质量 Skill。

它会控制三件事：

- **专业性**：先提炼领域标准，再生成文件。
- **可靠性**：明确触发条件、边界、失败模式和质量标准。
- **省 Token**：主文件只保留运行时必要内容，长资料放 `references/`，确定性步骤放 `scripts/`。

当用户不知道要创建什么时，Skill Builder 也支持低门槛发现模式：

```text
你今天或者本周，哪一件事情让你觉得最枯燥、最想推给别人干？
```

它会先判断这件事是否适合沉淀为 Skill，而不是强行把一次性任务包装成复杂流程。

### Agents 与 MCP

<a id="screenshot-agents-mcp"></a>
<!-- 截图锚点：/agents 和 /mcp 命令面板 -->

Loom 支持读取和展示项目或全局的 Agents、MCP 配置，并通过 Chat 命令面板调用相关能力。

| 能力 | 说明 |
|---|---|
| `/agents` | 查看可用 Sub-Agents。 |
| `/mcp` | 查看或配置 MCP Server。 |
| 项目级配置 | 从项目 `.claude/` 中读取项目能力。 |
| 全局配置 | 读取用户全局 Claude 配置。 |

### Harness 与 Marketplace

<a id="screenshot-marketplace"></a>
<!-- 截图锚点：Marketplace 页面，展示行业 Harness 模板列表和详情 -->

Loom 希望把成熟业务场景沉淀为 Harness 模板，并通过 Marketplace 复用。

未来一个 Harness 模板可以包含：

- 项目规则。
- Skills。
- Agents。
- MCP。
- 模板文件。
- 初始化工作流。
- 权限建议。
- 示例任务。

Marketplace 的目标是让用户不用从零开始配置 Agent，而是直接选择适合行业场景的工作台模板。

### 插件能力

<a id="screenshot-plugins"></a>
<!-- 截图锚点：插件能力页面或未来插件市场 -->

Loom 的插件系统仍在规划中。未来插件可以扩展 Agent 的运行环境和外部能力，例如：

- 浏览器运行环境。
- 浏览器自动化。
- 外部系统连接器。
- 行业工具。
- 自定义工作流。

---

## 斜杠命令

在 Chat 输入框中输入 `/` 可以打开命令面板。Loom 会尽量保留 Claude Code CLI 的原生命令体验，并在桌面端提供可视化入口。

常见命令包括：

| 命令 | 功能 |
|---|---|
| `/clear` | 清空当前上下文。 |
| `/compact` | 压缩会话历史，降低上下文成本。 |
| `/skills` | 查看或调用 Skills。 |
| `/agents` | 查看 Sub-Agents。 |
| `/mcp` | 查看 MCP Servers。 |
| `/init` | 初始化项目上下文。 |
| `/model` | 查看或切换模型。 |

---

## 仓库结构

```text
loom/
├── loom-cc-client/   # Next.js + Electron 桌面客户端
├── skills/           # Loom 内置 Skills 目录
├── docs/             # 开源项目文档
├── CHANGELOG.md      # 更新日志
├── CONTRIBUTING.md   # 贡献指南
└── LICENSE           # Apache-2.0 协议
```

---

## 开发

```bash
cd loom-cc-client
pnpm install
pnpm dev
```

常用命令：

```bash
pnpm typecheck
pnpm build
pnpm build:mac:arm64
pnpm build:mac:x64
pnpm build:win
```

更多说明：

- [安装说明](docs/installation.md)
- [开发指南](docs/development.md)
- [架构说明](docs/architecture.md)
- [Skills 说明](docs/skills.md)
- [发布流程](docs/release.md)
- [更新日志](CHANGELOG.md)

---

## 学习 AI Agent

Loom 不只想成为一个工具，也希望成为用户理解 AI Agent 的学习入口。

用户可以在 Loom 中观察：

- Agent 如何读取项目上下文。
- 为什么某些任务需要授权。
- 工具调用如何发生。
- Skills 何时触发。
- Sub-Agent 如何协作。
- Token 是如何被消耗的。
- `/compact` 为什么能降低上下文压力。
- 全局记忆和项目记忆如何隔离。
- L1 观察如何晋升为 L2 稳定规律。
- L3 Project Dossier 如何影响后续回答。
- 为什么不是所有历史和记忆都应该进入上下文。

对普通用户来说，这比直接面对终端和配置文件更容易理解。对开发者来说，Loom 也可以作为 Claude Agent SDK 的桌面工作台参考实现。

---

## 版本

当前开源基线版本：`v0.2.3`。

版本说明：[docs/releases/v0.2.3.md](docs/releases/v0.2.3.md)。

v0.2.3 默认展示图像生成入口，并在用户提交生图请求但尚未配置 provider 或 API Key 时，引导前往 Settings 完成配置。

---

## 参与贡献

欢迎提交 Issue、PR、文档补充和业务 Harness / Skill 建议。

请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

---

## 安全问题

如果发现敏感安全问题，请不要直接提交公开 Issue。请阅读 [SECURITY.md](SECURITY.md)。

---

## 开源协议

本项目使用 [Apache License 2.0](LICENSE)。
