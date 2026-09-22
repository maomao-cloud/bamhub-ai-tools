import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { scanTarget, normalizeRelative, targetPath, linkFingerprint } from './links.mjs';
import { acquireTargetLock, loadManifest, manifestIdentity, writeManifestAtomic } from './state.mjs';

const JOURNAL_VERSION = 1;
const JOURNAL_STATES = new Set(['prepared', 'mutating', 'manifest-written', 'verifying', 'committed', 'failed']);

function transactionError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

const SAFE_FAILURE_FIELDS = new Set([
  'mismatches', 'path', 'identity', 'recoveryError', 'lockDiagnostics', 'diagnostics', 'conflicts',
  'stateRoot', 'journalPath', 'owner', 'acquiredAt',
]);
const SECRET_FIELD = /(?:secret|token|password|credential|authorization|cookie|cause|stack)/i;

function safeDetail(value, depth = 0) {
  if (depth > 6 || value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) return value.map((item) => safeDetail(item, depth + 1)).filter((item) => item !== undefined);
  if (typeof value !== 'object') return undefined;
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_FIELD.test(key)) continue;
    const safe = safeDetail(item, depth + 1);
    if (safe !== undefined) output[key] = safe;
  }
  return output;
}

function failure(error) {
  const result = { code: error?.code ?? 'TRANSACTION_FAILED', message: error?.message ?? String(error) };
  for (const field of SAFE_FAILURE_FIELDS) {
    if (!(field in (error ?? {}))) continue;
    const safe = safeDetail(error[field]);
    if (safe !== undefined) result[field] = safe;
  }
  return result;
}

function stateRootFor(plan, state) {
  const root = state?.stateRoot ?? plan.target?.stateRoot;
  if (typeof root !== 'string' || !root) throw transactionError('STATE_ROOT_REQUIRED', 'stateRoot is required for apply');
  return path.resolve(root);
}

function manifestTarget(identity) {
  return { ...(identity.path === undefined ? {} : { path: identity.path }), canonicalPath: identity.canonicalPath ?? identity.realPath, dev: identity.dev, ino: identity.ino, ...(identity.missing === undefined ? {} : { missing: identity.missing }) };
}

function manifestCatalog(identity) {
  return { ...(identity.path === undefined ? {} : { path: identity.path }), canonicalPath: identity.canonicalPath ?? identity.realPath, dev: identity.dev, ino: identity.ino, ...(identity.gitRemote === undefined ? {} : { gitRemote: identity.gitRemote }), ...(identity.gitCommit === undefined ? {} : { gitCommit: identity.gitCommit }) };
}

async function currentManifest(plan, state) {
  try {
    return await loadManifest({ stateRoot: stateRootFor(plan, state), targetIdentity: { ...plan.target, catalogIdentity: plan.catalog } });
  } catch (error) {
    if (error.code !== 'MANIFEST_MISSING') throw error;
    return null;
  }
}

function journalName(stateRoot) {
  return path.join(path.resolve(stateRoot), `transaction-${process.pid}-${crypto.randomUUID()}.json`);
}

async function writeJournal(file, journal) {
  const temporary = `${file}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(journal, null, 2)}\n`, { flag: 'w' });
  await fs.rename(temporary, file);
}

async function identityAt(directory, label) {
  const canonicalPath = await fs.realpath(directory);
  const stat = await fs.stat(canonicalPath);
  if (!stat.isDirectory()) throw transactionError(`${label.toUpperCase()}_IDENTITY_CHANGED`, `${label} is not a directory`);
  return { canonicalPath, dev: stat.dev, ino: stat.ino };
}

function sameIdentityFields(actual, expected, fields) {
  return fields.every((field) => actual?.[field] === expected?.[field]);
}

