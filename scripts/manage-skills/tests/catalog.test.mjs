import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  discoverCatalog,
  resolveCatalog,
  resolveSelectors,
} from '../lib/catalog.mjs';

const tempDirs = [];

async function tempDir() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'manage-skills-catalog-'));
  tempDirs.push(directory);
  return directory;
}

async function writeSkill(root, relative, frontmatter = {}) {
  const sourceDir = path.join(root, relative);
  await fs.mkdir(sourceDir, { recursive: true });
  const content = [
    '---',
    `name: ${frontmatter.name ?? 'example-skill'}`,
    `description: ${frontmatter.description ?? 'An example skill'}`,
    '---',
    '',
    '# Skill',
    '',
  ].join('\n');
  await fs.writeFile(path.join(sourceDir, 'SKILL.md'), content);
  return sourceDir;
}

test.after(async () => {
  await Promise.all(tempDirs.map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

test('resolveCatalog applies explicit, environment, script-relative, then interactive precedence', async () => {
  const root = await tempDir();
  const explicit = path.join(root, 'explicit');
  const fromEnv = path.join(root, 'env');
  const scriptFile = path.join(root, 'repo', 'scripts', 'manage-skills', 'lib', 'catalog.mjs');
  const derived = path.join(root, 'repo', 'skills');
  const interactive = path.join(root, 'interactive');
  await Promise.all([explicit, fromEnv, interactive].map((directory) => fs.mkdir(directory, { recursive: true })));
  await fs.mkdir(path.dirname(scriptFile), { recursive: true });

  await assert.doesNotReject(async () => {
    const result = await resolveCatalog({
      explicitPath: explicit,
      env: {},
      scriptFile,
      interactivePath: interactive,
    });
    assert.equal(result.root, explicit);
    assert.equal(result.source, 'explicit');
  });
  const envResult = await resolveCatalog({
    env: { MANAGE_SKILLS_CATALOG: fromEnv },
    scriptFile,
    interactivePath: interactive,
  });
  assert.equal(envResult.root, fromEnv);
  assert.equal(envResult.source, 'environment');

  await fs.mkdir(derived, { recursive: true });
  const derivedResult = await resolveCatalog({ env: {}, scriptFile, interactivePath: interactive });
  assert.equal(derivedResult.root, derived);
  assert.equal(derivedResult.source, 'script-relative');

  await fs.rm(derived, { recursive: true });
  const missingDerived = await resolveCatalog({ env: {}, scriptFile, interactivePath: interactive });
  assert.equal(missingDerived.root, derived);
  assert.equal(missingDerived.source, 'script-relative');
  assert.equal(missingDerived.missing, true);

  await fs.rm(path.dirname(path.dirname(path.dirname(path.dirname(scriptFile)))), { recursive: true, force: true });
  const interactiveResult = await resolveCatalog({ env: {}, scriptFile, interactivePath: interactive });
  assert.equal(interactiveResult.root, interactive);
  assert.equal(interactiveResult.source, 'interactive');
});

test('resolveCatalog decodes script file URLs with spaces and non-ASCII paths', async () => {
  const root = await tempDir();
  const repositoryRoot = path.join(root, 'repo with spaces', '仓库');
  const scriptFile = path.join(repositoryRoot, 'scripts', 'manage-skills', 'lib', 'catalog.mjs');
  const derived = path.join(repositoryRoot, 'skills');
  await fs.mkdir(derived, { recursive: true });

  const result = await resolveCatalog({
    env: {},
    scriptFile: pathToFileURL(scriptFile).href,
  });

  assert.equal(result.root, derived);
  assert.equal(result.source, 'script-relative');
});

test('explicit and environment catalog paths fail without fallback and no path is created', async () => {
  const root = await tempDir();
  const missingExplicit = path.join(root, 'missing-explicit');
  const missingEnv = path.join(root, 'missing-env');
  const fallback = path.join(root, 'fallback');
  const scriptFile = path.join(root, 'repo', 'scripts', 'manage-skills', 'lib', 'catalog.mjs');
  await fs.mkdir(fallback, { recursive: true });

  await assert.rejects(
    resolveCatalog({ explicitPath: missingExplicit, env: {}, scriptFile, interactivePath: fallback }),
    (error) => error.code === 'CATALOG_NOT_FOUND' && error.source === 'explicit',
  );
  assert.equal(await fs.stat(missingExplicit).catch(() => null), null);

  await assert.rejects(
    resolveCatalog({ env: { MANAGE_SKILLS_CATALOG: missingEnv }, scriptFile, interactivePath: fallback }),
    (error) => error.code === 'CATALOG_NOT_FOUND' && error.source === 'environment',
  );
  assert.equal(await fs.stat(missingEnv).catch(() => null), null);
});

test('discoverCatalog recursively finds valid skills and parses single-line frontmatter', async () => {
  const root = await tempDir();
  const first = await writeSkill(root, 'skills/one', { name: 'one', description: 'One skill' });
  const nested = await writeSkill(root, 'skills/group/two', { name: 'two', description: 'Two skill' });
  const catalog = await discoverCatalog({ catalogRoot: root });

  assert.deepEqual(catalog.skills.map(({ name, description, relativeSource }) => ({ name, description, relativeSource })), [
    { name: 'two', description: 'Two skill', relativeSource: 'skills/group/two' },
    { name: 'one', description: 'One skill', relativeSource: 'skills/one' },
  ]);
  assert.equal(path.basename(catalog.skills[0].sourceDir), 'two');
  assert.equal(path.basename(catalog.skills[1].skillFile), 'SKILL.md');
  assert.equal(path.basename(catalog.skills[1].sourceDir), 'one');
  assert.equal(typeof catalog.skills[0].sourceIdentity.dev, 'number');
  assert.equal(typeof catalog.skills[0].sourceIdentity.ino, 'number');
});

test('discoverCatalog reports canonical source identity across a symlinked catalog alias', async () => {
  const root = await tempDir();
  const sourceDir = await writeSkill(root, 'skills/aliased', { name: 'aliased', description: 'Aliased' });
  const catalogAlias = path.join(root, 'catalog-alias');
  await fs.symlink(root, catalogAlias, 'dir');

  const canonicalCatalog = await discoverCatalog({ catalogRoot: root });
  const aliasedCatalog = await discoverCatalog({ catalogRoot: catalogAlias });
  const canonical = canonicalCatalog.skills[0];
  const aliased = aliasedCatalog.skills[0];
  const canonicalSource = await fs.realpath(sourceDir);

  assert.equal(aliasedCatalog.root, canonicalCatalog.root);
  assert.equal(canonical.sourceIdentity.canonicalPath, canonicalSource);
  assert.equal(aliased.sourceIdentity.canonicalPath, canonicalSource);
  assert.equal(aliased.sourceIdentity.dev, canonical.sourceIdentity.dev);
  assert.equal(aliased.sourceIdentity.ino, canonical.sourceIdentity.ino);
  assert.deepEqual(aliased.sourceIdentity, canonical.sourceIdentity);
});

test('discoverCatalog rejects invalid names, malformed frontmatter, duplicate names, and symlinked SKILL.md', async () => {
  const root = await tempDir();
  await writeSkill(root, 'valid', { name: 'valid', description: 'Valid' });
  await writeSkill(root, 'invalid-name', { name: 'Not Valid', description: 'Bad name' });
  const missingDescription = path.join(root, 'missing-description');
  await fs.mkdir(missingDescription, { recursive: true });
  await fs.writeFile(path.join(missingDescription, 'SKILL.md'), '---\nname: missing-description\n---\n');
  const duplicate = await writeSkill(root, 'duplicate', { name: 'valid', description: 'Duplicate' });
  const external = path.join(root, 'external.md');
  await fs.writeFile(external, '---\nname: linked\ndescription: linked\n---\n');
  const linked = path.join(root, 'linked');
  await fs.mkdir(linked, { recursive: true });
  await fs.symlink(external, path.join(linked, 'SKILL.md'));

  const outsideSource = path.join(path.dirname(root), 'outside-source');
  await writeSkill(path.dirname(root), path.basename(outsideSource), { name: 'outside-source', description: 'Outside source' });
  await fs.symlink(outsideSource, path.join(root, 'outside-source-link'), 'dir');
  const internalTarget = await writeSkill(root, 'internal-target', { name: 'internal-target', description: 'Internal target' });
  await fs.symlink(internalTarget, path.join(root, 'internal-source-link'), 'dir');

  const catalog = await discoverCatalog({ catalogRoot: root });
  assert.deepEqual(catalog.skills.map((skill) => skill.name), ['valid', 'internal-target', 'valid']);
  assert.ok(catalog.invalid.some((entry) => entry.relativeSource === 'invalid-name' && /name/i.test(entry.reason)));
  assert.ok(catalog.invalid.some((entry) => entry.relativeSource === 'missing-description' && /description|frontmatter/i.test(entry.reason)));
  assert.ok(catalog.invalid.some((entry) => entry.relativeSource === 'linked' && /regular|symlink/i.test(entry.reason)));
  assert.ok(catalog.invalid.some((entry) => entry.relativeSource === 'outside-source-link' && /outside|symlink|directory/i.test(entry.reason)));
  assert.ok(catalog.invalid.some((entry) => entry.relativeSource === 'internal-source-link' && /symlink|directory/i.test(entry.reason)));
  assert.deepEqual(catalog.duplicates, [{ name: 'valid', sources: ['duplicate', 'valid'] }]);
  assert.equal(await fs.stat(path.join(duplicate, 'SKILL.md')).then(() => true), true);
});

test('discoverCatalog rejects multiline frontmatter and symlinked resources escaping the catalog', async () => {
  const root = await tempDir();
  const multiline = path.join(root, 'multiline');
  await fs.mkdir(multiline, { recursive: true });
  await fs.writeFile(path.join(multiline, 'SKILL.md'), '---\nname: multiline\ndescription: >\n  no\n---\n');
  const escaped = await writeSkill(root, 'escaped', { name: 'escaped', description: 'Escaped resource' });
  const outside = path.join(path.dirname(root), 'outside-resource.txt');
  await fs.writeFile(outside, 'outside');
  await fs.symlink(outside, path.join(escaped, 'resource.txt'));
  const nestedLinks = await writeSkill(root, 'nested-links', { name: 'nested-links', description: 'Nested links' });
  const resourceDirectory = path.join(root, 'resource-directory');
  await fs.mkdir(resourceDirectory);
  const nestedOutside = path.join(path.dirname(root), 'nested-outside-resource.txt');
  await fs.writeFile(nestedOutside, 'outside');
  await fs.symlink(nestedOutside, path.join(resourceDirectory, 'nested-resource.txt'));
  await fs.symlink(resourceDirectory, path.join(nestedLinks, 'nested-directory'), 'dir');

  const catalog = await discoverCatalog({ catalogRoot: root });
  assert.equal(catalog.skills.length, 0);
  assert.ok(catalog.invalid.some((entry) => entry.relativeSource === 'multiline' && /frontmatter|single-line/i.test(entry.reason)));
  assert.ok(catalog.invalid.some((entry) => entry.relativeSource === 'escaped' && /outside|escape|catalog/i.test(entry.reason)));
  assert.ok(catalog.invalid.some((entry) => entry.relativeSource === 'nested-links' && /outside|escape|catalog/i.test(entry.reason)));
});

test('discoverCatalog requires frontmatter quotes to match exactly without trailing content', async () => {
  const root = await tempDir();
  const cases = [
    ['mismatched', "name: 'mismatched\ndescription: \"Description'"],
    ['trailing', 'name: "trailing" extra\ndescription: Description'],
    ['single-trailing', "name: 'single' trailing\ndescription: Description"],
  ];
  for (const [relative, fields] of cases) {
    const sourceDir = path.join(root, relative);
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(path.join(sourceDir, 'SKILL.md'), `---\n${fields}\n---\n`);
  }
  await writeSkill(root, 'quoted-valid', { name: 'quoted-valid', description: '"Quoted description"' });

  const catalog = await discoverCatalog({ catalogRoot: root });

  assert.deepEqual(catalog.skills.map((skill) => skill.name), ['quoted-valid']);
  for (const [relative] of cases) {
    assert.ok(catalog.invalid.some((entry) => entry.relativeSource === relative && /quote|single-line|frontmatter/i.test(entry.reason)));
  }
});

test('resolveSelectors resolves unique names and source-relative selectors, validates link names, and reports collisions', async () => {
  const root = await tempDir();
  await writeSkill(root, 'skills/a/one', { name: 'shared', description: 'A' });
  await writeSkill(root, 'skills/b/two', { name: 'shared', description: 'B' });
  await writeSkill(root, 'skills/three', { name: 'unique', description: 'Unique' });
  const catalog = await discoverCatalog({ catalogRoot: root });

  const result = resolveSelectors([
    { name: 'unique' },
    { name: 'shared' },
    { name: 'shared', sourceRelative: 'skills/a/one', linkName: 'alias-one' },
    { name: 'unique', linkName: 'bad_alias' },
    { name: 'unique', linkName: 'alias-one' },
    { name: 'missing' },
  ], catalog);
  assert.deepEqual(result.selections.map(({ name, sourceRelative, linkName }) => ({ name, sourceRelative, linkName })), [
    { name: 'unique', sourceRelative: 'skills/three', linkName: 'unique' },
    { name: 'shared', sourceRelative: 'skills/a/one', linkName: 'alias-one' },
  ]);
  assert.ok(result.errors.some((error) => /ambiguous/i.test(error.reason)));
  assert.ok(result.errors.some((error) => /linkName|kebab/i.test(error.reason)));
  assert.ok(result.errors.some((error) => /collision|duplicate/i.test(error.reason)));
  assert.ok(result.errors.some((error) => /not found|unknown/i.test(error.reason)));

  const qualified = resolveSelectors([{ name: 'shared', sourceRelative: 'skills/b/two' }], catalog);
  assert.equal(qualified.errors.length, 0);
  assert.equal(qualified.selections[0].sourceRelative, 'skills/b/two');

  const legacy = resolveSelectors([{ name: 'unique', source: 'skills/three' }], catalog);
  assert.equal(legacy.selections.length, 0);
  assert.equal(legacy.errors.length, 1);
  assert.match(legacy.errors[0].reason, /source.?relative/i);
});
