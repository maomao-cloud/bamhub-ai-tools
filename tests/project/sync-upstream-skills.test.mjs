import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { runCli } from '../../skills/project/sync-upstream-skills/scripts/sync-skills.mjs';

const execFileAsync = promisify(execFile);
const syncScript = fileURLToPath(new URL('../../skills/project/sync-upstream-skills/scripts/sync-skills.mjs', import.meta.url));

test('check reports a source update without changing its target or manifest', async (t) => {
  const fixture = await createFixture({ sourceFiles: { 'skills/demo/SKILL.md': skill('demo') } });
  t.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));
  const before = await snapshot(fixture.repoRoot);

  const result = await runCli(['check', '--source', 'demo'], fixture);

  assert.equal(result.exitCode, 0);
  assert.equal(result.report.sources.demo.status, 'update-available');
  assert.deepEqual(await snapshot(fixture.repoRoot), before);
});

test('invalid root fails only that source and writes nothing for it', async (t) => {
  const fixture = await createFixture({ sourceFiles: { 'other/file.txt': 'x' } });
  t.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));
  await fs.mkdir(path.join(fixture.repoRoot, 'empty-sentinel'));
  await fs.symlink('missing-sentinel', path.join(fixture.repoRoot, 'symlink-sentinel'));
  const before = await snapshot(fixture.repoRoot);

  const result = await runCli(['check', '--source', 'demo'], fixture);

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.sources.demo.status, 'failed');
  assert.match(result.report.sources.demo.error, /contains no SKILL\.md/);
  assert.deepEqual(await snapshot(fixture.repoRoot), before);
});

test('invalid source state fails only that source and writes nothing for it', async (t) => {
  const fixture = await createFixture({ sourceFiles: { 'skills/demo/SKILL.md': skill('demo') } });
  t.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));
  const manifest = await readManifest(fixture.repoRoot);
  manifest.sources.demo.acceptedCommit = 42;
  manifest.sources.demo.acceptedAt = null;
  await write(fixture.repoRoot, 'skills/sources.json', JSON.stringify(manifest, null, 2) + '\n');
  const before = await snapshot(fixture.repoRoot);

  const result = await runCli(['check', '--source', 'demo'], fixture);

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.sources.demo.status, 'failed');
  assert.match(result.report.sources.demo.error, /invalid configuration/);
  assert.deepEqual(await snapshot(fixture.repoRoot), before);
});

test('colliding root targets fail without writes', async (t) => {
  const fixture = await createFixture({ sourceFiles: { 'skills/demo/SKILL.md': skill('demo') } });
  t.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));
  const manifest = await readManifest(fixture.repoRoot);
  manifest.sources.demo.roots.push({ upstream: 'skills/demo', target: 'skills/demo-source' });
  await write(fixture.repoRoot, 'skills/sources.json', JSON.stringify(manifest, null, 2) + '\n');
  const before = await snapshot(fixture.repoRoot);

  const result = await runCli(['check', '--source', 'demo'], fixture);

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.sources.demo.status, 'failed');
  assert.match(result.report.sources.demo.error, /target collides/);
  assert.deepEqual(await snapshot(fixture.repoRoot), before);
});

test('--all isolates sources with a shared target from unrelated sources', async (t) => {
  const fixture = await createFixture({ sourceFiles: { 'skills/demo/SKILL.md': skill('demo') } });
  t.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));
  const manifest = await readManifest(fixture.repoRoot);
  manifest.sources.duplicate = {
    ...manifest.sources.demo,
    roots: [{ upstream: 'skills/demo', target: 'skills/demo-source' }]
  };
  manifest.sources.healthy = {
    ...manifest.sources.demo,
    roots: [{ upstream: 'skills', target: 'skills/healthy-source' }]
  };
  await write(fixture.repoRoot, 'skills/sources.json', JSON.stringify(manifest, null, 2) + '\n');
  const before = await snapshot(fixture.repoRoot);

  const result = await runCli(['check', '--all'], fixture);

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.sources.demo.status, 'failed');
  assert.equal(result.report.sources.duplicate.status, 'failed');
  assert.equal(result.report.sources.healthy.status, 'update-available');
  assert.deepEqual(await snapshot(fixture.repoRoot), before);
});

