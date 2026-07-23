# Bamhub Skills

Bamhub 是本仓库自主维护、可在不同项目中复用的 Agent skill 集合。它补充上游流程 skill：一部分帮助理解与沉淀工程知识，一部分提供可运行的本地集成能力。

每个 skill 的完整触发条件、边界与执行规则都在对应目录的 `SKILL.md` 中。本页只帮助你快速选择入口。

## 从任务开始选择

| 你的目标 | 使用 skill | 结果 |
| --- | --- | --- |
| 理解陌生模块、关键调用链或设计问题 | [`code-arch`](architecture/code-arch/SKILL.md) | 以代码证据支撑的流程、架构或阅读路径说明。 |
| 已有方案，但还不清楚改哪些边界 | [`confirming-architecture`](architecture/confirming-architecture/SKILL.md) | 明确范围、变更面和架构决策，再进入实现计划。 |
| 从已完成工作提炼可复用经验 | [`design-retrospective`](architecture/design-retrospective/SKILL.md) | 设计原则、结构模式和后续迁移建议。 |
| 让多个仓库工具共用本地认证约定 | [`shared-auth`](integrations/shared-auth/SKILL.md) | 统一的 profile、凭据位置和登录模式选择。 |
| 按服务、级别、关键词或 trace ID 查日志 | [`kibana-search`](integrations/kibana-search/SKILL.md) | 保留查询上下文的原始 Kibana 日志。 |
| 判断经验是否应写入项目规则 | [`rule-refine`](maintenance/rule-refine/SKILL.md) | 最小、可验证的规则候选与落点。 |
| 让模块文档跟上实际代码 | [`sync-module-doc`](maintenance/sync-module-doc/SKILL.md) | 更新后的模块 `CLAUDE.md` 与差异说明。 |
| 从 Git 提交生成版本日志 | [`version-changelog`](maintenance/version-changelog/SKILL.md) | 写入约定格式的 changelog 条目。 |
| 把粗略需求变成可直接使用的提示词 | [`lyra-prompt-optimizer`](productivity/lyra-prompt-optimizer/SKILL.md) | 包含上下文、约束和输出结构的提示词。 |

## 分类与关系

```text
architecture/
  code-arch                 理解现有实现
  confirming-architecture   确认方案落点
  design-retrospective      沉淀已完成工作的经验

integrations/
  shared-auth ────────────┐  本地认证约定
  kibana-search ──────────┘  依赖认证 profile 查询日志

maintenance/
  rule-refine               维护项目规则
  sync-module-doc           同步模块说明
  version-changelog         生成版本记录

productivity/
  lyra-prompt-optimizer     优化面向 AI 的提示词
```

## 使用边界

- `skills/bamhub/` 只容纳可跨项目复用、由 Bamhub 自主维护的能力。
- 与当前仓库的构建、同步或目录约定强绑定的能力应放在 `skills/project/`。
- 上游镜像分别位于 `skills/superpowers/` 与 `skills/caveman/`，不要在这里复制或修改它们。
- `shared-auth` 与 `kibana-search` 的运行时配置、缓存和凭据必须留在各自的 `.local/` 目录；它们已被 Git 忽略，不能提交。
