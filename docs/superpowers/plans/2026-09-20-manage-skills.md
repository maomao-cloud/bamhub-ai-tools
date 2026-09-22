# manage-skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a safe interactive Node.js utility that lets a user select valid skills from one confirmed catalog and manage only manifest-owned relative symlinks in global DSH, Codex, Claude Code, or custom skill roots.

**Architecture:** Keep implementation and tests under `bamhub-ai-tools/scripts/manage-skills/`. A catalog module validates real skill bundles and structured selectors. A target/state layer validates global roots, persists per-target ownership manifests outside skill roots, and holds locks. A plan/transaction layer performs identity-checked, journaled changes with quarantine recovery. The CLI provides the scan→confirm→select→preview→apply wizard plus explicit non-interactive commands. DSH integration is a separate runtime gate because the current Web profile disables host `skill-filesystem` and `tool-skill`; this plan must not claim DSH discovery until a real session probe passes.

**Tech Stack:** Node.js built-in ESM, `node:fs/promises`, `node:path`, `node:crypto`, `node:readline`, `node:os`, `node:test`, `node:assert/strict`, optional POSIX wrapper.

## Global Constraints

- Keep implementation, modules, tests, and tool README under `bamhub-ai-tools/scripts/manage-skills/`.
- Do not add npm dependencies or require a package manager.
- Default to an interactive wizard; no mkdir, manifest write, lock acquisition, symlink creation, quarantine, or deletion before final confirmation.
- Resolve catalog in this exact order: explicit `--catalog`, `MANAGE_SKILLS_CATALOG`, script-relative `<repository-root>/skills`, interactive input.
- Explicit/env catalog paths that are invalid fail; derived missing candidates require interactive input and are never created.
- Never hard-code `/work/bamhub-ai-tools`; a Pod checkout is a human-managed prerequisite at a user-confirmed path under `/work`.
- Manage global roots only: DSH `$DSH_HOME/skills` or `$HOME/.dsh/skills` fallback, Codex `$HOME/.agents/skills`, Claude `$HOME/.claude/skills`, or a custom path that passes the global-root guard.
- Reject custom targets inside a Git worktree, project `.agents/skills`, project `.claude/skills`, catalog/target overlaps, and unsafe symlink ancestors.
- Use relative symlinks calculated with `path.relative()`.
- Do not infer ownership from a link target alone. Only manifest-owned links with matching identity may be removed automatically.
- Protect unmanaged/foreign/broken links, regular files, and regular directories by default.
- Never copy, edit, or delete source skill files.
- Use per-target lock, catalog/target/source identity snapshots, journal, quarantine, and post-apply verification.
- DSH uses the existing persistent `$DSH_HOME/skills` path; do not add PVCs, mounts, `DSH_AGENTS_HOME`, initContainers, image content, or a DSH plugin in this feature.
- Do not clone, pull, checkout, reset, or update the catalog from the tool.
- Use temporary directories for tests; never mutate real user skill directories in automated tests.
- Use ESM, two-space indentation, single quotes, semicolons, and `node:test`.
- New tests under the feature directory use `.test.mjs`; update `AGENTS.md` to document this existing ESM exception.
- Do not claim DSH Web support until the actual active preset/session discovery gate passes.

---

## File Map

### New files in `bamhub-ai-tools`

- `scripts/manage-skills/manage-skills`: optional executable POSIX wrapper that runs the Node entry.
- `scripts/manage-skills/manage-skills.mjs`: CLI entry and process exit handling.
- `scripts/manage-skills/lib/catalog.mjs`: catalog resolution, recursive bundle scan, frontmatter validation, duplicate and selector resolution.
- `scripts/manage-skills/lib/targets.mjs`: DSH/Codex/Claude/custom target detection and global-boundary validation.
- `scripts/manage-skills/lib/state.mjs`: state-root selection, manifest schema, atomic manifest read/write, target/catalog identity.
- `scripts/manage-skills/lib/links.mjs`: one-level target scan, link classification, source/link identity checks.
- `scripts/manage-skills/lib/plan.mjs`: desired-state reconciliation and `PlanSet` construction.
- `scripts/manage-skills/lib/transaction.mjs`: locks, journal, quarantine, identity rechecks, apply and recovery.
- `scripts/manage-skills/lib/interactive.mjs`: TTY menus, multi-select, preview, confirmation, and terminal cleanup.
- `scripts/manage-skills/tests/catalog.test.mjs`: catalog and selector tests.
- `scripts/manage-skills/tests/targets.test.mjs`: runtime and global-boundary tests.
- `scripts/manage-skills/tests/state.test.mjs`: manifest, identity, and lock tests.
- `scripts/manage-skills/tests/links.test.mjs`: classification and safety tests.
- `scripts/manage-skills/tests/transaction.test.mjs`: apply, race, quarantine, and recovery tests.
- `scripts/manage-skills/tests/interactive.test.mjs`: TTY orchestration tests.
- `scripts/manage-skills/tests/cli.test.mjs`: command, JSON, and exit-code tests.
- `scripts/manage-skills/README.md`: user-facing operation and safety documentation.

