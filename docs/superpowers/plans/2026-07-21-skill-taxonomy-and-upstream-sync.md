# Skill 分类与上游同步 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 skill 按上游镜像、Bamhub 可复用能力和本仓库项目级能力重组，并提供可本地运行、由 GitHub Actions 定期触发的来源隔离同步器。

**Architecture:** `skills/sources.json` 是唯一的来源状态文件。`skills/project/sync-upstream-skills/` 包含零依赖 Node 同步器：它逐来源在临时 Git clone 中校验根目录，生成确定性报告和 README，并仅更新该来源允许的目标目录。`skills/superpowers/` 是完整上游镜像，`skills/bamhub/` 是本地可复用 skill，GitHub Actions 在干净分支创建更新 PR。

**Tech Stack:** Node.js 22 内置模块、Git CLI、Node `node:test`、GitHub Actions。

## Global Constraints

- 仅同步 `skills/sources.json` 的 `roots` 显式配置；绝不复制上游插件、hooks、CI 或仓库根目录内容。
- `skills/superpowers/` 不承载本地改动；本地适配位于 `skills/bamhub/`，项目专用同步器位于 `skills/project/`。
- `check` 不写入仓库；`apply` 默认拒绝覆盖脏目标目录，只有 `--force` 可覆盖。
- `--all` 按来源独立执行；一个来源失败不得阻断其他来源。
- 每个成功更新的目标根目录生成 `README.md`；AI 摘要是可选增强，缺失或失败绝不影响同步。
- 本机不安装定时器；周期运行仅由 GitHub Actions 托管执行，并只通过 PR 更新仓库。

---

## File Structure

- Create: `skills/sources.json` — 受版本控制的来源、根目录映射和已接受提交状态。
- Create: `skills/project/sync-upstream-skills/SKILL.md` — 本仓库专用的人工同步、报告与故障处理说明。
- Create: `skills/project/sync-upstream-skills/scripts/sync-skills.mjs` — 来源隔离的 CLI 与可导入同步函数。
- Create: `tests/project/sync-upstream-skills.test.mjs` — 使用临时本地 Git 仓库的离线同步回归测试。
- Create: `skills/superpowers/` — 从 `obra/superpowers` 的 `skills/` 根目录完整镜像的 14 个 skill 和生成的 README。
- Move: `skills/code-arch/` → `skills/bamhub/architecture/code-arch/`。
- Move: `skills/confirming-architecture/` → `skills/bamhub/architecture/confirming-architecture/`。
- Move: `skills/design-retrospective/` → `skills/bamhub/architecture/design-retrospective/`。
- Move: `skills/shared-auth/` → `skills/bamhub/integrations/shared-auth/`。
- Move: `skills/kibana-search/` → `skills/bamhub/integrations/kibana-search/`。
- Move: `skills/rule-refine/` → `skills/bamhub/maintenance/rule-refine/`。
- Move: `skills/sync-module-doc/` → `skills/bamhub/maintenance/sync-module-doc/`。
- Move: `skills/version-changelog/` → `skills/bamhub/maintenance/version-changelog/`。
- Move: `skills/lyra-prompt-optimizer/` → `skills/bamhub/productivity/`。
- Create: `.github/workflows/sync-skills.yml` — GitHub 托管的周检、手动触发、报告和 PR 创建。
- Modify: `.gitignore`, `AGENTS.md`, `CLAUDE.md` — 新目录、项目级 skill 与运行命令说明。
- Modify: `tests/shared-auth/*.test.js`, `tests/kibana-search/*.test.js`, `tests/integration/*.test.js` — 迁移后的导入和运行时路径。
- Modify: `skills/bamhub/integrations/{shared-auth,kibana-search}/**` — 更新文档与默认运行时路径。

### Task 1: Define the Source Manifest and Offline Sync Contract

**Files:**
- Create: `skills/sources.json`
- Create: `tests/project/sync-upstream-skills.test.mjs`
- Create: `skills/project/sync-upstream-skills/scripts/sync-skills.mjs`

**Interfaces:**
- Consumes: a repository root, `skills/sources.json`, and Git repositories configured by the selected source entry.
- Produces: `runCli(argv, { repoRoot, stdout, stderr })`, `checkSources(options, io)`, and `applySources(options, io)` exported from `sync-skills.mjs`.
- Source schema: `{ version: 1, sources: { [id]: { repository, ref, acceptedCommit, acceptedAt, roots: [{ upstream, target }] } } }`.

- [ ] **Step 1: Write failing manifest-validation and no-write tests**

Create `tests/project/sync-upstream-skills.test.mjs` with a temporary Git repository fixture and these executable expectations:

