# Advanced Prompt Optimization Techniques

Reference guide for complex optimization scenarios. Use this when a prompt needs deeper reasoning, strict constraints, uncertainty handling, multiple perspectives, or multi-step prompt chaining.

## How to Use This Reference

Do not apply every technique at once. Select the smallest pattern that addresses the user's actual gap:

| User Need | Best Pattern |
|-----------|--------------|
| Reasoning or diagnosis | Stepwise analysis |
| High-stakes accuracy | Self-consistency or validation chain |
| Complex tradeoffs | Multi-path evaluation or layered expertise |
| Strict deliverable requirements | Constraint-based optimization |
| Different stakeholder needs | Audience calibration |
| Long-form structured output | Template prompting or progressive disclosure |
| Research, analysis, planning | Domain-specific analytical frameworks |
| Large output generation | Prompt chaining |

## Reasoning Patterns

### Stepwise Analysis

Use when the user needs reasoning, diagnosis, math, planning, debugging, or decision support. Prefer asking the model to reason internally and summarize the key logic rather than exposing a full hidden chain of thought.

```text
Analyze the problem step by step internally, then provide a concise final answer with the key reasoning summarized.
```

```text
Approach this systematically:
1. Break the problem into components
2. Evaluate the most important constraints
3. Compare the viable options
4. Provide the recommended answer with rationale
```

### Few-Shot Reasoning

Use when the desired reasoning style is specific or easy to misunderstand.

```text
Example Question: [Question]
Reasoning Summary: [Key step 1] → [Key step 2] → [Key step 3]
Answer: [Result]

Now solve: [User's question]
```

### Self-Consistency

Use for high-stakes accuracy, not simple tasks. This increases token cost but improves robustness.

```text
Solve this problem using three different approaches. Compare the results, identify any disagreement, and provide the most well-supported conclusion.
```

## Multi-Path Evaluation Patterns

Use for complex, ambiguous, high-value decisions where exploring alternatives matters.

```text
Consider this problem from multiple angles:

Approach A: [First perspective]
- Pros:
- Cons:
- Likelihood of success:

Approach B: [Second perspective]
- Pros:
- Cons:
- Likelihood of success:

Approach C: [Third perspective]
- Pros:
- Cons:
- Likelihood of success:

Based on this analysis, recommend the best path forward with reasoning.
```

Simplified variant:

```text
Evaluate three plausible solutions. For each, explain the first step, expected benefits, risks, and when it would fail. Then synthesize the best recommendation.
```

## Constraint-Based Optimization

### Hard Constraints

Use for requirements that must be met exactly.

```text
REQUIREMENTS:
- Maximum 200 words
- Include exactly 3 examples
- Use only publicly available data
- Output in JSON format
```

### Soft Constraints

Use for preferences that guide judgment but can yield to better reasoning.

```text
PREFERENCES:
- Favor concise explanations over comprehensive ones
- Prioritize recent sources (2023+) when available
- Use analogies familiar to software developers
```

### Boundary Conditions

Use when the prompt needs clear scope control.

```text
SCOPE:
- Include: [specific topics/areas]
- Exclude: [topics to avoid]
- Depth: [surface overview | moderate detail | deep dive]
```

## Role and Persona Optimization

### Expert Personas

```text
You are a senior [role] with 15+ years of experience in [domain]. You are known for [specific strength]. Your communication style is [descriptor].
```

### Layered Expertise

Use when the answer needs to balance competing dimensions.

```text
Approach this as:
1. First, a technical architect evaluating feasibility
2. Then, a product manager assessing user impact
3. Finally, a CFO considering cost implications

Synthesize these perspectives into a unified recommendation.
```

### Audience Calibration

```text
Explain this to:
- A technical expert: [technical explanation]
- A business stakeholder: [business-focused explanation]
- A complete beginner: [simplified explanation]
```

## Output Structure Patterns

### Template Prompting