### Modified documentation files

- `README.md` in `bamhub-ai-tools`: add the tool entry and global-only boundary.
- `AGENTS.md` in `bamhub-ai-tools`: correct skill category count and document `.test.mjs` feature tests.
- `home-k3s-pc/tools/ai-dsh/README.md` in `maomao-deploy`: document human checkout, actual PVC mappings, runtime gate, and tool operation. This is a separate repository change and test boundary.

Do not modify the old `dsh-runner` plan as part of manager implementation. It remains the historical baseline for PVC, `/work`, `DSH_HOME`, and manual image upgrades. Correct stale deployment README facts only when verified against the current YAML.

---

### Task 0: Record the real DSH runtime gate before implementation

**Files:**
- Read-only: `home-k3s-pc/tools/ai-dsh/ai-dsh-web.yaml`
- Read-only: `home-k3s-pc/tools/ai-dsh/README.md`
- Read-only: running Pod `ai-dsh-web` in context `home-pc-loc`
- Record findings in the implementation report, not source code.

**Interfaces:**
- Gate result: `{ pod, container, dshHome, checkoutCandidates, hostSkillFilesystem, hostToolSkill, activePreset, discoveryEvidence }`.

- [ ] **Step 1: Verify current deployment paths and container**

Run:

```bash
kubectl --context home-pc-loc -n tools get pod -l app=ai-dsh-web -o wide
kubectl --context home-pc-loc -n tools exec -c ai-dsh <pod> -- env | grep -E '^(HOME|DSH_HOME|DSH_AGENTS_HOME)='
kubectl --context home-pc-loc -n tools exec -c ai-dsh <pod> -- dsh --profile web --dump-config
```

Expected facts: `DSH_HOME=/opt/data/dsh`; current output explicitly records whether `skill-filesystem` and `tool-skill` are disabled.

- [ ] **Step 2: Locate the human-managed catalog checkout**

Run:

```bash
kubectl --context home-pc-loc -n tools exec -c ai-dsh <pod> -- \
  find /work -maxdepth 5 -type d -name skills -print
```

For each candidate, verify:

```bash
git -C <checkout> rev-parse --show-toplevel
test -d <checkout>/skills
git -C <checkout> status --short
```

Expected: no implementation code assumes a fixed checkout path; an absent checkout is a documented prerequisite failure.

- [ ] **Step 3: Record the DSH gate as unresolved if provider/preset is disabled**

If the dump shows host `skill-filesystem` or `tool-skill` disabled, mark production discovery as blocked. Do not “fix” it by adding an unapproved profile patch in this feature. The manager can still be implemented and tested as a filesystem tool, but final DSH acceptance remains pending a separate runtime configuration decision.

- [ ] **Step 4: Commit no files**

This task is a read-only gate. Do not commit runtime output, Pod paths, or generated reports into the repository.

### Task 1: Implement catalog resolution and valid skill scanning

**Files:**
- Create: `scripts/manage-skills/lib/catalog.mjs`
- Test: `scripts/manage-skills/tests/catalog.test.mjs`

**Interfaces:**
- `resolveCatalog({ explicitPath, env, scriptFile, interactivePath }) -> Promise<{ root, source }>` or a typed error.
- `discoverCatalog({ catalogRoot }) -> Promise<{ root, skills, invalid, duplicates }>`.
- Valid skill: `{ name, description, sourceDir, skillFile, relativeSource, sourceIdentity }`.
- Selector: `{ name, sourceRelative?, linkName? }`.
- `resolveSelectors(selectors, catalog) -> { selections, errors }`.

- [ ] **Step 1: Write failing tests for catalog precedence**