```js
test('check reports a source update without changing its target or manifest', async () => {
  const fixture = await createFixture({ sourceFiles: { 'skills/demo/SKILL.md': skill('demo') } });
  const before = await snapshot(fixture.repoRoot);

  const result = await runCli(['check', '--source', 'demo'], fixture);

  assert.equal(result.exitCode, 0);
  assert.equal(result.report.sources.demo.status, 'update-available');
  assert.deepEqual(await snapshot(fixture.repoRoot), before);
});

test('invalid root fails only that source and writes nothing for it', async () => {
  const fixture = await createFixture({ sourceFiles: { 'other/file.txt': 'x' } });
  const result = await runCli(['check', '--source', 'demo'], fixture);

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.sources.demo.status, 'failed');
  assert.match(result.report.sources.demo.error, /contains no SKILL\.md/);
});
```

Implement fixture helpers in the same test file using `fs.mkdtemp`, `git init`, `git add`, `git commit`, and a `file://` repository URL. Write `skills/sources.json` in each fixture with the source root `skills` and target `skills/demo-source`.

- [ ] **Step 2: Run the new tests to verify the contract is absent**

Run: `node --test tests/project/sync-upstream-skills.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `skills/project/sync-upstream-skills/scripts/sync-skills.mjs`.

- [ ] **Step 3: Add the minimal CLI contract and static source configuration**

Create the initial manifest:

```json
{
  "version": 1,
  "sources": {
    "superpowers": {
      "repository": "https://github.com/obra/superpowers.git",
      "ref": "main",
      "acceptedCommit": "d884ae04edebef577e82ff7c4e143debd0bbec99",
      "acceptedAt": "2026-07-21T00:00:00Z",
      "roots": [{ "upstream": "skills", "target": "skills/superpowers" }]
    }
  }
}
```

Create the script with the exports and argument parser below; have unsupported commands and unknown sources throw a typed error that the CLI converts to exit code 1 and a JSON report:

```js
export async function runCli(argv, io = {}) {
  const [command, ...rest] = argv;
  const options = parseOptions(rest);
  if (!['check', 'apply'].includes(command)) throw new SyncError('COMMAND_INVALID', command);
  if (!options.source && !options.all) throw new SyncError('SOURCE_REQUIRED');
  return command === 'check' ? checkSources(options, io) : applySources(options, io);
}

export class SyncError extends Error {
  constructor(code, message = code) { super(message); this.code = code; }
}
```

- [ ] **Step 4: Run the contract tests again**

Run: `node --test tests/project/sync-upstream-skills.test.mjs`

Expected: failures now identify unimplemented `checkSources` behavior rather than a missing module.

- [ ] **Step 5: Commit the contract**

```bash
git add skills/sources.json skills/project/sync-upstream-skills/scripts/sync-skills.mjs tests/project/sync-upstream-skills.test.mjs
git commit -m "feat(sync): add source manifest contract"
```

### Task 2: Implement Source-Isolated Check, Apply, and README Generation

**Files:**
- Modify: `skills/project/sync-upstream-skills/scripts/sync-skills.mjs`
- Modify: `tests/project/sync-upstream-skills.test.mjs`

**Interfaces:**
- Consumes: one source record from `skills/sources.json`, optional `--summary-file reports/superpowers-summary.md`, and `--force` for `apply`.
- Produces: `{ sources: { [id]: { status, currentCommit, targetCommit, changedFiles, error? } } }` as JSON; `apply` writes only `roots[].target`, target `README.md`, and the matching source state fields.

- [ ] **Step 1: Add failing tests for apply safety, README, optional AI summary, and `--all` isolation**

Append tests that assert these exact behaviors:

```js
test('apply replaces only configured roots and writes a deterministic README', async () => {
  const fixture = await createFixture({ sourceFiles: { 'skills/demo/SKILL.md': skill('demo', 'Demo skill') } });
  await runCli(['apply', '--source', 'demo'], fixture);

  assert.equal(await read(fixture.repoRoot, 'skills/demo-source/demo/SKILL.md'), skill('demo', 'Demo skill'));
  assert.match(await read(fixture.repoRoot, 'skills/demo-source/README.md'), /Demo skill/);
  assert.match(await read(fixture.repoRoot, 'skills/demo-source/README.md'), /Last successful sync/);
  assert.equal(await exists(fixture.repoRoot, 'hooks/pre-commit'), false);
});

