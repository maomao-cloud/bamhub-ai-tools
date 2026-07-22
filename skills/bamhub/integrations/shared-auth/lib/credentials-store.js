import fs from 'node:fs';

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateStore(store) {
  if (!isObject(store.profiles)) {
    throw new Error('CREDENTIAL_STORE_INVALID');
  }
}

function readStore(credentialsPath) {
  if (!fs.existsSync(credentialsPath)) {
    return { profiles: {} };
  }

  try {
    const store = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
    validateStore(store);
    return store;
  } catch (error) {
    if (error.message === 'CREDENTIAL_STORE_INVALID') {
      throw error;
    }
    throw new Error('CREDENTIAL_STORE_INVALID');
  }
}

function writeStore(credentialsPath, store) {
  fs.writeFileSync(credentialsPath, JSON.stringify(store, null, 2), { mode: 0o600 });
  fs.chmodSync(credentialsPath, 0o600);
}

export function saveCredential(credentialsPath, profileName, credential) {
  const store = readStore(credentialsPath);
  store.profiles[profileName] = credential;
  writeStore(credentialsPath, store);
}

export function loadCredential(credentialsPath, profileName) {
  const store = readStore(credentialsPath);
  return store.profiles[profileName] ?? null;
}

export function clearCredential(credentialsPath, profileName) {
  const store = readStore(credentialsPath);
  delete store.profiles[profileName];
  writeStore(credentialsPath, store);
}

export function isExpired(credential) {
  if (!credential?.expiresAt) {
    return false;
  }
  return Date.parse(credential.expiresAt) <= Date.now();
}
