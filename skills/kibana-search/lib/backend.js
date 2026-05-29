const BACKENDS = new Set(['kibana', 'es', 'auto']);

export function chooseBackend(kibanaConfig = {}, capabilities = {}) {
  const preferredBackend = kibanaConfig.preferredBackend ?? 'auto';

  if (!BACKENDS.has(preferredBackend)) {
    throw new Error(`QUERY_BACKEND_UNKNOWN:${preferredBackend}`);
  }

  if (preferredBackend === 'es') {
    if (!capabilities.hasEsClient) {
      throw new Error('QUERY_BACKEND_UNAVAILABLE:es');
    }
    return 'es';
  }

  if (preferredBackend === 'kibana') {
    if (!capabilities.hasKibanaClient) {
      throw new Error('QUERY_BACKEND_UNAVAILABLE:kibana');
    }
    return 'kibana';
  }

  if (capabilities.hasEsClient) {
    return 'es';
  }
  if (capabilities.hasKibanaClient) {
    return 'kibana';
  }

  throw new Error('QUERY_BACKEND_UNAVAILABLE:auto');
}