async function checkTargetSnapshot(plan, snapshot) {
  const target = targetPath(plan.target);
  if (snapshot.missing === true && snapshot.created !== true) {
    const current = await lstatOrNull(target);
    if (current) throw transactionError('TARGET_IDENTITY_CHANGED', 'missing target appeared before creation');
    if (snapshot.parentIdentity) {
      const parent = await identityAt(path.dirname(target), 'target parent');
      if (!sameIdentityFields(parent, snapshot.parentIdentity, ['canonicalPath', 'dev', 'ino'])) throw transactionError('TARGET_IDENTITY_CHANGED', 'target parent identity changed');
    }
    return;
  }
  const actual = await identityAt(target, 'target');
  if (!sameIdentityFields(actual, snapshot, ['canonicalPath', 'dev', 'ino'])) throw transactionError('TARGET_IDENTITY_CHANGED', 'target identity changed');
  if (snapshot.created !== true && !sameIdentityFields(plan.target, snapshot, ['path', 'canonicalPath', 'dev', 'ino'])) {
    throw transactionError('TARGET_IDENTITY_CHANGED', 'target identity changed');
  }
}

async function checkCatalogSnapshot(plan, snapshot) {
  const actual = await identityAt(plan.catalog.canonicalPath ?? plan.catalog.path, 'catalog');
  if (!sameIdentityFields(actual, snapshot, ['canonicalPath', 'dev', 'ino']) || !sameIdentityFields(plan.catalog, snapshot, ['path', 'canonicalPath', 'dev', 'ino', 'gitRemote', 'gitCommit'])) {
    throw transactionError('CATALOG_IDENTITY_CHANGED', 'catalog identity changed');
  }
}

async function sourceIdentity(item, snapshot) {
  const actualPath = await fs.realpath(item.sourceDir);
  const stat = await fs.stat(actualPath);
  const skillStat = await fs.lstat(path.join(actualPath, 'SKILL.md'));
  if (!stat.isDirectory() || !skillStat.isFile() || skillStat.isSymbolicLink() || !sameIdentityFields({ canonicalPath: actualPath, dev: stat.dev, ino: stat.ino }, snapshot, ['canonicalPath', 'dev', 'ino']) || !sameIdentityFields(item.sourceIdentity, snapshot, ['canonicalPath', 'dev', 'ino'])) {
    throw transactionError('SOURCE_IDENTITY_CHANGED', 'source identity changed or source is invalid');
  }
}

async function lstatOrNull(file) {
  return fs.lstat(file).catch((error) => {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  });
}

async function checkLink(item, snapshot, kind) {
  const current = await lstatOrNull(item.linkPath);
  if (kind === 'create') {
    if (snapshot?.created === true) {
      if (!current || !current.isSymbolicLink()) throw transactionError('TARGET_PATH_CHANGED', `created link changed: ${item.linkPath}`, { identity: current ? { dev: current.dev, ino: current.ino, type: current.isDirectory() ? 'directory' : 'file' } : { type: 'missing' } });
      const linkText = await fs.readlink(item.linkPath);
      if (!sameIdentityFields(current, snapshot, ['dev', 'ino']) || snapshot.type !== 'symlink' || snapshot.linkText !== linkText) {
        throw transactionError('TARGET_PATH_CHANGED', `created link identity changed: ${item.linkPath}`, { identity: { dev: current.dev, ino: current.ino, type: 'symlink', linkText } });
      }
      return;
    }
    if (!current) return;
    if (current.isSymbolicLink()) {
      const linkText = await fs.readlink(item.linkPath);
      if (normalizeRelative(linkText) === normalizeRelative(item.relativeTarget)) return;
    }
    throw transactionError('TARGET_PATH_CHANGED', `target link path is occupied: ${item.linkPath}`, { identity: { dev: current.dev, ino: current.ino, type: current.isSymbolicLink() ? 'symlink' : current.isDirectory() ? 'directory' : 'file' } });
  }
  if (snapshot?.type === 'quarantined' && !current) return;
  if (!current || !current.isSymbolicLink()) throw transactionError('TARGET_PATH_CHANGED', `removal path is no longer a symlink: ${item.linkPath}`);
  const linkText = await fs.readlink(item.linkPath);
  if (snapshot && (!sameIdentityFields(current, snapshot, ['dev', 'ino']) || snapshot.type !== 'symlink' || snapshot.linkText !== linkText)) throw transactionError('TARGET_PATH_CHANGED', `removal link identity changed: ${item.linkPath}`);
  if (normalizeRelative(linkText) !== normalizeRelative(item.relativeTarget)) throw transactionError('TARGET_PATH_CHANGED', `removal link target changed: ${item.linkPath}`);
  return { dev: current.dev, ino: current.ino, type: 'symlink', linkText };
}

