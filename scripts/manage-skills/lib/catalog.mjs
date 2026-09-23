import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

  const scriptPath = scriptFile.startsWith('file:') ? fileURLToPath(scriptFile) : scriptFile;
  const scriptDirectory = path.dirname(scriptPath);
  const repositoryRoot = path.basename(scriptDirectory) === 'manage-skills'
    ? path.resolve(scriptDirectory, '..', '..')
    : path.resolve(scriptDirectory, '..', '..', '..');
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

export async function scanBundleSymlinks(directory, root) {
  const links = await collectSymlinks(directory, path.resolve(root));
  const results = [];
  for (const link of links) {
    results.push({ path: link, target: await fs.realpath(link).catch(() => null) });
  }
  return results;
}

async function collectSymlinks(directory, root, links = [], visited = new Set()) {
  let canonicalDirectory;
  try {
    canonicalDirectory = await fs.realpath(directory);
  } catch {
    return links;
  }
  if (visited.has(canonicalDirectory)) return links;
  visited.add(canonicalDirectory);

  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    const stat = await fs.lstat(entryPath);
    if (stat.isSymbolicLink()) {
      links.push(entryPath);
      let target;
      try {
        target = await fs.realpath(entryPath);
      } catch {
        continue;
      }
      const targetStat = await fs.stat(entryPath);
      if (targetStat.isDirectory() && await realpathInside(target, root)) {
        await collectSymlinks(target, root, links, visited);
      }
      continue;
    }
    if (stat.isDirectory()) await collectSymlinks(entryPath, root, links, visited);
  }
  return links;
}

async function findSkillFiles(directory, root, result = [], invalid = []) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    const stat = await fs.lstat(entryPath);
    if (entry.name === 'SKILL.md') {
      result.push(entryPath);
    } else if (stat.isSymbolicLink()) {
      let targetStat;
      try {
        targetStat = await fs.stat(entryPath);
      } catch {
        invalid.push({
          relativeSource: path.relative(root, entryPath).split(path.sep).join('/'),
          skillFile: null,
          reason: 'symlink directory target is unavailable',
        });
        continue;
      }
      if (!targetStat.isDirectory()) continue;
      let reason = 'symlink directory is not allowed';
      try {
        const target = await fs.realpath(entryPath);
        if (!(await realpathInside(target, root))) reason = 'symlink directory escapes catalog';
      } catch {
        reason = 'symlink directory target is unavailable';
      }
      invalid.push({
        relativeSource: path.relative(root, entryPath).split(path.sep).join('/'),
        skillFile: null,
        reason,
      });
    } else if (stat.isDirectory()) {
      await findSkillFiles(entryPath, root, result, invalid);
    }
  }
  return { skillFiles: result, invalid };
}