test('apply rejects a dirty target unless --force is explicit', async () => {
  const fixture = await appliedFixture();
  await write(fixture.repoRoot, 'skills/demo-source/demo/SKILL.md', 'local change');

  await assert.rejects(() => runCli(['apply', '--source', 'demo'], fixture), /TARGET_DIRTY/);
  await runCli(['apply', '--source', 'demo', '--force'], fixture);
});

test('--all continues after one source fails', async () => {
  const fixture = await twoSourceFixture({ brokenRoot: true });
  const result = await runCli(['apply', '--all'], fixture);

  assert.equal(result.report.sources.broken.status, 'failed');
  assert.equal(result.report.sources.healthy.status, 'applied');
  assert.equal(await exists(fixture.repoRoot, 'skills/healthy-source/README.md'), true);
});
```

Add a fourth test supplying a Markdown summary file and assert that its content appears under `## Update summary`; supply a nonexistent summary file in a separate test and assert the deterministic changed-file list remains.

- [ ] **Step 2: Run the targeted tests to verify they fail**

Run: `node --test tests/project/sync-upstream-skills.test.mjs`

Expected: FAIL on missing target replacement, README, dirty-target rejection, and multi-source continuation.

- [ ] **Step 3: Implement source processing in isolated temporary directories**

Use `spawnSync('git', ...)` with `cwd` and an `fs.mkdtemp(path.join(os.tmpdir(), 'bamhub-skill-sync-'))` clone per source. Resolve each target with `path.resolve(repoRoot, root.target)` and reject paths that do not begin with `${repoRoot}${path.sep}`. Validate each upstream root by recursively finding at least one `SKILL.md`; reject an upstream root containing `README.md`, because target-root `README.md` is Bamhub-managed.

For a valid source, stage every root under a temporary replacement directory, then atomically replace only its configured target after all roots validate. Compare the current target with `git diff --no-index` or content hashes before writing; require `--force` when it differs from the last accepted snapshot. Update only that source's `acceptedCommit` and `acceptedAt` in the JSON manifest.

Generate each target README with this shape:

```md
# Superpowers skills

Source: https://github.com/obra/superpowers.git
Ref: main
Accepted commit: ${targetCommit}
Last successful sync: ${acceptedAt}

## Available skills

- `brainstorming` — Explores user intent before implementation.

## Update summary

Changed files: `A skills/brainstorming/SKILL.md`
```

Extract each displayed skill name and description from its `SKILL.md` front matter. If `--summary-file` contains nonempty UTF-8 Markdown, use that body after `## Update summary`; otherwise render the deterministic file-status list.

- [ ] **Step 4: Run the sync tests to verify the implementation**

Run: `node --test tests/project/sync-upstream-skills.test.mjs`

Expected: PASS with all check, apply, README, force, invalid-root, summary-file, and `--all` isolation cases green.

- [ ] **Step 5: Commit the isolated synchronizer**

```bash
git add skills/project/sync-upstream-skills/scripts/sync-skills.mjs tests/project/sync-upstream-skills.test.mjs
git commit -m "feat(sync): isolate source updates"
```

### Task 3: Install the Project-Level Sync Skill and Mirror Superpowers

**Files:**
- Create: `skills/project/sync-upstream-skills/SKILL.md`
- Create: `skills/superpowers/README.md`
- Create: `skills/superpowers/**` from the upstream `skills/` tree
- Delete: `skills/brainstorming/`, `skills/executing-plans/`, `skills/writing-plans/`, `skills/writing-skills/`
- Modify: `tests/project/sync-upstream-skills.test.mjs`

**Interfaces:**
- Consumes: the CLI from Task 2 and `skills/sources.json` source `superpowers`.
- Produces: a local, complete 14-skill Superpowers snapshot and a project-only operating guide.

- [ ] **Step 1: Write failing inventory tests for the real source mapping**

Add this test after the fixture tests:

```js
test('Superpowers target contains only managed skills and its generated README', () => {
  const root = path.resolve(import.meta.dirname, '../..');
  const entries = fs.readdirSync(path.join(root, 'skills/superpowers')).sort();

  assert.ok(entries.includes('README.md'));
  assert.ok(entries.includes('brainstorming'));
  assert.ok(entries.includes('test-driven-development'));
  assert.equal(fs.existsSync(path.join(root, 'skills/superpowers/.claude-plugin')), false);
  assert.equal(fs.existsSync(path.join(root, 'skills/superpowers/hooks')), false);
});
```

- [ ] **Step 2: Run the inventory test to verify it fails before mirroring**

Run: `node --test tests/project/sync-upstream-skills.test.mjs`

Expected: FAIL because `skills/superpowers/` does not exist.

- [ ] **Step 3: Write the project-only skill guide and run the initial apply**

