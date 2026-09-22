import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { access, constants } from 'node:fs/promises';
import { main } from '../manage-skills.mjs';

const root = path.resolve(new URL('..', import.meta.url).pathname, '..', '..');
const entry = path.join(root, 'scripts/manage-skills/manage-skills.mjs');
const wrapper = path.join(root, 'scripts/manage-skills/manage-skills');
const tempRoots = [];

async function fixture() {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'manage-skills-cli-')));
  tempRoots.push(dir);
  const catalog = path.join(dir, 'catalog');
  const target = path.join(dir, 'target');
  const home = path.join(dir, 'home');
  await fs.mkdir(path.join(catalog, 'group', 'alpha'), { recursive: true });
  await fs.mkdir(target, { recursive: true });
  await fs.mkdir(path.join(home, 'dsh'), { recursive: true });
  await fs.writeFile(path.join(catalog, 'group', 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: Alpha\n---\n');
  return { dir, catalog, target, home, env: { ...process.env, HOME: home, DSH_HOME: path.join(home, 'dsh'), XDG_STATE_HOME: path.join(dir, 'state') } };
}

function parsePrettyReport(output) {
  return JSON.parse(output.slice(output.indexOf('{\n  "ok"')));
}

function run(args, env = {}, command = process.execPath) {
  return new Promise((resolve) => {
    const child = spawn(command, command === process.execPath ? [entry, ...args] : args, { cwd: root, env: { ...process.env, ...env } });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function runTTY(args, env, answer) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  stdin.isTTY = true;
  stdout.isTTY = true;
  let output = ''; let errors = '';
  stdout.on('data', (chunk) => { output += chunk; });
  stderr.on('data', (chunk) => { errors += chunk; });
  const previous = {};
  for (const [key, value] of Object.entries(env)) { previous[key] = process.env[key]; process.env[key] = value; }
  try {
    const result = main(args, { stdin, stdout, stderr });
    if (Array.isArray(answer)) {
      for (const chunk of answer) await new Promise((resolve) => setTimeout(() => { stdin.write(chunk); resolve(); }, 10));
      stdin.end();
    } else stdin.end(answer);
    return { code: await result, stdout: output, stderr: errors };
  } finally {
    for (const key of Object.keys(env)) {
      if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    }
  }
}

test.after(async () => Promise.all(tempRoots.map((dir) => fs.rm(dir, { recursive: true, force: true }))));

test('rejects invalid commands with argument exit code', async () => {
  const result = await run(['wat']);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /unknown|invalid command/i);
});

test('status reports missing target and DSH_HOME fallback', async () => {
  const f = await fixture();
  const result = await run(['status', '--catalog', f.catalog, '--runtime', 'dsh', '--json'], f.env);
  assert.equal(result.code, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.targets[0].target.path, path.join(f.env.DSH_HOME, 'skills'));
  assert.equal(report.targets[0].entries[0].kind, 'target-missing');
  assert.equal(result.stderr, '');
});

test('rejects target/runtime conflict and missing desired state', async () => {
  const f = await fixture();
  const conflict = await run(['plan', '--catalog', f.catalog, '--target', f.target, '--runtime', 'dsh', '--enable', 'alpha'], f.env);
  assert.equal(conflict.code, 2);
  const missing = await run(['apply', '--catalog', f.catalog, '--runtime', 'dsh', '--non-interactive', '--yes'], f.env);
  assert.equal(missing.code, 2);
});

test('plan resolves selector alias and emits JSON only on stdout', async () => {
  const f = await fixture();
  const result = await run(['plan', '--catalog', f.catalog, '--target', f.target, '--enable', 'group/alpha=custom-alpha', '--json'], f.env);
  assert.equal(result.code, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.targets[0].plan.desired[0].linkName, 'custom-alpha');
  assert.equal(result.stdout.trim().startsWith('{'), true);
  assert.equal(result.stderr, '');
});

test('disable-all creates an empty desired plan and apply --yes mutates', async () => {
  const f = await fixture();
  const result = await run(['apply', '--catalog', f.catalog, '--target', f.target, '--disable-all', '--yes', '--json'], f.env);
  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, true);
  assert.deepEqual(report.targets[0].plan.desired, []);
});

test('non-interactive apply requires --yes', async () => {
  const f = await fixture();
  const result = await run(['apply', '--catalog', f.catalog, '--target', f.target, '--enable', 'alpha', '--non-interactive'], f.env);
  assert.equal(result.code, 2);
});

test('interactive TTY apply confirms enable plan before transaction', async () => {
  const f = await fixture();
  const approved = await runTTY(['apply', '--catalog', f.catalog, '--target', f.target, '--enable', 'alpha'], f.env, 'y');
  assert.equal(approved.code, 0, `${approved.stdout}\n${approved.stderr}`);
  assert.equal((await fs.lstat(path.join(f.target, 'alpha'))).isSymbolicLink(), true);

  const rejectedTarget = path.join(f.dir, 'rejected-target');
  await fs.mkdir(rejectedTarget);
  const rejected = await runTTY(['apply', '--catalog', f.catalog, '--target', rejectedTarget, '--disable-all'], f.env, 'n');
  assert.equal(rejected.code, 2, `${rejected.stdout}\n${rejected.stderr}`);
  await assert.rejects(fs.lstat(path.join(rejectedTarget, 'alpha')), { code: 'ENOENT' });
});

test('TTY --json rejects confirmation without mixing interactive preview into stdout', async () => {
  const f = await fixture();
  const result = await runTTY(['apply', '--catalog', f.catalog, '--target', f.target, '--enable', 'alpha', '--json'], f.env, 'y');
  assert.equal(result.code, 2);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.exitCode, 2);
  assert.equal(report.errors[0].code, 'CONFIRMATION_REQUIRED');
  assert.doesNotMatch(result.stdout, /PlanSet preview/);
});