test('--all continues checking a healthy source after another source fails', async (t) => {
  const fixture = await createFixture({ sourceFiles: { 'skills/demo/SKILL.md': skill('demo'), 'other/file.txt': 'x' } });
  t.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));
  const manifest = await readManifest(fixture.repoRoot);
  manifest.sources.demo.roots[0].upstream = 'other';
  manifest.sources.healthy = {
    ...manifest.sources.demo,
    roots: [{ upstream: 'skills', target: 'skills/healthy-source' }]
  };
  await write(fixture.repoRoot, 'skills/sources.json', JSON.stringify(manifest, null, 2) + '\n');
  const before = await snapshot(fixture.repoRoot);

  const result = await runCli(['check', '--all'], fixture);

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.sources.demo.status, 'failed');
  assert.equal(result.report.sources.healthy.status, 'update-available');
  assert.deepEqual(await snapshot(fixture.repoRoot), before);
});

test('conflicting source selectors are rejected as a typed error', async (t) => {
  const fixture = await createFixture({ sourceFiles: { 'skills/demo/SKILL.md': skill('demo') } });
  t.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));

  await assert.rejects(
    () => runCli(['check', '--all', '--source', 'demo'], fixture),
    (error) => error.code === 'SOURCE_SELECTOR_CONFLICT'
  );
});

test('the executable CLI emits a JSON typed error for an unknown source', async (t) => {
  const fixture = await createFixture({ sourceFiles: { 'skills/demo/SKILL.md': skill('demo') } });
  t.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));

  await assert.rejects(
    () => execFileAsync('node', [syncScript, 'check', '--source', 'unknown'], { cwd: fixture.repoRoot }),
    (error) => {
      assert.equal(error.code, 1);
      assert.deepEqual(JSON.parse(error.stdout), {
        error: { code: 'SOURCE_UNKNOWN', message: 'unknown' }
      });
      return true;
    }
  );
});

test('an upstream root may be the repository root', async (t) => {
  const fixture = await createFixture({ sourceFiles: { 'SKILL.md': skill('root') } });
  t.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));
  const manifest = await readManifest(fixture.repoRoot);
  manifest.sources.demo.roots[0].upstream = '.';
  await write(fixture.repoRoot, 'skills/sources.json', JSON.stringify(manifest, null, 2) + '\n');

  const result = await runCli(['check', '--source', 'demo'], fixture);

  assert.equal(result.exitCode, 0);
  assert.equal(result.report.sources.demo.status, 'update-available');
});

test('target paths outside the repository fail without writes', async (t) => {
  const fixture = await createFixture({ sourceFiles: { 'skills/demo/SKILL.md': skill('demo') } });
  t.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));
  const manifest = await readManifest(fixture.repoRoot);
  manifest.sources.demo.roots[0].target = '../outside-repository';
  await write(fixture.repoRoot, 'skills/sources.json', JSON.stringify(manifest, null, 2) + '\n');
  const before = await snapshot(fixture.repoRoot);

  const result = await runCli(['check', '--source', 'demo'], fixture);

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.sources.demo.status, 'failed');
  assert.match(result.report.sources.demo.error, /target must stay within the repository/);
  assert.deepEqual(await snapshot(fixture.repoRoot), before);
});

test('apply replaces only configured roots and writes a deterministic README', async (t) => {
  const fixture = await createFixture({ sourceFiles: {
    'skills/demo/SKILL.md': skill('demo', 'Demo skill'),
    'hooks/pre-commit': 'must not copy\n'
  } });
  t.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));

  const result = await runCli(['apply', '--source', 'demo'], fixture);

  assert.equal(result.exitCode, 0);
  assert.equal(result.report.sources.demo.status, 'applied');
  assert.equal(await read(fixture.repoRoot, 'skills/demo-source/demo/SKILL.md'), skill('demo', 'Demo skill'));
  assert.match(await read(fixture.repoRoot, 'skills/demo-source/README.md'), /Demo skill/);
  assert.match(await read(fixture.repoRoot, 'skills/demo-source/README.md'), /Last successful sync/);
  assert.match(await read(fixture.repoRoot, 'skills/demo-source/README.md'), /Changed files: `A skills\/demo\/SKILL\.md`/);
  assert.equal(await exists(fixture.repoRoot, 'hooks/pre-commit'), false);
});

