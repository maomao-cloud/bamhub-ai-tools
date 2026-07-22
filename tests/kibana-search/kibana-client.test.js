import test from 'node:test';
import assert from 'node:assert/strict';
import { createKibanaClient } from '../../skills/bamhub/integrations/kibana-search/lib/kibana-client.js';

test('createKibanaClient creates available Kibana client', () => {
  const client = createKibanaClient();

  assert.equal(client.available, true);
});

test('fetchDataView returns configured metadata without remote refresh', async () => {
  let fetchCalled = false;
  const client = createKibanaClient({
    defaultDataViewId: 'logs-*',
    dataViewTtlSeconds: 600,
    fields: { serviceField: 'service.name', levelField: 'log.level' }
  }, { cookie: 'sid=123' }, {
    fetchImpl: async () => {
      fetchCalled = true;
      throw new Error('unexpected fetch');
    }
  });

  const dataView = await client.fetchDataView();

  assert.equal(fetchCalled, false);
  assert.equal(dataView.dataViewId, 'logs-*');
  assert.equal(dataView.ttlSeconds, 600);
  assert.deepEqual(dataView.fields, { serviceField: 'service.name', levelField: 'log.level' });
  assert.match(dataView.fetchedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('fetchDataView calls Kibana data view API when remote refresh is requested', async () => {
  const requests = [];
  const client = createKibanaClient({
    baseUrl: 'https://kibana.example.com/base',
    space: 'prod',
    defaultDataViewId: 'logs-*',
    cache: { dataViewTtlSeconds: 30 }
  }, { cookie: 'sid=123' }, {
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        json: async () => ({
          data_view: {
            id: 'logs-*',
            fields: {
              service: { name: 'service.name' },
              level: { name: 'log.level' }
            }
          }
        })
      };
    }
  });

  const dataView = await client.fetchDataView({ refresh: true });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://kibana.example.com/base/s/prod/api/data_views/data_view/logs-*');
  assert.equal(requests[0].options.headers.cookie, 'sid=123');
  assert.equal(dataView.dataViewId, 'logs-*');
  assert.deepEqual(dataView.fields, { serviceField: 'service.name', levelField: 'log.level' });
  assert.equal(dataView.ttlSeconds, 30);
});

test('searchLogs sends Kibana search request and returns hit sources or fields', async () => {
  const requests = [];
  const client = createKibanaClient({
    baseUrl: 'https://kibana.example.com',
    space: 'default',
    timeField: '@timestamp'
  }, { headers: { authorization: 'Bearer token' } }, {
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        json: async () => ({
          hits: {
            hits: [
              { _source: { message: 'from source' } },
              { fields: { message: ['from fields'], level: ['ERROR'] } }
            ]
          }
        })
      };
    }
  });

  const logs = await client.searchLogs({
    dataViewId: 'logs-*',
    query: 'level:"ERROR"',
    timeRange: { from: 'now-15m', to: 'now' },
    fields: ['message', 'level'],
    limit: 2
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://kibana.example.com/internal/search/es');
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[0].options.headers.authorization, 'Bearer token');
  assert.equal(requests[0].options.headers['kbn-xsrf'], 'true');
  assert.deepEqual(JSON.parse(requests[0].options.body).params.body.query.bool.must[0], {
    query_string: { query: 'level:"ERROR"' }
  });
  assert.deepEqual(logs, [
    { message: 'from source' },
    { message: ['from fields'], level: ['ERROR'] }
  ]);
});

test('searchLogs fails instead of returning empty logs when fetch is unavailable', async () => {
  const client = createKibanaClient({
    baseUrl: 'https://kibana.example.com',
    defaultDataViewId: 'logs-*'
  }, {}, { fetchImpl: null });

  await assert.rejects(
    () => client.searchLogs({ dataViewId: 'logs-*', query: 'level:"ERROR"' }),
    /QUERY_BACKEND_UNAVAILABLE/
  );
});
