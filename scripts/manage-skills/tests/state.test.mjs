import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  acquireTargetLock,
  loadManifest,
  manifestIdentity,
  stateRootForTarget,
  writeManifestAtomic,
} from '../lib/state.mjs';

const tempDirs = [];

async function tempDir() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'manage-skills-state-'));
  tempDirs.push(directory);
  return directory;
}

function identities(root) {
  return {
    target: { path: path.join(root, 'skills'), realPath: path.join(root, 'skills'), dev: 1, ino: 2 },
    catalog: { path: path.join(root, 'catalog'), dev: 3, ino: 4, gitRemote: 'origin', gitCommit: 'abc123' },
  };
}

async function manifestFixture() {
  const root = await tempDir();
  const stateRoot = path.join(root, 'state');
  const ids = identities(root);
  const targetIdentity = { ...ids.target, catalogIdentity: ids.catalog };
  const manifest = {
    version: 1,
    target: ids.target,
    catalog: ids.catalog,
    links: [{
      linkName: 'one',
      sourceRelative: 'skills/one',
      sourceIdentity: { canonicalPath: path.join(root, 'catalog', 'skills', 'one'), dev: 3, ino: 9 },
      relativeTarget: '../catalog/skills/one',
      createdAt: '2026-09-22T00:00:00.000Z',
    }],
  };
  return { root, stateRoot, ids, targetIdentity, manifest };
}

test.after(async () => {
  await Promise.all(tempDirs.map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

test('state roots keep manifests outside DSH skill roots and use shared XDG roots', () => {
  const home = '/tmp/manage-skills-home';
  assert.equal(stateRootForTarget({ runtimeId: 'dsh', env: { DSH_HOME: '/tmp/dsh' }, home }), '/tmp/dsh/.manage-skills/targets');
  assert.equal(stateRootForTarget({ runtimeId: 'dsh', env: {}, home }), '/tmp/manage-skills-home/.dsh/.manage-skills/targets');
  assert.equal(stateRootForTarget({ runtimeId: 'codex', env: { XDG_STATE_HOME: '/tmp/state' }, home }), '/tmp/state/manage-skills');
  assert.equal(stateRootForTarget({ runtimeId: 'claude', env: {}, home }), '/tmp/manage-skills-home/.local/state/manage-skills');
  assert.equal(stateRootForTarget({ runtimeId: 'custom', env: { XDG_STATE_HOME: '/tmp/state' }, home }), '/tmp/state/manage-skills');
});

test('missing manifest is reported without creating target or state directories', async () => {
  const fixture = await manifestFixture();
  await assert.rejects(loadManifest(fixture), (error) => error.code === 'MANIFEST_MISSING');
  assert.equal(await fs.stat(fixture.stateRoot).catch(() => null), null);
  assert.equal(await fs.stat(fixture.ids.target.path).catch(() => null), null);
});

test('valid manifest loads and malformed or mismatched manifests are rejected', async () => {
  const fixture = await manifestFixture();
  await writeManifestAtomic(fixture);
  assert.deepEqual(await loadManifest(fixture), fixture.manifest);

  const files = await fs.readdir(fixture.stateRoot);
  const manifestPath = path.join(fixture.stateRoot, files.find((file) => file.endsWith('.json')));
  await fs.writeFile(manifestPath, '{ malformed');
  await assert.rejects(loadManifest(fixture), (error) => error.code === 'MANIFEST_MALFORMED');

  await writeManifestAtomic(fixture);
  await fs.writeFile(manifestPath, JSON.stringify({ ...fixture.manifest, catalog: { ...fixture.manifest.catalog, ino: 999 } }));
  await assert.rejects(loadManifest(fixture), (error) => error.code === 'MANIFEST_CATALOG_MISMATCH');

  await writeManifestAtomic(fixture);
  await fs.writeFile(manifestPath, JSON.stringify({ ...fixture.manifest, target: { ...fixture.manifest.target, ino: 999 } }));
  await assert.rejects(loadManifest(fixture), (error) => error.code === 'MANIFEST_TARGET_MISMATCH');
});

test('manifest writes replace atomically and leave no temporary file', async () => {
  const fixture = await manifestFixture();
  await writeManifestAtomic(fixture);
  const files = await fs.readdir(fixture.stateRoot);
  assert.equal(files.filter((file) => file.endsWith('.json')).length, 1);
  assert.equal(files.some((file) => file.includes('.tmp')), false);
  assert.equal(path.dirname(path.join(fixture.stateRoot, files[0])) !== fixture.ids.target.path, true);
});

test('manifest identity is stable and changes when catalog or target identity changes', () => {
  const first = manifestIdentity({ catalogIdentity: { path: '/catalog', dev: 1, ino: 2 }, targetIdentity: { path: '/target', dev: 3, ino: 4 } });
  assert.equal(first, manifestIdentity({ catalogIdentity: { path: '/catalog', dev: 1, ino: 2 }, targetIdentity: { path: '/target', dev: 3, ino: 4 } }));
  assert.notEqual(first, manifestIdentity({ catalogIdentity: { path: '/other', dev: 1, ino: 2 }, targetIdentity: { path: '/target', dev: 3, ino: 4 } }));
});

test('target lock is exclusive, reports owner and time, and releases without stealing stale locks', async () => {
  const fixture = await manifestFixture();
  const first = await acquireTargetLock(fixture);
  assert.equal(typeof first.owner, 'string');
  assert.equal(typeof first.acquiredAt, 'string');
  await assert.rejects(acquireTargetLock(fixture), (error) => {
    assert.equal(error.code, 'TARGET_LOCKED');
    assert.equal(error.owner, first.owner);
    assert.equal(error.acquiredAt, first.acquiredAt);
    return true;
  });
  await first.release();
  const second = await acquireTargetLock(fixture);
  await second.release();
  await assert.doesNotReject(acquireTargetLock(fixture).then((handle) => handle.release()));
});

 test('a pre-existing stale lock still fails until explicitly removed', async () => {
  const fixture = await manifestFixture();
  await fs.mkdir(fixture.stateRoot, { recursive: true });
  const lock = path.join(fixture.stateRoot, `target-${manifestIdentity({ targetIdentity: fixture.targetIdentity }).slice(0, 32)}.lock`);
  await fs.mkdir(lock);
  await fs.writeFile(path.join(lock, 'owner.json'), JSON.stringify({ owner: 'old-owner', acquiredAt: '2000-01-01T00:00:00.000Z' }));
  await assert.rejects(acquireTargetLock(fixture), (error) => error.code === 'TARGET_LOCKED' && error.owner === 'old-owner');
  await fs.rm(lock, { recursive: true });
});

test('manifest state is unavailable when state root is a file', async () => {
  const fixture = await manifestFixture();
  await fs.writeFile(fixture.stateRoot, 'not a directory');
  await assert.rejects(writeManifestAtomic(fixture), (error) => error.code === 'STATE_UNAVAILABLE' || error.code === 'ENOTDIR');
});
