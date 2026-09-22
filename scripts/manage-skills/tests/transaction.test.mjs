import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { buildPlanSet } from '../lib/plan.mjs';
import { applyPlanSet, verifyPlan, recoverJournal } from '../lib/transaction.mjs';
import { acquireTargetLock, loadManifest } from '../lib/state.mjs';

const roots = [];
async function tempDir() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'manage-skills-transaction-'));
  roots.push(root);
  return root;
}
async function identity(file, extra = {}) {
  const stat = await fs.stat(file);
  return { path: file, canonicalPath: await fs.realpath(file), dev: stat.dev, ino: stat.ino, ...extra };
}
async function fixture() {
  const root = await tempDir();
  const catalogRoot = path.join(root, 'catalog');
  const targetRoot = path.join(root, 'target');
  const stateRoot = path.join(root, 'state');
  await fs.mkdir(catalogRoot, { recursive: true });
  await fs.mkdir(targetRoot, { recursive: true });
  const sourceDir = path.join(catalogRoot, 'group', 'alpha');
  await fs.mkdir(sourceDir, { recursive: true });
  await fs.writeFile(path.join(sourceDir, 'SKILL.md'), '---\nname: alpha\ndescription: test\n---\n');
  const target = await identity(targetRoot);
  const catalog = await identity(catalogRoot, { gitCommit: 'abc' });
  const sourceStat = await fs.stat(sourceDir);
  const source = { canonicalPath: await fs.realpath(sourceDir), dev: sourceStat.dev, ino: sourceStat.ino };
  const cat = { root: catalogRoot, identity: catalog, skills: [{ name: 'alpha', relativeSource: 'group/alpha', sourceDir, skillFile: path.join(sourceDir, 'SKILL.md'), sourceIdentity: source }] };
  const planSet = await buildPlanSet({ targets: [target], catalog: cat, desiredSelections: [cat.skills[0]] });
  return { root, catalogRoot, targetRoot, stateRoot, sourceDir, target, catalog, cat, planSet };
}

test.after(async () => Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true }))));

test('dry-run reports changes without creating locks, links, state, or quarantine', async () => {
  const f = await fixture();
  const report = await applyPlanSet(f.planSet, { state: { stateRoot: f.stateRoot }, dryRun: true });
  assert.equal(report.exitCode, 0);
  assert.equal(report.targets[0].applied.length, 0);
  assert.equal(report.targets[0].skipped.length > 0, true);
  assert.equal(await fs.lstat(path.join(f.targetRoot, 'alpha')).catch(() => null), null);
  assert.equal(await fs.lstat(f.stateRoot).catch(() => null), null);
});

test('creates link, atomically writes manifest, and post-verifies', async () => {
  const f = await fixture();
  const report = await applyPlanSet(f.planSet, { state: { stateRoot: f.stateRoot } });
  assert.equal(report.exitCode, 0, JSON.stringify(report));
  assert.equal(report.targets[0].verified, true);
  assert.equal(await fs.realpath(path.join(f.targetRoot, 'alpha')), await fs.realpath(f.sourceDir));
  const manifest = await loadManifest({ stateRoot: f.stateRoot, targetIdentity: { ...f.target, catalogIdentity: f.catalog } });
  assert.deepEqual(manifest.links.map((entry) => entry.linkName), ['alpha']);
  const writtenManifest = await loadManifest({ stateRoot: f.stateRoot, targetIdentity: { ...f.target, catalogIdentity: f.catalog } });
  assert.equal(await verifyPlan(f.planSet.plans[0], { manifest: writtenManifest }).then((result) => result.ok), true);
  assert.equal(typeof report.targets[0].journal, 'string');
});

test('quarantines only manifest-owned removals and keeps quarantine on failure', async () => {
  const f = await fixture();
  await applyPlanSet(f.planSet, { state: { stateRoot: f.stateRoot } });
  const empty = await buildPlanSet({ targets: [f.target], catalog: f.cat, desiredSelections: [], options: { disableAll: true, manifestByTarget: new Map([[f.target.canonicalPath, await loadManifest({ stateRoot: f.stateRoot, targetIdentity: { ...f.target, catalogIdentity: f.catalog } })]]) } });
  assert.equal(empty.plans[0].remove.length, 1, JSON.stringify(empty.plans[0]));
  const report = await applyPlanSet(empty, { state: { stateRoot: f.stateRoot, failAfter: 0 } });
  assert.equal(report.exitCode, 1, JSON.stringify(report));
  assert.equal(report.targets[0].failed.length, 1);
  assert.equal((await fs.readdir(path.dirname(f.targetRoot))).some((name) => name.includes('quarantine')), true);
  assert.equal(await fs.lstat(path.join(f.targetRoot, 'alpha')).catch(() => null), null);
  assert.equal(await fs.lstat(report.targets[0].journal).then(() => true, () => false), true);
});

