import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { scanTarget } from '../lib/links.mjs';
import { buildPlanSet } from '../lib/plan.mjs';

const roots = [];

async function tempDir() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'manage-skills-links-'));
  roots.push(root);
  return root;
}

async function identity(file, extra = {}) {
  const stat = await fs.stat(file);
  return { path: file, canonicalPath: await fs.realpath(file), dev: stat.dev, ino: stat.ino, ...extra };
}

async function skill(root, relative, name = path.basename(relative)) {
  const sourceDir = path.join(root, relative);
  await fs.mkdir(sourceDir, { recursive: true });
  await fs.writeFile(path.join(sourceDir, 'SKILL.md'), `---\nname: ${name}\ndescription: test\n---\n`);
  return sourceDir;
}

async function fixture() {
  const root = await tempDir();
  const catalogRoot = path.join(root, 'catalog');
  const targetRoot = path.join(root, 'target');
  await fs.mkdir(catalogRoot);
  await fs.mkdir(targetRoot);
  const sourceDir = await skill(catalogRoot, 'group/alpha', 'alpha');
  const otherSource = await skill(catalogRoot, 'group/beta', 'beta');
  const targetIdentity = await identity(targetRoot);
  const catalogIdentity = await identity(catalogRoot, { gitCommit: 'abc' });
  const catalog = { root: catalogRoot, skills: [
    { name: 'alpha', relativeSource: 'group/alpha', sourceDir, sourceIdentity: await identity(sourceDir) },
    { name: 'beta', relativeSource: 'group/beta', sourceDir: otherSource, sourceIdentity: await identity(otherSource) },
  ] };
  return { root, catalogRoot, targetRoot, targetIdentity, catalogIdentity, catalog };
}

function manifestFor({ targetIdentity, catalogIdentity, links }) {
  return { version: 1, target: targetIdentity, catalog: catalogIdentity, links };
}

function entryFor({ linkName, sourceRelative, relativeTarget, sourceIdentity }) {
  return { linkName, sourceRelative, relativeTarget, sourceIdentity, createdAt: new Date(0).toISOString() };
}

test.after(async () => {
  await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })));
});

test('scanTarget classifies owned valid and broken links, unmanaged links, foreign links, files, dirs, and missing target', async () => {
  const f = await fixture();
  const ownedSource = path.join(f.catalogRoot, 'group/alpha');
  const ownedPath = path.join(f.targetRoot, 'alpha');
  const brokenPath = path.join(f.targetRoot, 'broken');
  const unmanagedPath = path.join(f.targetRoot, 'unmanaged');
  const foreignPath = path.join(f.targetRoot, 'foreign');
  await fs.symlink(ownedSource, ownedPath, 'dir');
  await fs.symlink('../catalog/missing', brokenPath, 'dir');
  await fs.symlink(path.join(f.catalogRoot, 'group/beta'), unmanagedPath, 'dir');
  await fs.symlink(path.join(f.root, 'outside'), foreignPath, 'dir');
  await fs.writeFile(path.join(f.targetRoot, 'regular-file'), 'x');
  await fs.mkdir(path.join(f.targetRoot, 'regular-dir'));
  const manifest = manifestFor({
    targetIdentity: f.targetIdentity,
    catalogIdentity: f.catalogIdentity,
    links: [
      entryFor({ linkName: 'alpha', sourceRelative: 'group/alpha', relativeTarget: '../catalog/group/alpha', sourceIdentity: await identity(ownedSource) }),
      entryFor({ linkName: 'broken', sourceRelative: 'group/alpha', relativeTarget: '../catalog/missing', sourceIdentity: await identity(ownedSource) }),
    ],
  });

  const states = await scanTarget({ targetIdentity: f.targetIdentity, catalog: f.catalog, manifest });
  const byName = new Map(states.map((state) => [path.basename(state.linkPath), state]));
  assert.equal(byName.get('alpha').kind, 'managed-valid');
  assert.equal(byName.get('broken').kind, 'managed-broken');
  assert.equal(byName.get('unmanaged').kind, 'unmanaged-symlink');
  assert.equal(byName.get('foreign').kind, 'foreign-symlink');
  assert.equal(byName.get('regular-file').kind, 'regular-file');
  assert.equal(byName.get('regular-dir').kind, 'regular-directory');
  assert.equal(byName.get('alpha').manifestEntry.linkName, 'alpha');
  assert.ok(byName.get('broken').manifestEntry);
  assert.equal(states.filter((state) => ['managed-valid', 'managed-broken'].includes(state.kind)).length, 2);
  assert.deepEqual((await scanTarget({ targetIdentity: { ...f.targetIdentity, path: path.join(f.root, 'missing-target'), canonicalPath: path.join(f.root, 'missing-target'), dev: 0, ino: 0 }, catalog: f.catalog, manifest })).map((state) => state.kind), ['target-missing']);
});