Cover explicit path, environment path, script-relative candidate, and interactive path. Assert explicit/env invalid paths fail without falling back; derived missing path returns a selectable missing candidate; no path is created.

- [ ] **Step 2: Write failing scanner tests**

Construct temporary bundles containing valid, invalid, missing-frontmatter, duplicate, symlinked-`SKILL.md`, and escaping-resource cases. Assert only valid bundles enter `skills` and invalid entries include a reason.

- [ ] **Step 3: Run focused tests and verify failure**

```bash
node --test scripts/manage-skills/tests/catalog.test.mjs
```

Expected: FAIL because the module does not exist.

- [ ] **Step 4: Implement deterministic frontmatter parsing**

Accept only a `---`-delimited frontmatter block and top-level single-line `name:`/`description:` values with optional matching quotes. Reject multiline/nested/duplicate required keys and missing values. Use `lstat` for `SKILL.md`, `realpath` for bundle/source identity, and reject any source/resource symlink that resolves outside the catalog.

- [ ] **Step 5: Implement selector resolution**

Resolve an unqualified name only when unique. Resolve a `sourceRelative` selector only when it matches one valid skill. Validate optional `linkName` with the same kebab-case rule and reject collisions within one target.

- [ ] **Step 6: Run focused tests and verify pass**

```bash
node --test scripts/manage-skills/tests/catalog.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/manage-skills/lib/catalog.mjs scripts/manage-skills/tests/catalog.test.mjs
git commit -m "feat: validate skill catalog entries"
```

### Task 2: Implement runtime detection and target safety

**Files:**
- Create: `scripts/manage-skills/lib/targets.mjs`
- Test: `scripts/manage-skills/tests/targets.test.mjs`

**Interfaces:**
- `detectRuntimeTargets({ env, home }) -> Promise<RuntimeTarget[]>`.
- `RuntimeTarget = { id, label, path, source, exists, selectable }`.
- `validateTarget({ targetPath, catalogRoot, mode }) -> Promise<TargetIdentity>`.
- `TargetIdentity = { path, realPath, dev, ino, existed, stateRoot }`.
- `resolveTargetSelection({ runtimes, customPath, selectedIds }) -> Promise<RuntimeTarget[]>`.

- [ ] **Step 1: Write failing runtime tests**

Assert:

```text
DSH_HOME=/tmp/dsh -> /tmp/dsh/skills
DSH_HOME unset, HOME=/tmp/home -> /tmp/home/.dsh/skills fallback candidate
HOME=/tmp/home -> /tmp/home/.agents/skills
HOME=/tmp/home -> /tmp/home/.claude/skills
```

Missing standard directories are selectable but not created by detection.

- [ ] **Step 2: Write failing target-boundary tests**

Reject target equal to catalog, target inside catalog, catalog inside target, target under a Git worktree, target project `.agents/skills`/`.claude/skills`, symlink ancestor, non-directory existing target, and missing target with missing parent. Accept a missing final directory under a safe existing global parent.

- [ ] **Step 3: Run focused tests and verify failure**

```bash
node --test scripts/manage-skills/tests/targets.test.mjs
```

Expected: FAIL.

- [ ] **Step 4: Implement canonical path and global guard**

Resolve standard runtime roots, require absolute normalized paths, inspect the nearest existing ancestor for `.git`, reject unsafe parent symlinks, and return a typed error with the exact rejected reason. `--target` is mutually exclusive with `--runtime`; repeated `--runtime` values are allowed; `all` means only explicitly confirmed detected standard roots.

- [ ] **Step 5: Run focused tests and verify pass**

```bash
node --test scripts/manage-skills/tests/targets.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/manage-skills/lib/targets.mjs scripts/manage-skills/tests/targets.test.mjs
git commit -m "feat: guard global skill targets"
```

### Task 3: Implement per-target state, manifest, and lock

**Files:**
- Create: `scripts/manage-skills/lib/state.mjs`
- Test: `scripts/manage-skills/tests/state.test.mjs`

**Interfaces:**
- `stateRootForTarget({ runtimeId, env, home }) -> string`.
- `loadManifest({ stateRoot, targetIdentity }) -> Promise<ManifestState>`.
- `writeManifestAtomic({ stateRoot, targetIdentity, manifest }) -> Promise<void>`.
- `manifestIdentity({ catalogIdentity, targetIdentity }) -> string`.
- `acquireTargetLock({ stateRoot, targetIdentity }) -> Promise<LockHandle>`.
- `LockHandle.release() -> Promise<void>`.
- `ManifestState = { version: 1, target, catalog, links }`.

