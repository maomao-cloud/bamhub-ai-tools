import readline from 'node:readline';

import { discoverCatalog } from './catalog.mjs';
import { buildPlanSet } from './plan.mjs';

const CANCEL = Symbol('interactive-cancel');

function write(io, text) {
  if (typeof io?.write === 'function') io.write(text);
  else if (io?.output?.write) io.output.write(text);
}

function inputFor(io) {
  return io?.input ?? io?.stdin ?? process.stdin;
}

function outputFor(io) {
  return io?.output ?? io?.stdout ?? process.stdout;
}

function isTTY(io) {
  return io?.isTTY ?? Boolean(inputFor(io).isTTY && outputFor(io).isTTY);
}

function normalizeResolver(resolver) {
  if (typeof resolver === 'function') return resolver;
  if (resolver && typeof resolver.resolve === 'function') return resolver.resolve.bind(resolver);
  if (resolver && typeof resolver.resolveCatalog === 'function') return resolver.resolveCatalog.bind(resolver);
  throw new TypeError('catalogResolver must be a function or resolver object');
}

function normalizeTargetDetector(detector) {
  if (typeof detector === 'function') return detector;
  if (detector && typeof detector.detect === 'function') return detector.detect.bind(detector);
  if (detector && typeof detector.detectRuntimeTargets === 'function') return detector.detectRuntimeTargets.bind(detector);
  throw new TypeError('targetDetector must be a function or detector object');
}

function commandSelection(line, items) {
  const value = line.trim();
  if (value === '\u001b' || value === 'escape') throw CANCEL;
  if (value === '\u0003' || value === 'ctrl-c') throw CANCEL;
  if (value === 'a' || value === 'all') return items.map((_, index) => index);
  if (value === 'n' || value === 'none') return [];
  if (value === 'd' || value === 'disable') return { disableAll: true, indexes: [] };
  const indexes = value.split(/[\s,]+/).filter(Boolean).map((part) => Number(part) - 1);
  if (indexes.length && indexes.every((index) => Number.isInteger(index) && index >= 0 && index < items.length)) return [...new Set(indexes)];
  return null;
}

function itemLabel(item) {
  return item?.label ?? item?.name ?? item?.relativeSource ?? item?.id ?? String(item);
}

function renderMenu(io, title, items, selected, cursor) {
  write(io, `\n${title}\n`);
  items.forEach((item, index) => {
    const marker = selected.has(index) ? 'x' : ' ';
    const focus = cursor === index ? '>' : ' ';
    write(io, `${focus} [${marker}] ${index + 1}. ${itemLabel(item)}\n`);
  });
  write(io, '  (a=all, n=none, Space=toggle, Enter=continue, Esc=cancel)\n');
}

