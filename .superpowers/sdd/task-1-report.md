# Task 1 Report

## Scope

Implemented only catalog resolution, recursive skill discovery, and structured selector resolution:

- `scripts/manage-skills/lib/catalog.mjs`
- `scripts/manage-skills/tests/catalog.test.mjs`

No target, state, transaction, or CLI code was added.

## TDD evidence

1. Wrote the focused catalog tests first.
2. Ran the focused test command before implementation; it failed with `ERR_MODULE_NOT_FOUND` because `catalog.mjs` did not exist.
3. Implemented the minimum catalog module.
4. Re-ran the focused tests; all 10 subtests passed.

## Covered behavior

- Catalog precedence: explicit path, `MANAGE_SKILLS_CATALOG`, script-relative `skills/`, and interactive path.
- Explicit and environment invalid paths fail without fallback or path creation.
- Recursive `SKILL.md` discovery.
- Strict `---` frontmatter with top-level single-line `name` and `description` values, including matching quote support.
- Invalid names, missing fields, malformed/multiline frontmatter, duplicate names, and symlinked `SKILL.md` diagnostics.
- Canonical source identity, explicit invalid reports for symlink source directories, and bundle resource symlink escape protection including nested symlink directories.
- Structured selectors by unique name or exact `sourceRelative` (without the undocumented `source` alias), kebab-case `linkName` validation, per-target link-name collision errors, and rejection of an explicitly empty `sourceRelative`.
- Cycle-safe bundle resource scanning for an internal symlink directory cycle and two aliases targeting the same directory, with one expected escape diagnostic and no duplicate traversal.

## Verification

```text
node --test scripts/manage-skills/tests/catalog.test.mjs
10 tests passed, 0 failed

git diff --check
passed
```

### Task 1 Minor TDD red/green evidence

Added regression coverage before the selector implementation change for:

- an actual internal symlink directory cycle with two aliases to the same directory, asserting bounded discovery, expected diagnostics, and no duplicate traversal;
- an explicitly present but empty `sourceRelative`, asserting it reports a source-relative selector error instead of falling back to `name`.

Red phase:

```text
node --test scripts/manage-skills/tests/catalog.test.mjs
10 tests, 8 passed, 2 failed
Failures: cycle test exposed the expected symlink diagnostics; empty sourceRelative incorrectly resolved by name.
```

Minimal implementation and green verification:

```text
node --test scripts/manage-skills/tests/catalog.test.mjs
10 tests passed, 0 failed

git diff --check
passed
```

## Commit

`623c462 feat: validate skill catalog entries`

The report is intentionally kept under `.superpowers/`, which is ignored by the repository.

## Reviewer Important fixes

Applied only Task 1 catalog/test changes; no target, state, transaction, or CLI work was added.

### TDD red phase

Updated `scripts/manage-skills/tests/catalog.test.mjs` before implementation to cover:

- `file:` URLs containing spaces and non-ASCII path segments, using `pathToFileURL` as a real URL input;
- canonical source identity through a symlinked catalog alias, asserting canonical path plus `dev`/`ino` equality;
- mismatched frontmatter quotes and matching quotes with trailing content;
- removal of the old `fileURLToPath` void workaround.

Command and result:

```text
node --test scripts/manage-skills/tests/catalog.test.mjs
9 tests, 6 passed, 3 failed
Failures: URL path remained percent-encoded; sourceIdentity had no canonical path; invalid quote forms were accepted.
```

### Minimal implementation and verification

- `resolveCatalog` now uses `fileURLToPath` for `scriptFile` file URLs.
- `sourceIdentity` now exposes `canonicalPath` together with the compatible `dev` and `ino` fields.
- Quoted frontmatter values must start and end with the same quote and contain no trailing content.

Commands and results:

```text
node --test scripts/manage-skills/tests/catalog.test.mjs
9 tests passed, 0 failed

git diff --check
passed
```

### Reviewer fix TDD red/green evidence

Added regression coverage before the reviewer-fix implementation for:

- source directories represented by symlink directories, including external and internal targets, which are reported invalid instead of silently skipped;
- external symlinks nested inside an internal bundle symlink directory, with cycle-safe and duplicate-safe traversal;
- rejection of the undocumented `selector.source` field in favor of `sourceRelative` only.

Red phase:

```text
node --test scripts/manage-skills/tests/catalog.test.mjs
9 tests, 6 passed, 3 failed
Failures: symlink source directories were silently traversed or ignored; nested external symlink was not detected; selector.source was accepted.
```

Green phase:

```text
node --test scripts/manage-skills/tests/catalog.test.mjs
9 tests passed, 0 failed

git diff --check
passed
```

## Real Pod probe follow-up

A real Pod catalog probe showed Bamhub skills use quoted scalar metadata plus unknown `keywords`, `categories`, and nested `examples`; the previous parser rejected this shape (and `description: >`/`>-`/`|` continuations). The catalog parser now accepts only the required safe subset, ignores unknown nested metadata, and retains delimiter, duplicate-field, name, and symlink/source safety validation.

The regression tests cover folded/literal descriptions and actual metadata structure before implementation (red), then pass with the minimal dependency-free parser.