- [ ] **Step 1: Write failing manifest tests**

Cover missing manifest, valid manifest, malformed manifest, catalog identity mismatch, target identity mismatch, atomic temp-file replacement, and manifest stored outside target skill root.

- [ ] **Step 2: Write failing lock tests**

Cover exclusive lock acquisition, second acquisition failure with owner/time, release, and stale lock requiring explicit cleanup. Do not silently steal a lock.

- [ ] **Step 3: Run focused tests and verify failure**

```bash
node --test scripts/manage-skills/tests/state.test.mjs
```

Expected: FAIL.

- [ ] **Step 4: Implement state and lock primitives**

Use JSON written to a temporary file in the same state directory followed by rename. Include target/catalog `dev`/`ino`, canonical paths, Git remote/commit when available, link name, source-relative path, source identity, and relative target. Use exclusive directory creation or an equivalent atomic primitive for the lock. If state is unavailable, read-only commands may report it but apply must fail before mutation.

- [ ] **Step 5: Run focused tests and verify pass**

```bash
node --test scripts/manage-skills/tests/state.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/manage-skills/lib/state.mjs scripts/manage-skills/tests/state.test.mjs
git commit -m "feat: persist skill link ownership"
```

### Task 4: Implement link classification and desired-state PlanSet

**Files:**
- Create: `scripts/manage-skills/lib/links.mjs`
- Create: `scripts/manage-skills/lib/plan.mjs`
- Test: `scripts/manage-skills/tests/links.test.mjs`

**Interfaces:**
- `scanTarget({ targetIdentity, catalog, manifest }) -> Promise<EntryState[]>` scanning only direct children of target root.
- `EntryState = { linkPath, kind, linkTarget?, realTarget?, manifestEntry?, reason?, identity? }`.
- `buildPlanSet({ targets, catalog, desiredSelections, options }) -> Promise<PlanSet>`.
- `PlanSet = { plans: Plan[], protected, conflicts }`.
- `Plan = { target, catalog, desired, create, remove, keep, conflicts, protected, fingerprint }`.

- [ ] **Step 1: Write failing classification tests**

Cover manifest-owned valid link, manifest-owned broken link, unmanaged valid link, unmanaged broken link, foreign link, regular file, regular directory, target missing, and catalog-prefix collision. Assert only manifest-owned links can enter `remove`.

- [ ] **Step 2: Write failing plan tests**

Cover create/keep/remove, duplicate selectors, alias collision, manifest mismatch, missing desired-state input, `--disable-all`, and multiple targets with independent plans. Assert `--enable` means final desired set, not additive mode.

- [ ] **Step 3: Run focused tests and verify failure**

```bash
node --test scripts/manage-skills/tests/links.test.mjs
```

Expected: FAIL.

- [ ] **Step 4: Implement classification and plan generation**

Use `lstat` so broken links remain observable. Match removal candidates against manifest link path, recorded relative target, source identity, target identity, and catalog identity. Classify all other entries as protected/unmanaged. Build one plan per target and a stable JSON-serializable PlanSet.

- [ ] **Step 5: Run focused tests and verify pass**

```bash
node --test scripts/manage-skills/tests/links.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/manage-skills/lib/links.mjs scripts/manage-skills/lib/plan.mjs scripts/manage-skills/tests/links.test.mjs
git commit -m "feat: plan manifest-owned skill links"
```

### Task 5: Implement journaled transaction, quarantine, and race checks

**Files:**
- Create: `scripts/manage-skills/lib/transaction.mjs`
- Test: `scripts/manage-skills/tests/transaction.test.mjs`

**Interfaces:**
- `applyPlanSet(planSet, { state, dryRun }) -> Promise<ApplyReport>`.
- `ApplyReport = { targets: [{ target, applied, skipped, failed, journal, verified }], exitCode }`.
- `verifyPlan(plan) -> Promise<{ ok, mismatches }>`.
- `recoverJournal({ stateRoot, journalPath }) -> Promise<RecoveryReport>`.

- [ ] **Step 1: Write failing transaction tests**

Cover no mutation during dry-run, create link, quarantine removal, atomic manifest update, post-apply verification, source replacement, target link replacement, regular-file replacement, permission failure, interrupted transaction recovery, and second process lock failure.

