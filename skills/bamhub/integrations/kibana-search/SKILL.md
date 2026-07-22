---
name: kibana-search
description: Query Kibana logs from repository-local config using shared auth profiles.
---

# Kibana Search

## Overview

Use this skill when Claude Code or hermes-agent needs to query Kibana logs from repository-local environment config and return raw log entries to the caller. It uses shared-auth profiles for credentials and keeps runtime config under this repository.

## When to Use

- Investigating application errors, traces, warnings, or production behavior in Kibana logs.
- Searching by service, level, keyword, or trace ID from a configured environment.
- Returning raw logs for another agent or user to inspect.

Do not use this skill to summarize away log evidence. Return the raw logs produced by the CLI, then add interpretation separately only if asked.

## Runtime Files

- Config: `skills/kibana-search/.local/config.json`
- Cache: `skills/kibana-search/.local/cache.json`
- Example config: `skills/kibana-search/templates/config.example.json`
- CLI: `skills/kibana-search/scripts/kibana-search`
- Auth config: `skills/shared-auth/.local/auth-config.json`
- Auth credentials: `skills/shared-auth/.local/credentials.json`

The Kibana config references a shared-auth profile at `environments.<env>.auth.profile`. That profile must exist in `skills/shared-auth/.local/auth-config.json`.

## Commands

### Initialize local config

Copy and edit the example config before first use:

```bash
cp skills/kibana-search/templates/config.example.json skills/kibana-search/.local/config.json
cp skills/shared-auth/templates/auth-config.example.json skills/shared-auth/.local/auth-config.json
```

Set `KIBANA_SEARCH_CONFIG` or `SHARED_AUTH_CONFIG` only when intentionally using a non-default repository-local path.

### Search logs

Run from the repository root:

```bash
bash skills/kibana-search/scripts/kibana-search logs --env <environment>
```

Common filters:

```bash
bash skills/kibana-search/scripts/kibana-search logs --env <environment> --service <service-name>
bash skills/kibana-search/scripts/kibana-search logs --env <environment> --level error
bash skills/kibana-search/scripts/kibana-search logs --env <environment> --keyword <text>
bash skills/kibana-search/scripts/kibana-search logs --env <environment> --trace-id <trace-id>
bash skills/kibana-search/scripts/kibana-search logs --env <environment> --json
```

Return the raw logs from stdout. With `--json`, preserve the JSON payload including `logs`, `query`, `backend`, and `dataViewId`.

### Refresh cache

Data view metadata is cached in `skills/kibana-search/.local/cache.json`. To force a refresh, remove the cache file and run the logs command again:

```bash
rm skills/kibana-search/.local/cache.json
bash skills/kibana-search/scripts/kibana-search logs --env <environment>
```

## Auth Missing or Expired

If the CLI reports `AUTH_MISSING_CREDENTIAL` or `AUTH_EXPIRED`, login with the shared-auth profile named in the error or in the environment config:

```bash
bash skills/shared-auth/scripts/auth login --profile <profile-name>
```

Then rerun the Kibana logs command. Keep credentials in the repository-local shared-auth runtime files.

## Headless Systems

For hermes-agent, remote terminals, CI-like shells, or any environment without GUI browser support, use shared-auth headless or import mode:

```bash
bash skills/shared-auth/scripts/auth login --profile <profile-name> --mode headless
bash skills/shared-auth/scripts/auth login --profile <profile-name> --mode import
```

After the shared-auth flow stores credentials in `skills/shared-auth/.local/credentials.json`, run `bash skills/kibana-search/scripts/kibana-search logs` again.

## Common Mistakes

- Searching before the shared-auth profile has credentials. Run `skills/shared-auth/scripts/auth login` first.
- Editing global Claude config for Kibana auth. Keep Kibana config and credentials repository-local.
- Returning only a summary. Preserve and return raw logs so the caller can verify the evidence.
