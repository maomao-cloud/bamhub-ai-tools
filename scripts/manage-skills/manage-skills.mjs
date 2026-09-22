#!/usr/bin/env node
import process from 'node:process';

import { resolveCatalog, discoverCatalog, resolveSelectors } from './lib/catalog.mjs';
import { detectRuntimeTargets, resolveTargetSelection, validateTarget } from './lib/targets.mjs';
import { stateRootForTarget, loadManifest } from './lib/state.mjs';
import { scanTarget, validateCatalogSkills } from './lib/links.mjs';
import { buildPlanSet } from './lib/plan.mjs';
import { applyPlanSet, recoverJournal } from './lib/transaction.mjs';
import { confirmPlanSet, runInteractive } from './lib/interactive.mjs';

const COMMANDS = new Set(['status', 'plan', 'apply', 'recover']);

function cliError(code, message, exitCode = 2, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.exitCode = exitCode;
  Object.assign(error, details);
  return error;
}

function parseArgs(argv) {
  let command = 'interactive';
  let index = 0;
  if (COMMANDS.has(argv[0])) { command = argv[0]; index = 1; }
  else if (argv[0]?.startsWith('-')) index = 0;
  else if (argv[0]) throw cliError('INVALID_COMMAND', `Unknown command: ${argv[0]}`);
  const options = { command, runtimes: [], enables: [] };
  const takesValue = new Set(['catalog', 'runtime', 'target', 'enable', 'state-root', 'journal']);
  for (; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) throw cliError('INVALID_ARGUMENT', `Unexpected argument: ${arg}`);
    const [flag, inline] = arg.split('=', 2);
    const name = flag.slice(2);
    if (!['catalog', 'runtime', 'target', 'enable', 'state-root', 'journal', 'disable-all', 'json', 'non-interactive', 'yes', 'dry-run'].includes(name)) {
      throw cliError('INVALID_ARGUMENT', `Unknown option: ${flag}`);
    }
    if (takesValue.has(name)) {
      const value = inline ?? argv[++index];
      if (!value || value.startsWith('--')) throw cliError('INVALID_ARGUMENT', `Option ${flag} requires a value`);
      if (name === 'runtime') options.runtimes.push(value);
      else if (name === 'enable') options.enables.push(...value.split(',').map((item) => item.trim()));
      else options[name] = value;
    } else options[name] = true;
  }
  if (options.target !== undefined && options.runtimes.length) throw cliError('TARGET_SELECTOR_CONFLICT', '--target and --runtime are mutually exclusive');
  if (options['disable-all'] && options.enables.length) throw cliError('DESIRED_STATE_CONFLICT', '--enable and --disable-all are mutually exclusive');
  if (command !== 'apply' && options.yes) throw cliError('INVALID_ARGUMENT', '--yes is only valid for apply');
  if (command === 'status' && (options.enables.length || options['disable-all'])) throw cliError('INVALID_ARGUMENT', 'status does not accept desired-state options');
  if (command === 'plan' && options['disable-all'] === undefined && options.enables.length === 0) throw cliError('DESIRED_STATE_REQUIRED', 'plan requires --enable or --disable-all');
  if (command === 'apply' && options['non-interactive'] && !options.enables.length && !options['disable-all']) throw cliError('DESIRED_STATE_REQUIRED', 'apply requires --enable, --disable-all, or interactive selection');
  if (command === 'apply' && options['non-interactive'] && !options.yes) throw cliError('CONFIRMATION_REQUIRED', '--non-interactive apply requires --yes');
  if (command === 'recover' && (!options['state-root'] || !options.journal)) throw cliError('INVALID_ARGUMENT', 'recover requires --state-root and --journal');
  if (command === 'recover' && (options.catalog || options.target || options.runtimes.length || options.enables.length || options['disable-all'])) throw cliError('INVALID_ARGUMENT', 'recover accepts only --state-root, --journal, and --json');
  return options;
}

function selectorValue(value) {
  if (!value) throw cliError('INVALID_SELECTOR', 'Selector must not be empty');
  const [selector, alias, ...extra] = value.split('=');
  if (!selector || extra.length > 0 || alias === '') throw cliError('INVALID_SELECTOR', `Invalid selector: ${value}`);
  if (selector.includes('/')) return { sourceRelative: selector, ...(alias ? { linkName: alias } : {}) };
  return { name: selector, ...(alias ? { linkName: alias } : {}) };
}

