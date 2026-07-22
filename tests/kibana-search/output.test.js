import test from 'node:test';
import assert from 'node:assert/strict';
import { formatJsonResult, formatTextLogs } from '../../skills/bamhub/integrations/kibana-search/lib/output.js';

test('formatJsonResult returns stable successful log payload', () => {
  const payload = formatJsonResult({
    env: 'bg_prod_main',
    backend: 'kibana',
    dataViewId: 'logs-*',
    query: 'service:"groot-lms-learning-server"',
    logs: ['raw line 1']
  });

  assert.deepEqual(payload, {
    ok: true,
    env: 'bg_prod_main',
    backend: 'kibana',
    dataViewId: 'logs-*',
    query: 'service:"groot-lms-learning-server"',
    logs: ['raw line 1']
  });
});

test('formatTextLogs formats raw log lines one per line with trailing newline', () => {
  assert.equal(formatTextLogs(['first log', 'second log']), 'first log\nsecond log\n');
});

test('formatTextLogs returns empty string for no logs', () => {
  assert.equal(formatTextLogs([]), '');
});
