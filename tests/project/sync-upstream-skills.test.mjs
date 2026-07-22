import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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

async function git(cwd, ...args) {
  await execFileAsync('git', args, { cwd });
}

async function write(root, relativePath, content) {
  const filePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
}

async function readManifest(repoRoot) {
  return JSON.parse(await fs.readFile(path.join(repoRoot, 'skills/sources.json'), 'utf8'));
}

async function snapshot(root) {
  const entries = await fs.readdir(root, { recursive: true, withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.parentPath
    ? path.relative(root, path.join(entry.parentPath, entry.name))
    : entry.name).sort();
  return Object.fromEntries(await Promise.all(files.map(async (relativePath) => [
    relativePath,
    await fs.readFile(path.join(root, relativePath), 'utf8')
  ])));
}

function skill(name, description = `${name} skill`) {
  return `---\nname: ${name}\ndescription: ${description}\n---\n`;
}
