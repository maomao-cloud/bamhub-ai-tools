# 调用期同步摘要 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 README 与同步状态完全确定，AI 摘要仅由调用方根据本次 `check` 报告临时生成。

**Architecture:** 同步器移除 `--summary-file` 和所有摘要哈希；README 永远由来源元数据、skill 清单和 `git diff --name-status` 构建。调用方读取 JSON 报告生成自己的摘要。GitHub Actions 将原始报告放在 runner 临时目录，避免它被自动 PR 操作提交。

**Tech Stack:** Node.js 22 内置模块、Git CLI、`node:test`、GitHub Actions。

## Global Constraints

- 不在 `skills/superpowers/` 中修改任何上游镜像正文。
- `skills/sources.json` 只保存来源配置、`acceptedCommit` 和 `acceptedAt`；不保存 AI 摘要或摘要哈希。
- README 的 `## Update summary` 只能是确定性 `Changed files:` 文件状态列表。
- `check` 不写入仓库；完整且已接受的同提交 `apply` 返回 `up-to-date` 且不改动 README 或清单。
- GitHub Actions 只通过 PR 更新，不在无更新时把运行报告提交进 PR。

---

### Task 1: Make generated README state deterministic

**Files:**
- Modify: `skills/project/sync-upstream-skills/scripts/sync-skills.mjs`
- Modify: `tests/project/sync-upstream-skills.test.mjs`
- Modify: `skills/project/sync-upstream-skills/SKILL.md`
- Modify: `docs/superpowers/specs/2026-07-21-skill-taxonomy-and-upstream-sync-design.md`

**Interfaces:**
- Consumes: `check|apply --source <id>` or `--all`.
- Produces: deterministic `README.md` and JSON source report. `--summary-file` becomes an unknown CLI option.

- [ ] **Step 1: Replace summary-persistence tests with deterministic-state failures**

Remove tests that expect summary Markdown in README. Add a test that `runCli(['apply', '--source', 'demo', '--summary-file', 'report.md'], fixture)` rejects with `OPTION_UNKNOWN`. Add a test that changes `Changed files:` in an applied README, then expects `TARGET_DIRTY` without `--force`. Add a second-upstream-commit fixture update and assert `apply` succeeds and emits the new deterministic `A`/`M`/`D` list. Retain the clean accepted-source test and assert its snapshot is byte-identical before and after `apply`.

- [ ] **Step 2: Run the project sync test to verify it fails**

Run `node --test tests/project/sync-upstream-skills.test.mjs`.

Expected: failure because the parser accepts `--summary-file` and README generation still accepts optional summary content.

- [ ] **Step 3: Remove summary input and compare the complete README**

Remove the `--summary-file` branch from `parseOptions`, then remove `readSummary`, `summary` parameters, and summary-digest parsing helpers. Generate the README with only `deterministicSummary(changedFiles)`:

```js
const body = `# ${title}\n\nSource: ${source.repository}\nRef: ${source.ref}\nAccepted commit: ${targetCommit}\nLast successful sync: ${acceptedAt}\n\n## Available skills\n\n${availableSkills}\n\n## Update summary\n\n${deterministicSummary(changedFiles)}\n`;
return `${body}<!-- bamhub-sync-digest: ${digestText(body)} -->\n`;
```

Build expected accepted README with `changedFiles: []` and compare its full text in `readmeMatches`. Keep target-tree digests, symlink protections, transactionality, and the early clean up-to-date return unchanged.

- [ ] **Step 4: Update documentation**

Remove `--summary-file` from `skills/project/sync-upstream-skills/SKILL.md`. Explain that an AI-capable caller may read the `check` JSON and present a per-call summary, but never supplies it to `apply`. Replace the optional-summary subsection in `docs/superpowers/specs/2026-07-21-skill-taxonomy-and-upstream-sync-design.md` with a reference to `2026-07-22-ephemeral-sync-summaries-design.md`.

- [ ] **Step 5: Verify and commit**

Run `node --test tests/project/sync-upstream-skills.test.mjs` and `git diff --check`.

Expected: all project sync tests pass and this task has no whitespace errors.

```bash
git add skills/project/sync-upstream-skills/scripts/sync-skills.mjs skills/project/sync-upstream-skills/SKILL.md tests/project/sync-upstream-skills.test.mjs docs/superpowers/specs/2026-07-21-skill-taxonomy-and-upstream-sync-design.md
git commit -m "refactor(sync): keep summaries ephemeral"
```

### Task 2: Keep hosted report artifacts out of pull requests

**Files:**
- Modify: `.github/workflows/sync-skills.yml`
- Modify: `tests/skill-layout.test.mjs`

**Interfaces:**
- Consumes: `apply --all` JSON written under `$RUNNER_TEMP`.
- Produces: Job Summary and `sync-skills-report` artifact from the temporary report; `create-pull-request` sees only intended repository changes.

- [ ] **Step 1: Write the failing workflow test**

Extend the workflow-shape test to require `$RUNNER_TEMP/sync-report.json` in the sync command, Job Summary command, and artifact path. It must reject `> sync-report.json` and `path: sync-report.json`.

- [ ] **Step 2: Run the layout test to verify it fails**

Run `node --test tests/skill-layout.test.mjs`.

Expected: failure because the report currently lives in the checkout.

- [ ] **Step 3: Move reports to the runner temporary directory**

Change the sync command to:

```yaml
run: |
  node skills/project/sync-upstream-skills/scripts/sync-skills.mjs apply --all > "$RUNNER_TEMP/sync-report.json"
```

Use `cat "$RUNNER_TEMP/sync-report.json"` for the Job Summary and `$RUNNER_TEMP/sync-report.json` for the artifact path. Keep `continue-on-error`, PR creation before failure re-raise, permissions, schedule and dispatch unchanged.

- [ ] **Step 4: Verify and commit**

Run `node --test tests/skill-layout.test.mjs tests/project/sync-upstream-skills.test.mjs` and `git diff --check`.

Expected: all selected tests pass and no new whitespace errors exist.

```bash
git add .github/workflows/sync-skills.yml tests/skill-layout.test.mjs
git commit -m "fix(ci): keep sync reports temporary"
```

## Final Verification

- [ ] Run `node --test tests/**/*.test.js tests/**/*.test.mjs` and require zero failures.
- [ ] Record `git status --short` before and after `node skills/project/sync-upstream-skills/scripts/sync-skills.mjs check --source superpowers`; both must be empty.
- [ ] Run `node skills/project/sync-upstream-skills/scripts/sync-skills.mjs apply --all`; for an accepted clean source it must return `up-to-date` and not modify README or `skills/sources.json`.
- [ ] Run `git diff --check f4a9767fd86a056a79d86b0057c672a9dd031dde..HEAD`; report the known byte-exact upstream trailing whitespace separately rather than changing mirror content.