function manifestForPlan(plan, targetIdentity = plan.target) {
  const links = plan.desired.map((item) => ({
    linkName: item.linkName,
    sourceRelative: item.sourceRelative,
    relativeTarget: item.relativeTarget ?? normalizeRelative(path.relative(targetPath(plan.target), item.sourceDir)),
    sourceIdentity: { canonicalPath: item.sourceIdentity.canonicalPath, dev: item.sourceIdentity.dev, ino: item.sourceIdentity.ino },
    createdAt: new Date().toISOString(),
  }));
  return { version: 1, target: manifestTarget(targetIdentity), catalog: manifestCatalog(plan.catalog), links };
}

function planFingerprint(plan) {
  return linkFingerprint({ target: plan.target, catalog: plan.catalog, desired: plan.desired, create: plan.create, remove: plan.remove, keep: plan.keep, conflicts: plan.conflicts, protected: plan.protected });
}

function manifestFingerprint(manifest) {
  return linkFingerprint(manifest ?? null);
}

function manifestOwns(manifest, item) {
  const entry = manifest?.links?.find((candidate) => candidate.linkName === item.linkName || candidate.linkName === path.basename(item.linkPath));
  if (!entry || !item.manifestEntry) return false;
  return linkFingerprint(entry) === linkFingerprint(item.manifestEntry);
}

async function recheckPlan(plan, snapshots, manifest) {
  if (planFingerprint(plan) !== snapshots.planFingerprint) throw transactionError('PLAN_CHANGED', 'transaction plan changed');
  if (manifestFingerprint(manifest) !== snapshots.manifestFingerprint) throw transactionError('MANIFEST_CHANGED', 'manifest changed during transaction');
  await checkTargetSnapshot(plan, snapshots.target);
  await checkCatalogSnapshot(plan, snapshots.catalog);
  for (const item of plan.desired) await sourceIdentity(item, snapshots.sources.get(item.sourceDir));
  for (const item of plan.create) await checkLink(item, snapshots.links.get(item.linkPath), 'create');
  for (const item of plan.remove) {
    await checkLink(item, snapshots.links.get(item.linkPath), 'remove');
    if (!manifestOwns(manifest, item)) throw transactionError('MANIFEST_OWNERSHIP_CHANGED', `manifest ownership changed: ${item.linkPath}`);
    const source = item.manifestEntry?.sourceIdentity;
    if (source) await sourceIdentity({ sourceDir: source.canonicalPath, sourceIdentity: source }, source);
  }
}

export async function verifyPlan(plan, { manifest } = {}) {
  const mismatches = [];
  let states;
  try {
    const verificationTarget = plan.target.missing === true && manifest?.target ? { ...plan.target, ...manifest.target, path: targetPath(plan.target), missing: false } : plan.target;
    states = await scanTarget({ targetIdentity: verificationTarget, catalog: { root: plan.catalog.canonicalPath, identity: plan.catalog, skills: plan.desired.map((item) => ({ ...item, relativeSource: item.sourceRelative, skillFile: path.join(item.sourceDir, 'SKILL.md') })) }, manifest });
  } catch (error) {
    return { ok: false, mismatches: [{ code: error.code ?? 'VERIFY_FAILED', message: error.message }] };
  }
  const byPath = new Map(states.map((item) => [item.linkPath, item]));
  for (const item of plan.desired) {
    const linkPath = path.join(targetPath(plan.target), item.linkName);
    const state = byPath.get(linkPath);
    if (!state || state.kind !== 'managed-valid') mismatches.push({ path: linkPath, reason: 'desired link is not manifest-owned managed-valid' });
    else if (state.realTarget !== await fs.realpath(item.sourceDir).catch(() => null)) mismatches.push({ path: linkPath, reason: 'wrong link target' });
  }
  for (const item of plan.remove) if (await lstatOrNull(item.linkPath)) mismatches.push({ path: item.linkPath, reason: 'removed link remains' });
  return { ok: mismatches.length === 0, mismatches };
}

