import test from 'node:test';
import assert from 'node:assert/strict';
import { detectLoginCapabilities } from '../../skills/shared-auth/lib/capability-detection.js';

test('detectLoginCapabilities reports headless when display is unavailable', () => {
  const capabilities = detectLoginCapabilities({
    env: {},
    platform: 'linux',
    which: () => null
  });

  assert.equal(capabilities.hasGui, false);
  assert.equal(capabilities.canLaunchBrowser, false);
  assert.equal(capabilities.canImportSession, true);
});

test('detectLoginCapabilities uses process env and default PATH probing when arguments are omitted', () => {
  const capabilities = detectLoginCapabilities();

  assert.equal(typeof capabilities.hasGui, 'boolean');
  assert.equal(typeof capabilities.canLaunchBrowser, 'boolean');
  assert.equal(capabilities.canImportSession, true);
  assert.equal(capabilities.browserCommand === null || typeof capabilities.browserCommand === 'string', true);
  if (process.platform === 'darwin') {
    assert.match(capabilities.browserCommand ?? '', /open$/);
    assert.equal(capabilities.canLaunchBrowser, true);
  }
});

test('detectLoginCapabilities detects Linux GUI and prefers xdg-open', () => {
  const probed = [];
  const capabilities = detectLoginCapabilities({
    env: { DISPLAY: ':0', SESSIONNAME: 'ignored-on-linux' },
    platform: 'linux',
    which: (command) => {
      probed.push(command);
      return command === 'xdg-open' ? '/usr/bin/xdg-open' : null;
    }
  });

  assert.equal(capabilities.hasGui, true);
  assert.equal(capabilities.canLaunchBrowser, true);
  assert.equal(capabilities.browserCommand, '/usr/bin/xdg-open');
  assert.deepEqual(probed, ['xdg-open']);
});

test('detectLoginCapabilities does not treat SESSIONNAME as Linux GUI', () => {
  const capabilities = detectLoginCapabilities({
    env: { SESSIONNAME: 'console' },
    platform: 'linux',
    which: () => '/usr/bin/xdg-open'
  });

  assert.equal(capabilities.hasGui, false);
  assert.equal(capabilities.canLaunchBrowser, false);
});

test('detectLoginCapabilities detects macOS GUI through open command', () => {
  const probed = [];
  const capabilities = detectLoginCapabilities({
    env: {},
    platform: 'darwin',
    which: (command) => {
      probed.push(command);
      return command === 'open' ? '/usr/bin/open' : null;
    }
  });

  assert.equal(capabilities.hasGui, true);
  assert.equal(capabilities.canLaunchBrowser, true);
  assert.equal(capabilities.browserCommand, '/usr/bin/open');
  assert.deepEqual(probed, ['open']);
});

test('detectLoginCapabilities detects Windows GUI through SESSIONNAME and uses start marker', () => {
  const probed = [];
  const capabilities = detectLoginCapabilities({
    env: { SESSIONNAME: 'Console' },
    platform: 'win32',
    which: (command) => {
      probed.push(command);
      return command === 'start' ? 'start' : null;
    }
  });

  assert.equal(capabilities.hasGui, true);
  assert.equal(capabilities.canLaunchBrowser, true);
  assert.equal(capabilities.browserCommand, 'start');
  assert.deepEqual(probed, ['start']);
});

test('detectLoginCapabilities detects other platforms from DISPLAY only', () => {
  const capabilities = detectLoginCapabilities({
    env: { DISPLAY: ':0', SESSIONNAME: 'ignored' },
    platform: 'freebsd',
    which: () => null
  });

  assert.equal(capabilities.hasGui, true);
  assert.equal(capabilities.canLaunchBrowser, false);
});
