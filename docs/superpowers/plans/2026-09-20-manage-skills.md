# manage-skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an interactive, cross-platform Node.js utility that lets users select skills from a user-confirmed catalog and manage relative symbolic links in global DSH, Codex, Claude Code, or custom skill directories.

**Architecture:** Keep the complete feature under `scripts/manage-skills/`. The catalog scanner discovers valid `SKILL.md` bundles and reports invalid or duplicate entries. The link layer classifies target entries, creates plans, and applies only safe changes. A runtime detector resolves DSH/Codex/Claude/custom target roots, while the CLI provides an interactive wizard and a non-interactive JSON-capable mode. The existing DSH PVC is reused through `$DSH_HOME/skills`; no Kubernetes runtime change is required.

**Tech Stack:** Node.js built-in ESM, `node:fs/promises`, `node:path`, `node:readline`, `node:os`, `node:test`, `node:assert/strict`, POSIX shell wrapper.

## Global Constraints

- Keep all feature files under `scripts/manage-skills/` in `bamhub-ai-tools`.
- Do not add npm dependencies or require a package manager.
- Default to an interactive wizard; never modify files before the final confirmation.
- Resolve catalog in this order: `--catalog`, `MANAGE_SKILLS_CATALOG`, script-relative `<repository-root>/skills`, interactive input.
- Never hard-code `/work/bamhub-ai-tools` in implementation logic.
- Manage global roots only: DSH `$DSH_HOME/skills`, Codex `$HOME/.agents/skills`, Claude `$HOME/.claude/skills`, or an explicit custom target.
- Use relative symbolic links calculated with `path.relative()`.
- Only links resolving inside the selected catalog are managed; regular files, regular directories, foreign links, and unknown broken links are protected.
- Never copy, edit, or delete source skill files.
- DSH uses the existing persistent `/opt/data/dsh/skills` path; do not add PVCs, mounts, `DSH_AGENTS_HOME`, initContainers, image content, or a DSH plugin.
- Use temporary directories for tests; never mutate real user skill directories in automated tests.
- Use repository style: ESM, two-space indentation, single quotes, semicolons, semantic names, and `node:test`.
- Do not claim Pod support until the real running Pod probe passes.

---

## File Map

### New files in `bamhub-ai-tools`

- `scripts/manage-skills/manage-skills`: executable POSIX wrapper that resolves its own directory and forwards arguments to Node.
- `scripts/manage-skills/manage-skills.mjs`: CLI entry, command parsing, interactive orchestration, JSON/error exit handling.
- `scripts/manage-skills/lib/catalog.mjs`: catalog discovery, frontmatter extraction, name validation, duplicate grouping, and source-boundary checks.
- `scripts/manage-skills/lib/links.mjs`: target entry classification, safe ownership detection, relative-link planning, application, and post-apply verification.
- `scripts/manage-skills/lib/runtimes.mjs`: DSH/Codex/Claude/custom target detection and target metadata.
- `scripts/manage-skills/lib/plan.mjs`: desired-state reconciliation for one target root and plan serialization.
- `scripts/manage-skills/lib/interactive.mjs`: Node-native TTY menus, cursor movement, multi-select, confirmation, and non-TTY behavior.
- `scripts/manage-skills/tests/catalog.test.mjs`: scanner and metadata tests.
- `scripts/manage-skills/tests/links.test.mjs`: link classification, safety, planning, and application tests.
- `scripts/manage-skills/tests/runtimes.test.mjs`: runtime detection tests.
- `scripts/manage-skills/tests/manage-skills.test.mjs`: CLI and interactive orchestration tests.
- `scripts/manage-skills/README.md`: usage, runtime locations, safety boundary, Pod operation, and troubleshooting.

### Modified files

- `docs/superpowers/plans/2026-09-20-manage-skills.md`: this plan only; implementation tasks must not alter the approved design spec.
- `home-k3s-pc/tools/ai-dsh/README.md`: add the final operational section after the tool is verified; no YAML change.

---

### Task 1: Create the feature skeleton and test harness