- [ ] **Step 2: Run focused tests and verify failure**

```bash
node --test scripts/manage-skills/tests/transaction.test.mjs
```

Expected: FAIL.

- [ ] **Step 3: Implement preflight and identity rechecks**

Before every mutation, re-lstat the expected path and compare type, dev/ino, target text, source identity, catalog identity, and target identity. If anything differs, mark a conflict and perform no mutation for that item. Revalidate sourceDir and regular `SKILL.md` immediately before creating a link.

- [ ] **Step 4: Implement lock/journal/quarantine flow**

Acquire all target locks before any mutation. Create links only with a non-overwriting symlink operation. Rename manifest-owned removals to a quarantine directory on the same filesystem. Write a journal before the first mutation, update it after every mutation, atomically update the manifest, verify, then remove quarantine. Leave journal/quarantine on failure and return `exitCode: 1`.

- [ ] **Step 5: Run focused tests and verify pass**

```bash
node --test scripts/manage-skills/tests/transaction.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/manage-skills/lib/transaction.mjs scripts/manage-skills/tests/transaction.test.mjs
git commit -m "feat: apply skill links with recovery"
```

### Task 6: Implement interactive wizard

**Files:**
- Create: `scripts/manage-skills/lib/interactive.mjs`
- Test: `scripts/manage-skills/tests/interactive.test.mjs`

**Interfaces:**
- `runInteractive({ catalogResolver, targetDetector, io }) -> Promise<InteractiveSelection | { cancelled: true }>`.
- `InteractiveSelection = { catalogRoot, targets, desiredSelections, disableAll }`.
- `confirmPlanSet(planSet, io) -> Promise<boolean>`.

- [ ] **Step 1: Write failing wizard tests**

Simulate catalog confirmation/input, runtime selection, desired skill selection, preview, final rejection, final approval, Esc, EOF, Ctrl-C, and an exception. Assert no mkdir, lock, manifest, symlink, quarantine, or delete action occurs before final approval.

- [ ] **Step 2: Run focused tests and verify failure**

```bash
node --test scripts/manage-skills/tests/interactive.test.mjs
```

Expected: FAIL.

- [ ] **Step 3: Implement terminal-safe menu primitives**

Use Node `readline`; enter raw mode only for TTY. In `try/finally`, restore raw mode, close readline, remove signal handlers, and handle EOF/SIGINT/SIGTERM. Support arrows, Space, `a`, `n`, Enter, and Escape. Do not perform filesystem writes in this module.

- [ ] **Step 4: Implement fixed wizard order**

Scan environment → confirm catalog → scan valid skills → select global targets → scan manifest/link state → select final desired skills → render complete per-target PlanSet → final confirmation → hand PlanSet to transaction layer. Show protected/unmanaged entries but never make them deletable by normal selection.

- [ ] **Step 5: Run focused tests and verify pass**

```bash
node --test scripts/manage-skills/tests/interactive.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/manage-skills/lib/interactive.mjs scripts/manage-skills/tests/interactive.test.mjs
git commit -m "feat: add interactive skill manager"
```

### Task 7: Complete CLI commands, selectors, JSON, and exit codes

**Files:**
- Create: `scripts/manage-skills/manage-skills.mjs`
- Create: `scripts/manage-skills/manage-skills`
- Test: `scripts/manage-skills/tests/cli.test.mjs`

**Interfaces:**
- Commands: default interactive, `status`, `plan`, `apply`.
- Options: `--catalog`, repeatable `--runtime`, single `--target`, `--enable`, `--disable-all`, `--json`, `--non-interactive`, `--yes`, `--dry-run`.
- `--target` and `--runtime` are mutually exclusive; `--runtime all` expands only confirmed detected standard roots.
- `apply` requires exactly one desired-state input: `--enable`, `--disable-all`, or interactive selection. `--yes` confirms non-interactive apply; `--non-interactive` without `--yes` fails.
- Exit codes: `0` verified success; `1` operational/verification/conflict failure; `2` invalid arguments or missing required selection.
- JSON report: `{ ok, exitCode, catalog, targets: [{ target, entries, plan, result }], errors }`; stdout contains JSON only, diagnostics go stderr.

- [ ] **Step 1: Write failing CLI tests**

Cover invalid command, invalid catalog, status with missing target, DSH fallback, `--target`/`--runtime` conflict, missing desired-state input, `--disable-all`, selector alias, `plan`, `apply --yes`, JSON-only stdout, and exit-code mapping. Move the earlier empty-catalog status smoke test here; Task 1 must test only invalid-command validation.

