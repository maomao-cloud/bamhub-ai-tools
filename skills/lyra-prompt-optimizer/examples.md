# Prompt Optimization Examples

Real-world before/after examples across domains. Use these as adaptation patterns, not fixed templates. Preserve the user's actual intent, domain, audience, and constraints.

## Index

- Business & Professional
- Technical & Development
- Creative & Content
- Research & Analysis
- Educational & Explanatory
- Prompts for AI Tools

## Business & Professional

### Email Writing

Primary techniques: context completion, tone calibration, success criteria.

**Before:**
```text
Write me an email to my boss about the project delay
```

**After:**
```text
Write a professional email to my direct manager explaining a 2-week project delay.

Context:
- Project: Q4 Marketing Dashboard
- Original deadline: November 15
- New deadline: November 29
- Cause: Third-party API integration issues (vendor's side, not ours)
- Current status: 80% complete, on track for new deadline

Tone: Professional, solution-focused (not apologetic)
Include: Impact assessment, mitigation steps already taken, request for support if needed
Length: 150-200 words
```

### Meeting Notes

Primary techniques: output templating, noise filtering, action extraction.

**Before:**
```text
Summarize this meeting transcript
```

**After:**
```text
Transform this meeting transcript into structured notes.

Format:
## Meeting Overview
- Date/Attendees (extract from transcript)
- Purpose

## Key Decisions Made
[Numbered list with owner and deadline if mentioned]

## Action Items
| Item | Owner | Deadline | Priority |
|------|-------|----------|----------|

## Open Questions
[Items requiring follow-up]

## Next Steps
[Clear next meeting or milestone]

Prioritize actionable information. Omit small talk and off-topic discussion.
```

### Proposal Writing

Primary techniques: audience calibration, structured deliverable, decision framing.

**Before:**
```text
Help me write a proposal for a new feature
```

**After:**
```text
Draft a feature proposal for internal stakeholders.

Feature: [AI-powered search in our documentation]

Write for an audience of: Engineering leadership and Product

Structure:
1. Problem Statement (what pain point does this solve?)
2. Proposed Solution (high-level approach)
3. Success Metrics (how do we know it worked?)
4. Scope & Timeline (rough estimate)
5. Resource Requirements (team, tools, budget)
6. Risks & Mitigations
7. Recommendation (go/no-go with reasoning)

Tone: Data-driven, concise, persuasive but balanced
Length: 1-2 pages when formatted
```

## Technical & Development

### Code Review

Primary techniques: evaluation criteria, severity labels, actionable output.

**Before:**
```text
Review this code
```

**After:**
```text
Perform a code review on this Python function.

Evaluate for:
1. Bugs: Logic errors, edge cases, null handling
2. Performance: Time/space complexity, obvious optimizations
3. Security: Input validation, injection risks, data exposure
4. Readability: Naming, structure, comments needed
5. Best Practices: PEP 8 compliance, idiomatic Python

For each issue found:
- Severity: [Critical | Major | Minor | Suggestion]
- Location: Line number or section
- Problem: What's wrong
- Fix: Corrected code or approach

Code context: [FastAPI endpoint, handles user authentication]
```

### Architecture Design

Primary techniques: requirement framing, constraints, deliverable structure.

**Before:**
```text
Design a system for user notifications
```

**After:**
```text
Design a notification system architecture for a B2B SaaS application.

Requirements:
- Scale: 100K daily active users, peak 10K concurrent
- Channels: Email, in-app, push (mobile), SMS
- Features: User preferences, batching/digest, delivery tracking
- Constraints: AWS infrastructure, budget-conscious, team of 3 engineers

Deliverable:
1. High-level architecture diagram (describe components)
2. Technology recommendations with rationale
3. Data model for core entities
4. API design for key operations
5. Failure handling and retry strategy
6. Estimated implementation timeline

Prioritize: Reliability and maintainability over cutting-edge tech
```

### Debugging Help

Primary techniques: observed vs expected behavior, environment context, diagnostic steps.

**Before:**
```text
Why isn't this working?
```

