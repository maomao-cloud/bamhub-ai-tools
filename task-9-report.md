# Task 9 Report

修复 manage-skills missing-target recovery 的 manifest identity bug。

## 根因

missing target 在 apply 时先以 `missing: true` 的初始 target identity 参与计划与锁定；创建目录后，manifest 实际使用新目录的真实 `dev`/`ino` identity 写入。recovery 原先在缺少已写 manifest 字段时仍按初始 missing identity 计算 manifest 文件名，导致真实 manifest 未删除或旧 manifest 未恢复，留下 stale manifest。

## 改动

- `scripts/manage-skills/lib/transaction.mjs`
  - recovery/restoreOldManifest 优先使用 journal 中已写 manifest 的 target identity。
  - 若崩溃发生在 manifest 写入与 journal manifest 字段持久化之间，回退使用已完成的 `target-create` operation identity。
  - apply 路径继续显式传递实际 manifest target identity，existing-target recovery 行为保持不变。
- `scripts/manage-skills/tests/transaction.test.mjs`
  - 新增 missing target 创建、link 完成、manifest 写入后模拟崩溃/recovery 的覆盖时序测试。
  - 断言 target 目录与 link 回滚、实际 manifest 删除、初始 missing manifest 路径不存在，且不留 stale manifest。

## Verification

- RED：新增回归测试在修复前失败，实际 manifest 残留。
- Focused：`node --test scripts/manage-skills/tests/transaction.test.mjs --test-name-pattern='missing-target recovery removes'` — 32 passed。
- Related：`node --test scripts/manage-skills/tests/transaction.test.mjs scripts/manage-skills/tests/state.test.mjs scripts/manage-skills/tests/cli.test.mjs` — 69 passed。
- Full：`node --test tests/*/*.test.js tests/project/*.test.mjs tests/skill-layout.test.mjs scripts/manage-skills/tests/*.test.mjs` — 274 passed。
- Syntax/diff：`node --check scripts/manage-skills/lib/transaction.mjs`, `node --check scripts/manage-skills/tests/transaction.test.mjs`, `git diff --check` — passed。

Full-suite existing Node module-type warnings are pre-existing and do not fail the suite.

## 临时 probe 路径约定

macOS 本机执行 `/tmp` probe 时，必须改用 canonical `/private/tmp`，避免 `/tmp` symlink 触发 target safety guard；Pod Linux 环境可使用 `/tmp`。
