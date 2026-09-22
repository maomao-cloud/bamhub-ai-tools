import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { scanTarget, normalizeRelative, sameIdentity, targetPath } from './links.mjs';
import {
  acquireTargetLock,
  loadManifest,
  writeManifestAtomic,
} from './state.mjs';

const JOURNAL_VERSION = 1;

function failure(error) {
  return { code: error?.code ?? 'TRANSACTION_FAILED', message: error?.message ?? String(error) };
}

function targetKey(plan) {
  return plan.target?.canonicalPath ?? targetPath(plan.target);
}

function stateRootFor(plan, state) {
  const root = state?.stateRoot ?? plan.target?.stateRoot;
  if (typeof root !== 'string' || !root) {
    const error = new Error('stateRoot is required for apply');
    error.code = 'STATE_ROOT_REQUIRED';
    throw error;
  }
  return path.resolve(root);
}

function manifestTarget(identity) {
  return { ...(identity.path === undefined ? {} : { path: identity.path }), canonicalPath: identity.canonicalPath ?? identity.realPath, dev: identity.dev, ino: identity.ino };
}

function manifestCatalog(identity) {
  return { ...(identity.path === undefined ? {} : { path: identity.path }), canonicalPath: identity.canonicalPath ?? identity.realPath, dev: identity.dev, ino: identity.ino, ...(identity.gitRemote === undefined ? {} : { gitRemote: identity.gitRemote }), ...(identity.gitCommit === undefined ? {} : { gitCommit: identity.gitCommit }) };
}

function stateValue(state, target) {
  const source = state?.manifestByTarget ?? state?.manifests;
  const keys = [target?.canonicalPath, target?.path, target?.realPath].filter(Boolean);
  if (source instanceof Map) return keys.map((key) => source.get(key)).find(Boolean);
  if (source && typeof source === 'object') return keys.map((key) => source[key]).find(Boolean);
  return state?.manifest;
}