- [ ] **Step 2: Run focused tests and verify failure**

```bash
node --test scripts/manage-skills/tests/cli.test.mjs
```

Expected: FAIL.

- [ ] **Step 3: Implement parser and orchestration**

Keep parsing dependency-free. Resolve catalog, discover valid skills, resolve targets, load state, build a PlanSet, and call the transaction layer only after explicit confirmation. `--enable` is the final desired collection; it is never an additive shortcut.

- [ ] **Step 4: Implement wrapper and executable checks**

The POSIX wrapper resolves its own directory and executes `node "$script_dir/manage-skills.mjs" "$@"`. Keep direct `node .../manage-skills.mjs` documented for environments without the wrapper. Test `test -x`, `sh -n`, and `node --check` for every `.mjs` module.

- [ ] **Step 5: Run focused tests and verify pass**

```bash
node --test scripts/manage-skills/tests/cli.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/manage-skills/manage-skills scripts/manage-skills/manage-skills.mjs scripts/manage-skills/tests/cli.test.mjs
git commit -m "feat: expose skill link CLI"
```

### Task 8: Add tool and repository documentation

**Files:**
- Create: `scripts/manage-skills/README.md` in `bamhub-ai-tools`.
- Modify: `README.md` in `bamhub-ai-tools`.
- Modify: `AGENTS.md` in `bamhub-ai-tools`.
- Modify: `home-k3s-pc/tools/ai-dsh/README.md` in `maomao-deploy`.

**Interfaces:**
- bamhub tests read only bamhub files; they must not import or read the separate deployment repository.
- Deployment README is reviewed and committed in `maomao-deploy` separately.

- [ ] **Step 1: Write failing documentation tests for bamhub files only**

Assert the tool README documents catalog precedence, manifest ownership, global-only target guard, DSH/Codex/Claude roots, `--disable-all`, Pod checkout prerequisite, and no automatic clone/update. Assert root README links to the tool. Assert AGENTS states six skill ownership categories and the `.mjs` feature-test command.

- [ ] **Step 2: Run documentation tests and verify failure**

```bash
node --test scripts/manage-skills/tests/cli.test.mjs
```

Expected: FAIL until the documentation exists.

- [ ] **Step 3: Write tool and root README content**

Document:

```bash
scripts/manage-skills/manage-skills
scripts/manage-skills/manage-skills.mjs status --catalog <path> --runtime dsh --json
scripts/manage-skills/manage-skills.mjs apply --catalog <path> --runtime dsh --enable brainstorming --yes
```

State that links without manifest ownership are protected, DSH Web discovery is gated by the active profile/preset, and the tool does not clone or update the catalog. Replace the temporary root README design/plan reference with a link to `scripts/manage-skills/README.md` once that file exists.

- [ ] **Step 4: Update AGENTS.md**

Correct the category count from five to six and add:

```text
node --test scripts/manage-skills/tests/*.test.mjs
```

Explain that new ESM tests in the feature directory use `.test.mjs`, matching existing repository tests.

- [ ] **Step 5: Update deployment README separately**

In `maomao-deploy`, document the actual mappings:

```text
/www/data/dsh/home/ -> /opt/data/dsh/
/www/data/dsh/work/ -> /work/
```

Document manual checkout under `/work`, dynamic path discovery, `kubectl --context home-pc-loc -n tools exec -c ai-dsh`, current image tag authority (`ai-dsh-web.yaml`, not the historical placeholder), and the DSH skill provider gate. Reconcile any stale cordis patch wording with the current `--patch /etc/dsh/openviking.patch.yml` deployment before claiming the README is correct. Do not alter Kubernetes YAML in this task.

- [ ] **Step 6: Run repository-specific documentation checks**

In `bamhub-ai-tools`:

```bash
node --test scripts/manage-skills/tests/cli.test.mjs
git diff --check
```

In `maomao-deploy`, use a read-only grep/diff check for the new README section; do not make the bamhub test suite read across repositories.

- [ ] **Step 7: Commit separately**

In `bamhub-ai-tools`:

```bash
git add scripts/manage-skills/README.md README.md AGENTS.md scripts/manage-skills/tests/cli.test.mjs
git commit -m "docs: document global skill links"
```

