function resolveDataViewId(config = {}) {
  return config.dataViewId ?? config.defaultDataViewId;
}

function resolveTtlSeconds(config = {}) {
  return config.dataViewTtlSeconds ?? config.cache?.dataViewTtlSeconds ?? 0;
}

function resolveFields(config = {}) {
  return config.fields ?? {
    serviceField: config.serviceField,
    levelField: config.levelField,
    messageField: config.messageField,
    traceIdField: config.traceIdField,
    timeField: config.timeField
  };
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined && field !== null && field !== ''));
}

function hasConfiguredMetadata(config = {}) {
  return Boolean(resolveDataViewId(config) && Object.keys(compactObject(resolveFields(config))).length > 0);
}

function getFetchImpl(options = {}) {
  if (Object.hasOwn(options, 'fetchImpl')) {
    return typeof options.fetchImpl === 'function' ? options.fetchImpl : null;
  }
  return typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null;
}

function requireFetch(fetchImpl) {
  if (!fetchImpl) {
    throw new Error('QUERY_BACKEND_UNAVAILABLE');
  }
  return fetchImpl;
}

function normalizeBaseUrl(baseUrl) {
  if (!baseUrl) {
    throw new Error('QUERY_BACKEND_UNAVAILABLE');
  }
  return String(baseUrl).replace(/\/+$/, '');
}

function spacePath(config = {}) {
  const space = config.space;
  if (!space || space === 'default') {
    return '';
  }

  const basePath = new URL(normalizeBaseUrl(config.baseUrl)).pathname.replace(/\/+$/, '');
  const encodedSpace = encodeURIComponent(space);
  if (basePath.endsWith(`/s/${encodedSpace}`)) {
    return '';
  }
  return `/s/${encodedSpace}`;
}

function kibanaUrl(config, path) {
  return `${normalizeBaseUrl(config.baseUrl)}${spacePath(config)}${path}`;
}

function credentialHeaders(credential = {}) {
  const headers = { ...(credential.headers ?? {}) };
  if (credential.cookie && !headers.cookie && !headers.Cookie) {
    headers.cookie = credential.cookie;
  }
  if (credential.authorization && !headers.authorization && !headers.Authorization) {
    headers.authorization = credential.authorization;
  }
  if (credential.bearerToken && !headers.authorization && !headers.Authorization) {
    headers.authorization = `Bearer ${credential.bearerToken}`;
  }
  if (credential.apiKey && !headers.authorization && !headers.Authorization) {
    headers.authorization = `ApiKey ${credential.apiKey}`;
  }
  return headers;
}

async function parseJsonResponse(response) {
  if (!response?.ok) {
    throw new Error(`QUERY_FAILED:${response?.status ?? 'unknown'}`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error('QUERY_FAILED:INVALID_JSON');
  }
}

function fieldName(field) {
  if (typeof field === 'string') {
    return field;
  }
  return field?.name;
}

function fieldsFromDataView(dataView = {}) {
  const fields = Object.values(dataView.fields ?? {}).map(fieldName).filter(Boolean);
  const findField = (...candidates) => fields.find((field) => candidates.includes(field))
    ?? fields.find((field) => candidates.includes(field.split('.').at(-1)));

  return compactObject({
    serviceField: findField('service.name', 'service', 'APP_NAME'),
    levelField: findField('log.level', 'level'),
    messageField: findField('message'),
    traceIdField: findField('trace.id', 'traceId', 'trace_id'),
    timeField: findField('@timestamp', 'timestamp')
  });
}

function makeMetadata(config, overrides = {}) {
  return {
    fetchedAt: new Date().toISOString(),
    ttlSeconds: resolveTtlSeconds(config),
    dataViewId: overrides.dataViewId ?? resolveDataViewId(config),
    fields: compactObject({ ...resolveFields(config), ...(overrides.fields ?? {}) })
  };
}

function normalizeFields(fields) {
  if (Array.isArray(fields)) {
    return fields;
  }
  return Object.values(fields ?? {}).filter(Boolean);
}

function buildSearchBody(config, { dataViewId, query, timeRange, fields, limit } = {}) {
  const must = [];
  const filter = [];

  if (query) {
    must.push({ query_string: { query } });
  }

  const timeField = config.timeField ?? fields?.timeField ?? '@timestamp';
  if (timeRange?.from || timeRange?.to) {
    filter.push({
      range: {
        [timeField]: compactObject({ gte: timeRange.from, lte: timeRange.to })
      }
    });
  }

  return {
    params: {
      index: dataViewId,
      body: {
        size: limit ?? config.limit ?? config.defaultLimit ?? 100,
        fields: normalizeFields(fields).map((field) => ({ field })),
        query: {
          bool: {
            must,
            filter
          }
        }
      }
    }
  };
}

function extractHits(payload) {
  return payload?.hits?.hits
    ?? payload?.rawResponse?.hits?.hits
    ?? payload?.result?.rawResponse?.hits?.hits
    ?? [];
}

function rawLogFromHit(hit) {
  if (hit?._source !== undefined) {
    return hit._source;
  }
  if (hit?.fields !== undefined) {
    return hit.fields;
  }
  return hit;
}

export function createKibanaClient(config = {}, credential = {}, options = {}) {
  const fetchImpl = getFetchImpl(options);

  return {
    available: true,
    async fetchDataView({ refresh = false } = {}) {
      if (!refresh && hasConfiguredMetadata(config)) {
        return makeMetadata(config);
      }

      const fetch = requireFetch(fetchImpl);
      const dataViewId = resolveDataViewId(config);
      if (!dataViewId) {
        throw new Error('QUERY_FAILED:MISSING_DATA_VIEW');
      }

      let response;
      try {
        response = await fetch(kibanaUrl(config, `/api/data_views/data_view/${encodeURIComponent(dataViewId)}`), {
          method: 'GET',
          headers: {
            ...credentialHeaders(credential),
            'kbn-xsrf': 'true'
          }
        });
      } catch {
        throw new Error('QUERY_FAILED');
      }
      const payload = await parseJsonResponse(response);
      const dataView = payload.data_view ?? payload.dataView ?? {};

      return makeMetadata(config, {
        dataViewId: dataView.id ?? dataView.title ?? dataViewId,
        fields: fieldsFromDataView(dataView)
      });
    },
    async searchLogs({ dataViewId, query, timeRange, fields, limit } = {}) {
      const fetch = requireFetch(fetchImpl);
      let response;
      try {
        response = await fetch(kibanaUrl(config, '/internal/search/es'), {
          method: 'POST',
          headers: {
            ...credentialHeaders(credential),
            'content-type': 'application/json',
            'kbn-xsrf': 'true'
          },
          body: JSON.stringify(buildSearchBody(config, { dataViewId, query, timeRange, fields, limit }))
        });
      } catch {
        throw new Error('QUERY_FAILED');
      }
      const payload = await parseJsonResponse(response);
      return extractHits(payload).map(rawLogFromHit);
    }
  };
}
