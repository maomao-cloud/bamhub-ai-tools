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
const METADATA_START = '<!-- bamhub-sync-metadata:start -->';
const METADATA_END = '<!-- bamhub-sync-metadata:end -->';
const CONTENT_START = '<!-- bamhub-sync-content:start -->';
const CONTENT_END = '<!-- bamhub-sync-content:end -->';

test('Superpowers target contains only managed skills and its generated README', async () => {
  const root = path.resolve(import.meta.dirname, '../..');
  const entries = (await fs.readdir(path.join(root, 'skills/superpowers'))).sort();

  assert.ok(entries.includes('README.md'));
  assert.ok(entries.includes('brainstorming'));
  assert.ok(entries.includes('test-driven-development'));
  assert.equal(entries.filter((entry) => entry !== 'README.md').length, 14);
  assert.equal(await exists(root, 'skills/superpowers/.claude-plugin'), false);
  assert.equal(await exists(root, 'skills/superpowers/hooks'), false);
  const readme = await read(root, 'skills/superpowers/README.md');
  const manifest = JSON.parse(await read(root, 'skills/sources.json'));
  assertManagedReadmeContract(readme, manifest.sources.superpowers);
});

test('Caveman target contains the complete managed skill set and generated README', async () => {
  const root = path.resolve(import.meta.dirname, '../..');
  const entries = (await fs.readdir(path.join(root, 'skills/caveman'))).sort();
  const manifest = JSON.parse(await read(root, 'skills/sources.json'));
  const source = manifest.sources.caveman;
  const skills = [
    'cavecrew',
    'caveman',
    'caveman-commit',
    'caveman-compress',
    'caveman-help',
    'caveman-review',
    'caveman-stats'
  ];

  assert.deepEqual(entries, ['README.md', ...skills]);
  assert.deepEqual(source, {
    repository: 'https://github.com/JuliusBrussee/caveman.git',
    ref: 'main',
    acceptedCommit: '0d95a81d35a9f2d123a5e9430d1cfc43d55f1bb0',
    acceptedAt: '2026-07-22T10:04:11.489Z',
    roots: [{ upstream: 'skills', target: 'skills/caveman' }]
  });
  for (const skill of skills) {
    assert.equal(await exists(root, `skills/caveman/${skill}/SKILL.md`), true, skill);
  }
  for (const excluded of [
    '.claude-plugin',
    'agents',
    'benchmarks',
    'commands',
    'hooks',
    'install.sh',
    'integrations',
    'plugins'
  ]) {
    assert.equal(await exists(root, `skills/caveman/${excluded}`), false, excluded);
  }
  const readme = await read(root, 'skills/caveman/README.md');
  assertManagedReadmeContract(readme, source);
});

function assertManagedReadmeContract(readme, source) {
  assert.match(readme, new RegExp(`来源: ${source.repository}`));
  assert.match(readme, new RegExp(`跟踪引用: ${source.ref}`));
  assert.match(readme, new RegExp(`已接受提交: ${source.acceptedCommit}`));
  assert.match(readme, new RegExp(`上次成功同步: ${source.acceptedAt}`));
  assert.match(readme, /<!-- bamhub-sync-metadata:start -->/);
  assert.match(readme, /<!-- bamhub-sync-metadata:end -->/);
  assert.match(readme, /<!-- bamhub-sync-content:start -->/);
  assert.match(readme, /<!-- bamhub-sync-content:end -->/);
  assert.doesNotMatch(readme, /## 使用方法|## 适用场景|## 通用流程/);
}

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

test('apply rejects the removed summary-file option', async (t) => {
  const fixture = await createFixture({ sourceFiles: { 'skills/demo/SKILL.md': skill('demo') } });
  t.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));

  await assert.rejects(
    () => runCli(['apply', '--source', 'demo', '--summary-file', 'report.md'], fixture),
    (error) => error.code === 'OPTION_UNKNOWN'
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

test('a configured upstream root symlink fails without repository writes', async (t) => {
  const fixture = await createFixture({
    sourceFiles: { 'real-skills/demo/SKILL.md': skill('demo') },
    sourceLinks: { skills: 'real-skills' }
  });
  t.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));
  const before = await snapshot(fixture.repoRoot);

  const result = await runCli(['apply', '--source', 'demo'], fixture);

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.sources.demo.status, 'failed');
  assert.match(result.report.sources.demo.error, /root.*symbolic link/i);
  assert.deepEqual(await snapshot(fixture.repoRoot), before);
});

