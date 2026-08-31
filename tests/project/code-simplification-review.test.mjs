import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '../..');

test('code simplification adapter has behavior-preserving guardrails', async () => {
  const content = await fs.readFile(path.join(root, 'skills/bamhub/maintenance/code-simplification-review/SKILL.md'), 'utf8');
  for (const term of ['Chesterton', '一次只做一个简化', '测试失败时撤销', '不新增功能', 'PASS_WITH_NOTES']) {
    assert.match(content, new RegExp(term));
  }
});
