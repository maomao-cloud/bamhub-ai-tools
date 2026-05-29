import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKql } from '../../skills/kibana-search/lib/query-builder.js';

const fields = {
  serviceField: 'APP_NAME',
  levelField: 'level',
  messageField: 'message',
  traceIdField: 'traceId'
};

test('buildKql assembles service level keyword and trace filters', () => {
  assert.equal(
    buildKql(fields, {
      service: 'groot-lms-learning-server',
      level: 'ERROR',
      keyword: 'timeout',
      traceId: 'abc-123'
    }),
    'APP_NAME:"groot-lms-learning-server" and level:"ERROR" and message:"timeout" and traceId:"abc-123"'
  );
});

test('buildKql returns empty query when no filters are provided', () => {
  assert.equal(buildKql(fields, {}), '');
  assert.equal(buildKql(fields, { service: '', level: '   ' }), '');
});

test('buildKql escapes special characters inside quoted KQL values', () => {
  assert.equal(
    buildKql(fields, {
      service: 'groot "api"',
      keyword: 'path C:\\temp\\logs'
    }),
    'APP_NAME:"groot \\"api\\"" and message:"path C:\\\\temp\\\\logs"'
  );
});

test('buildKql rejects missing required field names for provided filters', () => {
  assert.throws(
    () => buildKql({ serviceField: 'APP_NAME' }, { keyword: 'timeout' }),
    /KQL_FIELD_MISSING:messageField/
  );
});