**Files:**
- Create: `scripts/manage-skills/manage-skills`
- Create: `scripts/manage-skills/manage-skills.mjs`
- Create: `scripts/manage-skills/lib/catalog.mjs`
- Create: `scripts/manage-skills/lib/links.mjs`
- Create: `scripts/manage-skills/lib/runtimes.mjs`
- Create: `scripts/manage-skills/lib/plan.mjs`
- Create: `scripts/manage-skills/lib/interactive.mjs`
- Create: `scripts/manage-skills/tests/catalog.test.mjs`
- Create: `scripts/manage-skills/tests/links.test.mjs`
- Create: `scripts/manage-skills/tests/runtimes.test.mjs`
- Create: `scripts/manage-skills/tests/manage-skills.test.mjs`

**Interfaces:**
- Every library is ESM and exports named functions; later tasks define the concrete signatures.
- `manage-skills.mjs` exports `runCli(argv, io)` so tests can invoke it without spawning a process.
- Tests create and remove temporary directories with `fs.mkdtemp` and `t.after`.

- [ ] **Step 1: Write the failing CLI smoke test**

Add a test that imports `runCli` and asserts an empty temporary catalog returns a structured result with `exitCode: 0`, `catalog`, and `targets` fields for `status`.

```js
const result = await runCli(['status', '--catalog', catalog, '--target', target, '--json'], { stdout, stderr });
assert.equal(result.exitCode, 0);
assert.equal(result.report.catalog.root, catalog);
assert.deepEqual(result.report.targets[0].entries, []);
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
node --test scripts/manage-skills/tests/manage-skills.test.mjs
```

Expected: FAIL because `runCli` and the feature files do not exist.

- [ ] **Step 3: Add the minimal module and wrapper skeleton**

Implement the exported `runCli` placeholder, a command validation error for unsupported commands, and the wrapper:

```bash
#!/usr/bin/env bash
set -euo pipefail
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
exec node "$script_dir/manage-skills.mjs" "$@"
```

Do not add business behavior in this task.

- [ ] **Step 4: Run the focused test and verify it passes**

Run the same command. Expected: PASS for the skeleton contract.

- [ ] **Step 5: Commit the skeleton**

```bash
git add scripts/manage-skills
git commit -m "feat: scaffold skill link manager"
```

### Task 2: Implement catalog discovery and validation

**Files:**
- Modify: `scripts/manage-skills/lib/catalog.mjs`
- Test: `scripts/manage-skills/tests/catalog.test.mjs`

**Interfaces:**
- `discoverCatalog({ catalogRoot }) -> Promise<{ root, skills, invalid, duplicates }>`.
- Each valid skill is `{ name, description, sourceDir, skillFile, relativeSource }`.
- Invalid entries are `{ path, reason }`.
- Duplicate groups are `{ name, candidates }`.
- `resolveCatalog({ explicitPath, env, scriptFile }) -> Promise<{ path, source } | { path: null, candidates }>`; it must not create a directory.
- `isValidSkillName(name) -> boolean`.

- [ ] **Step 1: Write failing catalog tests**

Cover: recursive `SKILL.md` discovery, required frontmatter, valid kebab-case names, invalid names, missing frontmatter, duplicate names, and script-relative fallback.

Use a fixture such as:

```text
catalog/
├── superpowers/brainstorming/SKILL.md
├── bamhub/architecture/playbook-design/SKILL.md
└── bad/Invalid_Name/SKILL.md
```

Assert that only valid entries are returned and duplicates are reported without choosing one.

- [ ] **Step 2: Run the tests and verify failure**

```bash
node --test scripts/manage-skills/tests/catalog.test.mjs
```

Expected: FAIL with missing exports or missing implementation.

- [ ] **Step 3: Implement scanner and frontmatter extraction**

Recursively traverse directories with `readdir({ withFileTypes: true })`, skip symlinked directories, locate direct `SKILL.md` files, read only the YAML frontmatter needed for `name` and `description`, and retain the source directory and catalog-relative path. Resolve the catalog root and reject a non-directory path.

Use path-boundary helpers for later ownership checks; do not use string prefix checks.

- [ ] **Step 4: Implement catalog resolution**

