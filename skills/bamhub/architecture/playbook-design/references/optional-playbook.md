# Optional Playbook Records

Use process records only for multi-session, long-running, or high-risk work where the next session cannot safely reconstruct the evidence and decisions from the spec, plan, and project rules alone. Do not create them for routine work.

## Minimal Layout

```text
playbook/
  sessions/<task-slug>/
    session.md
    open-questions.md
```

`session.md` contains the current phase, evidence sources, decisions, and links to the formal spec and plan. `open-questions.md` contains only unresolved questions, their impact, and the default assumption when one exists.

## Boundaries

- Do not duplicate the formal spec, implementation plan, or raw conversation.
- Do not treat playbook records as authoritative rules.
- Remove resolved questions from `open-questions.md` and retain their final decision in the formal spec or session summary.
- Send repeatable rule candidates to `rule-refine`; do not create a parallel rules registry here.
