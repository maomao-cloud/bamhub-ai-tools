import test from 'node:test';
import assert from 'node:assert/strict';
import { createKibanaClient } from '../../skills/kibana-search/lib/kibana-client.js';

test('createKibanaClient creates available Kibana client stub', () => {
  const client = createKibanaClient();

  assert.equal(client.available, true);
});

test('fetchDataView returns metadata with configured data view and fields', async () => {
  const client = createKibanaClient({
    dataViewId: 'logs-*',
    dataViewTtlSeconds: 600,
    fields: { serviceField: 'service.name', levelField: 'log.level' }
  });

  const dataView = await client.fetchDataView();

  assert.equal(dataView.dataViewId, 'logs-*');
  assert.equal(dataView.ttlSeconds, 600);
  assert.deepEqual(dataView.fields, { serviceField: 'service.name', levelField: 'log.level' });
  assert.match(dataView.fetchedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('searchLogs returns empty log list stub', async () => {
  const client = createKibanaClient();

  assert.deepEqual(await client.searchLogs({ query: 'level:"ERROR"' }), []);
});
