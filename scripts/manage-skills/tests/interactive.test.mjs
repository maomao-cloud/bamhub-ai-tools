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

function catalog() {
  return {
    root: '/catalog',
    skills: [
      { name: 'alpha', description: 'Alpha', relativeSource: 'alpha', sourceDir: '/catalog/alpha', sourceIdentity: { canonicalPath: '/catalog/alpha', dev: 1, ino: 1 } },
      { name: 'beta', description: 'Beta', relativeSource: 'beta', sourceDir: '/catalog/beta', sourceIdentity: { canonicalPath: '/catalog/beta', dev: 1, ino: 2 } },
    ], invalid: [], duplicates: [],
  };
}

function dependencies(calls) {
  return {
    catalogResolver: async () => ({ root: '/catalog', source: 'default', catalog: catalog() }),
    discoverCatalog: async ({ catalogRoot, resolution }) => { calls.push({ type: 'discover', catalogRoot, resolution }); return catalog(); },
    scanValidSkills: async ({ catalog: value, catalogRoot }) => { calls.push({ type: 'valid-scan', catalog: value, catalogRoot }); return value.skills; },
    targetDetector: async () => [
      { id: 'dsh', label: 'DSH', path: '/home/.dsh/skills', selectable: true },
      { id: 'codex', label: 'Codex', path: '/home/.agents/skills', selectable: true },
    ],
    buildPlanSet: async ({ targets, catalog: value, desiredSelections, options }) => {
      calls.push({ type: 'plan', targets, catalog: value, desiredSelections, options });
      return { plans: targets.map((target) => ({ target, desired: desiredSelections, create: [], remove: [], keep: [], conflicts: [], protected: [] })), protected: [], conflicts: [] };
    },
    scanState: async (targets) => { calls.push({ type: 'scan', targets }); return new Map(); },
  };
}

test('missing catalog prompts for an interactive path and re-resolves it in nonTTY mode', async () => {
  const calls = [];
  const io = scriptedIo('/catalog-recovered\ny\na\na\ny\n');
  await runInteractive({
    ...dependencies(calls),
    io,
    catalogResolver: async (options = {}) => (typeof options === 'string' ? { root: '/catalog-recovered' } : { root: '/missing', missing: true }),
  });
  assert.match(io.text(), /catalog path|path/i);
  assert.ok(calls.some((call) => call.type === 'discover' && call.catalogRoot === '/catalog-recovered'));
});

test('missing catalog uses injected line input in TTY mode', async () => {
  const calls = [];
  const { io, input } = fakeTtyIo();
  const prompts = [];
  io.line = async (prompt) => { prompts.push(prompt); return '/catalog-recovered'; };
  const promise = runInteractive({
    ...dependencies(calls),
    io,
    catalogResolver: async (options = {}) => (typeof options === 'string' ? { root: '/catalog-recovered' } : { root: '/missing', missing: true }),
  });
  for (const chunk of ['y', 'a', '\r', 'a', '\r', 'y']) {
    await new Promise((resolve) => setImmediate(resolve));
    input.emit('data', chunk);
  }
  const result = await promise;
  assert.equal(result.catalogRoot, '/catalog-recovered');
  assert.ok(prompts.length > 0);
});

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

test('empty runtime selection prompts again instead of cancelling', async () => {
  const calls = [];
  const io = scriptedIo('y\nn\n1\na\ny\n');
  const result = await runInteractive({ ...dependencies(calls), io });

  assert.equal(result.cancelled, undefined);
  assert.deepEqual(result.targets.map((target) => target.id), ['dsh']);
  assert.match(io.text(), /at least one|select.*runtime/i);
});

