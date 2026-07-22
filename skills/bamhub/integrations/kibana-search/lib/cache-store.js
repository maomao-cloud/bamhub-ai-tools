import fs from 'node:fs';
import path from 'node:path';

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function loadCacheStore(cachePath) {
  if (!fs.existsSync(cachePath)) {
    return { environments: {} };
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  } catch {
    throw new Error('CACHE_INVALID');
  }

  if (!isObject(parsed) || !isObject(parsed.environments)) {
    throw new Error('CACHE_INVALID');
  }

  return parsed;
}

export function saveCacheEntry(cachePath, envName, entry) {
  const store = loadCacheStore(cachePath);
  store.environments[envName] = entry;

  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(store, null, 2));
}

export function loadCacheEntry(cachePath, envName) {
  return loadCacheStore(cachePath).environments[envName];
}

export function isCacheExpired(entry, now = new Date()) {
  if (!entry || !entry.fetchedAt) {
    return true;
  }

  const fetchedAtMs = Date.parse(entry.fetchedAt);
  if (Number.isNaN(fetchedAtMs)) {
    return true;
  }

  const ttlSeconds = entry.ttlSeconds ?? 0;
  return fetchedAtMs + ttlSeconds * 1000 <= now.getTime();
}