test('apply rejects a dirty target unless --force is explicit', async (t) => {
  const fixture = await appliedFixture();
  t.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));
  await write(fixture.repoRoot, 'skills/demo-source/demo/SKILL.md', 'local change');

  await assert.rejects(
    () => runCli(['apply', '--source', 'demo'], fixture),
    (error) => error.code === 'TARGET_DIRTY'
  );
  const result = await runCli(['apply', '--source', 'demo', '--force'], fixture);

  assert.equal(result.exitCode, 0);
  assert.equal(await read(fixture.repoRoot, 'skills/demo-source/demo/SKILL.md'), skill('demo'));
});

test('apply accepts a target that still matches its accepted source', async (t) => {
  const fixture = await appliedFixture();
  t.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));

  const result = await runCli(['apply', '--source', 'demo'], fixture);

  assert.equal(result.exitCode, 0);
  assert.equal(result.report.sources.demo.status, 'applied');
});

test('apply rejects a locally edited generated README unless --force is explicit', async (t) => {
  const fixture = await appliedFixture();
  t.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));
  await write(fixture.repoRoot, 'skills/demo-source/README.md', 'local README change\n');

  await assert.rejects(
    () => runCli(['apply', '--source', 'demo'], fixture),
    (error) => error.code === 'TARGET_DIRTY'
  );
  await runCli(['apply', '--source', 'demo', '--force'], fixture);
});

test('apply rejects a README edit with a recomputed trailing checksum', async (t) => {
  const fixture = await appliedFixture();
  t.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));
  const original = await read(fixture.repoRoot, 'skills/demo-source/README.md');
  const marker = original.match(/<!-- bamhub-sync-digest: [a-f0-9]{64} -->\n$/);
  assert.ok(marker && marker.index !== undefined);
  const changedBody = original.slice(0, marker.index).replace('# Demo skills', '# Locally changed skills');
  await write(
    fixture.repoRoot,
    'skills/demo-source/README.md',
    `${changedBody}<!-- bamhub-sync-digest: ${createHash('sha256').update(changedBody).digest('hex')} -->\n`
  );

  await assert.rejects(
    () => runCli(['apply', '--source', 'demo'], fixture),
    (error) => error.code === 'TARGET_DIRTY'
  );
});

test('apply rejects executable-bit changes unless --force is explicit', async (t) => {
  const fixture = await appliedFixture();
  t.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));
  await fs.chmod(path.join(fixture.repoRoot, 'skills/demo-source/demo/SKILL.md'), 0o755);

  await assert.rejects(
    () => runCli(['apply', '--source', 'demo'], fixture),
    (error) => error.code === 'TARGET_DIRTY'
  );
  await runCli(['apply', '--source', 'demo', '--force'], fixture);
});

test('--all continues applying a healthy source after another source fails', async (t) => {
  const fixture = await twoSourceFixture({ brokenRoot: true });
  t.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));

  const result = await runCli(['apply', '--all'], fixture);

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.sources.broken.status, 'failed');
  assert.equal(result.report.sources.healthy.status, 'applied');
  assert.equal(await exists(fixture.repoRoot, 'skills/healthy-source/README.md'), true);
});

test('apply includes a nonempty Markdown summary file in the README', async (t) => {
  const fixture = await createFixture({ sourceFiles: { 'skills/demo/SKILL.md': skill('demo') } });
  t.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));
  await write(fixture.repoRoot, 'reports/demo-summary.md', 'A human-readable update summary.\n');

  await runCli(['apply', '--source', 'demo', '--summary-file', 'reports/demo-summary.md'], fixture);

  const readme = await read(fixture.repoRoot, 'skills/demo-source/README.md');
  assert.match(readme, /## Update summary\n\nA human-readable update summary\./);
});

