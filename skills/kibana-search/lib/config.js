import fs from 'node:fs';
import { loadAuthConfig, getAuthProfile } from '../../shared-auth/lib/auth-config.js';

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function loadKibanaConfig(configPath) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    throw new Error('CONFIG_INVALID');
  }

  if (!isObject(parsed) || !isObject(parsed.environments)) {
    throw new Error('CONFIG_INVALID');
  }

  return parsed;
}

export function getEnvironmentConfig(config, envName) {
  const env = config.environments?.[envName];
  if (env === undefined) {
    throw new Error(`CONFIG_MISSING_ENV:${envName}`);
  }
  if (!isObject(env)) {
    throw new Error(`CONFIG_INVALID_ENV:${envName}`);
  }
  if (env.tools?.kibana === undefined) {
    throw new Error(`CONFIG_MISSING_TOOL:${envName}`);
  }
  if (!isObject(env.tools.kibana)) {
    throw new Error(`CONFIG_INVALID_TOOL:${envName}`);
  }
  return env;
}

export function validateEnvironmentAuthProfile(envConfig, authConfigPath) {
  const profileName = envConfig.auth?.profile;
  if (!profileName) {
    throw new Error('CONFIG_MISSING_AUTH_PROFILE');
  }

  const authConfig = loadAuthConfig(authConfigPath);
  const profile = getAuthProfile(authConfig, profileName);
  return { profileName, credentialRef: profile.credentialRef };
}
