# Skill 分类与上游同步设计

## 目标

将当前平级的 skill 按来源和所有权分类；把 `obra/superpowers` 的 skill 保留为可定期更新的本地完整镜像；同时让 Bamhub 自有能力独立演进。运行时只使用仓库中的本地文件，不依赖远程插件、hooks 或平台配置。

## 范围与非目标

首期同步来源仅为 `https://github.com/obra/superpowers.git`，但配置必须支持将来接入更多来源。同步仅复制明确配置的 skill 根目录及其子文件；不会复制上游的 `.claude-plugin/`、`.codex-plugin/`、`hooks/`、CI、根目录脚本或其他平台适配逻辑。首期镜像上游全部 14 个 skill，而不是只保留现有四个本地副本。

不直接修改 `skills/superpowers/` 中的内容。需要按团队实际调整的行为以独立 Bamhub skill 实现，避免上游更新覆盖本地定制。

## 目录结构

```text
skills/
  superpowers/                # obra/superpowers 的完整本地 skill 镜像与来源 README
  bamhub/
    architecture/             # code-arch、confirming-architecture、design-retrospective
    integrations/             # shared-auth、kibana-search
    maintenance/              # rule-refine、sync-module-doc、version-changelog
    productivity/             # lyra-prompt-optimizer
  project/
    sync-upstream-skills/     # 仅服务本仓库的上游镜像同步 skill
  sources.json                # 所有上游来源的受版本控制清单与状态
.github/workflows/
  sync-skills.yml             # 周期性检查与更新 PR
```

`skills/bamhub/` 是本仓库的品牌和所有权边界。每个本地 skill 保持自己的 `SKILL.md` 与支持文件；若它取代或适配某个 Superpowers skill，应在自身文档中说明来源与差异。

`skills/project/sync-upstream-skills/` 是项目级 skill，不承诺跨仓库复用。它包含 `SKILL.md` 和无第三方依赖的 `scripts/sync-skills.mjs`，说明如何检查、应用、查看报告和处理来源异常。`AGENTS.md` 必须标明 `skills/project/` 仅服务本仓库，并给出此 skill 的人工运行入口。

每个来源根目录的目标位置都生成并维护一个 Bamhub 本地 `README.md`；例如首期为 `skills/superpowers/README.md`。它属于同步元数据，不是从上游复制的内容。

## 来源清单

`skills/sources.json` 是单一配置文件。每个 `sources.<id>` 条目独立记录仓库 URL、分支或 ref、上次接受的提交、上次成功应用更新时间，以及允许同步的根目录映射：

```json
{
  "version": 1,
  "sources": {
    "superpowers": {
      "repository": "https://github.com/obra/superpowers.git",
      "ref": "main",
      "acceptedCommit": "d884ae04edebef577e82ff7c4e143debd0bbec99",
      "acceptedAt": "2026-07-21T00:00:00Z",
      "roots": [
        { "upstream": "skills", "target": "skills/superpowers" }
      ]
    }
  }
}
```

未来来源不必使用 `skills/` 这一固定路径：为其配置一个或多个 `roots` 映射即可。每个映射的上游目录必须包含 `SKILL.md` 或其后代 skill；同步程序只复制这些目录树。`README.md` 为目标根目录保留给 Bamhub 同步说明；若某上游根目录自身也包含同名文件，该映射校验失败，必须改用更精确的根目录后才能同步，避免静默覆盖上游或本地说明。

## 来源 README 与更新说明

每次成功 `apply` 后，同步程序在每个受影响的目标根目录重建 `README.md`。内容至少包括：来源标识和仓库 URL、所跟踪的 ref、当前已接受提交、上次成功更新时间、可用 skill 清单及其 `SKILL.md` 元数据中的名称和简短描述、以及查看各 skill 完整用法的路径说明。

README 的更新说明有确定性兜底，不依赖 AI：程序根据旧提交与新提交的 `git diff --name-status` 输出新增、修改、删除的文件，并按受影响 skill 汇总。因此 GitHub Actions、离线开发环境和无模型凭据的机器都能完成同步。

当调用方具有 AI 能力时，可以先让 AI 读取 `check` 生成的 JSON 报告并产出一份 Markdown 摘要，再通过 `apply --summary-file <path>` 传入。该摘要写入 README 的“更新说明”段落，用于解释面向使用者的变化；摘要文件缺失、格式无效或 AI 调用失败时，`apply` 忽略该可选输入并保留确定性文件清单。同步的正确性、提交更新和 PR 创建绝不依赖 AI。

## 同步行为与隔离

命令为：

```bash
node tools/sync-skills.mjs check --source superpowers
node tools/sync-skills.mjs apply --source superpowers
node tools/sync-skills.mjs check --all
```

同步会在临时目录获取指定上游提交，验证所有映射，再比较最新提交与 `acceptedCommit`。`check` 不写入仓库，输出 JSON 与可读摘要。`apply` 仅在全部映射有效后，用完整上游树更新该来源的目标目录、来源 README、`acceptedCommit` 和 `acceptedAt`。

若目标目录有未提交改动，`apply` 默认拒绝执行；`--force` 是明确丢弃这些改动的唯一方式。下载失败、配置无效、根目录缺失或不含 skill 时，目标目录与清单均不发生变化。

来源级隔离是强制约束：每个来源各自下载、验证、写入、更新其在 `sources.json` 中的字段并生成独立报告。`--all` 继续处理其余来源；一个来源失败不影响其他来源的更新结果。

## 自动化与验证

GitHub Actions 每周与手动触发（`workflow_dispatch`）时执行 `check --all`。它运行在 GitHub 托管运行器上，不要求在开发者的 Mac 安装 `launchd`、cron 或任何常驻定时器。有可用更新时，工作流在干净临时分支执行对应的 `apply`，并创建更新 PR；不会直接推送 `develop`。同一运行中可将多个成功来源的更新放入一个 PR。某来源失败时仍保留其他成功来源的更新，并在 Job Summary 和来源报告中记录失败。

迁移必须更新现有硬编码路径，包括认证与 Kibana 测试、brainstorming 脚本说明、`CLAUDE.md` 和 `AGENTS.md`。`AGENTS.md` 还要说明项目级同步 skill 的范围、人工执行方式和 GitHub 托管定时策略。测试覆盖以下验收条件：

- 所有清单映射和目标 skill 均可递归发现 `SKILL.md`；
- `check` 不修改文件；
- `apply` 只触碰该来源允许的目标目录；
- 脏镜像拒绝更新，`--force` 才允许覆盖；
- 无效来源或缺失根目录不产生部分写入；
- 批量同步时某来源失败不阻断其他来源；
- Superpowers 镜像不包含插件、hooks 或上游根目录配置。
- 每个受影响来源根目录生成 README，包含来源、提交、同步时间、skill 清单和无 AI 也可生成的变更文件摘要；
- 可选 AI 摘要无法生成时不会阻断同步，README 仍保留确定性变更说明。

迁移完成后还要在实际目标 agent 环境中手动确认分层目录下的 skill 仍可被发现。
