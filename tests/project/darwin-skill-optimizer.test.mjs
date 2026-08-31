import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const maintenanceSkills = [
  'code-simplification-review',
  'project-finish-quality-gate',
  'rule-refine',
  'sync-module-doc'
];

test('Darwin maintenance targets provide two or three valid test prompts', async () => {
  for (const skill of maintenanceSkills) {
    const promptFile = path.join(
      repoRoot,
      'skills/bamhub/maintenance',
      skill,
      'test-prompts.json'
    );
    const prompts = JSON.parse(await fs.readFile(promptFile, 'utf8'));

    assert.ok(Array.isArray(prompts), `${skill} prompts must be an array`);
    assert.ok(prompts.length >= 2 && prompts.length <= 3, `${skill} prompt count`);
    for (const prompt of prompts) {
      assert.equal(typeof prompt.id, 'string');
      assert.ok(prompt.id.length > 0);
      assert.equal(typeof prompt.prompt, 'string');
      assert.ok(prompt.prompt.length > 0);
      assert.equal(typeof prompt.expected, 'string');
      assert.ok(prompt.expected.length > 0);
    }
  }
});

test('project-bound version changelog stays outside Darwin target selection', async () => {
  const optimizer = await fs.readFile(
    path.join(repoRoot, 'skills/project/darwin-skill-optimizer/SKILL.md'),
    'utf8'
  );

  assert.match(optimizer, /version-changelog/);
  assert.match(optimizer, /不得.*优化|排除/);
});

test('optimizer uses Darwin paired-majority decisions rather than absolute score deltas', async () => {
  const optimizer = await fs.readFile(
    path.join(repoRoot, 'skills/project/darwin-skill-optimizer/SKILL.md'),
    'utf8'
  );

  assert.match(optimizer, /paired|成对比较/);
  assert.match(optimizer, /多数决/);
  assert.match(optimizer, /绝对总分.*不能作为保留或回滚依据/);
  assert.doesNotMatch(optimizer, /新总分必须严格高于/);
});

test('Darwin optimization history uses the required schema and evaluation modes', async () => {
  const results = await fs.readFile(path.join(repoRoot, 'docs/skill-optimization/results.tsv'), 'utf8');
  const lines = results.trimEnd().split('\n');

  assert.equal(
    lines[0],
    'timestamp\tcommit\tskill\told_score\tnew_score\tstatus\tdimension\tnote\teval_mode'
  );
  for (const line of lines.slice(1)) {
    const columns = line.split('\t');
    assert.equal(columns.length, 9);
    assert.ok(['paired', 'full_test', 'dry_run'].includes(columns[8]));
  }
});
