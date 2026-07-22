import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
  const configuredTargets = [];
  for (const sourceId of Object.keys(sources)) {
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
      configuredTargets.push({ sourceId, target });
    }
  }
  const collidingSources = new Set();
  for (let left = 0; left < configuredTargets.length; left += 1) {
    for (let right = left + 1; right < configuredTargets.length; right += 1) {
      if (targetsOverlap(configuredTargets[left].target, configuredTargets[right].target)) {
        if (sourceIds.includes(configuredTargets[left].sourceId)) {
          collidingSources.add(configuredTargets[left].sourceId);
        }
        if (sourceIds.includes(configuredTargets[right].sourceId)) {
          collidingSources.add(configuredTargets[right].sourceId);
        }
      }
    }
  }
  return collidingSources;
}

export async function applySources(options, io = {}) {
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
      sources[sourceId] = await applySource(sourceId, manifest, repoRoot, options, io);
    } catch (error) {
      if (!options.all && error instanceof SyncError && error.code === 'TARGET_DIRTY') throw error;
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
  return withSourceClone(source, async (cloneRoot) => {
    const targetCommit = runGit(['rev-parse', 'HEAD'], { cwd: cloneRoot }).trim();
    await validateUpstreamRoots(sourceId, source, cloneRoot);
    return {
      status: targetCommit === source.acceptedCommit ? 'up-to-date' : 'update-available',
      currentCommit: source.acceptedCommit,
      targetCommit,
      changedFiles: changedFiles(source, cloneRoot, targetCommit)
    };
  });
}

async function applySource(sourceId, manifest, repoRoot, options, io) {
  const source = manifest.sources[sourceId];
  const nextManifest = structuredClone(manifest);
  const nextSource = nextManifest.sources[sourceId];
  validateSource(sourceId, source, repoRoot);
  return withSourceClone(source, async (cloneRoot, temporaryRoot) => {
    const currentCommit = source.acceptedCommit;
    const targetCommit = runGit(['rev-parse', 'HEAD'], { cwd: cloneRoot }).trim();
    const upstreamRoots = await validateUpstreamRoots(sourceId, source, cloneRoot);
    const targetRoots = source.roots.map((root) => resolveTarget(repoRoot, root.target));
    await Promise.all(targetRoots.map((target) => assertSafeTargetParent(repoRoot, target)));
    const summary = await readSummary(repoRoot, options.summaryFile);

    if (!options.force && !await targetsMatchAccepted(sourceId, source, cloneRoot, targetRoots, summary)) {
      throw new SyncError('TARGET_DIRTY', `TARGET_DIRTY: source ${sourceId} has local changes under a configured target`);
    }

    const stagedRoots = await Promise.all(upstreamRoots.map(async (upstreamRoot, index) => {
      const stagedRoot = path.join(temporaryRoot, 'staged', String(index));
      await fs.mkdir(path.dirname(stagedRoot), { recursive: true });
      await fs.cp(upstreamRoot, stagedRoot, {
        recursive: true,
        force: false,
        errorOnExist: true,
        filter: (sourcePath) => path.basename(sourcePath) !== '.git'
      });
      return stagedRoot;
    }));
    const changed = changedFiles(source, cloneRoot, targetCommit);
    const readmeChangedFiles = managedFileStatuses(source, cloneRoot, targetCommit);
    const acceptedAt = typeof io.now === 'function' ? io.now().toISOString() : new Date().toISOString();
    const readmes = await Promise.all(stagedRoots.map((stagedRoot) => buildReadme({
      sourceId, source, targetCommit, acceptedAt, stagedRoot, changedFiles: readmeChangedFiles, summary
    })));
    const replacements = [];
    try {
      for (let index = 0; index < stagedRoots.length; index += 1) {
        replacements.push(await prepareReplacement({
          repoRoot,
          target: targetRoots[index],
          stagedRoot: stagedRoots[index],
          readme: readmes[index]
        }));
      }
    } catch (error) {
      await Promise.all(replacements.reverse().map((replacement) => replacement.cleanup()));
      throw error;
    }

    try {
      for (const replacement of replacements) await replacement.commit();
      nextSource.acceptedCommit = targetCommit;
      nextSource.acceptedAt = acceptedAt;
      await (io.writeManifest ?? writeManifest)(repoRoot, nextManifest);
      source.acceptedCommit = targetCommit;
      source.acceptedAt = acceptedAt;
    } catch (error) {
      await Promise.all(replacements.reverse().map((replacement) => replacement.restore()));
      throw error;
    } finally {
      await Promise.all(replacements.map((replacement) => replacement.cleanup()));
    }

    return {
      status: 'applied',
      currentCommit,
      targetCommit,
      changedFiles: changed
    };
  });
}

