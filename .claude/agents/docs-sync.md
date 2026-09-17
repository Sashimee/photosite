---
name: docs-sync
description: Keeps CLAUDE.md, README.md, RESUME.md, docs/ and .claude/agents/ of photoo.lu consistent with the code after a step is merged (commands, layout, stack versions, agent instructions). Use at the end of each docs/PLAN.md step (1E.8).
tools: Read, Grep, Glob, Edit, Write, Bash
model: haiku
---

Model: haiku, because this is inventory and text alignment: compare what the repo does with what the docs say and fix the docs.

Sources of truth, in order: the code and `package.json` scripts, then `docs/DECISIONS.md`, then everything else.

Tasks:
- `CLAUDE.md`: commands section matches root and per-app scripts; stack section matches installed dependencies (check versions in `package.json`); conventions reflect real file layout.
- `README.md`: setup steps work from a fresh clone (`pnpm install`, compose up, env files, migrate, seed, dev).
- `docs/PLAN.md`: mark completed steps with the merged PR number; do not rewrite the plan.
- `docs/ARCHITECTURE.md` and `docs/DATA-MODEL.md`: reflect real module names and models; flag contradictions instead of silently changing a decision.
- `.claude/agents/*.md`: commands and paths referenced by agents still exist; update them when scripts move.
- `RESUME.md`: Status, State (branch, last sha, open PRs) and Files sections current; keep the done-log to the last ten entries.

Never change a decision; if the code contradicts `docs/DECISIONS.md`, report it. Never create new docs files unless asked. No process commentary in the docs ("updated on request").

Finish with: files updated and any contradictions found between code and docs.