function publicTarget(target) {
  return { id: target.id, label: target.label, path: target.path, source: target.source, exists: target.exists };
}

function reportFor({ ok, exitCode, catalog, targets = [], errors = [] }) {
  return { ok, exitCode, catalog, targets, errors };
}

function writeOutput(report, { json, diagnostics = [] }, streams) {
  if (json) streams.stdout.write(`${JSON.stringify(report)}\n`);
  else streams.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  for (const diagnostic of diagnostics) streams.stderr.write(`${diagnostic}\n`);
}

async function resolveContext(options) {
  const resolution = await resolveCatalog({ explicitPath: options.catalog, env: process.env, scriptFile: import.meta.url });
  if (resolution.missing) throw cliError('CATALOG_NOT_FOUND', `Catalog is unavailable: ${resolution.root}`, 1);
  const catalog = await discoverCatalog({ catalogRoot: resolution.root });
  if (catalog.invalid.length) {
    const error = cliError('CATALOG_INVALID', `Catalog contains invalid skills: ${resolution.root}`, 1);
    error.catalog = catalog;
    throw error;
  }
  const runtimes = await detectRuntimeTargets({ env: process.env });
  const selectionRuntimes = options.runtimes.includes('all')
    ? runtimes.filter((runtime) => runtime.exists)
    : runtimes;
  const selected = await resolveTargetSelection({ runtimes: selectionRuntimes, customPath: options.target, selectedIds: options.runtimes });
  if (!selected.length) throw cliError('TARGET_REQUIRED', 'At least one target must be selected');
  const targets = [];
  for (const candidate of selected) {
    const identity = await validateTarget({ targetPath: candidate.path, catalogRoot: catalog.root, mode: candidate.id });
    targets.push({ ...candidate, ...identity, stateRoot: stateRootForTarget({ runtimeId: candidate.id, env: process.env }) });
  }
  return { resolution, catalog, targets };
}

async function manifestsFor(targets, catalog) {
  const manifests = new Map();
  for (const target of targets) {
    if (!Number.isSafeInteger(target.dev) || !Number.isSafeInteger(target.ino)) continue;
    try {
      const targetIdentity = catalog.identity ? { ...target, catalogIdentity: catalog.identity } : target;
      const manifest = await loadManifest({ stateRoot: target.stateRoot, targetIdentity });
      manifests.set(target.path, manifest);
    } catch (error) {
      if (error.code !== 'MANIFEST_MISSING') throw error;
    }
  }
  return manifests;
}

async function executeExplicit(options, streams = { stdout: process.stdout, stderr: process.stderr }) {
  const context = await resolveContext(options);
  const { catalog, targets, resolution } = context;
  const catalogReport = { root: catalog.root, source: resolution.source, invalid: catalog.invalid, duplicates: catalog.duplicates };
  const manifests = await manifestsFor(targets, catalog);
  if (options.command === 'status') {
    const reports = [];
    for (const target of targets) {
      const entries = await scanTarget({ targetIdentity: target, catalog, manifest: manifests.get(target.path) });
      reports.push({ target: publicTarget(target), entries, plan: null, result: null });
    }
    return reportFor({ ok: true, exitCode: 0, catalog: catalogReport, targets: reports });
  }
  if (options.command === 'apply' && !options.enables.length && !options['disable-all']) {
    throw cliError('DESIRED_STATE_REQUIRED', 'apply requires exactly one desired state: --enable, --disable-all, or interactive selection');
  }
  const desiredResult = options['disable-all'] ? { selections: [], errors: [] } : resolveSelectors(options.enables.map(selectorValue), catalog);
  if (desiredResult.errors.length) throw cliError('SELECTOR_INVALID', desiredResult.errors.map((item) => item.reason).join('; '), 2);
  const planSet = await buildPlanSet({ targets, catalog, desiredSelections: desiredResult.selections, options: { disableAll: Boolean(options['disable-all']), manifestByTarget: manifests } });
  const plans = planSet.plans;
  const targetReports = plans.map((plan) => ({ target: publicTarget(plan.target), entries: null, plan, result: null }));
  if (options.command === 'plan' || options['dry-run']) return reportFor({ ok: true, exitCode: 0, catalog: catalogReport, targets: targetReports });
  const interactive = Boolean(streams.stdin?.isTTY && streams.stdout?.isTTY);
  if (!options.yes && !options['non-interactive']) {
    if (!interactive) throw cliError('CONFIRMATION_REQUIRED', 'apply requires --yes in non-interactive mode');
    const approved = await confirmPlanSet(planSet, { input: streams.stdin, output: streams.stdout, isTTY: true });
    if (!approved) throw cliError('CANCELLED', 'Apply cancelled', 2);
  }
  const result = await applyPlanSet(planSet, { state: {} });
  for (let i = 0; i < targetReports.length; i += 1) targetReports[i].result = result.targets[i];
  return reportFor({ ok: result.exitCode === 0, exitCode: result.exitCode, catalog: catalogReport, targets: targetReports });
}

