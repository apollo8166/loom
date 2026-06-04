# Release Process

Loom uses semantic versioning.

## Version Types

- Patch: bug fixes, for example `0.1.1`.
- Minor: features, for example `0.2.0`.
- Major: breaking changes, for example `1.0.0`.

## Checklist

1. Confirm the working tree only contains intended changes.
2. Update `loom-cc-client/package.json` version.
3. Update `CHANGELOG.md`.
4. Add or update `docs/releases/vX.Y.Z.md`.
5. Run checks:

```bash
cd loom-cc-client
pnpm typecheck
pnpm build
```

6. Build desktop artifacts if this release includes downloadable packages:

```bash
pnpm build:mac:arm64
pnpm build:mac:x64
```

7. Commit:

```bash
git add .
git commit -m "chore: prepare open source release"
```

8. Tag:

```bash
git tag v0.1.0
git push github main
git push github v0.1.0
```

9. Create a GitHub Release and paste the matching release note.

```bash
gh release create v0.1.0 \
  "loom-cc-client/release/loom-cc-v0.1.0-mac-arm64.dmg" \
  "loom-cc-client/release/loom-cc-v0.1.0-mac-arm64.dmg.blockmap" \
  "loom-cc-client/release/loom-cc-v0.1.0-mac-x64.dmg" \
  "loom-cc-client/release/loom-cc-v0.1.0-mac-x64.dmg.blockmap" \
  --repo apollo8166/loom \
  --title "Loom v0.1.0" \
  --notes-file docs/releases/v0.1.0.md
```

## Build Artifacts

Attach desktop build artifacts only after verifying they do not contain secrets, local databases, provider credentials, or user settings.

Current known macOS packaging caveats:

- Unsigned and unnotarized local builds trigger Gatekeeper warnings.
- macOS packaging commands prepare and bundle `build/node-runtime/` automatically for the target architecture.
- macOS packaging commands prepare and bundle `build/claude-cli/` automatically for the target architecture.
