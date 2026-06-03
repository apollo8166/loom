---
type: feedback
description: Electron 桌面应用中后端服务仅负责激活验证，本地业务逻辑全在前端
created: 2026-04-28
updated: 2026-04-28
occurrences: 1
graduated: false
source_skill: dev-planner
---

# Electron 桌面应用架构：后端服务 ≠ 本地业务逻辑层

**问题描述**：dev-planner 在生成 DEV-PLAN 时，将 PDF 导出、PDF 教材解析、SQLite 读写等本地业务逻辑全部分配到了 Spring Boot 后端服务中。用户明确纠正：Spring Boot 后端唯一职责是用户产品序列号的激活验证（MySQL 存许可证 + 设备绑定），其他所有本地业务逻辑（SQLite 读写、PDF 处理、TTS 等）全部在前端 Electron + Next.js API Routes 中实现。

**触发场景**：第二次生成 DEV-PLAN 时，AI 仍然混淆了"云端服务"和"本地业务逻辑"的边界，将大量本地功能错误地划分到后端 Phase 中。用户通过拒绝 ExitPlanMode 给出详细纠正。

**教训/建议**：在 Electron 桌面应用架构下，必须严格区分两个层次：
1. **云端服务**（Spring Boot + MySQL）：轻量级，仅处理激活码验证、设备绑定等需要远程数据库的功能
2. **本地业务逻辑**（Electron + Next.js API Routes + better-sqlite3）：所有需要本地运行的功能，包括 SQLite 数据库读写、PDF 处理、TTS 语音合成等

dev-planner 在设计双工程架构（前端 + 后端）时，要先明确后端的职责边界，而非按"功能分类"简单划分前后端。关键判断标准：这个功能是否需要远程服务器？不需要 → 放前端 API Routes。
