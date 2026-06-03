# Architecture

Loom is a desktop app built from three layers:

## Desktop Shell

Electron provides the desktop shell, local runtime entry points, and packaging.

Relevant paths:

- `loom-cc-client/electron/`
- `loom-cc-client/electron-builder.json`

## Web Client

Next.js and React provide the UI, API routes, chat views, project pages, settings, and Skills management.

Relevant paths:

- `loom-cc-client/src/app/`
- `loom-cc-client/src/components/`
- `loom-cc-client/src/modules/`

## Shared Runtime

Shared code handles model providers, memory, Skills, scheduling, database access, and runtime integration.

Relevant paths:

- `loom-cc-client/src/shared/runtime/`
- `loom-cc-client/src/shared/memory/`
- `loom-cc-client/src/shared/skills/`
- `loom-cc-client/src/shared/db/`

## Built-in Skills

Built-in Skills live in the repository root under `skills/`. The app reads this catalog and merges install state from user/project directories.
