# bamhub-ai-tools

面向 AI Agent 的技能仓库。

## 目录

- `skills/superpowers/`：上游 Superpowers 的完整本地镜像；通过同步工具更新，不直接编辑。
- `skills/caveman/`：上游 [Caveman](https://github.com/JuliusBrussee/caveman) 的完整 skill 镜像；通过同步工具更新，不直接编辑。
- `skills/addyosmani/`：上游 [Addy Osmani agent-skills](https://github.com/addyosmani/agent-skills) 的完整 skill 镜像；通过同步工具更新，不直接编辑。
- `skills/darwin/`：上游 Darwin skill（[Darwin skill](https://github.com/alchaincyf/darwin-skill)）的完整镜像；通过同步工具更新，不直接编辑。
- `skills/bamhub/`：Bamhub 自有、可复用的 skill，按架构、集成、维护和效率分类；见其 [品牌说明](skills/bamhub/README.md)。
- `skills/project/`：仅服务当前仓库的 skill；[同步上游 skill](skills/project/sync-upstream-skills/SKILL.md) 位于此处。
- `tests/`：Node 内置测试，按对应领域组织。

项目收尾质量门禁位于 `skills/bamhub/maintenance/project-finish-quality-gate/`，代码简化适配位于 `skills/bamhub/maintenance/code-simplification-review/`。

Darwin 是一套由 Agent 执行的 skill 优化流程，未提供内置 hook、专用 agent、MCP server 或常驻后台进程；其独立评委由运行时按流程派生。
本仓库通过 `skills/project/darwin-skill-optimizer/` 将 Darwin 流程限定到 Bamhub 自有 skill。

`skills/brainstorming/visual-companion.md` 是兼容 Superpowers 旧文档路径的符号链接，实际内容仍由 `skills/superpowers/brainstorming/visual-companion.md` 唯一维护；它不是一个额外的 skill。

### Caveman 镜像限制

`skills/caveman/` 只镜像上游的 `skills/` 目录，不包含插件、hooks、commands、agents、安装器或 benchmarks。因此需要运行时集成的 `cavecrew`（agents）与 `caveman-stats`（hooks）在本仓库中仅提供说明，除非调用方自行配置对应运行时；部分上游 README 的相对链接也会指向这些被排除的组件。`caveman-compress` 的备份路径由其脚本决定，可能使用运行时应用数据目录；使用前请审阅其 `SECURITY.md` 和脚本，不要假定备份一定与被处理文件相邻。

上游同步请先运行 `check --all`，确认报告后再运行 `apply --all`。定期检查由 GitHub Actions 托管执行并创建 PR，无需在本机安装定时任务。详见 [sync-upstream-skills](skills/project/sync-upstream-skills/SKILL.md)。
