import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadAuthConfig, getAuthProfile } from '../../skills/shared-auth/lib/auth-config.js';

test('loadAuthConfig reads profiles from repository-local config', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-auth-config-'));
  const configPath = path.join(tempDir, 'auth-config.json');

  fs.writeFileSync(configPath, JSON.stringify({
    profiles: {
      bg_prod_main_sso: {
        type: 'sso_browser',
        credentialRef: 'bg_prod_main',
        loginMode: 'auto'
      }
    }
  }));

  const config = loadAuthConfig(configPath);
  assert.equal(config.profiles.bg_prod_main_sso.credentialRef, 'bg_prod_main');
  assert.equal(getAuthProfile(config, 'bg_prod_main_sso').loginMode, 'auto');
});


test('loadAuthConfig rejects profiles that are missing or not a non-array object', () => {
  const invalidConfigs = [
    {},
    { profiles: [] },
    { profiles: null },
    { profiles: 'invalid' }
  ];

  for (const configJson of invalidConfigs) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-auth-config-invalid-profiles-'));
    const configPath = path.join(tempDir, 'auth-config.json');
    fs.writeFileSync(configPath, JSON.stringify(configJson));

    assert.throws(
      () => loadAuthConfig(configPath),
      /AUTH_CONFIG_INVALID/
    );
  }
});

test('loadAuthConfig rejects profiles with missing required fields', () => {
  const invalidProfiles = [
    { credentialRef: 'bg_prod_main', loginMode: 'auto' },
    { type: 'sso_browser', loginMode: 'auto' },
    { type: 'sso_browser', credentialRef: 'bg_prod_main' }
  ];

  for (const profile of invalidProfiles) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-auth-config-invalid-profile-'));
    const configPath = path.join(tempDir, 'auth-config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      profiles: {
        bg_prod_main_sso: profile
      }
    }));

    assert.throws(
      () => loadAuthConfig(configPath),
      /AUTH_CONFIG_INVALID/
    );
  }
});

test('getAuthProfile rejects missing profile', () => {
  assert.throws(
    () => getAuthProfile({ profiles: {} }, 'missing_sso'),
    /AUTH_PROFILE_MISSING:missing_sso/
  );
});
