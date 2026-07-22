import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadKibanaConfig,
  getEnvironmentConfig,
  validateEnvironmentAuthProfile
} from '../../skills/bamhub/integrations/kibana-search/lib/config.js';

function createTempConfigDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kibana-config-'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value));
}

function writeText(filePath, value) {
  fs.writeFileSync(filePath, value);
}

test('validateEnvironmentAuthProfile checks shared auth profile reference', () => {
  const tempDir = createTempConfigDir();
  const kibanaConfigPath = path.join(tempDir, 'config.json');
  const authConfigPath = path.join(tempDir, 'auth-config.json');

  writeJson(kibanaConfigPath, {
    environments: {
      bg_prod_main: {
        auth: { profile: 'bg_prod_main_sso' },
        tools: { kibana: { baseUrl: 'https://kibana.example.com' } }
      }
    }
  });

  writeJson(authConfigPath, {
    profiles: {
      bg_prod_main_sso: { type: 'sso_browser', credentialRef: 'bg_prod_main', loginMode: 'auto' }
    }
  });

  const config = loadKibanaConfig(kibanaConfigPath);
  const env = getEnvironmentConfig(config, 'bg_prod_main');
  assert.deepEqual(validateEnvironmentAuthProfile(env, authConfigPath), {
    profileName: 'bg_prod_main_sso',
    credentialRef: 'bg_prod_main'
  });
});

test('loadKibanaConfig rejects invalid JSON', () => {
  const tempDir = createTempConfigDir();
  const kibanaConfigPath = path.join(tempDir, 'config.json');
  writeText(kibanaConfigPath, '{ invalid json');

  assert.throws(
    () => loadKibanaConfig(kibanaConfigPath),
    /CONFIG_INVALID/
  );
});

test('loadKibanaConfig rejects non-object config', () => {
  const invalidConfigs = [null, [], 'invalid'];

  for (const configJson of invalidConfigs) {
    const tempDir = createTempConfigDir();
    const kibanaConfigPath = path.join(tempDir, 'config.json');
    writeJson(kibanaConfigPath, configJson);

    assert.throws(
      () => loadKibanaConfig(kibanaConfigPath),
      /CONFIG_INVALID/
    );
  }
});

test('loadKibanaConfig rejects missing or invalid environments', () => {
  const invalidConfigs = [
    {},
    { environments: null },
    { environments: [] },
    { environments: 'invalid' }
  ];

  for (const configJson of invalidConfigs) {
    const tempDir = createTempConfigDir();
    const kibanaConfigPath = path.join(tempDir, 'config.json');
    writeJson(kibanaConfigPath, configJson);

    assert.throws(
      () => loadKibanaConfig(kibanaConfigPath),
      /CONFIG_INVALID/
    );
  }
});

test('getEnvironmentConfig rejects missing environment', () => {
  assert.throws(
    () => getEnvironmentConfig({ environments: {} }, 'missing_env'),
    /CONFIG_MISSING_ENV:missing_env/
  );
});

test('getEnvironmentConfig rejects invalid environment shape', () => {
  const invalidEnvironments = [null, [], 'invalid'];

  for (const envConfig of invalidEnvironments) {
    assert.throws(
      () => getEnvironmentConfig({ environments: { bg_prod_main: envConfig } }, 'bg_prod_main'),
      /CONFIG_INVALID_ENV:bg_prod_main/
    );
  }
});

test('getEnvironmentConfig rejects environment without kibana tool config', () => {
  assert.throws(
    () => getEnvironmentConfig({ environments: { bg_prod_main: { tools: {} } } }, 'bg_prod_main'),
    /CONFIG_MISSING_TOOL:bg_prod_main/
  );
});

test('getEnvironmentConfig rejects invalid kibana tool shape', () => {
  const invalidTools = [null, [], 'invalid'];

  for (const kibanaConfig of invalidTools) {
    assert.throws(
      () => getEnvironmentConfig({ environments: { bg_prod_main: { tools: { kibana: kibanaConfig } } } }, 'bg_prod_main'),
      /CONFIG_INVALID_TOOL:bg_prod_main/
    );
  }
});

test('validateEnvironmentAuthProfile rejects missing auth profile reference with config error', () => {
  const tempDir = createTempConfigDir();
  const authConfigPath = path.join(tempDir, 'auth-config.json');
  writeJson(authConfigPath, { profiles: {} });

  assert.throws(
    () => validateEnvironmentAuthProfile({ auth: {} }, authConfigPath),
    /CONFIG_MISSING_AUTH_PROFILE/
  );
});

test('validateEnvironmentAuthProfile rejects missing referenced auth profile', () => {
  const tempDir = createTempConfigDir();
  const authConfigPath = path.join(tempDir, 'auth-config.json');
  writeJson(authConfigPath, { profiles: {} });

  assert.throws(
    () => validateEnvironmentAuthProfile({ auth: { profile: 'bg_prod_main_sso' } }, authConfigPath),
    /AUTH_PROFILE_MISSING:bg_prod_main_sso/
  );
});

test('validateEnvironmentAuthProfile rejects auth profile that violates shared-auth schema', () => {
  const tempDir = createTempConfigDir();
  const authConfigPath = path.join(tempDir, 'auth-config.json');
  writeJson(authConfigPath, {
    profiles: {
      bg_prod_main_sso: { type: 'sso_browser', credentialRef: 'bg_prod_main' }
    }
  });

  assert.throws(
    () => validateEnvironmentAuthProfile({ auth: { profile: 'bg_prod_main_sso' } }, authConfigPath),
    /AUTH_CONFIG_INVALID/
  );
});
