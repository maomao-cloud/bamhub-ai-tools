import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const METADATA_START = '<!-- bamhub-sync-metadata:start -->';
const METADATA_END = '<!-- bamhub-sync-metadata:end -->';
const CONTENT_START = '<!-- bamhub-sync-content:start -->';
const CONTENT_END = '<!-- bamhub-sync-content:end -->';
const LEGACY_SUPERPOWERS_ZH_DESCRIPTIONS = {
  brainstorming: '在开始实现前梳理需求、方案和验收标准。',
  'dispatching-parallel-agents': '在多个互不依赖的任务可并行时分派代理。',
  'executing-plans': '在独立会话中按书面计划执行并保留审查检查点。',
  'finishing-a-development-branch': '在实现和测试完成后选择合并、PR 或保留分支的交付方式。',
  'receiving-code-review': '接收审查反馈时先验证问题，再有针对性地修复。',
  'requesting-code-review': '在完成重要改动后请求独立代码审查。',
  'subagent-driven-development': '在当前会话中按任务分派实现者并逐项复审。',
  'systematic-debugging': '遇到故障或意外行为时按系统化步骤定位原因。',
  'test-driven-development': '实现功能或修复前先编写可失败的测试。',
  'using-git-worktrees': '开始需要隔离的开发前建立或确认 Git worktree。',
  'using-superpowers': '每次对话开始时发现并调用适用的 skill。',
  'verification-before-completion': '在声明完成、提交或创建 PR 前运行新鲜验证。',
  'writing-plans': '将已确认的需求写成可执行的分步骤计划。',
  'writing-skills': '创建、修改和验证可复用 skill。'
};

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
    const managedContents = await Promise.all(targetRoots.map((target) => readManagedReadme(target)));
    const targetState = await targetsMatchAccepted(sourceId, source, cloneRoot, targetRoots);

    if (!options.force && !targetState.matches) {
      throw new SyncError('TARGET_DIRTY', `TARGET_DIRTY: source ${sourceId} has local changes under a configured target`);
    }
    if (targetCommit === currentCommit && targetState.matches && !targetState.needsReadmeMigration) {
      return {
        status: 'up-to-date',
        currentCommit,
        targetCommit,
        changedFiles: []
      };
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
    const acceptedAt = targetCommit === currentCommit
      ? source.acceptedAt
      : (typeof io.now === 'function' ? io.now().toISOString() : new Date().toISOString());
    const readmes = stagedRoots.map((stagedRoot, index) => buildReadme({
      source,
      targetCommit,
      acceptedAt,
      content: targetState.matches ? targetState.contents[index] : (managedContents[index] ?? '')
    }));
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
    await validateUpstreamRootSafety(sourceId, root.upstream, upstreamRoot);
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

async function validateUpstreamRootSafety(sourceId, configuredRoot, upstreamRoot) {
  let rootStat;
  try {
    rootStat = await fs.lstat(upstreamRoot);
  } catch (error) {
    if (error && error.code === 'ENOENT') return;
    throw error;
  }
  if (rootStat.isSymbolicLink()) {
    throw new SyncError(
      'ROOT_SYMLINK',
      `source ${sourceId} root ${configuredRoot} must not be a symbolic link`
    );
  }
  if (!rootStat.isDirectory()) return;

  const canonicalRoot = await fs.realpath(upstreamRoot);
  await validateNestedSymlinks(sourceId, configuredRoot, upstreamRoot, canonicalRoot);
}

async function validateNestedSymlinks(sourceId, configuredRoot, currentRoot, canonicalRoot) {
  const entries = await fs.readdir(currentRoot, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(currentRoot, entry.name);
    if (entry.isSymbolicLink()) {
      let canonicalTarget;
      try {
        canonicalTarget = await fs.realpath(entryPath);
      } catch (error) {
        throw new SyncError(
          'ROOT_SYMLINK_INVALID',
          `source ${sourceId} root ${configuredRoot} contains an unresolved symbolic link: ${entryPath}`
        );
      }
      if (!isWithin(canonicalRoot, canonicalTarget)) {
        throw new SyncError(
          'ROOT_SYMLINK_ESCAPE',
          `source ${sourceId} root ${configuredRoot} contains a symbolic link outside its configured root: ${entryPath}`
        );
      }
      continue;
    }
    if (entry.isDirectory()) {
      await validateNestedSymlinks(sourceId, configuredRoot, entryPath, canonicalRoot);
    }
  }
}

async function targetsMatchAccepted(sourceId, source, cloneRoot, targetRoots) {
  if (isZeroCommit(source.acceptedCommit)) {
    return {
      matches: (await Promise.all(targetRoots.map((target) => pathExists(target)))).every((exists) => !exists),
      contents: targetRoots.map(() => ''),
      needsReadmeMigration: false
    };
  }

  const expectedRoot = path.join(path.dirname(cloneRoot), 'accepted');
  try {
    runGit(['worktree', 'add', '--detach', expectedRoot, source.acceptedCommit], { cwd: cloneRoot });
  } catch {
    return { matches: false, contents: [], needsReadmeMigration: false };
  }

  try {
    const contents = [];
    let needsReadmeMigration = false;
    for (let index = 0; index < source.roots.length; index += 1) {
      const target = targetRoots[index];
      if (!await pathExists(target)) return { matches: false, contents: [], needsReadmeMigration: false };
      const expected = resolveWithin(expectedRoot, source.roots[index].upstream);
      if (!await directoryDigestMatches(target, expected)) {
        return { matches: false, contents: [], needsReadmeMigration: false };
      }
      const content = await readManagedReadme(target);
      if (content !== null) {
        const expectedReadme = buildReadme({
          source,
          targetCommit: source.acceptedCommit,
          acceptedAt: source.acceptedAt,
          content
        });
        if (!await readmeMatches(target, expectedReadme)) {
          return { matches: false, contents: [], needsReadmeMigration: false };
        }
        contents.push(content);
        continue;
      }
      const expectedLegacyReadme = await buildLegacyReadme({
        sourceId,
        source,
        targetCommit: source.acceptedCommit,
        acceptedAt: source.acceptedAt,
        stagedRoot: expected
      });
      if (!await readmeMatches(target, expectedLegacyReadme)) {
        return { matches: false, contents: [], needsReadmeMigration: false };
      }
      contents.push('');
      needsReadmeMigration = true;
    }
    return { matches: true, contents, needsReadmeMigration };
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
    .trim().split('\n').filter(Boolean).map((line) => line.replace(/\t/g, ' ')).sort();
}

function buildReadme({ source, targetCommit, acceptedAt, content }) {
  return `${METADATA_START}\n来源: ${source.repository}\n跟踪引用: ${source.ref}\n已接受提交: ${targetCommit}\n上次成功同步: ${acceptedAt}\n${METADATA_END}\n${CONTENT_START}\n${content}${CONTENT_END}\n`;
}

async function readManagedReadme(target) {
  let readme;
  try {
    readme = await fs.readFile(path.join(target, 'README.md'), 'utf8');
  } catch {
    return null;
  }
  return parseManagedReadme(readme);
}

function parseManagedReadme(readme) {
  const markers = [METADATA_START, METADATA_END, CONTENT_START, CONTENT_END];
  const positions = markers.map((marker) => readme.indexOf(marker));
  if (positions.some((position, index) => position === -1
    || readme.indexOf(markers[index], position + markers[index].length) !== -1)) {
    return null;
  }
  if (!positions.every((position, index) => index === 0 || positions[index - 1] < position)) return null;
  if (!readme.startsWith(`${METADATA_START}\n`)) return null;
  if (readme.slice(positions[1] + METADATA_END.length, positions[2]) !== '\n') return null;
  if (readme[positions[2] + CONTENT_START.length] !== '\n') return null;
  if (!readme.endsWith(`${CONTENT_END}\n`)) return null;
  return readme.slice(positions[2] + CONTENT_START.length + 1, positions[3]);
}

async function buildLegacyReadme({ sourceId, source, targetCommit, acceptedAt, stagedRoot }) {
  const skills = await listSkills(stagedRoot);
  const sourceTitle = sourceId.split(/[-_]/).map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : '').join(' ');
  const availableSkills = skills.map(({ name }) => `- \`${name}\` — ${legacySkillDescription(sourceId, name)}`).join('\n');
  const body = `# ${sourceTitle} 技能\n\n来源: ${source.repository}\n跟踪引用: ${source.ref}\n已接受提交: ${targetCommit}\n上次成功同步: ${acceptedAt}\n\n## 使用方法\n\n从下方选择匹配的 skill，阅读完整 \`SKILL.md\` 与其引用的本地资源，再按说明执行。\n\n## 适用场景\n\n${availableSkills}\n\n## 通用流程\n\n1. 选择与请求匹配的 skill。\n2. 阅读其 \`SKILL.md\` 和引用资源。\n3. 按流程执行，并运行其要求的验证。\n`;
  return `${body}<!-- bamhub-sync-digest: ${digestText(body)} -->\n`;
}

function legacySkillDescription(sourceId, name) {
  if (sourceId === 'superpowers' && LEGACY_SUPERPOWERS_ZH_DESCRIPTIONS[name]) {
    return LEGACY_SUPERPOWERS_ZH_DESCRIPTIONS[name];
  }
  return `请阅读 \`${name}/SKILL.md\` 获取完整用法。`;
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

function isWithin(basePath, candidatePath) {
  return candidatePath === basePath || candidatePath.startsWith(`${basePath}${path.sep}`);
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
    if (argument === '--summary-file') throw new SyncError('OPTION_UNKNOWN', argument);
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