function journalManifestTarget(journal) {
  if (journal.manifest?.target) return journal.manifest.target;
  const targetCreate = [...(journal.operations ?? [])].reverse().find((operation) => operation.type === 'target-create' && operation.status === 'done' && operation.identity);
  return targetCreate?.identity ?? journal.target;
}

async function restoreOldManifest(stateRoot, plan, oldManifest, targetIdentity) {
  const effectiveTarget = targetIdentity ?? journalManifestTarget(plan);
  const file = path.join(path.resolve(stateRoot), `target-${manifestIdentity({ targetIdentity: effectiveTarget, catalogIdentity: plan.catalog }).slice(0, 32)}.json`);
  if (oldManifest) await writeManifestAtomic({ stateRoot, targetIdentity: { ...effectiveTarget, catalogIdentity: plan.catalog }, manifest: oldManifest });
  else await fs.rm(file, { force: true });
}

async function applyPlan(plan, { state, dryRun, beforeMutation, beforeManifest, beforeVerify }) {
  const result = { target: plan.target, applied: [], skipped: [], failed: [], journal: null, verified: false };
  if (dryRun) {
    result.skipped = [...plan.create, ...plan.remove, ...plan.keep, ...plan.conflicts, ...plan.protected];
    return result;
  }
  let stateRoot;
  let journal;
  let record;
  let oldManifest;
  let quarantineCreated = false;
  let manifestTargetIdentity = plan.target;
  let mutationCount = 0;
  const failPoint = () => {
    if (Number.isInteger(state.failAfter) && mutationCount >= state.failAfter) throw transactionError('INJECTED_FAILURE', 'injected transaction failure');
  };
  try {
    stateRoot = stateRootFor(plan, state);
    journal = journalName(stateRoot);
    result.journal = journal;
    oldManifest = await currentManifest(plan, state);
    const quarantineToken = crypto.randomUUID();
    const quarantine = path.join(path.dirname(targetPath(plan.target)), `.manage-skills-quarantine-${quarantineToken}`);
    const quarantineMarker = path.join(quarantine, '.manage-skills-quarantine-marker');
    await fs.mkdir(quarantine, { recursive: false });
    await fs.writeFile(quarantineMarker, quarantineToken, { flag: 'wx' });
    quarantineCreated = true;
    record = { version: JOURNAL_VERSION, state: 'prepared', target: manifestTarget(plan.target), catalog: plan.catalog, planFingerprint: planFingerprint(plan), oldManifest: oldManifest ?? null, operations: [], quarantine, quarantineToken, quarantineCreated: true };
    await fs.mkdir(stateRoot, { recursive: true });
    await writeJournal(journal, record);
    const snapshots = { target: { ...plan.target, ...(plan.target.parentIdentity ? { parentIdentity: { ...plan.target.parentIdentity } } : {}) }, catalog: { ...plan.catalog }, planFingerprint: planFingerprint(plan), manifestFingerprint: manifestFingerprint(oldManifest), sources: new Map(), links: new Map() };
    for (const item of plan.desired) snapshots.sources.set(item.sourceDir, { ...item.sourceIdentity });
    for (const item of plan.remove) {
      const current = await lstatOrNull(item.linkPath);
      if (current) snapshots.links.set(item.linkPath, { dev: current.dev, ino: current.ino, type: current.isSymbolicLink() ? 'symlink' : current.isDirectory() ? 'directory' : 'file', ...(current.isSymbolicLink() ? { linkText: await fs.readlink(item.linkPath) } : {}) });
    }
    if (beforeMutation) await beforeMutation(plan);
    await recheckPlan(plan, snapshots, oldManifest);
    record.state = 'mutating';
    await writeJournal(journal, record);
    if (plan.target.missing === true) {
      const targetCreate = { type: 'target-create', targetPath: targetPath(plan.target), status: 'pending' };
      record.operations.push(targetCreate);
      await writeJournal(journal, record);
      await fs.mkdir(targetCreate.targetPath);
      const createdTarget = { path: targetCreate.targetPath, ...(await identityAt(targetCreate.targetPath, 'target')), missing: false };
      targetCreate.identity = createdTarget;
      targetCreate.status = 'done';
      manifestTargetIdentity = createdTarget;
      snapshots.target = { ...createdTarget, created: true };
      await writeJournal(journal, record);
      mutationCount += 1;
      result.applied.push(targetCreate.targetPath);
      failPoint();
    }
    for (const item of plan.create) {
      await recheckPlan(plan, snapshots, await currentManifest(plan, state));
      const operation = { type: 'create', linkPath: item.linkPath, sourceDir: item.sourceDir, status: 'pending' };
      record.operations.push(operation);
      await writeJournal(journal, record);
      await fs.symlink(item.relativeTarget, item.linkPath, 'dir');
      const createdLink = await fs.lstat(item.linkPath);
      const createdLinkText = await fs.readlink(item.linkPath);
      snapshots.links.set(item.linkPath, { created: true, dev: createdLink.dev, ino: createdLink.ino, type: 'symlink', linkText: createdLinkText });
      operation.status = 'done';
      result.applied.push(item.linkPath);
      mutationCount += 1;
      await writeJournal(journal, record);
      failPoint();
    }
    for (const item of plan.remove) {
      await recheckPlan(plan, snapshots, await currentManifest(plan, state));
      if (!quarantineCreated) quarantineCreated = true;
      const destination = path.join(quarantine, path.basename(item.linkPath));
      const operation = { type: 'quarantine', original: item.linkPath, quarantine: destination, status: 'pending' };
      record.operations.push(operation);
      await writeJournal(journal, record);
      await fs.rename(item.linkPath, destination);
      snapshots.links.set(item.linkPath, { type: 'quarantined' });
      operation.status = 'done';
      result.applied.push(item.linkPath);
      mutationCount += 1;
      await writeJournal(journal, record);
      failPoint();
    }
    const nextManifest = manifestForPlan(plan, manifestTargetIdentity);
    if (beforeManifest) await beforeManifest(plan, nextManifest);
    const currentBeforeWrite = await currentManifest(plan, state);
    await recheckPlan(plan, snapshots, currentBeforeWrite);
    record.manifest = nextManifest;
    await writeManifestAtomic({ stateRoot, targetIdentity: { ...manifestTargetIdentity, catalogIdentity: plan.catalog }, manifest: nextManifest });
    record.state = 'manifest-written';
    await writeJournal(journal, record);
    if (beforeVerify) await beforeVerify(plan, nextManifest);
    record.state = 'verifying';
    await writeJournal(journal, record);
    const verification = await verifyPlan(plan, { manifest: nextManifest });
    if (!verification.ok) throw transactionError('POST_VERIFY_FAILED', 'post-apply verification failed', { mismatches: verification.mismatches });
    record.state = 'committed';
    await writeJournal(journal, record);
    result.verified = true;
    if (quarantineCreated && await lstatOrNull(record.quarantine)) {
      await validateQuarantineOwnership(record);
      await fs.rm(record.quarantine, { recursive: true, force: true });
    }
    await fs.rm(journal, { force: true });
    return result;
  } catch (error) {
    result.failed.push(failure(error));
    if (record) {
      record.state = 'failed';
      record.error = failure(error);
      try {
        if (record.manifest && record.state !== 'committed') await restoreOldManifest(stateRoot, plan, oldManifest, manifestTargetIdentity);
      } catch (restoreError) {
        record.recoveryError = failure(restoreError);
      }
      await writeJournal(journal, record).catch(() => {});
    }
    return result;
  }
}

