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

export function createKibanaClient(config = {}) {
  return {
    available: true,
    async fetchDataView() {
      return {
        fetchedAt: new Date().toISOString(),
        ttlSeconds: resolveTtlSeconds(config),
        dataViewId: resolveDataViewId(config),
        fields: resolveFields(config)
      };
    },
    async searchLogs() {
      return [];
    }
  };
}
