import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export class SyncError extends Error {
  constructor(code, message = code) {
    super(message);
    this.code = code;
  }
}

export async function runCli(argv, io = {}) {
  const [command, ...rest] = argv;
  const options = parseOptions(rest);
  if (!['check', 'apply'].includes(command)) throw new SyncError('COMMAND_INVALID', command);
  if (!options.source && !options.all) throw new SyncError('SOURCE_REQUIRED');
  if (options.source && options.all) throw new SyncError('SOURCE_SELECTOR_CONFLICT');
  return command === 'check' ? checkSources(options, io) : applySources(options, io);
}

export async function checkSources(options, io = {}) {
  const repoRoot = path.resolve(io.repoRoot ?? process.cwd());
  const manifest = await readManifest(repoRoot);
  const sourceIds = selectSources(manifest, options);
  const collidingSources = findTargetCollisions(sourceIds, manifest.sources, repoRoot);
  const sources = {};

  for (const sourceId of sourceIds) {
    try {
      if (collidingSources.has(sourceId)) {
        throw new SyncError('TARGET_COLLISION', `source ${sourceId} target collides with another configured source`);
      }
      sources[sourceId] = await checkSource(sourceId, manifest.sources[sourceId], repoRoot);
    } catch (error) {
      sources[sourceId] = {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  return {
    exitCode: Object.values(sources).some((source) => source.status === 'failed') ? 1 : 0,
    report: { sources }
  };
}

function findTargetCollisions(sourceIds, sources, repoRoot) {
  const ownersByTarget = new Map();
  for (const sourceId of sourceIds) {
    const roots = sources[sourceId]?.roots;
    if (!Array.isArray(roots)) continue;
    for (const root of roots) {
      if (!isRecord(root) || typeof root.target !== 'string' || !root.target) continue;
      let target;
      try {
        target = resolveTarget(repoRoot, root.target);
      } catch {
        continue;
      }
      const owners = ownersByTarget.get(target) ?? new Set();
      owners.add(sourceId);
      ownersByTarget.set(target, owners);
    }
  }

  return new Set([...ownersByTarget.values()]
    .filter((owners) => owners.size > 1)
    .flatMap((owners) => [...owners]));
}

export async function applySources() {
  throw new SyncError('APPLY_NOT_IMPLEMENTED');
}

async function readManifest(repoRoot) {
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(path.join(repoRoot, 'skills', 'sources.json'), 'utf8'));
  } catch (error) {
    throw new SyncError('MANIFEST_INVALID', error instanceof Error ? error.message : String(error));
  }

  if (!manifest || manifest.version !== 1 || !isRecord(manifest.sources)) {
    throw new SyncError('MANIFEST_INVALID', 'manifest must contain version 1 and a sources object');
  }
  return manifest;
}

function selectSources(manifest, options) {
  if (options.all) return Object.keys(manifest.sources).sort();
  if (!Object.hasOwn(manifest.sources, options.source)) {
    throw new SyncError('SOURCE_UNKNOWN', options.source);
  }
  return [options.source];
}

async function checkSource(sourceId, source, repoRoot) {
  validateSource(sourceId, source, repoRoot);
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'bamhub-skill-sync-'));
  const cloneRoot = path.join(temporaryRoot, 'source');

  try {
    runGit(['clone', '--depth', '1', '--branch', source.ref, source.repository, cloneRoot]);
    const targetCommit = runGit(['-C', cloneRoot, 'rev-parse', 'HEAD']).trim();

    for (const root of source.roots) {
      const upstreamRoot = resolveWithin(cloneRoot, root.upstream);
      if (!await containsSkill(upstreamRoot)) {
        throw new SyncError('ROOT_NO_SKILL', `source ${sourceId} root ${root.upstream} contains no SKILL.md`);
      }
    }

    return {
      status: targetCommit === source.acceptedCommit ? 'up-to-date' : 'update-available',
      currentCommit: source.acceptedCommit,
      targetCommit
    };
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}

function validateSource(sourceId, source, repoRoot) {
  if (!isRecord(source) || typeof source.repository !== 'string' || !source.repository
    || typeof source.ref !== 'string' || !source.ref
    || typeof source.acceptedCommit !== 'string' || !source.acceptedCommit
    || typeof source.acceptedAt !== 'string' || !source.acceptedAt
    || !Array.isArray(source.roots) || !source.roots.length) {
    throw new SyncError('SOURCE_INVALID', `source ${sourceId} has an invalid configuration`);
  }
  const targets = new Set();
  for (const root of source.roots) {
    if (!isRecord(root) || typeof root.upstream !== 'string' || !root.upstream
      || typeof root.target !== 'string' || !root.target) {
      throw new SyncError('SOURCE_INVALID', `source ${sourceId} has an invalid root`);
    }
    const target = resolveTarget(repoRoot, root.target);
    if (targets.has(target)) {
      throw new SyncError('TARGET_COLLISION', `source ${sourceId} target collides with another configured root: ${root.target}`);
    }
    targets.add(target);
  }
}

function resolveWithin(basePath, relativePath) {
  const resolvedPath = path.resolve(basePath, relativePath);
  if (resolvedPath !== basePath && !resolvedPath.startsWith(`${basePath}${path.sep}`)) {
    throw new SyncError('UPSTREAM_ROOT_INVALID', `upstream root must stay within the source: ${relativePath}`);
  }
  return resolvedPath;
}

function resolveTarget(repoRoot, target) {
  const resolvedPath = path.resolve(repoRoot, target);
  if (!resolvedPath.startsWith(`${repoRoot}${path.sep}`)) {
    throw new SyncError('TARGET_INVALID', `target must stay within the repository: ${target}`);
  }
  return resolvedPath;
}

async function containsSkill(rootPath) {
  let entries;
  try {
    entries = await fs.readdir(rootPath, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === 'ENOENT') return false;
    throw error;
  }
  for (const entry of entries) {
    if (entry.isFile() && entry.name === 'SKILL.md') return true;
    if (entry.isDirectory() && await containsSkill(path.join(rootPath, entry.name))) return true;
  }
  return false;
}

function runGit(args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    const detail = result.error?.message ?? result.stderr?.trim() ?? 'unknown Git error';
    throw new SyncError('GIT_FAILED', detail);
  }
  return result.stdout;
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--all') {
      options.all = true;
      continue;
    }
    if (argument === '--source') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new SyncError('OPTION_VALUE_REQUIRED', argument);
      options.source = value;
      index += 1;
      continue;
    }
    throw new SyncError('OPTION_INVALID', argument);
  }
  return options;
}

async function main() {
  try {
    const result = await runCli(process.argv.slice(2), { repoRoot: process.cwd(), stdout: process.stdout, stderr: process.stderr });
    process.stdout.write(`${JSON.stringify(result.report)}\n`);
    process.exitCode = result.exitCode;
  } catch (error) {
    const report = { error: serializeError(error) };
    process.stdout.write(`${JSON.stringify(report)}\n`);
    process.exitCode = 1;
  }
}

function serializeError(error) {
  return {
    code: error instanceof SyncError ? error.code : 'UNEXPECTED',
    message: error instanceof Error ? error.message : String(error)
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