test('source replacement is a conflict and never overwrites the target link', async () => {
  const f = await fixture();
  const report = await applyPlanSet(f.planSet, { state: { stateRoot: f.stateRoot }, beforeMutation: async () => {
    await fs.rm(f.sourceDir, { recursive: true });
    await fs.mkdir(f.sourceDir);
    await fs.writeFile(path.join(f.sourceDir, 'SKILL.md'), 'replacement');
  } });
  assert.equal(report.exitCode, 1);
  assert.equal(report.targets[0].applied.length, 0);
  assert.equal(await fs.lstat(path.join(f.targetRoot, 'alpha')).catch(() => null), null);
});

test('recovery restores quarantined paths from an interrupted journal', async () => {
  const f = await fixture();
  const original = path.join(f.targetRoot, 'old');
  const quarantine = path.join(f.stateRoot, 'quarantine-test', 'old');
  await fs.mkdir(path.dirname(quarantine), { recursive: true });
  await fs.writeFile(original, 'old');
  await fs.rename(original, quarantine);
  const journal = path.join(f.stateRoot, 'journal-test.json');
  await fs.writeFile(journal, JSON.stringify({ version: 1, state: 'mutating', operations: [{ type: 'quarantine', original, quarantine, status: 'done' }] }));
  const result = await recoverJournal({ stateRoot: f.stateRoot, journalPath: journal });
  assert.equal(result.recovered, true);
  assert.equal(await fs.readFile(original, 'utf8'), 'old');
  assert.equal(await fs.lstat(journal).catch(() => null), null);
});

 test('second process lock failure leaves target unchanged', async () => {
  const f = await fixture();
  const first = await acquireTargetLock({ stateRoot: f.stateRoot, targetIdentity: { ...f.target, catalogIdentity: f.catalog } });
  const second = await applyPlanSet(f.planSet, { state: { stateRoot: f.stateRoot } });
  assert.equal(second.exitCode, 1);
  assert.equal(second.targets[0].applied.length, 0);
  await first.release();
});

 test('regular file at create path is protected and never replaced', async () => {
  const f = await fixture();
  await fs.writeFile(path.join(f.targetRoot, 'alpha'), 'protected');
  const report = await applyPlanSet(f.planSet, { state: { stateRoot: f.stateRoot } });
  assert.equal(report.exitCode, 1);
  assert.equal(await fs.readFile(path.join(f.targetRoot, 'alpha'), 'utf8'), 'protected');
});

 test('target link replacement is detected before mutation', async () => {
  const f = await fixture();
  const plan = f.planSet.plans[0];
  const report = await applyPlanSet(f.planSet, { state: { stateRoot: f.stateRoot }, beforeMutation: async () => {
    await fs.symlink(f.catalogRoot, path.join(f.targetRoot, 'alpha'));
  } });
  assert.equal(report.exitCode, 1);
  assert.equal(await fs.realpath(path.join(f.targetRoot, 'alpha')), await fs.realpath(f.catalogRoot));
  assert.ok(plan.create.length);
});

test('permission failure is reported without claiming verification', async () => {
  const f = await fixture();
  await fs.writeFile(path.join(f.root, 'state-file'), 'not a directory');
  const failed = await applyPlanSet(f.planSet, { state: { stateRoot: path.join(f.root, 'state-file') } });
  assert.equal(failed.exitCode, 1);
  assert.equal(failed.targets[0].verified, false);
});

test('rechecks catalog git identity before the first mutation', async () => {
  const f = await fixture();
  const report = await applyPlanSet(f.planSet, { state: { stateRoot: f.stateRoot }, beforeMutation: async () => {
    f.planSet.plans[0].catalog.gitCommit = 'changed';
  } });
  assert.equal(report.exitCode, 1);
  assert.equal(report.targets[0].applied.length, 0);
  assert.equal(await fs.lstat(path.join(f.targetRoot, 'alpha')).catch(() => null), null);
});

test('post-verification rejects a link that is no longer manifest-owned', async () => {
  const f = await fixture();
  const report = await applyPlanSet(f.planSet, { state: { stateRoot: f.stateRoot }, beforeVerify: async (_plan, manifest) => {
    manifest.links = [];
    await fs.rm(path.join(f.targetRoot, 'alpha'));
    await fs.symlink(f.sourceDir, path.join(f.targetRoot, 'alpha'));
  } });
  assert.equal(report.exitCode, 1);
  assert.equal(report.targets[0].verified, false);
  assert.equal(await fs.lstat(report.targets[0].journal).then(() => true, () => false), true);
});

