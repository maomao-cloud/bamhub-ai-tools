import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const VERSION = 1;

function stateError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertPlainJson(value, label) {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    throw stateError('IDENTITY_INVALID', `${label} must contain only plain JSON values`);
  }
  if (value === null) return;
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw stateError('IDENTITY_INVALID', `${label} must contain only finite JSON numbers`);
  }
  if (typeof value === 'object') {
    if (Array.isArray(value)) {
      for (const item of value) assertPlainJson(item, label);
    } else {
      if (!isPlainObject(value)) throw stateError('IDENTITY_INVALID', `${label} must contain only plain JSON values`);
      for (const [key, item] of Object.entries(value)) assertPlainJson(item, `${label}.${key}`);
    }
  }
}

function stable(value) {
  assertPlainJson(value, 'stable input');
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function digest(value) {
  const json = JSON.stringify(stable(value));
  if (json === undefined) throw stateError('IDENTITY_INVALID', 'identity must be representable as plain JSON');
  return crypto.createHash('sha256').update(json).digest('hex');
}

function identityCanonicalPath(identity, label) {
  const canonicalPath = identity?.canonicalPath ?? identity?.realPath;
  if (!isPlainObject(identity) || typeof canonicalPath !== 'string' || !path.isAbsolute(canonicalPath)) {
    throw stateError('IDENTITY_INVALID', `${label} must include an absolute canonicalPath`);
  }
  return canonicalPath;
}

function validIdentity(identity, label, { git = false } = {}) {
  assertPlainJson(identity, label);
  const canonicalPath = identityCanonicalPath(identity, label);
  if (!Number.isSafeInteger(identity.dev) || identity.dev < 0 || !Number.isSafeInteger(identity.ino) || identity.ino < 0) {
    throw stateError('IDENTITY_INVALID', `${label} must include non-negative integer dev and ino`);
  }
  if (git) {
    for (const key of ['gitRemote', 'gitCommit']) {
      if (key in identity && typeof identity[key] !== 'string') {
        throw stateError('IDENTITY_INVALID', `${label}.${key} must be a string when present`);
      }
    }
  }
  return canonicalPath;
}

function targetFields(identity) {
  const canonicalPath = validIdentity(identity, 'target identity');
  return {
    ...(identity.path === undefined ? {} : { path: identity.path }),
    canonicalPath,
    dev: identity.dev,
    ino: identity.ino,
  };
}

function catalogFields(identity) {
  const canonicalPath = validIdentity(identity, 'catalog identity', { git: true });
  return {
    ...(identity.path === undefined ? {} : { path: identity.path }),
    canonicalPath,
    dev: identity.dev,
    ino: identity.ino,
    ...(identity.gitRemote === undefined ? {} : { gitRemote: identity.gitRemote }),
    ...(identity.gitCommit === undefined ? {} : { gitCommit: identity.gitCommit }),
  };
}

function targetKey(targetIdentity) {
  return manifestIdentity({ targetIdentity }).slice(0, 32);
}

function manifestPath(stateRoot, targetIdentity) {
  return path.join(stateRoot, `target-${targetKey(targetIdentity)}.json`);
}

function lockPath(stateRoot, targetIdentity) {
  return path.join(stateRoot, `target-${targetKey(targetIdentity)}.lock`);
}

function sameIdentity(actual, expected, fields) {
  return fields.every((field) => actual?.[field] === expected?.[field]);
}

function validateManifestIdentity(value, label, { git = false } = {}) {
  if (!isPlainObject(value)) throw stateError('MANIFEST_MALFORMED', `${label} must be an object`);
  try {
    const normalized = git ? catalogFields(value) : targetFields(value);
    const allowed = new Set(git ? ['path', 'canonicalPath', 'dev', 'ino', 'gitRemote', 'gitCommit'] : ['path', 'canonicalPath', 'dev', 'ino']);
    if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error('unknown field');
    if (value.path !== undefined && (typeof value.path !== 'string' || !path.isAbsolute(value.path))) throw new Error('invalid path');
    return normalized;
  } catch (error) {
    if (error.code === 'MANIFEST_MALFORMED') throw error;
    throw stateError('MANIFEST_MALFORMED', `${label} is invalid`, { cause: error });
  }
}

function validateSourceIdentity(value) {
  if (!isPlainObject(value)) throw stateError('MANIFEST_MALFORMED', 'manifest link sourceIdentity is invalid');
  try {
    validIdentity(value, 'source identity');
    if (Object.keys(value).some((key) => !['canonicalPath', 'dev', 'ino'].includes(key))) throw new Error('unknown field');
  } catch (error) {
    throw stateError('MANIFEST_MALFORMED', 'manifest link sourceIdentity is invalid', { cause: error });
  }
}

function validateManifest(value) {
  if (!isPlainObject(value) || value.version !== VERSION || !isPlainObject(value.target) || !isPlainObject(value.catalog) || !Array.isArray(value.links)) {
    throw stateError('MANIFEST_MALFORMED', 'manifest must contain version 1, target, catalog, and links');
  }
  validateManifestIdentity(value.target, 'manifest target');
  validateManifestIdentity(value.catalog, 'manifest catalog', { git: true });
  for (const link of value.links) {
    if (!isPlainObject(link) || Object.keys(link).some((key) => !['linkName', 'sourceRelative', 'relativeTarget', 'createdAt', 'sourceIdentity'].includes(key)) ||
      typeof link.linkName !== 'string' || typeof link.sourceRelative !== 'string' || typeof link.relativeTarget !== 'string' ||
      typeof link.createdAt !== 'string' || Number.isNaN(Date.parse(link.createdAt))) {
      throw stateError('MANIFEST_MALFORMED', 'manifest link entry is invalid');
    }
    validateSourceIdentity(link.sourceIdentity);
  }
  return value;
}

export function stateRootForTarget({ runtimeId, env = process.env, home = os.homedir() } = {}) {
  const homePath = path.resolve(home);
  if (runtimeId === 'dsh') {
    const dshHome = env?.DSH_HOME ? path.resolve(env.DSH_HOME) : path.join(homePath, '.dsh');
    return path.join(dshHome, '.manage-skills', 'targets');
  }
  const stateHome = env?.XDG_STATE_HOME ? path.resolve(env.XDG_STATE_HOME) : path.join(homePath, '.local', 'state');
  return path.join(stateHome, 'manage-skills');
}

export function manifestIdentity({ catalogIdentity, targetIdentity } = {}) {
  return digest({ catalog: catalogIdentity === undefined ? null : catalogFields(catalogIdentity), target: targetFields(targetIdentity) });
}

export async function loadManifest({ stateRoot, targetIdentity } = {}) {
  const file = manifestPath(path.resolve(stateRoot), targetIdentity);
  let raw;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') throw stateError('MANIFEST_MISSING', `Manifest not found: ${file}`, { path: file });
    if (error.code === 'ENOTDIR') throw stateError('STATE_UNAVAILABLE', `State root is not a directory: ${path.resolve(stateRoot)}`, { cause: error, path: file });
    throw stateError('STATE_UNAVAILABLE', `Unable to read state: ${error.message}`, { cause: error, path: file });
  }
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (error) {
    throw stateError('MANIFEST_MALFORMED', `Manifest is not valid JSON: ${file}`, { cause: error, path: file });
  }
  validateManifest(manifest);
  const expectedTarget = targetFields(targetIdentity);
  if (!sameIdentity(manifest.target, expectedTarget, ['canonicalPath', 'dev', 'ino']) || (expectedTarget.path !== undefined && manifest.target.path !== expectedTarget.path)) {
    throw stateError('MANIFEST_TARGET_MISMATCH', 'Manifest target identity does not match target', { path: file });
  }
  const expectedCatalog = targetIdentity?.catalogIdentity ?? targetIdentity?.catalog;
  if (expectedCatalog) {
    const catalog = catalogFields(expectedCatalog);
    if (!sameIdentity(manifest.catalog, catalog, ['canonicalPath', 'dev', 'ino', 'gitRemote', 'gitCommit']) || (catalog.path !== undefined && manifest.catalog.path !== catalog.path)) {
      throw stateError('MANIFEST_CATALOG_MISMATCH', 'Manifest catalog identity does not match catalog', { path: file });
    }
  }
  return manifest;
}

