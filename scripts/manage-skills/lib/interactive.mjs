import readline from 'node:readline';

import { discoverCatalog as defaultDiscoverCatalog } from './catalog.mjs';
import { buildPlanSet as defaultBuildPlanSet } from './plan.mjs';

const CANCEL = Symbol('interactive-cancel');
const ESC = '\u001b';

function write(io, text) {
  if (typeof io?.write === 'function') io.write(text);
  else if (io?.output?.write) io.output.write(text);
}
function inputFor(io) { return io?.input ?? io?.stdin ?? process.stdin; }
function outputFor(io) { return io?.output ?? io?.stdout ?? process.stdout; }
function isTTY(io) { return io?.isTTY ?? Boolean(inputFor(io).isTTY && outputFor(io).isTTY); }
function processFor(io) { return io?.process ?? process; }
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
  if (value === ESC || value === 'escape' || value === '\u0003' || value === 'ctrl-c') throw CANCEL;
  if (value === 'a' || value === 'all') return items.map((_, index) => index);
  if (value === 'n' || value === 'none') return [];
  if (value === 'd' || value === 'disable') return { disableAll: true, indexes: [] };
  const indexes = value.split(/[\s,]+/).filter(Boolean).map((part) => Number(part) - 1);
  if (indexes.length && indexes.every((index) => Number.isInteger(index) && index >= 0 && index < items.length)) return [...new Set(indexes)];
  return null;
}
function itemLabel(item) { return item?.label ?? item?.name ?? item?.relativeSource ?? item?.id ?? String(item); }
function renderMenu(io, title, items, selected, cursor) {
  write(io, `\n${title}\n`);
  items.forEach((item, index) => write(io, `${cursor === index ? '>' : ' '} [${selected.has(index) ? 'x' : ' '}] ${index + 1}. ${itemLabel(item)}\n`));
  write(io, '  (a=all, n=none, Space=toggle, Enter=continue, Esc=cancel)\n');
}

