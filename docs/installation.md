# Installation

## Requirements

- Node.js 22+
- pnpm 10+
- Git

## From Source

```bash
git clone https://github.com/apollo8166/loom.git
cd loom/loom-cc-client
pnpm install
pnpm dev
```

The development command starts Next.js and Electron together.

Optional environment file:

```bash
cp .env.example .env.local
```

Most provider settings can also be configured in the app UI.

## Build

```bash
cd loom-cc-client
pnpm build
```

Platform package commands:

```bash
pnpm build:mac:current
pnpm build:mac:arm64
pnpm build:mac:x64
pnpm build:win
```

For a full macOS local release:

```bash
pnpm build
pnpm build:mac:arm64
pnpm build:mac:x64
```

Generated macOS artifacts are written to `loom-cc-client/release/`.

## macOS Gatekeeper

Local builds are unsigned unless you configure a Developer ID certificate and notarization credentials. Unsigned builds may require the user to approve the app manually in macOS Security settings.

## Model Provider Configuration

Configure model provider credentials in the app settings. Do not commit local `.env` files or provider tokens.
