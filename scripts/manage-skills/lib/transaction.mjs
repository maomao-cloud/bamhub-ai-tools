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

function failure(error) {
  return { code: error?.code ?? 'TRANSACTION_FAILED', message: error?.message ?? String(error) };
}

function stateRootFor(plan, state) {
  const root = state?.stateRoot ?? plan.target?.stateRoot;
  if (typeof root !== 'string' || !root) throw transactionError('STATE_ROOT_REQUIRED', 'stateRoot is required for apply');
  return path.resolve(root);
}

function manifestTarget(identity) {
  return { ...(identity.path === undefined ? {} : { path: identity.path }), canonicalPath: identity.canonicalPath ?? identity.realPath, dev: identity.dev, ino: identity.ino };
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
  const actual = await identityAt(targetPath(plan.target), 'target');
  if (!sameIdentityFields(actual, snapshot, ['canonicalPath', 'dev', 'ino']) || !sameIdentityFields(plan.target, snapshot, ['path', 'canonicalPath', 'dev', 'ino'])) {
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
    if (current) throw transactionError('TARGET_PATH_CHANGED', `target link path is occupied: ${item.linkPath}`, { identity: { dev: current.dev, ino: current.ino, type: current.isSymbolicLink() ? 'symlink' : current.isDirectory() ? 'directory' : 'file' } });
    return;
  }
  if (!current || !current.isSymbolicLink()) throw transactionError('TARGET_PATH_CHANGED', `removal path is no longer a symlink: ${item.linkPath}`);
  const linkText = await fs.readlink(item.linkPath);
  if (snapshot && (!sameIdentityFields(current, snapshot, ['dev', 'ino']) || snapshot.type !== 'symlink' || snapshot.linkText !== linkText)) throw transactionError('TARGET_PATH_CHANGED', `removal link identity changed: ${item.linkPath}`);
  if (normalizeRelative(linkText) !== normalizeRelative(item.relativeTarget)) throw transactionError('TARGET_PATH_CHANGED', `removal link target changed: ${item.linkPath}`);
  return { dev: current.dev, ino: current.ino, type: 'symlink', linkText };
}

function manifestForPlan(plan) {
  const links = plan.desired.map((item) => ({
    linkName: item.linkName,
    sourceRelative: item.sourceRelative,
    relativeTarget: item.relativeTarget ?? normalizeRelative(path.relative(targetPath(plan.target), item.sourceDir)),
    sourceIdentity: { canonicalPath: item.sourceIdentity.canonicalPath, dev: item.sourceIdentity.dev, ino: item.sourceIdentity.ino },
    createdAt: new Date().toISOString(),
  }));
  return { version: 1, target: manifestTarget(plan.target), catalog: manifestCatalog(plan.catalog), links };
}

function planFingerprint(plan) {
  return plan.fingerprint ?? linkFingerprint({ target: plan.target, catalog: plan.catalog, desired: plan.desired, create: plan.create, remove: plan.remove, keep: plan.keep, conflicts: plan.conflicts, protected: plan.protected });
}

function manifestOwns(manifest, item) {
  const entry = manifest?.links?.find((candidate) => candidate.linkName === item.linkName || candidate.linkName === path.basename(item.linkPath));
  if (!entry || !item.manifestEntry) return false;
  return linkFingerprint(entry) === linkFingerprint(item.manifestEntry);
}

