# Managed Upstream README Content Design

## Goal

Separate deterministic upstream-sync metadata from AI-authored repository guidance so a scheduled mirror update can refresh source state without overwriting useful, request-specific README content.

## Ownership

The synchronizer owns only a hidden metadata block at the beginning of each generated target README. It contains the source repository, tracked ref, accepted commit, and last successful synchronization time.

Each README may also contain an empty or populated AI-authored content block. The synchronizer preserves this block byte-for-byte when it replaces a target root. It must not generate generic skill descriptions, fallback copy, or inferred usage guidance.

\`skills/project/sync-upstream-skills/SKILL.md\` is the decision layer for AI callers. It instructs them to understand the user's purpose before creating or changing content inside the AI-authored block. A caller can leave the block empty when no real description has been supplied or established.

## Update Behavior

During \`apply\`, the synchronizer validates the current generated metadata block and preserves the existing AI-authored block if present. It then writes a README containing the refreshed metadata block followed by the preserved content block. This keeps the target clean for future scheduled updates while rejecting malformed or manually altered generated metadata.

For a new source, the generated README contains the metadata block and an empty content block. Caveman's existing generic guide sections are removed.

## Scheduling

The existing GitHub Actions workflow remains the automated execution mechanism. Its schedule changes from weekly to daily at 00:00 Asia/Shanghai, expressed as GitHub Actions UTC cron \`0 16 * * *\`. It continues to run \`apply --all\`, publish the report, and open or update an automation pull request.

## Validation

Tests cover metadata refresh and AI-content preservation across an upstream update, rejection of a modified generated metadata block, and the absence of generic generated usage text. Workflow tests assert the daily cron expression. A source-specific check after applying confirms the Caveman mirror is up to date.
