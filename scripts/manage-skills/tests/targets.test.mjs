import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  detectRuntimeTargets,
  resolveTargetSelection,
  validateTarget,
} from '../lib/targets.mjs';

const tempDirs = [];

async function tempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'manage-skills-targets-'));
  const realDir = await fs.realpath(dir);
  tempDirs.push(dir);
  return realDir;
}

async function assertTargetRejected(options, reason) {
  await assert.rejects(validateTarget(options), (error) => {
    assert.equal(error.code, 'UNSAFE_TARGET');
    assert.match(error.message, new RegExp(reason, 'i'));
    return true;
  });
}

test.after(async () => {
  await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

test('detectRuntimeTargets resolves DSH, fallback DSH, Codex, and Claude roots without creating them', async () => {
  const root = await tempDir();
  const home = path.join(root, 'home');
  const dshHome = path.join(root, 'dsh');
  await fs.mkdir(home, { recursive: true });
  const explicit = await detectRuntimeTargets({ env: { DSH_HOME: dshHome }, home });
  assert.deepEqual(explicit.map(({ id, path: targetPath, source }) => ({ id, path: targetPath, source })), [
    { id: 'dsh', path: path.join(dshHome, 'skills'), source: 'DSH_HOME' },
    { id: 'codex', path: path.join(home, '.agents', 'skills'), source: 'HOME' },
    { id: 'claude', path: path.join(home, '.claude', 'skills'), source: 'HOME' },
  ]);
  assert.ok(explicit.every((target) => target.selectable === true && target.exists === false));
  assert.equal(await fs.stat(path.join(dshHome, 'skills')).catch(() => null), null);

  const fallback = await detectRuntimeTargets({ env: {}, home });
  assert.equal(fallback[0].path, path.join(home, '.dsh', 'skills'));
  assert.equal(fallback[0].source, 'DSH_HOME-fallback');
});

test('detectRuntimeTargets marks existing directories and rejects existing files', async () => {
  const root = await tempDir();
  const home = path.join(root, 'home');
  await fs.mkdir(path.join(home, '.agents', 'skills'), { recursive: true });
  await fs.mkdir(home, { recursive: true });
  await fs.writeFile(path.join(home, '.claude'), 'not a directory');
  const targets = await detectRuntimeTargets({ env: {}, home });
  assert.equal(targets.find((target) => target.id === 'codex').exists, true);
  assert.equal(targets.find((target) => target.id === 'codex').selectable, true);
  assert.equal(targets.find((target) => target.id === 'claude').exists, false);
  assert.equal(targets.find((target) => target.id === 'claude').selectable, false);
});

test('validateTarget returns identity for a missing final directory under a safe global parent', async () => {
  const root = await tempDir();
  const catalog = path.join(root, 'catalog');
  const parent = path.join(root, 'global');
  await fs.mkdir(catalog, { recursive: true });
  await fs.mkdir(parent, { recursive: true });
  const target = path.join(parent, 'skills');
  const identity = await validateTarget({ targetPath: target, catalogRoot: catalog, mode: 'custom' });
  assert.equal(identity.path, target);
  assert.equal(identity.realPath, target);
  assert.equal(identity.existed, false);
  assert.equal(typeof identity.stateRoot, 'string');
  assert.equal(await fs.stat(target).catch(() => null), null);
});

test('validateTarget rejects catalog overlap in either direction', async () => {
  const root = await tempDir();
  const catalog = path.join(root, 'catalog');
  await fs.mkdir(path.join(catalog, 'nested'), { recursive: true });
  await assertTargetRejected({ targetPath: catalog, catalogRoot: catalog, mode: 'custom' }, 'catalog');
  await assertTargetRejected({ targetPath: path.join(catalog, 'nested'), catalogRoot: catalog, mode: 'custom' }, 'catalog');
  await assertTargetRejected({ targetPath: root, catalogRoot: catalog, mode: 'custom' }, 'catalog');
});

test('validateTarget rejects project targets, Git worktree targets, symlink ancestors, and unsafe shapes', async () => {
  const root = await tempDir();
  const catalog = path.join(root, 'catalog');
  await fs.mkdir(catalog, { recursive: true });

  const project = path.join(root, 'project');
  await fs.mkdir(path.join(project, '.git'), { recursive: true });
  await assertTargetRejected({ targetPath: path.join(project, 'global'), catalogRoot: catalog, mode: 'custom' }, 'git');
  await assertTargetRejected({ targetPath: path.join(project, '.agents', 'skills'), catalogRoot: catalog, mode: 'custom' }, 'project');
  await assertTargetRejected({ targetPath: path.join(project, '.claude', 'skills'), catalogRoot: catalog, mode: 'custom' }, 'project');

  const realParent = path.join(root, 'real-parent');
  const linkParent = path.join(root, 'link-parent');
  await fs.mkdir(realParent, { recursive: true });
  await fs.symlink(realParent, linkParent, 'dir');
  await assertTargetRejected({ targetPath: path.join(linkParent, 'skills'), catalogRoot: catalog, mode: 'custom' }, 'symlink');

  const fileTarget = path.join(root, 'file-target');
  await fs.writeFile(fileTarget, 'file');
  await assertTargetRejected({ targetPath: fileTarget, catalogRoot: catalog, mode: 'custom' }, 'directory');
  await assertTargetRejected({ targetPath: path.join(root, 'missing', 'skills'), catalogRoot: catalog, mode: 'custom' }, 'parent');
});

test('resolveTargetSelection supports custom targets, repeated runtimes, all, and conflict guard', async () => {
  const runtimes = [
    { id: 'dsh', label: 'DSH', path: '/dsh/skills', source: 'DSH_HOME', exists: false, selectable: true },
    { id: 'codex', label: 'Codex', path: '/codex/skills', source: 'HOME', exists: true, selectable: true },
    { id: 'claude', label: 'Claude Code', path: '/claude/skills', source: 'HOME', exists: false, selectable: true },
  ];
  const selected = await resolveTargetSelection({ runtimes, selectedIds: ['codex', 'codex', 'dsh'] });
  assert.deepEqual(selected.map(({ id }) => id), ['codex', 'dsh']);
  const all = await resolveTargetSelection({ runtimes, selectedIds: ['all'] });
  assert.deepEqual(all.map(({ id }) => id), ['dsh', 'codex', 'claude']);
  const custom = await resolveTargetSelection({ runtimes, customPath: '/custom/skills' });
  assert.deepEqual(custom, [{ id: 'custom', label: 'Custom', path: '/custom/skills', source: 'custom', exists: false, selectable: true }]);
  await assert.rejects(resolveTargetSelection({ runtimes, customPath: '/custom/skills', selectedIds: ['dsh'] }), /mutually exclusive|conflict/i);
});

test('resolveTargetSelection rejects unknown and non-selectable runtime ids', async () => {
  const runtimes = [{ id: 'dsh', label: 'DSH', path: '/dsh/skills', source: 'DSH_HOME', exists: false, selectable: false }];
  await assert.rejects(resolveTargetSelection({ runtimes, selectedIds: ['missing'] }), /unknown/i);
  await assert.rejects(resolveTargetSelection({ runtimes, selectedIds: ['dsh'] }), /selectable/i);
});

