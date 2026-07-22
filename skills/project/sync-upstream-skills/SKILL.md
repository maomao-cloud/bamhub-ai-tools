---
name: sync-upstream-skills
description: Safely check and mirror configured third-party skill sources into this repository.
---

# Sync upstream skills

Use this project-only skill to refresh the source mappings in `skills/sources.json`. It manages only the configured upstream roots and writes a Bamhub-generated `README.md` at each target root.

## Check before applying

Run a read-only check first:

```bash
node skills/project/sync-upstream-skills/scripts/sync-skills.mjs check --source superpowers
```

The JSON report is per source. `up-to-date` needs no action, `update-available` can be applied, and `failed` identifies only that source. Check every configured source with `--all`; one failure does not prevent the others from being checked.

## Apply an approved update

```bash
node skills/project/sync-upstream-skills/scripts/sync-skills.mjs apply --source superpowers
```

The command replaces the configured target with the selected upstream root, records the accepted commit in `skills/sources.json`, and regenerates its README. Use `--force` only when deliberately discarding local edits under that managed target:

```bash
node skills/project/sync-upstream-skills/scripts/sync-skills.mjs apply --source superpowers --force
```

The generated README is a deterministic usage guide for the current skill set. An AI-capable caller may read the `check` JSON report and present a per-call summary, but never passes that summary to `apply` or stores it in the repository.

Configured upstream roots must be real directories. The synchronizer rejects a symlink root and any nested symlink that resolves outside that root before it stages files. A clean source whose accepted commit is still current is reported as `up-to-date` without rewriting its README or `acceptedAt`.

## Scheduling

Scheduled checks belong in GitHub Actions, not a local macOS timer. Review the per-source output and resulting changes before merging any automated update.