test('an escaping nested upstream symlink fails without repository writes', async (t) => {
  const fixture = await createFixture({
    sourceFiles: {
      'skills/demo/SKILL.md': skill('demo'),
      'outside/private.txt': 'must not be staged\n'
    },
    sourceLinks: { 'skills/demo/escape': '../../outside' }
  });
  t.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));
  const before = await snapshot(fixture.repoRoot);

  const result = await runCli(['apply', '--source', 'demo'], fixture);

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.sources.demo.status, 'failed');
  assert.match(result.report.sources.demo.error, /symbolic link.*configured root/i);
  assert.deepEqual(await snapshot(fixture.repoRoot), before);
});

test('--all isolates an escaping upstream symlink from a healthy source', async (t) => {
  const fixture = await createFixture({
    sourceFiles: {
      'skills/broken/SKILL.md': skill('broken'),
      'skills/healthy/SKILL.md': skill('healthy'),
      'outside/private.txt': 'must not be staged\n'
    },
    sourceLinks: { 'skills/broken/escape': '../../outside' }
  });
  t.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));
  const manifest = await readManifest(fixture.repoRoot);
  manifest.sources.broken = {
    ...manifest.sources.demo,
    roots: [{ upstream: 'skills/broken', target: 'skills/broken-source' }]
  };
  manifest.sources.healthy = {
    ...manifest.sources.demo,
    roots: [{ upstream: 'skills/healthy', target: 'skills/healthy-source' }]
  };
  delete manifest.sources.demo;
  await write(fixture.repoRoot, 'skills/sources.json', JSON.stringify(manifest, null, 2) + '\n');
  const before = await readManifest(fixture.repoRoot);

  const result = await runCli(['apply', '--all'], fixture);
  const after = await readManifest(fixture.repoRoot);

  assert.equal(result.exitCode, 1);
  assert.equal(result.report.sources.broken.status, 'failed');
  assert.equal(result.report.sources.healthy.status, 'applied');
  assert.deepEqual(after.sources.broken, before.sources.broken);
  assert.equal(await exists(fixture.repoRoot, 'skills/broken-source'), false);
  assert.equal(await exists(fixture.repoRoot, 'skills/healthy-source/README.md'), true);
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

test('apply replaces only configured roots and writes metadata with empty managed content', async (t) => {
  const fixture = await createFixture({ sourceFiles: {
    'skills/demo/SKILL.md': skill('demo', 'Demo skill'),
    'hooks/pre-commit': 'must not copy\n'
  } });
  t.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));

  const result = await runCli(['apply', '--source', 'demo'], fixture);

  assert.equal(result.exitCode, 0);
  assert.equal(result.report.sources.demo.status, 'applied');
  assert.equal(await read(fixture.repoRoot, 'skills/demo-source/demo/SKILL.md'), skill('demo', 'Demo skill'));
  const readme = await read(fixture.repoRoot, 'skills/demo-source/README.md');
  assert.equal(
    contentBetween(readme, METADATA_START, METADATA_END),
    `来源: file://${fixture.sourceRoot}\n跟踪引用: main\n已接受提交: ${result.report.sources.demo.targetCommit}\n上次成功同步: ${await acceptedAt(fixture.repoRoot, 'demo')}\n`
  );
  assert.equal(contentBetween(readme, CONTENT_START, CONTENT_END), '');
  assert.doesNotMatch(readme, /## 使用方法|## 适用场景|## 通用流程|请阅读/);
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
  assert.equal(result.report.sources.demo.status, 'up-to-date');
});