```text
Provide your response in this exact format:

## Summary
[2-3 sentence overview]

## Key Findings
1. [Finding with evidence]
2. [Finding with evidence]
3. [Finding with evidence]

## Recommendations
| Priority | Action | Expected Impact |
|----------|--------|-----------------|
| High | ... | ... |
| Medium | ... | ... |

## Next Steps
- Immediate: [action]
- Short-term: [action]
- Long-term: [action]
```

### Progressive Disclosure

```text
Provide your answer in three layers:
1. TL;DR: one sentence
2. Executive summary: one paragraph
3. Detailed analysis: comprehensive explanation
```

### Conditional Formatting

```text
If the answer is straightforward, provide a direct response.
If the answer requires nuance, structure it as:
- Main point
- Important caveats
- Contextual factors
```

## Meta-Cognitive Prompts

### Self-Evaluation

```text
After providing your response:
1. Rate your confidence from 1-10 and explain why
2. Identify the weakest part of your answer
3. Suggest what additional information would improve it
```

### Uncertainty Handling

```text
If you are uncertain about any part of this:
- Clearly flag what you are uncertain about
- Explain why the uncertainty exists
- Offer your best estimate with appropriate caveats
- Never present uncertain information as definitive
```

### Iterative Refinement

```text
First draft: Generate your initial response.
Self-critique: Identify 2-3 ways to improve it.
Final version: Incorporate improvements and deliver polished output.
```

## Domain-Specific Patterns

### Technical and Code Prompts

```text
[Task description]

Technical context:
- Language/Framework: [specify]
- Version constraints: [specify]
- Existing patterns: [describe]
- Performance requirements: [specify]

Expected output:
- Working code with brief comments only where decisions are non-obvious
- Explanation of key decisions
- Potential edge cases to consider
- Test cases if applicable
```

### Creative Writing Prompts

```text
[Creative task]

Style parameters:
- Tone: [playful | serious | formal | casual]
- Voice: [first person | third person | etc.]
- Pacing: [fast-paced | contemplative | varied]
- Length: [specific word/paragraph count]

Inspiration: [reference works, styles, or authors]

Constraints: [any limits or requirements]
```

### Analytical Prompts

```text
Analyze [subject] using this framework:

1. Current State: What exists now?
2. Ideal State: What should exist?
3. Gap Analysis: What's missing?
4. Root Causes: Why does the gap exist?
5. Solutions: What could close the gap?
6. Prioritization: What should be done first and why?
```

### Research Prompts

```text
Research [topic] with these parameters:

Scope: [narrow | broad]
Depth: [overview | detailed analysis]
Sources to prioritize: [academic | industry | news | mixed]
Time frame: [historical | current | future projections]
Perspective: [objective analysis | specific viewpoint]

Structure findings as:
- Key facts with confidence levels
- Conflicting viewpoints
- Knowledge gaps
- Implications
```

## Prompt Chaining Patterns

Use chaining when one prompt is overloaded or the task has separable phases.

### Sequential Chain

```text
Prompt 1: Generate an outline for [topic]
Prompt 2: Expand section 1 of this outline: [outline]
Prompt 3: Expand section 2...
Prompt 4: Synthesize and polish the complete document
```

### Validation Chain

```text
Prompt 1: Generate [content]
Prompt 2: Review this for [accuracy/quality/completeness]: [content]
Prompt 3: Incorporate this feedback and improve: [content + review]
```

### Parallel-Then-Merge

```text
Prompt 1a: Analyze this from perspective A
Prompt 1b: Analyze this from perspective B
Prompt 2: Given these two analyses, synthesize a balanced conclusion
```

## Anti-Patterns to Fix

| Anti-Pattern | Replace With |
|--------------|--------------|
| "Make it better" | "Improve clarity by shortening sentences to under 20 words and replacing jargon with plain language" |
| "Don't be boring or use clichés" | "Use vivid, specific language with fresh analogies" |
| "Write a good email" | "Write an email that clearly conveys the deadline, motivates action, and can be read in under 30 seconds" |
| "Continue what we discussed" | "Building on [specific topic], now address [specific question]" |
| One prompt with 10 unrelated tasks | Focused sub-prompts or numbered priority tasks |
