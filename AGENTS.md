# 仓库指南

## 项目结构与模块组织

本仓库是一组 AI Agent skill，而非单一应用。每个 skill 都独立置于 `skills/<skill-name>/` 中，并以 `SKILL.md` 作为入口。请将支撑材料与其使用的 skill 放在一起：可执行辅助工具放在 `scripts/`，JavaScript 模块放在 `lib/`，示例或模板放在 `examples/` 或 `templates/`。通用认证工具位于 `skills/shared-auth/`，Kibana 工具位于 `skills/kibana-search/`。测试按相同领域组织在 `tests/shared-auth/`、`tests/kibana-search/` 和 `tests/integration/` 下。

编辑 skill 前，须阅读完整的 `SKILL.md` 及其引用的所有本地文件。修改行为时，应保持说明、引用文档、模板与脚本一致。仅适用于本仓库、无法复用的约定应写入 `CLAUDE.md`。

## 构建、测试与开发命令

仓库根目录没有统一的构建、Lint 或包管理工作流。请使用目标 skill 实际支持的命令：

```bash
node --test tests/shared-auth/*.test.js      # shared-auth 单元测试
node --test tests/kibana-search/*.test.js    # Kibana 单元测试
node --test tests/integration/*.test.js      # 端到端 CLI 检查
node skills/writing-skills/render-graphs.js skills/<skill-name> --combine
```

图形渲染命令依赖 Graphviz 的 `dot`。仅在需要时使用 `bash skills/brainstorming/scripts/start-server.sh --project-dir "$PWD"` 启动 brainstorming 可视化助手。

## 代码风格与命名约定

JavaScript 使用 ES 模块（`"type": "module"`）、两个空格缩进、单引号、分号和语义明确的 `camelCase` 函数名。skill 目录和支撑文件名使用 kebab-case（例如 `credentials-store.js`）。命令行入口应放在 `scripts/`，可复用逻辑应放在 `lib/`。

## 测试指南

使用 Node 内置的 `node:test` 和 `node:assert/strict`。测试文件命名为 `*.test.js`，路径应与被测模块保持对应，并描述可观测行为，例如：`test('chooseLoginMode falls back to headless …', ...)`。每次修改脚本或库行为时，都要新增或更新针对性测试，并运行相应测试组；修改 CLI 或涉及多个 skill 时，还应运行集成测试。

## 提交与拉取请求指南

遵循既有的 Conventional Commit 格式：`feat: add shared auth`、`fix: complete query flows` 或 `docs: add guidance`。提交标题使用祈使语气，并聚焦一项变更。拉取请求应说明受影响的 skill，概述行为和文档变更，列出已运行的命令，关联相关 issue；若修改可视化或交互产物，应附上截图或渲染后的 SVG。
