# rule-refine 规则治理优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `rule-refine` 能基于证据与规则归属，稳定决定候选经验应进入项目规则、项目索引、模块 README、设计/计划，还是不处理。

**Architecture:** 仅更新 Bamhub 自有的文档型 skill，不新增脚本或运行时依赖。现有“去重、去特定化、去常识化、用户确认后写入”的流程保留；在其前后加入候选四分流、规则类型与证据门槛、删除测试，并扩展输出模板。

**Tech Stack:** Markdown、Node.js 内置测试运行器。

## Global Constraints

- 仅修改 `skills/bamhub/maintenance/rule-refine/SKILL.md`，以及必要的文档契约测试。
- 保留 `<repo>/.project/README.md` 与 `<repo>/.project/rules/*.md` 的工具中立路径约定。
- 禁止自动写入未确认规则，禁止创建 `.claude/`、`.codex/` 或其他工具私有规则目录。
- 不把项目地图生成、模块 README 生成或根入口重建纳入本 skill。
- 不修改 `skills/superpowers/`、`skills/caveman/`、上游同步逻辑或其他 skill 行为。

---

## 文件清单

- Modify: `skills/bamhub/maintenance/rule-refine/SKILL.md` — 候选四分流、证据分类、删除测试、扩展输出与写入边界。
- Modify: `tests/skill-layout.test.mjs` — 添加 `rule-refine` 文档契约断言，防止关键治理约束被移除。

## Task 1: 为规则治理契约添加失败测试

**Files:**
- Modify: `bamhub-ai-tools-all-in-one/tests/skill-layout.test.mjs`

**Interfaces:**
- Consumes: `skills/bamhub/maintenance/rule-refine/SKILL.md` 的 UTF-8 文本。
- Produces: 对中立路径、四分流、规则分类和删除测试的契约校验。

- [x] **Step 1: 添加 `rule-refine` 治理契约测试**

  在 `tests/skill-layout.test.mjs` 的目录布局测试之后添加：

  ```js
  test('rule-refine keeps neutral governance routing', () => {
    const ruleRefine = fs.readFileSync(
      path.join(repoRoot, 'skills/bamhub/maintenance/rule-refine/SKILL.md'),
      'utf8'
    );

    assert.match(ruleRefine, /<repo>\/\.project\/rules\/\*\.md/);
    assert.match(ruleRefine, /<repo>\/\.project\/README\.md/);
    assert.match(ruleRefine, /<module>\/README\.md/);
    assert.match(ruleRefine, /事实规则/);
    assert.match(ruleRefine, /决策规则/);
    assert.match(ruleRefine, /偏好原则/);
    assert.match(ruleRefine, /删除该条内容/);
    assert.match(ruleRefine, /不得创建 `.claude\/`、`.codex\/`/);
  });
  ```

- [x] **Step 2: 运行测试确认失败**

  Run from `bamhub-ai-tools-all-in-one/`:

  ```bash
  node --test tests/skill-layout.test.mjs
  ```

  Expected: the new test fails because the current skill has no `<module>/README.md` routing, no three rule-type labels, and no deletion-test wording.

## Task 2: 实现四分流、证据门槛与删除测试

**Files:**
- Modify: `bamhub-ai-tools-all-in-one/skills/bamhub/maintenance/rule-refine/SKILL.md`

**Interfaces:**
- Consumes: current session conclusions, user emphasis, specified files or changes, `<repo>/.project/README.md`, `<repo>/.project/rules/*.md`, and relevant module README when the candidate is module-scoped.
- Produces: one of four candidate destinations; a candidate type; evidence; a deletion-test result for project-rule candidates; a user-confirmed write action only when eligible.

