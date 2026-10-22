import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const categorizedSkills = [
  'skills/bamhub/architecture/design-retrospective/SKILL.md',
  'skills/bamhub/architecture/playbook-design/SKILL.md',
  'skills/bamhub/integrations/ai-capability/SKILL.md',
  'skills/bamhub/integrations/shared-auth/SKILL.md',
  'skills/bamhub/integrations/kibana-search/SKILL.md',
  'skills/bamhub/integrations/yunxiao-pipeline/SKILL.md',
  'skills/bamhub/maintenance/rule-refine/SKILL.md',
  'skills/bamhub/maintenance/code-simplification-review/SKILL.md',
  'skills/bamhub/maintenance/project-finish-quality-gate/SKILL.md',
  'skills/bamhub/maintenance/sync-module-doc/SKILL.md',
  'skills/bamhub/maintenance/version-changelog/SKILL.md',
  'skills/bamhub/productivity/goal-auto/SKILL.md'
];

const legacyFlatSkills = [
  'design-retrospective',
  'playbook-design',
  'shared-auth',
  'kibana-search',
  'rule-refine',
  'sync-module-doc',
  'version-changelog'
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
  for (const root of ['skills/superpowers', 'skills/caveman', 'skills/addyosmani', 'skills/darwin', 'skills/bamhub', 'skills/project']) {
    assert.ok(findFiles(root).some((file) => file.endsWith('/SKILL.md')));
  }
});

test('Bamhub skills use the exact categorized paths', () => {
  const actualSkills = findFiles('skills/bamhub')
    .filter((file) => file.endsWith('/SKILL.md'))
    .sort();

  assert.deepEqual(actualSkills, [...categorizedSkills].sort());
});

test('project skills use the exact categorized paths', () => {
  assert.equal(
    fs.existsSync(path.join(repoRoot, 'skills/project/darwin-skill-optimizer/SKILL.md')),
    true
  );
});

test('Bamhub finish skills reference the Addy upstream without importing runtime hooks', () => {
  const simplify = fs.readFileSync(path.join(repoRoot, 'skills/bamhub/maintenance/code-simplification-review/SKILL.md'), 'utf8');
  const gate = fs.readFileSync(path.join(repoRoot, 'skills/bamhub/maintenance/project-finish-quality-gate/SKILL.md'), 'utf8');
  assert.match(simplify, /skills\/addyosmani\/code-simplification\/SKILL\.md/);
  assert.match(simplify, /行为|错误处理|副作用/);
  assert.match(gate, /verification-before-completion/);
  assert.match(gate, /code-simplification-review/);
  assert.match(gate, /PASS_WITH_NOTES/);
  assert.doesNotMatch(gate, /simplify-ignore\.sh/);
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

test('rule-refine keeps neutral governance routing', () => {
  const ruleRefine = fs.readFileSync(
    path.join(repoRoot, 'skills/bamhub/maintenance/rule-refine/SKILL.md'),
    'utf8'
  );

  assert.match(ruleRefine, /<repo>\/\.project\/rules\/\*\.md/);
  assert.match(ruleRefine, /<repo>\/\.project\/README\.md/);
  assert.match(ruleRefine, /<module>\/README\.md/);
  assert.match(ruleRefine, /事实规则/);
  assert.match(ruleRefine, /决策规则/);
  assert.match(ruleRefine, /偏好原则/);
  assert.match(ruleRefine, /删除该条内容/);
  assert.match(ruleRefine, /不得创建 `\.claude\/`、`\.codex\//);
  assert.match(ruleRefine, /稳定的模块职责、边界和依赖事实应归入模块 README/);
  assert.match(ruleRefine, /项目索引或模块 README 候选保留可由证据支撑的稳定事实/);
});

test('Darwin optimizer maps upstream workflow to Bamhub-owned skill paths', () => {
  const optimizer = fs.readFileSync(
    path.join(repoRoot, 'skills/project/darwin-skill-optimizer/SKILL.md'),
    'utf8'
  );
  for (const required of [
    'skills/darwin/SKILL.md',
    'skills/bamhub/**/SKILL.md',
    'skills/bamhub/maintenance/**/SKILL.md',
    'docs/skill-optimization/results.tsv',
    'docs/skill-optimization/cards/',
    'test-prompts.json',
    'git revert',
    'full_test',
    'dry_run'
  ]) assert.match(optimizer, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  for (const excluded of ['skills/superpowers/', 'skills/caveman/', 'skills/darwin/']) {
    assert.match(optimizer, new RegExp(`不得优化.*${excluded.replace('/', '\\/')}`));
  }
  assert.match(optimizer, /用户确认|CHECKPOINT/);
});

test('yunxiao-pipeline keeps the verified MCP usage contract', () => {
  const skill = fs.readFileSync(
    path.join(repoRoot, 'skills/bamhub/integrations/yunxiao-pipeline/SKILL.md'),
    'utf8'
  );

  // 认证与组织解析：必须用 get_user_organizations，而不是会 403 的 get_current_*
  assert.match(skill, /get_user_organizations/);
  assert.match(skill, /get_current_user/);
  assert.match(skill, /get_current_organization_info/);
  assert.match(skill, /403/);

  // 列表接口选择：首选 smart_list_pipelines + all time
  assert.match(skill, /smart_list_pipelines/);
  assert.match(skill, /timeReference/);
  assert.match(skill, /all time/);

  // 已复现的参数陷阱
  assert.match(skill, /createEndTime|executeEndTime/);
  assert.match(skill, /pagination\.total/);
  assert.match(skill, /list_pipeline_runs/);
  assert.match(skill, /triggerMode/);

  // 触发与轮询
  assert.match(skill, /create_pipeline_run/);
  assert.match(skill, /get_pipeline_run/);
  assert.match(skill, /environmentVariables/);

  // 空结果必须有有序排查与停止条件，不能凭单次空结果下结论
  assert.match(skill, /## 空结果排查/);
  assert.match(skill, /停止条件/);
  assert.match(skill, /两个列表接口都返回空/);

  // 结论有时效性声明，避免绝对化断言被当成永久事实
  assert.match(skill, /以实际返回为准/);

  // 边界：无用量接口、不写死环境事实
  assert.match(skill, /没有用量\/核分查询接口/);
  assert.match(skill, /不要写死/);
});

test('repository docs identify all managed and owned skill roots', () => {
  const agents = fs.readFileSync(path.join(repoRoot, 'AGENTS.md'), 'utf8');
  const claude = fs.readFileSync(path.join(repoRoot, 'CLAUDE.md'), 'utf8');
  const readme = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
  assert.match(agents, /skills\/superpowers/);
  assert.match(agents, /skills\/caveman/);
  assert.match(agents, /skills\/darwin/);
  assert.match(agents, /skills\/bamhub/);
  assert.match(agents, /skills\/project\/sync-upstream-skills/);
  assert.match(agents, /不提供这些兼容路径|旧平级路径/);
  assert.doesNotMatch(agents, /兼容别名/);
  assert.match(agents, /GitHub Actions/);
  for (const document of [agents, claude, readme]) {
    assert.match(document, /skills\/caveman/);
    assert.match(document, /(?:上游 Caveman|上游 \[Caveman\])/);
    assert.match(document, /(?:禁止直接修改|不要直接修改|不直接编辑)/);
    assert.match(document, /(?:上游 Darwin|上游 \[Darwin\])/);
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
  assert.match(workflow, /cron: '0 16 \* \* \*'/);
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