function createSession(io) {
  const input = inputFor(io);
  const output = outputFor(io);
  const tty = isTTY(io);
  const rl = tty ? null : readline.createInterface({ input, output, terminal: false });
  let raw = false;
  let dataHandler;
  const signalHandlers = new Map();
  const lines = [];
  const lineWaiters = [];
  let lineEnded = false;
  let closed = false;
  if (rl) {
    rl.on('line', (value) => {
      const waiter = lineWaiters.shift();
      if (waiter) waiter.resolve(value);
      else lines.push(value);
    });
    rl.on('close', () => {
      lineEnded = true;
      while (lineWaiters.length && lines.length) lineWaiters.shift().resolve(lines.shift());
      while (lineWaiters.length) lineWaiters.shift().reject(CANCEL);
    });
  }

  function cleanup() {
    if (closed) return;
    closed = true;
    if (dataHandler && typeof input.off === 'function') input.off('data', dataHandler);
    if (raw && typeof input.setRawMode === 'function') input.setRawMode(false);
    raw = false;
    if (rl) rl.close();
    for (const [signal, handler] of signalHandlers) process.off(signal, handler);
    if (typeof io?.onClose === 'function') io.onClose();
  }

  function installSignals(reject) {
    for (const signal of ['SIGINT', 'SIGTERM']) {
      if (signalHandlers.has(signal)) continue;
      const handler = () => reject(CANCEL);
      signalHandlers.set(signal, handler);
      process.on(signal, handler);
    }
  }

  function line(prompt) {
    return new Promise((resolve, reject) => {
      installSignals(reject);
      write(io, `${prompt} `);
      if (!rl) return reject(CANCEL);
      if (lines.length) return resolve(lines.shift());
      if (lineEnded) return reject(CANCEL);
      lineWaiters.push({ resolve, reject });
    });
  }

  function key(prompt) {
    return new Promise((resolve, reject) => {
      installSignals(reject);
      write(io, `${prompt} `);
      const finish = (value, error = false) => {
        if (typeof input.off === 'function') {
          input.off('data', onData);
          if (endHandler) input.off('end', endHandler);
        }
        if (raw && typeof input.setRawMode === 'function') input.setRawMode(false);
        raw = false;
        error ? reject(value) : resolve(value);
      };
      const endHandler = () => finish(CANCEL, true);
      const onData = (chunk) => {
        const text = String(chunk);
        for (const char of text) {
          if (char === '\u0003' || char === '\u001b') return finish(CANCEL, true);
          if (char === '\r' || char === '\n' || char === 'y' || char === 'Y') return finish(true);
          if (char === 'n' || char === 'N') return finish(false);
        }
      };
      dataHandler = onData;
      if (typeof input.on === 'function') {
        input.on('data', onData);
        input.once('end', endHandler);
      }
      if (typeof input.setRawMode === 'function') {
        input.setRawMode(true);
        raw = true;
      }
      if (input.readableEnded) finish(CANCEL, true);
    });
  }

  async function confirm(prompt) {
    const answer = tty ? await key(prompt) : await line(prompt);
    const value = String(answer).trim().toLowerCase();
    if (value === '\u001b' || value === '\u0003' || value === 'escape' || value === 'ctrl-c') throw CANCEL;
    return value === 'y' || value === 'yes' || value === 'true' || value === '';
  }

  async function select(title, items) {
    if (!items.length) return { indexes: [] };
    if (!tty) {
      write(io, `\n${title}\n`);
      items.forEach((item, index) => write(io, `  ${index + 1}. ${itemLabel(item)}\n`));
      const answer = await line('Choose (a=all, n=none, numbers, d=disable all, Esc=cancel):');
      const selection = commandSelection(answer, items);
      if (selection === null) {
        write(io, 'Invalid selection; please try again.\n');
        return select(title, items);
      }
      if (!Array.isArray(selection)) return selection;
      return { indexes: selection };
    }

    const selected = new Set();
    let cursor = 0;
    return new Promise((resolve, reject) => {
      installSignals(reject);
      const finish = (value, error = false) => {
        if (typeof input.off === 'function') {
          input.off('data', onData);
          if (endHandler) input.off('end', endHandler);
        }
        if (raw && typeof input.setRawMode === 'function') input.setRawMode(false);
        raw = false;
        error ? reject(value) : resolve(value);
      };
      const endHandler = () => finish(CANCEL, true);
      const render = () => renderMenu(io, title, items, selected, cursor);
      let escapeBuffer = '';
      const onData = (chunk) => {
        escapeBuffer += String(chunk);
        while (escapeBuffer) {
          if (escapeBuffer.startsWith('\u001b[A') || escapeBuffer.startsWith('\u001b[D')) {
            cursor = Math.max(0, cursor - 1); escapeBuffer = escapeBuffer.slice(3); render(); continue;
          }
          if (escapeBuffer.startsWith('\u001b[B') || escapeBuffer.startsWith('\u001b[C')) {
            cursor = Math.min(items.length - 1, cursor + 1); escapeBuffer = escapeBuffer.slice(3); render(); continue;
          }
          if (escapeBuffer === '\u001b') return;
          const char = escapeBuffer[0];
          escapeBuffer = escapeBuffer.slice(1);
          if (char === '\u0003') return finish(CANCEL, true);
          if (char === '\u001b') return finish(CANCEL, true);
          if (char === 'a') { items.forEach((_, index) => selected.add(index)); render(); continue; }
          if (char === 'n') { selected.clear(); render(); continue; }
          if (char === ' ') { if (selected.has(cursor)) selected.delete(cursor); else selected.add(cursor); render(); continue; }
          if (char === '\r' || char === '\n') return finish({ indexes: [...selected].sort((a, b) => a - b) });
          if (char === 'b' || char === 'k') { cursor = Math.max(0, cursor - 1); render(); continue; }
          if (char === 'f' || char === 'j') { cursor = Math.min(items.length - 1, cursor + 1); render(); continue; }
        }
      };
      dataHandler = onData;
      input.on('data', onData);
      input.once('end', endHandler);
      if (typeof input.setRawMode === 'function') { input.setRawMode(true); raw = true; }
      render();
    });
  }

  return { confirm, line, select, cleanup };
}

