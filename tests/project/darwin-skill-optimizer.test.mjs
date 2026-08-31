import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const maintenanceSkills = [
  'rule-refine',
  'sync-module-doc',
  'version-changelog'
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

test('Darwin optimization history starts with the required empty schema', async () => {
  const results = await fs.readFile(path.join(repoRoot, 'docs/skill-optimization/results.tsv'), 'utf8');
  const lines = results.trimEnd().split('\n');

  assert.equal(
    lines[0],
    'timestamp\tcommit\tskill\told_score\tnew_score\tstatus\tdimension\tnote\teval_mode'
  );
  assert.equal(lines.length, 1);
});