function createSession(io) {
  const input = inputFor(io);
  const output = outputFor(io);
  const tty = isTTY(io);
  const proc = processFor(io);
  const rl = tty ? null : readline.createInterface({ input, output, terminal: false });
  let raw = false;
  let closed = false;
  const signalHandlers = new Map();
  const lines = [];
  const lineWaiters = [];
  let lineEnded = false;
  if (rl) {
    rl.on('line', (value) => {
      const waiter = lineWaiters.shift();
      if (waiter) waiter.resolve(value); else lines.push(value);
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
    if (raw && typeof input.setRawMode === 'function') input.setRawMode(false);
    raw = false;
    if (rl) rl.close();
    for (const [signal, handler] of signalHandlers) proc.off?.(signal, handler);
    io?.onClose?.();
  }
  function installSignals(finish) {
    for (const signal of ['SIGINT', 'SIGTERM']) {
      if (signalHandlers.has(signal) || typeof proc.on !== 'function') continue;
      const handler = () => finish(CANCEL, true);
      signalHandlers.set(signal, handler);
      proc.on(signal, handler);
    }
  }
  function line(prompt) {
    return new Promise((resolve, reject) => {
      installSignals(reject);
      write(io, `${prompt} `);
      if (lines.length) return resolve(lines.shift());
      if (lineEnded) return reject(CANCEL);
      lineWaiters.push({ resolve, reject });
    });
  }
  function key(prompt) {
    return new Promise((resolve, reject) => {
      write(io, `${prompt} `);
      let done = false;
      let escapeBuffer = '';
      let escapeTimer;
      const finish = (value, error = false) => {
        if (done) return;
        done = true;
        if (escapeTimer) clearTimeout(escapeTimer);
        input.off?.('data', onData);
        input.off?.('end', endHandler);
        if (raw && typeof input.setRawMode === 'function') input.setRawMode(false);
        raw = false;
        error ? reject(value) : resolve(value);
      };
      const endHandler = () => finish(CANCEL, true);
      const onData = (chunk) => {
        escapeBuffer += String(chunk);
        while (escapeBuffer) {
          if (escapeBuffer === ESC) {
            if (!escapeTimer) escapeTimer = setTimeout(() => finish(CANCEL, true), 0);
            return;
          }
          if (escapeBuffer.startsWith(`${ESC}[` ) && escapeBuffer.length < 3) return;
          if (escapeBuffer === `${ESC}[A` || escapeBuffer === `${ESC}[D`) { escapeBuffer = ''; continue; }
          if (escapeBuffer === `${ESC}[B` || escapeBuffer === `${ESC}[C`) { escapeBuffer = ''; continue; }
          const char = escapeBuffer[0];
          escapeBuffer = escapeBuffer.slice(1);
          if (char === '\u0003') return finish(CANCEL, true);
          if (char === ESC) continue;
          if (char === '\r' || char === '\n' || char === 'y' || char === 'Y') return finish(true);
          if (char === 'n' || char === 'N') return finish(false);
        }
      };
      installSignals(finish);
      input.on?.('data', onData);
      input.once?.('end', endHandler);
      if (typeof input.setRawMode === 'function') { input.setRawMode(true); raw = true; }
      if (input.readableEnded) finish(CANCEL, true);
    });
  }
  async function confirm(prompt) {
    const answer = tty ? await key(prompt) : await line(prompt);
    const value = String(answer).trim().toLowerCase();
    if (value === ESC || value === '\u0003' || value === 'escape' || value === 'ctrl-c') throw CANCEL;
    return value === 'y' || value === 'yes' || value === 'true' || value === '';
  }
  async function select(title, items) {
    if (!items.length) return { indexes: [] };
    if (!tty) {
      write(io, `\n${title}\n`);
      items.forEach((item, index) => write(io, `  ${index + 1}. ${itemLabel(item)}\n`));
      const answer = await line('Choose (a=all, n=none, numbers, d=disable all, Esc=cancel):');
      const selection = commandSelection(answer, items);
      if (selection === null) { write(io, 'Invalid selection; please try again.\n'); return select(title, items); }
      return Array.isArray(selection) ? { indexes: selection } : selection;
    }
    return new Promise((resolve, reject) => {
      const selected = new Set(); let cursor = 0; let done = false; let escapeBuffer = ''; let escapeTimer;
      const finish = (value, error = false) => {
        if (done) return;
        done = true;
        if (escapeTimer) clearTimeout(escapeTimer);
        input.off?.('data', onData); input.off?.('end', endHandler);
        if (raw && typeof input.setRawMode === 'function') input.setRawMode(false);
        raw = false;
        error ? reject(value) : resolve(value);
      };
      const endHandler = () => finish(CANCEL, true);
      const render = () => renderMenu(io, title, items, selected, cursor);
      const onData = (chunk) => {
        escapeBuffer += String(chunk);
        while (escapeBuffer) {
          if (escapeBuffer === ESC) { if (!escapeTimer) escapeTimer = setTimeout(() => finish(CANCEL, true), 0); return; }
          if (escapeBuffer.startsWith(`${ESC}[`) && escapeBuffer.length < 3) return;
          if (escapeBuffer === `${ESC}[A` || escapeBuffer === `${ESC}[D`) { cursor = Math.max(0, cursor - 1); escapeBuffer = ''; render(); continue; }
          if (escapeBuffer === `${ESC}[B` || escapeBuffer === `${ESC}[C`) { cursor = Math.min(items.length - 1, cursor + 1); escapeBuffer = ''; render(); continue; }
          const char = escapeBuffer[0]; escapeBuffer = escapeBuffer.slice(1);
          if (char === '\u0003') return finish(CANCEL, true);
          if (char === ESC) continue;
          if (char === 'a') { items.forEach((_, index) => selected.add(index)); render(); continue; }
          if (char === 'n') { selected.clear(); render(); continue; }
          if (char === ' ') { selected.has(cursor) ? selected.delete(cursor) : selected.add(cursor); render(); continue; }
          if (char === '\r' || char === '\n') return finish({ indexes: [...selected].sort((a, b) => a - b) });
          if (char === 'b' || char === 'k') { cursor = Math.max(0, cursor - 1); render(); continue; }
          if (char === 'f' || char === 'j') { cursor = Math.min(items.length - 1, cursor + 1); render(); continue; }
        }
      };
      installSignals(finish); input.on?.('data', onData); input.once?.('end', endHandler);
      if (typeof input.setRawMode === 'function') { input.setRawMode(true); raw = true; }
      render();
    });
  }
  return { confirm, line, select, cleanup };
}

function renderEntry(entry) {
  const fields = [entry?.path, entry?.source, entry?.relativeTarget, entry?.reason].filter((value) => value !== undefined && value !== '');
  return fields.length ? fields.join(' | ') : JSON.stringify(entry);
}
function renderPlan(plan, io, heading) {
  const target = plan?.target ?? {};
  write(io, `\n${heading}${target.label ?? 'target'}: path=${target.path ?? ''} source=${target.source ?? ''} relative target=${target.relativeTarget ?? ''}\n`);
  for (const label of ['create', 'remove', 'keep', 'conflicts', 'protected']) {
    const entries = Array.isArray(plan?.[label]) ? plan[label] : [];
    write(io, `  ${label}:\n`);
    for (const entry of entries) write(io, `    - ${renderEntry(entry)}\n`);
  }
}
function renderPlanSet(planSet, io) {
  write(io, '\nPlanSet preview\n');
  for (const plan of planSet?.plans ?? []) renderPlan(plan, io, '');
  renderPlan({ target: { label: 'top-level' }, ...planSet }, io, '');
}

export async function confirmPlanSet(planSet, io = {}) {
  const session = createSession(io);
  try { renderPlanSet(planSet, io); return await session.confirm('Apply this PlanSet? [y/N]'); }
  catch (error) { if (error === CANCEL) return false; throw error; }
  finally { session.cleanup(); }
}

export async function runInteractive({ catalogResolver, targetDetector, discoverCatalog, scanValidSkills, io = {}, buildPlanSet: injectedBuild, scanState: injectedScan } = {}) {
  catalogResolver ??= io.catalogResolver;
  targetDetector ??= io.targetDetector;
  discoverCatalog ??= io.discoverCatalog ?? defaultDiscoverCatalog;
  scanValidSkills ??= io.scanValidSkills;
  const build = injectedBuild ?? io.buildPlanSet ?? defaultBuildPlanSet;
  const scanState = injectedScan ?? io.scanState;
  const session = createSession(io);
  try {
    const detected = await normalizeTargetDetector(targetDetector)();
    const runtimes = (detected ?? []).filter((target) => target.selectable !== false);
    const resolved = await normalizeResolver(catalogResolver)();
    const catalogRoot = resolved?.root ?? resolved?.catalog?.root;
    write(io, `Catalog: ${catalogRoot ?? '(unknown)'}\n`);
    if (!(await session.confirm('Use this catalog? [y/N]'))) return { cancelled: true };
    let catalog = resolved?.catalog ?? (resolved?.skills ? resolved : null);
    if (!catalog) catalog = await discoverCatalog({ catalogRoot: resolved?.root ?? resolved?.catalogRoot, resolution: resolved });
    const skills = scanValidSkills ? await scanValidSkills({ catalog, catalogRoot: catalog?.root ?? catalogRoot }) : (catalog?.skills ?? []);
    const targetChoice = await session.select('Select global runtime targets', runtimes);
    if (targetChoice.disableAll) return { cancelled: true };
    const targets = targetChoice.indexes.map((index) => runtimes[index]);
    if (!targets.length) return { cancelled: true };
    const state = typeof scanState === 'function' ? await scanState({ targets, catalog, skills }) : null;
    const skillChoice = await session.select('Select desired skills', skills);
    const desiredSelections = skillChoice.indexes.map((index) => skills[index]);
    const disableAll = Boolean(skillChoice.disableAll);
    const options = state?.options ?? {};
    if (state?.manifests) options.manifestByTarget = state.manifests;
    const planSet = await build({ targets, catalog, desiredSelections, options: { ...options, ...(disableAll ? { disableAll: true } : {}) } });
    renderPlanSet(planSet, io);
    if (!(await session.confirm('Approve final PlanSet? [y/N]'))) return { cancelled: true };
    if (typeof io.onPlanSet === 'function') await io.onPlanSet(planSet);
    return { catalogRoot: catalogRoot ?? catalog?.root, targets, desiredSelections, disableAll };
  } catch (error) { if (error === CANCEL) return { cancelled: true }; throw error; }
  finally { session.cleanup(); }
}

export { renderPlanSet };
