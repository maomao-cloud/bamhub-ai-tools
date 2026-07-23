# Managed README Content Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make upstream README metadata deterministic while preserving an AI-authored content block, remove Caveman's generated generic guide, and schedule upstream synchronization every day at 00:00 Asia/Shanghai.

**Architecture:** The sync script owns a delimited metadata block and an empty-by-default AI-content block. During an apply it validates and preserves the AI block, refreshes metadata, and permits a safe one-time migration from the previous fully generated README format. The project sync skill defines when an AI may populate the content block; GitHub Actions runs the unchanged `apply --all` workflow daily.

**Tech Stack:** Node.js ESM, Node built-in test runner, GitHub Actions YAML.

## Global Constraints

- Generated README metadata must contain only repository, ref, accepted commit, and accepted timestamp.
- Generated README content must have no generic skill descriptions, usage guide, or inferred operational guidance.
- AI-authored content must be delimited, preserved byte-for-byte by a scheduled apply, and may remain empty.
- An edited metadata block or malformed marker structure remains a dirty target and must not be overwritten without `--force`.
- Existing clean legacy generated READMEs migrate without `--force` and discard the obsolete generated guide.
- Scheduled sync runs daily at 00:00 Asia/Shanghai, represented by UTC cron `0 16 * * *`.

---

### Task 1: Test and implement the metadata/content README contract

**Files:**
- Modify: `tests/project/sync-upstream-skills.test.mjs`
- Modify: `skills/project/sync-upstream-skills/scripts/sync-skills.mjs`

**Interfaces:**
- Consumes: source manifest fields `repository`, `ref`, `acceptedCommit`, and `acceptedAt`; existing target `README.md`.
- Produces: a README with an integrity-checked metadata block and a preserved AI-content block.

- [ ] **Step 1: Add failing contract tests**

Add marker constants and tests that require:

```js
const METADATA_START = '<!-- bamhub-sync-metadata:start -->';
const METADATA_END = '<!-- bamhub-sync-metadata:end -->';
const CONTENT_START = '<!-- bamhub-sync-content:start -->';
const CONTENT_END = '<!-- bamhub-sync-content:end -->';
```

The tests must assert that a new README includes only the four metadata labels inside the metadata markers, contains an empty content block, and does not include `## 使用方法`, `## 适用场景`, `## 通用流程`, or `请阅读`. Add a fixture that inserts `## 真实说明\n\n只在这个块中保留。\n` between content markers, advances the upstream commit, applies normally, and asserts the exact text remains. Add a fixture that changes a metadata line and asserts `apply --source demo` rejects with `TARGET_DIRTY`. Replace the legacy README assertion with a test that applies a matching legacy generated README without `--force` and verifies its generic sections are removed.

- [ ] **Step 2: Run the focused test file to verify RED**

Run: `node --test tests/project/sync-upstream-skills.test.mjs`

Expected: the new README-contract assertions fail because the current generator produces generic sections and lacks the new marker blocks.

- [ ] **Step 3: Implement marker parsing, rendering, and legacy migration**

In `sync-skills.mjs`, replace source-specific description generation with these responsibilities:

```js
const METADATA_START = '<!-- bamhub-sync-metadata:start -->';
const METADATA_END = '<!-- bamhub-sync-metadata:end -->';
const CONTENT_START = '<!-- bamhub-sync-content:start -->';
const CONTENT_END = '<!-- bamhub-sync-content:end -->';
```

`buildReadme({ source, targetCommit, acceptedAt, content })` must render only the four metadata lines between metadata markers, followed by the content markers and the supplied content. `readManagedReadme(target)` must validate exactly one ordered pair of each marker, return the content substring, and reject any text outside the two managed blocks. During `applySource`, read and preserve the existing valid content before staging replacements. During `targetsMatchAccepted`, rebuild expected metadata using the preserved content so content edits are clean but metadata edits are dirty. Recognize only the exact prior deterministic README as a migratable legacy format, with empty preserved content; allow it to be replaced without `--force`.

- [ ] **Step 4: Run the focused test file to verify GREEN**

Run: `node --test tests/project/sync-upstream-skills.test.mjs`

Expected: all sync tests pass, including metadata validation, content preservation, dirty metadata rejection, and legacy migration.

### Task 2: Document AI ownership, set daily scheduling, and migrate managed READMEs

**Files:**
- Modify: `skills/project/sync-upstream-skills/SKILL.md`
- Modify: `.github/workflows/sync-skills.yml`
- Modify: `tests/skill-layout.test.mjs`
- Modify: `tests/project/sync-upstream-skills.test.mjs`
- Modify: `skills/caveman/README.md` (regenerated by the synchronizer)
- Modify: `skills/superpowers/README.md` (regenerated by the synchronizer)

**Interfaces:**
- Consumes: the README contract from Task 1.
- Produces: documented AI decision rules, a daily hosted apply, and the migrated Caveman README.

- [ ] **Step 1: Add failing workflow and repository assertions**

Update the workflow test to require:

```js
assert.match(workflow, /cron: '0 16 \* \* \*'/);
```

Update the committed Caveman and Superpowers README assertions to require the four metadata labels and both marker pairs, while asserting the obsolete generic headings and fallback phrase are absent.

- [ ] **Step 2: Run focused tests to verify RED**

Run: `node --test tests/skill-layout.test.mjs tests/project/sync-upstream-skills.test.mjs`

Expected: workflow and managed README assertions fail because the workflow is weekly and the existing guides still contain generic content.

- [ ] **Step 3: Write the decision-layer guidance and daily schedule**

In `sync-upstream-skills/SKILL.md`, state that an AI caller must first understand the user request, then may add only real user-requested content inside the AI-content markers; it must leave the content block empty when no such content exists and never edit metadata markers. State that the synchronizer preserves valid AI content during `apply`.

Replace the workflow schedule with:

```yaml
schedule:
  - cron: '0 16 * * *'
```

- [ ] **Step 4: Regenerate the Caveman README without force**

Run: `node skills/project/sync-upstream-skills/scripts/sync-skills.mjs apply --all`

Expected: the existing clean Caveman and Superpowers READMEs migrate to metadata plus empty AI-content blocks; each accepted commit remains unchanged because upstream content has not changed.

- [ ] **Step 5: Run full verification**

Run: `node skills/project/sync-upstream-skills/scripts/sync-skills.mjs check --all && node --test tests/**/*.test.js tests/**/*.test.mjs && git diff --check`

Expected: both sources report `up-to-date`; all tests pass; no whitespace errors.

- [ ] **Step 6: Commit**

```bash
git add skills/project/sync-upstream-skills/SKILL.md \
  skills/project/sync-upstream-skills/scripts/sync-skills.mjs \
  .github/workflows/sync-skills.yml tests/skill-layout.test.mjs \
  tests/project/sync-upstream-skills.test.mjs skills/caveman/README.md \\
  skills/superpowers/README.md
git commit -m "feat(sync): preserve managed readme content"
```

Expected: one focused commit contains the runtime behavior, docs, schedule, regression tests, and Caveman migration.
