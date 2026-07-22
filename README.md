# bamhub-ai-tools

面向 AI Agent 的技能仓库。

## 目录

- `skills/superpowers/`：上游 Superpowers 的完整本地镜像；通过同步工具更新，不直接编辑。
- `skills/bamhub/`：Bamhub 自有、可复用的 skill，按架构、集成、维护和效率分类。
- `skills/project/`：仅服务当前仓库的 skill；[同步上游 skill](skills/project/sync-upstream-skills/SKILL.md) 位于此处。
- `tests/`：Node 内置测试，按对应领域组织。

上游同步请先运行 `check --all`，确认报告后再运行 `apply --all`。定期检查由 GitHub Actions 托管执行并创建 PR，无需在本机安装定时任务。详见 [sync-upstream-skills](skills/project/sync-upstream-skills/SKILL.md)。
