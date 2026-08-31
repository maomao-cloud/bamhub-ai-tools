# CLAUDE.md

本文件为 Claude Code（claude.ai/code）在此仓库中工作时提供指引。

## 仓库概览

这个仓库是一个 Claude Code skills 仓库，不是传统的应用服务项目。核心资产位于 `skills/`，每个 skill 以 `SKILL.md` 为入口。目录所有权必须保持清晰：

- `skills/superpowers/`：上游 Superpowers 的完整可替换镜像；不要直接修改。
- `skills/caveman/`：上游 Caveman 的完整可替换镜像；不要直接修改。
- `skills/addyosmani/`：上游 Addy Osmani agent-skills 的完整可替换镜像；不要直接修改。
- `skills/bamhub/`：Bamhub 自有、可跨项目复用的 skill，按领域分组。
- `skills/project/`：只服务本仓库的能力；`skills/project/sync-upstream-skills/` 只管理上游同步，不可作为通用 skill 发布。

上游 `brainstorming` 文档仍使用字面路径 `skills/brainstorming/visual-companion.md`。仓库通过该路径下的符号链接映射到 `skills/superpowers/brainstorming/visual-companion.md`；兼容目录没有 `SKILL.md`，不参与 skill 所有权分类，也不要复制镜像内容到其中。

一个 skill 目录中还可能包含：
- 主技能文档按需引用的补充说明文档
- skill 执行过程中使用的辅助脚本
- 用于说明 skill 如何应用的示例或 prompt 模板

这个仓库最重要的架构特征是：行为主要由 skill 文档定义，脚本和附属文件作为执行支撑。修改某个 skill 时，要保持 `SKILL.md`、其引用文档以及相关辅助脚本之间的一致性。

## 高层架构

### 以 skill 为中心的组织方式

这个仓库按独立 skill 组织，而不是按传统应用分层组织。每个分类目录下的 skill 都是职责明确的独立单元。后续在这里的工作通常属于以下几类：
- 新增一个 skill
- 调整已有 skill 的说明与约束
- 更新某个 skill 使用的辅助资源
- 保持关联文档与脚本和 skill 契约一致

### 以流程为导向的 skills

有些 skill 用来定义这个仓库中其他产物的编写流程：
- `skills/superpowers/brainstorming/` 负责在开始实现前，把想法收敛成经过确认的设计/spec
- `skills/superpowers/writing-plans/` 负责把已确认的需求转成可执行的实施计划
- `skills/superpowers/writing-skills/` 负责定义如何创建和验证新的 skill，并明确区分“可跨项目复用的指导”与“仅当前仓库适用的约定”

这些 skill 一起构成了这个仓库的主流程骨架：先设计，再规划，再执行。

### 脚本支撑的能力

有些 skill 不只是文档，还包含可执行辅助工具：
- `skills/superpowers/brainstorming/scripts/` 包含用于可视化 brainstorming 流程的本地浏览器 companion server
- `skills/superpowers/writing-skills/render-graphs.js` 用来把 skill 的 `SKILL.md` 中的 Graphviz `dot` 代码块渲染成 SVG 图，便于审阅流程图

因此，这个仓库里的改动经常同时涉及文档和代码。如果辅助脚本行为也需要变化，不要只改说明文字而不改实现。

## 常用命令

当前仓库没有统一的 build、lint 或 test 工作流。除非未来新增了实际配置文件，否则不要假设这里存在 npm、pnpm、pytest 或其他标准命令。

应优先使用仓库当前真实支持的命令。

### 启动 brainstorming 可视化服务

```bash
bash skills/superpowers/brainstorming/scripts/start-server.sh --project-dir /absolute/path/to/repo
```

脚本会输出包含本地访问 URL 和 session 目录的 JSON。

### 停止 brainstorming 可视化服务

```bash
bash skills/superpowers/brainstorming/scripts/stop-server.sh <session_dir>
```

`session_dir` 使用 `start-server.sh` 返回的值。

### 为单个 skill 渲染 Graphviz 图

```bash
node skills/superpowers/writing-skills/render-graphs.js skills/<skill-dir>
```

示例：

```bash
node skills/superpowers/writing-skills/render-graphs.js skills/superpowers/brainstorming
```

### 将单个 skill 的所有图合并渲染为一个 SVG

```bash
node skills/superpowers/writing-skills/render-graphs.js skills/<skill-dir> --combine
```

`render-graphs.js` 依赖系统已安装 `graphviz` 的 `dot` 命令。

## 在这个仓库中工作的方式

### 编辑前先读完整个 skill 单元

修改某个 skill 前，先阅读目标 `SKILL.md`，再检查同目录下它引用的相关文件。在这个仓库中，很多关键行为会分散在主 skill 文档、补充 markdown、prompt 模板和辅助脚本之间。

### 仓库特有约定写进 CLAUDE.md

`skills/superpowers/writing-skills/` 明确把项目级约定视为 CLAUDE.md 的内容，而不是可复用 skill。如果某条指导只适用于这个仓库，应优先写在这里，而不是单独做成一个新 skill。

### 同步上游 skill

只可通过项目专用的同步 skill 更新 `skills/superpowers/` 和 `skills/caveman/` 镜像：

```bash
node skills/project/sync-upstream-skills/scripts/sync-skills.mjs check --all
node skills/project/sync-upstream-skills/scripts/sync-skills.mjs apply --all
```

先审阅 `check` 的逐 source JSON 报告，再执行 `apply`。GitHub Actions 每周在 GitHub 托管运行同步并创建 PR；不在本地配置 `launchd`、`crontab` 或其他定时器。某个 source 失败会记录在工作流摘要和构件中，但不会阻止健康 source 的变更进入自动 PR。

### 保持仓库既有流程假设

现有 skills 编码了一个明确流程：先做设计/spec，再做实施计划，之后才执行实现。如果你要修改 `brainstorming`、`writing-plans` 或相关 skill，除非仓库明确要调整方法论，否则应保留这些交接边界。

## 现有文档

当前 `README.md` 内容很少，只说明这是一个 AI 相关工具仓库。真正有操作价值的上下文主要在各个 skill 目录内。