test('apply --all is a true no-op for a clean accepted source', async (t) => {
  const fixture = await appliedFixture();
  t.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));
  const before = await snapshot(fixture.repoRoot);

  const result = await runCli(['apply', '--all'], {
    ...fixture,
    now() {
      throw new Error('clean sources must not request a new acceptedAt value');
    }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.report.sources.demo.status, 'up-to-date');
  assert.deepEqual(await snapshot(fixture.repoRoot), before);
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

test('apply preserves valid managed content across an upstream update', async (t) => {
  const fixture = await appliedFixture();
  t.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));
  const original = await read(fixture.repoRoot, 'skills/demo-source/README.md');
  const content = '## 真实说明\n\n只在这个块中保留。\n';
  await write(
    fixture.repoRoot,
    'skills/demo-source/README.md',
    original.replace(`${CONTENT_START}\n${CONTENT_END}`, `${CONTENT_START}\n${content}${CONTENT_END}`)
  );
  await write(fixture.sourceRoot, 'skills/demo/SKILL.md', skill('demo', 'Updated upstream skill'));
  await git(fixture.sourceRoot, 'add', 'skills/demo/SKILL.md');
  await git(fixture.sourceRoot, 'commit', '-m', 'fixture update');

  const result = await runCli(['apply', '--source', 'demo'], fixture);

  assert.equal(result.exitCode, 0);
  assert.equal(contentBetween(await read(fixture.repoRoot, 'skills/demo-source/README.md'), CONTENT_START, CONTENT_END), content);
});

test('apply rejects a changed managed metadata line', async (t) => {
  const fixture = await appliedFixture();
  t.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));
  const original = await read(fixture.repoRoot, 'skills/demo-source/README.md');
  assert.match(original, new RegExp(METADATA_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  await write(
    fixture.repoRoot,
    'skills/demo-source/README.md',
    original.replace('跟踪引用: main', '跟踪引用: changed')
  );

  await assert.rejects(
    () => runCli(['apply', '--source', 'demo'], fixture),
    (error) => error.code === 'TARGET_DIRTY'
  );
});

test('apply migrates an exact legacy generated README without --force', async (t) => {
  const fixture = await appliedFixture();
  t.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));
  const source = (await readManifest(fixture.repoRoot)).sources.demo;
  await write(
    fixture.repoRoot,
    'skills/demo-source/README.md',
    legacyReadme({ sourceId: 'demo', source, targetCommit: source.acceptedCommit, acceptedAt: source.acceptedAt, skills: ['demo'] })
  );

  const result = await runCli(['apply', '--source', 'demo'], fixture);
  const readme = await read(fixture.repoRoot, 'skills/demo-source/README.md');

  assert.equal(result.exitCode, 0);
  assert.equal(result.report.sources.demo.status, 'applied');
  assert.equal((await readManifest(fixture.repoRoot)).sources.demo.acceptedAt, source.acceptedAt);
  assert.match(readme, new RegExp(`上次成功同步: ${source.acceptedAt}`));
  assert.equal(contentBetween(readme, CONTENT_START, CONTENT_END), '');
  assert.doesNotMatch(readme, /## 使用方法|## 适用场景|## 通用流程|请阅读/);
});

test('apply migrates a localized legacy Superpowers README without --force', async (t) => {
  const fixture = await createFixture({ sourceFiles: {
    'skills/brainstorming/SKILL.md': skill('brainstorming')
  } });
  t.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));
  const manifest = await readManifest(fixture.repoRoot);
  manifest.sources.superpowers = manifest.sources.demo;
  delete manifest.sources.demo;
  await write(fixture.repoRoot, 'skills/sources.json', JSON.stringify(manifest, null, 2) + '\n');
  await runCli(['apply', '--source', 'superpowers'], fixture);
  const source = (await readManifest(fixture.repoRoot)).sources.superpowers;
  await write(
    fixture.repoRoot,
    'skills/demo-source/README.md',
    legacyReadme({ sourceId: 'superpowers', source, targetCommit: source.acceptedCommit, acceptedAt: source.acceptedAt, skills: ['brainstorming'] })
  );

  const result = await runCli(['apply', '--source', 'superpowers'], fixture);

  assert.equal(result.exitCode, 0);
  assert.equal(result.report.sources.superpowers.status, 'applied');
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

