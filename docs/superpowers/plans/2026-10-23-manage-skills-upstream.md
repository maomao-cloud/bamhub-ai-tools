# manage-skills upstream implementation plan

**Goal:** 一个交互入口提供挂载管理和上游同步。
**Architecture:** 共享交互会话，独立 upstream 薄适配模块调用现有 runCli。
**Tech Stack:** Node.js ESM、node:test。

1. 在 tests/upstream.test.mjs 添加失败测试：check 后确认 apply、取消、无更新、部分失败与异常不阻断。
2. 实现 lib/upstream.mjs，读取 sources.json，逐来源调用现有同步器，展示报告且不传 force。
3. 在 interactive.mjs 提供功能分发和上游菜单，CLI 仅默认交互使用分发；显式 apply 向导不变。
4. 更新 CLI 集成测试，覆盖新入口与取消，运行 manage-skills 和项目测试。
5. 更新 README 说明新边界，diff --check，审阅最终差异。不自动提交推送。
