import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { buildPlanSet } from '../lib/plan.mjs';
import { applyPlanSet, verifyPlan, recoverJournal } from '../lib/transaction.mjs';
import { acquireTargetLock, loadManifest, manifestIdentity } from '../lib/state.mjs';

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

test('direct apply uses target stateRoot without requiring injected state', async () => {
  const f = await fixture();
  f.planSet.plans[0].target.stateRoot = f.stateRoot;
  const report = await applyPlanSet(f.planSet);
  assert.equal(report.exitCode, 0, JSON.stringify(report));
  assert.equal(report.targets[0].verified, true);
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
  const quarantineToken = '11111111-1111-4111-8111-111111111111';
  const quarantineRoot = path.join(path.dirname(f.targetRoot), `.manage-skills-quarantine-${quarantineToken}`);
  const quarantine = path.join(quarantineRoot, 'old');
  await fs.mkdir(quarantineRoot, { recursive: true });
  await fs.writeFile(path.join(quarantineRoot, '.manage-skills-quarantine-marker'), quarantineToken);
  await fs.writeFile(original, 'old');
  await fs.rename(original, quarantine);
  const journal = path.join(f.stateRoot, 'journal-test.json');
  await fs.mkdir(f.stateRoot, { recursive: true });
  await fs.writeFile(journal, JSON.stringify({ version: 1, state: 'mutating', target: f.target, catalog: f.catalog, planFingerprint: 'test-fingerprint', oldManifest: null, quarantine: quarantineRoot, quarantineToken, quarantineCreated: true, operations: [{ type: 'quarantine', original, quarantine, status: 'done' }] }));
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
  const quarantineToken = '22222222-2222-4222-8222-222222222222';
  const quarantineRoot = path.join(path.dirname(f.targetRoot), `.manage-skills-quarantine-${quarantineToken}`);
  const quarantine = path.join(quarantineRoot, 'old');
  await fs.mkdir(quarantineRoot, { recursive: true });
  await fs.writeFile(path.join(quarantineRoot, '.manage-skills-quarantine-marker'), quarantineToken);
  await fs.writeFile(quarantine, 'quarantined');
  await fs.writeFile(original, 'new occupant');
  const journal = path.join(f.stateRoot, 'journal-occupied.json');
  await fs.mkdir(f.stateRoot, { recursive: true });
  await fs.writeFile(journal, JSON.stringify({ version: 1, state: 'mutating', target: f.target, catalog: f.catalog, planFingerprint: 'test-fingerprint', oldManifest: null, quarantine: quarantineRoot, quarantineToken, quarantineCreated: true, operations: [{ type: 'quarantine', original, quarantine, status: 'done' }] }));
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

test('external manifest changes are rejected even when the removal entry is unchanged', async () => {
  const f = await fixture();
  const first = await applyPlanSet(f.planSet, { state: { stateRoot: f.stateRoot } });
  assert.equal(first.exitCode, 0);
  const manifestFile = (await fs.readdir(f.stateRoot)).find((name) => name.endsWith('.json'));
  const manifestPath = path.join(f.stateRoot, manifestFile);
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const empty = await buildPlanSet({ targets: [f.target], catalog: f.cat, desiredSelections: [], options: { disableAll: true, manifestByTarget: new Map([[f.target.canonicalPath, manifest]]) } });
  const report = await applyPlanSet(empty, { state: { stateRoot: f.stateRoot }, beforeMutation: async () => {
    const external = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    external.links[0].createdAt = '2026-01-01T00:00:00.000Z';
    await fs.writeFile(manifestPath, JSON.stringify(external));
  } });
  assert.equal(report.exitCode, 1);
  assert.equal(report.targets[0].applied.length, 0);
  assert.equal((await fs.lstat(path.join(f.targetRoot, 'alpha')).catch(() => null))?.isSymbolicLink(), true);
});

test('identity changes immediately before manifest write prevent the manifest mutation', async () => {
  const f = await fixture();
  const report = await applyPlanSet(f.planSet, { state: { stateRoot: f.stateRoot }, beforeManifest: async () => {
    await fs.rename(f.catalogRoot, `${f.catalogRoot}-moved`);
    await fs.mkdir(f.catalogRoot);
  } });
  assert.equal(report.exitCode, 1);
  assert.equal(report.targets[0].failed[0].code, 'CATALOG_IDENTITY_CHANGED');
  assert.equal(await fs.lstat(path.join(f.targetRoot, 'alpha')).then(() => true, () => false), true);
  assert.equal(await fs.readdir(f.stateRoot).then((names) => names.filter((name) => name.endsWith('.json')).length), 1);
});

test('recomputed plan content fingerprint rejects tampering of stored fingerprint', async () => {
  const f = await fixture();
  const report = await applyPlanSet(f.planSet, { state: { stateRoot: f.stateRoot }, beforeMutation: async (plan) => {
    plan.create = [];
    plan.fingerprint = 'attacker-controlled';
  } });
  assert.equal(report.exitCode, 1);
  assert.equal(report.targets[0].failed[0].code, 'PLAN_CHANGED');
  assert.equal(await fs.lstat(path.join(f.targetRoot, 'alpha')).catch(() => null), null);
});

test('manifest precheck failures are target-local apply failures', async () => {
  const first = await fixture();
  const second = await fixture();
  await fs.mkdir(first.stateRoot, { recursive: true });
  const manifestFile = path.join(first.stateRoot, `target-${manifestIdentity({ targetIdentity: first.planSet.plans[0].target }).slice(0, 32)}.json`);
  await fs.writeFile(manifestFile, '{ malformed');
  const report = await applyPlanSet({ plans: [first.planSet.plans[0], second.planSet.plans[0]] }, { state: { stateRoot: first.stateRoot } });
  assert.equal(report.exitCode, 1);
  assert.equal(report.targets.length, 2);
  assert.equal(report.targets[0].verified, false);
  assert.equal(report.targets[0].failed.length, 1);
  assert.equal(report.targets[1].verified, true);
});

test('recovery rejects external operation paths and inconsistent quarantine', async () => {
  const f = await fixture();
  const journal = path.join(f.stateRoot, 'external.json');
  await fs.mkdir(f.stateRoot, { recursive: true });
  await fs.writeFile(journal, JSON.stringify({ version: 1, state: 'mutating', target: f.target, catalog: f.catalog, quarantine: path.join(f.targetRoot, 'expected-quarantine'), operations: [{ type: 'create', linkPath: path.join(f.targetRoot, 'alpha'), sourceDir: '/tmp/outside', status: 'done' }] }));
  await assert.rejects(() => recoverJournal({ stateRoot: f.stateRoot, journalPath: journal }), { code: 'JOURNAL_MALFORMED' });
  assert.equal(await fs.lstat(journal).then(() => true, () => false), true);

  const inconsistent = path.join(f.stateRoot, 'inconsistent.json');
  await fs.writeFile(inconsistent, JSON.stringify({ version: 1, state: 'mutating', target: f.target, catalog: f.catalog, quarantine: path.join(f.targetRoot, 'expected-quarantine'), operations: [{ type: 'quarantine', original: path.join(f.targetRoot, 'alpha'), quarantine: path.join(f.targetRoot, 'other-quarantine', 'alpha'), status: 'done' }] }));
  await assert.rejects(() => recoverJournal({ stateRoot: f.stateRoot, journalPath: inconsistent }), { code: 'JOURNAL_MALFORMED' });
});

test('create recheck detects replacement of a created symlink with the same target text', async () => {
  const f = await fixture();
  const secondDir = path.join(f.catalogRoot, 'group', 'beta');
  await fs.mkdir(secondDir, { recursive: true });
  await fs.writeFile(path.join(secondDir, 'SKILL.md'), '---\nname: beta\ndescription: test\n---\n');
  const secondStat = await fs.stat(secondDir);
  const second = { name: 'beta', relativeSource: 'group/beta', sourceDir: secondDir, skillFile: path.join(secondDir, 'SKILL.md'), sourceIdentity: { canonicalPath: await fs.realpath(secondDir), dev: secondStat.dev, ino: secondStat.ino } };
  const planSet = await buildPlanSet({ targets: [f.target], catalog: { ...f.cat, skills: [...f.cat.skills, second] }, desiredSelections: [...f.cat.skills, second] });
  assert.equal(planSet.plans[0].create.length, 2);
  const report = await applyPlanSet(planSet, { state: { stateRoot: f.stateRoot }, beforeManifest: async () => {
    const link = path.join(f.targetRoot, 'alpha');
    const text = await fs.readlink(link);
    const replacement = `${link}.replacement`;
    await fs.symlink(text, replacement, 'dir');
    await fs.unlink(link);
    await fs.rename(replacement, link);
  } });
  assert.equal(report.exitCode, 1, JSON.stringify(report));
  assert.equal(report.targets[0].failed[0].code, 'TARGET_PATH_CHANGED');
});

test('post-verification failure preserves structured mismatches without error internals', async () => {
  const f = await fixture();
  const report = await applyPlanSet(f.planSet, { state: { stateRoot: f.stateRoot }, beforeVerify: async (_plan, manifest) => {
    manifest.links = [];
  } });
  const detail = report.targets[0].failed[0];
  assert.equal(detail.code, 'POST_VERIFY_FAILED');
  assert.ok(Array.isArray(detail.mismatches));
  assert.equal(detail.mismatches[0].path.endsWith('/alpha'), true);
  assert.equal('cause' in detail, false);
  assert.doesNotThrow(() => JSON.stringify(detail));
});

test('recovery refuses an existing non-transaction directory in the target parent', async () => {
  const f = await fixture();
  const token = '33333333-3333-4333-8333-333333333333';
  const quarantine = path.join(path.dirname(f.targetRoot), `.manage-skills-quarantine-${token}`);
  const external = path.join(quarantine, 'external-content');
  await fs.mkdir(quarantine, { recursive: true });
  await fs.writeFile(external, 'must survive');
  const original = path.join(f.targetRoot, 'old');
  const journal = path.join(f.stateRoot, 'existing-directory.json');
  await fs.mkdir(f.stateRoot, { recursive: true });
  await fs.writeFile(journal, JSON.stringify({ version: 1, state: 'mutating', target: f.target, catalog: f.catalog, planFingerprint: 'test-fingerprint', oldManifest: null, quarantine, quarantineToken: token, quarantineCreated: true, operations: [{ type: 'quarantine', original, quarantine: path.join(quarantine, 'old'), status: 'done' }] }));
  await assert.rejects(() => recoverJournal({ stateRoot: f.stateRoot, journalPath: journal }), { code: 'JOURNAL_MALFORMED' });
  assert.equal(await fs.readFile(external, 'utf8'), 'must survive');
  assert.equal(await fs.lstat(journal).then(() => true, () => false), true);
});

test('recovery preserves journal and quarantine when marker is missing, wrong, or token mismatches', async () => {
  const cases = [
    ['missing-marker', null, '44444444-4444-4444-8444-444444444444'],
    ['wrong-marker', 'wrong-token', '55555555-5555-4555-8555-555555555555'],
    ['token-mismatch', '66666666-6666-4666-8666-666666666666', '77777777-7777-4777-8777-777777777777'],
  ];
  for (const [name, marker, token] of cases) {
    const f = await fixture();
    const rootToken = name === 'token-mismatch' ? '88888888-8888-4888-8888-888888888888' : token;
    const quarantineRoot = path.join(path.dirname(f.targetRoot), `.manage-skills-quarantine-${rootToken}`);
    const quarantined = path.join(quarantineRoot, 'old');
    const original = path.join(f.targetRoot, 'old');
    const journal = path.join(f.stateRoot, `${name}.json`);
    await fs.mkdir(quarantineRoot, { recursive: true });
    if (marker !== null) await fs.writeFile(path.join(quarantineRoot, '.manage-skills-quarantine-marker'), marker);
    await fs.writeFile(quarantined, 'protected');
    await fs.mkdir(f.stateRoot, { recursive: true });
    await fs.writeFile(journal, JSON.stringify({ version: 1, state: 'mutating', target: f.target, catalog: f.catalog, planFingerprint: 'test-fingerprint', oldManifest: null, quarantine: quarantineRoot, quarantineToken: token, quarantineCreated: true, operations: [{ type: 'quarantine', original, quarantine: quarantined, status: 'done' }] }));
    await assert.rejects(() => recoverJournal({ stateRoot: f.stateRoot, journalPath: journal }), { code: 'JOURNAL_MALFORMED' }, name);
    assert.equal(await fs.readFile(quarantined, 'utf8'), 'protected', name);
    assert.equal(await fs.lstat(journal).then(() => true, () => false), true, name);
  }
});

test('valid marker permits recovery and successful cleanup removes only the owned quarantine', async () => {
  const f = await fixture();
  const first = await applyPlanSet(f.planSet, { state: { stateRoot: f.stateRoot } });
  assert.equal(first.exitCode, 0);
  const manifest = await loadManifest({ stateRoot: f.stateRoot, targetIdentity: { ...f.target, catalogIdentity: f.catalog } });
  const empty = await buildPlanSet({ targets: [f.target], catalog: f.cat, desiredSelections: [], options: { disableAll: true, manifestByTarget: new Map([[f.target.canonicalPath, manifest]]) } });
  const removed = await applyPlanSet(empty, { state: { stateRoot: f.stateRoot } });
  assert.equal(removed.exitCode, 0, JSON.stringify(removed));
  assert.equal((await fs.readdir(path.dirname(f.targetRoot))).some((name) => name.startsWith('.manage-skills-quarantine-')), false);
  assert.equal(await fs.lstat(path.join(f.targetRoot, 'alpha')).catch(() => null), null);
});

test('create-only recovery does not require an unused quarantine root', async () => {
  const f = await fixture();
  const token = '99999999-9999-4999-8999-999999999999';
  const journal = path.join(f.stateRoot, 'create-only.json');
  const linkPath = path.join(f.targetRoot, 'alpha');
  await fs.symlink(f.sourceDir, linkPath, 'dir');
  await fs.mkdir(f.stateRoot, { recursive: true });
  await fs.writeFile(journal, JSON.stringify({ version: 1, state: 'mutating', target: f.target, catalog: f.catalog, planFingerprint: 'test-fingerprint', oldManifest: null, quarantine: path.join(path.dirname(f.targetRoot), `.manage-skills-quarantine-${token}`), quarantineToken: token, quarantineCreated: true, operations: [{ type: 'create', linkPath, sourceDir: f.sourceDir, status: 'done' }] }));
  const result = await recoverJournal({ stateRoot: f.stateRoot, journalPath: journal });
  assert.equal(result.recovered, true);
  assert.equal(await fs.lstat(linkPath).catch(() => null), null);
});

test('missing target is created only by apply and recovery removes only an empty owned directory', async () => {
  const f = await fixture();
  await fs.rm(f.targetRoot, { recursive: true });
  await fs.mkdir(path.dirname(f.targetRoot), { recursive: true });
  const parentStat = await fs.stat(path.dirname(f.targetRoot));
  const missingTarget = {
    path: f.targetRoot,
    canonicalPath: f.targetRoot,
    realPath: f.targetRoot,
    dev: null,
    ino: null,
    missing: true,
    parentIdentity: { canonicalPath: await fs.realpath(path.dirname(f.targetRoot)), dev: parentStat.dev, ino: parentStat.ino },
    stateRoot: f.stateRoot,
  };
  const planSet = await buildPlanSet({ targets: [missingTarget], catalog: f.cat, desiredSelections: f.cat.skills });
  const dryRun = await applyPlanSet(planSet, { state: { stateRoot: f.stateRoot }, dryRun: true });
  assert.equal(await fs.lstat(f.targetRoot).catch(() => null), null);
  assert.equal(dryRun.exitCode, 0);
  const failed = await applyPlanSet(planSet, { state: { stateRoot: f.stateRoot, failAfter: 1 } });
  assert.equal(failed.exitCode, 1);
  assert.equal((await fs.stat(f.targetRoot)).isDirectory(), true);
  const recovered = await recoverJournal({ stateRoot: f.stateRoot, journalPath: failed.targets[0].journal });
  assert.equal(recovered.recovered, true);
  assert.equal(await fs.lstat(f.targetRoot).catch(() => null), null);
});

test('missing-target recovery removes the manifest written after target creation', async () => {
  const f = await fixture();
  await fs.rm(f.targetRoot, { recursive: true });
  const parentStat = await fs.stat(path.dirname(f.targetRoot));
  const missingTarget = {
    path: f.targetRoot,
    canonicalPath: f.targetRoot,
    realPath: f.targetRoot,
    dev: null,
    ino: null,
    missing: true,
    parentIdentity: { canonicalPath: await fs.realpath(path.dirname(f.targetRoot)), dev: parentStat.dev, ino: parentStat.ino },
    stateRoot: f.stateRoot,
  };
  const planSet = await buildPlanSet({ targets: [missingTarget], catalog: f.cat, desiredSelections: f.cat.skills });
  const failed = await applyPlanSet(planSet, {
    state: { stateRoot: f.stateRoot },
    beforeVerify: async () => { throw new Error('simulated crash after manifest write'); },
  });
  assert.equal(failed.exitCode, 1);
  const journalPath = failed.targets[0].journal;
  const journal = JSON.parse(await fs.readFile(journalPath, 'utf8'));
  assert.equal(journal.manifest.target.missing, false);
  const actualManifestPath = path.join(f.stateRoot, `target-${manifestIdentity({ targetIdentity: journal.manifest.target, catalogIdentity: f.catalog }).slice(0, 32)}.json`);
  const initialMissingManifestPath = path.join(f.stateRoot, `target-${manifestIdentity({ targetIdentity: missingTarget, catalogIdentity: f.catalog }).slice(0, 32)}.json`);
  await fs.writeFile(actualManifestPath, JSON.stringify(journal.manifest));
  delete journal.manifest;
  await fs.writeFile(journalPath, JSON.stringify(journal));
  const recovered = await recoverJournal({ stateRoot: f.stateRoot, journalPath });
  assert.equal(recovered.recovered, true);
  assert.equal(await fs.lstat(path.join(f.targetRoot, 'alpha')).catch(() => null), null);
  assert.equal(await fs.lstat(f.targetRoot).catch(() => null), null);
  assert.equal(await fs.lstat(actualManifestPath).catch(() => null), null);
  assert.equal(await fs.lstat(initialMissingManifestPath).catch(() => null), null);
});

test('journal recovery rejects unknown fields and incomplete schemas', async () => {
  const f = await fixture();
  const report = await applyPlanSet(f.planSet, { state: { stateRoot: f.stateRoot, failAfter: 0 } });
  const journal = JSON.parse(await fs.readFile(report.targets[0].journal, 'utf8'));
  for (const [name, mutate] of [
    ['top-level unknown field', (value) => { value.unexpected = true; }],
    ['missing plan fingerprint', (value) => { delete value.planFingerprint; }],
    ['invalid old manifest', (value) => { value.oldManifest = {}; }],
    ['incomplete target identity', (value) => { delete value.target.ino; }],
    ['unknown operation field', (value) => { value.operations = [{ type: 'create', linkPath: path.join(f.targetRoot, 'alpha'), sourceDir: f.sourceDir, status: 'pending', unexpected: true }]; }],
    ['missing create field', (value) => { value.operations = [{ type: 'create', sourceDir: f.sourceDir, status: 'pending' }]; }],
  ]) {
    const candidate = path.join(f.stateRoot, `${name.replaceAll(' ', '-')}.json`);
    const candidateJournal = structuredClone(journal);
    mutate(candidateJournal);
    await fs.writeFile(candidate, JSON.stringify(candidateJournal));
    await assert.rejects(() => recoverJournal({ stateRoot: f.stateRoot, journalPath: candidate }), { code: 'JOURNAL_MALFORMED' }, name);
    assert.equal(await fs.lstat(candidate).then(() => true, () => false), true);
  }
});
