import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseBackend } from '../../skills/kibana-search/lib/backend.js';
import { createEsClient } from '../../skills/kibana-search/lib/es-client.js';

test('chooseBackend uses explicit kibana backend when Kibana client is available', () => {
  const backend = chooseBackend(
    { preferredBackend: 'kibana' },
    { hasKibanaClient: true, hasEsClient: true }
  );

  assert.equal(backend, 'kibana');
});

test('chooseBackend uses explicit es backend when ES client is available', () => {
  const backend = chooseBackend(
    { preferredBackend: 'es' },
    { hasKibanaClient: true, hasEsClient: true }
  );

  assert.equal(backend, 'es');
});

test('chooseBackend auto mode prefers ES client when available', () => {
  const backend = chooseBackend(
    { preferredBackend: 'auto' },
    { hasKibanaClient: true, hasEsClient: true }
  );

  assert.equal(backend, 'es');
});

test('chooseBackend auto mode falls back to Kibana when ES client is unavailable', () => {
  const backend = chooseBackend(
    { preferredBackend: 'auto' },
    { hasKibanaClient: true, hasEsClient: false }
  );

  assert.equal(backend, 'kibana');
});

test('chooseBackend defaults missing preferredBackend to auto', () => {
  const backend = chooseBackend(
    {},
    { hasKibanaClient: true, hasEsClient: false }
  );

  assert.equal(backend, 'kibana');
});

test('chooseBackend rejects fixed backends when requested client is unavailable', () => {
  assert.throws(
    () => chooseBackend({ preferredBackend: 'es' }, { hasKibanaClient: true, hasEsClient: false }),
    /QUERY_BACKEND_UNAVAILABLE:es/
  );

  assert.throws(
    () => chooseBackend({ preferredBackend: 'kibana' }, { hasKibanaClient: false, hasEsClient: true }),
    /QUERY_BACKEND_UNAVAILABLE:kibana/
  );
});

test('chooseBackend rejects auto mode when no backend client is available', () => {
  assert.throws(
    () => chooseBackend({ preferredBackend: 'auto' }, { hasKibanaClient: false, hasEsClient: false }),
    /QUERY_BACKEND_UNAVAILABLE:auto/
  );
});

test('chooseBackend rejects unknown preferredBackend clearly', () => {
  assert.throws(
    () => chooseBackend({ preferredBackend: 'elasticsearch' }, { hasKibanaClient: true, hasEsClient: true }),
    /QUERY_BACKEND_UNKNOWN:elasticsearch/
  );
});

test('createEsClient is an unavailable stub until ES support is implemented', async () => {
  const client = createEsClient();

  assert.equal(client.available, false);
  await assert.rejects(
    () => client.search({ index: 'logs-*' }),
    /QUERY_BACKEND_UNAVAILABLE:es/
  );
});
