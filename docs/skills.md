# Skills

Skills are reusable instruction packages for Loom.

## Built-in Catalog

Built-in Skills are stored in:

```text
skills/
```

Each Skill package should include:

```text
skill-name/
├── SKILL.md
└── loom.skill.json
```

Optional resources:

```text
references/
scripts/
assets/
```

## SKILL.md

`SKILL.md` contains the instruction body. Keep it concise and focused on runtime behavior.

Recommended sections:

- Task
- When to use
- Inputs
- Outputs
- Workflow
- Quality standards
- Risks and boundaries
- Optional resources

## loom.skill.json

`loom.skill.json` powers the Skills menu and detail panel. It must be valid JSON.

Required fields:

- `displayName`
- `category`
- `stage`
- `tags`
- `inputTypes`
- `outputTypes`
- `riskLevel`
- `requires`
- `examples`
- `packageTree`

Minimal shape:

```json
{
  "schemaVersion": "1.0",
  "displayName": "Example Skill",
  "category": "General",
  "stage": "Ready",
  "tags": ["example"],
  "inputTypes": ["user request"],
  "outputTypes": ["answer"],
  "riskLevel": "low",
  "requires": {
    "network": false,
    "fileRead": false,
    "fileWrite": false,
    "shell": false,
    "mcp": []
  },
  "examples": ["Use Example Skill to ..."],
  "packageTree": [
    {
      "path": "SKILL.md",
      "type": "instruction",
      "description": "Skill instructions.",
      "risk": "none",
      "autoRun": false,
      "loadedWhen": "When this skill is selected."
    }
  ]
}
```

## Token Discipline

- Keep core instructions in `SKILL.md`.
- Move long domain materials to `references/`.
- Move deterministic repeated operations to `scripts/`.
- Do not create empty resource folders.

## Import Compatibility

Imported Skills should be validated before installation. A future import flow should reject malformed metadata, hidden executables, unsafe scripts, and packages whose declared permissions do not match their contents.
