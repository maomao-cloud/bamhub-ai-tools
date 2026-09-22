import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function targetError(code, message, reason = message) {
  const error = new Error(message);
  error.code = code;
  error.reason = reason;
  return error;
}

async function statDirectory(candidate) {
  try {
    const stat = await fs.stat(candidate);
    return { exists: true, directory: stat.isDirectory() };
  } catch (error) {
    if (error.code === 'ENOENT') return { exists: false, directory: false };
    if (error.code === 'ENOTDIR') return { exists: true, directory: false };
    return { exists: false, directory: false, error };
  }
}

function runtimeTarget({ id, label, targetPath, source, status }) {
  return {
    id,
    label,
    path: targetPath,
    source,
    exists: status.exists && status.directory,
    selectable: !status.exists || status.directory,
  };
}

export async function detectRuntimeTargets({ env = process.env, home = os.homedir() } = {}) {
  const homePath = path.resolve(home);
  const dshHome = env?.DSH_HOME ? path.resolve(env.DSH_HOME) : path.join(homePath, '.dsh');
  const dshSource = env?.DSH_HOME ? 'DSH_HOME' : 'DSH_HOME-fallback';
  const definitions = [
    { id: 'dsh', label: 'DSH', targetPath: path.join(dshHome, 'skills'), source: dshSource },
    { id: 'codex', label: 'Codex', targetPath: path.join(homePath, '.agents', 'skills'), source: 'HOME' },
    { id: 'claude', label: 'Claude Code', targetPath: path.join(homePath, '.claude', 'skills'), source: 'HOME' },
  ];
  return Promise.all(definitions.map(async (definition) => runtimeTarget({
    ...definition,
    status: await statDirectory(definition.targetPath),
  })));
}

async function lstatIfExists(candidate) {
  try {
    return await fs.lstat(candidate);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  }
}

