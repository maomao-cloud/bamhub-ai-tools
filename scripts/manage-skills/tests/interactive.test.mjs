import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';

import { confirmPlanSet, runInteractive } from '../lib/interactive.mjs';

function scriptedIo(input) {
  const output = [];
  const stream = new Writable({ write(chunk, _encoding, callback) { output.push(String(chunk)); callback(); } });
  return {
    input: Readable.from([input]),
    output: stream,
    isTTY: false,
    text: () => output.join(''),
  };
}

function dependencies(calls) {
  return {
    catalogResolver: async () => ({ root: '/catalog', source: 'default', catalog: {
      root: '/catalog',
      skills: [
        { name: 'alpha', description: 'Alpha', relativeSource: 'alpha', sourceDir: '/catalog/alpha', sourceIdentity: { canonicalPath: '/catalog/alpha', dev: 1, ino: 1 } },
        { name: 'beta', description: 'Beta', relativeSource: 'beta', sourceDir: '/catalog/beta', sourceIdentity: { canonicalPath: '/catalog/beta', dev: 1, ino: 2 } },
      ], invalid: [], duplicates: [],
    } }),
    targetDetector: async () => [
      { id: 'dsh', label: 'DSH', path: '/home/.dsh/skills', selectable: true },
      { id: 'codex', label: 'Codex', path: '/home/.agents/skills', selectable: true },
    ],
    buildPlanSet: async ({ targets, catalog, desiredSelections, options }) => {
      calls.push({ type: 'plan', targets, catalog, desiredSelections, options });
      return { plans: targets.map((target) => ({ target, desired: desiredSelections, create: [], remove: [], keep: [], conflicts: [], protected: [] })), protected: [], conflicts: [] };
    },
    scanState: async (targets) => { calls.push({ type: 'scan', targets }); return new Map(); },
  };
}

test('wizard collects catalog, all runtimes, desired skills, previews plan, and approves without mutation hooks', async () => {
  const calls = [];
  const io = scriptedIo('y\na\na\ny\n');
  const result = await runInteractive({ ...dependencies(calls), io });

  assert.equal(result.catalogRoot, '/catalog');
  assert.deepEqual(result.targets.map((target) => target.id), ['dsh', 'codex']);
  assert.deepEqual(result.desiredSelections.map((skill) => skill.name), ['alpha', 'beta']);
  assert.equal(result.disableAll, false);
  assert.equal(calls.filter((call) => call.type === 'scan').length, 1);
  assert.equal(calls.filter((call) => call.type === 'plan').length, 1);
  assert.match(io.text(), /catalog|Plan|approve/i);
});

test('final rejection returns cancelled and never invokes a mutation dependency', async () => {
  const calls = [];
  const io = scriptedIo('y\na\na\nn\n');
  const result = await runInteractive({ ...dependencies(calls), io, mutate: async () => { throw new Error('must not run'); } });
  assert.deepEqual(result, { cancelled: true });
  assert.equal(calls.filter((call) => call.type === 'plan').length, 1);
});

test('confirmPlanSet accepts approval and rejects escape, EOF, and ctrl-c', async () => {
  const planSet = { plans: [{ target: { label: 'DSH', path: '/target' }, create: [], remove: [], keep: [], protected: [], conflicts: [] }] };
  for (const input of ['y\n', '\u001b', '']) {
    const io = scriptedIo(input);
    const approved = await confirmPlanSet(planSet, io);
    assert.equal(approved, input === 'y\n');
  }
  const ctrlC = scriptedIo('\u0003');
  assert.equal(await confirmPlanSet(planSet, ctrlC), false);
});

test('wizard surfaces dependency exceptions and still closes injected readline resources', async () => {
  const events = [];
  const io = scriptedIo('');
  io.onClose = () => events.push('close');
  await assert.rejects(() => runInteractive({
    catalogResolver: async () => { throw new Error('catalog failed'); },
    targetDetector: async () => [],
    io,
  }), /catalog failed/);
  assert.ok(events.includes('close'));
});

test('wizard never calls filesystem mutation operations before final approval', async () => {
  const calls = [];
  const io = scriptedIo('y\n1\na\nn\n');
  const deps = dependencies(calls);
  for (const name of ['mkdir', 'lock', 'manifest', 'symlink', 'quarantine', 'delete']) {
    deps[name] = async () => { throw new Error(`${name} must not be called`); };
  }
  const result = await runInteractive({ ...deps, io });
  assert.deepEqual(result, { cancelled: true });
  assert.equal(calls.some((call) => call.type === 'plan'), true);
});

// Keep the assertion above independent of Node versions lacking partialDeepStrictEqual.
// The desired selection is checked through the plan dependency below.
test('wizard passes selected skill objects to plan builder', async () => {
  const calls = [];
  const io = scriptedIo('y\n2\na\ny\n');
  await runInteractive({ ...dependencies(calls), io });
  const plan = calls.find((call) => call.type === 'plan');
  assert.deepEqual(plan.desiredSelections.map((skill) => skill.name), ['alpha', 'beta']);
  assert.deepEqual(plan.targets.map((target) => target.id), ['codex']);
});

// Avoid accidental reliance on a test-only assertion helper in the first test.
test('confirmPlanSet renders protected entries without making them selectable', async () => {
  const io = scriptedIo('y\n');
  await confirmPlanSet({ plans: [{ target: { label: 'DSH', path: '/target' }, create: [], remove: [], keep: [], conflicts: [], protected: [{ linkPath: '/target/manual', kind: 'unmanaged' }] }] }, io);
  assert.match(io.text(), /manual|protected|unmanaged/i);
});
