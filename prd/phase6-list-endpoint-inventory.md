# Phase 6.0 — List/Search Endpoint Inventory

Generated for P6-00 (`prd/reviewtofix.md` Phase 6). Independently re-derived the
"manual URL/searchParams processing" count cited in the source doc via:

```
grep -rl "new URL(c.req.raw.url)" functions/api/v1   →  29 files
grep -rl "searchParams.get" functions/api/v1          →  29 files (same set)
```

Of those 29 files, 13 are real list/pagination anti-pattern instances (10 unique
"needs migration" endpoints plus edge cases below), 1 is a migrated-in-this-remediation
endpoint that deliberately keeps manual parsing (`portal/vote-proposals`, documented
rationale — see P6-05), 1 is a conforming small list whose manual-URL usage is for a
bearer token, not pagination (`members/applications/:id/documents`), and 14 are not
list endpoints at all (single-resource/token lookups, downloads, OG image generators).

**The cited "34" upper bound from `pr-review-post-rebase.md` was already an overcount**
even before dedup. The real, independently-verified "manual URL parsing in a route
handler" count is **29 files**, of which **~15–17 are genuine list-endpoint violations**.

---

## 1. Migrated in this remediation (Phase 6 items 6.1–6.6)

All confirmed: `openApiRoute` + `paginationQuerySchema.extend()` + `data.query` + service
function doing `LIMIT ?/OFFSET ?` + real `COUNT(*)` (via `Promise.all`) + `buildPageInfo`.

| # | Method/Path | File | Default/Max limit | Count strategy | Frontend | Tests |
|---|---|---|---|---|---|---|
|1|`GET /api/v1/admin/applications`|`functions/api/v1/admin/applications/index.ts`|50 / 200|real `COUNT(*)`|`assets/ts/admin/sections/Applications.tsx`|`tests/admin-applications.test.ts`|
|2|`GET /api/v1/admin/organizations/content-reviews`|`functions/api/v1/admin/organizations/content-reviews/index.ts`|50 / 200|real `COUNT(*)`|`assets/ts/admin/sections/OrganizationContentReviews.tsx`|`tests/organization-content-review.test.ts`|
|3|`GET /api/v1/admin/access-grants`|`functions/api/v1/admin/access-grants/index.ts`|50 / 200, `userId` UUID-validated|real `COUNT(*)`|`assets/ts/admin/sections/access-control/Grants.tsx`|`tests/permission-grants.test.ts`|
|4|`GET /api/v1/votes`|`functions/api/v1/votes/index.ts`|20 / 200|real `COUNT(*)` (`listPublicVotes`)|`assets/ts/member-flows/votes-index-page.tsx`|`tests/votes.test.ts`|
|5|`GET /api/v1/portal/votes`|`functions/api/v1/portal/votes/index.ts`|50 / 200|real `COUNT(*)` (`listVisibleVotesForMember`, set-based)|`assets/ts/member-flows/portal/sections/Votes.tsx`|`tests/votes.test.ts`|
|6|`GET /api/v1/me/votes`|`functions/api/v1/me/votes.ts`|50 / 200|real `COUNT(*)` (`listMyVoteHistory`)|—|`tests/votes.test.ts`, `tests/me-endpoints.test.ts`|
|7|`GET /api/v1/portal/vote-proposals`|`functions/api/v1/portal/vote-proposals/index.ts`|50 / 200|real `COUNT(*)` (`listVoteProposals`, bulk-aggregated)|`assets/ts/member-flows/portal/sections/Votes.tsx`|`tests/votes.test.ts`|
|8|`GET /api/v1/admin/vote-proposals`|`functions/api/v1/admin/vote-proposals/index.ts`|50 / 200|real `COUNT(*)` (`listAllVoteProposalsForAdmin`, bulk-aggregated)|`assets/ts/admin/sections/Votes.tsx`|`tests/votes.test.ts`|
|9|`GET /api/v1/admin/events/:eventSlug/registrations`|`functions/api/v1/admin/events/[eventSlug]/registrations.ts` (service: `functions/_lib/services/registrations/admin-list.ts`)|50 / 200|real `COUNT(*)`|`assets/ts/admin/sections/events/detail/*`|`tests/admin-event-management.test.ts`|

