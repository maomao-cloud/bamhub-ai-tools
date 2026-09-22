# Darwin 上游镜像与 Skill 优化适配 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Darwin 作为可自动同步的完整上游镜像接入仓库，并提供面向 Bamhub 自有 skills 的优化适配层和 maintenance 评测样本。

**Architecture:** `skills/darwin/` 是同步器唯一写入的上游镜像。同步器添加可选 `metadataFile`，使 Darwin 使用 `.bamhub-sync.md` 保存 Bamhub 元数据、保留上游根 `README.md`。`skills/project/darwin-skill-optimizer/` 将 Darwin 方法映射到仓库路径。

**Tech Stack:** Node.js 22、Node 内置 `node:test`、ES modules、Git、GitHub Actions。

## Global Constraints

- 不直接改 `skills/superpowers/`、`skills/caveman/` 或 `skills/darwin/`。
- Darwin source：`https://github.com/alchaincyf/darwin-skill.git`、`master`、`5539516444cff4eed7865daf61a707590acda485`。
- Darwin 元数据固定为 `skills/darwin/.bamhub-sync.md`；上游 `README.md` 逐字保留。
- 优化范围仅 `skills/bamhub/**/SKILL.md`；首批 `skills/bamhub/maintenance/**/SKILL.md`。
- 未严格提升时只用 `git revert`，禁止 `git reset --hard`。

---

### Task 1: 为同步器支持自定义元数据文件

**Files:**
- Modify: `skills/project/sync-upstream-skills/scripts/sync-skills.mjs`
- Modify: `tests/project/sync-upstream-skills.test.mjs`

**Interfaces:** 可选 `source.metadataFile?: string`；默认 `README.md`；`metadataFileFor(source)` 返回验证后的相对路径。

- [ ] **Step 1: 写失败测试**

将“上游根 README 失败”测试替为：上游有 `README.md` 与 `SKILL.md`、source 有 `metadataFile: '.bamhub-sync.md'`。`apply` 后断言：

```js
assert.equal(result.exitCode, 0);
assert.equal(await read(fixture.repoRoot, 'skills/demo-source/README.md'), 'upstream metadata\n');
assert.match(await read(fixture.repoRoot, 'skills/demo-source/.bamhub-sync.md'), /bamhub-sync-metadata:start/);
```

再提交只修改上游 README 的提交，断言目标 README 更新而 metadata content block 被保留。

- [ ] **Step 2: 运行失败测试**

Run: `node --test tests/project/sync-upstream-skills.test.mjs --test-name-pattern="root README"`

Expected: FAIL，当前 `validateUpstreamRoots` 抛 `ROOT_README_RESERVED`。

- [ ] **Step 3: 最小实现**

加入：

```js
function metadataFileFor(source) {
  return source.metadataFile ?? 'README.md';
}
```

将 `readManagedReadme`、`readmeMatches`、`prepareReplacement` 和目录摘要忽略规则改为接收 metadataFile。`prepareReplacement` 只覆盖 metadataFile；因此 Darwin README 保留。`validateUpstreamRoots` 仅当 metadataFile 为 README 时拒绝上游 README；若上游已有自定义 metadataFile，抛 `METADATA_FILE_CONFLICT`。`validateSource` 拒绝绝对、`..`、`.`、`.git` 及其后代路径。仅默认 README source 可走 legacy README 迁移。

- [ ] **Step 4: 回归验证**

Run: `node --test tests/project/sync-upstream-skills.test.mjs`

Expected: PASS。另新增 `../README.md`、`/tmp/x`、`.git/config` 及上游 metadata 文件冲突的失败测试。

- [ ] **Step 5: Commit**

```bash
git add skills/project/sync-upstream-skills/scripts/sync-skills.mjs tests/project/sync-upstream-skills.test.mjs
git commit -m "feat(sync): preserve upstream root readmes"
```

### Task 2: 注册并镜像 Darwin 上游

**Files:**
- Modify: `skills/sources.json`, `README.md`, `AGENTS.md`, `CLAUDE.md`
- Create: `skills/darwin/`（同步器生成）
- Modify: `tests/project/sync-upstream-skills.test.mjs`, `tests/skill-layout.test.mjs`

**Interfaces:** `sources.darwin` 用 `{ upstream: '.', target: 'skills/darwin' }` 与 `.bamhub-sync.md`。

- [ ] **Step 1: 写失败测试**

新增真实仓库测试，断言 Darwin source、`SKILL.md`、`README.md`、`LICENSE`、`scripts/screenshot.mjs` 均存在，且 `.bamhub-sync.md` 符合现有 metadata 契约。将 `skills/darwin` 加入受管根测试；断言三份仓库说明将其标为不直接修改的上游镜像。

- [ ] **Step 2: 运行失败测试**

Run: `node --test tests/project/sync-upstream-skills.test.mjs tests/skill-layout.test.mjs`

Expected: FAIL，Darwin 尚未注册。

- [ ] **Step 3: 注册并同步**

添加：

```json
"darwin": {
  "repository": "https://github.com/alchaincyf/darwin-skill.git",
  "ref": "master",
  "acceptedCommit": "5539516444cff4eed7865daf61a707590acda485",
  "acceptedAt": "2026-08-31T00:00:00.000Z",
  "metadataFile": ".bamhub-sync.md",
  "roots": [{ "upstream": ".", "target": "skills/darwin" }]
}
```

运行 `check --source darwin`；仅当 target commit 相同时运行 `apply --source darwin`。如已变化，审阅 `changedFiles` 并更新 accepted state，绝不手工复制。