test('apply accepts an unchanged target when given the same summary file', async (t) => {
  const fixture = await createFixture({ sourceFiles: { 'skills/demo/SKILL.md': skill('demo') } });
  t.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));
  await write(fixture.repoRoot, 'reports/demo-summary.md', 'A human-readable update summary.\n');

  await runCli(['apply', '--source', 'demo', '--summary-file', 'reports/demo-summary.md'], fixture);
  const result = await runCli(['apply', '--source', 'demo', '--summary-file', 'reports/demo-summary.md'], fixture);

  assert.equal(result.exitCode, 0);
  assert.equal(result.report.sources.demo.status, 'applied');
});

test('apply falls back to a deterministic changed-file list when the summary is unavailable', async (t) => {
  const fixture = await createFixture({ sourceFiles: { 'skills/demo/SKILL.md': skill('demo') } });
  t.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));

  const result = await runCli(['apply', '--source', 'demo', '--summary-file', 'reports/missing.md'], fixture);

  assert.deepEqual(result.report.sources.demo.changedFiles, ['A skills/demo/SKILL.md']);
  assert.match(await read(fixture.repoRoot, 'skills/demo-source/README.md'), /Changed files: `A skills\/demo\/SKILL\.md`/);
});

test('apply changes only accepted state fields for its successful source', async (t) => {
  const fixture = await createFixture({ sourceFiles: { 'skills/demo/SKILL.md': skill('demo') } });
  t.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));
  const before = await readManifest(fixture.repoRoot);
  const result = await runCli(['apply', '--source', 'demo'], {
    ...fixture,
    now: () => new Date('2026-07-22T00:00:00.000Z')
  });
  const after = await readManifest(fixture.repoRoot);

  assert.equal(result.exitCode, 0);
  assert.deepEqual(Object.keys(after.sources.demo).sort(), Object.keys(before.sources.demo).sort());
  assert.equal(after.sources.demo.acceptedCommit, result.report.sources.demo.targetCommit);
  assert.equal(after.sources.demo.acceptedAt, '2026-07-22T00:00:00.000Z');
  for (const key of Object.keys(before.sources.demo)) {
    if (!['acceptedCommit', 'acceptedAt'].includes(key)) {
      assert.deepEqual(after.sources.demo[key], before.sources.demo[key]);
    }
  }
});

test('a failed manifest write cannot advance a later --all manifest update', async (t) => {
  const fixture = await twoHealthySourceFixture();
  t.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));
  const before = await readManifest(fixture.repoRoot);
  let writeAttempts = 0;

  const result = await runCli(['apply', '--all'], {
    ...fixture,
    async writeManifest(repoRoot, manifest) {
      writeAttempts += 1;
      if (writeAttempts === 1) throw new Error('manifest write failed');
      await write(repoRoot, 'skills/sources.json', JSON.stringify(manifest, null, 2) + '\n');
    }
  });
  const after = await readManifest(fixture.repoRoot);

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.sources.failed.status, 'failed');
  assert.equal(result.report.sources.healthy.status, 'applied');
  assert.deepEqual(after.sources.failed, before.sources.failed);
  assert.notEqual(after.sources.healthy.acceptedCommit, before.sources.healthy.acceptedCommit);
  assert.equal(await exists(fixture.repoRoot, 'skills/failed-source'), false);
});

test('an upstream root with a target README fails without writes', async (t) => {
  const fixture = await createFixture({ sourceFiles: {
    'skills/README.md': 'upstream metadata\n',
    'skills/demo/SKILL.md': skill('demo')
  } });
  t.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));
  const before = await snapshot(fixture.repoRoot);

  const result = await runCli(['apply', '--source', 'demo'], fixture);

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.sources.demo.status, 'failed');
  assert.match(result.report.sources.demo.error, /contains README\.md/);
  assert.deepEqual(await snapshot(fixture.repoRoot), before);
});

