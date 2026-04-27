# Design Retrospective Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new `design-retrospective` skill that analyzes recent work to extract reusable design principles, patterns, and migration guidance, with interactive clarification for low-confidence design interpretations.

**Architecture:** Add one new skill directory with a focused `SKILL.md` as the primary artifact. Keep the MVP documentation-only: the skill teaches a repeatable analysis workflow, asks whether to include team conventions, and uses structured 2-3 option clarification prompts when design intent is unclear.

**Tech Stack:** Markdown skill docs, existing repo skill conventions, git history, current conversation context

---

## File structure

- Create: `skills/design-retrospective/SKILL.md` — main skill definition, trigger conditions, workflow, output template, clarification rules
- Create: `docs/superpowers/plans/2026-04-27-design-retrospective.md` — this implementation plan
- Reference during implementation:
  - `docs/superpowers/specs/2026-04-27-design-retrospective-design.md`
  - `skills/writing-skills/SKILL.md`
  - `skills/brainstorming/SKILL.md`
  - `CLAUDE.md`

## Task 1: Validate placement and naming

**Files:**
- Create: `skills/design-retrospective/SKILL.md`
- Reference: `skills/code-arch/SKILL.md`
- Reference: `skills/version-changelog/SKILL.md`

- [ ] **Step 1: Inspect existing skill naming and structure**

Read the existing repo skills and confirm the new skill should live at:

```text
skills/design-retrospective/SKILL.md
```

Check that the name is verb-like enough for search while still matching the spec intent.

- [ ] **Step 2: Confirm frontmatter values before writing content**

Use these exact frontmatter values unless implementation evidence shows a better trigger phrase is needed:

```yaml
---
name: design-retrospective
description: Use when reviewing recent work to extract reusable design principles, structural patterns, and future migration guidance for upcoming requirements or other projects
---
```

Expected result: The description emphasizes *when to use* and avoids summarizing workflow details.

- [ ] **Step 3: Create the skill directory**

Run:

```bash
mkdir -p skills/design-retrospective
```

Expected result: `skills/design-retrospective/` exists and is ready for `SKILL.md`.

## Task 2: Run RED baseline scenarios before writing the skill

**Files:**
- Modify: `docs/superpowers/plans/2026-04-27-design-retrospective.md`
- Create: `skills/design-retrospective/SKILL.md`

- [ ] **Step 1: Define three failing baseline scenarios**

Document these three baseline prompts in your working notes before writing the skill:

```text
Scenario A: “Summarize my recent coding style from this branch.”
Expected baseline failure: analysis stays at code-style level and misses reusable design principles.

Scenario B: “Why did I structure this refactor this way, and what should we reuse next time?”
Expected baseline failure: assistant over-focuses on the current task instead of future-project migration guidance.

Scenario C: “You seem unsure why I introduced this boundary. Ask me if needed.”
Expected baseline failure: assistant either guesses the intent directly or asks vague questions instead of presenting 2-3 structured hypotheses.
```

- [ ] **Step 2: Record the concrete failure patterns the skill must prevent**

Use this checklist in your working notes:

```text
- Over-indexes on code formatting, naming, or commit habits
- Treats unclear design as missing intent instead of missing understanding
- Produces retrospective commentary about this task only
- Fails to ask whether team conventions should be included
- Asks open-ended clarification instead of 2-3 concrete hypotheses
```

Expected result: the written skill directly counters these failure modes.

- [ ] **Step 3: Do not write the skill body until the failure modes are fixed in prose design**

Success condition: you can point from each failure mode to a section that will explicitly counter it.

## Task 3: Write the minimal MVP skill document

**Files:**
- Create: `skills/design-retrospective/SKILL.md`
- Reference: `docs/superpowers/specs/2026-04-27-design-retrospective-design.md`

- [ ] **Step 1: Write the frontmatter and Overview**

Start `skills/design-retrospective/SKILL.md` with:

```markdown
---
name: design-retrospective
description: Use when reviewing recent work to extract reusable design principles, structural patterns, and future migration guidance for upcoming requirements or other projects
---

# Design Retrospective

## Overview

Use this skill when the goal is not just to explain the current implementation, but to distill reusable design thinking for the next requirement or another project.

Default assumption: the current design has intent. If the intent is unclear, the gap is in understanding, not in the user's reasoning.
```

- [ ] **Step 2: Add a focused When to Use section**

Include these bullets verbatim or equivalently:

```markdown
## When to Use

- Recent work should be mined for reusable design principles rather than only code-style feedback
- You need to identify patterns, boundaries, extension points, or external-caller considerations
- The user wants guidance that can transfer to the next requirement or another project
- You are unsure about the design intent and need to ask 2-3 structured hypotheses before concluding

Do not use this skill for:
- Pure formatting, lint, or naming reviews
- Full-repository architecture audits
- Automatic memory updates
```