- [ ] **Step 4: 文档和验证**

三份仓库说明需写明：Darwin 无内置 hooks、专用 agents、MCP server 或后台进程；独立评委由宿主 runtime 派生。

Run: `node --test tests/project/sync-upstream-skills.test.mjs tests/skill-layout.test.mjs && node skills/project/sync-upstream-skills/scripts/sync-skills.mjs check --source darwin`

Expected: PASS；Darwin `up-to-date`。

- [ ] **Step 5: Commit**

```bash
git add skills/sources.json skills/darwin README.md AGENTS.md CLAUDE.md tests/project/sync-upstream-skills.test.mjs tests/skill-layout.test.mjs
git commit -m "feat(skills): mirror Darwin upstream"
```

### Task 3: 添加 Darwin 项目适配层

**Files:**
- Create: `skills/project/darwin-skill-optimizer/SKILL.md`
- Modify: `README.md`, `AGENTS.md`, `CLAUDE.md`, `tests/skill-layout.test.mjs`

**Interfaces:** 消费 `skills/darwin/SKILL.md`；记录 `docs/skill-optimization/results.tsv`；只优化 Bamhub 自有 skill。

- [ ] **Step 1: 写失败测试**

将适配 skill 加入 `categorizedSkills`。测试它包含 `skills/darwin/SKILL.md`、`skills/bamhub/**/SKILL.md`、`skills/bamhub/maintenance/**/SKILL.md`、`docs/skill-optimization/results.tsv`、`docs/skill-optimization/cards/`、`test-prompts.json`；排除三个上游目录；包含 `git revert`、`full_test`、`dry_run` 与用户确认。

- [ ] **Step 2: 运行失败测试**

Run: `node --test tests/skill-layout.test.mjs --test-name-pattern="Darwin|categorized"`

Expected: FAIL，适配 skill 不存在。

- [ ] **Step 3: 编写最小适配 skill**

使用：

```yaml
---
name: darwin-skill-optimizer
description: Use when evaluating or incrementally improving Bamhub-owned skills with Darwin's validation-gated workflow.
---
```

正文规定：读 Darwin；限定目标；创建/读取九列日志；展示并确认每个目标 2–3 个测试样本；独立带/不带 skill 对照；单 skill、单维度；仅严格提升保留；否则 `git revert`；`full_test`/`dry_run`；每个 skill 后用户检查点；可选卡片目录。

- [ ] **Step 4: 验证并提交**

Run: `node --test tests/skill-layout.test.mjs`

Expected: PASS。

```bash
git add skills/project/darwin-skill-optimizer/SKILL.md README.md AGENTS.md CLAUDE.md tests/skill-layout.test.mjs
git commit -m "feat(skills): add Darwin optimizer adapter"
```

### Task 4: 添加 maintenance 测试样本和审计日志

**Files:**
- Create: `skills/bamhub/maintenance/{rule-refine,sync-module-doc,version-changelog}/test-prompts.json`
- Create: `docs/skill-optimization/results.tsv`
- Create: `tests/project/darwin-skill-optimizer.test.mjs`

**Interfaces:** 每个 JSON 是长度 2–3 的 `[{ id, prompt, expected }]`；日志的表头有 9 列。

- [ ] **Step 1: 写失败测试**

断言每个 JSON 是 2 或 3 项数组，每项 `id`、`prompt`、`expected` 为非空字符串。断言 `results.tsv` 第一行严格为：

```js
'timestamp\tcommit\tskill\told_score\tnew_score\tstatus\tdimension\tnote\teval_mode'
```

且无记录行。

- [ ] **Step 2: 运行失败测试**

Run: `node --test tests/project/darwin-skill-optimizer.test.mjs`

Expected: FAIL，资产缺失。

- [ ] **Step 3: 创建样本**

每个 skill 写两条真实用户 prompt：`rule-refine` 覆盖“局部经验不升格规则”与“跨模块稳定约束”；`sync-module-doc` 覆盖“仅可选措辞改进保持不变”与“主链路变化必须更新”；`version-changelog` 覆盖“无 master..HEAD 差异不写文件”与“feat/fix 按模块分类”。创建仅有表头的日志。

- [ ] **Step 4: 验证并提交**

Run: `node --test tests/project/darwin-skill-optimizer.test.mjs && node --test tests/**/*.test.js tests/**/*.test.mjs`

Expected: PASS。

```bash
git add skills/bamhub/maintenance/*/test-prompts.json docs/skill-optimization/results.tsv tests/project/darwin-skill-optimizer.test.mjs
git commit -m "test(skills): add Darwin maintenance baselines"
```

### Task 5: 最终验证和首次只读基线准备

**Files:** Verify all Task 1–4 files.

- [ ] **Step 1: 验证上游与测试**

Run: `node skills/project/sync-upstream-skills/scripts/sync-skills.mjs check --all && node --test tests/**/*.test.js tests/**/*.test.mjs && git diff --check`

Expected: check 无工作树写入、测试 PASS、diff check 无输出。

- [ ] **Step 2: 审阅边界**

Run: `git diff -- skills/sources.json skills/project/sync-upstream-skills skills/darwin skills/project/darwin-skill-optimizer skills/bamhub/maintenance docs/skill-optimization README.md AGENTS.md CLAUDE.md`

Expected: 未修改 Superpowers/Caveman；Darwin README 保留、metadata 独立。

- [ ] **Step 3: 用户检查点**

展示三份 `test-prompts.json`，声明下一阶段是只读基线 `full_test` 对照评分；未获确认不得修改 maintenance `SKILL.md`。
