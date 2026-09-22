import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

function error(code, message, details = {}) {
  const result = new Error(message);
  result.code = code;
  Object.assign(result, details);
  return result;
}

function sameIdentity(a, b, fields = ['canonicalPath', 'dev', 'ino']) {
  return Boolean(a && b) && fields.every((field) => a[field] === b[field]);
}

function normalizeRelative(value) {
  return path.normalize(value).split(path.sep).join('/');
}

function inside(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function catalogIdentity(catalog) {
  if (catalog.identity) return catalog.identity;
  const root = await fs.realpath(catalog.root);
  const stat = await fs.stat(root);
  return { path: catalog.root, canonicalPath: root, dev: stat.dev, ino: stat.ino, ...(catalog.gitCommit ? { gitCommit: catalog.gitCommit } : {}) };
}

async function manifestForTarget({ targetIdentity, catalog, manifest }) {
  if (!manifest) return { usable: true, entries: [] };
  const expectedCatalog = await catalogIdentity(catalog);
  const targetMatches = sameIdentity(manifest.target, targetIdentity);
  const catalogMatches = sameIdentity(manifest.catalog, expectedCatalog, ['canonicalPath', 'dev', 'ino']);
  return { usable: targetMatches && catalogMatches, entries: targetMatches && catalogMatches ? manifest.links : [] };
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
  for (const skill of catalog.skills ?? []) {
    const sourceReal = await fs.realpath(skill.sourceDir).catch(() => null);
    if (!sourceReal) continue;
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
    try { realTarget = await fs.realpath(linkPath); } catch {}
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