test('apply reports actual added modified and deleted upstream files in JSON', async (t) => {
  const fixture = await createFixture({ sourceFiles: {
    'skills/demo/SKILL.md': skill('demo', 'Original skill'),
    'skills/demo/obsolete.txt': 'obsolete\n'
  } });
  t.after(() => fs.rm(fixture.tempRoot, { recursive: true, force: true }));
  await runCli(['apply', '--source', 'demo'], fixture);
  await write(fixture.sourceRoot, 'skills/demo/SKILL.md', skill('demo', 'Updated skill'));
  await write(fixture.sourceRoot, 'skills/demo/new.txt', 'new\n');
  await fs.rm(path.join(fixture.sourceRoot, 'skills/demo/obsolete.txt'));
  await git(fixture.sourceRoot, 'add', '-A');
  await git(fixture.sourceRoot, 'commit', '-m', 'fixture update');

  const result = await runCli(['apply', '--source', 'demo'], fixture);

  assert.deepEqual(result.report.sources.demo.changedFiles, [
    'A skills/demo/new.txt',
    'D skills/demo/obsolete.txt',
    'M skills/demo/SKILL.md'
  ]);
  const readme = await read(fixture.repoRoot, 'skills/demo-source/README.md');
  assert.doesNotMatch(readme, /## 通用流程/);
  assert.doesNotMatch(readme, /Changed files:/);
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

async function createFixture({ sourceFiles, sourceLinks = {} }) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'bamhub-sync-test-'));
  const repoRoot = path.join(tempRoot, 'consumer');
  const sourceRoot = path.join(tempRoot, 'upstream');
  await fs.mkdir(repoRoot, { recursive: true });
  await fs.mkdir(sourceRoot, { recursive: true });

  for (const [relativePath, content] of Object.entries(sourceFiles)) {
    await write(sourceRoot, relativePath, content);
  }
  for (const [relativePath, target] of Object.entries(sourceLinks)) {
    const linkPath = path.join(sourceRoot, relativePath);
    await fs.mkdir(path.dirname(linkPath), { recursive: true });
    await fs.symlink(target, linkPath);
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
    sourceRoot,
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

async function acceptedAt(repoRoot, sourceId) {
  return (await readManifest(repoRoot)).sources[sourceId].acceptedAt;
}

function contentBetween(readme, start, end) {
  const startIndex = readme.indexOf(start);
  const endIndex = readme.indexOf(end);
  assert.notEqual(startIndex, -1, `missing ${start}`);
  assert.notEqual(endIndex, -1, `missing ${end}`);
  return readme.slice(startIndex + start.length + 1, endIndex);
}

function legacyReadme({ sourceId, source, targetCommit, acceptedAt, skills }) {
  const sourceTitle = sourceId.split(/[-_]/).map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : '').join(' ');
  const availableSkills = skills.map((name) => `- \`${name}\` — ${legacySkillDescription(sourceId, name)}`).join('\n');
  const body = `# ${sourceTitle} 技能\n\n来源: ${source.repository}\n跟踪引用: ${source.ref}\n已接受提交: ${targetCommit}\n上次成功同步: ${acceptedAt}\n\n## 使用方法\n\n从下方选择匹配的 skill，阅读完整 \`SKILL.md\` 与其引用的本地资源，再按说明执行。\n\n## 适用场景\n\n${availableSkills}\n\n## 通用流程\n\n1. 选择与请求匹配的 skill。\n2. 阅读其 \`SKILL.md\` 和引用资源。\n3. 按流程执行，并运行其要求的验证。\n`;
  return `${body}<!-- bamhub-sync-digest: ${createHash('sha256').update(body).digest('hex')} -->\n`;
}

function legacySkillDescription(sourceId, name) {
  if (sourceId === 'superpowers' && name === 'brainstorming') {
    return '在开始实现前梳理需求、方案和验收标准。';
  }
  return `请阅读 \`${name}/SKILL.md\` 获取完整用法。`;
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
