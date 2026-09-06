<!-- bamhub-sync-metadata:start -->
来源: https://github.com/JuliusBrussee/caveman.git
跟踪引用: main
已接受提交: 5184b3d11ac6a1acb7d44b9bfaa31698157cff97
上次成功同步: 2026-09-06T18:00:42.733Z
<!-- bamhub-sync-metadata:end -->
<!-- bamhub-sync-content:start -->

# Caveman

这是上游 [Caveman](https://github.com/JuliusBrussee/caveman) 的完整本地 skill 镜像，目标是用高度压缩的表达保留技术信息。具体触发条件和输出约束以各 skill 的 `SKILL.md` 为准。

## 包含的 skill

| Skill | 用途 |
| --- | --- |
| `caveman` | 将日常回答切换为不同强度的压缩表达。 |
| `caveman-commit` | 生成简短的 Conventional Commit 信息。 |
| `caveman-review` | 将代码评审意见压缩为“位置、问题、修复”。 |
| `caveman-compress` | 压缩长期记忆或偏好文档，并保留备份。 |
| `caveman-help` | 显示 Caveman 模式和命令速查。 |
| `caveman-stats` | 读取运行时会话日志，报告真实 token 使用量。 |
| `cavecrew` | 为压缩型子代理任务提供委派决策指引。 |

本仓库只同步上游 `skills/`，不包含 `agents`、hooks、commands、插件或安装器。因此 `cavecrew` 和 `caveman-stats` 所需的运行时集成不会随镜像提供；请先确认调用环境已经配置。不要直接修改镜像内容；请使用仓库根目录的同步流程更新。
<!-- bamhub-sync-content:end -->
