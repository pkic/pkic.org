---
name: pkic-review
description: Review PKIC change designs, PRs, and follow-up fixes for correctness, reuse, UI consistency and accessibility, SQL safety, D1 cost, and migration necessity. Use before substantial implementation and before submitting or updating a PR.
---

# PKIC review

Use the applicable mode below. Root and scoped `AGENTS.md` files own the standards and validation policy; this skill supplies the review method. It works with any review provider and requires no paid service.

## Design: before substantial implementation

- Identify the canonical contract, policy, data owner, and all entry points that change the same state. For new behavior or UI, identify the closest existing implementation and decide what to reuse, extend, or extract before coding.
- Sketch success, refusal, concurrent change, and recovery. Include alternate actors, reloads, retries, and provider failures where relevant.
- For database changes, answer the D1, SQL, and migration questions below before writing code. Keep the assessment internal unless a decision is needed.

## Pre-PR: review the proposed change

- Establish the target base, head, and any uncommitted changes. Review the complete proposed diff and trace affected callers, middleware, persistence, and consumers; a clean helper alone does not establish a correct workflow.
- Check correctness, readability, architecture, security, and performance against the intended behavior. Apply the reuse and UI checks below where relevant; examine missing paths and failure states, not just added lines.
- Verify tests would fail for the actual defect. Exercise mounted routes when middleware matters; inspect raw responses for disclosure risks and parse captured requests through their shared contracts.
- Check validation evidence using repository policy. Do not repeat unchanged checks or spend review tokens reproducing lint, formatting, or other deterministic gates. Suggest a focused automated check for a recurring mechanical defect.

## Incremental: review follow-up changes

- Keep a receipt in the chat or existing review record: repository, base SHA, reviewed head SHA (and dirty patch identity if applicable), scope, findings, and checks. Do not commit review logs.
- Review the delta from the last reviewed snapshot, its affected dependencies, and unresolved findings. Recheck the fix and its consequences; do not re-report disproved findings without new evidence.
- Reassess impacted earlier conclusions when the base, contracts, authorization, or schema changes. After rebases, match snapshots reliably or review the full proposed diff. Without a reliable receipt, use pre-PR mode.
- Bind conclusions to the reviewed snapshot. A changed head or unfinished check is not covered by an earlier verdict.

## Reuse and UI: when behavior or screens change

- Search by responsibility and user journey, not just symbol names. Compare similar components, hooks, functions, query builders, and services outside the diff; duplication checks miss implementations with different syntax but the same job.
- Prefer the canonical implementation. If it lacks a capability, identify the gap and extend it or extract the shared responsibility, updating affected callers together. Keep genuinely different policies explicit; avoid a generic abstraction with unrelated modes or speculative future uses.
- Check composition as well as individual controls. Using shared buttons inside a duplicated sign-in flow still duplicates authentication behavior. A different entry point should reuse the existing flow where its responsibilities match.
- For UI, use [pkic-ui](../pkic-ui/SKILL.md) and its catalog. Compare the rendered result with the closest existing screen, including hierarchy, action placement, feedback, and terminology; shared tokens alone do not establish consistency. Inspect the required desktop/phone screenshots.
- Walk the task: is the next action clear, is feedback truthful, and can users recover from refusal, failure, or interruption without losing work? Check relevant loading, empty, error, and success states.
- Verify keyboard operation, focus order and restoration, accessible names, error/status announcements, and zoom/reflow in the rendered UI. Screenshots and automated accessibility checks alone cannot establish usable interaction. Report concrete task barriers or pattern deviations, not personal styling preferences.

## D1 and SQL: when queries or persistence change

- Count round trips across the complete mounted request, including authentication and response reads. Aim for one bounded batch where feasible; explain and measure necessary extra boundaries. Distinguish SQL statement count from binding calls and production latency.
- Inspect set-based alternatives, row/parameter bounds, pagination, stable ordering, and relevant indexes/query plans. Check worst-case cardinality; moving N+1 calls into one unbounded batch is not sufficient.
- Trace request and stored input into query builders. Bind values; allowlist dynamic identifiers, operators, and sort directions through canonical helpers. Check placeholder order and empty-list behavior. Parameterization does not establish authorization.
- Verify resource scope and permission predicates on every read/write path, including authenticated callers, exports, counts, and search. Check joins, NULL handling, aggregation, and duplicate rows for unintended disclosure or mutation.
- Check write-time guards and all dependent audit/outbox effects. A conditional write affecting zero rows is not a SQL error: prove dependent statements cannot commit an invalid transition. Exercise stale state, rollback, and retries at the actual boundary.

## Migrations: before accepting a schema change

- Can the existing normalized data, a query, or domain policy solve the problem? Explain why the simpler alternative is insufficient before adding storage.
- Does this duplicate profile/derived data, introduce another source of truth, or add synchronization and cleanup work? Distinguish necessary durable history from a convenience snapshot.
- Compare additive alternatives and deployment compatibility; apply the migration-ledger, approval, and recovery requirements in root `AGENTS.md`. Report required manual steps separately from deployment.

## Findings and cost

- Validate each finding against current code and existing safeguards. Separate the demonstrated defect from the suggested fix; choose the smallest effective correction rather than automatically accepting a reviewer's design.
- Trace security claims across real trust boundaries, including authenticated users. Use focused security guidance for changed boundaries; reserve full audits for explicit requests. Never treat authentication alone as proof of authorization.
- Default to one focused review pass. Escalate depth for concrete unresolved risks; do not require multiple providers, full audits, or repeated clean reviews for routine work.
- No docstring percentage target. Flag missing or misleading explanations when contracts, SQL assumptions, concurrency, or retry behavior would otherwise be ambiguous. Avoid comments that restate code.
- Lead with blockers and remaining checks. Each finding: **priority · file:line · trigger → consequence · correction**, usually under 60 words. Group optional nitpicks as nonblocking; do not invent findings to fill categories.
- If none remain, say "No actionable findings" with the reviewed scope and any validation limits. Keep PRs, issues, and handoffs concise using the root communication rules and PR template.
