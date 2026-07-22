import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const cli = path.join(root, 'skills/bamhub/integrations/kibana-search/scripts/kibana-search');

function writeJson(dir, name, value) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
  return file;
}

function runCli(args, env = {}) {
  return spawnSync(cli, args, {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: 'utf8'
  });
}

function assertNoStackTrace(stderr) {
  assert.equal(stderr.includes('Error:'), false);
  assert.equal(stderr.includes('\n    at '), false);
  assert.equal(stderr.includes('MODULE_TYPELESS_PACKAGE_JSON'), false);
}

function makeConfigDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kibana-search-cli-'));
  const kibanaConfig = writeJson(dir, 'kibana-config.json', {
    environments: {
      bg_prod_main: {
        auth: { profile: 'bg_prod_main_sso' },
        tools: {
          kibana: {
            preferredBackend: 'kibana',
            baseUrl: 'https://kibana.example.com',
            defaultDataViewId: 'logs-*',
            dataViewTtlSeconds: 600,
            fields: {
              serviceField: 'service.name',
              levelField: 'log.level',
              messageField: 'message',
              traceIdField: 'trace.id'
            }
          }
        }
      }
    }
  });
  const authConfig = writeJson(dir, 'auth-config.json', {
    profiles: { bg_prod_main_sso: { type: 'sso', credentialRef: 'bg_prod_main_sso', loginMode: 'headless' } }
  });
  const credentials = path.join(dir, 'credentials.json');
  return { kibanaConfig, authConfig, credentials };
}

test('script is executable and delegates to cli-kibana-search.js', () => {
  const mode = fs.statSync(cli).mode;
  assert.equal((mode & 0o111) !== 0, true);
});

test('logs --json with missing credentials returns stable JSON auth error', () => {
  const paths = makeConfigDir();
  const result = runCli([
    'logs',
    '--env', 'bg_prod_main',
    '--service', 'groot-lms-learning-server',
    '--level', 'ERROR',
    '--json'
  ], {
    KIBANA_SEARCH_CONFIG: paths.kibanaConfig,
    SHARED_AUTH_CONFIG: paths.authConfig,
    SHARED_AUTH_CREDENTIALS: paths.credentials
  });

  assert.equal(result.status, 1);
  assertNoStackTrace(result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.deepEqual(payload, {
    ok: false,
    error: {
      code: 'AUTH_MISSING_CREDENTIAL',
      message: 'Credential for profile bg_prod_main_sso is missing.',
      suggestion: 'Run shared-auth login --profile bg_prod_main_sso before searching Kibana logs.'
    }
  });
});

test('logs --json with expired credential returns stable JSON auth error', () => {
  const paths = makeConfigDir();
  writeJson(path.dirname(paths.credentials), 'credentials.json', {
    profiles: { bg_prod_main_sso: { expiresAt: '2000-01-01T00:00:00.000Z' } }
  });

  const result = runCli(['logs', '--env', 'bg_prod_main', '--json'], {
    KIBANA_SEARCH_CONFIG: paths.kibanaConfig,
    SHARED_AUTH_CONFIG: paths.authConfig,
    SHARED_AUTH_CREDENTIALS: paths.credentials
  });

  assert.equal(result.status, 1);
  assertNoStackTrace(result.stderr);
  assert.equal(JSON.parse(result.stdout).error.code, 'AUTH_EXPIRED');
});

test('logs reads credentialRef while missing credential suggestion uses profile name', () => {
  const paths = makeConfigDir();
  writeJson(path.dirname(paths.authConfig), 'auth-config.json', {
    profiles: { bg_prod_main_sso: { type: 'sso', credentialRef: 'bg_prod_main', loginMode: 'headless' } }
  });
  writeJson(path.dirname(paths.credentials), 'credentials.json', {
    profiles: {
      bg_prod_main: {
        cookie: 'sid=123',
        expiresAt: '2099-01-01T00:00:00.000Z'
      }
    }
  });

  const cachePath = writeJson(path.dirname(paths.credentials), 'cache.json', {
    environments: {
      bg_prod_main: {
        fetchedAt: '2099-01-01T00:00:00.000Z',
        ttlSeconds: 86400,
        dataViewId: 'logs-*',
        fields: {
          serviceField: 'service.name',
          levelField: 'log.level',
          messageField: 'message',
          traceIdField: 'trace.id'
        }
      }
    }
  });

  const result = runCli(['logs', '--env', 'bg_prod_main', '--json'], {
    KIBANA_SEARCH_CONFIG: paths.kibanaConfig,
    SHARED_AUTH_CONFIG: paths.authConfig,
    SHARED_AUTH_CREDENTIALS: paths.credentials,
    KIBANA_SEARCH_CACHE: cachePath
  });

  assert.equal(result.status, 1);
  assertNoStackTrace(result.stderr);
  assert.equal(JSON.parse(result.stdout).error.code, 'QUERY_FAILED');
});

test('logs uses cached data view without refreshing metadata', () => {
  const paths = makeConfigDir();
  writeJson(path.dirname(paths.authConfig), 'auth-config.json', {
    profiles: { bg_prod_main_sso: { type: 'sso', credentialRef: 'bg_prod_main', loginMode: 'headless' } }
  });
  writeJson(path.dirname(paths.credentials), 'credentials.json', {
    profiles: {
      bg_prod_main: {
        cookie: 'sid=123',
        expiresAt: '2099-01-01T00:00:00.000Z'
      }
    }
  });
  const cachePath = writeJson(path.dirname(paths.credentials), 'cache.json', {
    environments: {
      bg_prod_main: {
        fetchedAt: '2099-01-01T00:00:00.000Z',
        ttlSeconds: 86400,
        dataViewId: 'logs-*',
        fields: {
          serviceField: 'service.name',
          levelField: 'log.level',
          messageField: 'message',
          traceIdField: 'trace.id'
        }
      }
    }
  });

  const result = runCli(['logs', '--env', 'bg_prod_main', '--service', 'api', '--json'], {
    KIBANA_SEARCH_CONFIG: paths.kibanaConfig,
    SHARED_AUTH_CONFIG: paths.authConfig,
    SHARED_AUTH_CREDENTIALS: paths.credentials,
    KIBANA_SEARCH_CACHE: cachePath
  });

  assert.equal(result.status, 1);
  assertNoStackTrace(result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.error.code, 'QUERY_FAILED');
});


test('missing --env returns stable JSON error without stack trace', () => {
  const result = runCli(['logs', '--json']);

  assert.equal(result.status, 1);
  assertNoStackTrace(result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.error.code, 'KIBANA_ENV_REQUIRED');
  assert.equal(result.stdout.includes('Error:'), false);
});

test('unsupported command returns stable JSON error', () => {
  const result = runCli(['fields', '--json']);

  assert.equal(result.status, 1);
  assertNoStackTrace(result.stderr);
  assert.equal(JSON.parse(result.stdout).error.code, 'KIBANA_COMMAND_UNSUPPORTED');
});