function parseScalar(value, key) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${key} must have a value`);
  const quote = trimmed[0];
  if (quote === "'") {
    let result = '';
    for (let index = 1; index < trimmed.length; index += 1) {
      const character = trimmed[index];
      if (character !== "'") {
        result += character;
        continue;
      }
      if (trimmed[index + 1] === "'") {
        result += "'";
        index += 1;
        continue;
      }
      if (index !== trimmed.length - 1) throw new Error(`${key} has invalid quotes`);
      return result;
    }
    throw new Error(`${key} has mismatched quotes`);
  }
  if (quote === '"') {
    let result = '';
    for (let index = 1; index < trimmed.length; index += 1) {
      const character = trimmed[index];
      if (character === '"') {
        if (index !== trimmed.length - 1) throw new Error(`${key} has trailing content`);
        return result;
      }
      if (character !== '\\') {
        result += character;
        continue;
      }
      const escaped = trimmed[++index];
      const escapes = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
      if (escaped === 'u') {
        const code = trimmed.slice(index + 1, index + 5);
        if (!/^[0-9a-fA-F]{4}$/.test(code)) throw new Error(`${key} has invalid escape`);
        result += String.fromCharCode(Number.parseInt(code, 16));
        index += 4;
      } else if (Object.hasOwn(escapes, escaped)) {
        result += escapes[escaped];
      } else {
        throw new Error(`${key} has invalid escape`);
      }
    }
    throw new Error(`${key} has mismatched quotes`);
  }
  if (trimmed.includes('\n')) throw new Error(`${key} must be scalar`);
  return trimmed;
}

function parseBlock(lines, start, indicator) {
  const content = [];
  let index = start;
  let indent;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      content.push('');
      index += 1;
      continue;
    }
    const match = line.match(/^(\s+)/);
    if (!match) break;
    const currentIndent = match[1].length;
    indent ??= currentIndent;
    if (currentIndent < indent) break;
    content.push(line.slice(indent));
    index += 1;
  }
  if (content.length === 0 || !content.some((line) => line.trim())) throw new Error('block scalar must have indented content');
  const literal = indicator.startsWith('|');
  let value = literal ? content.join('\n') : content.reduce((result, line, lineIndex) => {
    if (!line) return `${result}\n`;
    if (!result || result.endsWith('\n')) return result + line;
    return `${result} ${line}`;
  }, '');
  const chomp = indicator.slice(1);
  if (chomp === '-') value = value.replace(/\n+$/, '');
  else if (chomp !== '+') value = `${value.replace(/\n*$/, '')}\n`;
  return { value, next: index };
}

function parseFrontmatter(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== '---') throw new Error('frontmatter must start with ---');
  const values = {};
  let index = 1;
  let closed = false;
  while (index < lines.length) {
    const line = lines[index];
    if (line === '---') { closed = true; break; }
    if (!line.trim()) { index += 1; continue; }
    if (/^\s/.test(line)) { index += 1; continue; }
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):(?:\s*)(.*)$/);
    if (!match) throw new Error('frontmatter contains an invalid field');
    const [, key, raw] = match;
    if (key === 'name' || key === 'description') {
      if (Object.hasOwn(values, key)) throw new Error(`duplicate ${key}`);
      if (/^[>|][+-]?$/.test(raw.trim())) {
        const block = parseBlock(lines, index + 1, raw.trim());
        values[key] = block.value;
        index = block.next;
        continue;
      }
      values[key] = parseScalar(raw, key);
    }
    index += 1;
  }
  if (!closed) throw new Error('frontmatter must end with ---');
  if (!values.name) throw new Error('missing name');
  if (!values.description) throw new Error('missing description');
  if (!SKILL_NAME.test(values.name)) throw new Error('name must be kebab-case');
  return values;
}

export async function discoverCatalog({ catalogRoot }) {
  const root = await fs.realpath(path.resolve(catalogRoot));
  const invalid = [];
  const candidates = [];
  const discovered = await findSkillFiles(root, root);
  invalid.push(...discovered.invalid);
  for (const skillFile of discovered.skillFiles.sort()) {
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
      for (const link of await collectSymlinks(sourceDir, root)) {
        if (!(await realpathInside(link, root))) throw new Error('bundle resource symlink escapes catalog');
      }
      const metadata = parseFrontmatter(await fs.readFile(skillFile, 'utf8'));
      const sourceIdentity = await fs.stat(sourceDir);
      candidates.push({
        ...metadata,
        sourceDir,
        skillFile,
        relativeSource,
        sourceIdentity: {
          canonicalPath: sourceReal,
          dev: sourceIdentity.dev,
          ino: sourceIdentity.ino,
        },
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
    if (Object.hasOwn(selector ?? {}, 'source')) {
      errors.push({ selector, reason: 'sourceRelative is required' });
      continue;
    }
    const hasSourceRelative = Object.hasOwn(selector ?? {}, 'sourceRelative');
    const sourceRelative = selector?.sourceRelative;
    let skill;
    if (hasSourceRelative && !sourceRelative) {
      errors.push({ selector, reason: 'sourceRelative must not be empty' });
      continue;
    }
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