Resolve in exact order: explicit path, `MANAGE_SKILLS_CATALOG`, path derived from `scripts/manage-skills/manage-skills.mjs` by walking to the repository root and appending `skills`, then no candidate. Existing candidates are returned for interactive confirmation; no candidate is silently selected when the user must choose.

- [ ] **Step 5: Run focused tests and verify pass**

```bash
node --test scripts/manage-skills/tests/catalog.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/manage-skills/lib/catalog.mjs scripts/manage-skills/tests/catalog.test.mjs
git commit -m "feat: discover skill catalog entries"
```

### Task 3: Implement safe link classification and plan generation

**Files:**
- Modify: `scripts/manage-skills/lib/links.mjs`
- Modify: `scripts/manage-skills/lib/plan.mjs`
- Test: `scripts/manage-skills/tests/links.test.mjs`

**Interfaces:**
- `classifyEntry({ entryPath, catalogRoot }) -> Promise<EntryState>` where `EntryState.kind` is `managed-valid`, `managed-broken`, `foreign-symlink`, `regular-file`, `regular-directory`, or `unknown`.
- `scanTarget({ targetRoot, catalogRoot }) -> Promise<EntryState[]>`.
- `buildPlan({ targetRoot, catalogRoot, skills, enabledNames, pruneBroken }) -> Promise<Plan>`.
- `Plan` is `{ targetRoot, create, remove, keep, conflicts, protected }`.
- `createLinkPlan({ linkPath, sourceDir }) -> { linkPath, sourceDir, relativeTarget }`.

- [ ] **Step 1: Write failing state-classification tests**

Construct temporary catalog, target, and outside directories. Test:

```text
valid link       -> catalog skill directory
broken link      -> missing path under catalog
foreign link     -> outside directory
regular file
regular directory
catalog path prefix collision: skills-evil
```

Assert foreign links, files, and directories are protected.

- [ ] **Step 2: Run tests and verify failure**

```bash
node --test scripts/manage-skills/tests/links.test.mjs
```

Expected: FAIL.

- [ ] **Step 3: Implement path-boundary and link classification**

Use `lstat` so broken links are observable. For valid links use `realpath`; for broken links resolve `readlink` relative to the link parent and normalize lexically. Accept only targets that are equal to the catalog root or descendants with a path-segment boundary. Reject catalog-contained symlinks whose real target escapes the catalog.

- [ ] **Step 4: Write failing plan tests**

Test that an enabled selection creates missing links, preserves an existing correct link, removes selected managed links, leaves conflicts protected, and does not remove broken links unless `pruneBroken` is true.

- [ ] **Step 5: Implement plan generation**

Map selected catalog skills by runtime name. Refuse ambiguous duplicate names unless a caller supplies an explicit source identity and optional link alias. Calculate every new target with `path.relative(path.dirname(linkPath), sourceDir)`.

- [ ] **Step 6: Run focused tests and verify pass**

```bash
node --test scripts/manage-skills/tests/links.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/manage-skills/lib/links.mjs scripts/manage-skills/lib/plan.mjs scripts/manage-skills/tests/links.test.mjs
git commit -m "feat: plan safe skill symlink changes"
```

### Task 4: Implement link application and post-apply verification

**Files:**
- Modify: `scripts/manage-skills/lib/links.mjs`
- Modify: `scripts/manage-skills/lib/plan.mjs`
- Test: `scripts/manage-skills/tests/links.test.mjs`

**Interfaces:**
- `applyPlan(plan, { pruneBroken, dryRun }) -> Promise<{ applied, skipped, failed }>`.
- `verifyPlan(plan) -> Promise<{ ok, created, removed, mismatches }>`.

- [ ] **Step 1: Write failing application tests**

Assert that applying a create plan makes a symbolic link with the expected relative target, applying a remove plan deletes only the link itself, `dryRun` makes no changes, and an entity conflict is reported without being overwritten.

- [ ] **Step 2: Run tests and verify failure**

```bash
node --test scripts/manage-skills/tests/links.test.mjs
```

Expected: FAIL.

- [ ] **Step 3: Implement safe application**

Create the target root only after the caller confirms the plan. Use `symlink` for creation and `unlink` for removal. Before each mutation, re-run `lstat` and verify the entry still matches the planned state. Never call recursive removal. Collect per-item errors instead of hiding them.