async function executeRecover(options) {
  const result = await recoverJournal({ stateRoot: options['state-root'], journalPath: options.journal });
  return reportFor({ ok: result.recovered === true, exitCode: result.recovered ? 0 : 1, catalog: null, targets: [{ recovery: result }] });
}

async function executeInteractive(options, streams) {
  const io = {
    input: streams.stdin,
    output: streams.stdout,
    isTTY: Boolean(streams.stdin?.isTTY && streams.stdout?.isTTY),
    onPlanSet: async (planSet) => applyPlanSet(planSet, { state: {} }),
  };
  if (!io.isTTY) throw cliError('INTERACTIVE_REQUIRED', 'Interactive mode requires a TTY');
  const result = await runInteractive({
    io,
    catalogResolver: (interactivePath) => resolveCatalog({ explicitPath: options.catalog, env: process.env, scriptFile: import.meta.url, interactivePath }),
    targetDetector: () => detectRuntimeTargets({ env: process.env }),
    discoverCatalog,
    scanValidSkills: ({ catalog }) => validateCatalogSkills(catalog),
    prepareTargets: async ({ targets }) => targets.map((target) => ({
      ...target,
      stateRoot: stateRootForTarget({ runtimeId: target.id, env: process.env }),
    })),
    validateTargets: async ({ targets, catalogRoot }) => Promise.all(targets.map(async (target) => {
      const identity = await validateTarget({ targetPath: target.path, catalogRoot, mode: target.id });
      return { ...target, ...identity, stateRoot: target.stateRoot };
    })),
    scanState: ({ targets, catalog }) => manifestsFor(targets, catalog).then((manifests) => ({ manifests })),
  });
  if (result?.cancelled) throw cliError('CANCELLED', 'Interactive selection cancelled', 2);
  const applyResult = result?.applyResult;
  const targets = result?.targets ?? [];
  const targetResults = targets.map((target, index) => ({
    target: publicTarget(target),
    entries: null,
    plan: null,
    result: applyResult?.targets?.[index] ?? null,
  }));
  const exitCode = applyResult?.exitCode ?? 0;
  return reportFor({ ok: exitCode === 0, exitCode, catalog: { root: result.catalogRoot }, targets: targetResults });
}

export async function main(argv = process.argv.slice(2), streams = process) {
  let options;
  try {
    options = parseArgs(argv);
    const tty = Boolean(streams.stdin?.isTTY && streams.stdout?.isTTY);
    const needsInteractiveSelection = options.command === 'interactive'
      || (options.command === 'apply' && !options.enables.length && !options['disable-all'] && !options['dry-run'] && tty);
    if (options.json && tty && (options.command === 'interactive' || (options.command === 'apply' && !options.yes))) {
      throw cliError('CONFIRMATION_REQUIRED', '--json in TTY requires --yes or non-interactive mode');
    }
    const report = options.command === 'recover'
      ? await executeRecover(options)
      : needsInteractiveSelection ? await executeInteractive(options, streams) : await executeExplicit(options, streams);
    writeOutput(report, { json: Boolean(options.json) }, streams);
    return report.exitCode;
  } catch (error) {
    const exitCode = error.exitCode ?? 1;
    const report = reportFor({ ok: false, exitCode, catalog: error.catalog ? { root: error.catalog.root, invalid: error.catalog.invalid, duplicates: error.catalog.duplicates } : null, errors: [{ code: error.code ?? 'ERROR', message: error.message }] });
    writeOutput(report, { json: Boolean(options?.json), diagnostics: [error.message] }, streams);
    return exitCode;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const code = await main();
  process.exitCode = code;
}
