---
name: adr
description: Writes an Architecture Decision Record (ADR) for a technical decision, with context, the options considered, the decision and its consequences.
when-to-use: When the user asks to record, document or justify an architecture or technology decision, or mentions an ADR.
argument-hint: "[decision title]"
---

# Write an Architecture Decision Record

## 1. Find where ADRs live

Look for an existing ADR folder: `docs/adr/`, `docs/decisions/`, `adr/` or `architecture/decisions/`.
If one exists, read the two most recent records and copy their numbering, file naming
and section headings exactly. If none exists, use `docs/adr/NNNN-kebab-title.md`
starting at `0001`.

## 2. Gather the facts before writing

An ADR is only useful if a reader a year from now can see why the decision made sense.
Establish, from the conversation and the code:

- **The forcing problem.** What is broken, missing or about to become expensive? Cite
  files, metrics, incidents or requirements, not opinions.
- **Constraints.** Deadlines, team skills, budgets, compliance, existing contracts.
- **Options.** At least two real alternatives, including "do nothing" when it is viable.
- **The decision**, and who made it, if known.

If the decision itself is still open, say so and write the record with status
`Proposed`. Do not invent a decision the user has not made.

## 3. Write the record

```markdown
# NNNN. <Decision as a short imperative: "Use PostgreSQL for the event store">

- Status: Proposed | Accepted | Superseded by NNNN
- Date: YYYY-MM-DD
- Deciders: <names or roles, if known>

## Context
<The problem and constraints, in plain prose. Facts with sources.>

## Options considered
### <Option A>
- Pros: …
- Cons: …
### <Option B>
…

## Decision
<What we will do, stated so it can be checked later.>

## Consequences
- Positive: …
- Negative: … (be honest; every real decision has some)
- Follow-up work: …
```

## 4. Close the loop

- If this record supersedes an older one, update the older record's status line to
  `Superseded by NNNN` and link both ways.
- If the repository has an ADR index or README listing records, add the new entry.
- Show the user the file path and the one-line decision.
