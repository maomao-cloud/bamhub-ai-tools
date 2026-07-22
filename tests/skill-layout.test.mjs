import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const categorizedSkills = [
  'skills/bamhub/architecture/code-arch/SKILL.md',
  'skills/bamhub/architecture/confirming-architecture/SKILL.md',
  'skills/bamhub/architecture/design-retrospective/SKILL.md',
  'skills/bamhub/integrations/shared-auth/SKILL.md',
  'skills/bamhub/integrations/kibana-search/SKILL.md',
  'skills/bamhub/maintenance/rule-refine/SKILL.md',
  'skills/bamhub/maintenance/sync-module-doc/SKILL.md',
  'skills/bamhub/maintenance/version-changelog/SKILL.md',
  'skills/bamhub/productivity/lyra-prompt-optimizer/SKILL.md'
];

const legacyFlatSkills = [
  'code-arch',
  'confirming-architecture',
  'design-retrospective',
  'shared-auth',
  'kibana-search',
  'rule-refine',
  'sync-module-doc',
  'version-changelog',
  'lyra-prompt-optimizer'
];

function findFiles(root) {
  const absoluteRoot = path.join(repoRoot, root);
  if (!fs.existsSync(absoluteRoot)) {
    return [];
  }

  return fs.readdirSync(absoluteRoot, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.join(root, entry.name);
    return entry.isDirectory() ? findFiles(relativePath) : [relativePath];
  });
}

test('all categorized skill roots contain SKILL.md recursively', () => {
  for (const root of ['skills/superpowers', 'skills/bamhub', 'skills/project']) {
    assert.ok(findFiles(root).some((file) => file.endsWith('/SKILL.md')));
  }
});

test('Bamhub skills use the exact categorized paths', () => {
  for (const skillPath of categorizedSkills) {
    assert.equal(fs.existsSync(path.join(repoRoot, skillPath)), true, skillPath);
  }
});

test('legacy flat Bamhub skill directories are absent', () => {
  for (const name of legacyFlatSkills) {
    assert.equal(fs.existsSync(path.join(repoRoot, 'skills', name)), false, name);
  }
});
