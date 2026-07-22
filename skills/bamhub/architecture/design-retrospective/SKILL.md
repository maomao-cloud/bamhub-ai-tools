---
name: design-retrospective
description: Use when the user explicitly asks for a retrospective on recent work to extract reusable design principles, structural patterns, and future migration guidance for upcoming requirements or other projects
---

# Design Retrospective

## Overview

Use this skill only when the user explicitly invokes it or explicitly asks for this kind of retrospective. Do not auto-apply it just because a general review or architecture question seems related.

The goal is not just to explain the current implementation, but to distill reusable design thinking for the next requirement or another project.

Default assumption: the current design has intent. If the intent is unclear, the gap is in understanding, not in the user's reasoning.

## When to Use

- Recent work should be mined for reusable design principles rather than only code-style feedback
- You need to identify patterns, boundaries, extension points, or external-caller considerations
- The user wants guidance that can transfer to the next requirement or another project
- You are unsure about the design intent and need to ask 2-3 structured hypotheses before concluding

Do not use this skill for:
- Pure formatting, lint, or naming reviews
- Full-repository architecture audits
- Automatic memory updates

## Evidence Sources

Collect evidence in this order:

1. Current conversation context
2. Current branch unmerged commits relative to the repository's main/base branch
3. Explicit conventions
4. Code facts

Rules:
- If team conventions are present, ask the user whether to include them before treating them as part of the analysis baseline.
- Treat `CLAUDE.md` as an explicit convention source when present.
- Do not treat `README.md` as a team convention source unless the user explicitly says it is normative.
- Code facts can supplement or correct written guidance.
- Ignore conversation noise that does not affect design intent, reusable principles, code style, or collaboration corrections.

## Analysis Priorities

Primary:
- Reusable design principles
- Structural patterns and boundaries
- Extension points and external-caller friendliness
- Migration guidance for future work

Secondary:
- Code style signals
- Collaboration preferences
- Conversation corrections worth remembering

Do not let secondary signals dominate the output.

## Clarify Low-Confidence Design Understanding

When design intent is unclear, do not question whether the user had intent.
Instead, present 2-3 concrete hypotheses and ask which is closest.

Example:
1. This boundary exists to isolate project-specific rules from reusable logic
2. This abstraction exists to preserve extension points for future external callers
3. This split exists to keep the workflow evolvable before hook automation

If all hypotheses are wrong, ask the user to supply the real intent, then continue from that answer.

## Output Template

1. Reusable design principles
2. Patterns and structural approaches observed
3. Migration guidance for future tasks or other projects
4. Low-confidence areas requiring confirmation
5. Code style and collaboration preference supplement
6. Optional memory suggestions

Guidance for each section:

### 1. Reusable design principles

Lead with the principles that should survive this task and be reused later.
Prefer statements about boundaries, extension points, caller expectations, workflow decomposition, or anti-drift practices.

### 2. Patterns and structural approaches observed

Name a pattern only when the evidence is strong.
If confidence is lower, describe the structure conservatively as a boundary, split, orchestration shape, or extension-point strategy.

### 3. Migration guidance for future tasks or other projects

Convert observations into concrete reuse advice for the next requirement or another codebase.
Answer: what should be repeated, what should be generalized, and under what conditions it still applies.

### 4. Low-confidence areas requiring confirmation

If uncertainty remains, list only the points that would materially change the retrospective.
Provide 2-3 structured hypotheses for each point.
If there is no meaningful uncertainty, write `None`.

### 5. Code style and collaboration preference supplement

Keep this section short.
Include stable code-style signals, collaboration corrections from the conversation, and only the preference details that help future design analysis.

### 6. Optional memory suggestions

Suggest memory candidates only when they look stable across future work.
Do not write memory automatically.

## Working Sequence

1. Read the current conversation and extract design-intent signals.
2. Inspect current branch unmerged commits relative to the repository's main/base branch for recurring boundaries, patterns, and extension choices.
3. Scan for explicit conventions.
4. If clear team conventions exist, ask whether to include them.
5. Use code facts to confirm or correct the written conventions.
6. Draft the six output sections with design-first emphasis.
7. If any design conclusion is low-confidence, pause and ask 2-3 structured hypotheses.
8. Incorporate the user's clarification and finish the retrospective.

## Common Mistakes

- Reducing the review to coding style and missing design reuse value
- Treating unclear design as lack of intent
- Giving guidance only for the current task instead of the next one
- Skipping the “include team conventions?” check when convention sources are present
- Asking vague clarification questions instead of offering 2-3 hypotheses
- Naming a formal design pattern without strong evidence
