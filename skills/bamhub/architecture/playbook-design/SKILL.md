---
name: playbook-design
description: Use when a new or evolving requirement needs project-aware design discovery before brainstorming because existing rules, code, prior decisions, module boundaries, or delivery risks may otherwise be missed or repeatedly re-litigated.
---

# Playbook Design

Build a verified design brief before design discussion. The brief turns existing project knowledge into explicit inputs, so the user decides business trade-offs rather than re-answering questions that rules, code, or prior decisions already answer.

## Scope and Ownership

Use this skill for new features, cross-module work, unclear boundaries, or requirements that repeatedly drift between spec and plan. Do not use it for a small change with a complete, current plan.

This skill owns evidence gathering, risk-based analysis, and the design brief. It does not replace these skills:

- **REQUIRED NEXT SKILL:** Use `superpowers:brainstorming` to compare options, obtain design approval, and create the formal spec.
- **REQUIRED AFTER SPEC:** Use `superpowers:writing-plans` to create the implementation plan.
- Use `rule-refine` only when a verified, repeatable conclusion merits a formal project rule.

## Select the Depth

| Mode | Use when | Required work |
| --- | --- | --- |
| Lite | The change is local and the boundary is already clear. | Read applicable instructions and verify the closest existing capability. |
| Standard | A new feature, module boundary, or meaningful acceptance risk exists. | Add convention, code-fact, boundary, and validation views. |
| Deep | Cross-module calls, data changes, permissions, batch work, external integration, or irreversible decisions are involved. | Add only the risk views relevant to the change. |

Do not choose Deep merely because the task sounds important. Do not choose Lite when the requested change would alter a public contract, state transition, or cross-module dependency.

## Build the Project Baseline

Read the smallest set of real evidence needed, in this order:

1. The user request and explicit constraints.
2. Applicable `AGENTS.md`, `CLAUDE.md`, or repository rule files that actually exist.
3. The closest module instructions and relevant historical spec or plan.
4. The real entry points, core services, contracts, and tests on the affected path.

Treat missing files as missing evidence, not as implied rules. Mark every conclusion as **verified**, **inferred**, or **open**. Use code facts to flag stale documentation, but do not let current behavior override an applicable rule or an approved target design.

For Standard and Deep work, read [evidence-and-risk.md](references/evidence-and-risk.md) before assigning views.

## Run Risk-Based Views

Use the selected views to answer different questions, not to repeat the same summary:

- **Code facts:** What already exists and where does the change belong?
- **Conventions:** Which durable constraints already decide the implementation shape?
- **Boundary and integration:** Which contracts, ownership boundaries, state changes, or dependencies can drift?
- **Validation:** What acceptance conditions, edge cases, and evidence must the later plan preserve?

When independent read-only investigations would materially improve confidence, dispatch focused subagents with a bounded evidence scope. If subagents are unavailable, run the same views sequentially and say so; never present sequential reasoning as parallel verification.

Resolve factual disagreement by inspecting the source of truth. Resolve intended behavior with this precedence: explicit current user direction, approved target specification, applicable project rules, then general practice. Use verified current code to identify compatibility and migration constraints; do not use it to reverse an approved change. Ask the user only when the unresolved choice changes business value, scope, acceptance criteria, or an irreversible architectural commitment.

## Produce the Design Brief

Use this structure. Keep it concise and link every material constraint to evidence.

```text
Project baseline
- Sources read:
- Relevant prior decisions:

Verified facts
- Existing capability and extension points:
- Applicable constraints:

Risk view
- Boundaries and dependencies:
- Validation concerns:

Recommended design input
- Include:
- Explicitly exclude:
- Constraints that the formal spec must state:

Only user decisions still needed
- Decision, options, recommendation, and impact:

Design lock for planning
- Plan must preserve:
- Plan must not introduce:
- Evidence required to verify:
```

Do not turn the brief into a formal spec or an implementation plan. Avoid speculative APIs, fields, services, and technology choices that are not supported by evidence.

## Handoff and Learning

Hand the brief to `superpowers:brainstorming`. It should use verified constraints as defaults and ask only the remaining decision questions. After the formal spec is approved, pass the **Design lock for planning** section to `superpowers:writing-plans`; return to the spec if a proposed plan expands it.

Do not automatically edit long-lived project instructions. Send a conclusion to `rule-refine` only when it has recurred, is evidence-backed, and would guide future decisions across tasks. For long-running work that needs durable process context, read [optional-playbook.md](references/optional-playbook.md).

## Common Mistakes

- Asking the user for an answer already present in an applicable rule, current code, or approved decision.
- Naming a capability as existing before reading its entry point or contract.
- Running every analysis view for a local, low-risk change.
- Allowing a plan to add a filter, endpoint, model, or asynchronous flow absent from the approved spec.
- Treating a single task’s implementation detail as a permanent project convention.
