# Development

## Common Commands

```bash
cd loom-cc-client
pnpm install
pnpm dev
pnpm typecheck
pnpm build
```

Optional local configuration:

```bash
cp .env.example .env.local
```

Use `.env.local` only for local development. Do not commit credentials.

## Project Areas

- `src/app/`: Next.js app routes and API routes.
- `src/components/`: UI components.
- `src/modules/`: client-side feature hooks.
- `src/shared/`: shared runtime, memory, skills, config, and database code.
- `electron/`: Electron main and preload code.
- `skills/`: built-in Loom Skills, outside the client folder.

## Local Data

Loom creates local app data and workspaces during development. Keep local data, databases, logs, and secrets out of Git.

## Checks

Run at least:

```bash
pnpm typecheck
```

For release preparation, also run:

```bash
pnpm build
```

For macOS package verification:

```bash
pnpm build:mac:arm64
pnpm build:mac:x64
```
