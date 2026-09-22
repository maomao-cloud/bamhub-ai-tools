import fs from 'node:fs/promises';
import path from 'node:path';

const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function catalogError(code, message, source) {
  const error = new Error(message);
  error.code = code;
  if (source) error.source = source;
  return error;
}

async function directoryStatus(candidate) {
  try {
    const stat = await fs.stat(candidate);
    if (!stat.isDirectory()) return { valid: false, missing: false };
    await fs.access(candidate);
    return { valid: true, missing: false };
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return { valid: false, missing: true };
    return { valid: false, missing: false };
  }
}

export async function resolveCatalog({
  explicitPath,
  env = process.env,
  scriptFile = import.meta.url,
  interactivePath,
} = {}) {
  if (explicitPath !== undefined && explicitPath !== null) {
    const root = path.resolve(explicitPath);
    const status = await directoryStatus(root);
    if (!status.valid) throw catalogError(status.missing ? 'CATALOG_NOT_FOUND' : 'CATALOG_NOT_DIRECTORY', `Invalid explicit catalog: ${root}`, 'explicit');
    return { root, source: 'explicit' };
  }

  const environmentPath = env?.MANAGE_SKILLS_CATALOG;
  if (environmentPath) {
    const root = path.resolve(environmentPath);
    const status = await directoryStatus(root);
    if (!status.valid) throw catalogError(status.missing ? 'CATALOG_NOT_FOUND' : 'CATALOG_NOT_DIRECTORY', `Invalid environment catalog: ${root}`, 'environment');
    return { root, source: 'environment' };
  }

  const scriptPath = scriptFile.startsWith('file:') ? new URL(scriptFile).pathname : scriptFile;
  const repositoryRoot = path.resolve(path.dirname(scriptPath), '..', '..', '..');
  const derived = path.join(repositoryRoot, 'skills');
  const derivedStatus = await directoryStatus(derived);
  if (derivedStatus.valid || (derivedStatus.missing && (await directoryStatus(repositoryRoot)).valid)) {
    return { root: derived, source: 'script-relative', ...(derivedStatus.missing ? { missing: true } : {}) };
  }

  if (interactivePath !== undefined && interactivePath !== null) {
    const root = path.resolve(interactivePath);
    const status = await directoryStatus(root);
    if (!status.valid) throw catalogError(status.missing ? 'CATALOG_NOT_FOUND' : 'CATALOG_NOT_DIRECTORY', `Invalid interactive catalog: ${root}`, 'interactive');
    return { root, source: 'interactive' };
  }

  return { root: derived, source: 'script-relative', missing: true };
}

async function realpathInside(candidate, root) {
  const resolved = await fs.realpath(candidate);
  const relative = path.relative(root, resolved);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function collectSymlinks(directory, links = []) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    const stat = await fs.lstat(entryPath);
    if (stat.isSymbolicLink()) {
      links.push(entryPath);
      continue;
    }
    if (stat.isDirectory()) await collectSymlinks(entryPath, links);
  }
  return links;
}

async function findSkillFiles(directory, result = []) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    const stat = await fs.lstat(entryPath);
    if (entry.name === 'SKILL.md') {
      result.push(entryPath);
    } else if (stat.isDirectory()) {
      await findSkillFiles(entryPath, result);
    }
  }
  return result;
}

function parseValue(value) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    if (trimmed.length < 2) return null;
    return trimmed.slice(1, -1);
  }
  if (trimmed.includes('\n')) return null;
  return trimmed;
}

function parseFrontmatter(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== '---') throw new Error('frontmatter must start with ---');
  const end = lines.indexOf('---', 1);
  if (end < 0) throw new Error('frontmatter must end with ---');
  const values = {};
  for (const line of lines.slice(1, end)) {
    if (!line.trim()) continue;
    if (/^\s/.test(line)) throw new Error('frontmatter must contain top-level single-line keys');
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):(?:\s*)(.*)$/);
    if (!match) throw new Error('frontmatter contains an invalid or multiline field');
    const [, key, raw] = match;
    if (key === 'name' || key === 'description') {
      if (Object.hasOwn(values, key)) throw new Error(`duplicate ${key}`);
      const value = parseValue(raw);
      if (value === null) throw new Error(`${key} must have a single-line value`);
      values[key] = value;
    }
  }
  if (!values.name) throw new Error('missing name');
  if (!values.description) throw new Error('missing description');
  if (!SKILL_NAME.test(values.name)) throw new Error('name must be kebab-case');
  return values;
}

