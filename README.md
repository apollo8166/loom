# Loom

[简体中文](README.zh-CN.md)

Loom is a desktop AI workbench for global chat, project workspaces, memory, scheduled tasks, and reusable Skills. It is built with Next.js, Electron, React, and the Claude Agent SDK.

> Status: early open-source release. APIs, local data format, and Skill workflows may still change.

## Features

- Global chat and project chat in one desktop app.
- Project workspaces with files, memory, schedules, and context panels.
- Built-in Skills catalog, including a Skill Builder and student PPT workflow.
- Ask-user confirmation UI for permissions and structured choices.
- Local-first project data with configurable model providers.
- Electron desktop packaging for macOS and Windows.

## Repository Layout

```text
loom/
├── loom-cc-client/   # Next.js + Electron desktop client
├── skills/           # Built-in Loom Skills catalog
├── docs/             # Open-source project documentation
└── .github/          # CI and contribution templates
```

## Requirements

- Node.js 22 or newer
- pnpm 10 or newer
- macOS, Windows, or Linux development environment
- A supported model provider credential or local Claude CLI/SDK auth, depending on your setup

## Quick Start

```bash
cd loom-cc-client
pnpm install
pnpm dev
```

Useful checks:

```bash
pnpm typecheck
pnpm build
```

Optional local environment template:

```bash
cp .env.example .env.local
```

Provider credentials can also be configured from the app settings UI.

## Desktop Builds

macOS packages for the current baseline are generated under `loom-cc-client/release/`:

- `loom-cc-v0.1.0-mac-arm64.dmg` for Apple Silicon Macs.
- `loom-cc-v0.1.0-mac-x64.dmg` for Intel Macs.

These local builds are currently unsigned and not notarized. macOS Gatekeeper may warn on first launch.

Packaged macOS apps bundle a matching Node.js v22 runtime and Claude CLI binary for the target architecture, so users do not need a system `node` install to launch the app. Release artifacts do not include local databases, provider credentials, or user settings; those are created per user under the app data directory after first launch.

## Documentation

- [Installation](docs/installation.md)
- [Development](docs/development.md)
- [Architecture](docs/architecture.md)
- [Skills](docs/skills.md)
- [Release Process](docs/release.md)
- [Changelog](CHANGELOG.md)

## Skills

Loom ships with built-in Skills under `skills/`. The Skills menu displays the repository catalog first, while installed copies are used to track install state.

Current built-in examples:

- `skill-builder`: creates and optimizes Loom Skills.
- `student-ppt-skill`: creates student-facing PPT/HTML presentation workflows.

## Release Version

Current open-source baseline: `v0.1.0`.

Release notes: [docs/releases/v0.1.0.md](docs/releases/v0.1.0.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

Please do not open public issues for sensitive vulnerabilities. See [SECURITY.md](SECURITY.md).

## License

Licensed under the [Apache License 2.0](LICENSE).