**After:**
```text
Debug this JavaScript code that should fetch and display user data.

Observed behavior: Console shows "undefined" for user.name
Expected behavior: Should display "John Doe"

Environment: React 18, Node 18, Chrome latest
Error messages: [paste exact error if any]

[Code block]

Approach:
1. Identify the root cause
2. Explain why it's happening
3. Provide the fix with explanation
4. Suggest preventive measures for similar issues
```

## Creative & Content

### Blog Post

Primary techniques: audience targeting, editorial constraints, anti-hype framing.

**Before:**
```text
Write a blog post about AI
```

**After:**
```text
Write a blog post: "5 Ways Small Businesses Are Using AI in 2024 (Without Technical Expertise)"

Target audience: Small business owners, non-technical, skeptical of AI hype
Publication: Company blog (B2B SaaS for SMBs)
Goal: Educate and build trust (not hard-sell)

Structure:
- Hook: Relatable pain point AI can solve
- Brief intro: AI is accessible now, not just for tech giants
- 5 use cases: Each with real example, tool mention, and ROI hint
- Conclusion: Low-risk ways to start experimenting

Tone: Conversational, practical, encouraging
Length: 1200-1500 words
Include: 2-3 specific tool recommendations (free or freemium)
Avoid: Technical jargon, hype language, fear-mongering about AI
```

### Social Media

Primary techniques: platform adaptation, voice variants, factual grounding.

**Before:**
```text
Write social media posts
```

**After:**
```text
Create a LinkedIn post announcing our company's Series A funding.

Key facts:
- Amount: $15M
- Lead investor: Sequoia Capital
- Use of funds: Engineering team expansion, EU market entry
- Company: B2B fintech, 50 employees, 3 years old

Tone: Celebratory but humble, grateful to team and customers
Include: What this means for customers (better product, not just company growth)
Avoid: Excessive emojis, bragging, vague promises

Provide 3 versions:
1. Founder voice (personal, mission-driven)
2. Company voice (professional, forward-looking)
3. Short version for Twitter/X (280 characters)
```

### Product Description

Primary techniques: buyer context, benefit-first structure, SEO constraints.

**Before:**
```text
Write a description for my product
```

**After:**
```text
Write an e-commerce product description.

Product: Wireless noise-canceling earbuds
Key specs: 30hr battery, ANC, transparency mode, IPX4, Bluetooth 5.3
Price point: $149 (mid-range, competing with Sony/Jabra)
Differentiator: Exceptional call quality with 6-mic array

Target buyer: Remote workers who take many calls
Purchase context: Upgrading from wired or basic wireless earbuds

Structure:
1. Headline: Benefit-focused (not feature-focused)
2. Opening hook: Pain point → solution (1-2 sentences)
3. Key benefits: 4-5 bullets, benefit first then feature
4. Social proof placeholder: [Reviews/Awards]
5. CTA: Clear, low-pressure

Tone: Confident, professional, not hyperbolic
Length: 150-200 words
SEO keywords to include naturally: wireless earbuds for calls, work from home earbuds, noise canceling earbuds for meetings
```

## Research & Analysis

### Market Research

Primary techniques: scope framing, strategic implications, uncertainty handling.

**Before:**
```text
Research the electric vehicle market
```

**After:**
```text
Provide a market analysis of the US electric vehicle market for a strategic planning presentation.

Focus areas:
1. Market size and growth trajectory (2020-2030)
2. Key players and market share breakdown
3. Consumer adoption drivers and barriers
4. Regulatory landscape (federal and state incentives)
5. Infrastructure development status (charging networks)
6. Emerging trends and disruption risks

For each section:
- Current state (with recent data points if known)
- Key trends
- Implications for [automotive parts supplier entering EV components]

Output format: Structured analysis suitable for exec presentation
Depth: Strategic overview (not deep technical detail)
Flag any data points where you're uncertain of recency
```

### Competitive Analysis

Primary techniques: comparison matrix, objective framing, roadmap implications.

**Before:**
```text
Analyze our competitors
```