async function withSourceClone(source, callback) {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'bamhub-skill-sync-'));
  const cloneRoot = path.join(temporaryRoot, 'source');
  try {
    runGit(['clone', '--branch', source.ref, source.repository, cloneRoot], { cwd: temporaryRoot });
    return await callback(cloneRoot, temporaryRoot);
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function validateUpstreamRoots(sourceId, source, cloneRoot) {
  const upstreamRoots = [];
  for (const root of source.roots) {
    const upstreamRoot = resolveWithin(cloneRoot, root.upstream);
    if (!await containsSkill(upstreamRoot)) {
      throw new SyncError('ROOT_NO_SKILL', `source ${sourceId} root ${root.upstream} contains no SKILL.md`);
    }
    if (await pathExists(path.join(upstreamRoot, 'README.md'))) {
      throw new SyncError('ROOT_README_RESERVED', `source ${sourceId} root ${root.upstream} contains README.md reserved for Bamhub`);
    }
    upstreamRoots.push(upstreamRoot);
  }
  return upstreamRoots;
}

async function targetsMatchAccepted(sourceId, source, cloneRoot, targetRoots, summary) {
  if (isZeroCommit(source.acceptedCommit)) {
    return (await Promise.all(targetRoots.map((target) => pathExists(target)))).every((exists) => !exists);
  }

  const expectedRoot = path.join(path.dirname(cloneRoot), 'accepted');
  try {
    runGit(['worktree', 'add', '--detach', expectedRoot, source.acceptedCommit], { cwd: cloneRoot });
  } catch {
    return false;
  }

  try {
    for (let index = 0; index < source.roots.length; index += 1) {
      const target = targetRoots[index];
      if (!await pathExists(target)) return false;
      const expected = resolveWithin(expectedRoot, source.roots[index].upstream);
      if (!await directoryDigestMatches(target, expected)) return false;
      const expectedReadme = await buildReadme({
        sourceId,
        source,
        targetCommit: source.acceptedCommit,
        acceptedAt: source.acceptedAt,
        stagedRoot: expected,
        changedFiles: managedFileStatuses(source, expectedRoot, source.acceptedCommit),
        summary
      });
      if (!await readmeMatches(target, expectedReadme)) return false;
    }
    return true;
  } finally {
    try {
      runGit(['worktree', 'remove', '--force', expectedRoot], { cwd: cloneRoot });
    } catch {
      await fs.rm(expectedRoot, { recursive: true, force: true });
    }
  }
}

async function directoryDigestMatches(target, expected) {
  const [targetDigest, expectedDigest] = await Promise.all([
    directoryDigest(target, true),
    directoryDigest(expected, true)
  ]);
  return targetDigest === expectedDigest;
}

async function directoryDigest(root, omitReadme) {
  const hash = createHash('sha256');
  await appendDirectoryDigest(hash, root, '', omitReadme);
  return hash.digest('hex');
}

async function appendDirectoryDigest(hash, root, relativePath, omitReadme) {
  const absolutePath = path.join(root, relativePath);
  const stat = await fs.lstat(absolutePath);
  if (stat.isSymbolicLink()) {
    hash.update(`link:${relativePath}:${await fs.readlink(absolutePath)}\n`);
    return;
  }
  if (stat.isFile()) {
    hash.update(`file:${relativePath}:${stat.mode & 0o111}:`);
    hash.update(await fs.readFile(absolutePath));
    hash.update('\n');
    return;
  }
  if (!stat.isDirectory()) {
    hash.update(`other:${relativePath}\n`);
    return;
  }

  hash.update(`directory:${relativePath}\n`);
  const names = (await fs.readdir(absolutePath)).sort();
  for (const name of names) {
    if (omitReadme && !relativePath && name === 'README.md') continue;
    await appendDirectoryDigest(hash, root, path.join(relativePath, name), omitReadme);
  }
}

async function prepareReplacement({ repoRoot, target, stagedRoot, readme }) {
  await assertSafeTargetParent(repoRoot, target);
  const targetParent = path.dirname(target);
  const createdDirectories = await createTargetParent(repoRoot, targetParent);
  let operationRoot;
  let replacement;
  let backup;
  try {
    operationRoot = await fs.mkdtemp(path.join(targetParent, '.bamhub-skill-sync-'));
    replacement = path.join(operationRoot, 'replacement');
    backup = path.join(operationRoot, 'backup');
    await fs.cp(stagedRoot, replacement, { recursive: true, force: false, errorOnExist: true });
    await fs.writeFile(path.join(replacement, 'README.md'), readme);
  } catch (error) {
    if (operationRoot) await fs.rm(operationRoot, { recursive: true, force: true });
    await removeEmptyDirectories(createdDirectories);
    throw error;
  }
  let hadTarget = false;
  let committed = false;

  return {
    async commit() {
      hadTarget = await pathExists(target);
      if (hadTarget) await fs.rename(target, backup);
      try {
        await fs.rename(replacement, target);
        committed = true;
      } catch (error) {
        if (hadTarget) await fs.rename(backup, target);
        throw error;
      }
    },
    async restore() {
      if (!committed) return;
      await fs.rm(target, { recursive: true, force: true });
      if (hadTarget) await fs.rename(backup, target);
      committed = false;
    },
    async cleanup() {
      await fs.rm(operationRoot, { recursive: true, force: true });
      await removeEmptyDirectories(createdDirectories);
    }
  };
}

async function createTargetParent(repoRoot, targetParent) {
  const createdDirectories = [];
  const relativeParent = path.relative(repoRoot, targetParent);
  let current = repoRoot;
  for (const part of relativeParent ? relativeParent.split(path.sep) : []) {
    current = path.join(current, part);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) {
        throw new SyncError('TARGET_SYMLINK', `target parent must not be a symbolic link: ${current}`);
      }
      if (!stat.isDirectory()) {
        throw new SyncError('TARGET_PARENT_INVALID', `target parent is not a directory: ${current}`);
      }
    } catch (error) {
      if (!error || error.code !== 'ENOENT') throw error;
      await fs.mkdir(current);
      createdDirectories.push(current);
    }
  }
  return createdDirectories;
}