function targetResult(plan) {
  return { target: plan.target, applied: [], skipped: [], failed: [], journal: null, verified: false };
}

export async function applyPlanSet(planSet, { state = {}, dryRun = false, beforeMutation, beforeManifest, beforeVerify } = {}) {
  const plans = planSet?.plans ?? [];
  if (dryRun) return { targets: await Promise.all(plans.map((plan) => applyPlan(plan, { state, dryRun: true }))), exitCode: 0 };
  const handles = [];
  const lockErrors = new Map();
  for (let index = 0; index < plans.length; index += 1) {
    try {
      handles[index] = await acquireTargetLock({ stateRoot: stateRootFor(plans[index], state), targetIdentity: { ...plans[index].target, catalogIdentity: plans[index].catalog } });
    } catch (error) {
      lockErrors.set(index, error);
    }
  }
  if (lockErrors.size) {
    await Promise.all(handles.filter(Boolean).map((handle) => handle.release().catch(() => {})));
    const targets = plans.map((plan, index) => {
      const result = targetResult(plan);
      if (lockErrors.has(index)) result.failed.push(failure(lockErrors.get(index)));
      else result.skipped.push({ reason: 'lock acquisition failed before mutation' });
      return result;
    });
    return { targets, exitCode: 1 };
  }
  const targets = [];
  try {
    for (const plan of plans) targets.push(await applyPlan(plan, { state, dryRun, beforeMutation, beforeManifest, beforeVerify }));
  } finally {
    await Promise.all(handles.map((handle) => handle.release().catch(() => {})));
  }
  return { targets, exitCode: targets.some((target) => target.failed.length || !target.verified) ? 1 : 0 };
}

