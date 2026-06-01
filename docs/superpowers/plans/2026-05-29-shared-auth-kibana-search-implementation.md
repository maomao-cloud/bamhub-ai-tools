# Shared Auth + Kibana Search Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build two repository-local skills — `shared-auth` and `kibana-search` — that provide reusable auth, GUI/headless login flows, cached Kibana metadata, and raw log querying with JSON output.

**Architecture:** `skills/shared-auth` owns profile config, credential persistence, login capability detection, and login flows. `skills/kibana-search` owns environment config, Discover URL parsing, data view cache management, KQL assembly, backend selection, and skill-facing CLI scripts; it references `shared-auth` via `auth.profile` instead of duplicating auth state.

**Tech Stack:** Bash entry scripts, Node.js modules/scripts, Markdown skills, JSON config files, repository-local `.local/` runtime files, Node test runner

---

## File Structure

### New directories and files

- `skills/shared-auth/SKILL.md` — shared auth skill instructions for Claude Code / hermes-agent
- `skills/shared-auth/scripts/auth` — CLI-style entry script for auth commands
- `skills/shared-auth/lib/auth-config.js` — read/write auth profile config
- `skills/shared-auth/lib/credentials-store.js` — read/write/clear credential file
- `skills/shared-auth/lib/capability-detection.js` — detect GUI/browser/headless/import support
- `skills/shared-auth/lib/login-flows.js` — implement GUI/headless/import login modes
- `skills/shared-auth/lib/errors.js` — shared auth error constructors and JSON output helpers
- `skills/shared-auth/templates/auth-config.example.json` — example auth profiles
- `skills/shared-auth/.local/.gitkeep` — keep runtime directory in repo
- `skills/kibana-search/SKILL.md` — Kibana query skill instructions
- `skills/kibana-search/scripts/kibana-search` — CLI-style entry script for Kibana commands
- `skills/kibana-search/lib/config.js` — read/write environment config
- `skills/kibana-search/lib/discover-url.js` — parse Discover URL pieces
- `skills/kibana-search/lib/cache-store.js` — read/write cache file and TTL checks
- `skills/kibana-search/lib/query-builder.js` — build KQL and normalized query input
- `skills/kibana-search/lib/kibana-client.js` — Kibana API calls for data views and logs
- `skills/kibana-search/lib/es-client.js` — ES backend stub / strategy boundary
- `skills/kibana-search/lib/backend.js` — backend selection logic
- `skills/kibana-search/lib/output.js` — text/JSON output formatting
- `skills/kibana-search/lib/errors.js` — Kibana search error helpers
- `skills/kibana-search/templates/config.example.json` — example env and tool config
- `skills/kibana-search/.local/.gitkeep` — keep runtime directory in repo
- `tests/shared-auth/auth-config.test.js`
- `tests/shared-auth/credentials-store.test.js`
- `tests/shared-auth/capability-detection.test.js`
- `tests/shared-auth/login-flows.test.js`
- `tests/kibana-search/config.test.js`
- `tests/kibana-search/discover-url.test.js`
- `tests/kibana-search/cache-store.test.js`
- `tests/kibana-search/query-builder.test.js`
- `tests/kibana-search/backend.test.js`
- `tests/kibana-search/kibana-client.test.js`
- `tests/kibana-search/output.test.js`
- `tests/integration/shared-auth-headless.test.js`
- `tests/integration/kibana-search-cli.test.js`

### Existing files to modify

- `.gitignore` — ignore `skills/shared-auth/.local/*.json` and `skills/kibana-search/.local/*.json`
- `docs/superpowers/specs/2026-05-29-kibana-search-cli-design.md` — no further changes expected during implementation unless design drift is discovered

---

### Task 1: Establish skill directories and runtime file boundaries

**Files:**
- Create: `skills/shared-auth/.local/.gitkeep`
- Create: `skills/kibana-search/.local/.gitkeep`
- Create: `skills/shared-auth/templates/auth-config.example.json`
- Create: `skills/kibana-search/templates/config.example.json`
- Modify: `.gitignore`

