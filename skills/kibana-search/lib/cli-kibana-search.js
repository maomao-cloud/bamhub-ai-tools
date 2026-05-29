import { loadKibanaConfig, getEnvironmentConfig, validateEnvironmentAuthProfile } from './config.js';
import { buildKql } from './query-builder.js';
import { chooseBackend } from './backend.js';
import { createKibanaClient } from './kibana-client.js';
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

function filtersFromArgs(args) {
  return {
    service: parseOption(args, '--service'),
    level: parseOption(args, '--level'),
    keyword: parseOption(args, '--keyword'),
    traceId: parseOption(args, '--trace-id')
  };
}

function normalizeConfigError(error) {
  if (error?.message?.startsWith('CONFIG_') || error?.message?.startsWith('AUTH_PROFILE_')) {
    return configInvalid();
  }
  return kibanaError(
    'KIBANA_SEARCH_FAILED',
    'Kibana search failed before logs could be returned.',
    'Check Kibana search configuration, credentials, and query options.'
  );
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

  const configPath = env.KIBANA_SEARCH_CONFIG || 'skills/kibana-search/.local/config.json';
  const authConfigPath = env.SHARED_AUTH_CONFIG || 'skills/shared-auth/.local/auth-config.json';
  const credentialsPath = env.SHARED_AUTH_CREDENTIALS || 'skills/shared-auth/.local/credentials.json';

  try {
    const config = loadKibanaConfig(configPath);
    const environmentConfig = getEnvironmentConfig(config, envName);
    const profileName = validateEnvironmentAuthProfile(environmentConfig, authConfigPath);
    const credential = loadCredential(credentialsPath, profileName);

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
    const dataView = await client.fetchDataView();
    const query = buildKql(dataView.fields, filtersFromArgs(argv));
    const logs = await client.searchLogs({ dataViewId: dataView.dataViewId, query, env: envName });

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
