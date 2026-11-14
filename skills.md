# Project skill guide

## Reproducible comparison

| Agent | Skill file | Invocation |
|---|---|---|
| Codex | [.agents/skills/reproducible-comparison/SKILL.md](.agents/skills/reproducible-comparison/SKILL.md) | `$reproducible-comparison` |
| Claude Code | [.claude/skills/reproducible-comparison/SKILL.md](.claude/skills/reproducible-comparison/SKILL.md) | `/reproducible-comparison` |

Use this skill for SPHEREx observation selection, cutout preparation, image registration/rendering, comparison identity and persistence, exact replay, or migration of retained evidence. Use the invocation for your agent where project skill discovery is supported; otherwise read the corresponding file directly. Both skill files contain identical instructions; update both when changing the shared policy.

The skill covers explicit configuration, provenance, deterministic identity, immutable artifacts, and verification before scientific comparison.

The archive owner uses it for frame preparation and durable manifests. Viewer and findings owners use the relevant parts when consuming or restoring evidence. Ordinary layout, discussion styling, and documentation edits do not require running an archive experiment.

`AGENTS.md` holds shared working and evidence-reporting rules. `CLAUDE.md` imports those rules and adds Claude Code entry points and collaboration guidance. `spherex-project-brief.md` and `spherex-agent-handoffs.md` remain the product and implementation contract. This guide does not introduce additional features or replace that contract.
