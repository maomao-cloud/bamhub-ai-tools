import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const cli = path.join(root, 'skills/bamhub/integrations/ai-capability/scripts/ai-capability');

function setupConfig() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-capability-cli-'));
  const config = path.join(dir, 'config.json');
  fs.writeFileSync(config, JSON.stringify({
    defaultService: 'bamboo',
    services: { bamboo: { baseUrl: 'https://ai.example.com/api/open', apiKeyEnv: 'TEST_AI_KEY' } }
  }));
  return config;
}

test('missing API key returns stable JSON and does not make a request', () => {
  const result = spawnSync(cli, ['capabilities', '--json'], {
    cwd: root,
    env: { ...process.env, AI_CAPABILITY_CONFIG: setupConfig(), TEST_AI_KEY: '' },
    encoding: 'utf8'
  });

  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'AUTH_API_KEY_MISSING');
  assert.doesNotMatch(result.stdout, /secret-value/);
  assert.equal(result.stderr, '');
});