Write `SKILL.md` with front matter `name: sync-upstream-skills` and explicit instructions to run `check` before `apply`, interpret per-source reports, use `--force` only to deliberately discard changes under a managed target, and explain that scheduled runs occur in GitHub Actions rather than on the local Mac.

Run the real initial import:

```bash
node skills/project/sync-upstream-skills/scripts/sync-skills.mjs apply --source superpowers
```

Verify the resulting `skills/superpowers/README.md` reports the resolved source commit and only the copied `skills/` content. Remove the four old root-level Superpowers directories only after confirming their equivalent paths exist in `skills/superpowers/`.

- [ ] **Step 4: Run the inventory and sync tests**

Run: `node --test tests/project/sync-upstream-skills.test.mjs`

Expected: PASS; the target contains the 14 upstream skills, a generated README, and no plugin or hook directory.

- [ ] **Step 5: Commit the project skill and upstream snapshot**

```bash
git add skills/sources.json skills/project/sync-upstream-skills tests/project/sync-upstream-skills.test.mjs skills/superpowers
git rm -r skills/brainstorming skills/executing-plans skills/writing-plans skills/writing-skills
git commit -m "feat(skills): mirror superpowers locally"
```

### Task 4: Move Bamhub Skills and Repair Runtime References

**Files:**
- Move: all Bamhub skill directories listed in File Structure.
- Modify: `.gitignore`
- Modify: `tests/shared-auth/*.test.js`
- Modify: `tests/kibana-search/*.test.js`
- Modify: `tests/integration/shared-auth-headless.test.js`
- Modify: `tests/integration/kibana-search-cli.test.js`
- Modify: `skills/bamhub/integrations/shared-auth/lib/cli-auth.js`
- Modify: `skills/bamhub/integrations/kibana-search/lib/cli-kibana-search.js`
- Modify: `skills/bamhub/integrations/{shared-auth,kibana-search}/SKILL.md`
- Create: `tests/skill-layout.test.mjs`

**Interfaces:**
- Consumes: new paths under `skills/bamhub/{architecture,integrations,maintenance,productivity}`.
- Produces: identical auth and Kibana CLI behavior with all persisted state under `skills/bamhub/integrations/*/.local/`.

- [ ] **Step 1: Write failing layout and runtime-path tests**

Create `tests/skill-layout.test.mjs`:

```js
test('all categorized skill roots contain SKILL.md recursively', () => {
  for (const root of ['skills/superpowers', 'skills/bamhub', 'skills/project']) {
    assert.ok(findFiles(root).some(file => file.endsWith('/SKILL.md')));
  }
});

test('legacy flat skill directories are absent', () => {
  for (const name of ['shared-auth', 'kibana-search', 'brainstorming', 'writing-plans']) {
    assert.equal(fs.existsSync(path.join(repoRoot, 'skills', name)), false);
  }
});
```

Update the existing auth runtime test to assert `skills/bamhub/integrations/shared-auth/.local/.gitkeep`, and update every unit-test import to the corresponding `../../skills/bamhub/integrations/...` module.

- [ ] **Step 2: Run the affected tests to verify migration failures**

Run: `node --test tests/skill-layout.test.mjs tests/shared-auth/*.test.js tests/kibana-search/*.test.js tests/integration/*.test.js`

Expected: FAIL with missing new Bamhub paths before files are moved.

- [ ] **Step 3: Move skills with Git and update every path atomically**

Run these exact moves before editing references:

```bash
mkdir -p skills/bamhub/architecture skills/bamhub/integrations skills/bamhub/maintenance skills/bamhub/productivity
git mv skills/code-arch skills/bamhub/architecture/code-arch
git mv skills/confirming-architecture skills/bamhub/architecture/confirming-architecture
git mv skills/design-retrospective skills/bamhub/architecture/design-retrospective
git mv skills/shared-auth skills/bamhub/integrations/shared-auth
git mv skills/kibana-search skills/bamhub/integrations/kibana-search
git mv skills/rule-refine skills/bamhub/maintenance/rule-refine
git mv skills/sync-module-doc skills/bamhub/maintenance/sync-module-doc
git mv skills/version-changelog skills/bamhub/maintenance/version-changelog
git mv skills/lyra-prompt-optimizer skills/bamhub/productivity/lyra-prompt-optimizer
```

Replace all executable default paths exactly:

```js
const DEFAULT_CACHE_PATH = 'skills/bamhub/integrations/kibana-search/.local/cache.json';
const configPath = process.env.SHARED_AUTH_CONFIG
  || 'skills/bamhub/integrations/shared-auth/.local/auth-config.json';
```

