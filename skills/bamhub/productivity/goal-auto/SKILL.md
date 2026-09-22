---
name: goal-auto
description: Use when explicitly invoked to implement a feature, bug fix, or refactor from a requirements document, design spec, or implementation plan and continue until the work is objectively verified.
---

# Goal Auto

## Purpose

把一次明确的 `goal-auto` 调用变成可持续执行的交付任务：自动建立当前 Goal，按需求文档实施，并以可复现的验证证据作为完成条件。

## Activation

只有用户明确写出 `goal-auto`（例如 `/goal-auto` 或“使用 goal-auto”）时，才执行本 skill 的自动 Goal 行为。不要因为任务看起来像编码任务就擅自创建 Goal。

调用后：

1. 如果当前没有 Goal，创建一个 Goal，目标是完成当前用户请求并满足本文件的 Definition of Done。
2. 如果已有 Goal，将当前请求和本文件的验收标准合并到该 Goal；不要创建重复 Goal。
3. 读取当前任务涉及的需求文档、设计文档、实现计划、`AGENTS.md` 和相关代码后再开始修改。

## Execution

- 将需求拆成可检查的验收清单，并维护清单状态。
- 遵循仓库规则以及适用的 Superpowers 流程；实现行为变化时优先采用测试驱动开发。
- 先运行现有的针对性测试，建立基线；实现后运行针对性测试，再运行项目要求的完整测试、编译/构建、类型检查和静态检查命令。
- 命令失败时先定位根因并修复，然后重新运行受影响的验证；不能只报告失败就结束。
- 只修改完成当前需求所需的文件，避免无关重构。
- 每个阶段用简短进度更新说明：已完成项、当前验证、阻塞原因（如有）。

## Definition of Done

只有以下条件全部满足，才能把 Goal 标记为 `complete`：

- 需求文档中的每条强制要求都有实现或明确的验证结果。
- 新增或修改的行为有合适的自动化测试；测试全部通过。
- 项目要求的编译、构建、类型检查和静态检查全部通过（不存在的命令不臆造，需说明跳过原因）。
- 未引入已知回归、无关改动或未处理的阻断问题。
- 已阅读并遵守项目规则和文档约定。
- 最终回复提供验证命令及结果，作为完成证据。

验证未通过时，Goal 保持进行中；继续修复，除非遇到需要用户决定的需求歧义、权限限制或明确的破坏性风险。

## Final Report

完成时固定汇报：

1. 修改内容和文件。
2. 需求到实现/测试的对应关系。
3. 执行过的验证命令及结果。
4. 未完成项、已知风险或跳过的检查（如有）。
5. 仅在 Definition of Done 全部满足后声明 Goal 完成。