test('default interactive maps transaction failure to exit one and retains target results', async () => {
  const f = await fixture();
  const dshSkills = path.join(f.env.DSH_HOME, 'skills');
  await fs.mkdir(dshSkills);
  await fs.writeFile(path.join(dshSkills, 'alpha'), 'protected');
  const result = await runTTY(['--catalog', f.catalog], f.env, ['y', ' ', '\r', 'a', '\r', 'y']);
  assert.equal(result.code, 1, `${result.stdout}\n${result.stderr}`);
  const report = parsePrettyReport(result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.exitCode, 1);
  assert.equal(report.targets.length, 1);
  assert.ok(report.targets[0].result.failed.length > 0);
});

test('default interactive loads manifest ownership before applying desired state', async () => {
  const f = await fixture();
  const dshSkills = path.join(f.env.DSH_HOME, 'skills');
  await fs.mkdir(dshSkills);
  const applied = await run(['apply', '--catalog', f.catalog, '--runtime', 'dsh', '--enable', 'alpha', '--yes'], f.env);
  assert.equal(applied.code, 0, `${applied.stdout}\n${applied.stderr}`);
  assert.equal((await fs.lstat(path.join(dshSkills, 'alpha'))).isSymbolicLink(), true);

  const result = await runTTY(['--catalog', f.catalog], f.env, ['y', ' ', '\r', 'n', '\r', 'y']);
  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  const report = parsePrettyReport(result.stdout);
  assert.equal(report.targets.length, 1);
  assert.ok(report.targets[0].result.applied.includes(path.join(dshSkills, 'alpha')));
  await assert.rejects(fs.lstat(path.join(dshSkills, 'alpha')), { code: 'ENOENT' });
});

test('dry-run requires exactly one desired state', async () => {
  const f = await fixture();
  const result = await run(['apply', '--catalog', f.catalog, '--target', f.target, '--dry-run'], f.env);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /desired/i);
});

test('runtime all excludes missing standard runtime directories', async () => {
  const f = await fixture();
  const missing = await run(['apply', '--catalog', f.catalog, '--runtime', 'all', '--enable', 'alpha', '--yes'], f.env);
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /target|runtime/i);

  await fs.mkdir(path.join(f.env.DSH_HOME, 'skills'));
  const existing = await run(['plan', '--catalog', f.catalog, '--runtime', 'all', '--enable', 'alpha', '--json'], f.env);
  assert.equal(existing.code, 0, existing.stderr);
  const report = JSON.parse(existing.stdout);
  assert.deepEqual(report.targets.map(({ target }) => target.id), ['dsh']);
});

test('wrapper executes status command', async () => {
  const f = await fixture();
  const result = await run(['status', '--catalog', f.catalog, '--runtime', 'dsh', '--json'], f.env, wrapper);
  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(JSON.parse(result.stdout).ok, true);
});

test('default command delegates to interactive interface', async () => {
  const f = await fixture();
  const result = await run(['--catalog', f.catalog], { ...f.env, MANAGE_SKILLS_TEST_NON_TTY: '1' });
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /interactive|selection|cancel/i);
});

test('wrapper has executable bit and valid shell syntax', async () => {
  await access(wrapper, constants.X_OK);
  const stat = await fs.stat(wrapper);
  assert.equal(stat.mode & 0o111, 0o111);
  const text = await fs.readFile(wrapper, 'utf8');
  assert.match(text, /^#!\/bin\/sh/);
});

test('operational failures map to exit code one and JSON keeps diagnostics on stderr', async () => {
  const f = await fixture();
  const result = await run(['status', '--catalog', path.join(f.dir, 'missing'), '--target', f.target, '--json'], f.env);
  assert.equal(result.code, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, false);
  assert.equal(Array.isArray(report.errors), true);
  assert.match(result.stderr, /catalog/i);
});