async function removeEmptyDirectories(directories) {
  for (const directory of [...directories].reverse()) {
    try {
      await fs.rmdir(directory);
    } catch (error) {
      if (!error || !['ENOENT', 'ENOTEMPTY'].includes(error.code)) throw error;
    }
  }
}

async function assertSafeTargetParent(repoRoot, target) {
  const parent = path.dirname(target);
  const relativeParent = path.relative(repoRoot, parent);
  let current = repoRoot;
  for (const part of relativeParent ? relativeParent.split(path.sep) : []) {
    current = path.join(current, part);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) {
        throw new SyncError('TARGET_SYMLINK', `target parent must not be a symbolic link: ${current}`);
      }
      if (!stat.isDirectory()) {
        throw new SyncError('TARGET_PARENT_INVALID', `target parent is not a directory: ${current}`);
      }
    } catch (error) {
      if (error && error.code === 'ENOENT') return;
      throw error;
    }
  }
}

function changedFiles(source, cloneRoot, targetCommit) {
  if (targetCommit === source.acceptedCommit) return [];
  if (isZeroCommit(source.acceptedCommit)) {
    return runGit(['ls-tree', '-r', '--name-only', targetCommit, '--', ...source.roots.map((root) => root.upstream)], { cwd: cloneRoot })
      .trim().split('\n').filter(Boolean).map((file) => `A ${file}`).sort();
  }
  return runGit(['diff', '--name-status', '--no-renames', source.acceptedCommit, targetCommit, '--', ...source.roots.map((root) => root.upstream)], { cwd: cloneRoot })
    .trim().split('\n').filter(Boolean).sort();
}

function managedFileStatuses(source, cloneRoot, targetCommit) {
  return runGit(['ls-tree', '-r', '--name-only', targetCommit, '--', ...source.roots.map((root) => root.upstream)], { cwd: cloneRoot })
    .trim().split('\n').filter(Boolean).map((file) => `A ${file}`).sort();
}

