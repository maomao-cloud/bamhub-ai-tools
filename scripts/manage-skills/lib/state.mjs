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

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, stable(value[key])]));
  }
  return value;
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function targetFields(identity) {
  return {
    path: identity?.path,
    realPath: identity?.realPath,
    dev: identity?.dev,
    ino: identity?.ino,
  };
}

function catalogFields(identity) {
  return {
    path: identity?.path ?? identity?.canonicalPath,
    canonicalPath: identity?.canonicalPath,
    dev: identity?.dev,
    ino: identity?.ino,
    gitRemote: identity?.gitRemote,
    gitCommit: identity?.gitCommit,
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

function validateManifest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw stateError('MANIFEST_MALFORMED', 'manifest must be an object');
  if (value.version !== VERSION || !value.target || !value.catalog || !Array.isArray(value.links)) {
    throw stateError('MANIFEST_MALFORMED', 'manifest must contain version 1, target, catalog, and links');
  }
  for (const link of value.links) {
    if (!link || typeof link !== 'object' || typeof link.linkName !== 'string' || typeof link.sourceRelative !== 'string' || typeof link.relativeTarget !== 'string' || !link.sourceIdentity) {
      throw stateError('MANIFEST_MALFORMED', 'manifest link entry is invalid');
    }
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
  return digest({ catalog: catalogFields(catalogIdentity), target: targetFields(targetIdentity) });
}

export async function loadManifest({ stateRoot, targetIdentity } = {}) {
  const file = manifestPath(path.resolve(stateRoot), targetIdentity);
  let raw;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') throw stateError('MANIFEST_MISSING', `Manifest not found: ${file}`, { path: file });
    throw stateError('STATE_UNAVAILABLE', `Unable to read state: ${error.message}`, { cause: error });
  }
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (error) {
    throw stateError('MANIFEST_MALFORMED', `Manifest is not valid JSON: ${file}`, { cause: error, path: file });
  }
  validateManifest(manifest);
  if (!sameIdentity(manifest.target, targetIdentity, ['path', 'realPath', 'dev', 'ino'])) {
    throw stateError('MANIFEST_TARGET_MISMATCH', 'Manifest target identity does not match target', { path: file });
  }
  const expectedCatalog = targetIdentity?.catalogIdentity ?? targetIdentity?.catalog;
  if (expectedCatalog && !sameIdentity(manifest.catalog, catalogFields(expectedCatalog), ['path', 'canonicalPath', 'dev', 'ino', 'gitRemote', 'gitCommit'])) {
    throw stateError('MANIFEST_CATALOG_MISMATCH', 'Manifest catalog identity does not match catalog', { path: file });
  }
  return manifest;
}

export async function writeManifestAtomic({ stateRoot, targetIdentity, manifest } = {}) {
  const root = path.resolve(stateRoot);
  const file = manifestPath(root, targetIdentity);
  validateManifest(manifest);
  if (!sameIdentity(manifest.target, targetIdentity, ['path', 'realPath', 'dev', 'ino'])) {
    throw stateError('MANIFEST_TARGET_MISMATCH', 'Manifest target identity does not match target');
  }
  const expectedCatalog = targetIdentity?.catalogIdentity ?? targetIdentity?.catalog;
  if (expectedCatalog && !sameIdentity(manifest.catalog, catalogFields(expectedCatalog), ['path', 'canonicalPath', 'dev', 'ino', 'gitRemote', 'gitCommit'])) {
    throw stateError('MANIFEST_CATALOG_MISMATCH', 'Manifest catalog identity does not match catalog');
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

export async function acquireTargetLock({ stateRoot, targetIdentity } = {}) {
  const root = path.resolve(stateRoot);
  const directory = lockPath(root, targetIdentity);
  const owner = `${os.hostname()}:${process.pid}:${crypto.randomUUID()}`;
  const acquiredAt = new Date().toISOString();
  try {
    await fs.mkdir(root, { recursive: true });
    await fs.mkdir(directory);
    try {
      await fs.writeFile(path.join(directory, 'owner.json'), JSON.stringify({ owner, acquiredAt }) + '\n', { flag: 'wx' });
    } catch (error) {
      await fs.rm(directory, { recursive: true, force: true });
      throw error;
    }
  } catch (error) {
    if (error.code === 'EEXIST') {
      let metadata = {};
      try { metadata = JSON.parse(await fs.readFile(path.join(directory, 'owner.json'), 'utf8')); } catch { /* lock metadata may be unavailable */ }
      throw stateError('TARGET_LOCKED', `Target lock is held${metadata.owner ? ` by ${metadata.owner}` : ''}`, {
        path: directory,
        owner: metadata.owner,
        acquiredAt: metadata.acquiredAt,
      });
    }
    if (error.code === 'ENOTDIR' || error.code === 'EACCES' || error.code === 'EPERM') throw stateError('STATE_UNAVAILABLE', `Unable to acquire target lock: ${error.message}`, { cause: error });
    throw error;
  }
  let released = false;
  return {
    path: directory,
    owner,
    acquiredAt,
    async release() {
      if (released) return;
      released = true;
      await fs.rm(directory, { recursive: true, force: false });
    },
  };
}

export { stateError };