function ancestors(candidate) {
  const result = [];
  let current = path.resolve(candidate);
  while (true) {
    result.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return result;
}

function isWithin(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function projectSkillPath(candidate) {
  const normalized = path.resolve(candidate);
  return normalized.endsWith(`${path.sep}.agents${path.sep}skills`)
    || normalized.endsWith(`${path.sep}.claude${path.sep}skills`);
}

async function inspectTargetPath(targetPath) {
  const absolute = path.resolve(targetPath);
  const targetStat = await lstatIfExists(absolute);
  if (targetStat?.isSymbolicLink()) {
    throw targetError('UNSAFE_TARGET', `Target rejected: target is a symlink (${absolute})`, 'target is a symlink');
  }
  if (targetStat && !targetStat.isDirectory()) {
    throw targetError('UNSAFE_TARGET', `Target rejected: target is not a directory (${absolute})`, 'target is not a directory');
  }

  const parent = path.dirname(absolute);
  for (const ancestor of ancestors(parent)) {
    const stat = await lstatIfExists(ancestor);
    if (!stat) {
      throw targetError('UNSAFE_TARGET', `Target rejected: missing parent directory (${ancestor})`, 'missing parent directory');
    }
    if (stat.isSymbolicLink()) {
      throw targetError('UNSAFE_TARGET', `Target rejected: symlink ancestor (${ancestor})`, 'symlink ancestor');
    }
    if (!stat.isDirectory()) {
      throw targetError('UNSAFE_TARGET', `Target rejected: non-directory parent (${ancestor})`, 'non-directory parent');
    }
  }

  for (const ancestor of ancestors(parent)) {
    const gitMarker = await lstatIfExists(path.join(ancestor, '.git'));
    if (gitMarker) {
      throw targetError('UNSAFE_TARGET', `Target rejected: inside Git worktree (${ancestor})`, 'inside Git worktree');
    }
  }
  return { absolute, targetStat };
}

function stateRootFor({ mode }) {
  if (mode === 'dsh') return null;
  return path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'manage-skills');
}

export async function validateTarget({ targetPath, catalogRoot, mode = 'custom' } = {}) {
  if (typeof targetPath !== 'string' || !path.isAbsolute(targetPath)) {
    throw targetError('UNSAFE_TARGET', 'Target rejected: target path must be absolute', 'target path must be absolute');
  }
  if (typeof catalogRoot !== 'string' || !path.isAbsolute(catalogRoot)) {
    throw targetError('UNSAFE_TARGET', 'Target rejected: catalog path must be absolute', 'catalog path must be absolute');
  }
  const target = path.normalize(targetPath);
  const catalog = path.normalize(catalogRoot);
  if (projectSkillPath(target)) {
    throw targetError('UNSAFE_TARGET', `Target rejected: project .agents/skills or .claude/skills (${target})`, 'project skills target');
  }

  let catalogReal;
  try {
    catalogReal = await fs.realpath(catalog);
  } catch {
    throw targetError('UNSAFE_TARGET', `Target rejected: catalog is unavailable (${catalog})`, 'catalog is unavailable');
  }
  const lexicalTarget = path.resolve(target);
  if (isWithin(lexicalTarget, catalogReal) || isWithin(catalogReal, lexicalTarget)) {
    throw targetError('UNSAFE_TARGET', `Target rejected: target and catalog overlap (${lexicalTarget}, ${catalogReal})`, 'target and catalog overlap');
  }
  const { absolute, targetStat } = await inspectTargetPath(target);
  const targetReal = targetStat ? await fs.realpath(absolute) : absolute;
  if (isWithin(targetReal, catalogReal) || isWithin(catalogReal, targetReal)) {
    throw targetError('UNSAFE_TARGET', `Target rejected: target and catalog overlap (${absolute}, ${catalogReal})`, 'target and catalog overlap');
  }

  let identity = { dev: null, ino: null };
  if (targetStat) {
    const stat = await fs.stat(absolute);
    identity = { dev: stat.dev, ino: stat.ino };
  }
  return {
    path: absolute,
    realPath: targetReal,
    ...identity,
    existed: Boolean(targetStat),
    stateRoot: stateRootFor({ mode }),
  };
}

export async function resolveTargetSelection({ runtimes = [], customPath, selectedIds = [] } = {}) {
  if (customPath !== undefined && customPath !== null && selectedIds.length > 0) {
    throw targetError('TARGET_SELECTOR_CONFLICT', 'Custom target and runtime selectors are mutually exclusive', 'custom target conflicts with runtime selector');
  }
  if (customPath !== undefined && customPath !== null) {
    if (typeof customPath !== 'string' || !path.isAbsolute(customPath)) {
      throw targetError('UNSAFE_TARGET', 'Custom target must be an absolute path', 'custom target must be absolute');
    }
    return [{ id: 'custom', label: 'Custom', path: path.normalize(customPath), source: 'custom', exists: false, selectable: true }];
  }

  const ids = [...new Set(selectedIds)];
  const byId = new Map(runtimes.map((runtime) => [runtime.id, runtime]));
  if (ids.includes('all')) {
    if (ids.length !== 1) throw targetError('TARGET_SELECTOR_CONFLICT', 'The all runtime selector cannot be combined with other selectors', 'all selector conflict');
    const standardRuntimeIds = new Set(['dsh', 'codex', 'claude']);
    return runtimes.filter((runtime) => standardRuntimeIds.has(runtime.id) && runtime.selectable);
  }
  const selected = [];
  for (const id of ids) {
    const runtime = byId.get(id);
    if (!runtime) throw targetError('UNKNOWN_RUNTIME', `Unknown runtime selector: ${id}`, 'unknown runtime');
    if (!runtime.selectable) throw targetError('UNSELECTABLE_RUNTIME', `Runtime is not selectable: ${id}`, 'runtime is not selectable');
    selected.push(runtime);
  }
  return selected;
}

export { targetError };