async function recheckPlan(plan, snapshots, manifest) {
  if (planFingerprint(plan) !== snapshots.planFingerprint) throw transactionError('PLAN_CHANGED', 'transaction plan changed');
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
    states = await scanTarget({ targetIdentity: plan.target, catalog: { root: plan.catalog.canonicalPath, identity: plan.catalog, skills: plan.desired.map((item) => ({ ...item, relativeSource: item.sourceRelative, skillFile: path.join(item.sourceDir, 'SKILL.md') })) }, manifest });
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

async function manifestPathFor(stateRoot, plan) {
  return path.join(path.resolve(stateRoot), `target-${manifestIdentity({ targetIdentity: plan.target, catalogIdentity: plan.catalog }).slice(0, 32)}.json`);
}

async function restoreOldManifest(stateRoot, plan, oldManifest) {
  const file = await manifestPathFor(stateRoot, plan);
  if (oldManifest) await writeManifestAtomic({ stateRoot, targetIdentity: { ...plan.target, catalogIdentity: plan.catalog }, manifest: oldManifest });
  else await fs.rm(file, { force: true });
}

async function applyPlan(plan, { state, dryRun, beforeMutation, beforeManifest, beforeVerify }) {
  const result = { target: plan.target, applied: [], skipped: [], failed: [], journal: null, verified: false };
  if (dryRun) {
    result.skipped = [...plan.create, ...plan.remove, ...plan.keep, ...plan.conflicts, ...plan.protected];
    return result;
  }
  const stateRoot = stateRootFor(plan, state);
  const journal = journalName(stateRoot);
  result.journal = journal;
  const oldManifest = await currentManifest(plan, state).catch((error) => { throw error; });
  const record = { version: JOURNAL_VERSION, state: 'prepared', target: plan.target, catalog: plan.catalog, planFingerprint: planFingerprint(plan), oldManifest: oldManifest ?? null, operations: [] };
  const quarantine = path.join(path.dirname(targetPath(plan.target)), `.manage-skills-quarantine-${crypto.randomUUID()}`);
  record.quarantine = quarantine;
  let quarantineCreated = false;
  let mutationCount = 0;
  const failPoint = () => {
    if (Number.isInteger(state.failAfter) && mutationCount >= state.failAfter) throw transactionError('INJECTED_FAILURE', 'injected transaction failure');
  };
  try {
    await fs.mkdir(stateRoot, { recursive: true });
    await writeJournal(journal, record);
    const snapshots = { target: { ...plan.target }, catalog: { ...plan.catalog }, planFingerprint: planFingerprint(plan), sources: new Map(), links: new Map() };
    for (const item of plan.desired) snapshots.sources.set(item.sourceDir, { ...item.sourceIdentity });
    for (const item of plan.remove) {
      const current = await lstatOrNull(item.linkPath);
      if (current) snapshots.links.set(item.linkPath, { dev: current.dev, ino: current.ino, type: current.isSymbolicLink() ? 'symlink' : current.isDirectory() ? 'directory' : 'file', ...(current.isSymbolicLink() ? { linkText: await fs.readlink(item.linkPath) } : {}) });
    }
    if (beforeMutation) await beforeMutation(plan);
    await recheckPlan(plan, snapshots, oldManifest);
    record.state = 'mutating';
    await writeJournal(journal, record);
    for (const item of plan.create) {
      await recheckPlan(plan, snapshots, await currentManifest(plan, state));
      const operation = { type: 'create', linkPath: item.linkPath, sourceDir: item.sourceDir, status: 'pending' };
      record.operations.push(operation);
      await writeJournal(journal, record);
      await fs.symlink(item.relativeTarget, item.linkPath, 'dir');
      operation.status = 'done';
      result.applied.push(item.linkPath);
      mutationCount += 1;
      await writeJournal(journal, record);
      failPoint();
    }
    for (const item of plan.remove) {
      await recheckPlan(plan, snapshots, await currentManifest(plan, state));
      if (!quarantineCreated) { await fs.mkdir(quarantine); quarantineCreated = true; }
      const destination = path.join(quarantine, path.basename(item.linkPath));
      const operation = { type: 'quarantine', original: item.linkPath, quarantine: destination, status: 'pending' };
      record.operations.push(operation);
      await writeJournal(journal, record);
      await fs.rename(item.linkPath, destination);
      operation.status = 'done';
      result.applied.push(item.linkPath);
      mutationCount += 1;
      await writeJournal(journal, record);
      failPoint();
    }
    const nextManifest = manifestForPlan(plan);
    if (beforeManifest) await beforeManifest(plan, nextManifest);
    record.manifest = nextManifest;
    await writeManifestAtomic({ stateRoot, targetIdentity: { ...plan.target, catalogIdentity: plan.catalog }, manifest: nextManifest });
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
    if (quarantineCreated) await fs.rm(quarantine, { recursive: true, force: true });
    await fs.rm(journal, { force: true });
    return result;
  } catch (error) {
    result.failed.push(failure(error));
    record.state = 'failed';
    record.error = failure(error);
    try {
      if (record.manifest && record.state !== 'committed') await restoreOldManifest(stateRoot, plan, oldManifest);
    } catch (restoreError) {
      record.recoveryError = failure(restoreError);
    }
    await writeJournal(journal, record).catch(() => {});
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

function validateJournal(journal, stateRoot, journalPath) {
  if (!journal || journal.version !== JOURNAL_VERSION || !JOURNAL_STATES.has(journal.state) || journal.state === 'committed' || !Array.isArray(journal.operations)) throw journalError('journal schema or state is invalid');
  const root = path.resolve(stateRoot);
  const file = path.resolve(journalPath);
  if (!file.startsWith(`${root}${path.sep}`)) throw journalError('journal path is outside state root');
  for (const operation of journal.operations) {
    if (!operation || !['create', 'quarantine'].includes(operation.type) || operation.status !== 'done') throw journalError('journal operation is invalid');
    if (operation.type === 'create' && (typeof operation.linkPath !== 'string' || typeof operation.sourceDir !== 'string')) throw journalError('create operation is invalid');
    if (operation.type === 'quarantine' && (typeof operation.original !== 'string' || typeof operation.quarantine !== 'string')) throw journalError('quarantine operation is invalid');
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
  const restored = [];
  const rolledBack = [];
  const conflicts = [];
  try {
    for (const operation of [...journal.operations].reverse()) {
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
    if (journal.quarantine) await fs.rm(journal.quarantine, { recursive: true, force: true });
    await fs.rm(file, { force: true });
    return { recovered: true, restored, rolledBack, conflicts, stateRoot: root, journalPath: file };
  } catch (error) {
    return { recovered: false, restored, rolledBack, conflicts, error: failure(error), stateRoot: root, journalPath: file };
  }
}

export { JOURNAL_STATES };
