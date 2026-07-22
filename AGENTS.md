# 仓库指南

## 项目结构与模块组织

本仓库是一组 AI Agent skill，而非单一应用。skill 按所有权分为三类：`skills/superpowers/` 是上游 Superpowers 的完整本地镜像，禁止直接修改；`skills/bamhub/` 是可复用的 Bamhub 自有 skill，按领域分组；`skills/project/` 存放仅服务本仓库的能力，例如 `skills/project/sync-upstream-skills/`。每个 skill 以 `SKILL.md` 为入口；辅助脚本放在 `scripts/`，JavaScript 模块放在 `lib/`，示例或模板放在 `examples/` 或 `templates/`。测试在 `tests/` 中按领域组织。

`skills/brainstorming/visual-companion.md` 是指向上游镜像文件的运行时兼容别名，仅用于满足 Superpowers 文档中的旧路径；该目录不是 Bamhub skill，也不归上游同步器管理。

编辑 skill 前，须阅读完整的 `SKILL.md` 及其引用的所有本地文件。修改行为时，应保持说明、引用文档、模板与脚本一致。仅适用于本仓库、无法复用的约定应写入 `CLAUDE.md`。

## 构建、测试与开发命令

仓库根目录没有统一的构建、Lint 或包管理工作流。请使用目标 skill 实际支持的命令：

```bash
node --test tests/**/*.test.js                # 全部测试
node --test tests/project/*.test.mjs          # 项目级同步测试
node skills/project/sync-upstream-skills/scripts/sync-skills.mjs check --all
node skills/project/sync-upstream-skills/scripts/sync-skills.mjs apply --all
node skills/superpowers/writing-skills/render-graphs.js skills/<skill-name> --combine
```

同步前先运行 `check` 并审阅每个 source 的 JSON 报告；`apply` 仅更新已配置的上游根目录，单个 source 失败不会中断其他 source。定期同步由 GitHub Actions 托管运行并通过 PR 提交，不要在开发者电脑安装定时器。图形渲染命令依赖 Graphviz 的 `dot`。

## 代码风格与命名约定

JavaScript 使用 ES 模块（`"type": "module"`）、两个空格缩进、单引号、分号和语义明确的 `camelCase` 函数名。skill 目录和支撑文件名使用 kebab-case（例如 `credentials-store.js`）。命令行入口应放在 `scripts/`，可复用逻辑应放在 `lib/`。

## 测试指南

使用 Node 内置的 `node:test` 和 `node:assert/strict`。测试文件命名为 `*.test.js`，路径应与被测模块保持对应，并描述可观测行为，例如：`test('chooseLoginMode falls back to headless …', ...)`。每次修改脚本或库行为时，都要新增或更新针对性测试，并运行相应测试组；修改 CLI 或涉及多个 skill 时，还应运行集成测试。

## 提交与拉取请求指南

遵循既有的 Conventional Commit 格式：`feat: add shared auth`、`fix: complete query flows` 或 `docs: add guidance`。提交标题使用祈使语气，并聚焦一项变更。拉取请求应说明受影响的 skill，概述行为和文档变更，列出已运行的命令，关联相关 issue；若修改可视化或交互产物，应附上截图或渲染后的 SVG。
