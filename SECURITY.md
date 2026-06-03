# Security Policy

## Supported Versions

Loom is currently in early development. Security fixes target the latest `main` branch and the latest release tag.

## Reporting a Vulnerability

Please do not open a public issue for sensitive security reports.

Report privately by contacting the project maintainers through GitHub, or by opening a minimal private advisory if available.

Please include:

- Affected version or commit.
- Operating system.
- Reproduction steps.
- Impact assessment.
- Whether credentials, files, shell execution, or network access are involved.

## Scope

Security-sensitive areas include:

- Permission and confirmation flows.
- Skill installation and imported Skill package handling.
- File read/write boundaries.
- Shell execution.
- Model provider credentials.
- Local memory and workspace data.

## Disclosure

We aim to acknowledge reports promptly and coordinate fixes before public disclosure.
