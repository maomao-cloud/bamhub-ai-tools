# Task 5 report

Implemented the journaled transaction layer in `scripts/manage-skills/lib/transaction.mjs` and focused tests in `scripts/manage-skills/tests/transaction.test.mjs`.

## Covered behavior

- Dry-run performs no filesystem mutation.
- All target locks are acquired before mutations.
- Target/source/link identities are rechecked immediately before mutation.
- Link creation uses non-overwriting symlink creation.
- Manifest-owned removals are renamed into same-filesystem quarantine.
- Journals are written before mutation and updated after each mutation.
- Manifests use the existing atomic state writer.
- Post-apply verification and per-target reports are returned.
- Failed transactions retain journal and quarantine for recovery.
- Recovery safely restores quarantined entries and rolls back journaled creates.
- Multiple targets return independent results.

## Verification

- `node --test scripts/manage-skills/tests/transaction.test.mjs` — passed.
- `node --test scripts/manage-skills/tests/*.test.mjs` — passed (58 tests).
- `git diff --check` — passed.

Interactive and CLI code were not implemented.

## Reviewer follow-up

- Rechecks target, catalog (including git metadata), source, and link lstat identity before every mutation; compares current manifest ownership and the immutable plan fingerprint instead of self-comparing source data.
- Journal states are `prepared`, `mutating`, `manifest-written`, `verifying`, `committed`, and `failed`; only `committed` is terminal. The prior manifest is journaled and restored on failed manifest/verification paths.
- Recovery validates journal schema/path/state, preserves journals and quarantine on errors or occupied originals, and reports target-specific conflicts.
- Post-verification accepts only manifest-owned `managed-valid` links. Batch apply acquires every lock before mutation and reports lock failures per target.
- Added regression coverage for catalog identity, manifest-owned post-verification, occupied quarantine, malformed journals, target-specific lock failure, and durable journal states.

## Verification

- `node --test scripts/manage-skills/tests/transaction.test.mjs` — passed (18 tests).
- `node --test scripts/manage-skills/tests/*.test.mjs` — passed (67 tests).
- `git diff --check` — passed.

## Commit

`fix: harden skill link transactions`

## Task 5 review-gap closure

- Added a final pre-manifest-write recheck of target/catalog/source/link identities, the full current manifest fingerprint, and a recomputed current plan fingerprint; manifest writes are refused on any change.
- Plan fingerprints now ignore the stored `plan.fingerprint` field and hash current plan content. Whole-manifest changes are detected even when the removal entry itself is unchanged.
- Journal recovery now strictly validates schema/version/state/operation fields and confines journal, target, catalog, source, link, original, and quarantine paths to their declared absolute boundaries. Pending operations are never acted on.
- Apply precheck and manifest-read failures are returned as target-local failed reports, so other targets continue independently.
- Added regression tests for external manifest mutation, final identity changes, plan fingerprint/content tampering, malformed and out-of-bound journals, inconsistent quarantine paths, and target-local precheck failures.

## Final verification

- `node --test scripts/manage-skills/tests/transaction.test.mjs` — passed (23 tests).
- `node --test scripts/manage-skills/tests/*.test.mjs` — passed (72 tests).
- `git diff --check` — passed.

## Final review-gap closure (current TDD round)

- Create snapshots now immediately `lstat` the new symlink and save `dev`, `ino`, `type`, and exact link text; every later create check compares all four values. Added a regression for replacing a same-target symlink with a different inode.
- Failure reports retain allowlisted, recursively JSON-safe details such as mismatches, paths, identities, recovery errors, conflicts, and lock diagnostics; secret-like fields and error internals are excluded. Added post-verification structured-mismatch coverage.
- Closed journal validation rejects unknown top-level and operation fields; requires plan fingerprint and old-manifest schema; validates complete target/catalog identities and create/remove operation fields and types.

### TDD evidence for this round

- Red: after adding the new tests, `node --test scripts/manage-skills/tests/transaction.test.mjs` reported 23 passing and 3 failing tests: same-target symlink replacement was not detected, structured mismatches were absent from the failure result, and unknown journal fields were accepted.
- Green: after implementation, `node --test scripts/manage-skills/tests/transaction.test.mjs` passed 26/26 tests.
- Full verification: `node --test scripts/manage-skills/tests/*.test.mjs` passed 75/75 tests; `git diff --check` passed.
