# Evidence and Risk Views

Read this reference for Standard or Deep `playbook-design` work. Select only views that can change the design brief.

## Evidence Rules

| Claim | Minimum evidence | Label when evidence is absent |
| --- | --- | --- |
| Existing capability | Entry point, implementation, or contract in the current repository | Open |
| Project convention | Applicable instruction file or approved specification | Open |
| Cross-module contract | Provider API/contract and consumer use | Inferred |
| Acceptance condition | User request, approved spec, or testable project rule | Open |

Do not promote an inference to a design lock. Record the source path or other concrete evidence for every verified claim.

## Select Views by Observable Risk

| Signal | Add this view | Verify |
| --- | --- | --- |
| New module or cross-module call | Boundary and integration | Ownership, existing contract, caller/provider semantics |
| Write, state transition, batch processing, or retry | State and operations | Idempotency, transaction scope, failure isolation, pagination or batching |
| External API, event, queue, or scheduled work | Integration and operations | Timeout, retry, ownership, observability, compensating behavior |
| Permission, tenant, or sensitive data | Security | Access boundary, data isolation, audit expectations |
| New query, sort, filter, or data shape | Data and validation | Existing query semantics, contract compatibility, performance constraints |
| User-visible workflow | Validation | Acceptance criteria, empty/error paths, backward compatibility |

## View Output Contract

Each selected view returns only:

```text
Question answered:
Evidence checked:
Verified facts:
Open risk or decision:
Constraint for the design brief:
```

Do not repeat the user request or propose an implementation outside the assigned evidence scope.

## Conflict Handling

1. Verify whether the conflict is factual, a rule conflict, or a scope choice.
2. Resolve factual conflicts by inspecting the source of truth.
3. For intended behavior, apply the precedence in `playbook-design`; current code is evidence of the baseline, not a veto on an approved change.
4. Escalate one focused decision only if the result would change value, scope, acceptance, or an irreversible commitment.

## Design-Lock Examples

| Evidence | Valid lock | Invalid lock |
| --- | --- | --- |
| Approved spec permits CSV only | Plan must use the existing CSV contract; do not add formats without a spec revision. | Add Excel later if it seems useful. |
| Existing provider has one supported query shape | Plan must use that query shape or revise the provider contract first. | Consumer may invent an extra filter. |
| Batch work scans a large collection | Plan must specify batching, failure isolation, and retry behavior. | Use a new queue because it is more scalable. |