**After:**
```text
Create a competitive analysis comparing [Our Product] to [Competitor A] and [Competitor B] in the project management software space.

Analyze across:
| Dimension | Our Product | Competitor A | Competitor B |
|-----------|-------------|--------------|--------------|
| Core features | | | |
| Pricing model | | | |
| Target customer | | | |
| Key differentiator | | | |
| Main weakness | | | |

Additional analysis:
- Feature gaps we should address (prioritized)
- Positioning opportunities they've missed
- Threats from each competitor
- Recommended competitive response

Context: We're a smaller player ($5M ARR) competing against established incumbents
Goal: Inform product roadmap priorities
Be objective—don't just tell me we're better
```

## Educational & Explanatory

### Technical Explanation

Primary techniques: audience calibration, scope exclusions, practical framing.

**Before:**
```text
Explain how blockchain works
```

**After:**
```text
Explain blockchain technology for a specific audience.

Audience: MBA students with business background, limited technical knowledge
Context: 10-minute segment in a "Digital Transformation" course
Goal: Understand enough to evaluate blockchain proposals, not implement

Cover:
1. Core concept: What problem does it solve? (1 paragraph)
2. How it works: Simple mental model (use analogy)
3. Key properties: Decentralization, immutability, transparency
4. Real applications: 2-3 concrete business use cases
5. Limitations: When NOT to use blockchain
6. Key questions to ask vendors making blockchain proposals

Avoid: Cryptographic details, consensus algorithm specifics, cryptocurrency focus
Use: Business analogies, clear examples, practical framing
Length: 800-1000 words
```

### Tutorial Creation

Primary techniques: prerequisite framing, progressive complexity, workflow focus.

**Before:**
```text
Write a tutorial for using Git
```

**After:**
```text
Create a beginner Git tutorial for new developers joining our team.

Scope: Daily workflow commands only (not advanced topics)
Prerequisites: Command line basics, has Git installed
Goal: Able to contribute code within first week

Structure:
1. Quick conceptual overview (what is Git, why we use it)
2. Initial setup (config, SSH key—link to detailed docs)
3. Core workflow:
   - Clone a repo
   - Create a branch
   - Make changes and commit
   - Push and create PR
   - Pull updates from main
4. Common "oh no" situations and how to fix them:
   - Committed to wrong branch
   - Need to undo last commit
   - Merge conflicts (basic)
5. Cheat sheet: Commands they'll use daily

Format: Step-by-step with command examples
Tone: Encouraging, acknowledge it's confusing at first
Include: Our specific conventions (branch naming, commit message format)
```

## Prompts for AI Tools

### Image Generation

Primary techniques: visual composition, style constraints, negative constraints.

**Before:**
```text
Make a picture of a sunset
```

**After:**
```text
Create a photorealistic image:

Subject: Sunset over a calm ocean with a small sailboat
Style: Photography, golden hour lighting
Composition: Wide shot, rule of thirds with horizon on lower third
Mood: Peaceful, contemplative
Color palette: Warm oranges, deep purples, silhouetted boat
Details: Light reflecting on water, wispy clouds catching color, boat has white sails
Avoid: People, text, harsh shadows, oversaturation
Aspect ratio: 16:9 (landscape)
Quality: High resolution, suitable for website hero image
```

### Data Analysis

Primary techniques: data context, analysis questions, action-oriented output.

**Before:**
```text
Analyze this sales data
```

**After:**
```text
Analyze the attached sales data and provide insights.

Data context:
- Time period: Q1-Q3 2024
- Columns: Date, Product, Region, Revenue, Units, Customer_Type
- Business: B2B software, subscription model

Analysis requested:
1. Revenue trends: Monthly growth rate, seasonality patterns
2. Product performance: Which products growing/declining?
3. Regional breakdown: Where are opportunities and concerns?
4. Customer segments: New vs. existing customer revenue split
5. Anomalies: Any data points that need investigation?

Output:
- Key findings summary (top 5 insights)
- Supporting visualizations described (I'll create them)
- Recommended actions based on data
- Questions the data raises but doesn't answer

Prioritize actionable insights over exhaustive description.
```