- [ ] **Step 4: Implement post-apply verification**

Reclassify every planned create/remove entry, verify target files contain `SKILL.md`, and return mismatches without claiming success when verification fails.

- [ ] **Step 5: Run focused tests and verify pass**

```bash
node --test scripts/manage-skills/tests/links.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/manage-skills/lib/links.mjs scripts/manage-skills/lib/plan.mjs scripts/manage-skills/tests/links.test.mjs
git commit -m "feat: apply and verify skill symlinks"
```

### Task 5: Implement runtime detection

**Files:**
- Modify: `scripts/manage-skills/lib/runtimes.mjs`
- Test: `scripts/manage-skills/tests/runtimes.test.mjs`

**Interfaces:**
- `detectRuntimes({ env, home, fs }) -> Promise<RuntimeTarget[]>`.
- A runtime target is `{ id, label, path, source, exists, selectable }`.
- `resolveTarget({ runtimeId, customPath, env, home }) -> string`.

- [ ] **Step 1: Write failing runtime tests**

Use a temporary home and environment to assert:

```text
DSH_HOME=/tmp/dsh       -> /tmp/dsh/skills
HOME=/tmp/home          -> /tmp/home/.agents/skills
HOME=/tmp/home          -> /tmp/home/.claude/skills
custom path             -> exact user path
```

Assert that missing standard directories are selectable but not auto-created and that DSH takes its path from `DSH_HOME`.

- [ ] **Step 2: Run tests and verify failure**

```bash
node --test scripts/manage-skills/tests/runtimes.test.mjs
```

Expected: FAIL.

- [ ] **Step 3: Implement runtime detection**

Return DSH, Codex, and Claude candidates with human-readable source metadata. Do not require directories to exist for candidate display, but let the interactive layer decide whether to select them. Reject empty custom paths and normalize absolute paths.

- [ ] **Step 4: Run focused tests and verify pass**

```bash
node --test scripts/manage-skills/tests/runtimes.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/manage-skills/lib/runtimes.mjs scripts/manage-skills/tests/runtimes.test.mjs
git commit -m "feat: detect global skill runtimes"
```

### Task 6: Implement the native interactive wizard

**Files:**
- Modify: `scripts/manage-skills/lib/interactive.mjs`
- Test: `scripts/manage-skills/tests/manage-skills.test.mjs`

**Interfaces:**
- `runInteractive({ catalogResolver, runtimeDetector, io }) -> Promise<InteractiveSelection | { cancelled: true }>`.
- Interactive selection returns `{ catalogRoot, targets, enabledSkills, pruneBroken }`.
- `confirmPlan(plan, io) -> Promise<boolean>`.

- [ ] **Step 1: Write failing orchestration tests**

Feed simulated input to cover: catalog confirmation, runtime selection, multi-select skill selection, cancellation, final rejection, and final approval. Assert no filesystem mutation occurs before approval.

- [ ] **Step 2: Run tests and verify failure**

```bash
node --test scripts/manage-skills/tests/manage-skills.test.mjs
```

Expected: FAIL.

- [ ] **Step 3: Implement TTY menu primitives**

Use `readline` and raw stdin only when `stdin.isTTY && stdout.isTTY`. Support arrow movement, Space, `a`, `n`, Enter, Escape, and Ctrl-C. Render status markers and source paths. Keep all filesystem changes outside this module.

- [ ] **Step 4: Implement wizard stages**

Run in order: environment scan, catalog confirmation/input, catalog scan report, runtime multi-select, target state scan, final skill multi-select, plan preview, confirmation. Existing valid managed links are initially selected; conflicts and protected entries are visible but not selectable.

- [ ] **Step 5: Handle non-TTY behavior**

Return a structured error instructing callers to use parameter mode. Do not fall back to guessed defaults or mutate files.

- [ ] **Step 6: Run focused tests and verify pass**

```bash
node --test scripts/manage-skills/tests/manage-skills.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/manage-skills/lib/interactive.mjs scripts/manage-skills/tests/manage-skills.test.mjs
git commit -m "feat: add interactive skill selection"
```

### Task 7: Complete CLI commands and JSON output

