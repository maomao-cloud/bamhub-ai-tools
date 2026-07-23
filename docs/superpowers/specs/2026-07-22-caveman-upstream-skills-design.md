# Caveman Upstream Skills Design

## Goal

Add the complete upstream skill set from `JuliusBrussee/caveman` as a separately maintained top-level skill collection, parallel to `skills/superpowers/`.

## Scope

- Register `https://github.com/JuliusBrussee/caveman.git` on its `main` ref in `skills/sources.json` as the `caveman` source.
- Mirror the upstream repository's `skills/` root into `skills/caveman/` using the existing `sync-upstream-skills` tooling.
- Track the accepted upstream commit and let the synchronizer generate `skills/caveman/README.md`.

The mirror includes the seven upstream skills: `caveman`, `caveman-commit`, `caveman-compress`, `caveman-help`, `caveman-review`, `caveman-stats`, and `cavecrew`.

## Exclusions

Do not import the upstream plugin manifests, hooks, slash commands, agents, installers, benchmarks, or other repository-level integrations. Those are platform-specific additions and are outside the requested skill-only scope.

## Architecture

`skills/caveman/` is a third-party managed mirror at the same ownership level as `skills/superpowers/`; it is not a Bamhub-authored skill and must not be placed under `skills/bamhub/`. The existing synchronizer remains the sole update mechanism: it validates the configured upstream root, copies it atomically, records the accepted commit, and writes the generated source guide.

## Validation

Run a source-specific dry check before applying the initial mirror. After applying it, run the source-specific check again to confirm the source is `up-to-date`, and run the repository's Node test suite to verify sync-tool behavior remains intact.