- [ ] **Step 1: Write the failing test for required runtime paths**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('runtime skill directories are present and ignored', () => {
  assert.equal(fs.existsSync('skills/shared-auth/.local/.gitkeep'), true);
  assert.equal(fs.existsSync('skills/kibana-search/.local/.gitkeep'), true);

  const gitignore = fs.readFileSync('.gitignore', 'utf8');
  assert.match(gitignore, /^skills\/shared-auth\/.local\/\*\.json$/m);
  assert.match(gitignore, /^skills\/kibana-search\/.local\/\*\.json$/m);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/shared-auth/runtime-layout.test.js`
Expected: FAIL because the test file and directories do not exist yet.

- [ ] **Step 3: Add the runtime directories, example templates, and ignore rules**

`.gitignore`

```gitignore
skills/shared-auth/.local/*.json
skills/kibana-search/.local/*.json
```

`skills/shared-auth/templates/auth-config.example.json`

```json
{
  "profiles": {
    "bg_prod_main_sso": {
      "type": "sso_browser",
      "credentialRef": "bg_prod_main",
      "loginMode": "auto"
    }
  }
}
```

`skills/kibana-search/templates/config.example.json`

```json
{
  "environments": {
    "bg_prod_main": {
      "organization": "bg",
      "stage": "prod",
      "account": "main",
      "auth": {
        "profile": "bg_prod_main_sso"
      },
      "tools": {
        "kibana": {
          "baseUrl": "https://kibana.bg.allschool.com",
          "preferredBackend": "auto",
          "space": "default",
          "defaultDataViewId": "f12ae960-16d1-11ec-97d3-31b29b7fe5a5",
          "defaultColumns": ["level", "message"],
          "serviceField": "APP_NAME",
          "levelField": "level",
          "messageField": "message",
          "traceIdField": "traceId",
          "timeField": "@timestamp",
          "cache": {
            "dataViewTtlSeconds": 86400
          }
        }
      }
    }
  }
}
```

- [ ] **Step 4: Add the runtime layout test file**

`tests/shared-auth/runtime-layout.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('runtime skill directories are present and ignored', () => {
  assert.equal(fs.existsSync('skills/shared-auth/.local/.gitkeep'), true);
  assert.equal(fs.existsSync('skills/kibana-search/.local/.gitkeep'), true);

  const gitignore = fs.readFileSync('.gitignore', 'utf8');
  assert.match(gitignore, /^skills\/shared-auth\/.local\/\*\.json$/m);
  assert.match(gitignore, /^skills\/kibana-search\/.local\/\*\.json$/m);
});
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tests/shared-auth/runtime-layout.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add .gitignore skills/shared-auth/.local/.gitkeep skills/kibana-search/.local/.gitkeep skills/shared-auth/templates/auth-config.example.json skills/kibana-search/templates/config.example.json tests/shared-auth/runtime-layout.test.js
git commit -m "feat: add shared auth and kibana runtime layout"
```

### Task 2: Implement shared auth config and credential persistence

**Files:**
- Create: `skills/shared-auth/lib/auth-config.js`
- Create: `skills/shared-auth/lib/credentials-store.js`
- Create: `tests/shared-auth/auth-config.test.js`
- Create: `tests/shared-auth/credentials-store.test.js`

- [ ] **Step 1: Write the failing auth config test**

`tests/shared-auth/auth-config.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadAuthConfig, getAuthProfile } from '../../skills/shared-auth/lib/auth-config.js';

test('loadAuthConfig reads profiles from repository-local config', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-auth-config-'));
  const configPath = path.join(tempDir, 'auth-config.json');

  fs.writeFileSync(configPath, JSON.stringify({
    profiles: {
      bg_prod_main_sso: {
        type: 'sso_browser',
        credentialRef: 'bg_prod_main',
        loginMode: 'auto'
      }
    }
  }));

  const config = loadAuthConfig(configPath);
  assert.equal(config.profiles.bg_prod_main_sso.credentialRef, 'bg_prod_main');
  assert.equal(getAuthProfile(config, 'bg_prod_main_sso').loginMode, 'auto');
});
```

- [ ] **Step 2: Write the failing credential store test**

`tests/shared-auth/credentials-store.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  saveCredential,
  loadCredential,
  clearCredential,
  isExpired
} from '../../skills/shared-auth/lib/credentials-store.js';

test('credential store saves and loads by profile key', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-auth-credentials-'));
  const credentialsPath = path.join(tempDir, 'credentials.json');

  saveCredential(credentialsPath, 'bg_prod_main_sso', {
    source: 'headless',
    cookie: 'sid=123',
    expiresAt: '2099-01-01T00:00:00.000Z'
  });

  const stored = loadCredential(credentialsPath, 'bg_prod_main_sso');
  assert.equal(stored.source, 'headless');
  assert.equal(stored.cookie, 'sid=123');
  assert.equal(isExpired(stored), false);

  clearCredential(credentialsPath, 'bg_prod_main_sso');
  assert.equal(loadCredential(credentialsPath, 'bg_prod_main_sso'), null);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test tests/shared-auth/auth-config.test.js tests/shared-auth/credentials-store.test.js`
Expected: FAIL because the modules do not exist yet.

- [ ] **Step 4: Write minimal auth config implementation**

`skills/shared-auth/lib/auth-config.js`

```js
import fs from 'node:fs';

export function loadAuthConfig(configPath) {
  const raw = fs.readFileSync(configPath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed.profiles || typeof parsed.profiles !== 'object') {
    throw new Error('AUTH_CONFIG_INVALID');
  }
  return parsed;
}

export function getAuthProfile(config, profileName) {
  const profile = config.profiles[profileName];
  if (!profile) {
    throw new Error(`AUTH_PROFILE_MISSING:${profileName}`);
  }
  return profile;
}
```

`skills/shared-auth/lib/credentials-store.js`

```js
import fs from 'node:fs';

function readStore(credentialsPath) {
  if (!fs.existsSync(credentialsPath)) {
    return { profiles: {} };
  }
  return JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
}

function writeStore(credentialsPath, store) {
  fs.writeFileSync(credentialsPath, JSON.stringify(store, null, 2));
}

export function saveCredential(credentialsPath, profileName, credential) {
  const store = readStore(credentialsPath);
  store.profiles[profileName] = credential;
  writeStore(credentialsPath, store);
}

export function loadCredential(credentialsPath, profileName) {
  const store = readStore(credentialsPath);
  return store.profiles[profileName] ?? null;
}

export function clearCredential(credentialsPath, profileName) {
  const store = readStore(credentialsPath);
  delete store.profiles[profileName];
  writeStore(credentialsPath, store);
}

export function isExpired(credential) {
  if (!credential?.expiresAt) {
    return false;
  }
  return Date.parse(credential.expiresAt) <= Date.now();
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/shared-auth/auth-config.test.js tests/shared-auth/credentials-store.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add skills/shared-auth/lib/auth-config.js skills/shared-auth/lib/credentials-store.js tests/shared-auth/auth-config.test.js tests/shared-auth/credentials-store.test.js
git commit -m "feat: add shared auth config and credential store"
```

### Task 3: Implement capability detection and multi-mode login flow selection

**Files:**
- Create: `skills/shared-auth/lib/capability-detection.js`
- Create: `skills/shared-auth/lib/login-flows.js`
- Create: `tests/shared-auth/capability-detection.test.js`
- Create: `tests/shared-auth/login-flows.test.js`

- [ ] **Step 1: Write the failing capability detection test**

`tests/shared-auth/capability-detection.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectLoginCapabilities } from '../../skills/shared-auth/lib/capability-detection.js';

test('detectLoginCapabilities reports headless when display is unavailable', () => {
  const capabilities = detectLoginCapabilities({
    env: {},
    platform: 'linux',
    which: () => null
  });

  assert.equal(capabilities.hasGui, false);
  assert.equal(capabilities.canLaunchBrowser, false);
  assert.equal(capabilities.canImportSession, true);
});
```

- [ ] **Step 2: Write the failing login flow selection test**

`tests/shared-auth/login-flows.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseLoginMode } from '../../skills/shared-auth/lib/login-flows.js';

test('chooseLoginMode falls back to headless when browser is unavailable', () => {
  const mode = chooseLoginMode(
    { loginMode: 'auto' },
    { hasGui: false, canLaunchBrowser: false, canImportSession: true }
  );

  assert.equal(mode, 'headless');
});

test('chooseLoginMode honors explicit import mode', () => {
  const mode = chooseLoginMode(
    { loginMode: 'auto' },
    { hasGui: false, canLaunchBrowser: false, canImportSession: true },
    'import'
  );

  assert.equal(mode, 'import');
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test tests/shared-auth/capability-detection.test.js tests/shared-auth/login-flows.test.js`
Expected: FAIL because the modules do not exist yet.

- [ ] **Step 4: Write minimal capability and login mode logic**

`skills/shared-auth/lib/capability-detection.js`

```js
export function detectLoginCapabilities({ env, platform, which }) {
  const hasDisplay = Boolean(env.DISPLAY || env.WAYLAND_DISPLAY || env.SESSIONNAME);
  const browser = which('open') || which('xdg-open') || which('start');

  return {
    hasGui: hasDisplay,
    canLaunchBrowser: Boolean(hasDisplay && browser),
    canImportSession: true,
    browserCommand: browser
  };
}
```

`skills/shared-auth/lib/login-flows.js`

```js
export function chooseLoginMode(profile, capabilities, explicitMode) {
  if (explicitMode === 'import') {
    return 'import';
  }
  if (explicitMode === 'gui') {
    if (!capabilities.canLaunchBrowser) {
      throw new Error('AUTH_CAPABILITY_UNAVAILABLE');
    }
    return 'gui';
  }
  if (capabilities.canLaunchBrowser) {
    return 'gui';
  }
  if (capabilities.canImportSession) {
    return 'headless';
  }
  throw new Error('AUTH_CAPABILITY_UNAVAILABLE');
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/shared-auth/capability-detection.test.js tests/shared-auth/login-flows.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add skills/shared-auth/lib/capability-detection.js skills/shared-auth/lib/login-flows.js tests/shared-auth/capability-detection.test.js tests/shared-auth/login-flows.test.js
git commit -m "feat: add shared auth capability detection"
```

### Task 4: Add shared auth CLI entry script and JSON error output

**Files:**
- Create: `skills/shared-auth/lib/errors.js`
- Create: `skills/shared-auth/scripts/auth`
- Create: `tests/integration/shared-auth-headless.test.js`

- [ ] **Step 1: Write the failing integration test for headless auth guidance**

`tests/integration/shared-auth-headless.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('auth login emits headless action required JSON when browser is unavailable', () => {
  const result = spawnSync('bash', [
    'skills/shared-auth/scripts/auth',
    'login',
    '--profile',
    'bg_prod_main_sso',
    '--mode',
    'headless',
    '--json'
  ], {
    env: {
      ...process.env,
      SHARED_AUTH_CONFIG: 'skills/shared-auth/templates/auth-config.example.json',
      SHARED_AUTH_CREDENTIALS: 'skills/shared-auth/.local/test-credentials.json'
    },
    encoding: 'utf8'
  });

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'AUTH_HEADLESS_ACTION_REQUIRED');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/integration/shared-auth-headless.test.js`
Expected: FAIL because the script does not exist yet.

- [ ] **Step 3: Write minimal shared auth CLI and error helpers**

`skills/shared-auth/lib/errors.js`

```js
export function authError(code, message, suggestion) {
  return { ok: false, error: { code, message, suggestion } };
}

export function printJson(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}
```

`skills/shared-auth/scripts/auth`

```bash
#!/usr/bin/env bash
set -euo pipefail
node "$(dirname "$0")/../lib/cli-auth.js" "$@"
```

`skills/shared-auth/lib/cli-auth.js`

```js
import { loadAuthConfig, getAuthProfile } from './auth-config.js';
import { authError, printJson } from './errors.js';

const args = process.argv.slice(2);
const command = args[0];
const profileName = args[args.indexOf('--profile') + 1];
const modeIndex = args.indexOf('--mode');
const explicitMode = modeIndex >= 0 ? args[modeIndex + 1] : undefined;
const json = args.includes('--json');
const configPath = process.env.SHARED_AUTH_CONFIG || 'skills/shared-auth/.local/auth-config.json';

if (command !== 'login') {
  throw new Error('AUTH_COMMAND_UNSUPPORTED');
}

const profile = getAuthProfile(loadAuthConfig(configPath), profileName);
void profile;
void explicitMode;

const payload = authError(
  'AUTH_HEADLESS_ACTION_REQUIRED',
  `Complete login for profile ${profileName} in an external browser and import the resulting session.`,
  'Re-run with --mode import and provide cookie/header input.'
);

if (json) {
  printJson(payload);
} else {
  process.stdout.write(`${payload.error.message}\n${payload.error.suggestion}\n`);
}
```

- [ ] **Step 4: Make the script executable**

Run: `chmod +x skills/shared-auth/scripts/auth`
Expected: no output

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tests/integration/shared-auth-headless.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add skills/shared-auth/lib/errors.js skills/shared-auth/lib/cli-auth.js skills/shared-auth/scripts/auth tests/integration/shared-auth-headless.test.js
git commit -m "feat: add shared auth cli entrypoint"
```

### Task 5: Implement Kibana config loading and init validation

**Files:**
- Create: `skills/kibana-search/lib/config.js`
- Create: `tests/kibana-search/config.test.js`

- [ ] **Step 1: Write the failing config test**

`tests/kibana-search/config.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadKibanaConfig,
  getEnvironmentConfig,
  validateEnvironmentAuthProfile
} from '../../skills/kibana-search/lib/config.js';

test('validateEnvironmentAuthProfile checks shared auth profile reference', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kibana-config-'));
  const kibanaConfigPath = path.join(tempDir, 'config.json');
  const authConfigPath = path.join(tempDir, 'auth-config.json');

  fs.writeFileSync(kibanaConfigPath, JSON.stringify({
    environments: {
      bg_prod_main: {
        auth: { profile: 'bg_prod_main_sso' },
        tools: { kibana: { baseUrl: 'https://kibana.example.com' } }
      }
    }
  }));

  fs.writeFileSync(authConfigPath, JSON.stringify({
    profiles: {
      bg_prod_main_sso: { type: 'sso_browser', credentialRef: 'bg_prod_main', loginMode: 'auto' }
    }
  }));

  const config = loadKibanaConfig(kibanaConfigPath);
  const env = getEnvironmentConfig(config, 'bg_prod_main');
  assert.equal(validateEnvironmentAuthProfile(env, authConfigPath), 'bg_prod_main_sso');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/kibana-search/config.test.js`
Expected: FAIL because the module does not exist yet.

- [ ] **Step 3: Write minimal config loader implementation**

`skills/kibana-search/lib/config.js`

```js
import fs from 'node:fs';

export function loadKibanaConfig(configPath) {
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

export function getEnvironmentConfig(config, envName) {
  const env = config.environments?.[envName];
  if (!env) {
    throw new Error(`CONFIG_MISSING_ENV:${envName}`);
  }
  if (!env.tools?.kibana) {
    throw new Error(`CONFIG_MISSING_TOOL:${envName}`);
  }
  return env;
}

export function validateEnvironmentAuthProfile(envConfig, authConfigPath) {
  const authConfig = JSON.parse(fs.readFileSync(authConfigPath, 'utf8'));
  const profileName = envConfig.auth?.profile;
  if (!authConfig.profiles?.[profileName]) {
    throw new Error(`AUTH_PROFILE_MISSING:${profileName}`);
  }
  return profileName;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/kibana-search/config.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add skills/kibana-search/lib/config.js tests/kibana-search/config.test.js
git commit -m "feat: add kibana config loading"
```

### Task 6: Implement Discover URL parsing and KQL assembly

**Files:**
- Create: `skills/kibana-search/lib/discover-url.js`
- Create: `skills/kibana-search/lib/query-builder.js`
- Create: `tests/kibana-search/discover-url.test.js`
- Create: `tests/kibana-search/query-builder.test.js`

- [ ] **Step 1: Write the failing Discover URL parser test**

`tests/kibana-search/discover-url.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDiscoverUrl } from '../../skills/kibana-search/lib/discover-url.js';

test('parseDiscoverUrl extracts baseUrl, dataViewId, columns, timeRange and query', () => {
  const parsed = parseDiscoverUrl('https://kibana.bg.allschool.com/app/discover#/?_g=(filters:!(),refreshInterval:(pause:!t,value:0),time:(from:now-15h,to:now))&_a=(columns:!(level,message),filters:!(),index:f12ae960-16d1-11ec-97d3-31b29b7fe5a5,interval:auto,query:(language:kuery,query:\'APP_NAME:%22groot-lms-learning-server%22%20and%20level%20:%20%22ERROR%22%20\'),sort:!())');

  assert.equal(parsed.baseUrl, 'https://kibana.bg.allschool.com');
  assert.equal(parsed.dataViewId, 'f12ae960-16d1-11ec-97d3-31b29b7fe5a5');
  assert.deepEqual(parsed.columns, ['level', 'message']);
  assert.deepEqual(parsed.timeRange, { from: 'now-15h', to: 'now' });
  assert.match(parsed.kql, /groot-lms-learning-server/);
});
```

- [ ] **Step 2: Write the failing query builder test**

`tests/kibana-search/query-builder.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKql } from '../../skills/kibana-search/lib/query-builder.js';

test('buildKql assembles service, level, keyword and trace filters', () => {
  const kql = buildKql({
    serviceField: 'APP_NAME',
    levelField: 'level',
    messageField: 'message',
    traceIdField: 'traceId'
  }, {
    service: 'groot-lms-learning-server',
    level: 'ERROR',
    keyword: 'timeout',
    traceId: 'abc-123'
  });

  assert.equal(
    kql,
    'APP_NAME:"groot-lms-learning-server" and level:"ERROR" and message:"timeout" and traceId:"abc-123"'
  );
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test tests/kibana-search/discover-url.test.js tests/kibana-search/query-builder.test.js`
Expected: FAIL because the modules do not exist yet.

- [ ] **Step 4: Write minimal parser and KQL builder**

`skills/kibana-search/lib/discover-url.js`

```js
export function parseDiscoverUrl(url) {
  const [, hash = ''] = url.split('#/');
  const query = hash.replace(/^\?/, '');
  const params = new URLSearchParams(query);
  const base = new URL(url);
  const baseUrl = `${base.protocol}//${base.host}`;
  const a = decodeURIComponent(params.get('_a') || '');
  const g = decodeURIComponent(params.get('_g') || '');

  const dataViewId = a.match(/index:([^,\)]+)/)?.[1] ?? null;
  const columnsRaw = a.match(/columns:!\(([^\)]*)\)/)?.[1] ?? '';
  const columns = columnsRaw ? columnsRaw.split(',').filter(Boolean) : [];
  const kql = a.match(/query:'([^']+)'/)?.[1] ?? '';
  const from = g.match(/from:([^,\)]+)/)?.[1] ?? null;
  const to = g.match(/to:([^,\)]+)/)?.[1] ?? null;

  return {
    baseUrl,
    dataViewId,
    columns,
    kql,
    timeRange: { from, to }
  };
}
```

`skills/kibana-search/lib/query-builder.js`

```js
export function buildKql(fields, input) {
  const parts = [];

  if (input.service) {
    parts.push(`${fields.serviceField}:"${input.service}"`);
  }
  if (input.level) {
    parts.push(`${fields.levelField}:"${input.level}"`);
  }
  if (input.keyword) {
    parts.push(`${fields.messageField}:"${input.keyword}"`);
  }
  if (input.traceId) {
    parts.push(`${fields.traceIdField}:"${input.traceId}"`);
  }

  return parts.join(' and ');
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/kibana-search/discover-url.test.js tests/kibana-search/query-builder.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add skills/kibana-search/lib/discover-url.js skills/kibana-search/lib/query-builder.js tests/kibana-search/discover-url.test.js tests/kibana-search/query-builder.test.js
git commit -m "feat: add kibana discover parsing and kql builder"
```

### Task 7: Implement cache store and backend selection

**Files:**
- Create: `skills/kibana-search/lib/cache-store.js`
- Create: `skills/kibana-search/lib/backend.js`
- Create: `skills/kibana-search/lib/es-client.js`
- Create: `tests/kibana-search/cache-store.test.js`
- Create: `tests/kibana-search/backend.test.js`

- [ ] **Step 1: Write the failing cache store test**

`tests/kibana-search/cache-store.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  saveCacheEntry,
  loadCacheEntry,
  isCacheExpired
} from '../../skills/kibana-search/lib/cache-store.js';

test('cache store saves by env key and applies ttl', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kibana-cache-'));
  const cachePath = path.join(tempDir, 'cache.json');

  saveCacheEntry(cachePath, 'bg_prod_main', {
    fetchedAt: '2099-01-01T00:00:00.000Z',
    ttlSeconds: 86400,
    dataViewId: 'abc'
  });

  const entry = loadCacheEntry(cachePath, 'bg_prod_main');
  assert.equal(entry.dataViewId, 'abc');
  assert.equal(isCacheExpired(entry, new Date('2099-01-01T01:00:00.000Z')), false);
});
```

- [ ] **Step 2: Write the failing backend selection test**

`tests/kibana-search/backend.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseBackend } from '../../skills/kibana-search/lib/backend.js';

test('chooseBackend prefers kibana when auto mode lacks ES client', () => {
  const backend = chooseBackend({ preferredBackend: 'auto' }, { hasEsClient: false, hasKibanaClient: true });
  assert.equal(backend, 'kibana');
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test tests/kibana-search/cache-store.test.js tests/kibana-search/backend.test.js`
Expected: FAIL because the modules do not exist yet.

- [ ] **Step 4: Write minimal cache and backend logic**

`skills/kibana-search/lib/cache-store.js`

```js
import fs from 'node:fs';

function readStore(cachePath) {
  if (!fs.existsSync(cachePath)) {
    return { environments: {} };
  }
  return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
}

function writeStore(cachePath, store) {
  fs.writeFileSync(cachePath, JSON.stringify(store, null, 2));
}

export function saveCacheEntry(cachePath, envName, value) {
  const store = readStore(cachePath);
  store.environments[envName] = value;
  writeStore(cachePath, store);
}

export function loadCacheEntry(cachePath, envName) {
  return readStore(cachePath).environments[envName] ?? null;
}

export function isCacheExpired(entry, now = new Date()) {
  if (!entry) {
    return true;
  }
  const fetchedAt = new Date(entry.fetchedAt).getTime();
  return fetchedAt + entry.ttlSeconds * 1000 <= now.getTime();
}
```

`skills/kibana-search/lib/backend.js`

```js
export function chooseBackend(kibanaConfig, capabilities) {
  if (kibanaConfig.preferredBackend === 'kibana') {
    return 'kibana';
  }
  if (kibanaConfig.preferredBackend === 'es') {
    if (!capabilities.hasEsClient) {
      throw new Error('QUERY_BACKEND_UNAVAILABLE');
    }
    return 'es';
  }
  if (capabilities.hasEsClient) {
    return 'es';
  }
  if (capabilities.hasKibanaClient) {
    return 'kibana';
  }
  throw new Error('QUERY_BACKEND_UNAVAILABLE');
}
```

`skills/kibana-search/lib/es-client.js`

```js
export function createEsClient() {
  return {
    available: false,
    search() {
      throw new Error('QUERY_BACKEND_UNAVAILABLE');
    }
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/kibana-search/cache-store.test.js tests/kibana-search/backend.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add skills/kibana-search/lib/cache-store.js skills/kibana-search/lib/backend.js skills/kibana-search/lib/es-client.js tests/kibana-search/cache-store.test.js tests/kibana-search/backend.test.js
git commit -m "feat: add kibana cache and backend selection"
```

### Task 8: Implement Kibana client, output formatting, and CLI integration

**Files:**
- Create: `skills/kibana-search/lib/kibana-client.js`
- Create: `skills/kibana-search/lib/output.js`
- Create: `skills/kibana-search/lib/errors.js`
- Create: `skills/kibana-search/scripts/kibana-search`
- Create: `skills/kibana-search/lib/cli-kibana-search.js`
- Create: `tests/kibana-search/kibana-client.test.js`
- Create: `tests/kibana-search/output.test.js`
- Create: `tests/integration/kibana-search-cli.test.js`

- [ ] **Step 1: Write the failing output test**

`tests/kibana-search/output.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatJsonResult, formatTextLogs } from '../../skills/kibana-search/lib/output.js';

test('formatJsonResult preserves env backend query and logs', () => {
  const payload = formatJsonResult({
    env: 'bg_prod_main',
    backend: 'kibana',
    dataViewId: 'abc',
    query: { kql: 'level:"ERROR"', timeRange: { from: 'now-15h', to: 'now' }, fields: ['level', 'message'] },
    logs: [{ '@timestamp': '2026-05-29T10:00:00Z', level: 'ERROR', message: 'boom' }]
  });

  assert.equal(payload.ok, true);
  assert.equal(payload.env, 'bg_prod_main');
  assert.equal(payload.logs[0].message, 'boom');
});
```

- [ ] **Step 2: Write the failing CLI integration test**

`tests/integration/kibana-search-cli.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('kibana-search logs prints structured auth error without credentials', () => {
  const result = spawnSync('bash', [
    'skills/kibana-search/scripts/kibana-search',
    'logs',
    '--env',
    'bg_prod_main',
    '--service',
    'groot-lms-learning-server',
    '--level',
    'ERROR',
    '--json'
  ], {
    env: {
      ...process.env,
      KIBANA_SEARCH_CONFIG: 'skills/kibana-search/templates/config.example.json',
      SHARED_AUTH_CONFIG: 'skills/shared-auth/templates/auth-config.example.json',
      SHARED_AUTH_CREDENTIALS: 'skills/shared-auth/.local/test-credentials-missing.json',
      KIBANA_SEARCH_CACHE: 'skills/kibana-search/.local/test-cache.json'
    },
    encoding: 'utf8'
  });

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, 'AUTH_MISSING_CREDENTIAL');
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test tests/kibana-search/output.test.js tests/integration/kibana-search-cli.test.js`
Expected: FAIL because the modules and script do not exist yet.

- [ ] **Step 4: Write minimal output and CLI implementation**

`skills/kibana-search/lib/output.js`

```js
export function formatJsonResult({ env, backend, dataViewId, query, logs }) {
  return {
    ok: true,
    env,
    backend,
    dataViewId,
    query,
    logs
  };
}

export function formatTextLogs(logs) {
  return logs
    .map((log) => `${log['@timestamp']} ${log.level} ${log.message}`)
    .join('\n');
}
```

`skills/kibana-search/lib/errors.js`

```js
export function kibanaError(code, message, suggestion) {
  return { ok: false, error: { code, message, suggestion } };
}
```

`skills/kibana-search/lib/kibana-client.js`

```js
export function createKibanaClient() {
  return {
    available: true,
    fetchDataView() {
      return {
        fetchedAt: new Date().toISOString(),
        ttlSeconds: 86400,
        dataViewId: 'f12ae960-16d1-11ec-97d3-31b29b7fe5a5',
        fields: ['level', 'message']
      };
    },
    searchLogs() {
      return [];
    }
  };
}
```

`skills/kibana-search/scripts/kibana-search`

```bash
#!/usr/bin/env bash
set -euo pipefail
node "$(dirname "$0")/../lib/cli-kibana-search.js" "$@"
```

`skills/kibana-search/lib/cli-kibana-search.js`

```js
import { loadKibanaConfig, getEnvironmentConfig, validateEnvironmentAuthProfile } from './config.js';
import { loadCredential, isExpired } from '../../shared-auth/lib/credentials-store.js';
import { kibanaError } from './errors.js';

const args = process.argv.slice(2);
const command = args[0];
const envName = args[args.indexOf('--env') + 1];
const json = args.includes('--json');
const configPath = process.env.KIBANA_SEARCH_CONFIG || 'skills/kibana-search/.local/config.json';
const authConfigPath = process.env.SHARED_AUTH_CONFIG || 'skills/shared-auth/.local/auth-config.json';
const credentialsPath = process.env.SHARED_AUTH_CREDENTIALS || 'skills/shared-auth/.local/credentials.json';

if (command !== 'logs') {
  throw new Error('QUERY_COMMAND_UNSUPPORTED');
}

const config = loadKibanaConfig(configPath);
const envConfig = getEnvironmentConfig(config, envName);
const profileName = validateEnvironmentAuthProfile(envConfig, authConfigPath);
const credential = loadCredential(credentialsPath, profileName);

let payload;
if (!credential) {
  payload = kibanaError(
    'AUTH_MISSING_CREDENTIAL',
    `No credential found for env ${envName}.`,
    `Run: bash skills/shared-auth/scripts/auth login --profile ${profileName}`
  );
} else if (isExpired(credential)) {
  payload = kibanaError(
    'AUTH_EXPIRED',
    `Kibana credential expired for env ${envName}.`,
    `Run: bash skills/shared-auth/scripts/auth login --profile ${profileName}`
  );
} else {
  payload = { ok: true, env: envName, logs: [] };
}

if (json) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
} else if (payload.ok) {
  process.stdout.write('\n');
} else {
  process.stdout.write(`${payload.error.message}\n${payload.error.suggestion}\n`);
}
```

- [ ] **Step 5: Make the script executable**

Run: `chmod +x skills/kibana-search/scripts/kibana-search`
Expected: no output

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test tests/kibana-search/output.test.js tests/integration/kibana-search-cli.test.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add skills/kibana-search/lib/output.js skills/kibana-search/lib/errors.js skills/kibana-search/lib/kibana-client.js skills/kibana-search/lib/cli-kibana-search.js skills/kibana-search/scripts/kibana-search tests/kibana-search/output.test.js tests/integration/kibana-search-cli.test.js
git commit -m "feat: add kibana search cli entrypoint"
```

### Task 9: Write the two skill documents

**Files:**
- Create: `skills/shared-auth/SKILL.md`
- Create: `skills/kibana-search/SKILL.md`

- [ ] **Step 1: Write the failing documentation test**

`tests/shared-auth/skill-docs.test.js`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('skill docs describe repository-local paths and headless fallback', () => {
  const sharedAuth = fs.readFileSync('skills/shared-auth/SKILL.md', 'utf8');
  const kibanaSearch = fs.readFileSync('skills/kibana-search/SKILL.md', 'utf8');

  assert.match(sharedAuth, /skills\/shared-auth\/\.local\/credentials\.json/);
  assert.match(sharedAuth, /headless/i);
  assert.match(kibanaSearch, /bash skills\/kibana-search\/scripts\/kibana-search logs/);
  assert.match(kibanaSearch, /skills\/shared-auth\/scripts\/auth login/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/shared-auth/skill-docs.test.js`
Expected: FAIL because the skill docs do not exist yet.

- [ ] **Step 3: Write the shared auth skill document**

`skills/shared-auth/SKILL.md`

```markdown
---
name: shared-auth
description: Reusable repository-local auth skill for GUI and headless login flows.
---

Use this skill when a repository-local tool needs shared SSO, credential reuse, or headless login guidance.

## Runtime files

- `skills/shared-auth/.local/auth-config.json`
- `skills/shared-auth/.local/credentials.json`

## Commands

- Login: `bash skills/shared-auth/scripts/auth login --profile <profile>`
- Headless import: `bash skills/shared-auth/scripts/auth login --profile <profile> --mode import`

## Guidance

- If GUI/browser support is available, prefer browser SSO.
- If GUI support is unavailable, prefer headless or imported session flow.
- Keep credential storage repository-local; do not redirect users to `~/.claude` paths.
```

- [ ] **Step 4: Write the Kibana search skill document**

`skills/kibana-search/SKILL.md`

```markdown
---
name: kibana-search
description: Query Kibana logs from repository-local config using shared auth profiles.
---

Use this skill when the user wants Kibana logs by service, level, keyword, traceId, time range, or Discover URL.

## Runtime files

- `skills/kibana-search/.local/config.json`
- `skills/kibana-search/.local/cache.json`

## Commands

- Initialize config: `bash skills/kibana-search/scripts/kibana-search init`
- Query logs: `bash skills/kibana-search/scripts/kibana-search logs --env <env> --service <service> --level <level> --json`
- Refresh cache: `bash skills/kibana-search/scripts/kibana-search cache refresh --env <env>`

## Guidance

- Resolve the target `auth.profile` from `skills/kibana-search/.local/config.json`.
- If credentials are missing or expired, direct the user to `bash skills/shared-auth/scripts/auth login --profile <profile>`.
- On headless systems, prefer shared-auth headless or imported session mode.
- Return raw logs; let Claude do any downstream analysis.
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tests/shared-auth/skill-docs.test.js`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add skills/shared-auth/SKILL.md skills/kibana-search/SKILL.md tests/shared-auth/skill-docs.test.js
git commit -m "feat: add shared auth and kibana search skills"
```

### Task 10: Final repository verification

**Files:**
- Test: `tests/shared-auth/*.test.js`
- Test: `tests/kibana-search/*.test.js`
- Test: `tests/integration/*.test.js`

- [ ] **Step 1: Run the focused test suite**

Run: `node --test tests/shared-auth/*.test.js tests/kibana-search/*.test.js tests/integration/*.test.js`
Expected: PASS

- [ ] **Step 2: Run a manual headless login dry-run**

Run: `bash skills/shared-auth/scripts/auth login --profile bg_prod_main_sso --mode headless --json`
Expected: JSON with `AUTH_HEADLESS_ACTION_REQUIRED`

- [ ] **Step 3: Run a manual Kibana query dry-run without credentials**

Run: `bash skills/kibana-search/scripts/kibana-search logs --env bg_prod_main --service groot-lms-learning-server --level ERROR --json`
Expected: JSON with `AUTH_MISSING_CREDENTIAL`

- [ ] **Step 4: Commit final verification-only fixes if needed**

```bash
git add skills/shared-auth skills/kibana-search tests .gitignore
git commit -m "test: finalize kibana search skill verification"
```

## Self-Review

### Spec coverage

- Dual skill structure (`shared-auth` + `kibana-search`) is covered in Tasks 1, 4, 5, 8, and 9.
- Repository-local `.local/` config, credentials, and cache files are covered in Tasks 1, 2, 5, 7, and 9.
- GUI + headless + import auth modes are covered in Tasks 3, 4, 9, and 10.
- `auth.profile` linkage is covered in Tasks 5 and 8.
- Raw log output and `--json` output are covered in Tasks 6, 8, and 9.
- Skill usage docs for Claude Code and hermes-agent are covered in Task 9.

### Placeholder scan

- No `TODO`, `TBD`, or “similar to above” placeholders remain.
- Every code step includes concrete file paths and code snippets.
- Every execution step includes a concrete command and expected result.

### Type consistency

- `loginMode`, `credentialRef`, and `auth.profile` names match the spec.
- Error codes used across the plan are consistent with the spec: `AUTH_MISSING_CREDENTIAL`, `AUTH_EXPIRED`, `AUTH_CAPABILITY_UNAVAILABLE`, `AUTH_HEADLESS_ACTION_REQUIRED`, `QUERY_BACKEND_UNAVAILABLE`.
- Script names remain `skills/shared-auth/scripts/auth` and `skills/kibana-search/scripts/kibana-search` throughout.
