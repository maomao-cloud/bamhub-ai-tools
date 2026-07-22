# Caveman Upstream Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mirror the seven upstream Caveman skills into `skills/caveman/` and register their source for repeatable updates.

**Architecture:** `skills/sources.json` will describe the Caveman repository and map its `skills/` root to the new top-level managed target `skills/caveman/`. The existing synchronizer will fetch, validate, atomically copy that root, write its generated README, and replace the zero initial commit with the exact accepted upstream commit.

**Tech Stack:** JSON source manifest, Node.js synchronizer, Git, Node built-in test runner.

## Global Constraints

- Target directory is `skills/caveman/`, parallel to `skills/superpowers/`.
- Import only the upstream `skills/` root; do not import plugins, hooks, commands, installers, agents, benchmarks, or repository metadata.
- Initialize `acceptedCommit` with 40 zeroes and allow the synchronizer to replace it with the commit actually applied.
- Run the source-specific check before and after applying; do not use `--force`.
- Do not modify the upstream skill contents during the mirror operation.

---

### Task 1: Register and mirror Caveman skills

**Files:**
- Modify: `skills/sources.json`
- Create: `skills/caveman/README.md` (generated)
- Create: `skills/caveman/{caveman,caveman-commit,caveman-compress,caveman-help,caveman-review,caveman-stats,cavecrew}/...` (mirrored)
- Test: `tests/project/sync-upstream-skills.test.mjs` (regression only; no behavior change required)

**Interfaces:**
- Consumes: `sync-skills.mjs` manifest source contract: `repository`, `ref`, `acceptedCommit`, `acceptedAt`, and `roots`.
- Produces: A `caveman` source selectable with `--source caveman`; a clean `skills/caveman/` mirror tracked by the generated README and accepted commit.

- [ ] **Step 1: Add the initial source declaration**

Add this object next to `superpowers` in `skills/sources.json`:

```json
"caveman": {
  "repository": "https://github.com/JuliusBrussee/caveman.git",
  "ref": "main",
  "acceptedCommit": "0000000000000000000000000000000000000000",
  "acceptedAt": "2026-07-22T00:00:00.000Z",
  "roots": [
    {
      "upstream": "skills",
      "target": "skills/caveman"
    }
  ]
}
```

- [ ] **Step 2: Validate the initial source without writing files**

Run: `node skills/project/sync-upstream-skills/scripts/sync-skills.mjs check --source caveman`

Expected: JSON reports `sources.caveman.status` as `update-available`, lists only `A skills/...` files, and leaves `skills/caveman/` absent.

- [ ] **Step 3: Apply the verified mirror**

Run: `node skills/project/sync-upstream-skills/scripts/sync-skills.mjs apply --source caveman`

Expected: JSON reports `sources.caveman.status` as `applied`; `skills/caveman/` contains the seven named skill directories and a generated `README.md`; the manifest records the exact upstream `targetCommit` and current synchronization time.

- [ ] **Step 4: Verify the accepted mirror is clean**

Run: `node skills/project/sync-upstream-skills/scripts/sync-skills.mjs check --source caveman`

Expected: JSON reports `sources.caveman.status` as `up-to-date`, with matching `currentCommit` and `targetCommit` and an empty `changedFiles` array.

- [ ] **Step 5: Run regression and content-scope checks**

Run: `node --test tests/project/*.test.mjs && test -f skills/caveman/caveman/SKILL.md && test -f skills/caveman/cavecrew/SKILL.md && test ! -e skills/caveman/.claude-plugin && test ! -e skills/caveman/hooks && test ! -e skills/caveman/commands`

Expected: All Node tests pass; the seven-skill mirror exists and no excluded plugin or integration directory appears below `skills/caveman/`.

- [ ] **Step 6: Commit the managed mirror**

```bash
git add skills/sources.json skills/caveman
git commit -m "feat(skills): add caveman upstream mirror"
```

Expected: One commit contains the source registration, generated guide, and complete managed skill collection.
