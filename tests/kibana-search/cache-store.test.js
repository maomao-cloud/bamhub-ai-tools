import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  saveCacheEntry,
  loadCacheEntry,
  isCacheExpired
} from '../../skills/kibana-search/lib/cache-store.js';

function createTempCachePath() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kibana-cache-'));
  return path.join(tempDir, 'cache.json');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

test('saveCacheEntry and loadCacheEntry persist entries by environment name', () => {
  const cachePath = createTempCachePath();
  const entry = { columns: ['@timestamp', 'message'], fetchedAt: '2026-05-29T00:00:00.000Z' };

  saveCacheEntry(cachePath, 'bg_prod_main', entry);

  assert.deepEqual(loadCacheEntry(cachePath, 'bg_prod_main'), entry);
  assert.deepEqual(readJson(cachePath), {
    environments: {
      bg_prod_main: entry
    }
  });
});

test('saveCacheEntry preserves other environment entries', () => {
  const cachePath = createTempCachePath();
  const firstEntry = { columns: ['message'], fetchedAt: '2026-05-29T00:00:00.000Z' };
  const secondEntry = { columns: ['traceId'], fetchedAt: '2026-05-29T01:00:00.000Z' };

  saveCacheEntry(cachePath, 'bg_prod_main', firstEntry);
  saveCacheEntry(cachePath, 'bg_gray', secondEntry);

  assert.deepEqual(loadCacheEntry(cachePath, 'bg_prod_main'), firstEntry);
  assert.deepEqual(loadCacheEntry(cachePath, 'bg_gray'), secondEntry);
});

test('loadCacheEntry treats missing cache file and missing environment as expired misses', () => {
  const cachePath = createTempCachePath();

  assert.equal(loadCacheEntry(cachePath, 'bg_prod_main'), undefined);
  saveCacheEntry(cachePath, 'bg_prod_main', { fetchedAt: '2026-05-29T00:00:00.000Z' });
  assert.equal(loadCacheEntry(cachePath, 'bg_gray'), undefined);
  assert.equal(isCacheExpired(undefined, new Date('2026-05-29T00:00:00.000Z')), true);
});

test('isCacheExpired applies ttl in seconds', () => {
  const now = new Date('2026-05-29T01:00:00.000Z');

  assert.equal(
    isCacheExpired({ fetchedAt: '2026-05-29T00:30:00.000Z', ttlSeconds: 60 * 60 }, now),
    false
  );
  assert.equal(
    isCacheExpired({ fetchedAt: '2026-05-28T23:59:59.999Z', ttlSeconds: 60 * 60 }, now),
    true
  );
});

test('loadCacheEntry rejects invalid cache JSON and shape clearly', () => {
  const invalidJsonPath = createTempCachePath();
  fs.writeFileSync(invalidJsonPath, '{ invalid json');

  assert.throws(
    () => loadCacheEntry(invalidJsonPath, 'bg_prod_main'),
    /CACHE_INVALID/
  );

  const invalidShapePath = createTempCachePath();
  fs.writeFileSync(invalidShapePath, JSON.stringify({ environments: [] }));

  assert.throws(
    () => loadCacheEntry(invalidShapePath, 'bg_prod_main'),
    /CACHE_INVALID/
  );
});
