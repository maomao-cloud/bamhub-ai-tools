---
name: project-finish-quality-gate
description: Use when a feature, bug fix, or refactor is ready for completion and the project needs a single evidence-based quality and maintainability decision.
---

# Project Finish Quality Gate

## Purpose

在代码准备结束时编排 Bamhub 的验证、简化、Review、文档和团队经验沉淀。它负责顺序与门禁，不重复实现各个原子 skill。

## Modes

- `audit`（默认）：只检查并输出报告，不修改代码。
- `improve`：仅执行低风险、局部、可验证的简化；高风险建议先请求确认。
- `release`：质量门禁通过后，进入变更日志、分支和合并流程。

## Flow

1. 确认变更范围、需求和项目约定；必要时使用 `code-arch`。
2. 运行项目测试、构建和静态检查；遵守 `verification-before-completion`。
3. 若存在可读性或复杂度信号，调用 `code-simplification-review`；不要为了减少行数而重构。
4. 调用 `requesting-code-review` 检查需求符合性和代码质量。
5. 验证失败或出现异常时，切换到 `systematic-debugging`，先找根因再修复。
6. 中大型改动调用 `design-retrospective`；仅在形成跨模块长期经验时调用 `rule-refine`。
7. 模块主链路、正式入口或职责边界变化时调用 `sync-module-doc`；需要发布时调用 `version-changelog`。
8. 最后重新运行完整验证；未获得新证据不得声称完成。

## Stop Conditions

- 测试、构建或静态检查失败：`BLOCKED`，不得进入 release。
- 行为是否保持不变无法证明：不自动简化，报告风险。
- Review 发现阻断或重要问题：修复并重新走验证。
- 团队规则候选必须先经用户确认，不能自动写入规则文件。

## Report

输出固定包含：变更范围、验证命令及结果、必须修复项、可选简化、架构/维护性风险、团队建议、最终结论（`PASS` / `PASS_WITH_NOTES` / `BLOCKED`）及是否允许进入合并或发布阶段。
