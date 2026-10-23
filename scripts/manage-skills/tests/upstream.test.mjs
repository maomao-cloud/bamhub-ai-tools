import test from 'node:test';
import assert from 'node:assert/strict';
import { runUpstreamSync } from '../lib/upstream.mjs';

function fixture({ approved = true, statuses = ['update-available', 'up-to-date', 'failed'], throws = false } = {}) {
  const calls = [];
  let text = '';
  const session = { select: async () => ({ indexes: [0, 1, 2] }), confirm: async () => approved };
  const sources = { alpha: {}, beta: {}, gamma: {} };
  const sync = async (args, io) => {
    calls.push({ args, io });
    const id = args[2];
    if (throws && id === 'alpha') throw new Error('dirty target');
    return { exitCode: 0, report: { sources: { [id]: { status: args[0] === 'check' ? statuses[Object.keys(sources).indexOf(id)] : 'applied', changedFiles: ['SKILL.md'] } } } };
  };
  return { calls, session, sources, sync, io: { write: (value) => { text += value; } }, text: () => text };
}

test('upstream checks selected sources then applies only confirmed available updates', async () => {
  const f = fixture();
  const result = await runUpstreamSync({ ...f, repoRoot: '/repo' });
  assert.deepEqual(f.calls.map(({ args }) => args), [
    ['check', '--source', 'alpha'], ['check', '--source', 'beta'], ['check', '--source', 'gamma'], ['apply', '--source', 'alpha'],
  ]);
  assert.equal(result.exitCode, 1);
  assert.match(f.text(), /SKILL.md/);
  assert.ok(f.calls.every(({ io }) => io.repoRoot === '/repo'));
});

test('rejecting update preview never applies', async () => {
  const f = fixture({ approved: false });
  const result = await runUpstreamSync({ ...f, repoRoot: '/repo' });
  assert.equal(result.cancelled, true);
  assert.ok(f.calls.every(({ args }) => args[0] === 'check'));
});

test('up-to-date sources do not prompt for mutation', async () => {
  const f = fixture({ statuses: ['up-to-date', 'up-to-date', 'up-to-date'] });
  f.session.confirm = () => { throw new Error('unexpected confirmation'); };
  assert.equal((await runUpstreamSync({ ...f, repoRoot: '/repo' })).exitCode, 0);
});

test('source exceptions are reported while remaining checks continue', async () => {
  const f = fixture({ throws: true });
  const result = await runUpstreamSync({ ...f, repoRoot: '/repo' });
  assert.equal(result.exitCode, 1);
  assert.equal(f.calls.length, 3);
  assert.match(f.text(), /dirty target/);
});

test('apply failure never forces overwrite and does not block another source', async () => {
  const f = fixture({ statuses: ['update-available', 'update-available', 'up-to-date'] });
  const sync = f.sync;
  f.sync = async (args, io) => {
    if (args[0] === 'apply' && args[2] === 'alpha') {
      f.calls.push({ args, io });
      throw new Error('TARGET_DIRTY');
    }
    return sync(args, io);
  };
  const result = await runUpstreamSync({ ...f, repoRoot: '/repo' });
  assert.equal(result.exitCode, 1);
  assert.equal(result.applied.alpha.status, 'failed');
  assert.equal(result.applied.beta.status, 'applied');
  assert.ok(f.calls.every(({ args }) => !args.includes('--force')));
});

test('empty source selection performs no checks or applies', async () => {
  const f = fixture();
  f.session.select = async () => ({ indexes: [] });
  assert.equal((await runUpstreamSync({ ...f, repoRoot: '/repo' })).cancelled, true);
  assert.equal(f.calls.length, 0);
});