**Files:**
- Modify: `scripts/manage-skills/manage-skills.mjs`
- Modify: `scripts/manage-skills/tests/manage-skills.test.mjs`
- Modify: `scripts/manage-skills/manage-skills`

**Interfaces:**
- Commands: default interactive mode, `status`, `plan`, `apply`.
- Options: `--catalog`, `--target`, `--runtime`, `--enable`, `--manifest`, `--json`, `--non-interactive`, `--yes`, `--prune-broken`, `--dry-run`.
- Exit code `0` for successful verified work, `1` for operational failure or verification mismatch, `2` for invalid arguments.

- [ ] **Step 1: Write failing command tests**

Test `status --json`, `plan`, `apply --yes`, invalid command, missing catalog, non-interactive without `--yes`, and `--runtime dsh|codex|claude|custom` target resolution. Assert JSON contains catalog, targets, entries, and plan arrays without human-only decoration.

- [ ] **Step 2: Run tests and verify failure**

```bash
node --test scripts/manage-skills/tests/manage-skills.test.mjs
```

Expected: FAIL.

- [ ] **Step 3: Implement command parsing and orchestration**

Keep parsing dependency-free. Resolve catalog, discover skills, resolve targets, build one plan per target, and apply only after confirmation. For `all`, use only targets explicitly selected or detected and confirmed; never invent missing roots. `--enable` accepts comma-separated runtime names, while `--manifest` reads one non-empty name per line and rejects unknown names.

- [ ] **Step 4: Implement structured output and errors**

Human mode prints scan, plan, execution, and verification summaries. JSON mode prints one object and sends diagnostics to stderr. Do not print secrets or full environment values beyond relevant paths.

- [ ] **Step 5: Run focused tests and verify pass**

```bash
node --test scripts/manage-skills/tests/manage-skills.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Check executable entry**

Run:

```bash
chmod +x scripts/manage-skills/manage-skills
scripts/manage-skills/manage-skills --help
```

Expected: usage output and exit code `0`.

- [ ] **Step 7: Commit**

```bash
git add scripts/manage-skills/manage-skills scripts/manage-skills/manage-skills.mjs scripts/manage-skills/tests/manage-skills.test.mjs
git commit -m "feat: expose skill link management CLI"
```

### Task 8: Add operational documentation

**Files:**
- Create: `scripts/manage-skills/README.md` in `bamhub-ai-tools`
- Modify: `home-k3s-pc/tools/ai-dsh/README.md` in `maomao-deploy`

**Interfaces:**
- Documentation must describe the interactive default, catalog selection order, global runtime roots, safety rules, Pod path, persistence, and non-interactive examples.
- The tool README is committed in `bamhub-ai-tools`; the deployment README is committed separately in `maomao-deploy`.

- [ ] **Step 1: Write documentation checks**

Add assertions in `scripts/manage-skills/tests/manage-skills.test.mjs` that the README contains `DSH_HOME/skills`, `MANAGE_SKILLS_CATALOG`, relative links, protected regular files/directories/foreign links, and the interactive workflow. Add checks to the DSH README for `/opt/data/dsh/skills`, `/work/bamhub-ai-tools`, and Pod restart persistence.

- [ ] **Step 2: Run checks and verify failure**

```bash
node --test scripts/manage-skills/tests/manage-skills.test.mjs
```

Expected: FAIL until documentation exists.

- [ ] **Step 3: Write the tool README**

Document the normal command:

```bash
scripts/manage-skills/manage-skills
```

Document catalog resolution, DSH/Codex/Claude targets, safety behavior, `status --json`, `plan`, `apply --yes`, and `--prune-broken`. State clearly that the tool manages global links only and never edits source skills.

- [ ] **Step 4: Update the DSH deployment README**

Add the operational command:

```bash
kubectl --context home-pc-loc -n tools exec -it deploy/ai-dsh-web -- \
  /work/bamhub-ai-tools/scripts/manage-skills/manage-skills
