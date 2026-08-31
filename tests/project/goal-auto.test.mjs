import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('goal-auto defines explicit activation and evidence-based completion gates', () => {
  const goalAuto = fs.readFileSync(path.join(repoRoot, 'skills/bamhub/productivity/goal-auto/SKILL.md'), 'utf8');
  assert.match(goalAuto, /name: goal-auto/);
  assert.match(goalAuto, /只有用户明确写出 `goal-auto`/);
  assert.match(goalAuto, /如果当前没有 Goal，创建一个 Goal/);
  assert.match(goalAuto, /测试全部通过/);
  assert.match(goalAuto, /编译、构建、类型检查和静态检查全部通过/);
  assert.match(goalAuto, /不能只报告失败就结束/);
  assert.match(goalAuto, /验证命令及结果/);
});