test('recovery preserves quarantine when original path is occupied', async () => {
  const f = await fixture();
  const original = path.join(f.targetRoot, 'old');
  const quarantine = path.join(f.stateRoot, 'quarantine-occupied', 'old');
  await fs.mkdir(path.dirname(quarantine), { recursive: true });
  await fs.writeFile(quarantine, 'quarantined');
  await fs.writeFile(original, 'new occupant');
  const journal = path.join(f.stateRoot, 'journal-occupied.json');
  await fs.writeFile(journal, JSON.stringify({ version: 1, state: 'mutating', target: f.target, catalog: f.catalog, operations: [{ type: 'quarantine', original, quarantine, status: 'done' }] }));
  const result = await recoverJournal({ stateRoot: f.stateRoot, journalPath: journal });
  assert.equal(result.recovered, false);
  assert.equal(result.conflicts.length, 1);
  assert.equal(await fs.readFile(original, 'utf8'), 'new occupant');
  assert.equal(await fs.readFile(quarantine, 'utf8'), 'quarantined');
  assert.equal(await fs.lstat(journal).then(() => true, () => false), true);
});

test('recovery rejects malformed journals without deleting them', async () => {
  const f = await fixture();
  const journal = path.join(f.stateRoot, 'malformed.json');
  await fs.mkdir(f.stateRoot, { recursive: true });
  await fs.writeFile(journal, JSON.stringify({ version: 1, state: 'verified' }));
  await assert.rejects(() => recoverJournal({ stateRoot: f.stateRoot, journalPath: journal }), { code: 'JOURNAL_MALFORMED' });
  assert.equal(await fs.lstat(journal).then(() => true, () => false), true);
});

test('lock failure is target-specific and prevents every target mutation', async () => {
  const first = await fixture();
  const second = await fixture();
  const held = await acquireTargetLock({ stateRoot: first.stateRoot, targetIdentity: { ...second.target, catalogIdentity: second.catalog } });
  const report = await applyPlanSet({ plans: [first.planSet.plans[0], second.planSet.plans[0]] }, { state: { stateRoot: first.stateRoot } });
  assert.equal(report.exitCode, 1);
  assert.equal(report.targets.length, 2);
  assert.equal(report.targets[1].failed[0].code, 'TARGET_LOCKED');
  assert.equal(report.targets[0].applied.length, 0);
  assert.equal(await fs.lstat(path.join(first.targetRoot, 'alpha')).catch(() => null), null);
  assert.equal(await fs.lstat(path.join(second.targetRoot, 'alpha')).catch(() => null), null);
  await held.release();
});

test('journal uses only durable transaction states', async () => {
  const f = await fixture();
  const report = await applyPlanSet(f.planSet, { state: { stateRoot: f.stateRoot, failAfter: 0 } });
  const journal = JSON.parse(await fs.readFile(report.targets[0].journal, 'utf8'));
  assert.equal(journal.state, 'failed');
  assert.ok(['prepared', 'mutating', 'manifest-written', 'verifying', 'committed', 'failed'].includes(journal.state));
});

test('target identity replacement is rejected before any mutation', async () => {
  const f = await fixture();
  const report = await applyPlanSet(f.planSet, { state: { stateRoot: f.stateRoot }, beforeMutation: async () => {
    await fs.rm(f.targetRoot, { recursive: true });
    await fs.mkdir(f.targetRoot);
  } });
  assert.equal(report.exitCode, 1);
  assert.equal(report.targets[0].failed[0].code, 'TARGET_IDENTITY_CHANGED');
  assert.equal(await fs.lstat(path.join(f.targetRoot, 'alpha')).catch(() => null), null);
});

test('recovery rolls back a completed create operation', async () => {
  const f = await fixture();
  const report = await applyPlanSet(f.planSet, { state: { stateRoot: f.stateRoot, failAfter: 1 } });
  assert.equal(report.exitCode, 1);
  assert.equal(await fs.lstat(path.join(f.targetRoot, 'alpha')).then(() => true, () => false), true);
  const recovered = await recoverJournal({ stateRoot: f.stateRoot, journalPath: report.targets[0].journal });
  assert.equal(recovered.recovered, true);
  assert.equal(await fs.lstat(path.join(f.targetRoot, 'alpha')).catch(() => null), null);
  assert.equal(await fs.lstat(report.targets[0].journal).catch(() => null), null);
});

test('verification failure restores the manifest written by the transaction', async () => {
  const f = await fixture();
  const report = await applyPlanSet(f.planSet, { state: { stateRoot: f.stateRoot }, beforeVerify: async (_plan, manifest) => {
    manifest.links = [];
  } });
  assert.equal(report.exitCode, 1);
  assert.equal(report.targets[0].failed[0].code, 'POST_VERIFY_FAILED');
  assert.equal(await fs.lstat(report.targets[0].journal).then(() => true, () => false), true);
  await recoverJournal({ stateRoot: f.stateRoot, journalPath: report.targets[0].journal });
  assert.equal(await fs.lstat(report.targets[0].journal).catch(() => null), null);
});
