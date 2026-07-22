export function kibanaError(code, message, suggestion) {
  return { ok: false, error: { code, message, suggestion } };
}

export function unsupportedCommand(command) {
  return kibanaError(
    'KIBANA_COMMAND_UNSUPPORTED',
    `Unsupported kibana-search command: ${command || '(missing)'}.`,
    'Use kibana-search logs with --env <environment>.'
  );
}

export function envRequired() {
  return kibanaError(
    'KIBANA_ENV_REQUIRED',
    'Kibana log search requires --env <environment>.',
    'Provide an environment configured in KIBANA_SEARCH_CONFIG.'
  );
}

export function configInvalid() {
  return kibanaError(
    'KIBANA_CONFIG_INVALID',
    'Kibana search configuration is missing or invalid.',
    'Set KIBANA_SEARCH_CONFIG to a readable Kibana config JSON file.'
  );
}

export function authMissingCredential(profileName) {
  return kibanaError(
    'AUTH_MISSING_CREDENTIAL',
    `Credential for profile ${profileName} is missing.`,
    `Run shared-auth login --profile ${profileName} before searching Kibana logs.`
  );
}

export function authExpiredCredential(profileName) {
  return kibanaError(
    'AUTH_EXPIRED',
    `Credential for profile ${profileName} is expired.`,
    `Run shared-auth login --profile ${profileName} to refresh credentials before searching Kibana logs.`
  );
}
