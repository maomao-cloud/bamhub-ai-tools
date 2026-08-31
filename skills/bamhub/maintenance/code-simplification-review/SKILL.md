---
name: code-simplification-review
description: Use when working code is harder to read, maintain, or extend than necessary and a behavior-preserving simplification review is appropriate.
---

# Code Simplification Review

## Purpose

将 Addy Osmani 的 `code-simplification` 方法应用到 Bamhub 项目。目标是降低理解成本，而不是减少代码行数；所有改动都必须保持行为、错误处理、副作用和时序不变。

## Required Background

先阅读上游 `skills/addyosmani/code-simplification/SKILL.md`，并遵守本仓库 `AGENTS.md`、`CLAUDE.md` 与相邻模块约定。

## Scope

- 默认只审查本次变更涉及的文件。
- 不理解职责、调用方、边界条件或存在原因时，不得简化。
- 不把功能开发、架构迁移和代码简化混在同一批修改中。
- 性能关键、生成代码、外部协议兼容代码须先说明保护理由；可使用 `simplify-ignore` 注释标记，但本仓库默认不启用上游 hook。

## Process

1. 遵守 Chesterton's Fence：阅读变更、调用方、测试和项目规范，必要时查看 `git blame`，先理解代码为何存在再决定是否删除或合并。
2. 记录候选问题：嵌套控制流、重复逻辑、误导命名、无价值包装、死代码或过早抽象。
3. 为每个候选项写出“为什么更清晰”和“为什么行为不变”。不确定的候选项只报告，不修改。
4. 一次只做一个简化；每次改动后运行针对性测试，再继续下一项。
5. 测试失败时撤销当前简化并重新判断，不修改测试来迎合实现。
6. 完成后运行完整测试、构建/静态检查（若项目提供），并复核 diff 是否只包含目标范围。

## Acceptance Gates

- 不新增功能，不改变业务语义。
- 输入、输出、异常、日志、副作用和顺序保持一致，或有明确证据说明例外。
- 简化后的代码符合本项目风格，且新人能更快理解。
- 每项改动都有测试或等价性证据。
- 如果简化没有明显收益，保留原实现并报告原因。

## Output

输出：范围、候选项、已采纳改动、被拒绝改动、验证命令及结果、剩余风险。结论使用 `PASS`、`PASS_WITH_NOTES` 或 `BLOCKED`。