test('catalog prefix collision does not make a foreign target managed', async () => {
  const f = await fixture();
  const outside = path.join(f.root, 'catalog-other', 'group', 'alpha');
  await fs.mkdir(outside, { recursive: true });
  const linkPath = path.join(f.targetRoot, 'alpha');
  await fs.symlink(outside, linkPath, 'dir');
  const states = await scanTarget({ targetIdentity: f.targetIdentity, catalog: f.catalog, manifest: undefined });
  assert.equal(states[0].kind, 'foreign-symlink');
  assert.match(states[0].reason, /catalog|outside|foreign/i);
});

test('buildPlanSet creates, keeps, and removes only manifest-owned matched links', async () => {
  const f = await fixture();
  const alpha = path.join(f.catalogRoot, 'group/alpha');
  const alphaPath = path.join(f.targetRoot, 'alpha');
  const stalePath = path.join(f.targetRoot, 'beta');
  await fs.symlink(alpha, alphaPath, 'dir');
  await fs.symlink(path.join(f.catalogRoot, 'group/beta'), stalePath, 'dir');
  const manifest = manifestFor({ targetIdentity: f.targetIdentity, catalogIdentity: f.catalogIdentity, links: [
    entryFor({ linkName: 'alpha', sourceRelative: 'group/alpha', relativeTarget: '../catalog/group/alpha', sourceIdentity: await identity(alpha) }),
    entryFor({ linkName: 'beta', sourceRelative: 'group/beta', relativeTarget: '../catalog/group/beta', sourceIdentity: await identity(path.join(f.catalogRoot, 'group/beta')) }),
  ] });
  const selections = [{ ...f.catalog.skills[0], linkName: 'alpha', sourceRelative: 'group/alpha' }];
  const result = await buildPlanSet({ targets: [{ ...f.targetIdentity, id: 'one' }], catalog: f.catalog, desiredSelections: selections, options: { manifestByTarget: new Map([[f.targetIdentity.canonicalPath, manifest]]) } });
  const plan = result.plans[0];
  assert.equal(plan.create.length, 0);
  assert.equal(plan.keep.length, 1);
  assert.equal(plan.remove.length, 1);
  assert.equal(path.basename(plan.remove[0].linkPath), 'beta');
  assert.equal(result.protected.length, 0);
});

