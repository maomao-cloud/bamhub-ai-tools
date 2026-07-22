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
  for (const root of ['skills/superpowers', 'skills/caveman', 'skills/bamhub', 'skills/project']) {
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

test('legacy brainstorming paths are absent', () => {
  assert.equal(fs.existsSync(path.join(repoRoot, 'skills/brainstorming')), false);
  assert.equal(fs.existsSync(path.join(repoRoot, 'skills/brainstorming/visual-companion.md')), false);
});

test('repository docs identify all managed and owned skill roots', () => {
  const agents = fs.readFileSync(path.join(repoRoot, 'AGENTS.md'), 'utf8');
  const claude = fs.readFileSync(path.join(repoRoot, 'CLAUDE.md'), 'utf8');
  const readme = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
  assert.match(agents, /skills\/superpowers/);
  assert.match(agents, /skills\/caveman/);
  assert.match(agents, /skills\/bamhub/);
  assert.match(agents, /skills\/project\/sync-upstream-skills/);
  assert.match(agents, /不提供这些兼容路径|旧平级路径/);
  assert.doesNotMatch(agents, /兼容别名/);
  assert.match(agents, /GitHub Actions/);
  for (const document of [agents, claude, readme]) {
    assert.match(document, /skills\/caveman/);
    assert.match(document, /(?:上游 Caveman|上游 \[Caveman\])/);
    assert.match(document, /(?:禁止直接修改|不要直接修改|不直接编辑)/);
  }
  assert.match(readme, /cavecrew/);
  assert.match(readme, /caveman-stats/);
  assert.match(readme, /caveman-compress/);
  assert.match(readme, /运行时集成/);
  assert.match(readme, /相对链接/);
  assert.match(readme, /运行时应用数据目录/);
});

test('scheduled workflow runs hosted checks and opens PRs without local schedulers', () => {
  const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/sync-skills.yml'), 'utf8');
  assert.match(workflow, /schedule:/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /create-pull-request/);
  assert.doesNotMatch(workflow, /launchd|crontab/);
});

test('scheduled workflow keeps sync reports outside the checkout', () => {
  const workflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/sync-skills.yml'), 'utf8');

  assert.match(workflow, /apply --all > "\$RUNNER_TEMP\/sync-report\.json"/);
  assert.match(workflow, /cat "\$RUNNER_TEMP\/sync-report\.json"/);
  assert.match(workflow, /path: \$\{\{ runner\.temp \}\}\/sync-report\.json/);
  assert.doesNotMatch(workflow, /> sync-report\.json/);
  assert.doesNotMatch(workflow, /path: sync-report\.json/);
  assert.doesNotMatch(workflow, /path: \$RUNNER_TEMP\/sync-report\.json/);
});
