import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDiscoverUrl } from '../../skills/kibana-search/lib/discover-url.js';

const sampleDiscoverUrl = 'https://kibana.bg.allschool.com/app/discover#/?_g=(filters:!(),refreshInterval:(pause:!t,value:0),time:(from:now-15h,to:now))&_a=(columns:!(level,message),filters:!(),index:f12ae960-16d1-11ec-97d3-31b29b7fe5a5,interval:auto,query:(language:kuery,query:\'APP_NAME:%22groot-lms-learning-server%22%20and%20level%20:%20%22ERROR%22%20\'),sort:!())';

test('parseDiscoverUrl extracts discover state from Kibana URL', () => {
  const parsed = parseDiscoverUrl(sampleDiscoverUrl);

  assert.deepEqual(parsed, {
    baseUrl: 'https://kibana.bg.allschool.com',
    dataViewId: 'f12ae960-16d1-11ec-97d3-31b29b7fe5a5',
    columns: ['level', 'message'],
    timeRange: { from: 'now-15h', to: 'now' },
    kql: 'APP_NAME:"groot-lms-learning-server" and level : "ERROR" '
  });
  assert.match(parsed.kql, /groot-lms-learning-server/);
});

test('parseDiscoverUrl returns empty query when Discover query is absent', () => {
  const parsed = parseDiscoverUrl('https://kibana.example.com/app/discover#/?_g=(time:(from:now-1h,to:now))&_a=(columns:!(),index:logs)');

  assert.equal(parsed.kql, '');
  assert.equal(parsed.dataViewId, 'logs');
});

test('parseDiscoverUrl throws a clear error when hash state is missing', () => {
  assert.throws(
    () => parseDiscoverUrl('https://kibana.example.com/app/discover'),
    /DISCOVER_URL_MISSING_HASH_STATE/
  );
});

test('parseDiscoverUrl throws a clear error when app state is missing', () => {
  assert.throws(
    () => parseDiscoverUrl('https://kibana.example.com/app/discover#/?_g=(time:(from:now-1h,to:now))'),
    /DISCOVER_URL_MISSING_APP_STATE/
  );
});

test('parseDiscoverUrl preserves literal percent characters in KQL', () => {
  const parsed = parseDiscoverUrl('https://kibana.example.com/app/discover#/?_g=(time:(from:now-1h,to:now))&_a=(columns:!(),index:logs,query:(language:kuery,query:\'message:"100%"\'))');

  assert.equal(parsed.kql, 'message:"100%"');
});

test('parseDiscoverUrl throws a clear error when index is missing', () => {
  assert.throws(
    () => parseDiscoverUrl('https://kibana.example.com/app/discover#/?_g=(time:(from:now-1h,to:now))&_a=(columns:!(),query:(language:kuery,query:\'message:test\'))'),
    /DISCOVER_URL_MISSING_INDEX/
  );
});

test('parseDiscoverUrl returns null timeRange when time state is absent or incomplete', () => {
  assert.equal(
    parseDiscoverUrl('https://kibana.example.com/app/discover#/?_a=(columns:!(),index:logs)').timeRange,
    null
  );
  assert.equal(
    parseDiscoverUrl('https://kibana.example.com/app/discover#/?_g=(time:(from:now-1h))&_a=(columns:!(),index:logs)').timeRange,
    null
  );
});

test('parseDiscoverUrl matches index key outside quoted KQL literals', () => {
  const parsed = parseDiscoverUrl("https://kibana.example.com/app/discover#/?_a=(columns:!(),query:(language:kuery,query:'index:foo'),index:logs-data-view)");

  assert.equal(parsed.dataViewId, 'logs-data-view');
  assert.equal(parsed.kql, 'index:foo');
});

test('parseDiscoverUrl preserves Kibana space base path', () => {
  const parsed = parseDiscoverUrl('https://kibana.example.com/s/prod/app/discover#/?_a=(columns:!(),index:logs)');

  assert.equal(parsed.baseUrl, 'https://kibana.example.com/s/prod');
});

test('parseDiscoverUrl keeps origin base URL when no space path is present', () => {
  const parsed = parseDiscoverUrl('https://kibana.example.com/app/discover#/?_a=(columns:!(),index:logs)');

  assert.equal(parsed.baseUrl, 'https://kibana.example.com');
});