test('buildPlanSet rejects duplicate selectors and alias collisions, manifest mismatch, and missing desired state', async () => {
  const f = await fixture();
  const target = { ...f.targetIdentity, id: 'one' };
  const options = { manifestByTarget: new Map([[f.targetIdentity.canonicalPath, manifestFor({ targetIdentity: f.targetIdentity, catalogIdentity: f.catalogIdentity, links: [] })]]) };
  const alpha = { ...f.catalog.skills[0], sourceRelative: 'group/alpha', linkName: 'same' };
  await assert.rejects(() => buildPlanSet({ targets: [target], catalog: f.catalog, desiredSelections: [alpha, alpha], options }), { code: 'DUPLICATE_SELECTOR' });
  await assert.rejects(() => buildPlanSet({ targets: [target], catalog: f.catalog, desiredSelections: [alpha, { ...f.catalog.skills[1], sourceRelative: 'group/beta', linkName: 'same' }], options }), { code: 'ALIAS_COLLISION' });
  await assert.rejects(() => buildPlanSet({ targets: [target], catalog: f.catalog, desiredSelections: [], options: { ...options, manifestByTarget: new Map([[f.targetIdentity.canonicalPath, { ...options.manifestByTarget.get(f.targetIdentity.canonicalPath), catalog: { ...f.catalogIdentity, ino: f.catalogIdentity.ino + 1 } }]]) } }), { code: 'MANIFEST_CATALOG_MISMATCH' });
  await assert.rejects(() => buildPlanSet({ targets: [target], catalog: f.catalog, options }), { code: 'DESIRED_STATE_REQUIRED' });
});

test('disable-all yields empty final desired state and multiple targets remain independent', async () => {
  const f = await fixture();
  const second = path.join(f.root, 'second');
  await fs.mkdir(second);
  const secondIdentity = await identity(second);
  const manifests = new Map([
    [f.targetIdentity.canonicalPath, manifestFor({ targetIdentity: f.targetIdentity, catalogIdentity: f.catalogIdentity, links: [] })],
    [secondIdentity.canonicalPath, manifestFor({ targetIdentity: secondIdentity, catalogIdentity: f.catalogIdentity, links: [] })],
  ]);
  const result = await buildPlanSet({
    targets: [{ ...f.targetIdentity, id: 'one' }, { ...secondIdentity, id: 'two' }],
    catalog: f.catalog,
    desiredSelections: [],
    options: { disableAll: true, manifestByTarget: manifests },
  });
  assert.equal(result.plans.length, 2);
  assert.deepEqual(result.plans.map((plan) => plan.desired), [[], []]);
  assert.deepEqual(result.plans.map((plan) => plan.target.id), ['one', 'two']);
});

test('--enable is final desired set, not additive mode', async () => {
  const f = await fixture();
  const beta = path.join(f.catalogRoot, 'group/beta');
  await fs.symlink(beta, path.join(f.targetRoot, 'beta'), 'dir');
  const manifest = manifestFor({ targetIdentity: f.targetIdentity, catalogIdentity: f.catalogIdentity, links: [
    entryFor({ linkName: 'beta', sourceRelative: 'group/beta', relativeTarget: '../catalog/group/beta', sourceIdentity: await identity(beta) }),
  ] });
  const result = await buildPlanSet({
    targets: [{ ...f.targetIdentity, id: 'one' }], catalog: f.catalog,
    desiredSelections: [{ ...f.catalog.skills[0], sourceRelative: 'group/alpha', linkName: 'alpha' }],
    options: { manifestByTarget: new Map([[f.targetIdentity.canonicalPath, manifest]]) },
  });
  assert.deepEqual(result.plans[0].desired.map((item) => item.linkName), ['alpha']);
  assert.equal(result.plans[0].remove[0].linkPath, path.join(f.targetRoot, 'beta'));
});

test('regular files and foreign links are protected and never removable', async () => {
  const f = await fixture();
  await fs.writeFile(path.join(f.targetRoot, 'alpha'), 'not a link');
  await fs.symlink(path.join(f.root, 'outside'), path.join(f.targetRoot, 'foreign'), 'dir');
  const result = await buildPlanSet({ targets: [{ ...f.targetIdentity, id: 'one' }], catalog: f.catalog, desiredSelections: [], options: { disableAll: true, manifestByTarget: new Map([[f.targetIdentity.canonicalPath, manifestFor({ targetIdentity: f.targetIdentity, catalogIdentity: f.catalogIdentity, links: [] })]]) } });
  assert.equal(result.plans[0].remove.length, 0);
  assert.equal(result.plans[0].protected.length, 2);
});