test('skill menu shows each skill source path after its name', async () => {
  const io = scriptedIo('y\na\na\nn\n');
  const result = await runInteractive({ ...dependencies([]), io });

  assert.deepEqual(result, { cancelled: true });
  assert.match(io.text(), /alpha \(alpha\)/);
  assert.match(io.text(), /beta \(beta\)/);
  assert.doesNotMatch(io.text(), /alpha \(alpha\/SKILL\.md\)/);
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
test('confirmPlanSet renders every real Plan field and entry field without dropping data', async () => {
  const io = scriptedIo('y\n');
  await confirmPlanSet({
    plans: [{
      target: {
        id: 'dsh', label: 'DSH', path: '/target', canonicalPath: '/target', dev: 10, ino: 11,
      },
      catalog: {
        path: '/catalog', canonicalPath: '/catalog', dev: 20, ino: 21, gitRemote: 'https://example.test/catalog.git', gitCommit: 'abc123',
      },
      desired: [{
        name: 'new', sourceRelative: 'skills/new', linkName: 'new', sourceDir: '/catalog/new',
        sourceIdentity: { canonicalPath: '/catalog/new', dev: 1, ino: 2 },
      }],
      create: [{
        linkPath: '/target/new', sourceDir: '/catalog/new', relativeTarget: '../catalog/new',
        sourceIdentity: { canonicalPath: '/catalog/new', dev: 1, ino: 2 },
      }],
      remove: [{
        linkPath: '/target/old', relativeTarget: '../catalog/old',
        manifestEntry: {
          linkName: 'old', sourceRelative: 'skills/old', relativeTarget: '../catalog/old',
          sourceIdentity: { canonicalPath: '/catalog/old', dev: 1, ino: 3 }, createdAt: '1970-01-01T00:00:00.000Z',
        },
      }],
      keep: [{ linkPath: '/target/keep', relativeTarget: '../catalog/keep' }],
      conflicts: [{ linkPath: '/target/conflict', kind: 'foreign-link', reason: 'foreign link' }],
      protected: [{ linkPath: '/target/manual', kind: 'regular-file', reason: 'protected' }],
      fingerprint: 'plan-fingerprint-123',
    }],
  }, io);
  const text = io.text();
  for (const value of [
    'target', 'catalog', 'desired', 'create', 'remove', 'keep', 'conflicts', 'protected', 'fingerprint',
    'dsh', '/target', 'canonicalPath', '10', '11',
    '/catalog', 'gitRemote', 'abc123',
    'skills/new', '/catalog/new', '../catalog/new',
    'manifestEntry', 'sourceRelative', 'skills/old', '/catalog/old',
    '/target/keep', '../catalog/keep',
    'kind', '/target/conflict', 'foreign-link', 'foreign link',
    '/target/manual', 'regular-file', 'protected', 'plan-fingerprint-123',
  ]) assert.ok(text.includes(value), `missing preview field: ${value}`);
});

class FakeRawInput {
  constructor() { this.handlers = new Map(); this.rawModes = []; this.isTTY = true; }
  on(event, handler) { this.handlers.set(event, handler); return this; }
  once(event, handler) { return this.on(event, handler); }
  off(event, handler) { if (this.handlers.get(event) === handler) this.handlers.delete(event); }
  emit(event, value) { this.handlers.get(event)?.(value); }
  setRawMode(value) { this.rawModes.push(value); }
}

function fakeTtyIo() {
  const input = new FakeRawInput();
  const output = { isTTY: true, writes: [], write(value) { this.writes.push(String(value)); } };
  const io = { input, output, isTTY: true, text: () => output.writes.join('') };
  return { io, input };
}

test('TTY bare ESC cancels through the common finish path and restores raw mode', async () => {
  const { io, input } = fakeTtyIo();
  const promise = confirmPlanSet({ plans: [] }, io);
  input.emit('data', '\u001b');
  assert.equal(await promise, false);
  assert.deepEqual(input.rawModes, [true, false]);
});

test('TTY fragmented arrow sequence clears its ESC timer before later input', async () => {
  const { io, input } = fakeTtyIo();
  const promise = runInteractive({
    io,
    catalogResolver: async () => ({ root: '/catalog', catalog: { root: '/catalog', skills: [] } }),
    discoverCatalog: async () => ({ root: '/catalog', skills: [] }),
    targetDetector: async () => [{ id: 'dsh', label: 'DSH', path: '/target' }],
    buildPlanSet: async () => ({ plans: [] }),
  });
  await new Promise((resolve) => setImmediate(resolve));
  input.emit('data', 'y');
  await new Promise((resolve) => setImmediate(resolve));
  input.emit('data', '\u001b');
  input.emit('data', '[B');
  await new Promise((resolve) => setImmediate(resolve));
  input.emit('data', ' ');
  input.emit('data', '\r');
  await new Promise((resolve) => setImmediate(resolve));
  input.emit('data', '\r');
  const result = await promise;
  assert.equal(result.cancelled, undefined);
  assert.deepEqual(input.rawModes.filter(Boolean).length, input.rawModes.filter((mode) => mode === false).length);
});

test('wizard observes fixed scan, confirmation, discovery, and valid-skill order', async () => {
  const events = [];
  const io = scriptedIo('y\na\na\ny\n');
  const result = await runInteractive({
    io,
    targetDetector: async () => { events.push('runtime-scan'); return [{ id: 'dsh', label: 'DSH', path: '/target' }]; },
    catalogResolver: async () => { events.push('catalog-candidate'); return { root: '/catalog', catalog: { root: '/catalog', skills: [{ name: 'candidate-only' }] } }; },
    discoverCatalog: async ({ catalogRoot }) => { events.push(`catalog-scan:${catalogRoot}`); return { root: '/catalog', skills: [{ name: 'skill' }] }; },
    scanValidSkills: async ({ catalog: value }) => { events.push(`valid-scan:${value.skills[0].name}`); return value.skills; },
    scanState: async () => { events.push('state-scan'); return {}; },
    buildPlanSet: async () => { events.push('plan'); return { plans: [] }; },
  });
  assert.equal(result.cancelled, undefined);
  assert.deepEqual(events, ['runtime-scan', 'catalog-candidate', 'catalog-scan:/catalog', 'valid-scan:skill', 'state-scan', 'plan']);
});

test('approved PlanSet is handed to onPlanSet only after preview confirmation', async () => {
  const events = [];
  const io = scriptedIo('y\na\na\ny\n');
  io.onPlanSet = () => { events.push('onPlanSet'); };
  const deps = dependencies(events);
  const result = await runInteractive({ ...deps, io });
  assert.equal(result.cancelled, undefined);
  assert.equal(events.at(-1), 'onPlanSet');
  assert.ok(events.findIndex((event) => event.type === 'plan') < events.indexOf('onPlanSet'));
});

test('TTY EOF, SIGTERM, and dependency errors restore raw mode in finally', async () => {
  for (const ending of ['end', 'SIGTERM']) {
    const { io, input } = fakeTtyIo();
    const signals = new (class { constructor() { this.handlers = new Map(); } on(s, h) { this.handlers.set(s, h); } off(s, h) { if (this.handlers.get(s) === h) this.handlers.delete(s); } emit(s) { this.handlers.get(s)?.(); } })();
    io.process = signals;
    const promise = confirmPlanSet({ plans: [] }, io);
    if (ending === 'end') input.emit('end'); else signals.emit('SIGTERM');
    assert.equal(await promise, false);
    assert.deepEqual(input.rawModes, [true, false]);
  }
  const { io, input } = fakeTtyIo();
  await assert.rejects(() => runInteractive({ io, targetDetector: async () => [], catalogResolver: async () => { throw new Error('boom'); } }), /boom/);
  assert.deepEqual(input.rawModes, []);
});

// Wrapper report retains the SDD artifact while this test file owns executable coverage.
