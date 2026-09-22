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
    target: { path: path.join(root, 'skills'), canonicalPath: path.join(root, 'skills'), dev: 1, ino: 2 },
    catalog: { path: path.join(root, 'catalog'), canonicalPath: path.join(root, 'catalog'), dev: 3, ino: 4, gitRemote: 'origin', gitCommit: 'abc123' },
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
  const first = manifestIdentity({ catalogIdentity: { path: '/catalog', canonicalPath: '/catalog', dev: 1, ino: 2 }, targetIdentity: { path: '/target', canonicalPath: '/target', dev: 3, ino: 4 } });
  assert.equal(first, manifestIdentity({ catalogIdentity: { path: '/catalog', canonicalPath: '/catalog', dev: 1, ino: 2 }, targetIdentity: { path: '/target', canonicalPath: '/target', dev: 3, ino: 4 } }));
  assert.notEqual(first, manifestIdentity({ catalogIdentity: { path: '/other', canonicalPath: '/other', dev: 1, ino: 2 }, targetIdentity: { path: '/target', canonicalPath: '/target', dev: 3, ino: 4 } }));
});

test('target lock is exclusive, reports owner and time, and releases without stealing stale locks', async () => {
  const fixture = await manifestFixture();
  const first = await acquireTargetLock(fixture);
  assert.equal(typeof first.owner, 'string');
  assert.equal(typeof first.token, 'string');
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
  await fs.writeFile(path.join(lock, 'owner.json'), JSON.stringify({ owner: 'old-owner', token: 'old-token', acquiredAt: '2000-01-01T00:00:00.000Z' }));
  await assert.rejects(acquireTargetLock(fixture), (error) => error.code === 'TARGET_LOCKED' && error.owner === 'old-owner');
  await fs.rm(lock, { recursive: true });
});

test('manifest state is unavailable when state root is a file', async () => {
  const fixture = await manifestFixture();
  await fs.writeFile(fixture.stateRoot, 'not a directory');
  await assert.rejects(loadManifest(fixture), (error) => error.code === 'STATE_UNAVAILABLE');
  await assert.rejects(acquireTargetLock(fixture), (error) => error.code === 'STATE_UNAVAILABLE');
  await assert.rejects(writeManifestAtomic(fixture), (error) => error.code === 'STATE_UNAVAILABLE');
});

test('manifest schema rejects missing or invalid identities, links, versions, and git metadata', async () => {
  const fixture = await manifestFixture();
  await writeManifestAtomic(fixture);
  const files = await fs.readdir(fixture.stateRoot);
  const manifestPath = path.join(fixture.stateRoot, files.find((file) => file.endsWith('.json')));
  const invalid = [
    { ...fixture.manifest, version: 2 },
    { ...fixture.manifest, futureField: true },
    { ...fixture.manifest, target: { ...fixture.manifest.target, canonicalPath: undefined } },
    { ...fixture.manifest, target: { ...fixture.manifest.target, futureField: true } },
    { ...fixture.manifest, catalog: { ...fixture.manifest.catalog, ino: 1.5 } },
    { ...fixture.manifest, catalog: { ...fixture.manifest.catalog, futureField: true } },
    { ...fixture.manifest, catalog: { ...fixture.manifest.catalog, gitCommit: 42 } },
    { ...fixture.manifest, links: [{ ...fixture.manifest.links[0], createdAt: undefined }] },
    { ...fixture.manifest, links: [{ ...fixture.manifest.links[0], futureField: true }] },
    { ...fixture.manifest, links: [{ ...fixture.manifest.links[0], sourceIdentity: { canonicalPath: '/x', dev: 1 } }] },
    { ...fixture.manifest, links: [{ ...fixture.manifest.links[0], sourceIdentity: { canonicalPath: '/x', dev: 1, futureField: true } }] },
  ];
  for (const manifest of invalid) {
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    await assert.rejects(loadManifest(fixture), (error) => error.code === 'MANIFEST_MALFORMED');
  }
});

test('manifest identity rejects non-plain JSON and incomplete identities', () => {
  assert.throws(() => manifestIdentity({ targetIdentity: { path: '/target', canonicalPath: '/target', dev: 1, ino: 2 }, catalogIdentity: { path: '/catalog', canonicalPath: '/catalog', dev: 1, ino: 2, extra: new Date() } }), (error) => error.code === 'IDENTITY_INVALID');
  assert.throws(() => manifestIdentity({ targetIdentity: { path: '/target', dev: 1, ino: 2 }, catalogIdentity: { path: '/catalog', canonicalPath: '/catalog', dev: 1, ino: 2 } }), (error) => error.code === 'IDENTITY_INVALID');
});

test('lock release never removes a replacement lock installed after token validation', async () => {
  const fixture = await manifestFixture();
  const first = await acquireTargetLock(fixture);
  const originalReadFile = fs.readFile;
  const originalRm = fs.rm;
  let replaced = false;
  const replacement = { owner: 'new-owner', token: 'new-token', acquiredAt: '2026-09-22T00:00:00.000Z' };
  const replacementPath = `${first.path}.replacement`;
  await fs.mkdir(replacementPath);
  await fs.writeFile(path.join(replacementPath, 'owner.json'), JSON.stringify(replacement));
  fs.readFile = async (...args) => {
    const result = await originalReadFile(...args);
    if (!replaced && args[0] === path.join(first.path, 'owner.json')) {
      replaced = true;
      await originalRm(first.path, { recursive: true, force: false });
      await fs.rename(replacementPath, first.path);
    }
    return result;
  };
  try {
    await assert.rejects(first.release(), (error) => error.code === 'LOCK_OWNERSHIP_CHANGED' && error.owner === replacement.owner && error.acquiredAt === replacement.acquiredAt);
  } finally {
    fs.readFile = originalReadFile;
  }
  assert.equal((await fs.readFile(path.join(first.path, 'owner.json'), 'utf8')).includes(replacement.token), true);
  await fs.rm(first.path, { recursive: true });
});

test('lock release never removes a lock with a different token', async () => {
  const fixture = await manifestFixture();
  const first = await acquireTargetLock(fixture);
  const lockMetadata = path.join(first.path, 'owner.json');
  const replacement = { owner: 'new-owner', token: 'new-token', acquiredAt: '2026-09-22T00:00:00.000Z' };
  await fs.writeFile(lockMetadata, JSON.stringify(replacement));
  await assert.rejects(first.release(), (error) => error.code === 'TARGET_LOCKED' && error.owner === replacement.owner && error.acquiredAt === replacement.acquiredAt);
  assert.equal((await fs.stat(first.path)).isDirectory(), true);
  await fs.rm(first.path, { recursive: true });
});

test('corrupt or missing lock metadata is diagnosed without undefined details', async () => {
  const fixture = await manifestFixture();
  const first = await acquireTargetLock(fixture);
  await fs.rm(path.join(first.path, 'owner.json'));
  await assert.rejects(acquireTargetLock(fixture), (error) => error.code === 'LOCK_METADATA_INVALID' && !('owner' in error) && !('acquiredAt' in error));
  await assert.rejects(first.release(), (error) => error.code === 'LOCK_METADATA_INVALID' && !('owner' in error) && !('acquiredAt' in error));
  await fs.rm(first.path, { recursive: true });
});