- [ ] **Step 3: Add the evidence collection workflow**

Write a section that establishes this exact source priority:

```markdown
## Evidence Sources

1. Current conversation context
2. Current branch unmerged commits
3. Explicit conventions
4. Code facts
```

Then specify:
- Team conventions require an explicit user choice before inclusion
- `CLAUDE.md` is a likely convention source
- Code facts can supplement or correct written guidance

- [ ] **Step 4: Add the analysis priorities section**

Write a section that makes these priorities explicit:

```markdown
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
```

Expected result: design analysis remains primary and code-style analysis stays secondary.

- [ ] **Step 5: Add the structured clarification section**

Include a section with this exact rule:

```markdown
## Clarify Low-Confidence Design Understanding

When design intent is unclear, do not question whether the user had intent.
Instead, present 2-3 concrete hypotheses and ask which is closest.
```

Include this example:

```markdown
Example:
1. This boundary exists to isolate project-specific rules from reusable logic
2. This abstraction exists to preserve extension points for future external callers
3. This split exists to keep the workflow evolvable before hook automation
```

- [ ] **Step 6: Add the output template**

Write the six output sections exactly as:

```markdown
## Output Template

1. Reusable design principles
2. Patterns and structural approaches observed
3. Migration guidance for future tasks or other projects
4. Low-confidence areas requiring confirmation
5. Code style and collaboration preference supplement
6. Optional memory suggestions
```

- [ ] **Step 7: Add common mistakes that directly counter baseline failures**

Include these mistakes in substance:

```markdown
## Common Mistakes

- Reducing the review to coding style and missing design reuse value
- Treating unclear design as lack of intent
- Giving guidance only for the current task instead of the next one
- Skipping the “include team conventions?” check when convention sources are present
- Asking vague clarification questions instead of offering 2-3 hypotheses
```

## Task 4: Refactor the skill for searchability and token efficiency

**Files:**
- Modify: `skills/design-retrospective/SKILL.md`

- [ ] **Step 1: Remove workflow duplication from the description**

Check that the frontmatter description says only *when to use* and does **not** summarize the skill’s procedure.

Expected result: a future model must still read the body to get the actual workflow.

- [ ] **Step 2: Add retrieval-friendly keywords in the body**

Ensure the skill text contains the following searchable concepts where natural:

```text
design intent
reusable principles
pattern
boundary
extension point
external caller
migration guidance
team conventions
code style
structured hypotheses
```

- [ ] **Step 3: Keep the document focused**

Trim anything that turns the skill into:
- a generic architecture guide
- a code review checklist
- a memory automation workflow

Success condition: the skill stays inside the MVP scope from the spec.

## Task 5: Run GREEN verification against the baseline scenarios

**Files:**
- Modify: `skills/design-retrospective/SKILL.md`
- Reference: `docs/superpowers/specs/2026-04-27-design-retrospective-design.md`

- [ ] **Step 1: Re-run Scenario A against the written skill**

Pass criteria:
- Output centers on reusable design principles
- Code style appears only as a supplement

- [ ] **Step 2: Re-run Scenario B against the written skill**

Pass criteria:
- Guidance explicitly targets future requirements or other projects
- Output includes migration guidance, not just commentary on this branch

- [ ] **Step 3: Re-run Scenario C against the written skill**

Pass criteria:
- The response presents 2-3 concrete hypotheses
- The framing assumes the design has intent

- [ ] **Step 4: Patch any new loopholes directly in the skill**

If verification reveals new rationalizations, update `SKILL.md` immediately rather than documenting them elsewhere.

## Task 6: Final repository verification

**Files:**
- Create: `skills/design-retrospective/SKILL.md`
- Create: `docs/superpowers/plans/2026-04-27-design-retrospective.md`

- [ ] **Step 1: Confirm the final file set**

Expected files:

```text
docs/superpowers/specs/2026-04-27-design-retrospective-design.md
docs/superpowers/plans/2026-04-27-design-retrospective.md
skills/design-retrospective/SKILL.md
```

- [ ] **Step 2: Read the final skill for consistency with the spec**

Check explicitly that it includes:
- manual invocation only
- explicit team-convention opt-in
- design-first analysis
- structured 2-3 hypothesis clarification
- optional memory suggestions only

- [ ] **Step 3: Run git status to ensure only intended files changed**

Run:

```bash
git status --short
```

Expected result: only the new spec/plan/skill files, plus any intentional edits, are present.
