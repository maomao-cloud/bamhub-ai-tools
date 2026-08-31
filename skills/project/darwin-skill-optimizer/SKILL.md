---
name: darwin-skill-optimizer
description: Use when evaluating or incrementally improving Bamhub-owned skills with Darwin's validation-gated workflow.
---

# Darwin Skill Optimizer

使用本项目适配层优化 Bamhub 自有 skill。开始前必须完整阅读 `skills/darwin/SKILL.md` 及其引用的本地资源；Darwin 镜像本身只能通过上游同步更新。

## 范围

- 默认候选范围是 `skills/bamhub/**/SKILL.md`。
- 首次优化范围限定为 `skills/bamhub/maintenance/**/SKILL.md`，但排除 `skills/bamhub/maintenance/version-changelog/SKILL.md`。
- `version-changelog` 当前绑定特定项目路径、Maven 结构和分支约定，作为项目专属维护 skill 保留；不得用 Darwin 通用 rubric 优化，除非先完成单独的可复用化设计和测试集迁移。
- 不得优化 `skills/superpowers/`、`skills/caveman/` 或 `skills/darwin/` 下的任何文件。
- 每个目标的测试样本位于其同目录 `test-prompts.json`；历史记录位于 `docs/skill-optimization/results.tsv`。
- 可选结果卡只写入 `docs/skill-optimization/cards/`，不能作为保留改动的依据。

## 执行流程

1. 读取目标 `SKILL.md`、`test-prompts.json` 和已有 `docs/skill-optimization/results.tsv`。缺少或无效测试样本时停止该目标，记录错误，不编辑 skill。
2. 为每个目标展示 2–3 个测试 prompts 并取得用户确认；未经确认不得开始基线或编辑。
3. 使用 Darwin 的 9 维 rubric 做结构评分；对每个确认的 prompt 由独立 agent 分别执行带 skill 与不带 skill 的对照。记录 `full_test`；独立 agent 不可用时仅能记录 `dry_run`，并在报告中警告。
4. 每轮只编辑一个目标 `SKILL.md`，并只处理一个最低维度或其明确相关簇；不改变该 skill 的核心用途、不增加未批准依赖。
5. 每次编辑后使用新的独立 agent 重跑对照；keep/revert 必须由奇数个独立 judge 在同一次调用内成对比较改前、改后版本，并按多数决判定。绝对总分只用于 triage，不能作为保留或回滚依据；多数判定改后较差时使用 `git revert` 回滚该轮提交，禁止 `git reset --hard`。
6. 将每次基线、保留、回滚和错误写入 `docs/skill-optimization/results.tsv`：

```tsv
timestamp	commit	skill	old_score	new_score	status	dimension	note	eval_mode
```

7. 每个目标完成后展示 diff、各维评分变化和测试对照，设置 🔴 CHECKPOINT，等待用户确认后才能继续下一个目标。

## 输出与故障处理

- `eval_mode` 只能是 `paired`、`full_test` 或 `dry_run`；不得把 dry run 描述为实测。`paired` 行在 `new_score` 记录投票结果（如 `3-0 better`）。
- 若连续两轮增益低于 2 分，停止该目标，避免为分数堆砌内容。
- 可选生成结果卡时，使用 Darwin 的 `scripts/screenshot.mjs`；截图失败只报告失败，不影响优化评分或 Git 决策。
- 结果日志、测试样本和用户确认共同构成可审计依据；不要自动批量修改全部 Bamhub skill。