**Caveat:** endpoint #7 (`portal/vote-proposals`) still hand-parses `new URL(c.req.raw.url)`
in `onRequestGet` rather than consuming `data.query` — documented deliberate design
(`scopeType` silently falls back to an empty filter on an invalid value rather than 400).
Not counted against the "needs migration" total.

---

## 2. Conforming — fully paginated, canonical pattern (pre-existing)

| Method/Path | File | Sort | Default/Max | Service fn |
|---|---|---|---|---|
|`GET /api/v1/admin/members`|`functions/api/v1/admin/members/index.ts`|none|50/200|`listAdminMembers`|
|`GET /api/v1/admin/organizations`|`functions/api/v1/admin/organizations/index.ts`|allowlisted, real `sortColumnSchema()`, 400 on unknown|50/200|`listAdminOrganizations`|
|`GET /api/v1/admin/sponsorships`|`functions/api/v1/admin/sponsorships/index.ts`|none|50/200|`listAdminSponsorships`|
|`GET /api/v1/admin/sponsorships/companies`|`functions/api/v1/admin/sponsorships/companies/index.ts`|none|50/200|grouped-by-company query|
|`GET /api/v1/admin/votes`|`functions/api/v1/admin/votes/index.ts`|allowlisted, real, 400 on unknown|50/200|`listVotesForAdmin`|

**Note:** only 4 shared-schema files import the real `sortColumnSchema` from `pagination.ts`
(`admin-applications.ts`, `admin-organizations.ts`, `access-control.ts`, `votes.ts`) — see
cross-cutting finding #1 below.

---

## 3. Conforming — small/bounded collections (no pagination needed by design)

24 endpoints scoped to naturally small cardinality (per-user, per-role, per-event,
per-vote, or an org-wide enumerable set of dozens, not thousands): admin
leadership-positions, mailing-lists, working-groups (admin + public), WG/consortium
meetings, leadership widgets, `/me/calendar`, `/me/working-groups`,
`/me/organization/reviews`, `/me/applications`, admin user emails/roles, role
assignments, sponsorship tier-config/events, vote ballots, application/member
documents, proposal reviews/speakers/comments/presentation-versions.

Two exceptions worth a follow-up ticket — hard-capped `LIMIT 200` with no `offset`/`hasMore`
(silently truncates past 200 rows instead of paginating; low risk today, activity-log scoped
to one proposal/registration):
- `GET /api/v1/admin/proposals/:proposalId/audit-log`
- `GET /api/v1/admin/events/:eventSlug/registrations/:registrationId/audit-log`

---

## 4. Needs migration — P1 (unbounded/N+1 on a table that can grow large, or schema declared-but-bypassed)