async function buildReadme({ sourceId, source, targetCommit, acceptedAt, stagedRoot, changedFiles, summary }) {
  const skills = await listSkills(stagedRoot);
  const summaryBody = summary ?? deterministicSummary(changedFiles);
  const title = `${sourceId.split(/[-_]/).map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : '').join(' ')} skills`;
  const availableSkills = skills.map(({ name, description }) => `- \`${name}\` — ${description}`).join('\n');
  const body = `# ${title}\n\nSource: ${source.repository}\nRef: ${source.ref}\nAccepted commit: ${targetCommit}\nLast successful sync: ${acceptedAt}\n\n## Available skills\n\n${availableSkills}\n\n## Update summary\n\n${summaryBody}\n`;
  return `${body}<!-- bamhub-sync-digest: ${digestText(body)} -->\n`;
}

async function readmeMatches(target, expectedReadme) {
  let readme;
  try {
    readme = await fs.readFile(path.join(target, 'README.md'), 'utf8');
  } catch {
    return false;
  }
  return readme === expectedReadme;
}

function digestText(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function listSkills(root) {
  const files = await findSkillFiles(root);
  const skills = await Promise.all(files.map(async (file) => {
    const frontMatter = await fs.readFile(file, 'utf8');
    const name = frontMatter.match(/^name:\s*(.+)\s*$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, '')
      ?? path.basename(path.dirname(file));
    const description = frontMatter.match(/^description:\s*(.+)\s*$/m)?.[1]?.trim().replace(/^['"]|['"]$/g, '')
      ?? 'No description provided.';
    return { name, description };
  }));
  return skills.sort((left, right) => left.name.localeCompare(right.name));
}

async function findSkillFiles(root) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const file = path.join(root, entry.name);
    if (entry.isFile() && entry.name === 'SKILL.md') files.push(file);
    if (entry.isDirectory()) files.push(...await findSkillFiles(file));
  }
  return files;
}

function deterministicSummary(changedFiles) {
  if (!changedFiles.length) return 'Changed files: (none)';
  return `Changed files: ${changedFiles.map((file) => `\`${file}\``).join(', ')}`;
}

async function readSummary(repoRoot, summaryFile) {
  if (!summaryFile) return null;
  const summaryPath = path.resolve(repoRoot, summaryFile);
  if (!summaryPath.startsWith(`${repoRoot}${path.sep}`)) return null;
  try {
    const body = await fs.readFile(summaryPath, 'utf8');
    return body.trim() || null;
  } catch {
    return null;
  }
}

async function writeManifest(repoRoot, manifest) {
  const manifestPath = path.join(repoRoot, 'skills', 'sources.json');
  const temporaryPath = `${manifestPath}.bamhub-skill-sync`;
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await fs.rename(temporaryPath, manifestPath);
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
}

async function pathExists(filePath) {
  try {
    await fs.lstat(filePath);
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') return false;
    throw error;
  }
}

function isZeroCommit(commit) {
  return /^0+$/.test(commit);
}

function validateSource(sourceId, source, repoRoot) {
  if (!isRecord(source) || typeof source.repository !== 'string' || !source.repository
    || typeof source.ref !== 'string' || !source.ref
    || typeof source.acceptedCommit !== 'string' || !source.acceptedCommit
    || typeof source.acceptedAt !== 'string' || !source.acceptedAt
    || !Array.isArray(source.roots) || !source.roots.length) {
    throw new SyncError('SOURCE_INVALID', `source ${sourceId} has an invalid configuration`);
  }
  const targets = [];
  for (const root of source.roots) {
    if (!isRecord(root) || typeof root.upstream !== 'string' || !root.upstream
      || typeof root.target !== 'string' || !root.target) {
      throw new SyncError('SOURCE_INVALID', `source ${sourceId} has an invalid root`);
    }
    const target = resolveTarget(repoRoot, root.target);
    if (targets.some((existing) => targetsOverlap(existing, target))) {
      throw new SyncError('TARGET_COLLISION', `source ${sourceId} target collides with another configured root: ${root.target}`);
    }
    targets.push(target);
  }
}

function targetsOverlap(left, right) {
  return left === right || left.startsWith(`${right}${path.sep}`) || right.startsWith(`${left}${path.sep}`);
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

function runGit(args, options = {}) {
  const result = spawnSync('git', args, { encoding: 'utf8', ...options });
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
    if (argument === '--force') {
      options.force = true;
      continue;
    }
    if (argument === '--summary-file') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new SyncError('OPTION_VALUE_REQUIRED', argument);
      options.summaryFile = value;
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