function renderPlanSet(planSet, io) {
  write(io, '\nPlanSet preview\n');
  for (const plan of planSet?.plans ?? []) {
    const target = plan.target?.label ?? plan.target?.path ?? 'target';
    write(io, `\n${target}: ${plan.target?.path ?? ''}\n`);
    for (const [label, entries] of [['create', plan.create], ['remove', plan.remove], ['keep', plan.keep], ['conflicts', plan.conflicts], ['protected', plan.protected]]) {
      if (entries?.length) write(io, `  ${label}:\n${entries.map((entry) => `    - ${entry.linkPath ?? entry.path ?? entry.reason ?? JSON.stringify(entry)}\n`).join('')}`);
    }
  }
}

export async function confirmPlanSet(planSet, io = {}) {
  const session = createSession(io);
  try {
    renderPlanSet(planSet, io);
    return await session.confirm('Apply this PlanSet? [y/N]');
  } catch (error) {
    if (error === CANCEL) return false;
    throw error;
  } finally {
    session.cleanup();
  }
}

async function resolveCatalogData(catalogResolver) {
  const resolve = normalizeResolver(catalogResolver);
  const resolution = await resolve();
  return { resolve, resolution, catalog: resolution?.catalog ?? (resolution?.skills ? resolution : null) };
}

export async function runInteractive({ catalogResolver, targetDetector, io = {}, buildPlanSet: injectedBuild, scanState: injectedScan } = {}) {
  catalogResolver ??= io.catalogResolver;
  targetDetector ??= io.targetDetector;
  const build = injectedBuild ?? io.buildPlanSet ?? buildPlanSet;
  const scanState = injectedScan ?? io.scanState;
  const session = createSession(io);
  try {
    const resolved = await resolveCatalogData(catalogResolver);
    const { resolution } = resolved;
    write(io, `Catalog: ${resolution?.root ?? resolved.catalog?.root ?? '(unknown)'}\n`);
    if (!(await session.confirm('Use this catalog? [y/N]'))) return { cancelled: true };

    const catalog = resolved.catalog ?? (resolution?.root ? await discoverCatalog({ catalogRoot: resolution.root }) : resolution);
    const detected = await normalizeTargetDetector(targetDetector)();
    const runtimes = (detected ?? []).filter((target) => target.selectable !== false);
    const targetChoice = await session.select('Select global runtime targets', runtimes);
    if (targetChoice.disableAll) return { cancelled: true };
    const targets = targetChoice.indexes.map((index) => runtimes[index]);
    if (!targets.length) return { cancelled: true };

    const state = typeof scanState === 'function' ? await scanState({ targets, catalog }) : null;
    const skills = catalog?.skills ?? [];
    const skillChoice = await session.select('Select desired skills', skills);
    const desiredSelections = skillChoice.indexes.map((index) => skills[index]);
    const disableAll = Boolean(skillChoice.disableAll);
    const options = state?.options ?? {};
    if (state?.manifests) options.manifestByTarget = state.manifests;
    const planSet = await build({ targets, catalog, desiredSelections, options: { ...options, ...(disableAll ? { disableAll: true } : {}) } });
    renderPlanSet(planSet, io);
    if (!(await session.confirm('Approve final PlanSet? [y/N]'))) return { cancelled: true };
    if (typeof io.onPlanSet === 'function') await io.onPlanSet(planSet);
    return { catalogRoot: resolution?.root ?? catalog?.root, targets, desiredSelections, disableAll };
  } catch (error) {
    if (error === CANCEL) return { cancelled: true };
    throw error;
  } finally {
    session.cleanup();
  }
}

export { renderPlanSet };
