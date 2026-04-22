---
name: code-arch
description: Use when the user wants to understand an existing codebase or module through its key execution path, core call chain, design architecture, design patterns, or structural weaknesses, especially before modifying code or when onboarding to unfamiliar implementation.
---

# Code Arch

## Overview

这个 skill 用于快速解释现有代码的关键路径与设计架构。

重点是把“现在这套代码实际上怎么工作”讲清楚：从哪里进入、如何调用、核心职责怎么分布、用了什么设计模式、这些设计的代价是什么，以及当前实现的主要缺点。

## When to Use

在这些场景使用：
- 用户想理解某个模块、服务或项目的主流程
- 用户要求分析关键调用链、执行路径或链路图
- 用户想知道系统的设计架构、职责边界或核心组织方式
- 用户要求识别设计模式，并说明证据与问题
- 用户想在改代码前先看清当前实现
- 用户希望最终把分析整理成 markdown 文档

## Input Rules

输入优先级：
1. 用户明确指定的分析范围
2. 用户明确提出的问题
3. 当前代码事实

如果范围过大，优先按以下方式收窄：
- 某条业务链路
- 某个模块或目录
- 某个入口到输出的流程
- 某类结构问题，例如设计模式或架构缺点

## Workflow

### 1. 先确认分析目标

先明确：
- 分析范围是什么
- 更关注动态链路还是静态结构
- 是否需要图
- 是否需要最终输出为 md 文件

如果用户没有明确说明，默认提供：
- 1 条最关键主链路
- 1 个最合适的 Mermaid 图
- 设计模式说明
- 缺点分析
- 结尾询问是否生成 md 文件

### 2. 从入口开始识别主路径

优先定位：
- 外部入口
- 编排节点
- 核心决策点
- 数据访问或外部交互点
- 最终输出点

把主路径抽象为：

`输入 -> 入口 -> 编排 -> 决策 -> 外部交互 / 数据访问 -> 输出`

不要一开始就陷入 DTO、配置项或零散工具类，除非用户明确要求。

### 3. 只保留关键调用链

对关键节点说明：
- 它的职责
- 为什么它在主路径上
- 它调用了谁
- 它是否承担了不该承担的职责

如果存在多条链路，只保留与用户问题最相关的 1-2 条。

### 4. 选择最合适的图

按问题选择图：
- 调用先后与控制流：`sequenceDiagram` 或 `flowchart`
- 模块边界与依赖方向：`flowchart`
- 类职责与关系：`classDiagram`

图的目标是帮助理解，不是完整镜像代码。

### 5. 指出设计模式

只有证据充分时才命名设计模式。说明时必须包含：
- 代码证据
- 解决了什么问题
- 引入了什么代价

如果证据不够强，就用“类似某模式”这种保守说法。

### 6. 明确指出缺点

优先分析：
- 职责混杂
- 跨层调用
- 跳转过多
- 状态流转隐式
- 扩展点不清晰
- 中心类过重
- 抽象失衡
- 改动牵连面过大

缺点必须基于当前代码事实，不要空泛。

### 7. 最后询问是否生成 md 文件

如果用户没有明确要求直接落盘，分析结束时主动询问：

“要不要我把这份分析整理成一个 md 文件？”

## Output Contract

默认输出结构：

```md
# Code Architecture Analysis

## Scope
## Executive Summary
## Key Path
## Key Call Chain
## Diagram
## Design Patterns
## Weaknesses
## Practical Reading Order
```

图默认使用 Mermaid。

## Response Rules

1. 优先引用真实代码位置，使用 `path:line` 形式。
2. 不列出所有类，只保留关键节点。
3. 图不要追求完整，只服务于理解。
4. 设计模式必须给证据。
5. 缺点分析必须落到当前实现。
6. 结尾默认询问是否生成 md 文件。

## Example Requests

- “帮我看这个模块的关键调用链，画个图。”
- “我想快速理解这个服务的设计架构和设计模式。”
- “分析一下从入口到最终输出的主路径，并指出当前设计缺点。”
- “帮我理解这个目录的核心结构，最后问我要不要生成 md 文件。”
