# 同步输出中文化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Bamhub 生成的上游 skill README 和项目级同步说明提供中文输出，同时保持上游镜像原样并取消旧平级兼容别名。

**Architecture:** `sync-skills.mjs` 在生成 README 时使用项目本地的 Superpowers 中文描述映射；未知 skill 和其他来源使用中文兜底提示。上游 `SKILL.md` 不改动。`AGENTS.md` 与布局测试把已删除的 `skills/brainstorming/visual-companion.md` 明确为不存在的旧路径。

**Tech Stack:** Node.js 22 内置模块、`node:test`、Git CLI。

## Global Constraints

- 不直接修改 `skills/superpowers/**` 的上游文件；同步器管理的 `skills/superpowers/README.md` 是唯一例外。
- README 的来源 URL、ref、commit 与 skill 目录名保持原值；人类可读的标题、标签、说明和场景使用中文。
- Superpowers 已知 14 个 skill 必须有中文展示描述；未知 skill 和未来来源使用中文兜底，不调用 AI 或远程翻译服务。
- `skills/project/sync-upstream-skills/SKILL.md` 全文中文，但 CLI 命令、来源 ID、JSON `status` 值和错误码不变。
- 不恢复 `skills/brainstorming/visual-companion.md`；不建立任何旧平级路径兼容别名。

---

### Task 1: Generate Chinese local sync guides

**Files:**
- Modify: `skills/project/sync-upstream-skills/scripts/sync-skills.mjs`
- Modify: `skills/project/sync-upstream-skills/SKILL.md`
- Modify: `tests/project/sync-upstream-skills.test.mjs`
- Modify: `skills/superpowers/README.md` (regenerate only through the synchronizer)

**Interfaces:**
- Consumes: source ID plus discovered `{ name, description }` entries from current upstream `SKILL.md` files.
- Produces: Chinese target-root README while keeping exported JSON status fields unchanged.

- [ ] **Step 1: Write failing localization tests**

Update the deterministic README fixture test to assert `# Demo 技能`、`来源: file:`、`## 使用方法`、`## 适用场景`、`## 通用流程` and the fallback `请阅读 \`demo/SKILL.md\` 获取完整用法。`. Add a `superpowers` fixture with `brainstorming/SKILL.md` that asserts `在开始实现前梳理需求、方案和验收标准。`. Assert the real README contains `# Superpowers 技能` and that Chinese brainstorming description.

- [ ] **Step 2: Run the focused test file to verify red state**

Run `node --test tests/project/sync-upstream-skills.test.mjs`.

Expected: FAIL because headings, labels and descriptions are currently English.

- [ ] **Step 3: Add deterministic Chinese display helpers and template**

Add `SUPERPOWERS_ZH_DESCRIPTIONS` with all source names and these exact translations: `brainstorming` “在开始实现前梳理需求、方案和验收标准。”; `dispatching-parallel-agents` “在多个互不依赖的任务可并行时分派代理。”; `executing-plans` “在独立会话中按书面计划执行并保留审查检查点。”; `finishing-a-development-branch` “在实现和测试完成后选择合并、PR 或保留分支的交付方式。”; `receiving-code-review` “接收审查反馈时先验证问题，再有针对性地修复。”; `requesting-code-review` “在完成重要改动后请求独立代码审查。”; `subagent-driven-development` “在当前会话中按任务分派实现者并逐项复审。”; `systematic-debugging` “遇到故障或意外行为时按系统化步骤定位原因。”; `test-driven-development` “实现功能或修复前先编写可失败的测试。”; `using-git-worktrees` “开始需要隔离的开发前建立或确认 Git worktree。”; `using-superpowers` “每次对话开始时发现并调用适用的 skill。”; `verification-before-completion` “在声明完成、提交或创建 PR 前运行新鲜验证。”; `writing-plans` “将已确认的需求写成可执行的分步骤计划。”; `writing-skills` “创建、修改和验证可复用 skill。”.

Implement `localizeSkillDescription(sourceId, name)`: return the map only for `superpowers`; otherwise return `请阅读 \`${name}/SKILL.md\` 获取完整用法。`. Generate this exact localized body shape:

```js
const body = `# ${sourceTitle} 技能\n\n来源: ${source.repository}\n跟踪引用: ${source.ref}\n已接受提交: ${targetCommit}\n上次成功同步: ${acceptedAt}\n\n## 使用方法\n\n从下方选择匹配的 skill，阅读完整 \`SKILL.md\` 与其引用的本地资源，再按说明执行。\n\n## 适用场景\n\n${availableSkills}\n\n## 通用流程\n\n1. 选择与请求匹配的 skill。\n2. 阅读其 \`SKILL.md\` 和引用资源。\n3. 按流程执行，并运行其要求的验证。\n`;
```

Update `sync-upstream-skills/SKILL.md` front matter description and all prose to Chinese, preserving commands verbatim.

- [ ] **Step 4: Regenerate, verify and commit**

Run `node skills/project/sync-upstream-skills/scripts/sync-skills.mjs apply --source superpowers --force`, `node --test tests/project/sync-upstream-skills.test.mjs`, and `git diff --check`. Expected: Chinese README and passing focused tests.

```bash
git add skills/project/sync-upstream-skills/scripts/sync-skills.mjs skills/project/sync-upstream-skills/SKILL.md tests/project/sync-upstream-skills.test.mjs skills/superpowers/README.md
git commit -m "feat(sync): localize generated guides"
```

### Task 2: Remove the obsolete brainstorming alias contract

**Files:**
- Modify: `AGENTS.md`
- Modify: `tests/skill-layout.test.mjs`

**Interfaces:**
- Consumes: the user-approved removal of `skills/brainstorming/visual-companion.md`.
- Produces: repository guidance and tests that require no legacy flat brainstorming path or duplicate local skill content.

- [ ] **Step 1: Write failing absence/documentation tests**

Replace the compatibility-alias test with assertions that `fs.existsSync(path.join(repoRoot, 'skills/brainstorming'))` and `fs.existsSync(path.join(repoRoot, 'skills/brainstorming/visual-companion.md'))` are both false. Update the AGENTS assertion to require the old path be described as unsupported or absent, and reject “兼容别名”.

- [ ] **Step 2: Run the layout test to verify red state**

Run `node --test tests/skill-layout.test.mjs`.

Expected: FAIL because `AGENTS.md` still documents the deleted path as an alias.

- [ ] **Step 3: Update repository guidance**

Remove the alias paragraph from `AGENTS.md`. Add one concise Chinese sentence: 上游镜像可能引用旧平级路径，但本仓库不提供这些兼容路径；应使用 `skills/superpowers/`、`skills/bamhub/` 和 `skills/project/` 下的分类目录。 Do not add a symlink, directory, copied companion file, or edit under `skills/superpowers/`.

- [ ] **Step 4: Verify and commit**

Run `node --test tests/skill-layout.test.mjs tests/project/sync-upstream-skills.test.mjs` and `git diff --check`. Expected: selected tests pass and legacy path remains absent.

```bash
git add AGENTS.md tests/skill-layout.test.mjs
git commit -m "docs(skills): remove legacy alias"
```

## Final Verification

- [ ] Run `node --test tests/**/*.test.js tests/**/*.test.mjs` and require zero failures.
- [ ] Run `node skills/project/sync-upstream-skills/scripts/sync-skills.mjs check --source superpowers`; confirm JSON status fields remain unchanged and the worktree remains clean.
- [ ] Run `git diff --check`; report any pre-existing upstream mirror whitespace without changing the mirror.
