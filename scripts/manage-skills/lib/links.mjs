import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

function error(code, message, details = {}) {
  const result = new Error(message);
  result.code = code;
  Object.assign(result, details);
  return result;
}

const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function sameIdentity(a, b, fields = ['path', 'canonicalPath', 'dev', 'ino']) {
  return Boolean(a && b) && fields.every((field) => a[field] === b[field]);
}

function identityPath(identity) {
  const value = identity?.path ?? identity?.realPath ?? identity?.canonicalPath;
  return typeof value === 'string' && path.isAbsolute(value) ? path.resolve(value) : null;
}

function normalizeIdentity(identity, { catalog = false } = {}) {
  if (!identity) return null;
  const result = { ...identity };
  const absolutePath = identityPath(identity);
  if (absolutePath) result.path = absolutePath;
  if (!result.canonicalPath && result.realPath) result.canonicalPath = result.realPath;
  if (catalog) {
    for (const field of ['gitRemote', 'gitCommit']) if (result[field] === undefined) delete result[field];
  }
  return result;
}

function normalizeRelative(value) {
  return path.normalize(value).split(path.sep).join('/');
}

function inside(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function catalogIdentity(catalog) {
  if (catalog.identity) return normalizeIdentity(catalog.identity, { catalog: true });
  const root = await fs.realpath(catalog.root);
  const stat = await fs.stat(root);
  return normalizeIdentity({ path: path.resolve(catalog.root), canonicalPath: root, dev: stat.dev, ino: stat.ino, ...(catalog.gitRemote ? { gitRemote: catalog.gitRemote } : {}), ...(catalog.gitCommit ? { gitCommit: catalog.gitCommit } : {}) }, { catalog: true });
}

async function manifestForTarget({ targetIdentity, catalog, manifest }) {
  if (!manifest) return { usable: true, entries: [] };
  const expectedCatalog = await catalogIdentity(catalog);
  const expectedTarget = normalizeIdentity(targetIdentity);
  const targetMatches = sameIdentity(normalizeIdentity(manifest.target), expectedTarget);
  const catalogMatches = sameIdentity(normalizeIdentity(manifest.catalog, { catalog: true }), expectedCatalog, ['path', 'canonicalPath', 'dev', 'ino', 'gitRemote', 'gitCommit']);
  return { usable: targetMatches && catalogMatches, entries: targetMatches && catalogMatches ? manifest.links : [] };
}

async function validateCatalogSkill(skill, catalogRoot) {
  if (!skill || typeof skill.sourceDir !== 'string' || typeof skill.skillFile !== 'string' || !skill.sourceIdentity) return false;
  const root = await fs.realpath(catalogRoot);
  try {
    const sourceReal = await fs.realpath(skill.sourceDir);
    const sourceStat = await fs.stat(sourceReal);
    const skillStat = await fs.lstat(skill.skillFile);
    const skillReal = await fs.realpath(skill.skillFile);
    return sourceStat.isDirectory() && skillStat.isFile() && !skillStat.isSymbolicLink() && inside(sourceReal, root) && inside(skillReal, sourceReal) && sameIdentity(skill.sourceIdentity, { canonicalPath: sourceReal, dev: sourceStat.dev, ino: sourceStat.ino }, ['canonicalPath', 'dev', 'ino']);
  } catch (cause) {
    if (cause.code === 'ENOENT' || cause.code === 'ENOTDIR') return false;
    throw cause;
  }
}

export async function validateCatalogSkills(catalog) {
  const valid = [];
  for (const skill of catalog?.skills ?? []) if (await validateCatalogSkill(skill, catalog.root)) valid.push(skill);
  return valid;
}

export async function scanTarget({ targetIdentity, catalog, manifest } = {}) {
  const targetRoot = path.resolve(targetIdentity?.path ?? targetIdentity?.canonicalPath ?? '');
  let targetStat;
  try {
    targetStat = await fs.lstat(targetRoot);
  } catch (cause) {
    if (cause.code === 'ENOENT' || cause.code === 'ENOTDIR') return [{ linkPath: targetRoot, kind: 'target-missing', reason: 'target does not exist' }];
    throw cause;
  }
  if (!targetStat.isDirectory()) return [{ linkPath: targetRoot, kind: 'target-missing', reason: 'target is not a directory' }];

  const catalogRoot = await fs.realpath(catalog.root);
  const validBySource = new Map();
  const validByRelative = new Map();
  for (const skill of await validateCatalogSkills(catalog)) {
    const sourceReal = await fs.realpath(skill.sourceDir);
    validBySource.set(sourceReal, skill);
    validByRelative.set(skill.relativeSource, skill);
  }
  const manifestState = await manifestForTarget({ targetIdentity, catalog, manifest });
  const entriesByName = new Map(manifestState.entries.map((entry) => [entry.linkName, entry]));
  const entries = [];
  for (const directoryEntry of await fs.readdir(targetRoot, { withFileTypes: true })) {
    const linkPath = path.join(targetRoot, directoryEntry.name);
    const stat = await fs.lstat(linkPath);
    if (!stat.isSymbolicLink()) {
      entries.push({ linkPath, kind: stat.isDirectory() ? 'regular-directory' : 'regular-file', identity: { dev: stat.dev, ino: stat.ino }, reason: 'not a symbolic link' });
      continue;
    }
    const linkTarget = await fs.readlink(linkPath);
    const lexicalTarget = path.resolve(targetRoot, linkTarget);
    const relativeTarget = normalizeRelative(path.relative(targetRoot, lexicalTarget));
    let realTarget = null;
    let realpathError;
    try {
      realTarget = await fs.realpath(linkPath);
    } catch (cause) {
      if (cause.code !== 'ENOENT' && cause.code !== 'ENOTDIR') realpathError = cause;
    }
    if (realpathError) {
      entries.push({ linkPath, kind: 'scan-error', linkTarget, reason: `unable to resolve symlink: ${realpathError.code ?? realpathError.message}`, errorCode: realpathError.code, identity: { dev: stat.dev, ino: stat.ino } });
      continue;
    }
    const skill = realTarget ? validBySource.get(realTarget) : undefined;
    const manifestEntry = entriesByName.get(directoryEntry.name);
    const manifestSkill = manifestEntry ? validByRelative.get(manifestEntry.sourceRelative) : undefined;
    const owned = manifestState.usable && manifestEntry && manifestSkill &&
      normalizeRelative(manifestEntry.relativeTarget) === relativeTarget &&
      sameIdentity(manifestSkill.sourceIdentity, manifestEntry.sourceIdentity) &&
      (!realTarget || realTarget === await fs.realpath(manifestSkill.sourceDir).catch(() => null));
    let kind;
    let reason;
    if (owned && realTarget && skill) kind = 'managed-valid';
    else if (owned && !realTarget) kind = 'managed-broken';
    else if (realTarget && inside(realTarget, catalogRoot)) {
      kind = 'unmanaged-symlink';
      reason = manifestState.usable ? 'link is not manifest-owned' : 'manifest identity mismatch';
    } else {
      kind = 'foreign-symlink';
      reason = realTarget ? 'link target is outside catalog' : 'link target is unavailable';
    }
    entries.push({ linkPath, kind, linkTarget, ...(realTarget ? { realTarget } : {}), ...(manifestEntry ? { manifestEntry } : {}), ...(reason ? { reason } : {}), identity: { dev: stat.dev, ino: stat.ino } });
  }
  return entries.sort((a, b) => a.linkPath.localeCompare(b.linkPath));
}

export function linkFingerprint(value) {
  const stable = (item) => {
    if (Array.isArray(item)) return item.map(stable);
    if (item && typeof item === 'object') return Object.fromEntries(Object.keys(item).sort().map((key) => [key, stable(item[key])]));
    return item;
  };
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

export { error, sameIdentity, normalizeRelative };