In `maomao-deploy`, after checking `git status --short` and isolating unrelated existing changes:

```bash
git add home-k3s-pc/tools/ai-dsh/README.md
git commit -m "docs: document DSH skill link operations"
```

### Task 9: Run full verification and real runtime probes

**Files:**
- Verify: all `scripts/manage-skills/` files.
- Verify: bamhub README/AGENTS changes.
- Verify: deployment README in `maomao-deploy`.

- [ ] **Step 1: Run focused syntax/tests**

```bash
node --check scripts/manage-skills/manage-skills.mjs
for file in scripts/manage-skills/lib/*.mjs; do node --check "$file"; done
node --test scripts/manage-skills/tests/*.test.mjs
```

Expected: all focused tests pass.

- [ ] **Step 2: Run existing bamhub tests with explicit real file groups**

```bash
node --test tests/*/*.test.js
node --test tests/project/*.test.mjs
node --test tests/skill-layout.test.mjs
```

These commands match the repository's current test layout; do not rely on an unconfigured `globstar` wildcard for all tests.

- [ ] **Step 3: Run local temporary end-to-end probe**

Create temporary catalog, state, target, foreign link, unmanaged link, and conflict entries. Run `status`, `plan`, `apply --yes`, verify `lstat/readlink/test -f`, interrupt/recover a journal, then remove only the temporary root. Confirm no real home directory changes.

- [ ] **Step 4: Verify the human-managed Pod checkout**

First locate the actual checkout; do not assume `/work/bamhub-ai-tools`:

```bash
kubectl --context home-pc-loc -n tools exec -c ai-dsh <pod> -- find /work -maxdepth 5 -type d -name skills -print
```

Then set the user-confirmed catalog path and verify Git root, `skills/`, clean status/commit, and script availability. The tool does not create or update this checkout.

- [ ] **Step 5: Run a non-production Pod probe**

Use `node` explicitly and a temporary catalog/target under `/tmp`; do not execute a bare `.mjs` file:

```bash
kubectl --context home-pc-loc -n tools exec -c ai-dsh <pod> -- \
  node <checkout>/scripts/manage-skills/manage-skills.mjs status \
  --catalog <checkout>/skills \
  --target /tmp/dsh-skill-test \
  --json
```

Create a temporary valid skill under `/tmp`, run plan/apply, inspect the relative link, then clean the temporary target with a shell `trap`. Production `/opt/data/dsh/skills` must remain untouched during this step.

- [ ] **Step 6: Run the DSH runtime gate**

Use:

```bash
kubectl --context home-pc-loc -n tools exec -c ai-dsh <pod> -- \
  dsh --profile web --dump-config
```

If host `skill-filesystem`/`tool-skill` remain disabled, record production discovery as blocked and do not claim the manager is usable from the DSH Web agent. If an active preset is verified, enable one controlled manifest-owned link and perform an actual Web session/agent invocation plus a controlled source mutation probe. Verify `test -L`, `readlink`, `test -f`, and actual runtime visibility separately.

- [ ] **Step 7: Review final repository states**

```bash
git -C /Users/maomao/Documents/workspace/my-project/bamhub-ai-tools status --short
git -C /Users/maomao/Documents/workspace/my-project/bamhub-ai-tools diff --check
git -C /Users/maomao/Documents/workspace/my-project/maomao-deploy status --short
```

Do not create a “verification commit” unless source or documentation changes were intentionally made. Do not commit runtime state, manifests, journals, locks, quarantine files, or temporary catalog data.

---

## Verification Matrix

| Requirement | Covered by |
|---|---|
| User-selected catalog and no hard-coded checkout | Tasks 1, 8, 9 |
| Global-only target guard | Task 2 |
| DSH fallback and runtime roots | Task 2 |
| Valid skill/source boundary | Task 1 |
| Manifest ownership and no unsafe deletion | Task 3/4/5 |
| Relative links | Task 4/5 |
| Race and replacement protection | Task 5 |
| Lock/journal/quarantine recovery | Task 3/5 |
| Interactive scan-confirm-preview-apply flow | Task 6 |
| Explicit non-interactive desired state | Task 7 |
| No npm dependencies | All tasks |
| Existing repository test conventions | Task 8/9 |
| Existing PVC mapping and human checkout | Task 0/8/9 |
| Current DSH profile/preset gate | Task 0/9 |
| Real DSH discovery evidence | Task 9 only; never inferred from file existence |