async function manifestFor(plan, state) {
  const supplied = stateValue(state, plan.target);
  if (supplied) return supplied;
  try {
    return await loadManifest({ stateRoot: stateRootFor(plan, state), targetIdentity: { ...plan.target, catalogIdentity: plan.catalog } });
  } catch (error) {
    if (error.code !== 'MANIFEST_MISSING') throw error;
    return { version: 1, target: manifestTarget(plan.target), catalog: manifestCatalog(plan.catalog), links: [] };
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

async function checkTarget(plan) {
  const root = targetPath(plan.target);
  const stat = await fs.lstat(root);
  if (!stat.isDirectory() || !sameIdentity({ canonicalPath: await fs.realpath(root), dev: stat.dev, ino: stat.ino }, plan.target, ['canonicalPath', 'dev', 'ino'])) {
    const error = new Error('target identity changed');
    error.code = 'TARGET_IDENTITY_CHANGED';
    throw error;
  }
  return root;
}

async function checkSource(item) {
  const sourceReal = await fs.realpath(item.sourceDir);
  const sourceStat = await fs.stat(sourceReal);
  const skillStat = await fs.lstat(path.join(sourceReal, 'SKILL.md'));
  if (!sourceStat.isDirectory() || !skillStat.isFile() || skillStat.isSymbolicLink() || !sameIdentity({ canonicalPath: sourceReal, dev: sourceStat.dev, ino: sourceStat.ino }, item.sourceIdentity, ['canonicalPath', 'dev', 'ino'])) {
    const error = new Error('source identity changed or source is invalid');
    error.code = 'SOURCE_IDENTITY_CHANGED';
    throw error;
  }
}

async function checkCreate(item) {
  await checkSource(item);
  const current = await fs.lstat(item.linkPath).catch((error) => {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  });
  if (current) {
    const error = new Error(`target link path is occupied: ${item.linkPath}`);
    error.code = 'TARGET_PATH_CHANGED';
    throw error;
  }
}

async function checkRemove(item, plan) {
  const current = await fs.lstat(item.linkPath);
  if (!current.isSymbolicLink()) {
    const error = new Error(`removal path is no longer a symlink: ${item.linkPath}`);
    error.code = 'TARGET_PATH_CHANGED';
    throw error;
  }
  const target = await fs.readlink(item.linkPath);
  if (normalizeRelative(target) !== normalizeRelative(item.relativeTarget)) {
    const error = new Error(`removal link target changed: ${item.linkPath}`);
    error.code = 'TARGET_PATH_CHANGED';
    throw error;
  }
  if (item.manifestEntry?.sourceIdentity && plan.catalog) {
    const entry = item.manifestEntry;
    if (!sameIdentity(entry.sourceIdentity, item.manifestEntry.sourceIdentity, ['canonicalPath', 'dev', 'ino'])) throw new Error('manifest source identity changed');
  }
  return { dev: current.dev, ino: current.ino };
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

export async function verifyPlan(plan) {
  const mismatches = [];
  let states;
  try {
    states = await scanTarget({ targetIdentity: plan.target, catalog: { root: plan.catalog.canonicalPath, identity: plan.catalog, skills: plan.desired.map((item) => ({ ...item, skillFile: path.join(item.sourceDir, 'SKILL.md') })) } });
  } catch (error) {
    return { ok: false, mismatches: [{ code: error.code ?? 'VERIFY_FAILED', message: error.message }] };
  }
  const byPath = new Map(states.map((item) => [item.linkPath, item]));
  for (const item of plan.desired) {
    const state = byPath.get(path.join(targetPath(plan.target), item.linkName));
    if (!state || state.kind !== 'managed-valid' && state.kind !== 'unmanaged-symlink') mismatches.push({ path: path.join(targetPath(plan.target), item.linkName), reason: 'missing desired link' });
    else {
      const expected = await fs.realpath(item.sourceDir).catch(() => null);
      if (state.realTarget !== expected) mismatches.push({ path: state.linkPath, reason: 'wrong link target' });
    }
  }
  for (const item of plan.remove) {
    if (await fs.lstat(item.linkPath).catch(() => null)) mismatches.push({ path: item.linkPath, reason: 'removed link remains' });
  }
  return { ok: mismatches.length === 0, mismatches };
}

async function applyPlan(plan, { state, dryRun, beforeMutation }) {
  const result = { target: plan.target, applied: [], skipped: [], failed: [], journal: null, verified: false };
  if (dryRun) {
    result.skipped = [...plan.create, ...plan.remove, ...plan.keep, ...plan.conflicts, ...plan.protected];
    return result;
  }
  const stateRoot = stateRootFor(plan, state);
  const journal = journalName(stateRoot);
  result.journal = journal;
  const record = { version: JOURNAL_VERSION, state: 'prepared', target: plan.target, operations: [] };
  const quarantine = path.join(path.dirname(targetPath(plan.target)), `.manage-skills-quarantine-${crypto.randomUUID()}`);
  let quarantineCreated = false;
  let mutationCount = 0;
  const maybeFail = () => {
    if (Number.isInteger(state.failAfter) && mutationCount >= state.failAfter) {
      const error = new Error('injected transaction failure');
      error.code = 'INJECTED_FAILURE';
      throw error;
    }
  };
  try {
    await fs.mkdir(stateRoot, { recursive: true });
    await writeJournal(journal, record);
    await checkTarget(plan);
    if (beforeMutation) await beforeMutation(plan);
    record.state = 'mutating';
    for (const item of plan.create) {
      await checkCreate(item);
      const operation = { type: 'create', linkPath: item.linkPath, sourceDir: item.sourceDir, status: 'pending' };
      record.operations.push(operation); await writeJournal(journal, record);
      await fs.symlink(item.relativeTarget, item.linkPath, 'dir');
      operation.status = 'done'; result.applied.push(item.linkPath); mutationCount += 1; await writeJournal(journal, record); maybeFail();
    }
    for (const item of plan.remove) {
      await checkRemove(item, plan);
      if (!quarantineCreated) { await fs.mkdir(quarantine); quarantineCreated = true; }
      const destination = path.join(quarantine, path.basename(item.linkPath));
      const operation = { type: 'quarantine', original: item.linkPath, quarantine: destination, status: 'pending' };
      record.operations.push(operation); await writeJournal(journal, record);
      await fs.rename(item.linkPath, destination);
      operation.status = 'done'; result.applied.push(item.linkPath); mutationCount += 1; await writeJournal(journal, record); maybeFail();
    }
    await manifestFor(plan, state);
    const nextManifest = manifestForPlan(plan);
    record.manifest = nextManifest;
    record.state = 'manifest'; await writeJournal(journal, record);
    await writeManifestAtomic({ stateRoot, targetIdentity: { ...plan.target, catalogIdentity: plan.catalog }, manifest: nextManifest });
    record.state = 'verified'; await writeJournal(journal, record);
    const verification = await verifyPlan(plan);
    if (!verification.ok) { const error = new Error('post-apply verification failed'); error.code = 'POST_VERIFY_FAILED'; error.mismatches = verification.mismatches; throw error; }
    result.verified = true;
    if (quarantineCreated) await fs.rm(quarantine, { recursive: true, force: true });
    await fs.rm(journal, { force: true });
    return result;
  } catch (error) {
    result.failed.push(failure(error));
    record.state = 'failed'; record.error = failure(error); record.quarantine = quarantineCreated ? quarantine : undefined;
    await writeJournal(journal, record).catch(() => {});
    return result;
  }
}

export async function applyPlanSet(planSet, { state = {}, dryRun = false, beforeMutation } = {}) {
  const plans = planSet?.plans ?? [];
  if (dryRun) return { targets: await Promise.all(plans.map((plan) => applyPlan(plan, { state, dryRun: true }))), exitCode: 0 };
  const handles = [];
  try {
    for (const plan of plans) {
      const handle = await acquireTargetLock({ stateRoot: stateRootFor(plan, state), targetIdentity: { ...plan.target, catalogIdentity: plan.catalog } });
      handles.push(handle);
    }
  } catch (error) {
    await Promise.all(handles.map((handle) => handle.release().catch(() => {})));
    const failed = plans.map((plan) => ({ target: plan.target, applied: [], skipped: [], failed: [failure(error)], journal: null, verified: false }));
    return { targets: failed, exitCode: 1 };
  }
  const targets = [];
  try {
    for (const plan of plans) targets.push(await applyPlan(plan, { state, dryRun, beforeMutation }));
  } finally {
    await Promise.all(handles.map((handle) => handle.release().catch(() => {})));
  }
  return { targets, exitCode: targets.some((target) => target.failed.length || !target.verified) ? 1 : 0 };
}

export async function recoverJournal({ stateRoot, journalPath }) {
  const journal = JSON.parse(await fs.readFile(journalPath, 'utf8'));
  const restored = [];
  const rolledBack = [];
  const operations = journal.state === 'verified' ? [] : [...(journal.operations ?? [])].reverse();
  for (const operation of operations) {
    if (operation.status !== 'done') continue;
    if (operation.type === 'quarantine' && await fs.lstat(operation.quarantine).catch(() => null)) {
      if (!(await fs.lstat(operation.original).catch(() => null))) {
        await fs.rename(operation.quarantine, operation.original);
        restored.push(operation.original);
      }
    } else if (operation.type === 'create') {
      const current = await fs.lstat(operation.linkPath).catch(() => null);
      if (current?.isSymbolicLink() && await fs.realpath(operation.linkPath).catch(() => null) === await fs.realpath(operation.sourceDir).catch(() => null)) {
        await fs.unlink(operation.linkPath);
        rolledBack.push(operation.linkPath);
      }
    }
  }
  if (journal.quarantine) await fs.rm(journal.quarantine, { recursive: true, force: true });
  await fs.rm(journalPath, { force: true });
  return { recovered: true, restored, stateRoot, journalPath };
}
