import { loadKibanaConfig, getEnvironmentConfig, validateEnvironmentAuthProfile } from './config.js';
import { buildKql } from './query-builder.js';
import { chooseBackend } from './backend.js';
import { createKibanaClient } from './kibana-client.js';
import { loadCacheEntry, saveCacheEntry, isCacheExpired } from './cache-store.js';
import { formatJsonResult, formatTextLogs, printJson } from './output.js';
import { loadCredential, isExpired } from '../../shared-auth/lib/credentials-store.js';
import {
  unsupportedCommand,
  envRequired,
  configInvalid,
  authMissingCredential,
  authExpiredCredential,
  kibanaError
} from './errors.js';

const ERROR_STATUS = 1;
const SUCCESS_STATUS = 0;
const DEFAULT_CACHE_PATH = 'skills/bamhub/integrations/kibana-search/.local/cache.json';

function isValidOptionValue(value) {
  return Boolean(value) && !value.startsWith('--');
}

function parseOption(args, name) {
  const index = args.indexOf(name);
  if (index < 0) {
    return undefined;
  }
  const value = args[index + 1];
  return isValidOptionValue(value) ? value : undefined;
}

function emit(payload, { json, status = ERROR_STATUS } = {}) {
  if (json) {
    printJson(payload);
  } else if (payload.ok) {
    process.stdout.write(formatTextLogs(payload.logs));
  } else {
    process.stdout.write(`${payload.error.message}\n${payload.error.suggestion}\n`);
  }
  process.exitCode = status;
}

function hasFlag(args, name) {
  return args.includes(name);
}

function filtersFromArgs(args) {
  return {
    service: parseOption(args, '--service'),
    level: parseOption(args, '--level'),
    keyword: parseOption(args, '--keyword'),
    traceId: parseOption(args, '--trace-id')
  };
}

function normalizeConfigError(error) {
  if (error?.message?.startsWith('CONFIG_') || error?.message?.startsWith('AUTH_PROFILE_') || error?.message?.startsWith('CACHE_')) {
    return configInvalid();
  }
  if (error?.message === 'QUERY_BACKEND_UNAVAILABLE') {
    return kibanaError(
      'QUERY_BACKEND_UNAVAILABLE',
      'Kibana query backend is unavailable in this runtime.',
      'Use Node.js with fetch support, provide a reachable Kibana baseUrl, and ensure credentials are valid.'
    );
  }
  if (error?.message?.startsWith('QUERY_FAILED')) {
    return kibanaError(
      'QUERY_FAILED',
      'Kibana query failed before logs could be returned.',
      'Check Kibana search configuration, credentials, and query options.'
    );
  }
  return kibanaError(
    'KIBANA_SEARCH_FAILED',
    'Kibana search failed before logs could be returned.',
    'Check Kibana search configuration, credentials, and query options.'
  );
}

async function resolveDataView(client, cachePath, envName, refreshCache) {
  const cached = refreshCache ? undefined : loadCacheEntry(cachePath, envName);
  if (cached && !isCacheExpired(cached)) {
    return cached;
  }

  const dataView = await client.fetchDataView({ refresh: refreshCache });
  saveCacheEntry(cachePath, envName, dataView);
  return dataView;
}

export async function run(argv = process.argv.slice(2), env = process.env) {
  const command = argv[0];
  const json = argv.includes('--json');

  if (command !== 'logs') {
    emit(unsupportedCommand(command), { json });
    return;
  }

  const envName = parseOption(argv, '--env');
  if (!envName) {
    emit(envRequired(), { json });
    return;
  }

  const configPath = env.KIBANA_SEARCH_CONFIG || 'skills/bamhub/integrations/kibana-search/.local/config.json';
  const authConfigPath = env.SHARED_AUTH_CONFIG || 'skills/bamhub/integrations/shared-auth/.local/auth-config.json';
  const credentialsPath = env.SHARED_AUTH_CREDENTIALS || 'skills/bamhub/integrations/shared-auth/.local/credentials.json';
  const cachePath = env.KIBANA_SEARCH_CACHE || DEFAULT_CACHE_PATH;

  try {
    const config = loadKibanaConfig(configPath);
    const environmentConfig = getEnvironmentConfig(config, envName);
    const { profileName, credentialRef } = validateEnvironmentAuthProfile(environmentConfig, authConfigPath);
    const credential = loadCredential(credentialsPath, credentialRef);

    if (!credential) {
      emit(authMissingCredential(profileName), { json });
      return;
    }
    if (isExpired(credential)) {
      emit(authExpiredCredential(profileName), { json });
      return;
    }

    const kibanaConfig = environmentConfig.tools.kibana;
    const client = createKibanaClient(kibanaConfig, credential);
    const backend = chooseBackend(kibanaConfig, { hasKibanaClient: client.available, hasEsClient: false });
    const dataView = await resolveDataView(client, cachePath, envName, hasFlag(argv, '--refresh-cache'));
    const query = buildKql(dataView.fields, filtersFromArgs(argv));
    const logs = await client.searchLogs({
      dataViewId: dataView.dataViewId,
      query,
      timeRange: dataView.timeRange,
      fields: dataView.fields,
      limit: Number.parseInt(parseOption(argv, '--limit') ?? '', 10) || undefined
    });

    emit(formatJsonResult({
      env: envName,
      backend,
      dataViewId: dataView.dataViewId,
      query,
      logs
    }), { json, status: SUCCESS_STATUS });
  } catch (error) {
    emit(normalizeConfigError(error), { json });
  }
}

run();