export async function discoverCatalog({ catalogRoot }) {
  const root = await fs.realpath(path.resolve(catalogRoot));
  const invalid = [];
  const candidates = [];
  const skillFiles = await findSkillFiles(root);
  for (const skillFile of skillFiles.sort()) {
    const relativeSkillFile = path.relative(root, skillFile);
    const relativeSource = path.dirname(relativeSkillFile).split(path.sep).join('/');
    const sourceDir = path.dirname(skillFile);
    try {
      const skillStat = await fs.lstat(skillFile);
      if (!skillStat.isFile() || skillStat.isSymbolicLink()) throw new Error('SKILL.md must be a regular file, not a symlink');
      const sourceReal = await fs.realpath(sourceDir);
      if (!(await realpathInside(sourceReal, root))) throw new Error('source escapes catalog');
      const skillReal = await fs.realpath(skillFile);
      if (!(await realpathInside(skillReal, sourceReal))) throw new Error('SKILL.md escapes source bundle');
      for (const link of await collectSymlinks(sourceDir)) {
        if (!(await realpathInside(link, root))) throw new Error('bundle resource symlink escapes catalog');
      }
      const metadata = parseFrontmatter(await fs.readFile(skillFile, 'utf8'));
      const sourceIdentity = await fs.stat(sourceDir);
      candidates.push({
        ...metadata,
        sourceDir,
        skillFile,
        relativeSource,
        sourceIdentity: { dev: sourceIdentity.dev, ino: sourceIdentity.ino },
      });
    } catch (error) {
      invalid.push({ relativeSource, skillFile, reason: error.message });
    }
  }

  const byName = new Map();
  for (const skill of candidates) {
    const list = byName.get(skill.name) ?? [];
    list.push(skill);
    byName.set(skill.name, list);
  }
  const duplicates = [];
  const skills = candidates.slice();
  for (const [name, list] of byName) {
    if (list.length > 1) {
      const sources = list.map((skill) => skill.relativeSource).sort();
      duplicates.push({ name, sources });
    }
  }
  skills.sort((a, b) => a.relativeSource.localeCompare(b.relativeSource));
  duplicates.sort((a, b) => a.name.localeCompare(b.name));
  invalid.sort((a, b) => a.relativeSource.localeCompare(b.relativeSource));
  return { root, skills, invalid, duplicates };
}

export function resolveSelectors(selectors, catalog) {
  const selections = [];
  const errors = [];
  const bySource = new Map(catalog.skills.map((skill) => [skill.relativeSource, skill]));
  const byName = new Map();
  for (const skill of catalog.skills) byName.set(skill.name, [...(byName.get(skill.name) ?? []), skill]);

  for (const selector of selectors) {
    const requestedName = selector?.name;
    const sourceRelative = selector?.sourceRelative ?? selector?.source;
    let skill;
    if (sourceRelative) {
      skill = bySource.get(sourceRelative);
      if (!skill || (requestedName && skill.name !== requestedName)) {
        errors.push({ selector, reason: 'source-relative skill not found' });
        continue;
      }
    } else {
      const matches = byName.get(requestedName) ?? [];
      if (matches.length !== 1) {
        errors.push({ selector, reason: matches.length ? 'skill name is ambiguous' : 'skill name not found' });
        continue;
      }
      skill = matches[0];
    }
    const linkName = selector.linkName ?? skill.name;
    if (!SKILL_NAME.test(linkName)) {
      errors.push({ selector, reason: 'linkName must be kebab-case' });
      continue;
    }
    if (selections.some((selection) => selection.linkName === linkName)) {
      errors.push({ selector, reason: `linkName collision: ${linkName}` });
      continue;
    }
    selections.push({ ...skill, name: skill.name, sourceRelative: skill.relativeSource, linkName });
  }
  return { selections, errors };
}