| Method/Path | File | Anti-pattern(s) | Response envelope | Count strategy |
|---|---|---|---|---|
|`GET /api/v1/admin/email/outbox`|`admin/email/outbox.ts`|Declares a query schema, wrapped in `openApiRoute`, but handler still does `new URL()` and never reads `data` (signature doesn't even take it). N+1-ish per-row template resolution for uncached versions.|`{outbox, summary, page:{limit,offset,total,hasMore}}` — shape is canonical, just hand-built|real `COUNT(*)`|
|`GET /api/v1/admin/events/:eventSlug/proposals`|`admin/events/[eventSlug]/proposals.ts`|Same "schema declared, `data` ignored" pattern. Uses `limit+1`-and-slice for `hasMore` *despite also* computing a real separate `COUNT(*)` — redundant and inconsistent. Sort is a 3rd hand-rolled dialect (`orderByMap`, not `sortColumnSchema`). Response has both legacy `pagination` and canonical `page` keys.|dual pagination keys (`pagination` + `page`)|both `limit+1` slice **and** real `COUNT(*)` (redundant)|
|`GET /api/v1/admin/forms/:formKey/submissions`|`admin/forms/[formKey]/submissions.ts`|**Truly unbounded SQL** — fetches *all* matching rows across 3 linked tables with no `LIMIT`, sorts/slices in memory. Thousands of rows could be materialized per request for a large event form. Manual `new URL()` throughout.|`{form, total, offset, limit, page:{total,hasMore}, ...}` — non-canonical `page` shape|none — `total = sorted.length` after full unbounded fetch|

## 5. Needs migration — P2 (dialect/consistency issues, or unbounded-but-currently-small risk)

| Method/Path | File | Anti-pattern(s) | Response envelope | Count strategy |
|---|---|---|---|---|
|`GET /api/v1/admin/audit-log`|`admin/audit-log.ts`|Manual `new URL()`, no Chanfana schema at all|`{entries, page:{limit,offset,total,hasMore}}` — already canonical shape|real `COUNT(*)`|
|`GET /api/v1/admin/donations`|`admin/donations.ts`|Manual `new URL()`, no schema|`{donations, summary, limit, offset, total}` — flat, no `hasMore`|real `COUNT(*)`|
|`GET /api/v1/admin/email-templates`|`admin/email-templates.ts`|Manual `new URL()`, no schema; `limit+1`-and-slice **plus** redundant separate `COUNT(DISTINCT template_key)`|`{templates, page:{limit,offset,hasMore,total}}`|both (redundant)|
|`GET /api/v1/admin/events`|`admin/events.ts`|**Fully unbounded** — no `limit`/`offset` at all, single CTE returns every event. No schema.|`{events}` — no envelope|none|
|`GET /api/v1/admin/events/:eventSlug/invites`|`admin/events/[eventSlug]/invites/index.ts`|Manual `new URL()`; `limit+1`-and-slice **plus** redundant separate `COUNT(*)`; no schema|`{invites, page:{limit,offset,hasMore,total}}`|both (redundant)|
|`GET /api/v1/admin/events/:eventSlug/permissions`|`admin/events/[eventSlug]/permissions.ts`|Manual `new URL()`, fully unbounded, no schema (low risk — event team rosters stay small)|`{permissions}` — no envelope|none|
|`GET /api/v1/admin/roles`|`admin/roles/index.ts`|`openApiRoute`-wrapped but handler still re-parses `new URL()` for `sort` (documented "quietly ignore invalid sort"); fully unbounded (low risk — roles table is small)|`{roles}` — no envelope|none|
|`GET /api/v1/admin/users`|`admin/users.ts`|Manual `new URL()`, no schema; `limit+1`-and-slice **plus** redundant real `COUNT(*)`. Largest table most likely to grow — watch for P1 graduation.|`{users, page:{limit,offset,hasMore,total}}`|both (redundant)|
|`GET /api/v1/members` (public directory)|`members/index.ts`|`openApiRoute`-wrapped with a query schema, but handler duplicates validation with its own `new URL()` + `safeParse` instead of using `data.query`|`{members, total, limit, offset}` — flat, **no `hasMore`**|real `total`|
|`GET /api/v1/sponsors` (public)|`sponsors/index.ts`|`openApiRoute`-wrapped but handler re-parses `new URL()` (comment: intentional, for a test importing `onRequestGet` directly); **fully unbounded**|`{sponsors}` — no envelope (dataset small today)|none|
|`GET /api/v1/sponsor-portal/events/:eventId/attendees`|`sponsor-portal/events/[eventId]/attendees/index.ts`|`data.query` pattern is fine, but **fully unbounded** — could grow to thousands for a large event|`{attendees}` — no envelope|none|
|`GET /api/v1/admin/donations/promoters`|`admin/donations/promoters.ts`|No schema/openApiRoute (plain Hono `app.get`); unbounded, dataset currently small|`{promoters}` — no envelope|none|
|`GET /api/v1/admin/email-templates/:key/versions`|`admin/email-templates/[key]/versions.ts`|No schema (plain `app.get`); unbounded, versions-per-template stays small|`{versions}` — no envelope|none|
|`GET /api/v1/admin/forms`|`admin/forms/index.ts`|No schema at all (plain Hono `app.get`); unbounded, forms count inherently small|`{forms}` — no envelope|none|

---

## 6. Not a list endpoint — out of scope

14 files appear in the `grep -rl "new URL(c.req.raw.url)"` hit list but are single-resource
lookups, token-gated actions, downloads, or image/RSS generators:
`events/[eventSlug]/forms.ts`, `events/[eventSlug]/registrations/confirm-email.ts`,
`events/[eventSlug]/registrations/confirm-info.ts`, `events/[eventSlug]/terms.ts`,
`invites/[token]/accept.ts`, `invites/[token]/decline-info.ts`, `invites/[token]/decline.ts`,
`invites/[token]/info.ts`, `invites/[token]/reminders.ts`,
`admin/events/[eventSlug]/presentations/download.ts`, `og/[code].ts`,
`og/card/[...path].ts`, `og/donation/[session_id].ts`, `members/applications/[id]/status.ts`.

Also excluded by category (not flagged by the manual-URL grep, but not list contracts):
`votes/feed.rss.ts` (RSS), `.../registrations/export.ts` (CSV export),
`sponsor-portal/.../attendees/export` (CSV export), Stripe/SendGrid webhooks,
`admin/stats` and `admin/events/:eventSlug/stats` (dashboard aggregates, not row lists).

---

## Summary

- **Total list/search endpoints inventoried:** 57
- **Migrated in this remediation (Phase 6.1–6.6):** 9 endpoints
- **Conforming, fully paginated (pre-existing):** 5 endpoints
- **Conforming, small/bounded collection:** 24 endpoints (2 flagged for a future real-pagination ticket — hard `LIMIT 200`)
- **Needs migration — P1:** 3 — `admin/email/outbox`, `admin/events/:eventSlug/proposals`, `admin/forms/:formKey/submissions`
- **Needs migration — P2:** 14 — `admin/audit-log`, `admin/donations`, `admin/email-templates`, `admin/events` (list), `admin/events/:eventSlug/invites`, `admin/events/:eventSlug/permissions`, `admin/roles` (list), `admin/users`, `members` (public), `sponsors` (public), `sponsor-portal/events/:eventId/attendees`, `admin/donations/promoters`, `admin/email-templates/:key/versions`, `admin/forms` (list)
- **Not a list endpoint, out of scope:** 19 files/routes total
- **Independently verified manual-URL-parsing file count:** 29, of which ~15–17 are genuine list-endpoint violations — confirms the cited "34" figure from the earlier review pass was already an overcount before excluding non-list files.

**Cross-cutting findings for future remediation (not this pass's scope, logged for tracking):**

1. **Three parallel duplicate allowlisted-sort schema helpers** exist: `pagination.ts`'s
   `sortColumnSchema()` (used by only 4 files), a near-identical local `sortValueSchema()`
   factory in `api.ts` (used by 4 more files), and 4 additional files that each hand-roll
   the identical `.refine()` logic instead of importing either shared helper. Should
   consolidate onto one canonical implementation per AGENTS.md's DRY requirement.
2. The "quietly ignore an invalid `sort` value, fall back to default order rather than
   400" behavior is intentional and repeated verbatim across 8+ files — a real, consistent
   design choice (not an oversight), meaning "allowlist enforced" in this codebase
   generally means "enforced-but-non-strict."
3. Several endpoints compute **both** a `limit+1`-and-slice `hasMore` **and** a separate
   real `COUNT(*)` in the same handler (`admin/email-templates.ts`,
   `admin/events/:eventSlug/invites`, `admin/events/:eventSlug/proposals`, `admin/users.ts`)
   — redundant work, fixable by deleting the `limit+1` slice path since a real count is
   already being fetched.

Every "needs migration" item above is tracked here with an explicit owner (this
document) and reason it wasn't migrated in this pass (out of the 6.1–6.6 scope defined
in `prd/reviewtofix.md`) — per the plan's instruction that "predating this PR is not by
itself a reason to mark something conforming."
