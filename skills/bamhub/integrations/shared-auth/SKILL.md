---
name: shared-auth
description: Reusable repository-local auth skill for GUI and headless login flows.
---

# Shared Auth

## Overview

Use this skill when a repository tool needs an authenticated browser or API session without storing credentials in global Claude state. All runtime files stay under this repository so Claude Code and hermes-agent can share the same local auth profiles.

Keep auth config, cookies, tokens, and credential material in the repository-local runtime files below, not in home-directory locations.

## Runtime Files

- Config: `skills/shared-auth/.local/auth-config.json`
- Credentials: `skills/shared-auth/.local/credentials.json`
- Example config: `skills/shared-auth/templates/auth-config.example.json`
- CLI: `skills/shared-auth/scripts/auth`

`skills/shared-auth/.local/` is the only expected runtime location for this skill. Keep it local, private, and out of commits except placeholder files such as `.gitkeep`.

## Login Command

Run login from the repository root:

```bash
bash skills/shared-auth/scripts/auth login --profile <profile-name>
```

Useful options:

```bash
bash skills/shared-auth/scripts/auth login --profile <profile-name> --mode auto
bash skills/shared-auth/scripts/auth login --profile <profile-name> --mode headless
bash skills/shared-auth/scripts/auth login --profile <profile-name> --mode import
bash skills/shared-auth/scripts/auth login --profile <profile-name> --json
```

If `SHARED_AUTH_CONFIG` is unset, the CLI reads `skills/shared-auth/.local/auth-config.json`. If `SHARED_AUTH_CREDENTIALS` is unset, repository tools should use `skills/shared-auth/.local/credentials.json`.

## Headless and Import Guidance

Use `--mode headless` when the current runtime cannot launch an interactive browser but can provide instructions for completing login elsewhere. The command will tell the operator to complete provider login in an external browser, then import the authenticated session.

Use `--mode import` when the session already exists and the operator can provide captured cookies or required auth headers. Store the resulting credential only in `skills/shared-auth/.local/credentials.json`.

For hermes-agent, CI-like shells, remote terminals, or other headless systems, prefer `headless` or `import` instead of attempting a GUI browser flow.

## Common Mistakes

- Using home-directory auth material. Keep credentials in `skills/shared-auth/.local/credentials.json`.
- Running a dependent tool before login. Login first with the exact profile referenced by that tool's config.
- Assuming GUI login is available. If browser launch is unavailable, use `--mode headless` or `--mode import`.