Update `.gitignore` to ignore only:

```gitignore
skills/bamhub/integrations/shared-auth/.local/*
!skills/bamhub/integrations/shared-auth/.local/.gitkeep
skills/bamhub/integrations/kibana-search/.local/*
!skills/bamhub/integrations/kibana-search/.local/.gitkeep
```

Update all SKILL.md commands, integration-test environment variables, test imports, and test file reads to use the new paths. Keep relative imports within moved module trees unchanged where they do not leave their skill directory.

- [ ] **Step 4: Run the complete local test suite**

Run: `node --test tests/**/*.test.js`

Expected: PASS with no references to the former flat auth, Kibana, or Superpowers paths.

- [ ] **Step 5: Commit the taxonomy migration**

```bash
git add -A .gitignore skills tests
git commit -m "refactor(skills): group bamhub capabilities"
```

### Task 5: Document the Categorized Repository and Add Hosted Scheduling

**Files:**
- Create: `.github/workflows/sync-skills.yml`
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`
- Modify: `README.md`
- Modify: `tests/skill-layout.test.mjs`

**Interfaces:**
- Consumes: `sync-skills.mjs check --all` and `apply --all`.
- Produces: a weekly hosted check, a manual `workflow_dispatch` entry point, a PR for successful updates, and documentation that distinguishes `superpowers`, `bamhub`, and `project` paths.

- [ ] **Step 1: Write failing documentation and workflow-shape tests**

Append assertions to `tests/skill-layout.test.mjs`:

```js
test('repository docs identify source, bamhub, and project skill ownership', () => {
  const agents = fs.readFileSync(path.join(repoRoot, 'AGENTS.md'), 'utf8');
  assert.match(agents, /skills\/superpowers/);
  assert.match(agents, /skills\/bamhub/);
  assert.match(agents, /skills\/project\/sync-upstream-skills/);
  assert.match(agents, /GitHub Actions/);
});

test('scheduled workflow runs hosted checks and opens PRs without local schedulers', () => {
  const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/sync-skills.yml'), 'utf8');
  assert.match(workflow, /schedule:/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /create-pull-request/);
  assert.doesNotMatch(workflow, /launchd|crontab/);
});
```

- [ ] **Step 2: Run the documentation tests to verify they fail**

Run: `node --test tests/skill-layout.test.mjs`

Expected: FAIL because the workflow and new directory documentation do not exist.

- [ ] **Step 3: Add hosted workflow and update contributor documentation**

Create `.github/workflows/sync-skills.yml` with `schedule` (`23 4 * * 1`) and `workflow_dispatch`, permissions `contents: write` and `pull-requests: write`, Node 22 setup, and these steps:

```yaml
- id: sync
  continue-on-error: true
  run: node skills/project/sync-upstream-skills/scripts/sync-skills.mjs apply --all
- if: always()
  uses: peter-evans/create-pull-request@v7
  with:
    branch: automation/sync-skills
    title: "chore(skills): sync upstream skills"
    commit-message: "chore(skills): sync upstream skills"
- if: steps.sync.outcome == 'failure'
  run: exit 1
```

Before the PR action, write each source report to `$GITHUB_STEP_SUMMARY` and upload it as an artifact. This ensures a failed source is visible while updates from healthy sources can still form a PR.

Revise `AGENTS.md` and `CLAUDE.md` to state the three ownership directories, the `sync-upstream-skills` project-only scope, manual `check` and `apply` commands, and GitHub-hosted scheduling. Update `README.md` from its one-line description to a short directory map and a link to the project sync skill.

- [ ] **Step 4: Run documentation, layout, and full test verification**

Run: `node --test tests/skill-layout.test.mjs tests/project/sync-upstream-skills.test.mjs tests/**/*.test.js`

Expected: PASS; the workflow exposes both hosted schedule and manual dispatch, and documentation never instructs a developer to install a local timer.

- [ ] **Step 5: Commit automation and documentation**

```bash
git add .github/workflows/sync-skills.yml AGENTS.md CLAUDE.md README.md tests/skill-layout.test.mjs
git commit -m "ci(skills): schedule upstream sync checks"
```

## Final Verification

- [ ] Run `node --test tests/**/*.test.js` and require zero failed tests.
- [ ] Run `node skills/project/sync-upstream-skills/scripts/sync-skills.mjs check --source superpowers` and verify the report does not change tracked files.
- [ ] Run `git diff --check` and inspect `git status --short` to ensure only expected migration files are present.
- [ ] In the target agent environment, confirm a nested skill from each of `skills/superpowers/`, `skills/bamhub/`, and `skills/project/` is discoverable before merging.
