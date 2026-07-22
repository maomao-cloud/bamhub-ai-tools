import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function assertJsonTemplate(path) {
  assert.equal(fs.existsSync(path), true);
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(path, 'utf8')));
}

test('runtime skill directories are present and ignored', () => {
  assert.equal(fs.existsSync('skills/bamhub/integrations/shared-auth/.local/.gitkeep'), true);
  assert.equal(fs.existsSync('skills/bamhub/integrations/kibana-search/.local/.gitkeep'), true);

  assertJsonTemplate('skills/bamhub/integrations/shared-auth/templates/auth-config.example.json');
  assertJsonTemplate('skills/bamhub/integrations/kibana-search/templates/config.example.json');

  const gitignore = fs.readFileSync('.gitignore', 'utf8');
  assert.match(gitignore, /^skills\/bamhub\/integrations\/shared-auth\/.local\/\*$/m);
  assert.match(gitignore, /^!skills\/bamhub\/integrations\/shared-auth\/.local\/\.gitkeep$/m);
  assert.match(gitignore, /^skills\/bamhub\/integrations\/kibana-search\/.local\/\*$/m);
  assert.match(gitignore, /^!skills\/bamhub\/integrations\/kibana-search\/.local\/\.gitkeep$/m);
});
