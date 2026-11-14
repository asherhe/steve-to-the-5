# SPHEREx instructions for Claude Code

Use the shared repository instructions and skill guide:

@AGENTS.md
@skills.md

## Starting work

Read `spherex-project-brief.md` and `spherex-agent-handoffs.md` for scope, interfaces,
and file ownership. Inspect current Git status and relevant implementation before
making changes; existing untracked files may be another contributor's work.

For the archive slice, read `services/archive/README.md` and the current verification
records in `fixtures/archive/`. Treat their results as historical evidence until
rerun. Keep saved real examples, synthetic fixtures, live requests, and deployed
checks distinct.

## Working alongside Codex and teammates

- Follow the same ownership boundaries and shared contracts as every other agent.
  Coordinate overlapping file edits before making them. Do not infer permission to
  change another owner's files from access to the same checkout.
- Preserve uncommitted and untracked work. Do not reset, clean, replace, or stage
  another contributor's changes as part of your task.
- Use separate worktrees for agreed concurrent implementation. Do not assume a new
  worktree contains uncommitted work from the current checkout.
- Hand off the changed paths, interface changes, commands actually run, results,
  and remaining gaps. Commit, push, merge, or deploy only within the current task's
  authorization.

## Reusable skill

For observation selection, image preparation, saved evidence, or replay, use
`/reproducible-comparison`, provided by
`.claude/skills/reproducible-comparison/SKILL.md`. It mirrors the shared skill in
`.agents/skills/reproducible-comparison/SKILL.md`; keep their contents identical.

## Archive commands

Run from the repository root using the project-local environment:

```sh
services/archive/.venv/bin/python -m pytest services/archive/tests -q
services/archive/.venv/bin/python -m services.archive --synthetic serve
```

For environment setup, live archive requests, and offline real-example replay, use
`services/archive/README.md`. Do not claim these commands have passed merely because
they are listed here.
