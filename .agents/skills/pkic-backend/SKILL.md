---
name: pkic-backend
description: Build, change, or review PKIC Worker routes, services, D1 queries, authentication, and live-room backend behavior. Apply the shared batching, replication, atomic mutation, and request-budget practices whenever backend behavior changes, including new features.
---

# PKIC backend

Apply this skill during ordinary implementation, not only performance investigations. Read the scoped `AGENTS.md` first. Extend canonical domain queries and planners rather than adding a second persistence or authorization model.

## Minimize stored data and independent state

- Before adding a table or column, inspect the existing schema, canonical read/write paths, and shared flows. Reuse or evolve them when they already represent the same responsibility. A new screen, endpoint, or implementation version does not justify another data model.
- Keep one authoritative source for each fact. Reference canonical records through keys and project values through joins or shared read models instead of copying data into feature tables, JSON, snapshots, or overrides that must be synchronized.
- Every new stored value needs a concrete product, integrity, or reliable-execution requirement. Challenge whether it can be derived or carried through an existing signed challenge instead. Do not persist speculative features, convenient history, or archive copies by default.
- Distinguish necessary state from duplication: an immutable publication, an artifact cache, or a durable retry request may be justified, but specify its owner, purpose, invalidation or expiry, and failure recovery. Do not introduce a second queue or lifecycle for the same work merely to support a new caller.
- A storage replacement must account for unfinished work and remove superseded storage and callers in the coordinated cutover. Do not silently abandon an old queue or retain it as an archive. Preserve canonical business records and follow the migration approval and recovery rules.
- Prefer the smallest coherent model, not the smallest table count. Do not hide independent entities in unrelated tables, unbounded JSON, audit logs, or delivery records to avoid a justified table. Explain why existing storage cannot satisfy each proposed addition before implementing it.

## Design the whole request

- Target **at most one D1 binding round trip per complete HTTP request**, including authentication, authorization, resource resolution, response projection, and request-owned background work. A preflight batch followed by a mutation batch is two calls; one call per helper does not meet the request target.
- Inventory reads and writes across the mounted route and its middleware before adding another database call. Do not copy an existing multi-call workflow as the default for a new feature.
- Compose existing prepared statement builders into a bounded batch, then decode through shared domain decoders. Builders prepare but do not execute; pure planners consume explicit snapshots and return statements. Reuse these same queries and policies from standalone helpers and combined use cases.
- `Promise.all` can overlap latency but still makes separate calls. A multi-statement `batch` is one call. Neither batching nor a lower call count makes expensive SQL cheap: keep indexed filters, bounded result sets, shared pagination, and query-plan checks where relevant.
- Bound serialized request and result sizes as well as row and statement counts. Project only fields the use case consumes before crossing D1; do not repeat large event settings, artwork, or snapshots per recipient. JSON chunking inside individual statements does not bound their combined batch payload. Page independent work with headroom, but never automatically split an atomic mutation into separate commits. For representative large-input regressions, enable `profileD1Flow(..., { measurePayloadBytes: true })` and assert request and result size ceilings; these JSON UTF-8 estimates are advisory about wire size, and local D1 may not enforce production RPC limits.
- Use joins, SQL subqueries, or set-based selections when a later read needs an ID from an earlier read. Avoid per-row queries, duplicate resource loads, and rereading values already validated or planned in this request. Project queued email data from the accepted form snapshot, not an uncommitted submission read.
- Do not force one call by duplicating policy in SQL, rewriting another helper's SQL strings, trusting client-supplied authority, dropping validation, or splitting an atomic command. If a genuine dependency still requires another call, report the unresolved boundary and measured count. Do not raise a budget or hide it in an allowance to declare completion.

## Authentication, replication, and atomic changes

- Verify JWTs locally through the canonical session machinery. Compose required live session, identity, and permission checks with resource reads. A valid signature alone does not replace canonical authorization; preserve acting-identity checks and delegated credential scope ceilings.
- Use the request's existing D1 session. Follow [db/session.ts](../../../functions/_lib/db/session.ts) for primary/replica routing and bookmarks; do not create unrelated sessions inside each helper. Preserve the existing transport and audience isolation of bookmarks. Bookmarks provide sequential consistency, not immediate visibility of another actor's changes. See Cloudflare's [Sessions and read replication guidance](https://developers.cloudflare.com/d1/best-practices/read-replication/).
- **Accepted PKIC policy:** read-side authorization may observe seconds of replica lag, including permission and session revocation. D1 supplies no fixed maximum lag. This is an explicitly accepted product tradeoff, not a defect to fix by forcing all reads to primary. Preserve existing primary-fresh capability/authentication exceptions and atomic primary authorization for mutations. Keep the canonical policy explicit in code when changing its implementation.
- A state-changing use case owns one atomic mutation batch: authorization/transition/capacity/form revision guards, business writes, history/audit, and durable outbox inserts. Batch rollback and compare-and-set guards remain necessary after preflight batching. Refresh the snapshot when retrying a recognized conflict; do not reinterpret arbitrary errors as races.
- Keep external effects behind their durable retry owner. Moving work into `waitUntil` does not remove its database cost or justify moving transaction-owned writes out of the atomic batch.

## Live interactions

