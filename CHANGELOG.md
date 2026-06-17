# Changelog

All notable changes to Loom will be documented in this file.

This project follows [Semantic Versioning](https://semver.org/).

## [0.2.2] - 2026-06-17

### Added

- Added PDF text extraction fallback using `pdfjs` when the primary parser returns no readable text.
- Marked image-only or scanned PDFs as unreadable so they are blocked before chat submission.

### Fixed

- Prevented Loom from treating unreadable PDF attachments as workspace files in Chat and runtime SDK flows.
- Kept PDF attachments on a single consistent presentation path with explicit `PDF Text` and `PDF Unreadable` labels.

## [0.2.1] - 2026-06-11

### Added

- Claude Agent SDK image-generation tool integration for global Chat and project Chat.
- Consistent `ImageJobCard` rendering for Agent-triggered image generation results.
- Click-to-preview support for Markdown image URLs in Chat.
- Drag-and-drop file upload support directly on the global Chat and project Chat workbench input area.
- Developer ID signed, notarized, stapled, and Gatekeeper-verified macOS DMG release flow.

### Fixed

- Parsed MCP image tool results when the SDK wraps JSON inside text content blocks.
- Prevented `tool_use_summary` from replacing real image tool results before `jobId` is available.
- Removed image URLs from image tool result JSON to reduce duplicate Markdown image replies.
- Kept Agent-created image jobs separate from manual image-generation mode history.
- Centralized the visible app version used by the left navigation footer and Guide dialog.

## [0.2.0] - 2026-06-10

### Added

- Image generation workflows for text-to-image and reference image-to-image inside Chat.
- Configurable image providers for GPT-Image2 / OpenAI, Nano Banana 2, and SeeDream / Volcengine Ark.
- Image generation job cards with progress, result preview, retry, download, and reuse-as-reference actions.
- Project resource management for Subagents, project Skills visibility, and project MCP visibility.
- Enhanced scheduled tasks with Subagent / Skills bindings, live execution output, execution history, and session navigation.
- Feishu / Lark project bot channel settings with session bindings, allowlists, permission modes, and audit logs.
- Model tier mapping, custom model entries, context window settings, context usage display, and `/compact` suggestions.
- MP4 and local file preview improvements across attachments, Markdown links, and project files.

### Fixed

- Added chat input history navigation with the keyboard up and down arrows.
- Added right-click "open in system directory" support for project Files directories.
- Kept long-running Chat sessions alive while switching sessions, with visible running indicators.
- Fixed project creation so descriptions are saved correctly.
- Fixed project creation title behavior so the selected folder name only fills the title when the title is empty.
- Hardened macOS packaging and startup diagnostics for bundled Node.js, Claude CLI, and native modules.
- Improved large attachment warnings and active run interruption handling.

## [0.1.0] - 2026-06-03

### Added

- Initial open-source baseline for Loom.
- Desktop client based on Next.js, Electron, and React.
- Global chat and project chat workflows.
- Built-in Skills catalog under `skills/`.
- Skill Builder baseline for creating Loom Skills.
- Student PPT Skill package.
- Ask-user confirmation UI for permissions and structured choices.
- Project documentation, contribution guide, security policy, and CI workflow.

### Notes

- This is an early release. Local data formats, model configuration, and Skill workflows may change before `1.0.0`.