test('nested root targets fail without writes', async (t) => {
  const fixture = await createFixture({ sourceFiles: {
    'skills/demo/SKILL.md': skill('demo'),
    'skills/other/SKILL.md': skill('other')
  } });
  t.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));
  const manifest = await readManifest(fixture.repoRoot);
  manifest.sources.demo.roots.push({ upstream: 'skills/other', target: 'skills/demo-source/other' });
  await write(fixture.repoRoot, 'skills/sources.json', JSON.stringify(manifest, null, 2) + '\n');
  const before = await snapshot(fixture.repoRoot);

  const result = await runCli(['apply', '--source', 'demo'], fixture);

  assert.equal(result.exitCode, 1);
  assert.match(result.report.sources.demo.error, /target collides/);
  assert.deepEqual(await snapshot(fixture.repoRoot), before);
});

test('--all rejects nested source targets while preserving unrelated sources', async (t) => {
  const fixture = await createFixture({ sourceFiles: {
    'skills/demo/SKILL.md': skill('demo'),
    'skills/other/SKILL.md': skill('other')
  } });
  t.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));
  const manifest = await readManifest(fixture.repoRoot);
  manifest.sources.nested = {
    ...manifest.sources.demo,
    roots: [{ upstream: 'skills/other', target: 'skills/demo-source/nested' }]
  };
  manifest.sources.healthy = {
    ...manifest.sources.demo,
    roots: [{ upstream: 'skills/other', target: 'skills/healthy-source' }]
  };
  await write(fixture.repoRoot, 'skills/sources.json', JSON.stringify(manifest, null, 2) + '\n');

  const result = await runCli(['apply', '--all'], fixture);

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.sources.demo.status, 'failed');
  assert.equal(result.report.sources.nested.status, 'failed');
  assert.equal(result.report.sources.healthy.status, 'applied');
});

test('a selected source cannot overwrite an unselected nested target', async (t) => {
  const fixture = await createFixture({ sourceFiles: {
    'skills/demo/SKILL.md': skill('demo'),
    'skills/other/SKILL.md': skill('other')
  } });
  t.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));
  const manifest = await readManifest(fixture.repoRoot);
  manifest.sources.child = {
    ...manifest.sources.demo,
    roots: [{ upstream: 'skills/other', target: 'skills/demo-source/child' }]
  };
  await write(fixture.repoRoot, 'skills/sources.json', JSON.stringify(manifest, null, 2) + '\n');

  const result = await runCli(['apply', '--source', 'demo', '--force'], fixture);

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.sources.demo.status, 'failed');
  assert.match(result.report.sources.demo.error, /target collides/);
  assert.equal(await exists(fixture.repoRoot, 'skills/demo-source'), false);
});

test('failed replacement preparation removes directories created for a configured target', async (t) => {
  const fixture = await createFixture({ sourceFiles: {
    'skills/demo/SKILL.md': skill('demo'),
    'skills/other/SKILL.md': skill('other')
  } });
  t.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));
  const manifest = await readManifest(fixture.repoRoot);
  manifest.sources.demo.roots[0].target = 'created-parent/demo-source';
  manifest.sources.demo.roots.push({ upstream: 'skills/other', target: 'blocked-parent/child' });
  await write(fixture.repoRoot, 'blocked-parent', 'not a directory\n');
  await write(fixture.repoRoot, 'skills/sources.json', JSON.stringify(manifest, null, 2) + '\n');
  const before = await snapshot(fixture.repoRoot);

  const result = await runCli(['apply', '--source', 'demo'], fixture);

  assert.equal(result.exitCode, 1);
  assert.deepEqual(await snapshot(fixture.repoRoot), before);
});