- [x] **Step 1: Add a “候选归属与证据” section before “规则准入筛选法”**

  Add this routing table and selection rule:

  ```md
  ## 候选归属与证据

  每条候选结论先确定唯一落点：

  | 落点 | 适用内容 |
  | --- | --- |
  | `<repo>/.project/rules/*.md` | 跨任务、跨模块、长期且可执行的专题约束 |
  | `<repo>/.project/README.md` | 规则索引、优先级、阅读路径或最小项目地图 |
  | `<module>/README.md` | 单个独立模块稳定成立的职责、边界、主链路或依赖事实 |
  | 设计/计划或不处理 | 任务专属决定、未验证方案、普通常识或临时经验 |

  多个落点都可用时，选择影响范围最小且仍能指导未来工作的落点；只有真正跨模块且跨任务的约束才进入 `.project/rules/`。

  每条候选同时标记为以下一种类型：

  - **事实规则**：由代码、配置、测试或稳定文档证明；必须列出证据文件或材料。
  - **决策规则**：团队希望未来遵循的选择；必须经用户明确确认才可写入。
  - **偏好原则**：协作方式或工程取向；仅当用户明确表达且会改变未来行为时保留。

  无证据的存量项目结论不得称为事实规则；将其作为待确认决策，或留在设计/计划。
  ```

- [x] **Step 2: Amend the screening workflow**

  At the start of “规则准入筛选法”, require the agent to identify the candidate’s destination and type before de-duplication. Preserve the existing six screening checks, but add this final check after “最终自检”:

  ```md
  7. **删除测试**
     - 删除该条内容，是否会让后续 Agent 更可能在重要决策上犯错？
     - 若答案为“否”或无法说明具体会避免的错误，不进入 `.project/rules/`。
  ```

  Keep the existing anti-pattern list. Add “没有行为影响的背景说明” and “无证据的存量项目愿望” to it.

- [x] **Step 3: Replace the initial three-way output with four-way routing**

  In “执行步骤”, replace the initial output categories with:

  ```md
  2. 对比现有规则和代码事实，先输出四分流结果：
     - 项目专题规则候选
     - 项目索引或模块 README 候选
     - 设计/计划保留项
     - 不处理项
  ```

  Require every project-rule candidate that remains after screening to include: `类型`、`证据`、`推荐落点`、`删除测试结论`、`推荐动作`。Project-index and module-README candidates retain the same fields except that the deletion test is not a rejection gate for stable facts.

- [x] **Step 4: Preserve the write gate and make it destination-aware**

  Keep “先把候选规则列表发给用户确认，不要直接改文件”. Under the write step, require that the agent update only the candidate’s confirmed existing destination; for `.project/rules/`, retain the existing requirement to read `.project/README.md` and reject tool-private fallback directories. Module README and project README candidates must likewise wait for explicit user confirmation.

- [x] **Step 5: Update the output template and acceptance criteria**

  Replace the current “一、已覆盖内容 / 二、不建议新增内容 / 三、候选规则” framing with sections for:

  ```md
  ### 一、四分流结果
  ### 二、项目规则候选
  ### 三、项目索引或模块 README 候选
  ### 四、设计/计划保留项与不处理项
  ### 五、待确认写入项
  ```

  For every project-rule item in section two, require the five fields from Step 3. For section three, require the same fields except `删除测试结论`. Retain the existing “建议落点” rationale within the item rather than duplicating a separate broad section.

- [x] **Step 6: Run the focused contract test**

  Run from `bamhub-ai-tools-all-in-one/`:

  ```bash
  node --test tests/skill-layout.test.mjs
  ```

  Expected: PASS, including `rule-refine keeps neutral governance routing`.

## Task 3: Verify no governance regression in the ai-tool repository

**Files:**
- Verify: `bamhub-ai-tools-all-in-one/skills/bamhub/maintenance/rule-refine/SKILL.md`
- Verify: `bamhub-ai-tools-all-in-one/tests/skill-layout.test.mjs`
- Verify: `bamhub-ai-tools-all-in-one/tests/project/sync-upstream-skills.test.mjs`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces: regression evidence for the changed contract and existing skill repository layout.

- [x] **Step 1: Scan for required and forbidden routing language**

  Run from `bamhub-ai-tools-all-in-one/`:

  ```bash
  rg -n '<repo>/\.project/(README\.md|rules/\*\.md)|<module>/README\.md|事实规则|决策规则|偏好原则|删除该条内容' skills/bamhub/maintenance/rule-refine/SKILL.md
  rg -n '不得创建 `\.claude/`、`\.codex/`' skills/bamhub/maintenance/rule-refine/SKILL.md
  ```

  Expected: both commands find the specified governance constraints.

- [x] **Step 2: Run the relevant ai-tool test set**

  Run from `bamhub-ai-tools-all-in-one/`:

  ```bash
  node --test tests/skill-layout.test.mjs tests/project/sync-upstream-skills.test.mjs
  ```

  Expected: all tests pass.

- [x] **Step 3: Review scope and whitespace**

  Run from `bamhub-ai-tools-all-in-one/`:

  ```bash
  git diff --check -- skills/bamhub/maintenance/rule-refine/SKILL.md tests/skill-layout.test.mjs
  git diff --name-only -- skills/bamhub/maintenance/rule-refine/SKILL.md tests/skill-layout.test.mjs
  ```

  Expected: no whitespace errors; only the two planned implementation files appear. The design and plan documents remain separate untracked documentation until the user chooses how to commit them.

## Plan Self-Review

- Spec coverage: Task 1 locks the new governance vocabulary with a failing test; Task 2 implements all four decisions; Task 3 verifies the changed contract and existing repository layout.
- Placeholder scan: no deferred actions or unspecified file targets remain.
- Interface consistency: tests and skill use the same neutral `<repo>/.project/` and `<module>/README.md` paths, the same three candidate types, and the same deletion-test phrase.
