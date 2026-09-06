<!-- bamhub-sync-metadata:start -->
来源: https://github.com/obra/superpowers.git
跟踪引用: main
已接受提交: b36e0829c6d0140e93cfef2ca599b1b07d4a7797
上次成功同步: 2026-09-06T18:00:43.847Z
<!-- bamhub-sync-metadata:end -->
<!-- bamhub-sync-content:start -->

# Superpowers

这是 [Superpowers](https://github.com/obra/superpowers) 的完整本地 skill 镜像。调用时由每个 `SKILL.md` 的 frontmatter 决定是否触发；请阅读被触发 skill 的完整说明，不要把本页当作操作手册。

## 覆盖范围

| 场景 | 优先 skill |
| --- | --- |
| 开始任何任务、选择流程 | `using-superpowers` |
| 需求设计与方案澄清 | `brainstorming` |
| 新功能或修复 | `test-driven-development`、`systematic-debugging` |
| 规划与执行多步变更 | `writing-plans`、`executing-plans`、`subagent-driven-development` |
| 隔离开发、收尾验证与合并 | `using-git-worktrees`、`verification-before-completion`、`finishing-a-development-branch` |
| 发起、接收或复核代码评审 | `requesting-code-review`、`receiving-code-review` |

此镜像仅包含上游的 skills，不含上游可能依赖的插件、hooks、commands 或 agents。不要直接修改镜像内容；请使用仓库根目录的同步流程更新。
<!-- bamhub-sync-content:end -->
