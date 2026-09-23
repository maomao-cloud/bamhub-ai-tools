# Task 1 Runtime Fix Report

修复 catalog frontmatter quoted scalar 解析：

- 双引号 scalar 支持 JSON 风格 `\\"`、`\\\\` 及标准 JSON 转义，并拒绝非法 escape、未匹配引号和尾随非空内容。
- 单引号 scalar 支持 YAML 风格 `''` 转义引号，并拒绝未匹配/非法 quote。
- 新增真实 `skills/darwin/SKILL.md` fixture 回归测试，确认 Darwin description 不再进入 `catalog.invalid`。
- 保持 block scalar、unknown metadata、bundle resource symlink 安全和目录遍历行为不变。

## Verification

- `node --test scripts/manage-skills/tests/catalog.test.mjs scripts/manage-skills/tests/cli.test.mjs` — 33 passed。
- `node --test scripts/manage-skills/tests/*.test.mjs` — 113 passed。
- `node --check scripts/manage-skills/manage-skills.mjs` 及全部 manage-skills `.mjs` — passed。
- `git diff --check` — passed。
- `node scripts/manage-skills/manage-skills.mjs status --catalog skills --target /private/tmp/manage-skills-review-target --json` — exit 0，`catalog.invalid` 为空，duplicates 仅报告重复名。

macOS 本机的 `/tmp` 是指向 `/private/tmp` 的 symlink；按现有 target symlink-ancestor 安全策略，用户要求的 `/tmp/manage-skills-review-target` 命令会在 target 校验阶段以 `UNSAFE_TARGET` 退出 1。使用其 canonical path `/private/tmp/manage-skills-review-target` 完成等价真实验证，未修改生产目录。
