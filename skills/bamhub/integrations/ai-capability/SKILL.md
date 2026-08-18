---
name: ai-capability
description: Use when an agent needs to discover or invoke a remote AI capability service, inspect capability names and descriptions, load one capability's input schema, or execute a provider-backed capability through the repository CLI.
---

# Generic AI Capability

Use this skill as the stable Agent-facing interface for remote AI capabilities. The first supported provider is Bamboo's open capability API; the workflow is provider-neutral and must not expose TaskBot internals.

## Quick reference

```bash
# Discover lightweight capability metadata
bash skills/bamhub/integrations/ai-capability/scripts/ai-capability \
  capabilities --keyword '日志' --json

# Load schema only after choosing one code
bash skills/bamhub/integrations/ai-capability/scripts/ai-capability \
  describe --code <capability-code> --json

# Invoke with arguments validated against the returned inputSchema
bash skills/bamhub/integrations/ai-capability/scripts/ai-capability \
  invoke --code <capability-code> --arguments '<json>' --json
```

The local commands map to the current remote API as follows:

| Local command | Remote request | Purpose |
|---|---|---|
| `capabilities` | `POST {baseUrl}/ai/capability/page`, `detail=false` | List/filter `code`, `name`, `description` |
| `describe` | Same `page` endpoint with `codes=[code]`, `detail=true` | Load one `inputSchema` |
| `invoke` | `POST {baseUrl}/ai/capability/invoke` | Execute the selected capability |

There is no remote `/search` or `/detail/{code}` endpoint.

## Configuration and authentication

Copy `templates/config.example.json` to `.local/config.json` and set a service `baseUrl`. Keep the API key outside Git, preferably in the environment variable named by `apiKeyEnv`:

```bash
export AI_CAPABILITY_CONFIG=skills/bamhub/integrations/ai-capability/.local/config.json
export AI_CAPABILITY_API_KEY='provided-out-of-band'
```

The shared client sends the configured key on **every** page-list, page-detail, and invoke request, using `X-API-KEY` by default. Do not put the key in `arguments`, URLs, committed files, output, or logs. A missing or rejected key is a stop condition; do not retry anonymously or guess another key.

## Required workflow

1. Call `capabilities` with `detail=false`; match the user's intent using `name` and `description`.
2. If multiple capabilities match, ask the user to choose. Do not guess a code.
3. Call `describe` for the selected code only; read its `inputSchema`, required fields, descriptions, and limits.
4. Build and validate `arguments` from that schema. Keep `capabilityCode` outside the arguments object.
5. Call `invoke` and return the provider result without leaking credentials or internal provider configuration.

## Failure handling

- `AUTH_API_KEY_MISSING` / `AUTH_API_KEY_INVALID`: stop and ask for a valid API key.
- `CONFIG_INVALID` / `SERVICE_INVALID`: ask for a valid service configuration.
- `REQUEST_TIMEOUT` / `REQUEST_FAILED`: report a safe summary and retry only after the network or service issue is addressed.
- Empty or ambiguous discovery results: ask the user for a more specific capability or clarification.
- Schema validation failure: ask for missing business inputs; never invent secrets or hidden provider fields.

## Boundaries

- TaskBot is only one provider; do not hard-code TaskPlan, TaskPlanDetail, Cookie, `sid`, or internal task protocol fields.
- Do not load every schema before a capability is selected.
- Do not call a capability code that was not discovered or explicitly configured.
- Do not summarize, transform, or expose sensitive provider output unless the user asks and the data is safe to return.
