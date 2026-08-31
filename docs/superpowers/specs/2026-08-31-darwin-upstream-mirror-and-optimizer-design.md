# Darwin 上游镜像与 Skill 优化适配设计

## 目标

将 `alchaincyf/darwin-skill` 作为受版本控制的完整上游镜像纳入本仓库，并新增一个仅服务本仓库的适配 skill，使 Bamhub 自有 skills 能持续按照 Darwin 的评估、验证和人工确认流程优化。

完成后，GitHub Actions 的既有同步工作流会与 Superpowers、Caveman 一样检查 Darwin 上游并创建更新 PR；日常使用不依赖单独安装插件或手动复制文件。

## 范围与非目标

范围：

- 镜像 Darwin 上游仓库根目录的完整内容到 `skills/darwin/`。
- 将 Darwin 注册为 `skills/sources.json` 中独立的第三方 source。
- 保持 `skills/darwin/` 只读：只通过 `sync-upstream-skills` 更新。
- 新建 `skills/project/darwin-skill-optimizer/`，把 Darwin 的通用方法映射到本仓库的目录、日志和验证方式。
- 首批优化目标为 `skills/bamhub/maintenance/**/SKILL.md`。

非目标：

- 不修改 `skills/superpowers/`、`skills/caveman/` 或 `skills/darwin/` 内的上游文件。
- 不把 Darwin 伪装为拥有 hook、专用 agent、MCP server 或常驻任务的插件；上游实际不提供这些组件。
- 不在开发者机器配置 cron、launchd 或其他本地定时器。
- 不让 Darwin 自动改写所有 skill；每轮仍要求独立评估与用户确认。

## 架构与所有权

```text
skills/
  darwin/                         # 上游完整镜像；同步器独占写入
    SKILL.md                      # Darwin 评估与优化流程
    references/ templates/ scripts/ assets/ ...
  bamhub/maintenance/             # 首批被优化的自有 skill
    <skill>/SKILL.md
    <skill>/test-prompts.json     # 目标 skill 的版本化评测样本
  project/darwin-skill-optimizer/ # Darwin 的本仓库执行适配层
    SKILL.md
docs/skill-optimization/
  results.tsv                     # 跨轮次、版本化的评估记录
```

`skills/darwin/` 保留上游全部 38 个文件，包括引用资料、结果卡模板与截图脚本。虽然 `SKILL.md` 是核心入口，但完整镜像确保其相对路径资源可用，也便于上游更新不遗漏文件。

Darwin 的“独立子 agent”由当前宿主运行时派生，不是仓库内的 `agents/` 文件。结果卡截图是可选展示功能，无法运行时不影响评分、验证和优化流程。

## 上游同步

在 `skills/sources.json` 添加 `darwin` source：

- repository：`https://github.com/alchaincyf/darwin-skill.git`
- ref：`main`
- root mapping：上游 `.` → `skills/darwin`

现有同步器必须支持“根目录本身有 `README.md`”的单 skill 上游。Darwin source 显式选择 `metadataFile: ".bamhub-sync.md"`：上游 `README.md` 原样保留，Bamhub 的来源元数据与可选 AI 内容写入该隐藏文件。该文件按与现有受管 README 相同的标记格式校验和保留；目录完整性摘要忽略配置的元数据文件，而不忽略上游 README。其他现有来源保持默认的 `README.md` 元数据文件，以避免迁移无关镜像。

现有 GitHub Actions 保持每日 `apply --all` 与创建 PR 的行为。同步只能更新 `skills/darwin/`、Darwin 的 source 状态与该目录受管 README，不触及 Bamhub 自有 skill 或优化日志。

## 项目适配层与执行流程

`skills/project/darwin-skill-optimizer/SKILL.md` 负责消除 Darwin 原版的路径假设。该名称刻意绑定 Darwin，避免未来接入其他上游优化框架时把它误认为通用且唯一的优化入口：

- 明确优化对象默认为 `skills/bamhub/**/SKILL.md`；首次范围限定为 `skills/bamhub/maintenance/**/SKILL.md`。
- 禁止优化任何受管上游镜像：`skills/superpowers/`、`skills/caveman/`、`skills/darwin/`。
- 将历史日志固定为 `docs/skill-optimization/results.tsv`。
- 将每个目标的测试样本固定为目标目录内的 `test-prompts.json`。
- 结果卡若生成，写入 `docs/skill-optimization/cards/`；仅是可选工件，不是保留改动的依据。

优化流程保持 Darwin 的关键约束：先展示并确认测试 prompts；每轮只编辑一个 `SKILL.md`；结构评价与效果验证分离；效果验证使用独立 agent 的带/不带 skill 对照；分数下降则用 `git revert` 回滚；每个 skill 完成后暂停让用户审阅。

## 记录格式与验证

`results.tsv` 使用 Darwin 既有九列：

```tsv
timestamp	commit	skill	old_score	new_score	status	dimension	note	eval_mode
```

`eval_mode` 只能是 `full_test` 或 `dry_run`。若独立 agent 不可用，应记录 `dry_run`，并在报告中显式警告；不会把干跑当成完整验证。

实施将补充或扩展 Node 内置测试，至少覆盖：

- `sources.json` 中 Darwin source 的合法性和受管目录边界；
- 同步器可以安全处理 Darwin 上游根目录的 README；
- `darwin-skill-optimizer` 的默认目标、排除目录、日志和测试 prompt 路径都被明确文档化；
- 维护类三个 skill 的首批 `test-prompts.json` 是有效 JSON、包含典型与较复杂场景。

## 失败处理与安全边界

- `check` 只读；`apply` 在 Darwin 目标目录有未提交改动时拒绝执行，除非操作者明确传 `--force`。
- 上游下载或根目录校验失败时，不修改镜像或 source 状态。
- 某个优化目标没有 `SKILL.md` 或测试样本无效时，记录错误并跳过，不进行编辑。
- 评分未严格提升时，用 `git revert` 保留历史；禁止 `git reset --hard`。
- 优化适配层不能改变目标 skill 的核心用途、添加未批准依赖，或在没有用户检查点时继续下一 skill。

## 验收标准

- Darwin 上游可以通过仓库现有同步器完整、可重复地同步，并由每日 GitHub Actions 自动创建更新 PR。
- 上游镜像包含其 `SKILL.md`、references、templates、脚本、assets、README 与许可证，不依赖另行安装插件。
- 仓库存在明确适配层，避免原版 `.claude/skills` 和 `.claude/skills/darwin-skill/results.tsv` 路径误导本项目执行。
- maintenance 三个自有 skill 均具备经过用户确认的评测样本，且其优化历史可审计、可回滚。