```

Explain that both `/opt/data/dsh/skills` and `/work/bamhub-ai-tools/skills` are on existing PVC-backed paths, so Pod restarts preserve links. Do not alter Kubernetes YAML in this task.

- [ ] **Step 5: Run documentation checks and diff checks**

```bash
node --test scripts/manage-skills/tests/manage-skills.test.mjs
git diff --check
```

Expected: PASS and no whitespace errors.

- [ ] **Step 6: Commit the tool documentation**

Run in `bamhub-ai-tools`:

```bash
git add scripts/manage-skills/README.md scripts/manage-skills/tests/manage-skills.test.mjs
git commit -m "docs: document skill link management"
```

Then update and commit the deployment README separately in `maomao-deploy`:

```bash
cd /Users/maomao/Documents/workspace/my-project/maomao-deploy
git add home-k3s-pc/tools/ai-dsh/README.md
git commit -m "docs: document DSH skill links"
```

### Task 9: Run repository verification and real Pod probe

**Files:**
- Verify: all `scripts/manage-skills/` files
- Verify: `home-k3s-pc/tools/ai-dsh/README.md`

- [ ] **Step 1: Run focused tests**

```bash
node --check scripts/manage-skills/manage-skills.mjs
node --test scripts/manage-skills/tests/*.test.mjs
```

Expected: all focused tests pass.

- [ ] **Step 2: Run the repository's existing tests**

Run the commands documented by `bamhub-ai-tools/AGENTS.md`:

```bash
node --test tests/**/*.test.js
node --test tests/project/*.test.mjs
node --test tests/skill-layout.test.mjs
```

Expected: all existing repository tests pass. Do not add a package-manager or build command.

- [ ] **Step 3: Run a local temporary end-to-end test**

Create temporary catalog and target roots, run the executable in `status`, `plan`, and `apply --yes` modes, verify links with `lstat`/`readlink`, then remove the temporary root. Confirm entity conflicts and foreign links remain unchanged.

- [ ] **Step 4: Run a real Pod non-mutating probe**

After the script is available at the Pod's cloned repository path, run:

```bash
kubectl --context home-pc-loc -n tools exec deploy/ai-dsh-web -- \
  /work/bamhub-ai-tools/scripts/manage-skills/manage-skills.mjs status \
  --catalog /work/bamhub-ai-tools/skills \
  --target /tmp/dsh-skill-test \
  --json
```

Expected: exit code `0`, valid JSON, and no changes under `/opt/data/dsh/skills`.

- [ ] **Step 5: Run a real Pod temporary mutation probe**

Use a temporary catalog and target under `/tmp` to create, inspect, remove, and verify a relative link. Do not use the production DSH target until this probe passes.

- [ ] **Step 6: Verify DSH sees a controlled test skill**

Only after the temporary probe passes, use the interactive tool to enable one selected skill in `/opt/data/dsh/skills`, then verify:

```bash
kubectl --context home-pc-loc -n tools exec deploy/ai-dsh-web -- \
  test -L /opt/data/dsh/skills/<skill-name>
kubectl --context home-pc-loc -n tools exec deploy/ai-dsh-web -- \
  test -f /opt/data/dsh/skills/<skill-name>/SKILL.md
```

Inspect DSH startup/discovery behavior without claiming success until the skill is visible in the actual runtime.

- [ ] **Step 7: Commit final verification/documentation adjustments**

```bash
git status --short
git diff --check
git commit -m "test: verify skill link manager runtime"
```

Only commit if the verification changes are intentional; do not commit generated temporary files or runtime state.

---

## Verification Matrix

| Requirement | Covered by |
|---|---|
| User-selected catalog | Tasks 2 and 7 |
| Script-relative default without `/work` hard-code | Task 2 |
| DSH persistent `$DSH_HOME/skills` | Tasks 5, 8, 9 |
| Codex and Claude global roots | Task 5 |
| Interactive scan-confirm-select-preview-apply flow | Task 6 |
| Relative links | Tasks 3 and 4 |
| Regular files/directories protected | Tasks 3 and 4 |
| Foreign links protected | Tasks 3 and 4 |
| Broken links explicit cleanup only | Tasks 3, 4, and 7 |
| Duplicate skill handling | Task 2 and Task 3 |
| No npm dependencies | Task 1 and all tasks |
| Real Pod verification | Task 9 |
| Deployment documentation without YAML change | Task 8 |
