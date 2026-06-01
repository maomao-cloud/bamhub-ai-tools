import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  saveCredential,
  loadCredential,
  clearCredential,
  isExpired
} from '../../skills/shared-auth/lib/credentials-store.js';

test('credential store saves and loads by profile key', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-auth-credentials-'));
  const credentialsPath = path.join(tempDir, 'credentials.json');

  saveCredential(credentialsPath, 'bg_prod_main_sso', {
    source: 'headless',
    cookie: 'sid=123',
    expiresAt: '2099-01-01T00:00:00.000Z'
  });

  const stored = loadCredential(credentialsPath, 'bg_prod_main_sso');
  assert.equal(stored.source, 'headless');
  assert.equal(stored.cookie, 'sid=123');
  assert.equal(isExpired(stored), false);

  clearCredential(credentialsPath, 'bg_prod_main_sso');
  assert.equal(loadCredential(credentialsPath, 'bg_prod_main_sso'), null);
});


test('credential store writes credentials with strict owner-only permissions', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-auth-credentials-mode-'));
  const credentialsPath = path.join(tempDir, 'credentials.json');

  saveCredential(credentialsPath, 'bg_prod_main_sso', {
    source: 'headless',
    cookie: 'sid=123'
  });

  if (process.platform !== 'win32') {
    const mode = fs.statSync(credentialsPath).mode & 0o777;
    assert.equal(mode, 0o600);
  }
});

test('credential store normalizes existing file permissions to owner-only', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-auth-credentials-existing-mode-'));
  const credentialsPath = path.join(tempDir, 'credentials.json');
  fs.writeFileSync(credentialsPath, JSON.stringify({ profiles: {} }), { mode: 0o644 });

  saveCredential(credentialsPath, 'bg_prod_main_sso', {
    source: 'headless',
    cookie: 'sid=123'
  });

  if (process.platform !== 'win32') {
    const mode = fs.statSync(credentialsPath).mode & 0o777;
    assert.equal(mode, 0o600);
  }
});

test('credential store rejects malformed JSON with domain error', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-auth-credentials-invalid-json-'));
  const credentialsPath = path.join(tempDir, 'credentials.json');
  fs.writeFileSync(credentialsPath, '{not json');

  assert.throws(
    () => loadCredential(credentialsPath, 'bg_prod_main_sso'),
    /CREDENTIAL_STORE_INVALID/
  );
});

test('credential store rejects missing or invalid profiles shape', () => {
  const invalidStores = [
    {},
    { profiles: [] },
    { profiles: null },
    { profiles: 'invalid' }
  ];

  for (const store of invalidStores) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-auth-credentials-invalid-store-'));
    const credentialsPath = path.join(tempDir, 'credentials.json');
    fs.writeFileSync(credentialsPath, JSON.stringify(store));

    assert.throws(
      () => loadCredential(credentialsPath, 'bg_prod_main_sso'),
      /CREDENTIAL_STORE_INVALID/
    );
  }
});
