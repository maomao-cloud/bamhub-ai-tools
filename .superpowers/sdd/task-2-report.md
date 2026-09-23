# Task 2 Report

## Scope

Implemented only runtime detection and target safety:

- `scripts/manage-skills/lib/targets.mjs`
- `scripts/manage-skills/tests/targets.test.mjs`
- `.superpowers/sdd/task-2-report.md`

No state, links, plan, transaction, or CLI implementation was added.

## TDD evidence

1. Added the reviewer regression tests first: existing safe global directories, Git worktree `.git` directory/file markers, and `all` filtering.
2. Ran `node --test scripts/manage-skills/tests/targets.test.mjs` before implementation; 6 passed and 2 failed (existing target was incorrectly rejected; `all` included non-standard IDs).
3. Implemented the minimum target validation and selector guards.
4. Re-ran the focused tests and the catalog-plus-target focused suite; all tests passed.

## Covered behavior

- DSH target resolution from `DSH_HOME` to `<DSH_HOME>/skills`.
- DSH fallback candidate at `$HOME/.dsh/skills` when `DSH_HOME` is unset.
- Codex `$HOME/.agents/skills` and Claude Code `$HOME/.claude/skills` detection.
- Missing standard roots remain selectable and detection never creates directories.
- Existing directories are reported as existing and accepted when safe; non-directory runtime paths are not selectable.
- Absolute normalized target validation with typed errors and exact rejection reasons.
- Catalog/target equality and ancestor/descendant overlap rejection.
- Git worktree target rejection, including `.git` directory/file markers.
- Project `.agents/skills` and `.claude/skills` rejection.
- Symlink target/ancestor rejection and missing-parent rejection.
- Missing final directory acceptance under a safe existing global parent, without creating it.
- Target identity fields (`path`, `realPath`, `dev`, `ino`, `existed`, `stateRoot`).
- Custom target selection, repeated runtime selector de-duplication, `all` expansion limited to selectable standard runtime IDs (`dsh`, `codex`, `claude`), unknown/unselectable runtime rejection, and custom/runtime selector conflict rejection.

## Verification

```text
node --test scripts/manage-skills/tests/targets.test.mjs
8 tests passed, 0 failed

node --test scripts/manage-skills/tests/catalog.test.mjs scripts/manage-skills/tests/targets.test.mjs
18 tests passed, 0 failed

git diff --check
passed
```

## Considerations

- This task only validates target boundaries and selects runtime targets. It intentionally does not create target directories, persist state, manage manifests, create links, or perform runtime/provider discovery.
- DSH fallback is surfaced as a selectable candidate but remains distinguishable from an explicit `DSH_HOME` target through its `source` value.
- Strict symlink-ancestor rejection means callers should pass canonicalized safe roots when the host platform exposes system path aliases (the tests canonicalize temporary roots for this reason).

## Commit

`feat: guard global skill targets`

The report is intentionally kept under `.superpowers/`, which is ignored by the repository.
