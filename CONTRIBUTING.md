# Contributing to Loom

Thanks for helping improve Loom.

## Development Setup

```bash
cd loom-cc-client
pnpm install
pnpm dev
```

Before opening a pull request:

```bash
pnpm typecheck
pnpm build
```

## Branches

Use short, descriptive branch names:

- `feat/skill-installer`
- `fix/chat-confirm-ui`
- `docs/open-source-readme`

## Commit Style

Prefer concise conventional commits:

- `feat: add skill builder discovery mode`
- `fix: prevent code block highlight loop`
- `docs: add release checklist`

## Pull Requests

Each PR should include:

- What changed.
- Why it changed.
- How it was tested.
- Screenshots or recordings for UI changes.
- Notes for migration or compatibility, if any.

## Skills

When changing built-in Skills under `skills/`:

- Keep `SKILL.md` concise.
- Put long references in `references/`.
- Put deterministic reusable scripts in `scripts/`.
- Keep `loom.skill.json` valid JSON.
- Avoid adding empty directories or generated artifacts.

## Security and Privacy

Do not commit:

- API keys or tokens.
- Local user data.
- Workspace databases.
- Private logs.
- Generated app bundles.
