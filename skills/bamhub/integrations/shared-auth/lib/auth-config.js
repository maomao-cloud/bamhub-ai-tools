import fs from 'node:fs';

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isValidProfile(profile) {
  return isObject(profile)
    && profile.type
    && profile.credentialRef
    && profile.loginMode;
}

export function loadAuthConfig(configPath) {
  const raw = fs.readFileSync(configPath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!isObject(parsed.profiles)) {
    throw new Error('AUTH_CONFIG_INVALID');
  }

  for (const profile of Object.values(parsed.profiles)) {
    if (!isValidProfile(profile)) {
      throw new Error('AUTH_CONFIG_INVALID');
    }
  }

  return parsed;
}

export function getAuthProfile(config, profileName) {
  const profile = config.profiles[profileName];
  if (!profile) {
    throw new Error(`AUTH_PROFILE_MISSING:${profileName}`);
  }
  return profile;
}
