# Task 8 Report

Task 8 is intentionally split into two independently reviewed deliverables:

1. **bamhub docs** in this `bamhub-ai-tools` worktree: the manage-skills README, repository README link, AGENTS guidance, and documentation contract tests.
2. **独立 maomao-deploy README** in the separate deployment repository: the DSH Pod operational README and its deployment-specific verification notes.

The separate deployment README was already committed in `maomao-deploy` as commit `16ae432`. That commit includes the PVC mappings, manual checkout prerequisite, dynamic path discovery, `kubectl` context/container usage, image tag authority, and the DSH provider gate. 当前 worktree 不修改该仓库; no files under `maomao-deploy` were changed here.

## Bamhub deliverables

- `scripts/manage-skills/README.md`
  - Documents the catalog precedence order (`--catalog`, `MANAGE_SKILLS_CATALOG`, repository-derived catalog, interactive input) as an ordered contract.
  - Documents manifest ownership, protection of unmanaged/foreign links, and the global-only target guard.
  - Documents DSH, Codex, and Claude Code global runtime roots plus `--disable-all` semantics.
  - Documents manual Pod checkout under `/work`, dynamic catalog paths, and the absence of automatic clone/pull/fetch/checkout/reset or sync/update behavior.
  - Documents the DSH Web `skill-filesystem`/`tool-skill` provider gate and runtime verification boundary.
  - Includes status, plan, apply, and disable-all command examples.
- `README.md`
  - Provides a valid Markdown link to the readable implemented tool README.
  - Summarizes global-only scope, manifest ownership protection, manual Pod checkout, and the DSH provider-gate caveat.
- `AGENTS.md`
  - Keeps the six skill ownership categories explicit and ordered.
  - Documents the exact ESM feature-test command `node --test scripts/manage-skills/tests/*.test.mjs`.
- `scripts/manage-skills/tests/cli.test.mjs`
  - Asserts the real ordered catalog precedence structure rather than only checking phrases.
  - Checks global-only/protection/disable-all/provider-gate/no-auto-sync contracts and command examples.
  - Resolves and reads the root README Markdown link target.
  - Checks the AGENTS six-category ordering and fenced test command.
  - Guards this report's split-repository scope and deployment commit record.

## Verification

- RED phase: the strengthened focused tests failed on the missing Task 8 scope/commit report contract before the report update.
- Focused: `node --test scripts/manage-skills/tests/cli.test.mjs` — 20 passed.
- Full manage-skills suite: `node --test scripts/manage-skills/tests/*.test.mjs` — 110 passed.
- Diff: `git diff --check` — passed.

## Scope boundary

The deployment README in `maomao-deploy` remains an independently committed deliverable at `16ae432`. This bamhub worktree does not modify that repository and does not implement code or deployment tasks beyond Task 8 documentation contracts.