function journalError(message, details = {}) {
  return transactionError('JOURNAL_MALFORMED', message, details);
}

function inside(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function absolutePath(value, label) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw journalError(`${label} must be absolute`);
  return path.resolve(value);
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function onlyFields(value, allowed, label) {
  if (!plainObject(value) || Object.keys(value).some((key) => !allowed.has(key))) throw journalError(`${label} contains unknown or invalid fields`);
}

function validateJournalIdentity(identity, label, git = false) {
  const allowed = new Set(git ? ['path', 'canonicalPath', 'dev', 'ino', 'gitRemote', 'gitCommit'] : ['path', 'canonicalPath', 'dev', 'ino', 'missing']);
  onlyFields(identity, allowed, label);
  if (typeof identity.canonicalPath !== 'string' || !path.isAbsolute(identity.canonicalPath) || (identity.missing === true ? identity.dev !== null || identity.ino !== null : !Number.isSafeInteger(identity.dev) || identity.dev < 0 || !Number.isSafeInteger(identity.ino) || identity.ino < 0)) throw journalError(`${label} is incomplete`);
  if ('path' in identity && (typeof identity.path !== 'string' || !path.isAbsolute(identity.path))) throw journalError(`${label}.path is invalid`);
  for (const field of git ? ['gitRemote', 'gitCommit'] : []) if (field in identity && typeof identity[field] !== 'string') throw journalError(`${label}.${field} is invalid`);
}

function validateJournalManifest(manifest, label) {
  if (manifest === null) return;
  if (!plainObject(manifest) || manifest.version !== 1 || !plainObject(manifest.target) || !plainObject(manifest.catalog) || !Array.isArray(manifest.links)) throw journalError(`${label} schema is invalid`);
  onlyFields(manifest, new Set(['version', 'target', 'catalog', 'links']), label);
  validateJournalIdentity(manifest.target, `${label}.target`);
  validateJournalIdentity(manifest.catalog, `${label}.catalog`, true);
  for (const link of manifest.links) {
    if (!plainObject(link)) throw journalError(`${label}.links entry is invalid`);
    onlyFields(link, new Set(['linkName', 'sourceRelative', 'relativeTarget', 'sourceIdentity', 'createdAt']), `${label}.links entry`);
    if (typeof link.linkName !== 'string' || typeof link.sourceRelative !== 'string' || typeof link.relativeTarget !== 'string' || typeof link.createdAt !== 'string' || Number.isNaN(Date.parse(link.createdAt))) throw journalError(`${label}.links entry is invalid`);
    validateJournalIdentity(link.sourceIdentity, `${label}.links.sourceIdentity`);
  }
}

async function validateQuarantineOwnership(journal) {
  if (journal.quarantineCreated !== true) return;
  const root = await fs.lstat(journal.quarantine).catch((error) => {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  });
  if (!root || !root.isDirectory() || root.isSymbolicLink()) throw journalError('quarantine root is missing or invalid');
  const markerPath = path.join(journal.quarantine, '.manage-skills-quarantine-marker');
  const marker = await fs.lstat(markerPath).catch((error) => {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  });
  if (!marker || !marker.isFile() || marker.isSymbolicLink()) throw journalError('quarantine marker is missing or invalid');
  if (await fs.readFile(markerPath, 'utf8') !== journal.quarantineToken) throw journalError('quarantine marker does not match token');
}

function validateJournal(journal, stateRoot, journalPath) {
  if (!plainObject(journal) || journal.version !== JOURNAL_VERSION || !JOURNAL_STATES.has(journal.state) || journal.state === 'committed' || !Array.isArray(journal.operations)) throw journalError('journal schema or state is invalid');
  onlyFields(journal, new Set(['version', 'state', 'target', 'catalog', 'planFingerprint', 'oldManifest', 'operations', 'quarantine', 'quarantineToken', 'quarantineCreated', 'manifest', 'error', 'recoveryError']), 'journal');
  if (typeof journal.planFingerprint !== 'string' || !journal.planFingerprint) throw journalError('journal planFingerprint is invalid');
  if (typeof journal.quarantineToken !== 'string' || !journal.quarantineToken || !/^[0-9a-f-]{36}$/i.test(journal.quarantineToken) || typeof journal.quarantineCreated !== 'boolean') throw journalError('journal quarantine ownership is invalid');
  if (!('oldManifest' in journal)) throw journalError('journal oldManifest is required');
  validateJournalManifest(journal.oldManifest, 'journal.oldManifest');
  if ('manifest' in journal) validateJournalManifest(journal.manifest, 'journal.manifest');
  validateJournalIdentity(journal.target, 'journal.target');
  validateJournalIdentity(journal.catalog, 'journal.catalog', true);
  const root = path.resolve(stateRoot);
  const file = absolutePath(journalPath, 'journal path');
  const targetRoot = absolutePath(journal.target.path ?? journal.target.canonicalPath, 'target path');
  const catalogRoot = absolutePath(journal.catalog.path ?? journal.catalog.canonicalPath, 'catalog path');
  const quarantineRoot = absolutePath(journal.quarantine, 'journal quarantine');
  if (!inside(file, root)) throw journalError('journal path is outside state root');
  if (!inside(quarantineRoot, path.dirname(targetRoot)) || quarantineRoot === targetRoot) throw journalError('journal quarantine is outside target boundary');
  if (path.basename(quarantineRoot) !== `.manage-skills-quarantine-${journal.quarantineToken}`) throw journalError('journal quarantine ownership is inconsistent');
  if (journal.quarantineCreated !== true && journal.operations.some((operation) => operation.type === 'quarantine')) throw journalError('journal quarantine operation lacks created quarantine');
  for (const operation of journal.operations) {
    if (!plainObject(operation) || !['target-create', 'create', 'quarantine'].includes(operation.type) || !['pending', 'done'].includes(operation.status)) throw journalError('journal operation is invalid');
    if (operation.type === 'target-create') {
      onlyFields(operation, new Set(['type', 'targetPath', 'identity', 'status']), 'target-create operation');
      if (typeof operation.targetPath !== 'string') throw journalError('target-create operation is invalid');
      const createdTarget = absolutePath(operation.targetPath, 'target-create targetPath');
      if (createdTarget !== targetRoot) throw journalError('target-create path does not match target');
      if (operation.status === 'done') validateJournalIdentity(operation.identity, 'target-create identity');
    }
    if (operation.type === 'create') {
      onlyFields(operation, new Set(['type', 'linkPath', 'sourceDir', 'status']), 'create operation');
      if (typeof operation.linkPath !== 'string' || typeof operation.sourceDir !== 'string') throw journalError('create operation is invalid');
      const linkPath = absolutePath(operation.linkPath, 'create linkPath');
      const sourceDir = absolutePath(operation.sourceDir, 'create sourceDir');
      if (!inside(linkPath, targetRoot) || !inside(sourceDir, catalogRoot)) throw journalError('create operation path is outside its boundary');
    }
    if (operation.type === 'quarantine') {
      onlyFields(operation, new Set(['type', 'original', 'quarantine', 'status']), 'remove operation');
      if (typeof operation.original !== 'string' || typeof operation.quarantine !== 'string') throw journalError('remove operation is invalid');
      const original = absolutePath(operation.original, 'remove original');
      const operationQuarantine = absolutePath(operation.quarantine, 'remove quarantine');
      if (!inside(original, targetRoot) || !inside(operationQuarantine, quarantineRoot)) throw journalError('remove operation path is outside its boundary');
    }
  }
  return journal;
}

export async function recoverJournal({ stateRoot, journalPath }) {
  const root = path.resolve(stateRoot);
  const file = path.resolve(journalPath);
  let journal;
  try {
    journal = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    throw journalError('journal is not valid JSON', { cause: error });
  }
  validateJournal(journal, root, file);
  if (journal.quarantineCreated === true && journal.operations.some((operation) => operation.type === 'quarantine' && operation.status === 'done')) await validateQuarantineOwnership(journal);
  const restored = [];
  const rolledBack = [];
  const conflicts = [];
  try {
    for (const operation of [...journal.operations].reverse()) {
      if (operation.status !== 'done') continue;
      if (operation.type === 'quarantine') {
        const quarantine = await lstatOrNull(operation.quarantine);
        if (!quarantine) continue;
        const original = await lstatOrNull(operation.original);
        if (original) {
          conflicts.push({ original: operation.original, quarantine: operation.quarantine, reason: 'original path is occupied' });
          continue;
        }
        await fs.rename(operation.quarantine, operation.original);
        restored.push(operation.original);
      } else if (operation.type === 'target-create') {
        const current = await lstatOrNull(operation.targetPath);
        if (!current) continue;
        if (!current.isDirectory() || current.isSymbolicLink()) {
          conflicts.push({ targetPath: operation.targetPath, reason: 'created target changed' });
          continue;
        }
        const stat = await fs.stat(operation.targetPath);
        const entries = await fs.readdir(operation.targetPath);
        if (entries.length !== 0 || !sameIdentityFields(stat, operation.identity, ['dev', 'ino'])) {
          conflicts.push({ targetPath: operation.targetPath, reason: entries.length ? 'created target is not empty' : 'created target identity changed' });
          continue;
        }
        await fs.rmdir(operation.targetPath);
        rolledBack.push(operation.targetPath);
      } else {
        const current = await lstatOrNull(operation.linkPath);
        const source = await fs.realpath(operation.sourceDir).catch(() => null);
        const target = current?.isSymbolicLink() ? await fs.realpath(operation.linkPath).catch(() => null) : null;
        if (current?.isSymbolicLink() && source && target === source) {
          await fs.unlink(operation.linkPath);
          rolledBack.push(operation.linkPath);
        } else if (current) conflicts.push({ linkPath: operation.linkPath, reason: 'created path changed' });
      }
    }
    if (conflicts.length) return { recovered: false, restored, rolledBack, conflicts, stateRoot: root, journalPath: file };
    if (journal.oldManifest !== undefined) await restoreOldManifest(root, journal, journal.oldManifest);
    if (journal.quarantineCreated === true && await lstatOrNull(journal.quarantine)) {
      await validateQuarantineOwnership(journal);
      await fs.rm(journal.quarantine, { recursive: true, force: true });
    }
    await fs.rm(file, { force: true });
    return { recovered: true, restored, rolledBack, conflicts, stateRoot: root, journalPath: file };
  } catch (error) {
    return { recovered: false, restored, rolledBack, conflicts, error: failure(error), stateRoot: root, journalPath: file };
  }
}

export { JOURNAL_STATES };
