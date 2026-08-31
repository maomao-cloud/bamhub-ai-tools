import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient } from '../../skills/bamhub/integrations/ai-capability/lib/api-client.js';

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

test('injects API key into page list, detail, and invoke requests', async () => {
  const requests = [];
  const client = createApiClient({
    baseUrl: 'https://ai.example.com/api/open/',
    apiKey: 'secret-value',
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return response({ data: { list: [], total: 0 } });
    }
  });

  await client.list({ keyword: '日志' });
  await client.describe('kibana_log_search');
  await client.invoke('kibana_log_search', { body: '{}' });

  assert.equal(requests.length, 3);
  for (const request of requests) {
    assert.equal(request.options.headers['X-API-KEY'], 'secret-value');
    assert.equal(request.options.headers['Content-Type'], 'application/json');
  }
  assert.match(requests[0].url, /\/ai\/capability\/page$/);
  assert.match(requests[1].url, /\/ai\/capability\/page$/);
  assert.match(requests[2].url, /\/ai\/capability\/invoke$/);
  assert.equal(JSON.parse(requests[0].options.body).detail, false);
  assert.deepEqual(JSON.parse(requests[1].options.body).codes, ['kibana_log_search']);
  assert.equal(JSON.parse(requests[1].options.body).detail, true);
  assert.equal(JSON.parse(requests[2].options.body).capabilityCode, 'kibana_log_search');
});

test('normalizes authentication failures without leaking API key', async () => {
  const client = createApiClient({
    baseUrl: 'https://ai.example.com/api/open',
    apiKey: 'secret-value',
    fetchImpl: async () => response({ message: 'unauthorized secret-value' }, 401)
  });

  await assert.rejects(() => client.list(), error => {
    assert.equal(error.code, 'AUTH_API_KEY_INVALID');
    assert.doesNotMatch(error.message, /secret-value/);
    return true;
  });
});