Connected chat, questions, polls, reactions, and studio controls should use Durable Object storage and WebSockets with **zero per-message D1 calls**. Do not reintroduce D1 into acknowledgments or broadcasts through authorization, graphics refresh, or enrichment helpers.

Reuse [the canonical room access lease](../../../functions/_lib/services/live-session/room-access-lease.ts) and its policy, including background refresh, hard expiry, credential expiry, erasure, and admission checks. Its cached-authority window is additional to replica lag. Do not invent another cache or extend its lifetime to meet a latency budget. Verify that stalled D1 refreshes cannot stall an otherwise authorized live interaction and that expired leases refuse access.

## Prove the budget and the behavior

- For a new or converted D1-backed HTTP read, use the mounted router through [callApi](../../../tests/helpers/app.ts) with `{ maxRoundTrips: 1 }`. Zero-D1 gateways and connected live operations need zero-call coverage. For mutations, test the whole request too; a service preflight-only test is useful but must be labeled and reported as such.
- Use [profileD1Flow](../../../tests/helpers/d1-flow-profile.ts) for service/DO work and controlled per-call latency injection. Execute its returned prepared statements through the same wrapped database. Count failed and parallel calls, session calls, and request-owned `waitUntil` work. Keep parameter values and personal data out of diagnostics.
- Audit the smallest affected Worker test cohort with `PKIC_D1_BUDGET_MODE=warn pnpm run test:worker <files>`. Use `fail` or an explicit strict budget for converted workflows. An advisory warning is unfinished work, not a passing performance gate. Instrumentation only covers requests that use it; `app.fetch`, `SELF.fetch`, and internal DO work need their own measurement.
- Retain real D1 migration coverage for authorization, concurrent changes, capacity, rollback, retry, and outbox atomicity when touched. Inject race mutations at the intended write boundary using SQL matching, not blindly at the next batch: a newly batched read can otherwise invalidate the test's scenario.
- Exercise the actual query parameter combinations and rendered journey. Event page selection and sponsor authorization can exceed SQLite expression depth when nested together; inspect [events/read-selection.ts](../../../functions/_lib/services/events/read-selection.ts), preserve the independent authorization CTE, and retain exact Home-page query regressions in [event-request-round-trips.test.ts](../../../tests/event-request-round-trips.test.ts).
- Follow the repository's focused validation policy. Do not add a full-suite run or timing benchmark for every edit. Deterministic call counts can block regressions now; elapsed-time thresholds need a stable representative baseline before becoming blocking tests.

## Diagnose and report honestly

Treat 100 ms interactive latency as the product target, not a promise established by a query-count test. Separate SQL execution time, binding/network round trips, primary versus replica placement, Worker CPU/startup, external effects, and browser request waterfalls. Low dashboard SQL latency does not establish fast HTTP responses.

Compare equivalent journeys and datasets before and after changes. Use Worker profiling for `workerd`, Node profiling for build tools, and browser traces for rendering; do not infer runtime CPU from bundle size alone. Keep sensitive traces and approved production-shaped local data outside Git and preview. Existing operational permissions still apply.

Report the complete request count separately from any preflight or sub-operation count, SQL statement count, and elapsed time. State the instrumented coverage and remaining violations. Local batching results do not establish production geographic latency or completion of the platform-wide audit.

For D1 API semantics or limits, verify current [Cloudflare binding documentation](https://developers.cloudflare.com/d1/worker-api/d1-database/) rather than freezing provider limits in this skill.

## Text integrity and canonical profile corrections

- Decode text bytes as UTF-8 exactly once at transport/import boundaries; reject malformed UTF-8 rather than replacing bytes or treating them as Latin-1. Base64 is a byte encoding, so use the shared capability payload codec for JSON instead of applying `atob`/`btoa` directly to Unicode text.
- Use `firstNameSchema`, `lastNameSchema`, and `personNamePatchSchema` for naming writes across registration, proposals, own-profile editing, staff editing, and import/service entry points. Normalize canonical Unicode equivalents at the write boundary, preserve combining marks and supported joining characters, and do not normalize while the user types.
- Read models must still expose legacy invalid values so their owner or authorized staff can correct them. Never silently reinterpret a name as another character encoding, broaden one endpoint's validation to bypass another, or copy corrected names into feature records.
- A correction updates the canonical user through prepared profile statements, with live ownership/authorization guards, audit, and derived-artwork invalidation in the same atomic command. An email string or caller-supplied user ID is not authority; a scoped proof must be verified and rechecked against current ownership inside the batch.
- Test round trips for accented, decomposed, and non-Latin names; rejection of malformed encodings and unsupported characters; recovery from invalid saved data; and refusal of wrong-user, wrong-event, expired, or stale proof. Use fully synthetic fixtures. Never reuse customer names, email addresses, or other personal details from support reports, including partially renamed versions. Production data repairs require a reviewed target set and separate authorization; a code fix does not justify a bulk name rewrite.

## Verified email changes and representations

- Reuse the shared verified-domain organization chooser for registration and account email changes. A local-part correction preserves the representation. A domain change requires proof of the new mailbox and an explicit organization selection (or the individual identity for a personal mailbox).
- End a domain-backed representation only after the new address is verified and no other verified address on the account supports that organization. Unverified aliases never preserve or grant representation access. Keep the promotion, identity selection, access revocation, audit, and outbox in the same guarded atomic command; no additional tables or copied profile fields.