async function createFixture({ sourceFiles }) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'bamhub-sync-test-'));
  const repoRoot = path.join(tempRoot, 'consumer');
  const sourceRoot = path.join(tempRoot, 'upstream');
  await fs.mkdir(repoRoot, { recursive: true });
  await fs.mkdir(sourceRoot, { recursive: true });

  for (const [relativePath, content] of Object.entries(sourceFiles)) {
    await write(sourceRoot, relativePath, content);
  }

  await git(sourceRoot, 'init', '-b', 'main');
  await git(sourceRoot, 'config', 'user.email', 'tests@example.com');
  await git(sourceRoot, 'config', 'user.name', 'Sync tests');
  await git(sourceRoot, 'add', '.');
  await git(sourceRoot, 'commit', '-m', 'fixture source');

  await write(repoRoot, 'skills/sources.json', JSON.stringify({
    version: 1,
    sources: {
      demo: {
        repository: `file://${sourceRoot}`,
        ref: 'main',
        acceptedCommit: '0000000000000000000000000000000000000000',
        acceptedAt: '2026-07-21T00:00:00Z',
        roots: [{ upstream: 'skills', target: 'skills/demo-source' }]
      }
    }
  }, null, 2) + '\n');

  return {
    repoRoot,
    tempRoot,
    stdout: { write() {} },
    stderr: { write() {} }
  };
}

async function appliedFixture() {
  const fixture = await createFixture({ sourceFiles: { 'skills/demo/SKILL.md': skill('demo') } });
  await runCli(['apply', '--source', 'demo'], fixture);
  return fixture;
}

async function twoSourceFixture({ brokenRoot }) {
  const fixture = await createFixture({ sourceFiles: {
    'skills/demo/SKILL.md': skill('demo'),
    'skills/healthy/SKILL.md': skill('healthy')
  } });
  const manifest = await readManifest(fixture.repoRoot);
  manifest.sources.broken = {
    ...manifest.sources.demo,
    roots: [{ upstream: brokenRoot ? 'missing' : 'skills/demo', target: 'skills/broken-source' }]
  };
  manifest.sources.healthy = {
    ...manifest.sources.demo,
    roots: [{ upstream: 'skills/healthy', target: 'skills/healthy-source' }]
  };
  delete manifest.sources.demo;
  await write(fixture.repoRoot, 'skills/sources.json', JSON.stringify(manifest, null, 2) + '\n');
  return fixture;
}

async function twoHealthySourceFixture() {
  const fixture = await createFixture({ sourceFiles: {
    'skills/failed/SKILL.md': skill('failed'),
    'skills/healthy/SKILL.md': skill('healthy')
  } });
  const manifest = await readManifest(fixture.repoRoot);
  manifest.sources.failed = {
    ...manifest.sources.demo,
    roots: [{ upstream: 'skills/failed', target: 'skills/failed-source' }]
  };
  manifest.sources.healthy = {
    ...manifest.sources.demo,
    roots: [{ upstream: 'skills/healthy', target: 'skills/healthy-source' }]
  };
  delete manifest.sources.demo;
  await write(fixture.repoRoot, 'skills/sources.json', JSON.stringify(manifest, null, 2) + '\n');
  return fixture;
}

async function git(cwd, ...args) {
  await execFileAsync('git', args, { cwd });
}

async function write(root, relativePath, content) {
  const filePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
}

async function read(root, relativePath) {
  return fs.readFile(path.join(root, relativePath), 'utf8');
}

async function exists(root, relativePath) {
  try {
    await fs.lstat(path.join(root, relativePath));
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') return false;
    throw error;
  }
}

async function readManifest(repoRoot) {
  return JSON.parse(await fs.readFile(path.join(repoRoot, 'skills/sources.json'), 'utf8'));
}

async function snapshot(root) {
  const entries = {};
  await snapshotPath(root, '', entries);
  return entries;
}

async function snapshotPath(root, relativePath, entries) {
  const absolutePath = path.join(root, relativePath);
  const stat = await fs.lstat(absolutePath);
  if (stat.isSymbolicLink()) {
    entries[relativePath] = { type: 'symlink', target: await fs.readlink(absolutePath) };
    return;
  }
  if (stat.isFile()) {
    entries[relativePath] = { type: 'file', content: await fs.readFile(absolutePath, 'utf8') };
    return;
  }
  if (!stat.isDirectory()) return;

  if (relativePath) entries[relativePath] = { type: 'directory' };
  const names = (await fs.readdir(absolutePath)).sort();
  for (const name of names) await snapshotPath(root, path.join(relativePath, name), entries);
}

function skill(name, description = `${name} skill`) {
  return `---\nname: ${name}\ndescription: ${description}\n---\n`;
}
