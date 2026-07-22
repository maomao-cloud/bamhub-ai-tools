import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseLoginMode } from '../../skills/bamhub/integrations/shared-auth/lib/login-flows.js';

test('chooseLoginMode falls back to headless when browser is unavailable', () => {
  const mode = chooseLoginMode(
    { loginMode: 'auto' },
    { hasGui: false, canLaunchBrowser: false, canImportSession: true }
  );

  assert.equal(mode, 'headless');
});

test('chooseLoginMode honors explicit import mode', () => {
  const mode = chooseLoginMode(
    { loginMode: 'auto' },
    { hasGui: false, canLaunchBrowser: false, canImportSession: true },
    'import'
  );

  assert.equal(mode, 'import');
});

test('chooseLoginMode returns gui when browser launch is available', () => {
  const mode = chooseLoginMode(
    { loginMode: 'auto' },
    { hasGui: true, canLaunchBrowser: true, canImportSession: true }
  );

  assert.equal(mode, 'gui');
});

test('chooseLoginMode rejects explicit gui when browser is unavailable', () => {
  assert.throws(
    () => chooseLoginMode(
      { loginMode: 'auto' },
      { hasGui: false, canLaunchBrowser: false, canImportSession: true },
      'gui'
    ),
    /AUTH_CAPABILITY_UNAVAILABLE/
  );
});

test('chooseLoginMode rejects when no login capability is available', () => {
  assert.throws(
    () => chooseLoginMode(
      { loginMode: 'auto' },
      { hasGui: false, canLaunchBrowser: false, canImportSession: false }
    ),
    /AUTH_CAPABILITY_UNAVAILABLE/
  );
});

test('chooseLoginMode honors profile import mode', () => {
  const mode = chooseLoginMode(
    { loginMode: 'import' },
    { hasGui: false, canLaunchBrowser: false, canImportSession: false }
  );

  assert.equal(mode, 'import');
});

test('chooseLoginMode honors profile gui mode when browser launch is available', () => {
  const mode = chooseLoginMode(
    { loginMode: 'gui' },
    { hasGui: true, canLaunchBrowser: true, canImportSession: true }
  );

  assert.equal(mode, 'gui');
});

test('chooseLoginMode rejects profile gui mode when browser is unavailable', () => {
  assert.throws(
    () => chooseLoginMode(
      { loginMode: 'gui' },
      { hasGui: false, canLaunchBrowser: false, canImportSession: true }
    ),
    /AUTH_CAPABILITY_UNAVAILABLE/
  );
});

test('chooseLoginMode honors profile headless mode when import is available', () => {
  const mode = chooseLoginMode(
    { loginMode: 'headless' },
    { hasGui: true, canLaunchBrowser: true, canImportSession: true }
  );

  assert.equal(mode, 'headless');
});

test('chooseLoginMode rejects headless mode when import is unavailable', () => {
  assert.throws(
    () => chooseLoginMode(
      { loginMode: 'headless' },
      { hasGui: true, canLaunchBrowser: true, canImportSession: false }
    ),
    /AUTH_CAPABILITY_UNAVAILABLE/
  );
});

test('chooseLoginMode lets explicit mode override profile mode', () => {
  const mode = chooseLoginMode(
    { loginMode: 'gui' },
    { hasGui: false, canLaunchBrowser: false, canImportSession: true },
    'headless'
  );

  assert.equal(mode, 'headless');
});
