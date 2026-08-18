import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, resolveService, resolveApiKey } from '../../skills/bamhub/integrations/ai-capability/lib/config.js';

function writeConfig(value) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-capability-config-'));
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
}

test('loads default service and resolves API key from configured environment variable', () => {
  const file = writeConfig({
    defaultService: 'bamboo',
    services: {
      bamboo: { baseUrl: 'https://ai.example.com/api/open', apiKeyEnv: 'TEST_AI_KEY' }
    }
  });

  const config = loadConfig(file);
  const service = resolveService(config);
  assert.equal(service.name, 'bamboo');
  assert.equal(service.baseUrl, 'https://ai.example.com/api/open');
  assert.equal(resolveApiKey(service, { TEST_AI_KEY: 'secret-value' }), 'secret-value');
});

test('rejects missing API key without revealing the configured key name as a secret', () => {
  const file = writeConfig({
    defaultService: 'bamboo',
    services: { bamboo: { baseUrl: 'https://ai.example.com/api/open', apiKeyEnv: 'TEST_AI_KEY' } }
  });

  const service = resolveService(loadConfig(file));
  assert.throws(() => resolveApiKey(service, {}), error => {
    assert.equal(error.code, 'AUTH_API_KEY_MISSING');
    assert.doesNotMatch(error.message, /secret-value/);
    return true;
  });
});

test('loads the API key from the configured local keychain service when environment is empty', () => {
  const service = {
    baseUrl: 'https://ai.example.com/api/open',
    apiKeyEnv: 'TEST_AI_KEY',
    apiKeyKeychainService: 'test-ai-capability'
  };

  assert.equal(resolveApiKey(service, {}, () => 'keychain-value'), 'keychain-value');
});

test('loads the bundled local configuration when invoked outside the repository root', () => {
  const previous = process.env.AI_CAPABILITY_CONFIG;
  const cwd = process.cwd();
  delete process.env.AI_CAPABILITY_CONFIG;
  try {
    process.chdir(os.tmpdir());
    const config = loadConfig();
    assert.equal(config.defaultService, 'bamboo');
  } finally {
    process.chdir(cwd);
    if (previous === undefined) delete process.env.AI_CAPABILITY_CONFIG;
    else process.env.AI_CAPABILITY_CONFIG = previous;
  }
});
