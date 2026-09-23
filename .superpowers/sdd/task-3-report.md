# Task 3 Report

## Scope

Implemented only per-target state, manifest, and lock primitives:

- `scripts/manage-skills/lib/state.mjs`
- `scripts/manage-skills/tests/state.test.mjs`
- `.superpowers/sdd/task-3-report.md`

No links, plan, transaction, interactive, or CLI implementation was added.

## TDD evidence

1. Added the TOCTOU regression test before implementation and ran the focused suite red (1 failure).
2. Implemented atomic quarantine release, then re-ran the focused suite green.
3. Re-ran the catalog/targets regression suite and `git diff --check`.

## Covered behavior

- DSH state roots from explicit `DSH_HOME` and `$HOME/.dsh` fallback.
- Codex/Claude/custom state roots from `XDG_STATE_HOME` and `$HOME/.local/state/manage-skills` fallback.
- Manifests stored in a per-target state directory outside target skill roots.
- Strict version-1 manifest validation: canonical target/catalog identities, integer device/inode values, optional typed Git metadata, and complete link/source identity entries.
- Missing, malformed, target-mismatch, and catalog-mismatch manifest errors.
- Stable `manifestIdentity` hashing over canonical identity fields.
- Atomic same-directory temporary-file write followed by rename, with temporary cleanup.
- Manifest fields for target/catalog identity, Git metadata when supplied, link name, source-relative path, source identity, relative target, and creation time.
- Exclusive per-target directory locks with owner/token/time metadata.
- Second acquisition failure with validated owner/time details; corrupt or missing metadata is diagnosed without undefined fields.
- Lock release atomically renames the lock directory to a unique quarantine, revalidates the token there, removes only a matching quarantine, and reports `LOCK_OWNERSHIP_CHANGED` without deleting a replacement lock.
- Idempotent release and no automatic stale-lock stealing; stale locks require explicit removal.
- State-root write/lock failures reported as unavailable errors where applicable.

## Verification

```text
node --test scripts/manage-skills/tests/state.test.mjs
13 tests passed, 0 failed

node --test scripts/manage-skills/tests/state.test.mjs scripts/manage-skills/tests/catalog.test.mjs scripts/manage-skills/tests/targets.test.mjs
31 tests passed, 0 failed

git diff --check
passed
```

## Considerations

- `loadManifest` reports a missing manifest with `MANIFEST_MISSING`; callers can treat that as read-only/plan-only state and must not infer ownership from link targets.
- Lock acquisition intentionally does not inspect lock age or reclaim stale locks. Explicit cleanup is required.
- Catalog identity comparison is performed when the caller supplies `targetIdentity.catalogIdentity` (or `.catalog`); this keeps the requested interface compatible with target-only callers while enabling mismatch protection.
- Git remote/commit values are persisted when present in the supplied catalog identity; this module does not invoke Git itself.

## Commit

Commit: `fix(state): make lock release TOCTOU-safe`

## Follow-up: Closed manifest schema

- `validateManifest` now rejects unknown top-level fields; version 1 permits only `version`, `target`, `catalog`, and `links`.
- Target, catalog, link, and `sourceIdentity` objects remain closed schemas; unknown nested identity/link fields are rejected rather than reserved for future metadata in v1.
- Added valid-JSON rejection cases for unknown top-level and nested identity/link fields.
- TDD evidence: the new suite failed before the validator change (unknown top-level field was accepted), then passed after implementation.

## Follow-up verification

```text
node --test scripts/manage-skills/tests/state.test.mjs scripts/manage-skills/tests/catalog.test.mjs scripts/manage-skills/tests/targets.test.mjs
31 tests passed, 0 failed

git diff --check
passed
```
