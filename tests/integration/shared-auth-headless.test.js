import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

function runAuth(args, env = {}) {
  const result = spawnSync('bash', [
    'skills/shared-auth/scripts/auth',
    ...args
  ], {
    env: {
      ...process.env,
      SHARED_AUTH_CONFIG: 'skills/shared-auth/templates/auth-config.example.json',
      SHARED_AUTH_CREDENTIALS: 'skills/shared-auth/.local/test-credentials.json',
      ...env
    },
    encoding: 'utf8'
  });

  return {
    ...result,
    payload: JSON.parse(result.stdout)
  };
}

function assertNoStackTrace(result) {
  assert.doesNotMatch(result.stderr, /(?:Error:|at .*cli-auth|Node\.js v\d+|MODULE_TYPELESS_PACKAGE_JSON)/);
}

test('auth login emits headless action required JSON when browser is unavailable', () => {
  const result = runAuth([
    'login',
    '--profile',
    'bg_prod_main_sso',
    '--mode',
    'headless',
    '--json'
  ]);

  assert.equal(result.status, 0);
  assertNoStackTrace(result);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.error.code, 'AUTH_HEADLESS_ACTION_REQUIRED');
});

test('auth login requires profile argument as JSON error', () => {
  const result = runAuth(['login', '--json']);

  assert.equal(result.status, 1);
  assertNoStackTrace(result);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.error.code, 'AUTH_PROFILE_REQUIRED');
});

test('auth login rejects profile flag without value as JSON error', () => {
  const result = runAuth(['login', '--profile', '--json']);

  assert.equal(result.status, 1);
  assertNoStackTrace(result);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.error.code, 'AUTH_PROFILE_REQUIRED');
});


test('auth login rejects command-like profile value as JSON error', () => {
  const result = runAuth(['login', '--profile', 'status', '--json']);

  assert.equal(result.status, 1);
  assertNoStackTrace(result);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.error.code, 'AUTH_PROFILE_REQUIRED');
});

test('auth rejects unsupported command as JSON error', () => {
  const result = runAuth(['logout', '--json']);

  assert.equal(result.status, 1);
  assertNoStackTrace(result);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.error.code, 'AUTH_COMMAND_UNSUPPORTED');
});

test('auth login import mode emits import action required JSON', () => {
  const result = runAuth([
    'login',
    '--profile',
    'bg_prod_main_sso',
    '--mode',
    'import',
    '--json'
  ]);

  assert.equal(result.status, 0);
  assertNoStackTrace(result);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.error.code, 'AUTH_IMPORT_ACTION_REQUIRED');
  assert.match(result.payload.error.message, /cookie|header/i);
  assert.doesNotMatch(result.payload.error.suggestion, /--mode import/i);
});

test('auth login missing profile emits normalized JSON error', () => {
  const result = runAuth([
    'login',
    '--profile',
    'missing_profile',
    '--json'
  ]);

  assert.equal(result.status, 1);
  assertNoStackTrace(result);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.error.code, 'AUTH_PROFILE_MISSING');
});

test('auth login gui mode emits gui action required JSON when browser is available', () => {
  const result = runAuth([
    'login',
    '--profile',
    'bg_prod_main_sso',
    '--mode',
    'gui',
    '--json'
  ], {
    DISPLAY: ':0'
  });

  assert.equal(result.status, 0);
  assertNoStackTrace(result);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.error.code, 'AUTH_GUI_ACTION_REQUIRED');
});

test('auth login missing config emits normalized JSON error', () => {
  const result = runAuth([
    'login',
    '--profile',
    'bg_prod_main_sso',
    '--json'
  ], {
    SHARED_AUTH_CONFIG: 'skills/shared-auth/.local/missing-auth-config.json'
  });

  assert.equal(result.status, 1);
  assertNoStackTrace(result);
  assert.equal(result.payload.ok, false);
  assert.equal(result.payload.error.code, 'AUTH_CONFIG_INVALID');
});