export async function writeManifestAtomic({ stateRoot, targetIdentity, manifest } = {}) {
  const root = path.resolve(stateRoot);
  const file = manifestPath(root, targetIdentity);
  validateManifest(manifest);
  const expectedTarget = targetFields(targetIdentity);
  if (!sameIdentity(manifest.target, expectedTarget, ['canonicalPath', 'dev', 'ino']) || (expectedTarget.path !== undefined && manifest.target.path !== expectedTarget.path)) {
    throw stateError('MANIFEST_TARGET_MISMATCH', 'Manifest target identity does not match target');
  }
  const expectedCatalog = targetIdentity?.catalogIdentity ?? targetIdentity?.catalog;
  if (expectedCatalog) {
    const catalog = catalogFields(expectedCatalog);
    if (!sameIdentity(manifest.catalog, catalog, ['canonicalPath', 'dev', 'ino', 'gitRemote', 'gitCommit']) || (catalog.path !== undefined && manifest.catalog.path !== catalog.path)) {
      throw stateError('MANIFEST_CATALOG_MISMATCH', 'Manifest catalog identity does not match catalog');
    }
  }
  try {
    await fs.mkdir(root, { recursive: true });
    const temporary = path.join(root, `.target-${targetKey(targetIdentity)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
    try {
      await fs.writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
      await fs.rename(temporary, file);
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => {});
    }
  } catch (error) {
    if (error.code === 'EEXIST' && error.path === root) throw stateError('STATE_UNAVAILABLE', `State root is not a directory: ${root}`, { cause: error });
    if (error.code === 'ENOTDIR' || error.code === 'EACCES' || error.code === 'EPERM') throw stateError('STATE_UNAVAILABLE', `Unable to write state: ${error.message}`, { cause: error });
    throw error;
  }
}

function metadataError(code, message, directory, metadata) {
  const details = { path: directory };
  if (metadata && typeof metadata.owner === 'string') details.owner = metadata.owner;
  if (metadata && typeof metadata.acquiredAt === 'string') details.acquiredAt = metadata.acquiredAt;
  return stateError(code, message, details);
}

async function readLockMetadata(directory) {
  let metadata;
  try {
    metadata = JSON.parse(await fs.readFile(path.join(directory, 'owner.json'), 'utf8'));
  } catch (error) {
    throw metadataError('LOCK_METADATA_INVALID', `Target lock metadata is missing or unreadable: ${directory}`, directory);
  }
  if (!isPlainObject(metadata) || typeof metadata.owner !== 'string' || !metadata.owner || typeof metadata.token !== 'string' || !metadata.token || typeof metadata.acquiredAt !== 'string' || Number.isNaN(Date.parse(metadata.acquiredAt))) {
    throw metadataError('LOCK_METADATA_INVALID', `Target lock metadata is invalid: ${directory}`, directory, metadata);
  }
  return metadata;
}

async function ensureDirectory(root, message) {
  try {
    await fs.mkdir(root, { recursive: true });
  } catch (error) {
    if (error.code === 'EEXIST' || error.code === 'ENOTDIR') throw stateError('STATE_UNAVAILABLE', `${message}: ${error.message}`, { cause: error });
    throw error;
  }
  try {
    if (!(await fs.stat(root)).isDirectory()) throw new Error('not a directory');
  } catch (error) {
    throw stateError('STATE_UNAVAILABLE', `${message}: ${error.message}`, { cause: error });
  }
}

export async function acquireTargetLock({ stateRoot, targetIdentity } = {}) {
  const root = path.resolve(stateRoot);
  const directory = lockPath(root, targetIdentity);
  const owner = `${os.hostname()}:${process.pid}:${crypto.randomUUID()}`;
  const token = crypto.randomUUID();
  const acquiredAt = new Date().toISOString();
  await ensureDirectory(root, 'Unable to acquire target lock');
  try {
    await fs.mkdir(directory);
    await fs.writeFile(path.join(directory, 'owner.json'), JSON.stringify({ owner, token, acquiredAt }) + '\n', { flag: 'wx' });
  } catch (error) {
    if (error.code === 'EEXIST') {
      const metadata = await readLockMetadata(directory);
      throw metadataError('TARGET_LOCKED', `Target lock is held by ${metadata.owner}`, directory, metadata);
    }
    if (error.code === 'ENOTDIR' || error.code === 'EACCES' || error.code === 'EPERM') throw stateError('STATE_UNAVAILABLE', `Unable to acquire target lock: ${error.message}`, { cause: error });
    throw error;
  }
  let released = false;
  return {
    path: directory,
    owner,
    token,
    acquiredAt,
    async release() {
      if (released) return;
      const metadata = await readLockMetadata(directory);
      if (metadata.token !== token) throw metadataError('TARGET_LOCKED', `Target lock is held by ${metadata.owner}`, directory, metadata);

      const quarantine = `${directory}.release-${process.pid}-${crypto.randomUUID()}`;
      await fs.rename(directory, quarantine);
      let quarantinedMetadata;
      try {
        quarantinedMetadata = await readLockMetadata(quarantine);
      } catch (error) {
        await fs.rename(quarantine, directory).catch(() => {});
        throw error;
      }
      if (quarantinedMetadata.token !== token) {
        let restored = false;
        try {
          await fs.rename(quarantine, directory);
          restored = true;
        } catch (error) {
          if (error.code !== 'EEXIST') throw error;
        }
        const ownershipError = metadataError('LOCK_OWNERSHIP_CHANGED', `Target lock ownership changed to ${quarantinedMetadata.owner}`, directory, quarantinedMetadata);
        ownershipError.quarantine = quarantine;
        ownershipError.restored = restored;
        throw ownershipError;
      }
      await fs.rm(quarantine, { recursive: true, force: false });
      released = true;
    },
  };
}

export { stateError };
