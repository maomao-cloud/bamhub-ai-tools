const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const repoRoot = join(__dirname, '..', '..');

function readSkill(relativePath) {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

test('skill docs keep auth runtime state repository-local', () => {
  const sharedAuth = readSkill('skills/bamhub/integrations/shared-auth/SKILL.md');
  const kibanaSearch = readSkill('skills/bamhub/integrations/kibana-search/SKILL.md');

  assert.doesNotMatch(sharedAuth, /~\/\.claude/);
  assert.doesNotMatch(kibanaSearch, /~\/\.claude/);
});

test('shared-auth skill documents repository-local headless and import auth storage', () => {
  const content = readSkill('skills/bamhub/integrations/shared-auth/SKILL.md');

  assert.match(content, /skills\/bamhub\/integrations\/shared-auth\/\.local\/credentials\.json/);
  assert.match(content, /headless/i);
  assert.match(content, /--mode import/);
  assert.match(content, /hermes-agent|CI|remote|headless/i);
});

test('kibana-search skill documents log query and shared-auth login commands', () => {
  const content = readSkill('skills/bamhub/integrations/kibana-search/SKILL.md');

  assert.match(content, /bash skills\/bamhub\/integrations\/kibana-search\/scripts\/kibana-search logs/);
  assert.match(content, /skills\/bamhub\/integrations\/shared-auth\/scripts\/auth login/);
  assert.match(content, /auth\.profile|shared-auth/);
  assert.match(content, /raw logs|原始日志/i);
  assert.match(content, /add interpretation separately only if asked/i);
  assert.doesNotMatch(content, /always summarize|must summarize|summary-only/i);
  assert.match(content, /hermes-agent|CI|remote|headless/i);
});
