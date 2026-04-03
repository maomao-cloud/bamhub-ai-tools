---
name: plan-arch
description: Use when overall structure, module boundaries, core flows, refactoring direction, trade-offs, or codebase constraints need to be clarified before execution.
---

# Plan Architecture

## Overview

这个 skill 负责收敛总体架构与核心架构逻辑。它可以承接需求文档，也可以独立用于重构、架构梳理和模块边界调整。

## When to Use

在这些场景使用：
- 已有需求文档，需要进一步设计总体架构和核心逻辑
- 用户想做重构、架构梳理、模块边界重建
- 需要结合当前代码现状判断方案边界和技术折中
- 还不该进入任务拆解，但已经需要明确“怎么组织系统”

不要在这些场景使用：
- 需求目标、边界、成功标准还明显不稳：先用 `plan-req`
- 用户已经明确要文件级步骤、测试命令和执行顺序：改用 `writing-plans`

## Input Rules

输入优先级：
1. 用户明确指定的需求文档 / 架构文档路径
2. 当前对话中已确认的信息
3. 当前代码现状与已有模式

有文档先用文档；没有就用对话，不要强制要求正式文档。

## Core Rules

1. 只解决这些问题：
   - 总体技术路线
   - 模块职责与边界
   - 核心调用链 / 数据流
   - 关键技术折中
   - 当前代码约束下的现实方案
   - 主要风险与假设

2. 不要下沉到这些内容：
   - 文件路径
   - 逐步实现计划
   - 测试命令
   - commit 粒度
   - 里程碑/阶段拆分
   - 函数级/方法级细节设计（除非用户明确要求）

3. 优先复用当前代码现实，不为了“更优雅”强行引入新抽象。

4. 如果发现的是需求问题，不要悄悄吞进架构结论；先判断是否需要需求回流。

5. 当前阶段无法闭环但后续容易遗漏的问题，记录到 `Deferred for Later Stages`。

## Demand Feedback Loop

架构阶段想到需求变化时，按三类处理：

### 轻度回流：澄清型
- 只是补充说明，不改变目标、范围或成功标准
- 直接回写需求文档或需求摘要后继续

### 中度回流：决策型
- 影响关键业务规则或关键约束
- 暂停当前架构点，回到需求阶段补充决策，再继续

### 重度回流：范围变更型
- 改变目标、范围或成功标准
- 终止当前架构版本，重新做需求收敛

原则：架构阶段可以发现需求问题，但不能在未更新上游需求输入前私自吸收需求变更。

## Output Contract

产出文档应聚焦架构层，建议结构如下：

```md
# Architecture Brief

## Requirement Summary
## Current Codebase Reality
## Recommended Architecture
## Module Boundaries
## Core Flow / Data Flow
## Key Trade-offs
## Risks
## Assumptions

## Deferred for Later Stages

### For Requirements
### For Planning
### For Implementation
```

要求：
- `Requirement Summary` 只摘要当前有效需求，不重新发明需求；如果发现需求变化，先通过需求回流更新上游输入，再更新此摘要
- `Current Codebase Reality` 必须基于真实代码现状，不做空中设计
- `Deferred for Later Stages` 只保留未解决项

## Deferred Rules

适合进入 deferred 的问题：
- 当前阶段无法可靠定版
- 继续讨论收益低
- 应由需求或 planning 阶段负责
- 后续若不记录容易遗漏

不要记录：
- 已经拍板的问题
- 为未来预留的纯扩展想法
- 已经进入实施粒度的碎问题

## Common Mistakes

- 还没确认需求边界，就提前下总体架构结论
- 用理想架构替代当前代码现实
- 架构讨论直接滑进文件拆分和任务步骤
- 把需求变更偷偷吸收到架构文档里，导致上游真相源失效
- 把 deferred 当作想法停车场，塞入大量无优先级的问题

## Handoff

完成后：
- 如果仍需补稳定需求输入：回到 `plan-req`
- 如果总体架构已经明确，要进入落地：使用 `writing-plans`

`plan-arch` 可以作为独立 skill 使用，不依赖固定顺序。
