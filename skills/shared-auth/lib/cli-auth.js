import { loadAuthConfig, getAuthProfile } from './auth-config.js';
import { detectLoginCapabilities } from './capability-detection.js';
import { chooseLoginMode } from './login-flows.js';
import { authError, printJson } from './errors.js';

const SUCCESS_STATUS = 0;
const ERROR_STATUS = 1;
const RESERVED_PROFILE_TOKENS = new Set(['login', 'logout', 'status']);

function isValidOptionValue(value) {
  return Boolean(value) && !value.startsWith('--') && !RESERVED_PROFILE_TOKENS.has(value);
}

function parseOption(args, name) {
  const index = args.indexOf(name);
  if (index < 0) {
    return undefined;
  }
  const value = args[index + 1];
  if (!isValidOptionValue(value)) {
    return undefined;
  }
  return value;
}

function emit(payload, { json, status = ERROR_STATUS } = {}) {
  if (json) {
    printJson(payload);
  } else {
    process.stdout.write(`${payload.error.message}
${payload.error.suggestion}
`);
  }
  process.exitCode = status;
}

function unsupportedCommand(command) {
  return authError(
    'AUTH_COMMAND_UNSUPPORTED',
    `Unsupported auth command: ${command || '(missing)'}.`,
    'Use auth login with --profile <profile-name>.'
  );
}

function profileRequired() {
  return authError(
    'AUTH_PROFILE_REQUIRED',
    'Auth login requires --profile <profile-name>.',
    'Provide a configured profile name, for example --profile bg_prod_main_sso.'
  );
}

function configInvalid() {
  return authError(
    'AUTH_CONFIG_INVALID',
    'Shared auth configuration is missing or invalid.',
    'Set SHARED_AUTH_CONFIG to a readable auth config JSON file with valid profiles.'
  );
}

function profileMissing(profileName) {
  return authError(
    'AUTH_PROFILE_MISSING',
    `Auth profile ${profileName} was not found.`,
    'Check SHARED_AUTH_CONFIG and provide an existing profile name.'
  );
}

function capabilityUnavailable(mode) {
  return authError(
    'AUTH_CAPABILITY_UNAVAILABLE',
    `Auth login mode ${mode || 'auto'} is unavailable in this environment.`,
    'Use --mode headless or --mode import when browser launch is unavailable.'
  );
}

function headlessActionRequired(profileName) {
  return authError(
    'AUTH_HEADLESS_ACTION_REQUIRED',
    `Complete login for profile ${profileName} in an external browser and import the resulting session.`,
    'Open the provider login URL outside this process, then import cookie/header input.'
  );
}

function importActionRequired(profileName) {
  return authError(
    'AUTH_IMPORT_ACTION_REQUIRED',
    `Import an existing authenticated session for profile ${profileName} by providing cookie or header input.`,
    'Provide the captured Cookie header or required auth headers to the shared-auth import flow.'
  );
}

function normalizeConfigError(error, profileName) {
  if (error?.message?.startsWith('AUTH_PROFILE_MISSING:')) {
    return profileMissing(profileName);
  }
  return configInvalid();
}

const args = process.argv.slice(2);
const command = args[0];
const json = args.includes('--json');
const profileName = parseOption(args, '--profile');
const explicitMode = parseOption(args, '--mode');
const configPath = process.env.SHARED_AUTH_CONFIG || 'skills/shared-auth/.local/auth-config.json';

if (command !== 'login') {
  emit(unsupportedCommand(command), { json });
} else if (!profileName) {
  emit(profileRequired(), { json });
} else {
  let profile;
  try {
    profile = getAuthProfile(loadAuthConfig(configPath), profileName);
  } catch (error) {
    emit(normalizeConfigError(error, profileName), { json });
  }

  if (profile) {
    try {
      const mode = chooseLoginMode(profile, detectLoginCapabilities(), explicitMode);
      if (mode === 'import') {
        emit(importActionRequired(profileName), { json, status: SUCCESS_STATUS });
      } else if (mode === 'headless') {
        emit(headlessActionRequired(profileName), { json, status: SUCCESS_STATUS });
      }
    } catch (error) {
      if (error?.message === 'AUTH_CAPABILITY_UNAVAILABLE') {
        emit(capabilityUnavailable(explicitMode || profile.loginMode), { json });
      } else {
        emit(configInvalid(), { json });
      }
    }
  }
}
