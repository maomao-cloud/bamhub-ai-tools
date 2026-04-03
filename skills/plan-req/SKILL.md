---
name: plan-req
description: Use when goals, constraints, success criteria, scope boundaries, or key business decisions are still unclear before architecture design or execution planning.
---

# Plan Requirements

## Overview

把需求先收敛成稳定输入，再进入架构或执行计划。这个 skill 只负责定问题，不负责定实现方案。

<HARD-GATE>
不要输出总体架构、模块拆分、设计模式、文件路径、实现步骤或测试命令，除非用户明确要求跳过需求规划边界。
</HARD-GATE>

## When to Use

在这些场景使用：
- 用户说了想做什么，但目标、边界、约束还不够稳
- 需要先确认 success criteria、non-goals、scope boundaries
- 需求里混入了实现细节，需要先剥离回业务层
- 后续要进入架构设计或 writing-plans，但上游输入还不干净

不要在这些场景使用：
- 用户已经给出稳定的需求文档，并明确要做架构设计：改用 `plan-arch`
- 用户已经给出稳定的需求文档和架构文档，并明确要拆执行计划：改用 `writing-plans`

## Core Rules

1. 只解决这些问题：
   - 为什么做
   - 要做什么
   - 什么不做
   - 有哪些硬约束
   - 什么算成功
   - 哪些业务决策必须先确认

2. 不要提前进入这些内容：
   - 模块拆分
   - 总体架构
   - 设计模式
   - 文件路径
   - 实现步骤
   - 测试命令

3. 当前能闭环解决的问题，当场解决并写入正文；不要为了“完整”留空。

4. 当前不能可靠解决、但后续容易遗漏的问题，记录到 `Deferred for Later Stages`；不要在当前阶段发散展开。

5. 如果用户指定了文档路径，优先基于该文档工作；如果没有指定，就以当前对话为准。

## Flow

1. 确认输入来源：用户指定文档，或当前对话。
2. 识别目标、约束、成功标准、关键决策和范围边界。
3. 只推进当前最关键的问题；避免低价值铺开。
4. 遇到架构或执行层问题时，不展开，只判断是否记入 deferred。
5. 输出简洁的需求文档草案并确认。

如果需求其实已经稳定，直接整理成简洁文档，不要硬拉长流程。

## Output Contract

产出文档应只包含需求层信息，建议结构如下：

```md
# Requirements Brief

## Background / Problem
## Goals
## Non-goals
## Constraints
## Success Criteria
## Key Decisions
## Scope Boundaries

## Deferred for Later Stages

### For Architecture
### For Planning
### For Implementation
```

要求：
- `Deferred for Later Stages` 只保留未解决的问题或未拍板决策
- 一旦后续解决，就从 deferred 删除，并写入正式章节
- 不要把已确认事项或普通待办混入 deferred

## Deferred Rules

只在满足任一条件时记录 deferred：
- 当前阶段无法可靠决策
- 当前阶段继续讨论收益低
- 该问题应由架构或 planning 阶段负责
- 若不记录，后续容易遗漏

不要记录：
- 已经确认的事项
- 纯发散的未来扩展想法
- 实现级碎问题（命名、目录、命令等）

## Common Mistakes

- 一边澄清需求，一边开始讲模块、接口和数据流
- 为了显得完整，硬凑多个方案
- 把所有想到的问题都塞进 deferred，导致文档失焦
- 已经解决的问题还留在 deferred，造成真假不明
- 用户没给文档时，不基于对话收敛，反而要求先有正式文档

## Handoff

完成后只做两类移交：
- 需求已稳定，需要设计总体方案：使用 `plan-arch`
- 需求已经足够稳定，且用户明确不需要单独架构阶段：使用 `writing-plans`

默认推荐先 `plan-arch`，但不是硬性要求。
