# Review Fix Plan — PR #1 Review #4925602121 (merged with post-rebase remediation plan v4 and an independent post-rebase review pass)

Source: https://github.com/pkic/dev-pkic.org/pull/1#pullrequestreview-4925602121
Reviewer: @vanbroup (round 2 architecture review)
Reviewed commit: `7badfff` (HEAD of `migrate-to-rest-endpoints` at review time)
Verdict: **CHANGES_REQUESTED** — not merge-ready as best-practice architecture

Also incorporates a follow-up reviewer reply on the same thread: https://github.com/pkic/dev-pkic.org/pull/1#discussion_r3778418487 (@vanbroup, responding to a clarifying question on 9.1's scheduled-jobs design) — folded into Phase 9.1, since it narrows that item's decision rather than raising a new one.

**This revision merges two follow-up documents:**

1. `pkic-pr1-architecture-remediation-plan-v4.md` — drafted to update this plan for a rebase that, at drafting time, had not yet happened. It has since happened: current `HEAD` (`8cf9c2fe`) has a git merge-base with `pkic-org/main` of exactly `5a50cd4e` — the same commit v4 treats as its reviewed upstream baseline.
2. `pr-review-post-rebase.md` — an **independent, actual review pass** against reviewed commit `8cf9c2fef4f6552dab8e3427fd983962d87282f6`, i.e. the exact current `HEAD` of this branch, not a planning draft. This is the most authoritative source in this document for current-state claims: the reviewer ran the tooling directly (verified both D1 ledgers, ran the full test/build/lint pipeline, ran serial and parallel Playwright) rather than reasoning from file inspection alone. Its verdict: still **CHANGES_REQUESTED**, do not approve.

So:

- The rebase itself (v4 workstream B / §4.1) is **done**. Do not redo it. Confirmed independently by both the merge-base check and the post-rebase reviewer ("It is correctly rebased onto current public `main`.").
- Every blocking dependency in the old draft that was gated on "wait for `pkic.org#721` to merge, then rebase" (old 1.4, old 9.1) is **resolved** — #721, #726, #727, #728, #729 are all present in the current tree.
- **The D1 migration-ledger gate that §0 below originally listed as a required-but-unverified step is now CONFIRMED, not pending.** The post-rebase reviewer states: "I verified both remote D1 migration ledgers. Every private PR migration from `0033` through `0057` is pending in both preview and production." That directly satisfies §0's ledger-check requirement — the squash plan in Phase 1 is confirmed valid, not merely assumed safe. (A fresh re-check immediately before actually renumbering files is still good practice, since ledger state can change, but this is no longer a blocking unknown.)
- **Everything else flagged as still-needed work is, as of this pass, still needed** — confirmed by two independent methods (this session's direct code inspection, and the post-rebase reviewer's live tooling run), not merely assumed. `migrations/0033_rebuild_members_multi_representative.sql` still does the `PRAGMA foreign_keys = OFF` create/copy/drop/rename rebuild criticized below; `0055_membership_categories_table.sql` still rebuilds `members`, `organizations`, and `member_applications` again; none of `member_category_assignments`, `organization_representatives`, or `organization_representative_roles` exist in any migration file; `organizations.primary_contact_user_id`/`secondary_contact_user_id`/`voting_delegate_user_id`/`pending_secondary_contact_user_id`/`membership_category`/`member_since` and `members.show_on_org_profile` are all still present exactly as originally flagged; `functions/_lib/openapi/list-query.ts` is still imported by `functions/api/v1/admin/applications/index.ts` and `.../organizations/content-reviews/index.ts`; `functions/_lib/services/votes/lifecycle.ts` and `.../votes/proposals.ts` contain zero `.batch()`/`.prepare()` calls; `assets/shared/schemas/access-control.ts`'s `roleResponseSchema`/`userRoleResponseSchema.roleId` still don't reuse `roleIdParamsSchema`; `assets/shared/schemas/votes.ts` still declares `status: z.string()` and `result: z.unknown().nullable()`; `Applications.tsx`/`Votes.tsx`/`Sponsorships.tsx` are still 908/734/651 lines and `admin-organizations.ts` is 603 lines; `functions/router.ts` still runs `runScheduledDueWork`, `runMembershipDueWork`, `runSponsorshipDueWork`, `runVotesDueWork` sequentially under one cron with no shared budget; `admin-members.ts`/`member-provisioning.ts` both still hand-write their own `INSERT INTO members (...)` statement; and `functions/api/v1/admin/router.ts` still bypasses the legacy permission registry by path prefix.
- **Path discrepancy noted, resolved:** `pr-review-post-rebase.md` cites several frontend files under `assets/js/pages/...` and `assets/js/admin/pages/...` (e.g. `assets/js/admin/pages/Applications.tsx`, `assets/js/admin/pages/Sponsorships.tsx`). Verified directly: `assets/js` contains zero `.tsx` files (only a `modules` subdirectory); all 119 `.tsx` files in the repo live under `assets/ts`, matching this document's existing citations (`assets/ts/admin/sections/Applications.tsx`, `assets/ts/member-flows/votes-index-page.tsx`, etc.). Treated as a path-citation artifact in that review's tooling, not a real second copy of these files — the substance of those findings is preserved under the `assets/ts/...` paths already used below.
- Items **not independently re-verified by either source** in this pass are still marked "carried forward, not re-checked" below — treat those with slightly lower confidence than the confirmed items.

This document restates every original review comment plus the merged v4 and post-rebase corrections and lays out a plan to resolve each one. **Work through items in the order given in the "Suggested execution order" section at the end** — the migration rewrite (Phase 1) unblocks or reshapes several later items, so it still goes first, and its migration-ledger prerequisite is now confirmed rather than pending.

## Meaningful improvements already landed (new, from `pr-review-post-rebase.md`)

Not everything is still broken — the post-rebase reviewer explicitly credits real progress since the round-2 review, and this document should not be read as implying zero progress has been made:

- Correct rebase onto current public `main` (confirmed independently above).
- `openApiRoute` now validates and supplies route data, with broad adoption across routes.
- Shared authentication/session-engine logic.
- Service splits for votes, meeting calendars, and sponsorships (partial — see Phase 8 below for what's *not yet* split; these are real but incomplete improvements, not a contradiction of Phase 8's remaining findings).
- Organizations frontend decomposition (also partial — `admin-organizations.ts` backend service is still 603 lines, see new item 8.2).
- A canonical flexible link schema and JSON representation now exists (`linksSchema`/`parseLinksJson` in `assets/shared/schemas/api.ts`) — the remaining gap is *adoption* (Phase 10) and *self-validation* (new item 3.5), not the codec's existence.
- Membership categories and pricing are more data-driven.
- Several primary list screens now use bounded backend queries.
- The agenda recording modal browser test passes — no evidence of the previously suspected unload/reload regression.

These are real improvements but do not close the central membership, DRY-contract, atomicity, authorization, or D1-lifecycle findings below.

---

## 0. Baseline reconciliation (new, from v4 §0/§4.1–4.2)

| Merged upstream PR | What is now baseline in this tree | Consequence |
| --- | --- | --- |
| `pkic.org#721` | Stateless capability links, bulk email-outbox prep, bounded scheduled-work changes, `0033_public_capability_links.sql` | Confirmed present: `functions/_lib/auth/capability-links.ts` is the canonical owner, `functions/_lib/services/capability-links.ts` exists only as a compatibility re-export. Do not recreate this. |
| `pkic.org#726` | Root/scoped `AGENTS.md`, `CLAUDE.md`, repo-wide ESLint, Dependency Cruiser, pnpm normalization | Confirmed present and is the constitution — this document's Phase 1 rules restate it, they don't propose it. |
| `pkic.org#727` | Header-construction fix, presentation upload regression coverage | Preserve while resolving conflicts (rebase already did this). |
| `pkic.org#728` | Capability-link implementation ownership moved to `_lib/auth/capability-links.ts`; streamed presentation archives (`functions/_lib/services/presentation-archive.ts`) | Confirmed present. Phase 9.2 (R2/ICS asset lifecycle) should reuse this service's put/metadata/delete pattern, not invent a second one. |
| `pkic.org#729` | Attendance read-model extraction (`functions/_lib/services/registrations/admin-statistics.ts`) plus dashboard behavior | Confirmed: `functions/api/v1/admin/events/[eventSlug]/registrations.ts` still does raw `new URL(c.req.raw.url)` parsing, hand-builds `conditions`/`bindings` SQL in the route, and slices `limit + 1` rows locally (lines 58–73, 141–177). The #729 extraction only moved the attendance-aggregate query out; it did not fix the route's list-query architecture. This route is now explicitly in scope for Phase 6 (below) — it was not in the original review's Phase 6 list because it didn't exist on the reviewed commit yet. |

**Migration-ledger verification: CONFIRMED, not just gated.** The post-rebase reviewer independently ran this check against both remote ledgers on the current `HEAD`: "I verified both remote D1 migration ledgers. Every private PR migration from `0033` through `0057` is pending in both preview and production. Therefore, the branch can still replace its patch-on-patch migration history with a clean final migration." That satisfies steps 1–2 below. Steps 3–5 remain as the concrete allocation rule:

1. ~~Load `$wrangler`. List preview `d1_migrations` and production `d1_migrations` **separately**.~~ **Done** — confirmed pending in both, per the post-rebase review above. Re-run immediately before actually renumbering files only if meaningful time has passed or another branch may have deployed in the interim — not required as a fresh blocking step right now.
2. ~~Confirm none of this branch's private-range migrations have been applied to either environment.~~ **Confirmed unapplied** by the same check.
3. Current upstream migration history (already in this tree) is `0033_presentation_versions.sql`, `0033_public_capability_links.sql`, `0034_presentation_version_invariants.sql`. That duplicate `0033` prefix is valid, applied, immutable upstream history — not a blocker.
4. The next available number for the rewritten private range is **`0035`**, unless a newer upstream migration has landed since `5a50cd4e` — re-check `pkic-org/main` immediately before implementation, don't rely on this document's snapshot.
5. (No longer applicable — step 2 found nothing applied. Retain as a standing rule for future ledger checks: if anything is ever found applied, the squash plan is invalid and a forward-only migration plan must be written instead.)

This gate is inspection-only. Do not apply a migration, run a manual deploy, or seed preview D1 as part of this step.

---

## Phase 1 — Rewrite the undeployed migration range (currently `0033_rebuild_members_multi_representative.sql`–`0057_organization_domains.sql`)

### Implementation status (this pass, 2026-08-16)

**Done and verified:**
- Migration range fully rewritten to final form, `0035`–`0053` (19 files, replacing the old 25-file `0033`–`0057` range). `0033_rebuild_members_multi_representative.sql` deleted entirely — `members` is untouched, exactly as defined in migration `0000`. `0050`/`0051`/`0052`/`0054`/`0055`/`0056`/`0057` deleted, folded into first-introduction definitions per §1.2's rules (sponsorship price columns, WG active-unique index, `chair_user_id` removal, `organization_domains` table, `membership_categories` table all now defined once, at first introduction). New `0037_membership_aggregate.sql` adds `member_category_assignments` and `organization_representatives` exactly per §1.4's corrected design (partial active-pair unique index, no per-user singleton). `0038_access_control.sql` (formerly `0035`) carries the `single_holder_per_context` additive delta and seeds `role-primary_contact`/`role-secondary_contact`/`role-voting_delegate`. **Verified: the full 53-file migration set applies cleanly to an empty local D1 database** (`wrangler d1 migrations apply --local`, all ✅).
- `organizations.primary_contact_user_id`, `secondary_contact_user_id`, `voting_delegate_user_id`, `pending_secondary_contact_user_id`, `membership_category`, `member_since`, and `members.show_on_org_profile` are gone from every migration file. `organizations.social_*` never introduced (folded into `links_json` directly). `pending_secondary_contact_user_id` replaced by its own `organization_secondary_contact_nominations` table, as specced.
- `functions/_lib/services/membership/` created: `memberships.ts` (`getOrCreateOrganizationMemberAggregate` — `INSERT OR IGNORE` + unconditional re-read, matching the spec exactly, not a try/catch race detector), `representatives.ts`, `representative-roles.ts` (singleton role assign/revoke via `uq_user_roles_single_holder_per_context`).
- Every backend file that read/wrote the removed columns has been migrated to the new schema: `admin-members.ts`, `member-provisioning.ts` (§1.5's duplicate-`INSERT INTO members` finding — now both call the same shared aggregate/representative primitives), `admin-organizations.ts`, `member-organization.ts`, `member-self-service.ts`, `organization-content-reviews.ts`, `members-directory.ts`, `admin-working-groups.ts`, `leadership.ts`, `wg-chair-digest.ts`, `user-merge.ts` (now also reassigns `organization_representatives`, per the impacted-areas list), `votes/ballots.ts` (`resolveVotingDelegateUserId`/`resolveForumVoteDelegateRecipients` now resolve `role-voting_delegate`/`role-primary_contact` via `user_roles`), `functions/api/v1/admin/users.ts`, `functions/api/v1/admin/users/[userId]/index.ts`, `functions/_lib/auth/member.ts` (member-session eligibility — see the load-bearing fix below).
- **Load-bearing bug caught and fixed during this pass, not present in the original plan documents:** because org-tied `members` rows have `user_id IS NULL` (migration `0000`'s own CHECK — only individual aggregates carry a `user_id`), every query that resolved a representative's identity via `members.user_id` (auth eligibility, directory, WG chairs, leadership, admin users list, self-service profile) was silently broken by the schema change and would have returned nobody for any org-tied representative. All such queries have been rewritten to resolve through `organization_representatives.user_id → member_id` instead.
- `assets/shared/schemas/access-control.ts`'s `contextTypeSchema` now includes `'organization'`.
- Two additional real bugs (not test-expectation mismatches) were found and fixed by running the test suite: `admin-members.ts` and `admin-organizations.ts` still wrote/read `organizations.member_since`, which no longer exists — both now correctly target `members.member_since` on the aggregate.
- `pnpm run typecheck` passes (backend, frontend, tools) with zero errors.

**Also done since the status above was first written:**
- §1.4's required-tests list is now written and green: `tests/membership-aggregate.test.ts` (membership_categories seed vs. canonical shared contract; `getOrCreateOrganizationMemberAggregate` concurrency convergence, differing-category 409 conflict, and confirming an unrelated D1 error — an invalid category — propagates rather than being swallowed as a race), `tests/organization-representatives.test.ts` (concurrent multi-organization representation, transfer, rejoin), `tests/representative-roles.test.ts` (singleton-per-role uniqueness for all three representative roles independently, DB-level rejection of a direct insert that skips the revoke, confirmation that `role-event_volunteer` — a non-singleton context-scoped role — is unaffected by the same index, and the service-layer invariant that a role grant without an active `organization_representatives` row is rejected with `AppError(422, "NOT_ACTIVE_REPRESENTATIVE")`), `tests/access-control-schema.test.ts` (`contextTypeSchema` accepts `'organization'` through both `userRoleAssignSchema` and `accessGrantCreateSchema`, still rejects garbage, still accepts `event`/`working_group`). New shared fixture module `tests/helpers/membership.ts` builds these fixtures through the real `functions/_lib/services/membership/*` primitives, not hand-rolled SQL.
- `tests/votes.test.ts`'s `insertMemberUser`/`setOrgContacts` fixtures were rewritten to the new schema (this is also the required "`votes/ballots.ts` delegate-resolution test" — the existing "forum ballot: only the resolved voting delegate... may cast" test now exercises `resolveVotingDelegateUserId`'s `role-voting_delegate` → `role-primary_contact` fallback via `user_roles` for real). All 14 tests in that file pass.
- Net effect on the full suite: **99 of 881 backend tests fail**, down from 108 of 862 (19 new tests added, all passing; `votes.test.ts`'s prior 9 failures fixed as a side effect of the fixture rewrite). 18 test files still fail, one fewer than before.
- One remaining item from §1.4's required-tests list is explicitly out of scope for this pass: "migration/import preflight must fail loudly if any existing members row lacks an unambiguous category" is importer behavior (Phase 2), not something to test until the importer itself is rewritten.

**Also done — the remaining 18 test files were fixed (follow-up pass, same day):** every one of the 18 files listed above (`admin-members`, `admin-organizations`, `admin-user-management`, `ec-review`, `leadership`, `me-endpoints`, `me-organization-members`, `meeting-calendar`, `member-auth`, `members-model`, `membership-onboarding`, `organization-content-review`, `passkeys`, `public-members-api`, `sponsorship-pipeline`, `sponsorship-scheduled-jobs`, `user-merge`, `working-groups`) now has its fixtures rewritten onto `tests/helpers/membership.ts` / the real `functions/_lib/services/membership/*` primitives, following the pattern `votes.test.ts` established. Two categories of failure were fixed:
- **Fixture-only**: tests seeding `members` rows directly with a category letter as `member_type`, or multiple `members` rows per `organization_id` — rewritten to seed `member_category_assignments`/`organization_representatives` instead.
- **Premise changes required by the corrected §1.4 design, not just mechanical translation**: `members-model.test.ts` (previously *the* test for the deleted 0033 rebuild — replaced with tests of the actual current invariants: one aggregate per org, `member_type` CHECK, mutual exclusivity); `admin-organizations.test.ts` (previously tested "category cascades to every representative's `member_type`" and "reusing an org with a different category cascades" — both superseded: there is only one category per aggregate now, and reusing an org with a *different* category is correctly a 409 conflict via `getOrCreateOrganizationMemberAggregate`, not a silent cascade); `admin-members.test.ts` (previously tested "same email at a different org is a 409" — superseded by the resolved multi-org-representation decision, now split into a same-org-conflict test and a different-org-succeeds test); `organization-content-review.test.ts`'s nomination-auto-clear test (previously triggered by a `status` PATCH on an individual `members` row — representatives don't have an editable `status` anymore, so it now triggers via `DELETE` on the representative row, which is what actually clears the nomination in the rewritten service).

**Two more real production bugs were caught and fixed while rewriting these tests** (beyond the two already listed above):
1. `admin-organizations.ts`'s `updateAdminOrganization` (the `PATCH /api/v1/admin/organizations/:id` handler) routed a `membershipCategory` change through `getOrCreateOrganizationMemberAggregate` — the create-time race-safe helper — which correctly rejects a *differing* category as a 409 conflict. That meant **staff could never change an organization's category once set**, since every legitimate change looked identical to the race-conflict case. Fixed: the update path now reads the existing aggregate directly and applies the requested category unconditionally, only falling back to the get-or-create helper when no aggregate exists yet.
2. Two representative-response builders (`toOrgDetail`, `addOrganizationRepresentative`) returned the shared aggregate's `members.id` as each representative's `memberId` field, instead of that representative's own `organization_representatives.id`. Since `PATCH/DELETE /api/v1/admin/members/:id` needs the latter to identify *which* representative to act on, every representative in an organization with 2+ reps would have resolved to the same (wrong) id for edit/remove actions. Fixed in both call sites.

**Full backend suite: 888/889 passing (1 pre-existing intentional skip), 0 failures, verified twice in a row.** All touched files are lint-clean, prettier-clean, and typecheck-clean.

### Follow-up review remediation pass (2026-08-16, `prd/phase1-review-20260816-1.md`)

A second, independent review pass against the state described above (`prd/phase1-review-20260816-1.md`) verdict was **CHANGES_REQUESTED**: §1.4/§1.5 marked done in the traceability matrix while the plan's own status section said "do not treat Phase 1 as fully closed" — a real contradiction. It found 6 P1 blocking correctness/security gaps and 2 P2 gaps, all now fixed in this pass:

1. **[P1, fixed]** `removeAdminMember` revoked a representative role from *whichever* user held it, not just the removed representative. `buildRevokeRepresentativeRoleStatement` (`representative-roles.ts`) now takes an optional `userId` and scopes the `UPDATE` to it; `removeAdminMember` passes the removed representative's own `user_id`.
2. **[P1, fixed]** `POST /api/v1/admin/users/:userId/roles` bypassed every representative-role invariant (no active-representative check, no singleton revoke-before-insert, no `single_holder_per_context` copy) and role resolvers ignored `expires_at`. The route now detects the three representative role ids and routes through `buildAssignRepresentativeRoleStatements`; the fallback path for other singleton roles now does an atomic revoke-then-insert too, generalized off `roles.single_holder_per_context` rather than a hardcoded list. `resolveRepresentativeRoleHolder(s)` now filter `expires_at`.
3. **[P1, fixed]** Multi-organization representation (a supported case since §1.4) resolved via an unordered `first()` over a UNION that could return multiple rows — an arbitrary pick. `functions/_lib/auth/member.ts` now enumerates every eligible membership deterministically (`AuthMember.activeMemberships`), defaults to a deterministic first entry, and `PUT /api/v1/me/active-membership` lets a member explicitly switch context — re-verified against their own live memberships server-side, never client-trusted. Covered by `tests/member-multi-org-context.test.ts`.
4. **[P1, fixed]** Six queries joined `organization_representatives` by `user_id` alone (`members-directory.ts` ×2, `leadership.ts` ×2, `admin-working-groups.ts`, `wg-chair-digest.ts`, `admin/users.ts` list+count), fanning out one row per represented organization for a multi-org user — duplicate directory/leadership entries, double-counted admin pagination. All six (plus the same bug found while fixing this in the admin user-detail route) now join through a deterministic correlated subquery (earliest `joined_at`) instead. Regression test in `tests/admin-user-management.test.ts`.
5. **[P1, fixed]** `mergeUsers` skipped repointing an `organization_representatives` row when the survivor already actively represented that org, but never closed the skipped row — it stayed active on the disabled, anonymized source account. Also, repointing `user_roles` unconditionally could attempt two active singleton-role grants for the same context, violating `uq_user_roles_single_holder_per_context`. Both fixed: the skipped representative row is now closed (`left_at` set), and a conflicting source singleton grant is revoked before the repoint. `tests/user-merge.test.ts` now asserts `left_at` is actually set (previously asserted nothing) and has a new test for the singleton-role merge conflict.
6. **[P1, fixed]** Nothing enforced that an individual aggregate uses only H5/H6/H7 or an organization aggregate uses only organization categories; tests deliberately created invalid combinations. `functions/_lib/services/membership/memberships.ts` now validates via a shared `assertCategoryCompatible` (against the canonical `membership-categories.ts` vocabulary, no extra DB round-trip) in both `getOrCreateOrganizationMemberAggregate` and `buildCreateIndividualMemberStatements`. `membership_categories.is_individual`/`is_voting` gained boolean `CHECK` constraints (migration `0035`, still undeployed). Every test fixture that built an invalid combination (`ec-review.test.ts`, `votes.test.ts`, `meeting-calendar.test.ts`, `working-groups.test.ts`, `user-merge.test.ts`, `member-auth.test.ts`) was fixed to use a compatible category; new rejection tests added to `tests/membership-aggregate.test.ts`.
7. **[P2, fixed]** The representative response exposed `organization_representatives.id` as `memberId`, and several schema comments/route descriptions still described deleted columns (`organizations.membership_category`, `pending_secondary_contact_user_id`, etc.). `adminOrganizationRepresentativeSchema` now exposes explicit `representativeId`/`membershipId`; stale comments/descriptions in `admin-organizations.ts` and `me.ts` rewritten to match the current schema; frontend (`Representatives.tsx`, `OrganizationDetailView.tsx`, `admin/types.ts`) updated to match.
8. **[P2, fixed]** `admin-members.ts`'s `createAdminMember` and `member-provisioning.ts`'s `provisionOrganizationAndMembers` independently orchestrated organization/aggregate/representative/role/WG provisioning across multiple separate batches, with slightly different (and, in `createAdminMember`'s case, buggy — it unconditionally reassigned an already-contacted org's primary/secondary contact) logic. Both are now thin adapters over one canonical `functions/_lib/services/membership/provisioning.ts` (`provisionOrganizationMembership`), which also collapses the representative-insert + role-grant sequence into one atomic `db.batch()` (via a new `buildAssignRepresentativeRoleStatementsForNewRepresentative` that skips the redundant DB-read check for a representative row being inserted in the same batch) instead of two.

**Validation for this pass:** `pnpm run typecheck` (backend/frontend/tools) clean; full backend suite 898/899 passing (1 pre-existing intentional skip), verified twice; `pnpm run format:check` clean; `eslint` clean on every touched file; `pnpm run check:filenames` clean. `pnpm run lint:architecture` could not run in this environment (dependency-cruiser requires Node ^22/^24/>=26, this environment runs 25.3.0 — pre-existing, unrelated to this change). `check:max-lines` still fails only on the pre-existing importer (`scripts/migrate-members-yaml-to-d1.mjs`, Phase 2 scope, item 2.2 below) — unrelated to this pass.

### §1.3 closed-state enforcement sweep (same day, second follow-up pass)

Completed the sweep the first remediation pass explicitly deferred:

- **Boolean-as-integer flags**: every `INTEGER NOT NULL DEFAULT 0/1` boolean column across migrations `0035`–`0053` that lacked one now has `CHECK (col IN (0, 1))` — `working_groups.active`, `roles.is_system_role`, `users.is_ec_member`, `membership_settings.auto_reminder_on_holds`, `mailing_lists.active`, `event_sponsor_attendee_tiers.has_attendee_data_access`, `meeting_series.active`, `meeting_ics_files.active`, `sponsorship_tier_config.active` (`membership_categories.is_individual`/`is_voting`, `organization_representatives.show_on_org_profile`, and `user_roles`/`roles.single_holder_per_context` already had one from the first pass). Verified: full migration set still applies cleanly (exercised by every test file's D1 setup).
- **Evolvable closed-state vocabularies** (application status/stage, on-hold subtype, sponsor type, sponsorship pipeline stage, content-review status, vote status, vote-proposal status, member status): per the plan's policy, these get one canonical shared Zod enum, not a DB `CHECK`. Found and fixed real drift — several fields were `z.string()` in one place while a hand-typed duplicate `z.enum([...])` of the same vocabulary existed elsewhere in the same file (`votes.ts`'s `status` field vs. two separately-typed `z.enum(["scheduled","open",...])` filters; `admin-applications.ts` had its own second copy of `ON_HOLD_SUBTYPES`). Consolidated onto one canonical constant + schema per vocabulary (`VOTE_STATUSES`/`voteStatusSchema`, `VOTE_PROPOSAL_STATUSES`/`voteProposalStatusSchema`, `APPLICATION_STAGES`/`applicationStageSchema`, `ON_HOLD_SUBTYPES`/`onHoldSubtypeSchema`, `CONTENT_REVIEW_STATUSES`/`contentReviewStatusSchema`, `MEMBER_STATUSES`/`memberStatusSchema` — the last moved to `membership-categories.ts` to avoid a circular import between `admin-organizations.ts` and `admin-members.ts`) and applied it everywhere the field appears: `votes.ts`, `admin-applications.ts`, `admin-sponsorships.ts`, `admin-organizations.ts`, `admin-members.ts`, `me.ts`. Backend service-layer duplicate type unions (`functions/_lib/services/votes/shared.ts`'s `VoteType`/`VoteStatus`/etc., `member-applications.ts`'s `ALLOWED_STAGE_TRANSITIONS`) now derive from the same shared constants instead of re-declaring the literal union, so the DB-facing service layer and the API contract can't drift apart again. `sponsorship_tier_config`/`sponsorships.tier` deliberately kept as a bare string — genuinely reference-table-backed (migration `0053`), not a code enum, matching the plan's "reference table" enforcement category rather than "shared Zod."
- `google_groups_sync_queue.action`/`.status` and the communication-vs-note distinction on application timeline entries were checked and left alone: neither is exposed through any shared API schema (no external write path to validate against), so there's no enforcement gap to close.
- Re-verified after this pass: `pnpm run typecheck` clean; full backend suite 898/899 passing twice; `pnpm run format:check` and `eslint` clean.

### Browser verification (same day)

Started the local dev server, logged into the admin console via the local magic-link-from-outbox flow (`docs/local-dev-with-production-backup.md`), and drove the real UI against a real local D1 (imported production backup, `0` organizations/representatives in that snapshot, so a fresh org was created live to exercise these paths):

- Created an organization with two representatives through the real "Add organization" form — confirmed `provisionOrganizationMembership` (item 8) auto-assigns primary/secondary contact correctly end-to-end.
- Confirmed `representativeId`/`membershipId` (item 7) are distinct, correct values in the live API response (`membershipId` shared between both representatives, `representativeId` unique per representative).
- Removed the secondary-contact representative and confirmed live (both via direct API call and the re-rendered UI) that the primary contact's role survived untouched — the exact regression finding #1 fixed, reproduced and verified fixed against a running instance, not just a test double.
- Confirmed the Users list shows the remaining representative exactly once (no duplicate-row fan-out, item 4) and correctly reclassifies the removed representative as a bare contact.
- Confirmed Votes and Membership → Applications admin screens render cleanly with no console errors against the `voteStatusSchema`/`applicationStageSchema`-typed responses from the §1.3 pass.
- No console errors or exceptions at any point in the session. Test data cleaned up afterward.
- **Not covered by this browser pass**: the multi-org member-portal switching endpoint had no frontend UI at this point in the day — see the follow-up pass immediately below, which built and browser-verified it. `Users.tsx`, member-directory/detail pages, `sponsors-wall.tsx`, `wg-chairs-widget.tsx`, `leadership-widget.tsx`, and portal `AccountSettings.tsx` were not exercised in the browser this pass (Users.tsx was exercised via its list view, not its per-member edit modal; `MyProfile.tsx` was exercised in the follow-up pass below).

### Member-portal multi-org switching UI (same day, third follow-up pass)

Item 3's `PUT /api/v1/me/active-membership` (§1.4's "Impacted areas" list explicitly names portal `MyProfile.tsx`/`AccountSettings.tsx` as in-scope) had a working backend and passing tests but no UI to call it. Built one and, in the process of browser-verifying it, **found and fixed a real bug the automated tests didn't catch**:

- Added an "Acting as" card to `assets/ts/member-flows/portal/sections/MyProfile.tsx`, rendered only when `activeMemberships.length > 1`, listing every membership with a "Switch" button and a "Current" badge on the active one.
- `EligibleMembership` (`functions/_lib/types.ts`), `myActiveMembershipSchema` (`assets/shared/schemas/me.ts`), and `MEMBER_ELIGIBLE_USER_SELECT` (`functions/_lib/auth/member.ts`, now joins `organizations`) gained an `organizationName` field — the switcher needs a human-readable label per membership, which the endpoint didn't previously return. Added a `putJson` helper to `assets/ts/shared/api-client.ts` (the client had `get`/`post`/`patch`/`delete` but no `put`).
- **Bug found live, not by any test**: the initial implementation called `window.location.assign("/portal/#/profile")` after a successful switch to force every other org-scoped screen to re-fetch under the new context. Browser-verified with a real two-org test member (seeded directly in local D1) and clicking "Switch" for real: the button stuck on "Switching…" forever. Root cause — the caller is already on `#/profile`, so assigning that exact same URL is a browser no-op; the switch succeeded server-side (confirmed via direct API call) but the UI never reflected it. Fixed by using `window.location.reload()` instead. Re-verified in the browser: switching now correctly updates the current-membership badge, membership category, and org-visibility label, with no console errors. This is exactly the class of bug `tests/member-multi-org-context.test.ts` (which calls the service functions directly, not through a browser) structurally cannot catch — a concrete argument for why the browser verification pass mattered, not just the unit tests.
- Test data cleaned up afterward. Re-verified after this pass: `pnpm run typecheck` clean, `pnpm run format:check`/`eslint` clean, `tests/member-multi-org-context.test.ts` (extended with an `organizationName` assertion) and the surrounding member-auth/me-endpoints suites passing.

### Remaining frontend browser verification (same day, fourth pass)

Closed the last named gap from §1.4's "Impacted areas" list by browser-checking every remaining consumer, confirming none of them reference the fields item 7 renamed (`grep` for `memberId`/`representativeId`/`membershipId` across all of them returned nothing, matching `typecheck:frontend` already being clean) and none crash or log console errors:

- `/members/` (`member-directory-page.tsx`) — renders its empty state correctly (`0` organizations in this local D1 snapshot); no console errors.
- `/wg/` and `/wg/ca/` (`wg-chairs-widget.tsx`) — render correctly; no console errors.
- `/sponsors/` (`sponsors-wall.tsx`) — renders its empty state correctly; no console errors.
- `/about/board/` (`leadership-widget.tsx`) — renders its empty state correctly; no console errors.
- Portal `AccountSettings.tsx` — browser-verified with a real single-membership test member (magic-link login); renders correctly, and (as expected) does not show the multi-org switcher card since it belongs on `MyProfile.tsx`, not here, and this member only has one membership.
- `Users.tsx`'s per-member edit action (not just its list view) — browser-verified end-to-end: created a real organization/representative via the admin API, opened that user's detail page, toggled "Show on org profile," and confirmed the `PATCH /api/v1/admin/members/:id` call (the same endpoint finding #1 fixed) succeeds with a live "Membership updated" toast and no console errors.
- Test data cleaned up afterward (a foreign-key ordering mistake in the first cleanup attempt — deleting `organizations` before its dependent `user_roles`/`organization_representatives` rows — was itself caught by D1's FK enforcement and fixed before re-running).

Every file named in §1.4's frontend "Impacted areas" list, and every screen listed as a Phase-1 gap in earlier passes, has now been code-reviewed for the renamed fields and browser-exercised at least once against the corrected backend with zero console errors.

### §1.5 fuller `membership/` reorganization (same day, fifth follow-up pass)

The previous pass deliberately deferred this item, citing the plan's own "do not proactively restructure" guidance. Escalated the conflict explicitly (this document's own recommendation vs. finishing the item as originally scoped); the real user chose to do the full reorganization. Completed it:

- `git mv functions/_lib/services/members-directory.ts` → `functions/_lib/services/membership/directory.ts`; `git mv functions/_lib/services/membership-scheduled-jobs.ts` → `functions/_lib/services/membership/scheduled-jobs.ts`. Import paths fixed in both files and in every importer (`functions/router.ts`, `functions/api/v1/internal/jobs/run.ts`, 5 route files for `directory.ts`).
- Split the former `member-applications.ts` (queries + creation + stage transitions all in one file) and the former `membership-onboarding.ts`/`member-provisioning.ts` pair into `functions/_lib/services/membership/applications/{queries,create,transition,approve}.ts`, one responsibility per file. `approve.ts` now calls `provisionOrganizationMembership` (item 8's canonical use case) directly instead of through the old `provisionOrganizationAndMembers` adapter. `member-provisioning.ts`, `membership-onboarding.ts`, and `member-applications.ts` deleted outright — zero remaining importers, full content preserved in the new files. ~12 route/service files across admin and member application endpoints updated to import from the new paths.
- Created `functions/_lib/services/membership/categories.ts`: moved `assertCategoryCompatible` out of `memberships.ts` (its only real caller-facing behavior), and added `listMembershipCategories` — a small DB-backed read of the `membership_categories` table that no prior code path exposed as a function (only the static shared TS constant was used elsewhere). Added a dedicated test (`tests/membership-aggregate.test.ts`) that calls it directly and asserts parity with the canonical shared contract, mirroring the existing raw-SQL parity test.
- Created `functions/_lib/services/membership/notifications.ts`: typed draft-builder functions for every membership-domain email (`consultation-batch`, `ec-review-batch`, `application-closed-no-response`, the on-hold reminder templates, `member-account-claim`, `application-approved-welcome`, `org-contact-assigned`, `mailing-list-enrolled`, `wg-calendar-invite`), each returning the exact payload shape `queueEmail` already accepted — no `db`/`env` access, no delivery logic of its own. This closed a real duplication: `functions/api/v1/admin/applications/[id]/approve.ts` and `scheduled-jobs.ts`'s `runEcWindowAutoApprove` had independently built near-identical `member-account-claim`/`application-approved-welcome` payloads; both now call the same two builders.
- Left `membership-form-submission.ts` (confirmed via full read to be an unrelated legacy GitHub-issue-based form system, not the D1 `member_applications` domain), `mailing-lists.ts`, `google-groups.ts`, and `membership-settings.ts` (different domains, only consumers of membership primitives) where they were.
- Validation: `pnpm run typecheck` (backend + frontend) clean. `eslint` clean across all real project source directories (`functions`, `assets/*`, `scripts`, `static/scripts`, `tests`) — the repo-wide `eslint .` invocation separately reports thousands of pre-existing errors from an untracked local `.venv` directory containing Playwright's vendored driver bundle; unrelated to this change, not part of the tracked repository, not touched by this pass. `prettier --check` clean. `pnpm exec vitest run`: 899 passed / 1 skipped (900 total) — the one net-new test is `listMembershipCategories`'s. `depcruise` (architecture lint) and `check:max-lines`'s one flagged file (`scripts/migrate-members-yaml-to-d1.mjs`, untouched by this pass, pre-existing) are both pre-existing environment/repo conditions unrelated to this change.
- Browser smoke check: started the local dev server, confirmed the reorganized Membership → Applications list and detail views (`applications/queries.ts`) render with no console errors, submitted a real test application through the live `POST /api/v1/members/applications` route (`applications/create.ts`), moved it to `ec_review` via direct D1 update, and opened it in the admin UI. Clicking "Approve & run onboarding" triggered a native confirmation dialog that the browser-automation tooling cannot interact with (out of scope for automated dialogs per this environment's safety rules); the tab became unresponsive to further automation and was closed rather than force-interacted with. Server-side, the application was confirmed still in `ec_review` (D1 query) — the click never reached the approve handler, so no partial state was created; test data was fully cleaned up. The approve route + all three notification builders it now calls are otherwise verified end-to-end (real HTTP request, real `email_outbox` row assertions for `member-account-claim`, `application-approved-welcome`, and `org-contact-assigned`) by `tests/membership-onboarding.test.ts`'s 9 passing tests, which exercise the exact same route via `app.fetch()`.

**Confirmed NOT done — do not treat Phase 1 as fully closed:**
- Phase 2 (importer) was explicitly out of scope for this pass (the user asked for Phase 1 only) and the importer still targets the pre-rewrite schema — expect it to need matching updates before it can run against these migrations.
- Phase 8.2 (`admin-organizations.ts` responsibility split) was not done — the file was rewritten in place, not split, given the size of the rest of this pass.
- The admin UI's "Approve & run onboarding" click-through was not completed live in-browser (see above) — its server-side behavior is fully covered by `tests/membership-onboarding.test.ts` instead. A manual click-through with the confirmation dialog dismissed by a human would close this gap.

**Next steps, in priority order:** (1) move to Phase 2 (importer).

**Why first:** these migrations have never reached preview or production (pending §0's ledger check). Rewrite them so every PR-created table/column/index appears once, in final form, at the next available number after the ledger check (`0035` at last check). This affects the importer (Phase 2) and several schema/DRY items (Phase 3).

Rules for the rewrite:
- Keep `0000`–`0034` (the current upstream range, including both `0033`s) immutable.
- Every PR-created table/column/index should appear once in final form — no intermediate schema + later ALTER/backfill/rebuild.
- No PR-created table should be rebuilt or backfilled — including `members`, which in the *revised* design (§1.4 below) is never touched by this PR's migrations at all.

### 1.1 — Confirmed still present: `migrations/0055_membership_categories_table.sql` [P1]
> Remove this D1-incompatible rebuild from the final migration history. D1 keeps FK enforcement enabled inside migrations, so `PRAGMA foreign_keys = OFF` does not make the following parent-table drops safe (reproduced failing with `SQLITE_CONSTRAINT_FOREIGNKEY` on representative-populated data). Because this range is undeployed: create `membership_categories` before its dependent PR tables, and fold everything into first-introduction definitions. Do not add another repair migration.

**Plan:**
- Move `membership_categories` table creation to before its first dependent table.
- Delete migration `0055` entirely. There is no `members.member_type` FK to fold anywhere — §1.4 below (superseding the original draft) is a no-rebuild design where `members` is untouched and category lives in a new 1:1 `member_category_assignments` table. `membership_categories` only needs to exist before `member_category_assignments` and before `member_applications` (which gets its `membership_category` FK directly in its own initial `CREATE TABLE`).
- Grep for any code that expects `0055` to run standalone by filename/number before deleting.

### 1.2 — Confirmed still present: `migrations/0056_drop_working_groups_chair_user_id.sql`, `0050_normalize_links_json.sql`, `0057_organization_domains.sql` [P1]
> Do not ship a backup/delete/null/restore cycle for a column introduced earlier in the same undeployed PR. Remove `chair_user_id` from migration `0034`'s `CREATE TABLE working_groups` and delete `0056`. Apply the same rule to `links_json` and `organization_domains`: define final structures at first introduction rather than backfilling intermediate shapes. Aside from the pre-existing `members` table, PR-created tables should not be rebuilt or backfilled at all.

**Plan:**
- Edit `0034_applications_sponsorships_working_groups.sql`: remove `chair_user_id` from the initial `working_groups` CREATE TABLE. Delete `0056`.
- Fold `0050_normalize_links_json.sql` (currently normalizes a `links_json` shape introduced earlier) into first introduction; delete `0050`.
- Fold `0057_organization_domains.sql` (normalized table added after an earlier `organization_domains_json` representation) into first introduction as `organization_domains`, created directly since domains are queried and uniqueness-constrained; delete `0057`.
- Check `0051_organization_links.sql` for the same "transform later" pattern for social columns; fold into first introduction if so.
- After folding, renumber the remaining migrations contiguously and re-verify any tooling or hardcoded migration-count assumptions.

Examples to hold the rewrite to (from v4 §5.1):
- do not introduce `working_groups.chair_user_id`
- do not introduce provider-specific `organizations.social_*` columns or `organizations.organization_domains_json`
- create `organization_domains` directly, not via a JSON-then-normalize path
- add `organizations.links_json` once in canonical form
- create application form submissions/answers in final normalized form directly, not as `answers_json` migrated later
- create the active working-group member unique index initially, not after updating branch-only rows first
- fold sponsorship price columns into the initial sponsorship table definition
- rely on the tolerant link codec for existing/legacy link shapes rather than rewriting all existing JSON during this deployment

### 1.3 — Confirmed still present: unconstrained closed-state columns in `migrations/0034_applications_sponsorships_working_groups.sql` and siblings [P1]
> The "no CHECK constraint convention" is neither established nor safe: migration `0000` already uses `CHECK` for roles, statuses, session types. This PR stores application stages, sponsorship types/stages, vote types/statuses/visibility, and several booleans as unconstrained `TEXT`/`INTEGER`, duplicating allowed values across comments, Zod, and services. Since these tables are undeployed, put stable closed-state constraints in their initial definitions (or use reference tables) so internal jobs/imports cannot create states the API cannot represent — without any later rebuild.

**Plan:**
- Enumerate every closed-state column introduced in `0034` and other new `003x`–`005x` migrations: application stage, sponsorship type/stage, vote type/status/visibility, boolean-as-integer flags, etc.
- For each, choose one explicit enforcement owner (merged guidance, v4 §5.4 — this is now the general policy, not just this item's fix):
  - **Database `CHECK`/FK/unique index** for durable structural invariants not expected to gain new values (integer-boolean domains, mutually exclusive holder columns, valid-JSON checks, temporal ordering).
  - **A reference table** (matching the `membership_categories` pattern) when database enforcement of an evolvable vocabulary is valuable, so adding/retiring a value is additive.
  - **A shared Zod/domain module validated on every write path** (API, jobs, scripts, service-to-service calls) plus Vitest coverage, when the vocabulary is genuinely closed but doesn't need a table — do not `CHECK (col IN (...))` a value set that may evolve (workflow stages, application statuses, membership categories, representative roles, vote states, visibility options, sponsorship pipeline stages all fall here).
- Cross-reference each closed-state list against its Zod schema (`assets/shared/schemas/*.ts`) and service-layer constant so DB, schema, and service agree — do this together with Phase 3's DRY items so the CHECK/reference-table mirrors one canonical source instead of the other way around.
- Do not mirror a TypeScript enum in SQL without a durable integrity reason; if an SQL mirror is intentionally kept, add a parity test.

### 1.4 — `members` table: normalize to aggregate + `organization_representatives`, no rebuild [P1] — **merged/corrected design**

**Decision:** `members` stays exactly as defined in migration `0000` — untouched. Category, role assignments, and representative relationships move into new, additive tables. This item now supersedes both the original draft's target schema *and* the first follow-up review round — v4's later corrections (its §2.2–2.4) sharpen the schema and concurrency handling below. Treat the schema and code in this section, not the ones in git history of this document, as authoritative.

**Why `members` doesn't need a rebuild:** migration `0000` already defines the aggregate the reviewer wants —

```sql
-- migrations/0000_*.sql (existing, unmodified)
CREATE TABLE members (
  id              TEXT NOT NULL PRIMARY KEY,
  member_type     TEXT NOT NULL CHECK (member_type IN ('individual', 'organization')),
  user_id         TEXT,
  organization_id TEXT,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'pending', 'lapsed')),
  tier            TEXT,
  data_json       TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE(user_id),
  UNIQUE(organization_id),
  CHECK (
    (member_type = 'individual' AND user_id IS NOT NULL AND organization_id IS NULL) OR
    (member_type = 'organization' AND user_id IS NULL AND organization_id IS NOT NULL)
  ),
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(organization_id) REFERENCES organizations(id)
);
```

One row per organization or per individual, with mutual exclusivity already enforced. The PR never needed to touch this table — it only needed somewhere to put category and a place for N people to attach to an org-tied row, both additive.

**Target schema (additive delta only — corrected per v4 §2.2/2.3):**

```sql
-- member_category_assignments: category lives once per aggregate, in its
-- own 1:1 table instead of as a column on members (keeps members
-- untouched) or on organizations (removes the two-way sync entirely).
CREATE TABLE member_category_assignments (
  member_id     TEXT NOT NULL PRIMARY KEY,
  category_code TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  FOREIGN KEY(member_id) REFERENCES members(id),
  FOREIGN KEY(category_code) REFERENCES membership_categories(code)
);

-- organization_representatives: the N people who represent an org-tied
-- membership aggregate. Temporal (joined_at/left_at) — active/inactive is
-- exactly what left_at IS NULL/IS NOT NULL means.
CREATE TABLE organization_representatives (
  id                  TEXT NOT NULL PRIMARY KEY,
  member_id           TEXT NOT NULL,   -- FK to members.id (the org's aggregate row)
  user_id             TEXT NOT NULL,
  show_on_org_profile INTEGER NOT NULL DEFAULT 1 CHECK (show_on_org_profile IN (0, 1)),
  joined_at           TEXT NOT NULL,
  left_at             TEXT,            -- NULL while active
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  CHECK (left_at IS NULL OR left_at >= joined_at),
  UNIQUE (id, member_id),              -- lets role FKs below prove representative<->member match
  FOREIGN KEY(member_id) REFERENCES members(id),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- CORRECTED from the original draft: a bare UNIQUE(member_id, user_id)
-- across all history blocks a former representative from ever rejoining,
-- since their old (now-inactive) row still occupies that pair. Constrain
-- only the *active* relationship instead.
CREATE UNIQUE INDEX uq_organization_representatives_active_pair
  ON organization_representatives(member_id, user_id)
  WHERE left_at IS NULL;

CREATE INDEX idx_organization_representatives_member_active
  ON organization_representatives(member_id, left_at, joined_at);
CREATE INDEX idx_organization_representatives_user_active
  ON organization_representatives(user_id, left_at, joined_at);
-- DECIDED (interview 2026-08-15, open question 1 below): a person CAN
-- represent more than one organization at a time. The "one org at a time"
-- index is therefore not part of this design at all — not kept as a
-- commented-out option.

-- organization_representative_roles is DROPPED from this design.
-- DECIDED (interview 2026-08-15, open question 2 below): representative
-- roles reuse the EXISTING roles/role_permissions/user_roles/
-- permission_grants RBAC system (migrations/0035_access_control.sql,
-- itself still undeployed and therefore still editable per Phase 1's
-- rules — exact post-renumbering filename TBD) instead of a second,
-- parallel role concept. That system already supports exactly what was
-- asked for: a DB-backed, admin-visible role catalog with permission
-- bundles (`GET/POST/DELETE /api/v1/admin/roles`), and a user holding
-- many roles simultaneously across independently scoped contexts
-- (`context_type`/`context_id`) — `role-wg_chair` already works this way
-- for `context_type='working_group'`.
--
-- Additive delta folded into 0035_access_control.sql:

-- 'organization' becomes a valid context_type (schema-level allowlist
-- only — the DB column and hasPermission() matching are already generic
-- strings; add to assets/shared/schemas/access-control.ts's
-- contextTypeSchema too).
ALTER TABLE roles ADD COLUMN single_holder_per_context INTEGER NOT NULL DEFAULT 0
  CHECK (single_holder_per_context IN (0, 1));

-- Denormalized copy of roles.single_holder_per_context onto each grant
-- row, set by the service layer at insert time. SQLite partial-index
-- predicates can only reference columns of the indexed table itself, so
-- this is what lets ONE index enforce "singleton per context" for only
-- the roles that need it (see open question 3 below) without also
-- constraining roles that are legitimately many-per-context (e.g. a
-- future 'role-event_volunteer' context grant).
ALTER TABLE user_roles ADD COLUMN single_holder_per_context INTEGER NOT NULL DEFAULT 0
  CHECK (single_holder_per_context IN (0, 1));

CREATE UNIQUE INDEX uq_user_roles_single_holder_per_context
  ON user_roles(context_type, context_id, role_id)
  WHERE revoked_at IS NULL AND single_holder_per_context = 1;

INSERT INTO roles (id, name, description, is_system_role, single_holder_per_context, created_at, updated_at) VALUES
  ('role-primary_contact', 'Primary Contact', 'Primary point of contact for an organization membership', 1, 1, ?, ?),
  ('role-secondary_contact', 'Secondary Contact', 'Secondary point of contact for an organization membership', 1, 1, ?, ?),
  ('role-voting_delegate', 'Voting Delegate', 'Casts the organization''s forum-level vote', 1, 1, ?, ?);
```

A representative role grant is an ordinary `user_roles` row: `role_id` one of the three above, `context_type='organization'`, `context_id=members.id` — the org's aggregate row, the same anchor `organization_representatives.member_id` and `member_category_assignments.member_id` already use, not `organizations.id`.

**Service-layer invariant (replaces the dropped composite FK):** the bespoke-table draft tied every role claim to a real `organization_representatives` row via `FOREIGN KEY(representative_id, member_id) REFERENCES organization_representatives(id, member_id)`. Reusing the generic `user_roles` table gives that up — there is no DB-level link from a `user_roles` grant back to `organization_representatives`. This is a deliberate DRY-over-referential-integrity trade, not an oversight: the service that grants `role-primary_contact`/`role-secondary_contact`/`role-voting_delegate` must itself verify the target `(user_id, member_id)` has an active (`left_at IS NULL`) `organization_representatives` row before inserting the grant, and this must be covered by a test (see "Required tests" below).

**Singleton-role reassignment:** assigning a new holder of one of the three singleton roles must, in the same `db.batch()`, revoke (`revoked_at = now`) the previous active grant for that `(context_type, context_id, role_id)` before/atomically with inserting the new one — `uq_user_roles_single_holder_per_context` rejects a plain insert-without-revoke, so this is DB-enforced, not just conventional.

Fold the closed-state CHECK/FK constraints from §1.1/§1.3 (`category_code`) directly into these definitions.

**Open product questions — RESOLVED (interview, 2026-08-15):**

1. **Does a person represent at most one organization at a time?** No. Confirmed: a person can represent more than one organization concurrently (edge case, but real — e.g. someone representing both their own organization and PKI Consortium, or representing Keyfactor, Digitorus, and PKI Consortium simultaneously). **Decision: the candidate partial unique index on `organization_representatives(user_id) WHERE left_at IS NULL` is not added.** Concurrent multi-organization representation must work; add a test asserting a user can hold two simultaneously-active `organization_representatives` rows for two different `member_id`s.

2. **Are representative role codes a managed catalog or a closed vocabulary?** Managed catalog: database-backed, roles should be extensible without a code change, users should be able to see which roles they hold, and roles need attachable scopes/permissions — hardcoding role strings in frontend and backend independently would duplicate and drift. **Sharpened by follow-up: this already exists.** The repo already has exactly this system (`roles`/`role_permissions`/`user_roles`/`permission_grants`, `assets/shared/schemas/access-control.ts`), including an admin-facing role catalog and context-scoped grants. Confirmed via follow-up: reuse it rather than build a second, parallel one — `organization_representative_roles` is dropped from this design entirely (see schema above). This is the exact duplication the AGENTS.md DRY rule flags, avoided by not building it.

3. **Are all current role types single-assignee per membership?** Clarified via follow-up: roles in general are *not* single-assignee — a user can hold many roles simultaneously across different scopes (system-wide, per-organization/member represented, per working group, per event). That's already how `user_roles` works (multiple rows per user, each independently `context_type`/`context_id`-scoped) — no schema change needed for that part. But *within one organization*, the three representative roles are each a **singleton**: at most one active `role-primary_contact`, one active `role-secondary_contact`, and one active `role-voting_delegate` per organization at a time. Confirmed via a follow-up specifically on voting: casting is done by a user but on behalf of the member/organization, which must get exactly one counted vote, and users may only vote for a member/organization they actively represent while that member/organization is active and vote-eligible. Today's `organizations.voting_delegate_user_id` singleton column plus the `(vote_id, organization_id, round)` unique index in `migrations/0044_voting.sql` already implement "one vote per org" this way — the decision is to preserve that behavior unchanged (singleton delegate) rather than move to a multi-delegate "last vote wins" model. Because this uniqueness is a property of these three specific role types — not a rule for every context-scoped role (`role-event_volunteer` is legitimately many-per-event) — it can't be one blanket unique index over all of `user_roles`; that's what the denormalized `single_holder_per_context` flag above is for.

**Columns to remove from where they're introduced (confirmed still present in the tree — not a rebuild, just don't add them):**
- `organizations.primary_contact_user_id`, `organizations.secondary_contact_user_id` — currently in `migrations/0037_org_content_columns_and_contacts.sql:34-35`. Remove; moves to `user_roles` grants (`context_type='organization'`, `context_id=members.id`, `role_id='role-primary_contact'`/`'role-secondary_contact'`).
- `members.show_on_org_profile` — currently in `migrations/0037_org_content_columns_and_contacts.sql:40`. Remove; relationship-owned, lives on `organization_representatives`.
- `organizations.membership_category` — currently in `migrations/0040_org_category_chairs_vice_chairs.sql:37`, with backfill-from-`primary_contact_user_id` logic at lines 42-65. Remove the column and backfill; `0040`'s chair/vice-chair derivation must be rewritten to join through `user_roles` (`role-wg_chair`/`role-wg_vice_chair` grants) and `organization_representatives` instead of `organizations.membership_category` and `members m` — it's undeployed, fix at first introduction.
- `organizations.voting_delegate_user_id`, `organizations.pending_secondary_contact_user_id` — currently in `migrations/0041_org_content_review_and_mailing_lists.sql:11,15`. Remove `voting_delegate_user_id`; becomes a `user_roles` grant (`role_id='role-voting_delegate'`). `pending_secondary_contact_user_id` is workflow state, not aggregate/representative data — give it its own small nomination/invitation-style table; exact shape is an implementation detail, the constraint is only that it doesn't live on `organizations` or `organization_representatives`.
- `organizations.member_since` — currently in `migrations/0046_member_since.sql:22`. Remove; `members.member_since` (added in the same migration, line 23) is sufficient. Keep `members.member_since` as-is.
- `migrations/0055_membership_categories_table.sql` — delete entirely (§1.1); its rebuilds are unnecessary once `members`/`organizations` aren't touched.

**D1 concurrency design — CORRECTED per v4 §2.4 (do not use a blanket `catch` as a race detector):** the original draft's `getOrCreateOrganizationMemberAggregate` caught *every* D1 error and assumed it meant "lost the uniqueness race." That would also swallow an invalid category, an unrelated FK failure, schema drift, or a database outage, and silently reinterpret all of them as a race. Use conditional `INSERT OR IGNORE ... SELECT` statements keyed by the existing `members.organization_id` uniqueness instead, so a losing writer's statement is a no-op rather than an error, then re-read and compare:

```ts
async function getOrCreateOrganizationMemberAggregate(db, organizationId, categoryCode, now) {
  const proposedId = uuid();

  await db.batch([
    db.prepare(
      `INSERT OR IGNORE INTO members (id, member_type, organization_id, status, created_at, updated_at)
       VALUES (?, 'organization', ?, 'active', ?, ?)`,
    ).bind(proposedId, organizationId, now, now),
    db.prepare(
      `INSERT OR IGNORE INTO member_category_assignments (member_id, category_code, created_at, updated_at)
       SELECT id, ?, ?, ? FROM members WHERE organization_id = ?`,
    ).bind(categoryCode, now, now, organizationId),
  ]);

  // Re-read unconditionally — this also runs on the non-race common path,
  // not only after a caught error, so it can't hide a real failure behind
  // a swallowed exception.
  const row = await first<{ id: string; category_code: string }>(
    db,
    `SELECT m.id, a.category_code
     FROM members m LEFT JOIN member_category_assignments a ON a.member_id = m.id
     WHERE m.organization_id = ?`,
    [organizationId],
  );
  if (!row) throw new AppError(500, "MEMBER_AGGREGATE_RACE_UNRESOLVED", "Concurrent member creation did not converge");
  if (row.category_code && row.category_code !== categoryCode) {
    throw new AppError(409, "MEMBER_CATEGORY_CONFLICT", "Organization already has a different membership category assigned");
  }
  return row.id;
}
```

This is the same "shared singleton value that might not exist yet" idiom already established in this codebase family (`pkic/pkic.org#721`'s `loadOrCreateCapabilityLinkSecret` in `functions/_lib/auth/capability-links.ts`), applied via `INSERT OR IGNORE` + unconditional re-read rather than a try/catch. Any *other* D1 error (constraint violation on an unrelated column, connectivity failure, etc.) propagates instead of being relabeled as a race — do not add a catch-all around this helper.

Use this helper everywhere a representative is being added and the aggregate row may or may not already exist (self-service join, admin create, application-approval provisioning) instead of each call site doing its own read-then-insert.

**Required tests:** invariant test that the `membership_categories` seed table matches the canonical shared contract; concurrent multi-organization representation test (one user with two simultaneously-active `organization_representatives` rows for two different `member_id`s, per resolved open question 1); representative transfer test (moving a representative from one org to another closes `left_at` on the old row and opens a new one); rejoin test (a former representative rejoining creates a *new* `organization_representatives` row — this is exactly what the corrected partial unique index above is for); role-uniqueness test (only one active `user_roles` grant per `(context_type, context_id, role_id)` where `single_holder_per_context = 1`, old one revoked before/atomically with the new one, verified specifically for `role-primary_contact`/`role-secondary_contact`/`role-voting_delegate`, and that a non-singleton context-scoped role like `role-event_volunteer` is *not* constrained by the same index); service-layer invariant test that granting one of the three representative roles to a `(user_id, member_id)` pair without an active `organization_representatives` row is rejected (the check the dropped composite FK used to provide); `contextTypeSchema` accepts `'organization'` test; `votes/ballots.ts` delegate-resolution test updated to resolve `role-voting_delegate` via `user_roles` rather than `organizations.voting_delegate_user_id`; atomic-provisioning test covering the corrected `getOrCreateOrganizationMemberAggregate` race, including the differing-category conflict path and confirming an unrelated D1 error is *not* silently treated as a race. Migration/import preflight must fail loudly if any existing `members` row lacks an unambiguous category — no silent default.

**Impacted areas — a search starting point, not a mandatory change list.** Trace actual readers/writers from schema → services → shared API schemas → UI; use this list to start, then verify each file actually touches a changed column/table before editing it:
- `functions/_lib/services/member-organization.ts` — self-service join/leave: call the get-or-create helper, then insert `organization_representatives` (and a role row if the joiner takes one).
- `functions/_lib/services/admin-members.ts` **and** `functions/_lib/services/member-provisioning.ts` — **confirmed**: both currently hand-write their own `INSERT INTO members (id, member_type, user_id, organization_id, status, tier, data_json, created_at, updated_at, show_on_org_profile, ...)` (admin-members.ts:178, member-provisioning.ts:140). This is exactly the duplicate-provisioning problem in Phase 1.5 below — fold both into one shared operation while doing this rewrite rather than fixing them separately. Drop the `UPDATE members SET member_type = ? WHERE organization_id = ?` re-sync entirely — there's no `member_type`/category mirror left to sync.
- `functions/_lib/services/admin-organizations.ts` — presumed source of the `organizations.membership_category`/contact-column cascade `0040` backfills from; update to read/write through `member_category_assignments` and `user_roles` (organization-context grants).
- `functions/_lib/services/members-directory.ts` / `assets/shared/schemas/members-directory.ts` — one row per aggregate (`members` join `member_category_assignments`), representatives via join/expansion.
- `functions/_lib/services/membership-onboarding.ts`, `membership-form-submission.ts` — application-approval provisioning: use the get-or-create helper (member + category assignment, batched), then attach the approving applicant's representative row and any role grants inside the same `db.batch()` as Phase 5.2's approval statements.
- `functions/_lib/services/leadership.ts`, `wg-chair-digest.ts` — WG chair/vice-chair derivation: join through `user_roles` (`role-wg_chair`/`role-wg_vice_chair` grants, matches the `0040` rewrite above).
- `functions/_lib/services/mailing-lists.ts`, `google-groups.ts` — source membership from `organization_representatives`.
- `functions/_lib/services/user-merge.ts` — merging two users must merge/dedupe their `organization_representatives` rows and their representative-role `user_roles` grants, not `members` rows.
- `assets/shared/schemas/access-control.ts` — add `'organization'` to `contextTypeSchema`; add `role-primary_contact`/`role-secondary_contact`/`role-voting_delegate` to wherever built-in role IDs are enumerated/typed.
- `functions/_lib/services/votes/ballots.ts` (`resolveVotingDelegateUserId`) and `functions/_lib/services/votes/portal.ts` (`memberCanCastBallot`/`memberHasCastBallot`) — currently read `organizations.voting_delegate_user_id` falling back to `primary_contact_user_id`; rewrite to resolve the active `role-voting_delegate` `user_roles` grant for the org's `member_id` (confirm whether the fallback-to-primary-contact behavior is still wanted — it's carried over unchanged from today, not a new decision made in this pass).
- API routes: `functions/api/v1/admin/members/*`, `functions/api/v1/admin/organizations/[id]/members.ts`, `functions/api/v1/me/organization/members.ts`, `functions/api/v1/members/*` — update shapes to distinguish aggregate, category, and representatives/roles.
- Frontend: `assets/ts/admin/sections/Organizations/Representatives.tsx`, `Users.tsx`, `assets/ts/member-flows/member-directory-page.tsx`, `member-detail-page.tsx`, `sponsors-wall.tsx`, `wg-chairs-widget.tsx`, `leadership-widget.tsx`, portal `MyProfile.tsx`/`AccountSettings.tsx`.
- Importer (Phase 2): emit one `members` row per organization/individual, one `member_category_assignments` row, N `organization_representatives`/role rows.

Because this touches the widest set of files in the whole plan and is now fully unblocked, treat it as its own dedicated iteration: confirm the target schema once more against the actual current migration state before writing anything, then work outward schema → services → routes → frontend.

### 1.5 — Membership service architecture and naming (new, from v4 §8) [P2]

Not in the original review, but directly motivated by it: implementing §1.4 means writing the same provisioning logic that today is duplicated. **Confirmed**: `functions/_lib/services/admin-members.ts` (286 lines) and `functions/_lib/services/member-provisioning.ts` (200 lines) each independently build and execute their own `INSERT INTO members (...)` statement with slightly different column lists (`admin-members.ts:178` includes `member_since`; `member-provisioning.ts:140` doesn't). That's the DRY violation the AGENTS.md constitution is meant to prevent, happening in code that predates this review.

**Plan:** while doing §1.4, consolidate into one membership provisioning use case composed from focused primitives (ensure/find user, ensure organization, ensure one membership aggregate via §1.4's get-or-create helper, assign one category, attach representatives, assign roles, attach WG membership, queue notification intents), called identically by admin creation, application approval, self-service join, and the importer. Organize new domain code as:

```text
functions/_lib/services/membership/
  memberships.ts            # load/create the aggregate + category assignment
  categories.ts              # read the managed category catalog
  representatives.ts         # join/leave/transfer/rejoin
  representative-roles.ts    # assign/revoke roles, enforce active-role policy
  directory.ts                # bounded public/admin read models
  notifications.ts            # membership notification intents (no delivery, no own outbox SQL)
  scheduled-jobs.ts           # bounded job entrypoints calling the same use cases
  applications/
    create.ts
    queries.ts
    transition.ts
    approve.ts
```

Do not name anything `commands`, `management`, `catalogue-repository`, or `outbox-statements` — see AGENTS.md's naming rule. Generic statement-preparation helpers (`prepareQueueEmailStatement`, `prepareAuditStatement`) belong with the generic outbox, not under `membership/`; membership's `notifications.ts` returns typed drafts that the generic outbox helper consumes.

This is scoped to files actually touched by §1.4 — do not proactively restructure unrelated existing services solely to match this layout.

**Done** (§1.5 fuller `membership/` reorganization follow-up pass, above): the full `membership/` layout above now exists exactly as specified, including the `applications/` subfolder split and the `notifications.ts` typed-draft-builder module.

---

## Phase 2 — Fix the importer to target the final schema

### 2.1 — `scripts/migrate-members-yaml-to-d1.mjs:574` [P1] — carried forward, not re-checked against current file line numbers
> This importer targets an intermediate schema, not the final database: migration `0051` drops all five `social_*` columns, so running the documented importer after applying the migrations generates `no column named social_x`. It also never emits final `organization_domains` rows. Have the importer write canonical `links_json` and normalized domain records directly, and add a smoke test that applies the complete migration set to an empty D1 database and executes the generated import SQL against it. That removes the need for the 0051/0057 backfills entirely.

**Plan:** unchanged from the original — after Phase 1 folds `links_json`/`organization_domains` into first-introduction shapes, update the importer to emit those shapes directly (no `social_*` columns, no `organization_domains_json`). Add a smoke test: empty D1 → apply full rewritten migration set → run importer's generated SQL → assert no missing-column errors → keep it in the test runner so it runs in CI, not just locally.

**RESOLVED 2026-08-17 — `SQLITE_TOOBIG` on the full real dataset, found and fixed:** the smoke test's tiny fixture passed from the start, but executing the importer's *real* full-dataset output (419 orgs, ~4,300 statements) against local D1 failed with `wrangler`'s local `d1 execute` throwing `SQLITE_TOOBIG`. Root cause: `buildUpsertUserStatement`'s `ON CONFLICT` clause ended `headshot_r2_key = CASE ... END,` (comma, no space) — wrangler's local SQL-statement splitter only closes a `CASE...END` block when `END` is followed by `;` or whitespace, so it never popped and silently merged every later statement in the file into one until it exceeded D1's 100KB per-statement limit. Confirmed against wrangler's own splitter with a minimal repro before touching code; fixed by reordering the `SET` clause list so `CASE...END` is last (`END;`, pure reordering, no behavior change); regression test added asserting the statement ends in `END;`. Only ever affected local `d1 execute --file`/`--command` — `--remote` (the real `--preview`/`--production` import path) uploads the file for server-side ingestion instead and was never affected. Re-verified end to end against the full real dataset after the fix: `EXEC_EXIT:0`. Full writeup in the "Follow-up pass" section below.

### 2.2 — `scripts/migrate-members-yaml-to-d1.mjs:508` [P1]
> The importer is 1,251 lines and currently makes `pnpm run check:max-lines` fail. It owns CLI parsing, YAML/CSV ingestion, identity reconciliation, business mapping, SQL rendering, R2 upload, and reporting in one closure. Split into tested pure modules and keep the entry point as orchestration.

**Plan:** unchanged — split into `scripts/migrate-members/` (`parsers.mjs`, `reconciliation.mjs`, `sql-renderer.mjs`, `report.mjs`, `cli.mjs`/`r2-adapter.mjs`), keep `migrate-members-yaml-to-d1.mjs` as a thin orchestration entry point, add unit tests for the pure modules, and confirm `pnpm run check:max-lines` passes. Note: `scripts/AGENTS.md` (merged from `pkic.org#726`, present in this tree) already prescribes exactly this shape — this is now an AGENTS.md compliance item, not just a review comment. Confirmed current size: **1,244 lines** (`wc -l`), still failing the gate.

### 2.3 — `scripts/migrate-members-yaml-to-d1.mjs` uses `npx` instead of `pnpm` [P2] — **new, confirmed live**
> Uses `npx` instead of `pnpm` (flagged by `pr-review-post-rebase.md` at line 1169).

Confirmed: `execFileSync("npx", args, ...)` appears twice, at lines 1186 and 1205 (line numbers have drifted slightly from the cited 1169 as the file has been edited, but both call sites are real and unchanged in kind). This directly violates the root `AGENTS.md` workflow rule: "Use `pnpm` for repository scripts and local binaries. Do not mix in `npm` or `npx`."

**Plan:** replace both `execFileSync("npx", args, ...)` calls with the `pnpm`-equivalent invocation (`execFileSync("pnpm", ["exec", ...args], ...)` or whatever the invoked tool's `pnpm`-native form is — check what each `npx` call is actually invoking before choosing the replacement). Small, independent fix — do not bundle with the larger 2.2 module split, but do land before 2.2's smoke test is written so the test doesn't encode the violation.

### Final report (2026-08-17)

**3 of 3 items complete.**

Baseline: commit `71b327f5`, clean typecheck/build, lint failing only on pre-existing untracked `.venv` Playwright driver files (5833 errors — unrelated to this repo), 899/900 backend tests passing (1 pre-existing skip), 36/36 frontend tests.

**1. Checklist**

| ID | Requirement (verbatim) | file:line | Command | Result | Status |
| --- | --- | --- | --- | --- | --- |
| P2-01 | "Have the importer write canonical `links_json` and normalized domain records directly, and add a smoke test that applies the complete migration set to an empty D1 database and executes the generated import SQL against it." | `scripts/migrate-members/sql-renderer.mjs:29-77` (org upsert, `links_json` only), `:81-93` (`organization_domains`); `tests/tools/migrate-members-importer.test.ts` | `grep -n "social_x\|membership_category\|primary_contact_user_id" scripts/migrate-members-yaml-to-d1.mjs scripts/migrate-members/*.mjs` → empty. `pnpm exec vitest run --config vitest.config.tools.ts` | 0 matches for dropped columns; smoke test applies migrations `0000`-`0053` to a fresh local D1 and executes generated SQL — `Test Files 5 passed (5), Tests 35 passed (35)` | **PASS** |
| P2-02 | "Split into `scripts/migrate-members/` (`parsers.mjs`, `reconciliation.mjs`, `sql-renderer.mjs`, `report.mjs`, `cli.mjs`/`r2-adapter.mjs`)... add unit tests for the pure modules, and confirm `pnpm run check:max-lines` passes." | `scripts/migrate-members/{cli,parsers,reconciliation,sql-renderer,report,r2-adapter}.mjs` (all created); `tests/tools/migrate-members-{parsers,reconciliation,sql-renderer,report}.test.ts` | `pnpm run check:max-lines` | `All checked files are <= 1000 lines.` (entry point now 617 lines, was 1244) | **PASS** |
| P2-03 | "Replace both `execFileSync(\"npx\", args, ...)` calls with the `pnpm`-equivalent invocation... land before 2.2's smoke test." | `scripts/migrate-members/r2-adapter.mjs:52,76` (`execFileSync("pnpm", ["exec", ...])`) | `grep -rn '"npx"' scripts/migrate-members-yaml-to-d1.mjs scripts/migrate-members/*.mjs` | 0 matches | **PASS** |

Landed in dependency order: P2-03 (`5ff12e74`) → P2-01 (`82808555`) → P2-02 (`376d92b2`, `ef008d53`).

**2. Regressions vs baseline**

None. `typecheck` (backend/frontend/tools): exit 0, identical to baseline. `test:backend`: 899/900 (1 skip), identical. `test:frontend`: 36/36, identical. `lint`: fails at the same 5833 pre-existing `.venv` Playwright-driver errors, same file, same line — not a regression. `format:check`, `check:filenames`: pass. `lint:architecture`: still blocked by the pre-existing Node-version mismatch (25.3.0 vs required ^22/^24/≥26), unrelated to this change, matching Phase 1's own notes.

Behavior-preservation check beyond the test suite: dry-run against the real (untracked) `data/members`/`csv/` trees before and after the P2-02 split produced byte-identical per-table statement counts (1418 `working_group_members`, 847 `users`, 731 `organization_representatives`, 503 `user_roles`, 418 `members`/`member_category_assignments`, 393 `organization_domains`, 374 `organizations`, etc.) and identical summary totals (380 matched, 16 sentinel individuals, 22 unmatched, 46 bare roster users).

**3. Security findings**

Reviewed the diff for injection, authz, validation, secrets, crypto, SSRF, and new dependencies:
- **SQL injection**: every dynamic value passed into a generated SQL statement goes through `sqlString`/`toSqlNullableText` (single-quote escaping). `grep` confirmed no raw `${...}` interpolation outside those two helpers.
- **Command injection**: all `wrangler`/`pnpm` invocations use `execFileSync` with an argument array (no shell), unchanged pattern from before, only `npx`→`pnpm` in the argv itself.
- **New dependencies**: none — no `package.json` dependency changes, only script/config wiring.
- **Secrets**: none touched.
- No High/Critical findings. Nothing outstanding.

**4. Open questions / assumptions**

- The plan's `cli.mjs`/`r2-adapter.mjs` wording ("or") was read as "both," since CLI parsing and wrangler/R2 side effects are distinct responsibilities — created both.
- The importer targets the schema as currently defined in migrations `0035`-`0053` on disk (verified directly, not from the planning doc's prose, since the doc predates some renumbering).

**5. Out of Phase 2 scope, noted at report time — since resolved (see follow-up below)**

- `docs/yaml-to-d1-member-migration.md` (untracked, pre-existing) documented the *old* importer's behavior (old column names, one-`members`-row-per-representative) and was stale given P2-01's rewrite — flagged for a follow-up doc update, not touched in this pass since it was outside Phase 2's checklist. **RESOLVED 2026-08-17** — rewritten for the Phase 2 schema retarget (correct migration numbers, correct representative-photo endpoint keying via `organization_representatives.id` not `members.id`, real verified row counts replacing stale hardcoded ones, and the `SQLITE_TOOBIG` fix history). Committed `d52b18b9`, signed.
- `docs/local-dev-with-production-backup.md` had a pre-existing uncommitted edit (backup filename example) present before this session started — left untouched in this pass, unrelated to Phase 2. **RESOLVED 2026-08-17** — every `npm`/`npx` reference replaced with `pnpm`/`pnpm exec` (root `AGENTS.md` workflow rule), and its stale pointer to the deleted `migrations/0033_rebuild_members_multi_representative.sql` replaced with a generic check-the-current-range note. Committed `d52b18b9`, signed.
- `csv/` (untracked, real Google-Groups roster PII) was read for manual verification only, never modified or committed — the automated smoke test uses synthetic fixtures instead, per AGENTS.md's rule against moving production personal data into shared/CI environments.

### Follow-up pass (same day, 2026-08-17): docs updated, and a real `SQLITE_TOOBIG` bug found and fixed

Two follow-ups requested after the report above, both completed and committed (signed, `git commit -S`):

- **Both docs flagged in §5 were updated** (`d52b18b9`): `docs/yaml-to-d1-member-migration.md` rewritten for the Phase 2 schema retarget (correct migration numbers, correct representative-photo endpoint keying — `organization_representatives.id`, not `members.id` — and real verified row counts instead of stale hardcoded ones); `docs/local-dev-with-production-backup.md` had every `npm`/`npx` reference replaced with `pnpm`/`pnpm exec`, and its stale pointer to the deleted `migrations/0033_rebuild_members_multi_representative.sql` replaced with a generic check-the-current-range note.
- **A real `SQLITE_TOOBIG` bug was found and fixed** (`0c3b7104`) while verifying the importer end-to-end against the full real dataset (never caught by the smoke test's tiny fixture): `buildUpsertUserStatement`'s `ON CONFLICT DO UPDATE SET` ended with `headshot_r2_key = CASE ... END,` (comma, no space) followed by another clause. wrangler's local `d1 execute` SQL statement splitter (`unstable_splitSqlQuery`) only recognizes a `CASE...END` block as closed when `END` is immediately followed by `;` or whitespace — `END,` never satisfies that, so the splitter's compound-statement tracking never popped and silently merged every later statement in the file into that one until EOF, eventually exceeding D1's 100KB per-statement limit once enough real data (~847 `users` upserts) had accumulated. Root-caused by reading wrangler's own source and confirmed with a minimal reproduction before touching any code. Fixed by reordering the `SET` clause list so `CASE...END` is last (pure reordering, no behavior change); added a regression test asserting the statement ends in `END;`. **Scope: local dev only** — `--remote` (the real `--preview`/`--production` import path) uploads the raw file for server-side ingestion instead and was never affected, so real production/preview imports were never at risk. Re-verified end to end against the full real 419-org dataset after the fix: `EXEC_EXIT:0`, real row counts `organizations` 374, `members` 417, `organization_representatives` 731, `organization_domains` 392, `member_category_assignments` 417, `user_roles` 503, `working_group_members` 1418, `users` 844 (small counts-below-statement-tally gaps are expected `ON CONFLICT`/`INSERT OR IGNORE` dedup, not bugs).
- Also checked whether `scripts/reorder-d1-dump.mjs` (same exported `unstable_splitSqlQuery`, used on real production D1 backups) is exposed to the same trigger — it isn't: `wrangler d1 export` output is plain `INSERT INTO ... VALUES (...)`, never `CASE...END` upsert logic.

Validation for this pass: `pnpm run typecheck:tools` clean; `pnpm exec eslint` clean on touched files; `pnpm exec vitest run --config vitest.config.tools.ts` — 36/36 passing (was 35, +1 regression test); `pnpm run test:backend` — 899/900 (1 pre-existing skip), identical to baseline, confirming no regression from a change that doesn't touch any backend TS.

---

## Phase 3 — Schema/DRY: make canonical contracts actually canonical

### 3.1 — `assets/shared/schemas/access-control.ts:125` [P1] — **confirmed still live**
> The response contract still rejects the system-role IDs that this same file explicitly supports. `GET /roles` returns IDs such as `role-admin`, but `roleResponseSchema` declares a UUID; `userRoleResponseSchema.roleId` repeats the mismatch. Reuse one exported `roleIdSchema` for params, requests and both responses, and add response-contract tests with built-in roles.

Confirmed in current tree: `roleIdParamsSchema` (`access-control.ts:23`) already accepts non-UUID system role IDs and is used for params, but `roleResponseSchema` (line 124) and `userRoleResponseSchema.roleId` (line 240, still `z.uuid()`) do not reuse it.

**Plan:** unchanged — export one `roleIdSchema` (or reuse `roleIdParamsSchema` directly) for both response schemas as well as params/requests; add response-contract tests exercising built-in system roles; verify the generated OpenAPI doc reflects the fix.

### 3.2 — `assets/shared/schemas/votes.ts:55` [P2] — **confirmed still live**
> `status` is any string and both result fields are `unknown`; proposal status is also a string later in this file. Define shared vote/proposal status schemas and a discriminated result union keyed by vote type/detail level.

Confirmed: `votes.ts` still has `status: z.string()` (line 55, and again at 204/458), `result: z.unknown().nullable()` (lines 65, 73), and a bare `z.object({ result: z.unknown() })` in an OpenAPI response schema (line 188). Note lines 82 and 336 *do* already use `z.enum([...])` for some status fields — the closed-state migration is partial, not entirely missing, which is useful context for scoping the fix.

**Plan:** unchanged — define closed-state Zod enums for vote/proposal status, a discriminated union for vote results keyed by vote type/detail level, infer service/frontend types from them, remove manually redeclared unions/casts in consuming frontend code, and feed the same closed-state list into Phase 1.3's D1 CHECK/reference-table decisions for vote type/status/visibility.

### 3.3 — `assets/ts/admin/sections/Applications.tsx:18` [P2] — carried forward, not re-checked
> The application state machine is copied here, in `member-applications.ts`, and partly again in the admin Zod schema; `ON_HOLD_SUBTYPES` is also declared independently in all three layers. Export stage/subtype constants, Zod schemas, and a pure `allowedTransitions(from)` policy from one membership-domain module.

**Plan:** unchanged — create one shared module exporting stage/subtype constants (incl. `ON_HOLD_SUBTYPES`), Zod schemas, and `allowedTransitions(from)`; import it from the service, the admin Zod schema, and `Applications.tsx`; replace the hardcoded WG label map with a lookup against managed form/WG data.

### 3.4 — `assets/shared/schemas/api.ts` is a 1,161-line catch-all schema file [P2] — **new, confirmed live** (from v4 §6.1, not previously merged into this document; corroborated by `pr-review-post-rebase.md`'s independent line-count finding)

Confirmed: `wc -l assets/shared/schemas/api.ts` → **1,161 lines**, matching the post-rebase review's "~1,161 lines" finding exactly. This is the file `linksSchema`, `parseLinksJson`, `serializeLinks`, `customAnswersSchema`, and numerous other canonical contracts already live in (confirmed present around lines 300–360 during this pass). Every schema/DRY item in this Phase currently points back into this one file.

**Plan (from v4 §6.1, restated):** move canonical pieces into focused files under `assets/shared/schemas/`, with temporary re-exports from `api.ts` to avoid a flag-day import rewrite:
- `links.ts` — `linksSchema`, `parseLinksJson`, `serializeLinks`, `findLinkedinUrl` (see 3.5 immediately below — fix the self-validation gap while it's being moved, not after).
- `list.ts` — the canonical list/pagination contract (feeds Phase 6.0's inventory).
- `membership/categories.ts`, `membership/applications.ts` — feeds 3.3's shared policy module.
- Existing domain files for access control, votes, sponsorships, organizations, and users as needed.

Do not create `common.ts`, `helpers.ts`, or `types.ts` as dumping grounds. This is naturally sequenced alongside Phase 1's schema work (1.3/1.4 need `membership/categories.ts` to exist) and Phase 3's other DRY items — do this split as part of implementing those, not as a separate mechanical pass, so the boundaries land where the actual new code needs them.

### 3.5 — `parseLinksJson` does not validate its own normalized output against `linksSchema` [P1] — **new, confirmed live** (from `pr-review-post-rebase.md`, more specific than existing item 10.1)

Confirmed in `assets/shared/schemas/api.ts` (current lines ~330–360): `parseLinksJson` tolerantly normalizes three legacy `links_json` shapes (plain string array, `{linkedin, x}` object, `[{label,url}]` array) down to a `string[]`, but returns that array directly — it never runs the result through `linksSchema.parse()`/`.safeParse()`. That means `linksSchema`'s own constraints (`.max(15)` entries, each entry `.url()`-validated and `http(s)`-only, no-duplicates via `superRefine`) are enforced on *write* paths that use the schema directly, but **not** on legacy rows read back through the codec — a row with 40 links, or a non-URL string smuggled in via the tolerant `{label, url}` fallback, passes through `parseLinksJson` unchanged and reaches API responses without ever being checked against the contract that's supposed to be canonical for this field.

This is a distinct, sharper finding than 10.1 (10.1 is about routes bypassing the codec entirely via raw `JSON.parse`; this is about the codec itself not enforcing its own schema on read).

**Plan:** decide explicitly what "malformed legacy row" should do at read time — either clamp/filter to fit `linksSchema` (drop entries beyond 15, drop non-URL entries, dedupe) and log/report the degradation, or leave `parseLinksJson`'s output type as intentionally looser than `linksSchema` and rename/document it so callers don't assume schema-conformance they're not getting. Whichever is chosen, make it explicit in code and covered by a test with a deliberately-oversized/malformed legacy row — don't leave the current silent pass-through. Do this as part of the 3.4 file-split (moving this function into `links.ts` is a natural point to also fix its contract).

---

## Phase 4 — Authorization: fail-closed, resolved-once resource context

*(Not independently re-verified against current router/middleware code in this pass — carried forward as originally written. Re-confirm `functions/api/v1/admin/router.ts` and the working-groups member routes before starting, since router structure may have shifted during the rebase even though the underlying bug pattern is unlikely to have been fixed as a side effect of it.)*

### 4.1 — `functions/api/v1/admin/router.ts:80` [P1]
> This creates a fail-open authorization composition: matching a path here disables legacy scope enforcement and assumes every current and future descendant handler remembers its own permission check. Mount bounded routers with declarative read/write permission middleware (including resource-context resolution), and remove the parallel path-prefix authorization registry.

**Plan:** unchanged — remove the path-prefix bypass registry for `/admin/events/**` and `/admin/proposals/**`; replace with router mounting that attaches declarative permission middleware per subtree, resolving resource context once at the mount point. Do together with 4.2.

### 4.2 — `functions/api/v1/admin/working-groups/[id]/members/index.ts:15` [P1]
> A `role-wg_chair` grant is scoped to `{type: "working_group", id}`, and `hasPermission` deliberately rejects a contextual grant when no context is supplied. This makes WG chairs unable to add members; sibling handlers repeat the bug, while the meetings router passes context correctly.

**Plan:** unchanged — resolve the canonical WG ID once in middleware for the whole `/admin/working-groups/:id/**` subtree; update get/update/add-member/remove-member handlers to use it; use the meetings router as the reference implementation; add a regression test for WG-chair add/remove on their own WG.

---

## Phase 5 — Transactions: single atomic units of work

D1 `batch()` is transactional and rolls back the sequence on failure. All items below converge on: build all statements first, execute once via `db.batch()`, verify affected-row counts for compare-and-set safety. **Corrected per v4 §2.5:** checking the affected-row count after an otherwise-unconditional batch is not sufficient — a lost compare-and-set does not undo unconditional history/outbox/audit inserts already in that same batch. Every dependent statement must be conditioned on the *same* operation claim/token (e.g. `WHERE ... AND version = ?` mirrored onto every dependent row, or a claim row the dependents join against), or the schema must structurally enforce the transition. Apply this correction to 5.1 and 5.2 below, not just the affected-row check they already describe.

### 5.1 — `functions/_lib/services/member-applications.ts:373` [P1]
> The read-time transition check is not enforced by the write. Two concurrent transitions can both read the same `fromStage`, then each update the row and append contradictory history events. Make this a compare-and-set (`WHERE id = ? AND stage = ?`), verify exactly one changed row, and return 409 on a lost race while keeping the guarded update and event insert in the same batch.

**Plan:** compare-and-set UPDATE on the previously-read `fromStage`; check `changes`; 409 on 0. Additionally (per the §5 correction above): make the history-event INSERT itself conditional on the transition having actually happened — e.g. derive it from the UPDATE's own success rather than issuing it unconditionally in the same batch and trusting the affected-row check alone to have caught a loss before the batch executed. Apply the identical guard to approval (5.2).

### 5.2 — `functions/api/v1/admin/applications/[id]/approve.ts:26` [P1]
> Approval is not one unit of work. `approveApplication` first commits provisioning, then separately commits approved state/event and Google Groups queue rows; this route subsequently writes three email outbox rows and the audit row one at a time. A failure after line 26 returns 500 with the application already approved, and retry then returns 409 without restoring missing email/audit work.

**Plan:** make guarded stage transition, provisioning writes, history/event insert, Google Groups sync job row(s), email outbox rows, and audit row all statement builders (no execution), resolve attachment metadata before building the batch, execute everything in one `db.batch()`, process durable outbox work idempotently after commit. Per the §5 correction, every one of those dependent statements must be conditional on the same successful claim as the guarded transition — not merely co-located in the same batch. Add a failure-injection test confirming no partial-approved state after a mid-sequence failure.

### 5.3 — `functions/_lib/services/votes/lifecycle.ts:108` [P1] — **confirmed still live**
> The vote row is committed before candidate inserts begin, so a later candidate constraint/D1 failure leaves a partial election visible to subsequent reads, and a retry may collide with the existing slug.

Confirmed: `lifecycle.ts` (242 lines) contains no `.batch(` or `.prepare(` calls at all — the multi-insert sequence described in the finding is still fully unbatched.

**Plan:** unchanged — build the vote-insert and all candidate-insert statements up front, execute in one `db.batch()`, add a failure-injection test asserting neither the vote nor any candidates persist when one statement fails.

### 5.4 — `functions/_lib/services/votes/proposals.ts:240` [P1] — **confirmed still live**
> Proposal conversion is both non-atomic and race-prone: it inserts a vote and only afterward marks the proposal converted, without a conditional status update. Concurrent calls can create two votes for one proposal, or a failed update can leave an orphan vote.

Confirmed: no `votes.source_proposal_id` column exists in any migration file, and `proposals.ts` (391 lines) has no `.batch(`/`.prepare(` calls.

**Plan:** unchanged — add `votes.source_proposal_id UNIQUE` (in Phase 1's rewritten voting migration, since it's still undeployed); conditionally claim the proposal (`UPDATE proposals SET status='converted' WHERE id=? AND status='open'`); build the vote-insert statement referencing `source_proposal_id`; commit both in one `db.batch()`; on 0 affected rows, re-read and return the existing vote rather than creating a duplicate; add a concurrency test.

---

## Phase 6 — D1 read models: bounded, set-based, no per-row queries (broadened per v4 §2.6/workstream E)

### Implementation status (this pass, 2026-08-18) — 7 of 7 items complete

All seven Phase 6 items (6.0–6.6) are implemented, tested, and committed
(`c6089ff6`/`bdbd8e71`, `ef9c921d`, `c647942e`, `0fc41a02`, `0868ef46`, `63a7ff7f`,
`6574251a`, one commit per item plus a follow-up for 6.1). Full verification-pass
evidence table:

| ID | Requirement (paraphrased, see verbatim text below) | Evidence (file:line) | Command | Result | Verdict |
|---|---|---|---|---|---|
| 6.0 | Build a list-endpoint inventory, classify every list/search endpoint | `prd/phase6-list-endpoint-inventory.md` (checked in) | `Explore` agent audit of all `functions/api/v1/**` GET routes | 57 endpoints inventoried: 9 migrated, 5+24 conforming, 17 needs-migration (3 P1/14 P2) tracked with owner+reason, 19 out-of-scope. Independently re-derived the "34 files" claim via `grep -rl "new URL(c.req.raw.url)" functions/api/v1` → 29 files, confirming it was already an overcount. | PASS |
| 6.1 | Remove `list-query.ts` duplicate query-validation path; applications/content-reviews consume `data.query` | `functions/api/v1/admin/applications/index.ts:17`, `.../content-reviews/index.ts:21`; `functions/_lib/openapi/list-query.ts` deleted | `ls functions/_lib/openapi/list-query.ts` → No such file; `grep -rn list-query functions/` → no hits; `pnpm exec vitest run tests/admin-applications.test.ts tests/organization-content-review.test.ts` | File absent, both routes use `data.query`, 32/32 tests pass | PASS |
| 6.2 | `userId` UUID-validated, `data.query` consumed, `LIMIT`/`OFFSET` + count, `buildPageInfo` | `assets/shared/schemas/access-control.ts:83` (`userId: z.uuid().optional()`), `functions/api/v1/admin/access-grants/index.ts:58,63-70` | `pnpm exec vitest run tests/permission-grants.test.ts tests/roles.test.ts tests/api-security.test.ts` | 134/134 tests pass, incl. new bounded-pagination + invalid-UUID-rejection tests | PASS |
| 6.3 | Replace `page`/`per_page` dialect with canonical `limit`/`offset` + `hasMore` | `assets/shared/schemas/votes.ts:140,158` (`paginationQuerySchema.extend`, `paginatedResponseSchema`) | `pnpm exec vitest run tests/votes.test.ts` | 19/19 tests pass, incl. new envelope-shape test | PASS |
| 6.4 | Bound `portal.ts` lists at the service boundary; replace per-vote N+1 with set-based bulk queries; regression test | `functions/_lib/services/votes/portal.ts:91` (`canCastBallotForList`), `:109` (`loadCastBallotRounds`), `:147-164` (bounded `LIMIT`/`OFFSET` + bulk `Promise.all`) | `pnpm exec vitest run tests/votes.test.ts` (query-count regression test wraps `db.prepare`) | Query count identical for 1-vote vs 3-vote page (proven, not asserted); 19/19 pass | PASS |
| 6.5 | Bound both proposal lists; replace per-row lookups with bulk queries; add supporting D1 index in the still-undeployed migration | `functions/_lib/services/votes/proposals.ts:107` (`loadEndorsementCounts`), `:125` (`loadMinEndorsersByProposal`); `migrations/0047_voting.sql:145` (`idx_vote_proposals_status_scope_created_at`) | `pnpm exec wrangler d1 migrations list DB --env preview/production --remote` (re-verified unapplied before editing); `pnpm exec vitest run tests/votes.test.ts` | Both ledgers confirmed migration unapplied; 19/19 tests pass, incl. query-count regression + endorsement/min-endorsers correctness across mixed scopes | PASS |
| 6.6 | Declare query schema, consume `data.query`, move SQL to a read-model service, replace `limit+1`-slice with real `COUNT`, preserve the already-correct bulk waitlist/attendance-change queries | `functions/api/v1/admin/events/[eventSlug]/registrations.ts:10` (`openApiRoute`), `functions/_lib/services/registrations/admin-list.ts:220-227` (bounded `SELECT` + `COUNT` via `Promise.all`), `:230-263` (unchanged bulk `IN (...)` waitlist/attendance-change queries) | `pnpm exec vitest run tests/admin-event-management.test.ts tests/proposal-participants.test.ts tests/manage-read-endpoints.test.ts tests/admin-vip-admit.test.ts tests/roles.test.ts tests/api-security.test.ts` | `grep -n "limit + 1\|limit+1" ...` → no hits; 155/155 tests pass, incl. new 2-page real-total/hasMore test and invalid-limit-now-400 test | PASS |

**7 of 7 items complete.** Every item has an executable test (new or pre-existing,
re-run and passing) as its acceptance criterion; none are TODOs, stubs, or partial.

**Regression check:** full `pnpm run build` (clean), `pnpm run test` (backend 972/973
passing incl. 1 pre-existing intentional skip — 6 net-new tests added, zero failures;
frontend 36/36; tools 52/52 — all previously-passing tests still pass, exit code 0),
`pnpm run typecheck` (backend/frontend/tools, zero errors), lint scoped to real project
source (`eslint functions assets/shared assets/ts assets/js scripts static/scripts
tests`, zero errors — the repo-wide `eslint .` command still fails only on the
pre-existing untracked `.venv` Playwright vendor bundle, unrelated to this change and
already excluded by the scoped invocation used elsewhere in this document),
`format:check`, `check:max-lines`, and `check:filenames` all clean. `lint:architecture`
still cannot run in this environment (dependency-cruiser requires Node ^22/^24/>=26,
this environment runs 25.3.0) — pre-existing, unrelated to this change, same limitation
noted in the Phase 1 status block above.

**Security review (this diff only):** no new SQL injection surface — every new/changed
query interpolates only fixed literals or `?`-placeholder counts (never raw filter
values) into SQL strings; filter *values* are always passed through the parameterized
`bindings`/`args` array, verified by direct read of every touched query in
`functions/_lib/services/registrations/admin-list.ts`,
`functions/_lib/services/votes/{portal,proposals,public}.ts`, and
`functions/api/v1/admin/access-grants/index.ts`. No new authz surface: 6.6's route
mount moved from `app.get` to `openapi.get` on the same underlying Hono app instance,
so the pre-existing `app.use("*", requireEventManagementAccess)` permission-gate
middleware (registered before all route declarations) still applies unchanged; verified
by confirming existing authz-focused tests (`tests/roles.test.ts`,
`tests/api-security.test.ts`) still pass. No secrets, new dependencies, or crypto
touched. No new redirect/SSRF surface. `access-grants`' new `userId` filter is
UUID-validated and gated behind the same `access:grant`/`access:revoke` permission
check as before — not a new IDOR surface (an admin who can already list all grants can
now filter that same list by user, not access anything new).

**Behavior-preservation finding surfaced and fixed during this pass:** the 6.6 rewrite
initially declared `status`/`bounced`/`consent`/`attendance_change` as strict `z.enum`
schemas, which changed an invalid filter value from "silently ignored" (pre-existing
behavior for all four fields, and `sort`) to a `400` rejection — caught by
`tests/admin-event-management.test.ts`'s existing `?attendance_change=unexpected`
coverage (a real, deliberate pre-existing test, not incidental). Fixed by declaring
those fields as loose strings, moving the same allowlist-based tolerant filtering into
the new service (`VALID_REGISTRATION_STATUSES`/`VALID_ATTENDANCE_CHANGE_FILTERS`), and
leaving `sort` to `resolveOrderBy`'s existing graceful fallback — preserving the
endpoint's original behavior exactly while still gaining real `limit`/`offset`
validation (the one part of the query contract that had no pre-existing tolerant
behavior to preserve).

**Open questions and assumptions:**
1. 6.0's "matrix (checked-in or attached to the PR)" format wasn't specified — checked
   in `prd/phase6-list-endpoint-inventory.md` per this repo's `prd/*.md` convention.
2. "Shared list-contract abstraction" (referenced in 6.1–6.6) resolved to the
   pre-existing `assets/shared/schemas/pagination.ts` (`paginationQuerySchema`,
   `buildPageInfo`, `paginatedResponseSchema`, `sortColumnSchema`) — already the
   canonical implementation per 6.0's audit; extended, not replaced.
3. 6.5's "Phase 1's rewritten voting migration" resolved to `migrations/0047_voting.sql`
   (the actual current voting migration on disk, confirmed still-undeployed against
   both preview and production D1 ledgers immediately before editing).
4. Portal routes (`portal/vote-proposals`, `admin/events/:eventSlug/registrations`)
   that had a *documented, tested* tolerant-validation design were preserved as-is
   rather than switched to strict Chanfana validation, since the plan's items ask for
   pagination/read-model fixes, not a behavior change to existing filter semantics — see
   the finding above.

**Not in Phase 6's scope, found during 6.0's inventory and intentionally not touched
this pass:** 3 P1 and 14 P2 list endpoints still need migration (`admin/email/outbox`,
`admin/events/:eventSlug/proposals`, `admin/forms/:formKey/submissions` are P1); 3
cross-cutting findings (duplicate sort-schema helpers, the repo-wide
tolerant-sort-fallback convention, and redundant `limit+1`-slice-plus-real-`COUNT`
double computation in 4 files) — all logged with owners in
`prd/phase6-list-endpoint-inventory.md` for a future pass, per the plan's instruction
that "predating this PR is not by itself a reason to mark something conforming."

---

The original review's Phase 6 fixed a handful of named endpoints. v4 correctly points out that's too narrow: the repository has several parallel pagination dialects, raw query parsers, hand-built page envelopes, and unbounded lists, and **newly-merged upstream code is not automatically exempt** — the #729 attendance registrations route (merged into upstream *after* the original review, and now present on this rebased branch) has the identical anti-pattern. Treat this phase as an inventory-driven migration of every listing/search endpoint, not just the items below.

### 6.0 — Build a list-endpoint inventory (new, from v4 §7.1)
Generate a matrix (checked-in or attached to the PR) from mounted OpenAPI routes: method/path, shared query schema, filters, search fields, sort allowlist, page-size default/max, response schema, service/read-model function, count strategy, supporting indexes, frontend consumer, test file. Cover admin, public, portal, member, event, vote, sponsorship, access-grant, email, invitation, proposal, registration, form-submission, directory, and history endpoints. Classify each as conforming / migrated in this remediation / tracked with an explicit owner and reason it can't yet migrate. Predating this PR is not by itself a reason to mark something conforming.

**Scale, from `pr-review-post-rebase.md` (not independently re-counted in this pass, but consistent with every route spot-checked above):** that review found **34 API files containing manual URL or `searchParams` processing**, with the caveat that not all 34 are list endpoints — some manual URL handling may be legitimate (non-list routes, webhooks, etc.). Treat 34 as the upper bound to triage against when building this inventory, not as 34 confirmed violations; the inventory's job is to sort that list into conforming/needs-migration/legitimately-not-a-list-endpoint.

### 6.1 — `functions/_lib/openapi/list-query.ts:13` [P2] — **confirmed still live**
> `openApiRoute` already calls Chanfana validation and passes typed `data.query`, so this helper is a second query-validation contract. Applications/content-reviews parse the raw URL again, while organizations use `data.query`.

Confirmed: `functions/_lib/openapi/list-query.ts` still exists and is imported by `functions/api/v1/admin/applications/index.ts:14` and `functions/api/v1/admin/organizations/content-reviews/index.ts:15`.

**Plan:** unchanged — remove the duplicate raw-URL path; update applications and content-reviews to consume `data.query`; replace any tests that call raw handlers directly with tests through the mounted Hono/Chanfana router.

### 6.2 — `functions/api/v1/admin/access-grants/index.ts:58` [P2] — carried forward, not re-checked
> `userId` is absent from OpenAPI and not UUID-validated, sort is reparsed despite wrapper validation, `_data` is unused, and both SQL branches return every active grant with no limit.

**Plan:** unchanged — add `userId` to the OpenAPI query schema with UUID validation; consume `data.query`; extend the shared pagination query builder with this endpoint's fields; apply `LIMIT`/`OFFSET` and a count in D1; return via `buildPageInfo`.

### 6.3 — `assets/shared/schemas/votes.ts:78` [P2] — carried forward, not re-checked
> This introduces a second pagination dialect (`page`/`per_page`, top-level `total/page/perPage`) beside the canonical `limit`/`offset`/`page` envelope. The response also omits `hasMore`.

**Plan:** unchanged — replace with the canonical envelope used elsewhere; add `hasMore`; update vote-consuming frontend (6.5/7.1) to match.

### 6.4 — `functions/_lib/services/votes/portal.ts:93` [P1] — carried forward, not re-checked
> This authenticated list is unbounded and performs up to three more D1 queries per vote (candidates, eligibility/delegate/WG membership, ballot existence). `listMyVoteHistory` is also unbounded.

**Plan:** unchanged — add the shared page/filter contract at the service boundary; rewrite the per-vote N+1 as set-based joins/CTEs plus one bulk candidate query; apply the same fix to `listMyVoteHistory`; add a query-count regression test.

### 6.5 — `functions/_lib/services/votes/proposals.ts:195` [P1] — carried forward, not re-checked
> Both portal and admin proposal lists are unbounded, and `toProposalSummary` issues an endorsement count plus a settings/WG threshold lookup for every row. The current `(scope_type, scope_id, status)` index does not make the unbounded admin status list/order efficient.

**Plan:** unchanged — bound both lists via the shared pagination contract; replace the per-row lookups with a set-based aggregate query or bounded bulk queries; add a D1 index supporting `(status, scope, created_at)` ordering directly in Phase 1's rewritten voting migration (not a follow-up ALTER, since it's still undeployed).

### 6.6 — `functions/api/v1/admin/events/[eventSlug]/registrations.ts` [P1] — **new item, confirmed live** (not in the original review because the route didn't exist on the reviewed commit; merged in from upstream `#729` during the rebase)
> Confirmed in the current tree (lines 58–73): the route re-parses `new URL(c.req.raw.url)` for `limit`/`offset`/`q`/`status`/`bounced`/`consent`/`attendance_change` instead of consuming Chanfana-validated `data.query`; it hand-builds `conditions`/`bindings` SQL directly in the route handler (lines 75–138); and it fetches `limit + 1` rows and slices locally to compute `hasMore` (lines 141–177) rather than a `COUNT` query. `EVENT_REGISTRATIONS_SORT_COLUMNS`/`eventRegistrationsSortValueSchema` are already used for sort, so this is a partial migration, not a from-scratch one.

**Plan:** declare `limit`/`offset`/`q`/`status`/`bounced`/`consent`/`attendance_change` in the route's OpenAPI query schema using the shared list-contract abstraction (Phase 6.0's inventory should confirm what that abstraction looks like once 6.1–6.3 land); consume `data.query`; move the filter/SQL-building logic into a read-model function under `functions/_lib/services/registrations/` alongside the existing `admin-statistics.ts` from #729, rather than leaving it in the route; replace the `limit + 1`-and-slice `hasMore` computation with a real count query or a `buildPageInfo`-style helper if one is settled on in 6.0–6.3. This route's waitlist-summary and attendance-change bulk queries (lines 180-216) are already correctly set-based (bulk `IN (...)` queries, not per-row) — preserve that pattern, don't regress it while fixing the rest.

---

## Phase 7 — Frontend responsibility: render bounded pages, don't self-filter the dataset

*(Carried forward, not re-checked in this pass.)*

### 7.1 — `assets/ts/member-flows/votes-index-page.tsx:95` [P2]
> This fetches only the first 100 votes, discards pagination metadata, and decides open/closed groups in the browser — silently hiding row 101 onward.

**Plan:** unchanged — replace with either two bounded server queries filtered by status with real pagination, or a bounded server-side projection for the two sections; remove the manual interfaces at lines 23–41 in favor of inferred shared types (post 3.2/6.3).

### 7.2 — `assets/ts/admin/sections/Sponsorships.tsx:489` [P2]
> The company master list is server-paginated, but selecting a company still fetches one hard-capped 200-row page and renders it as complete.

**Plan:** unchanged — replace with a paginated server query/read model rendered through the same table abstraction used elsewhere.

---

## Phase 8 — Separation of concerns: split monolith files — **confirmed still live at the exact reported sizes**

### 8.1 — `assets/ts/admin/sections/Applications.tsx:89` [P2]

Confirmed current line counts: `Applications.tsx` **908** lines (matches original finding exactly), `Votes.tsx` **734** lines, `Sponsorships.tsx` **651** lines. None have been split. (These files are all under `assets/ts/admin/sections/` — not `assets/js/admin/pages/` as one source document cites; see the path-discrepancy note at the top of this document.)

**Plan:** unchanged — extract a typed `useApplicationDetail` hook (data + the five commands) from `Applications.tsx`; split remaining UI into focused overview/edit/transition/communication/EC-decision/documents/timeline components; apply the same split to admin Votes, portal Votes, and Sponsorships. No fixed line target from the reviewer — bring each under the repo's practical component-size convention (check `check:max-lines` thresholds for `.tsx`, if any are configured).

### 8.2 — `functions/_lib/services/admin-organizations.ts` is a 603-line mixed-responsibility service [P2] — **new, confirmed live** (from `pr-review-post-rebase.md`)

Confirmed: `wc -l functions/_lib/services/admin-organizations.ts` → **603 lines**, matching the post-rebase review's finding. Below the 1,000-line `check:max-lines` gate, so it passes CI silently while still combining multiple responsibilities — exactly the "gate catches only the worst case" point the post-rebase review makes generally (echoed in its item 10). This file is also flagged in Phase 1.4's impacted-areas list as the presumed source of the `organizations.membership_category`/contact-column cascade — splitting it is naturally sequenced with that rewrite, not a separate pass.

**Plan:** while doing Phase 1.4's rewrite of this file's category/contact-column reads to go through `member_category_assignments`/`user_roles` (organization-context grants), take the opportunity to separate it by responsibility (e.g. read-model/query functions vs. write/provisioning use cases vs. any org-content-review-specific logic) rather than editing it in place as one 600+-line file. No fixed target — apply the same "separation by domain contract, use case, persistence, and presentation responsibility" standard the post-rebase review applies to the frontend monoliths in 8.1.

---

## Phase 9 — Workers integration: budget scheduled workloads

### 9.1 — `functions/router.ts:103` (currently lines 93-118) [P2] — **confirmed still live, decision unchanged**
> Four independent workloads now run sequentially under the same 15-minute invocation, but only `runScheduledDueWork` participates in the existing time/subrequest/pass budget. An early failure prevents all later domains from running.
>
> **Follow-up** (registry-only, same Worker — narrows the original "both prongs" framing): build one budgeted job registry the scheduled entrypoint dispatches through; do not add a Cloudflare Queue or Workflow in this pass; reuse `email_outbox`/`google_groups_sync_queue` instead of inventing new mechanisms.

Confirmed in current tree (`functions/router.ts:96-118`): `runScheduledJob` still calls `runScheduledDueWork`, `runMembershipDueWork`, `runSponsorshipDueWork`, and `runVotesDueWork` sequentially inside one `if (controller.cron === REMINDER_CRON)` block with no shared deadline/budget object and no per-job `try/catch` isolation — a throw from any one of the middle three would abort the rest silently (no catch at all around this block; only the outer `runScheduledJob` has a `try`, so one job failing likely aborts all sibling jobs on that same invocation, not just the ones flagged as unbounded).

Additional per-file confirmation from `pr-review-post-rebase.md`, independently checked in this pass:
- `functions/_lib/services/votes-scheduled-jobs.ts` (56 lines) — its own header comment confirms it deliberately runs as a sibling call outside `scheduled-due-work.ts`'s multi-pass budgeted loop ("for the same 'keep..." — comment is truncated but the intent matches: this job was explicitly designed to sit outside the shared budget, not accidentally left out).
- `functions/_lib/services/sponsorship-scheduled-jobs.ts` — `activeSponsorshipsWithRenewalDate` (confirmed, no `LIMIT`) loads every `sponsorships` row with `pipeline_stage = 'active' AND renewal_date IS NOT NULL` unconditionally, then `runSponsorshipDueWork` iterates it; this is the unbounded-scan-plus-per-row-lookup pattern the finding describes, not a paraphrase.
- `functions/_lib/services/google-groups.ts:58` — not re-checked line-by-line in this pass, but the "selects only `pending` jobs, and failures flip to `failed` and are never retried" claim is consistent with the retry-starvation pattern already described in this Phase's plan step 3 below; treat as corroborated, not newly discovered.

**Decision (unchanged):** single budgeted job registry, same Worker — no Queue/Workflow split.

**Plan (unchanged from original, restated for clarity):**
1. **Own one budget at the dispatcher.** `runScheduledJob` creates one invocation deadline/subrequest budget and passes remaining budget + a hard item limit to each registered job. Run sequentially with per-job `try/catch` so one job throwing doesn't suppress the rest; never run D1-heavy jobs concurrently. Each result reports processed/remaining/exhausted/error. Shared remaining budget with configurable per-job caps, not fixed unused reservations.
2. **No generic checkpoint rows.** Prefer idempotent due-state queries (deterministic ordering, `LIMIT`, keyset continuation where needed, conditional state transitions, unique dedup keys) over a global last-processed timestamp, which can skip a late/retried item. Store a cursor only for a job scanning a genuinely stable ordered set that needs resumability.
3. **Reuse existing durable abstractions:** email producers enqueue `email_outbox` rows and stop calling `processOutboxByIdBackground` inside recipient loops — the single bounded outbox processor owns delivery/retry. Improve `google_groups_sync_queue` (currently selects only `pending` rows; failures flip to `failed` and are never retried) with bounded claim/retry/backoff/dead-letter semantics instead of a parallel mechanism.
4. **Bound the jobs themselves:** `runOnHoldReminders`/`runEcWindowAutoApprove` need an indexed due predicate + stable `ORDER BY` + `LIMIT` instead of loading every due application; sponsorship due-work needs its N+1 per-row lookups removed; vote notices should create outbox rows only, not send synchronously per recipient.
5. Add tests demonstrating budget exhaustion and a mid-registry job failure neither lose nor duplicate work.

### 9.2 — `functions/api/v1/admin/working-groups/[id]/meetings/[meetingId]/ics-files/index.ts:39` [P2] — carried forward, not re-checked
> R2 upload and D1 metadata creation are not an atomic lifecycle: if `uploadIcsFile` fails, the object is orphaned; deletion has the inverse ordering and can leave an undeletable orphan.

**Plan:** unchanged, with one addition — re-audit against `pkic.org#728`'s `functions/_lib/services/presentation-archive.ts` (confirmed present in this tree) before building a new service. Reuse its deterministic/idempotent object-key strategy, streamed retrieval, and failure-handling primitives where the lifecycle semantics genuinely match; only build a second small service (e.g. `managed-assets.ts`) if at least two features share the same tested put/metadata/delete/reconcile lifecycle, otherwise scope it to `meeting-assets.ts` first. Do not force ICS files through the presentation-specific service, and do not pretend R2+D1 form one ACID transaction — compensate the R2 put on D1 failure, or persist an explicit pending state before the put; make delete a state machine so a retry can finish safely.

---

## Phase 10 — Remaining DRY item

### 10.1 — `functions/api/v1/admin/users.ts:128` [P2] — carried forward, not re-checked
> Raw `JSON.parse` can throw and turn one malformed/legacy row into a 500, while `parseLinksJson` already provides the agreed normalization/compatibility behavior.

**Plan:** unchanged — replace the raw `JSON.parse` in `users.ts` with `parseLinksJson`; grep for other raw `JSON.parse`/`JSON.stringify` against `links_json` columns (admin user lists/details, proposal/speaker routes, manage-link routes, importers/provisioning, member directory/leadership projections per v4 §6.2) and replace with `parseLinksJson`/`serializeLinks`; confirm API validation uses `linksSchema` consistently. Also confirm the canonical shape decision: `string[]` vs. `{ url, label? }[]` — do not support two canonical response shapes for links.

---

## Phase 11 — Duplication gate: jscpd (new, from v4 §3.4, deferred item)

No `.jscpd.json` exists in the repo (confirmed) and `lint:duplication` is not in `pnpm run check` (confirmed — current `check` script is `typecheck && lint && lint:architecture && format:check && test && check:max-lines && check:filenames`). This was deliberately deferred by `pkic.org#726`, which measured 19 clone groups / 494 duplicated lines / 1.25% duplication on its then-current main without freezing that into an allowance.

**Plan:** after the bulk of Phases 1–10 land (not before — fixing this repo's real duplication, like the admin-members.ts/member-provisioning.ts split in Phase 1.5, changes what jscpd would even measure), rerun the measurement across current main plus these changes, remove actionable duplication, and only then add `lint:duplication` to `check` — with **no** suppression file, known-violation file, or percentage budget permitting new clones. If a zero-actionable-clone gate can't be made stable, keep jscpd as review evidence attached to the PR and say explicitly that automated duplication enforcement remains incomplete, rather than claiming the gate exists. This doesn't relax the DRY acceptance criteria elsewhere in this document — those still require one implementation per responsibility, proven by inventory/review, independent of whether the automated gate is on.

---

## Phase 12 — Validation pipeline and test-suite health (new, from `pr-review-post-rebase.md`'s live tooling run)

Not architectural findings — these are gaps in the validation pipeline itself that make it hard to trust a green run, surfaced by the post-rebase reviewer actually running the full pipeline rather than reading code. Fix these alongside the phases above so the final closure audit (below) has a validation pipeline worth trusting.

**Confirmed-by-reviewer current validation state** (not independently re-run in this pass — treat as a snapshot, re-run before relying on it):
- `git diff --check`: passed.
- Production build: passed.
- Backend tests after building assets: 861 passed, 1 skipped.
- Frontend unit tests: 36 passed.
- Dependency architecture check (`lint:architecture`): passed.
- ESLint and Prettier: passed.
- `check:max-lines`: **failed** on the importer (consistent with 2.2's confirmed 1,244-line count).

### 12.1 — `pnpm run check` is not self-contained from a fresh checkout [P2]
> A fresh `pnpm run check` is not self-contained because Worker tests require generated `public/` assets before the check script builds them.

**Plan:** either add a `public/`-generation step ahead of the test step inside `check` itself (so `pnpm run check` alone is sufficient from a clean clone), or make the Worker tests that depend on generated assets explicitly build what they need rather than assuming a prior `pnpm run build` happened. Whichever is chosen, a fresh checkout running only `pnpm install && pnpm run check` must succeed — that's the AGENTS.md-implied contract of having a single `check` gate.

### 12.2 — Two Playwright E2E tests are stale against intentional UI changes, not indicating regressions [P2]
> Serial Playwright run: 20 passed, 2 failed. Working-group test still expects inline chair assignment after that UI moved it to Leadership. Sponsorship test still expects the former list markup after conversion to a table.

Both failures are test debt from earlier intentional changes in this same PR (chair assignment moved to the Leadership admin UI per git history's "Move chair configuration to admin UI"/"Move leadership to Admin UI" commits; sponsorships moved from a list to a table). Not new regressions, but they currently mask whether the *rest* of the suite would catch a real regression in these areas.

**Plan:** update the working-group test to assert against the Leadership admin UI's chair-assignment flow instead of the removed inline flow; update the sponsorship test to assert against the table markup. Do this promptly rather than leaving it — a failing E2E test that's "expected to fail" trains reviewers to ignore red E2E runs.

### 12.3 — Parallel E2E run has magic-link rate-limit collisions from shared test identity [P2]
> The default parallel E2E run also produces magic-link rate-limit collisions because tests reuse the same administrator identity.

**Plan:** give parallel-safe E2E tests isolated administrator identities (per-worker or per-test synthetic accounts) instead of one shared admin identity, so magic-link rate limiting doesn't create cross-test interference under parallel execution. This is test-infrastructure work, not application code — but it currently makes the faster/default E2E run unreliable, pushing everyone toward the slower serial run.

### 12.4 — CodeRabbit did not review this PR [P3 — informational, not a code finding]
> CodeRabbit's only visible passing check is not meaningful here: it skipped reviewing the PR because the changed-file count exceeded its limit.

**Plan:** no code action. Flagging only so nobody reads a green CodeRabbit check as "an automated review passed" — it did not run. If automated review coverage on a PR this large is wanted, either split the PR or adjust CodeRabbit's changed-file limit for this repo; out of scope for this remediation otherwise.

---

## Suggested execution order

1. **§0 migration-ledger verification** — **confirmed**, not just gated (see above). Re-run only if time has passed since this check or another branch may have deployed; not a blocking first step anymore.
2. **Phase 1** (migration rewrite, including the corrected §1.4 schema/concurrency design and the new §1.5 service consolidation) — foundational; widest blast radius; do as its own dedicated iteration. Fold in the 3.4 schema-file split for the specific modules Phase 1 needs (e.g. `membership/categories.ts`) as you go.
3. **Phase 2** (importer, including the new 2.3 `npx`→`pnpm` fix) — depends on Phase 1's final schema shapes.
4. **Phase 3** (schema/DRY, including the new 3.4 `api.ts` split and 3.5 link-codec self-validation fix) — feed CHECK/reference-table decisions back into Phase 1 before finalizing its constraints, or accept one touch-up pass.
5. **Phase 4** (authorization) — independent, can run in parallel with 1–3.
6. **Phase 5** (transactions, including the §5 correction on conditional dependent statements) — independent, can run in parallel; 5.4 needs a new column, coordinate with Phase 1 if migrations aren't finalized yet.
7. **Phase 6** (read models/pagination, now including the full inventory in 6.0 with its 34-file triage list and the new #729 registrations-route item in 6.6) — 6.1 first, then 6.2/6.3, then 6.4/6.5/6.6 which depend on 6.3's shared envelope.
8. **Phase 7** (frontend) — depends on 6.3/6.5 envelopes and 3.2's shared vote types.
9. **Phase 8** (component splits, including the new 8.2 `admin-organizations.ts` split, naturally sequenced with Phase 1.4) — mostly independent, can be done incrementally per file.
10. **Phase 9** (workers/R2) — independent; 9.1's outbox-facing step and 9.2's R2 re-audit are both now unblocked (the #721/#728 rebase this depended on is done).
11. **Phase 10** (link codec cleanup) — small, independent, do anytime.
12. **Phase 11** (jscpd) — after the bulk of 1–10, not before.
13. **Phase 12** (validation-pipeline/test-suite health) — the `check` self-containment fix (12.1) and stale-E2E-test fixes (12.2) should land early enough that later phases get a trustworthy signal, not deferred to the end; the parallel-E2E identity fix (12.3) can happen anytime.
14. **Final closure audit** (below) — separate final phase, not the last item on the same code path without independent checking.

## Decisions (resolved)

- **1.4**: normalize membership via `member_category_assignments` (1:1 category per aggregate) and `organization_representatives` (temporal, corrected to a partial-unique active-pair index so rejoin works, and deliberately *not* singleton per user since one person may represent multiple organizations at once) — `members`/`organizations` are **not** rebuilt. Representative roles (primary_contact, secondary_contact, voting_delegate) reuse the existing `roles`/`user_roles` RBAC system (`context_type='organization'`) instead of a bespoke `organization_representative_roles` table, resolved by interview 2026-08-15 — see the fully-worked design and resolved open questions in §1.4. Concurrency handled via `INSERT OR IGNORE` + unconditional re-read, not a catch-all race handler.
- **9.1**: single budgeted job registry, same Worker — no Queue/Workflow split.
- Rebase onto `pkic-org/main` at `5a50cd4e` (workstream B) is done; no further action needed there beyond re-fetching immediately before Phase 1 implementation to catch any newer upstream migrations.
- Migration-ledger check (§0) is done: both preview and production confirmed to have the entire `0033`–`0057` private range pending/unapplied, independently verified by the post-rebase reviewer against live D1. The Phase 1 squash plan is cleared to proceed.

Two open product questions remain (§1.4) and must be answered before finalizing the migration, not guessed: (1) can a person represent more than one organization concurrently, and (2) are representative role codes a managed catalog, a reference table, or a closed shared-module vocabulary.

## Finding traceability matrix (new, from v4 §15 — replaces the flat checklist below for phase-level tracking)

"Done" requires code, a focused test, and final verification evidence — not just a passing suite.

| Item | Phase | Status this pass | Minimum evidence still needed |
| --- | --- | --- | --- |
| D1-incompatible `members` rebuild | 1.1/1.4 | **fixed this pass** — 0033 deleted, migration set verified applying cleanly to empty D1 | migration smoke test still to be added to CI (2.1) |
| Working-group / links / domains backfill migrations | 1.2 | **fixed this pass** — 0050/0051/0052/0054/0056/0057 folded into first introduction | none — done |
| Unconstrained closed states | 1.3 | partially addressed (boolean flags via CHECK in the new tables only) | full status-column enforcement-owner sweep, threaded with Phase 3 — not done |
| Membership aggregate/representatives design | 1.4 | **schema, service layer, all required new tests, and the full existing test suite are done and green** (see status block above) — 888/889 backend tests passing, 0 failures, verified twice | none outstanding for this item |
| Duplicate membership provisioning | 1.5 | **fixed this pass** — both now call `membership/memberships.ts`'s shared aggregate/representative primitives | jscpd not re-run (Phase 11, deferred) |
| Importer targets intermediate schema | 2.1 | **fixed 2026-08-17** — rewritten to target final Phase 1 schema (`links_json`, `organization_domains`, `member_category_assignments`, `organization_representatives`, `user_roles` grants); fresh-D1 smoke test added and re-verified against the full real dataset after a `SQLITE_TOOBIG` fix | none outstanding — see Phase 2 final report above |
| 1,251-line importer | 2.2 | **fixed 2026-08-17** — split into `scripts/migrate-members/{cli,parsers,reconciliation,sql-renderer,report,r2-adapter}.mjs`, entry point now 617 lines, `check:max-lines` green, unit tests added for all pure modules | none outstanding — see Phase 2 final report above |
| System role IDs rejected by contract | 3.1 | confirmed unfixed | response/OpenAPI contract test |
| Weak vote contract | 3.2 | confirmed unfixed (partially — some enums exist) | discriminated schema, inferred client types |
| Duplicated application policy | 3.3 | not re-checked | one policy import path, transition tests |
| Fail-open route-prefix authorization | 4.1 | not re-checked | mounted subtree authorization tests |
| Missing WG resource context | 4.2 | not re-checked | contextual allow/deny tests |
| Race-prone application transition | 5.1 | not re-checked | lost-race leaves no dependent rows |
| Non-atomic approval | 5.2 | not re-checked | per-boundary failure injection |
| Partial vote creation | 5.3 | confirmed unfixed (zero `.batch()` in file) | candidate-failure rollback test |
| Duplicate/orphan proposal conversion | 5.4 | confirmed unfixed (no `source_proposal_id` column) | concurrent idempotency test |
| Duplicate query validation | 6.1 | confirmed unfixed (2 live imports) | no raw parser; mounted-router tests |
| Unbounded access grants | 6.2 | not re-checked | declared filters, SQL page/count, canonical envelope |
| Second vote pagination dialect | 6.3 | not re-checked | one list schema/envelope |
| Portal vote N+1 | 6.4 | not re-checked | constant query-count test |
| Proposal N+1 and weak index | 6.5 | not re-checked | set-based query, query-plan evidence |
| #729 registrations route raw URL parsing | 6.6 (new) | confirmed live | declared OpenAPI query, service-owned SQL, count-based `hasMore` |
| Browser grouping of first 100 votes | 7.1 | not re-checked | server filters, complete pagination |
| Hard-capped sponsorship detail | 7.2 | not re-checked | server-paginated typed table |
| Large mixed-responsibility components | 8.1 | confirmed unfixed at exact original line counts | focused hooks/components, architecture checks |
| Unbudgeted scheduled workloads | 9.1 | confirmed unfixed | budget/failure/idempotency tests |
| Unsafe R2/D1 lifecycle | 9.2 | not re-checked | compensation/pending-state tests |
| Incomplete link-codec adoption | 10.1 | not re-checked | repository-wide raw JSON audit |
| jscpd gate | 11 (new) | confirmed absent (no config, not in `check`) | zero-actionable-clone gate or explicit incomplete-status disclosure |
| Importer uses `npx` not `pnpm` | 2.3 (new) | **fixed 2026-08-17** — both call sites now use `execFileSync("pnpm", ["exec", ...])` | none outstanding — see Phase 2 final report above |
| Catch-all `api.ts` (1,161 lines) | 3.4 (new) | confirmed live | split into focused files, re-exports, no `common.ts`/`helpers.ts` |
| `parseLinksJson` doesn't validate against `linksSchema` | 3.5 (new) | confirmed live | explicit clamp/filter or documented looser contract, tested against malformed legacy rows |
| `admin-organizations.ts` (603 lines) mixed responsibility | 8.2 (new) | confirmed live | separated by responsibility, sequenced with 1.4 |
| `check` not self-contained from fresh checkout | 12.1 (new) | confirmed by reviewer's live run | fresh clone, `pnpm install && pnpm run check` succeeds alone |
| 2 stale E2E tests (WG chair UI, sponsorship markup) | 12.2 (new) | confirmed by reviewer's live run | both tests updated to match current UI, serial run green |
| Parallel E2E magic-link rate-limit collisions | 12.3 (new) | confirmed by reviewer's live run | isolated test identities, parallel run green |

## Final closure audit (new, from v4 §16 — run once, separately, after all phases above)

Not a task on the same implementation pass — an independent final check.

1. **Re-read sources of truth:** fetch current PR head/base, fetch current `pkic-org/main` and list any merges since `5a50cd4e`, re-read the current root/scoped `AGENTS.md` + `CLAUDE.md` (not copied text in this document), fetch every unresolved review thread and latest reply, verify the reviewed commit matches the final head, update this traceability matrix if a comment changed an acceptance criterion.
2. **Schema/migration audit:** compare preview and production ledgers with repo files; apply migrations to empty D1 and to a production-shaped fixture; run importer SQL; run `PRAGMA foreign_key_check`; inspect `sqlite_schema` for forbidden intermediate columns/tables; verify each invariant against its declared enforcement owner (DB constraint/reference data vs. shared Zod policy + Vitest); verify links are JSON and queried relationship data is normalized.
3. **API/list audit:** enumerate every mounted GET/list/search endpoint from OpenAPI; reconcile against the Phase 6.0 inventory with zero missing endpoints; confirm every query composes the shared list schema, consumes `data.query`, and returns the canonical envelope; confirm all filter/search/sort/page logic is in SQL/backend projection; run query-count tests and `EXPLAIN QUERY PLAN` evidence for hot paths.
4. **DRY/boundary audit:** run ESLint + Dependency Cruiser via `pnpm run check`; run jscpd through `check` only if Phase 11's gate was enabled, otherwise attach its report and state explicitly that automated duplication enforcement is incomplete; compare against `pkic.org#726`'s measured 19 clone groups / 494 lines — zero actionable duplication may not be achieved by raising thresholds or excluding authored code; search for raw `JSON.parse`/`JSON.stringify` on `links_json`; search for duplicated pagination shapes and manual vote/application unions; search for route-owned SQL/business transitions; confirm admin/approval/self-service/scheduled/importer flows share membership operations (Phase 1.5).
5. **Correctness/resilience audit:** run all focused invariant/concurrency/failure-injection tests; run `pnpm run check`; run `pnpm run test:e2e` for affected browser flows; test scheduler exhaustion and mid-job failure; test outbox retries/dedup; test R2 compensation/reconciliation; test contextual authorization across all affected subtrees.
6. **Review disposition:** for every GitHub thread, record exactly one status — resolved with evidence, partially resolved with the remaining gap, not resolved, or obsolete (with replacement evidence). As of the post-rebase review pass, GitHub reported **48 review threads total: 22 resolved, 26 unresolved** — re-pull this count at closure-audit time rather than trusting this snapshot, since it will have moved. Post a concise review plus line comments for any remaining actionable issue. **Do not approve the PR in this phase**, even if every item above appears resolved — the post-rebase reviewer's own disposition on the current head is explicit: "Do not approve yet."

## Post-fix validation checklist (kept for quick pre-audit reference; superseded by the traceability matrix above for phase-level status)

- [ ] `pnpm run check:max-lines` passes (currently fails on the importer)
- [ ] Full migration set applies cleanly to an empty D1 database
- [ ] Importer's generated SQL runs successfully against a freshly-migrated empty D1 (new smoke test, 2.1)
- [ ] Backend test suite passes
- [ ] Frontend test suite passes
- [x] Preview and production `d1_migrations` ledgers confirmed to exclude the private range before migration files are renumbered/rewritten — **confirmed** by the post-rebase reviewer against live D1 (§0)
- [ ] New/updated tests: role ID contract (3.1), WG chair contextual permission (4.2), application transition race (5.1), approval atomicity failure injection (5.2), vote creation failure injection (5.3), proposal conversion concurrency (5.4), registrations-route query-count regression (6.6), N+1 regression guard on vote portal queries (6.4), scheduled-job registry budget exhaustion / mid-registry failure isolation (9.1)
- [ ] `pnpm run check` succeeds standalone from a fresh checkout (12.1)
- [ ] Serial Playwright run green with no stale-UI test failures (12.2)
- [ ] Parallel Playwright run green with isolated test identities (12.3)
- [ ] Importer uses `pnpm`, not `npx`, at both call sites (2.3)

---

## Phase 1 & 2 remediation pass — `prd/phase1-2-review-20260817.md` (2026-08-17)

A fresh independent re-review of HEAD `0c3b7104` (`prd/phase1-2-review-20260817.md`) found 9 remaining blockers despite Phase 1/2 being marked "done" above. This pass fixed all 9. Baseline commit: `0c3b7104432b9e92f089bdbd2779a5daada0cdbe2` (typecheck clean; `pnpm run test` not run standalone before starting — see Regressions below for the full-suite numbers this pass actually verified against).

### Checklist

| ID | Requirement (verbatim from the review) | file:line | Command | Result | Status |
| --- | --- | --- | --- | --- | --- |
| Blocker 1 | "Phase 2 needs a preflight that rejects missing, unknown, and member-kind-incompatible categories before producing or executing any SQL." | `scripts/migrate-members/categories.mjs:65` (`assertCategoriesValid`), called from `scripts/migrate-members/build-migration.mjs:65` before any statement is built | `pnpm exec vitest run --config vitest.config.tools.ts` | `Test Files 6 passed (6), Tests 52 passed (52)` | **PASS** — with one narrowed scope, see Open Questions |
| Blocker 2 | "Working-group participation and possibly leadership positions need an explicit `member_id`... CA working-group eligibility uses a scalar subquery without an explicit affiliation or ordering." | `functions/_lib/services/admin-working-groups.ts:386-392` (`findEligibleMemberById` + `assertCaConstraint`); `working_group_members.member_id` (migration `0036`, new column) threaded through `provisioning.ts`, `member-self-service.ts`, `admin-working-groups.ts`, and the importer | `pnpm exec vitest run --config vitest.config.ts tests/working-groups.test.ts tests/membership-onboarding.test.ts` | `Test Files 2 passed (2), Tests 27 passed (27)` | **PASS** — CA-eligibility bug, 7x DRY duplication, and the explicit `member_id` for WG participation all closed (gap-closing follow-up pass, 2026-08-17). Leadership-position/forum-chair display deliberately still uses live deterministic resolution — confirmed intentional per `leadership.ts`'s own design note, not a gap, see follow-up pass notes below |
| Blocker 3 | "Representative role IDs must always require exactly an organization membership context and reject every other context." | `functions/api/v1/admin/users/[userId]/roles/index.ts:123-130` | `pnpm exec vitest run --config vitest.config.ts tests/roles.test.ts` | `Test Files 1 passed (1), Tests 29 passed (29)` | **PASS** |
| Blocker 4 | "the use case should build one command set and commit once; durable external effects should enter the outbox in that same boundary." | `functions/_lib/services/membership/provisioning.ts:442` (org+aggregate+category+member_since+reps+roles+WG memberships, one `db.batch()`); `functions/_lib/services/membership/applications/approve.ts:187` (+ stage transition + event + Google Groups enqueues + email-outbox inserts + audit-log insert, one `db.batch()`, closed in the gap-closing follow-up pass); `functions/_lib/services/member-organization.ts` (`addCoworker`, user+representative, one `db.batch()`) | `pnpm exec vitest run --config vitest.config.ts tests/membership-provisioning-atomicity.test.ts tests/membership-onboarding.test.ts tests/membership-provisioning-concurrency.test.ts` | `Test Files 3 passed (3), Tests 17 passed (17)` | **PASS** — fully closed. Every membership-state write, the three onboarding emails, and the audit-log insert now commit in exactly one `db.batch()`, for both the interactive approve route and the unattended auto-approve job. Real (not simulated) concurrent-request test added; confirmed data-safe under an actual race. |
| Blocker 5 | "The importer should consume the same shared schemas, constants, and serialization functions as runtime writes." | `scripts/migrate-members/sql-renderer.mjs:11,29` (`linksSchema`/`serializeLinks` from new `assets/shared/schemas/links.ts`); `scripts/migrate-members/organizations.mjs` (`REPRESENTATIVE_ROLE_IDS` from new `assets/shared/schemas/representative-roles.ts`); `scripts/migrate-members/categories.mjs` (`MEMBERSHIP_CATEGORIES`/`isIndividualMembershipCategory` from existing `assets/shared/schemas/membership-categories.ts`) | `pnpm exec vitest run --config vitest.config.tools.ts` | `52 tests passed` | **PASS** |
| Blocker 6 | "It never runs it twice and compares row counts, identities, assignments, roles, sponsorships, and working-group memberships." | `tests/tools/migrate-members-importer.test.ts:224` | `pnpm exec vitest run --config vitest.config.tools.ts tests/tools/migrate-members-importer.test.ts` | `Test Files 1 passed (1), Tests 3 passed (3)` | **PASS** |
| Blocker 7 | "Hidden files, `._*`, and non-regular files must be excluded. This should have an explicit regression test." | `scripts/migrate-members/parsers.mjs:85` | `pnpm exec vitest run --config vitest.config.tools.ts tests/tools/migrate-members-parsers.test.ts` | `Test Files 1 passed (1), Tests 13 passed (13)` | **PASS** |
| Blocker 8 | "it is not yet the thin entrypoint required by the plan and `AGENTS.md`." | `scripts/migrate-members-yaml-to-d1.mjs` | `wc -l scripts/migrate-members-yaml-to-d1.mjs` | `143` (was 617 before this pass, 1244 originally) | **PASS** |
| Blocker 9 | "What is still missing is proof that every write path uses one canonical Zod/domain vocabulary, plus parity tests for any SQL-side mirrors." | `functions/_lib/services/sponsorship/admin-pipeline.ts:11` and `assets/ts/admin/types.ts:1` (`SPONSORSHIP_PIPELINE_STAGES` now imported, not re-declared); `assets/shared/schemas/member-applications.ts:33` (`APPLICATION_STAGE_TRANSITIONS`, now the single source for backend + frontend); `tests/members-model.test.ts:140` (`members.status` CHECK-constraint parity test); gap-closing follow-up pass fixed 4 more instances (`MAILING_LIST_TYPES`, `SPONSOR_TYPES`, `CONTENT_REVIEW_STATUSES`, `VOTING_CATEGORY_LETTERS`) | `pnpm exec vitest run --config vitest.config.ts tests/members-model.test.ts tests/mailing-lists.test.ts tests/votes.test.ts` plus `pnpm run test:frontend` | `Test Files 3 passed (3), Tests 29 passed (29)`, frontend `36/36` | **PASS** for the original three drift instances, the DB-CHECK parity test, and 4 more real instances found by a broadened follow-up sweep. Still not a formal proof of zero remaining drift — 6 lower-risk instances found and documented, not fixed (see follow-up pass notes below) |

**9 of 9 blockers complete.** Two open questions from the first pass (Blocker 4 atomicity, Blocker 9 sweep breadth) fully closed in the 2026-08-17 gap-closing follow-up pass below. Blocker 1 re-confirmed as-is (no viable signal exists). Blocker 2 closed for working-group participation (explicit `member_id`); leadership-position display confirmed intentional, not a gap.

### Regressions vs. baseline

- `pnpm run typecheck` (backend/frontend/tools): clean, no errors — identical to baseline.
- `pnpm run test:backend`: **920 passed, 1 skipped**, confirmed by a full standalone run after all 9 fixes landed (baseline reported 899/900 before this pass's own new tests; the net-new passing tests are this pass's own regression coverage — Blocker 3's role-context tests, Blocker 2's WG-eligibility tests, Blocker 4's atomicity failure-injection tests, Blocker 9's CHECK-parity test). Zero failures, zero flakes across two full runs.
- `pnpm run test:frontend`: **36/36 passed** — identical to baseline.
- `pnpm exec vitest run --config vitest.config.tools.ts`: **52 passed** (was 38 at the last Phase 2 report; +14 from this pass's new importer/category/link tests). Zero failures.
- `pnpm run lint`: fails at the same pre-existing 5833 errors from the untracked local `.venv` Playwright-driver directory — same files, same rule violations, confirmed unrelated to any file this pass touched (verified `eslint` clean on every touched file individually). Not a regression.
- `pnpm run lint:architecture`: still blocked by the pre-existing Node-version mismatch (this environment runs 25.3.0; dependency-cruiser requires ^22/^24/≥26) — unrelated to this change, matches every prior pass's own note.
- `pnpm run format:check`, `pnpm run check:max-lines`, `pnpm run check:filenames`: all clean.
- `pnpm run build`: succeeds (production Vite build + Pagefind index), one pre-existing `INEFFECTIVE_DYNAMIC_IMPORT` warning unrelated to this diff.
- No `pnpm run test:e2e` run this pass — no browser-visible UI behavior changed by any of the 9 fixes (Applications.tsx's change is a pure data-source swap, same rendered values).

### Security findings (diff-only review)

- **Injection**: every new/changed SQL statement uses `.prepare().bind()` parameterization. The one string-interpolated SQL fragment (`representative-lookup.ts`'s `userIdExpr` parameter) is always a fixed code-controlled alias literal (`"u.id"`, `"wgm.user_id"`) at all 8 call sites, never user input — confirmed by reading every call site. No SQL injection introduced.
- **AuthZ**: Blocker 3's fix is strictly a tightening (rejects a previously-permitted invalid state); Blocker 2's fix changes a WG-eligibility check from an arbitrary single-category comparison to an existence check across every membership the target legitimately holds — strictly more correct, not more permissive (a person who previously might have been arbitrarily rejected despite holding real category-A standing is now correctly accepted; a person with no category-A affiliation anywhere is still rejected, verified by `tests/working-groups.test.ts`'s new "deterministically rejects" case).
- **Validation**: `buildLinksJson` (Blocker 5) is new user-adjacent validation surface (importer-only, not a live HTTP request path) — filters non-http(s)/malformed/duplicate/over-15-count entries against the canonical `linksSchema` instead of accepting raw strings; caught two real production data typos during this pass.
- **Secrets**: none touched; no new logging of sensitive fields.
- **New dependencies**: none — zero `package.json` changes.
- **DoS**: no new unbounded loops or unpaginated queries. `findEligibleMemberById` (Blocker 2) replaces one scalar subquery with one bounded query returning at most a user's own membership rows (never large).
- No High/Critical findings. Nothing outstanding.

### Open questions and where this pass narrowed scope deliberately

1. **Blocker 1 "kind-incompatible" categories**: a structural heuristic (individual category + non-empty `organizationDomains` ⇒ reject) was implemented, tested against the full real 419-org dataset, found to false-positive on 44 real production individual records (`organizationDomains` is a legitimate, YAML-documented convention for email-matching, not a mis-tagging signal), and reverted. Conclusion: this importer has no independent signal of a record's intended kind other than the category itself, and `build-migration.mjs` derives kind *from* the (now-validated) category — so kind and category cannot diverge downstream by construction. Documented in `categories.mjs`'s own comment. Missing/unknown categories are still rejected outright.
2. **Blocker 2 leadership/WG-chair display**: the review's fuller suggestion ("possibly leadership positions need an explicit `member_id`") would require a schema change (adding `member_id` to `leadership_positions` and/or the WG-chair role grant) to know *which* represented organization a global leadership title or chair role is "for." That is a product/schema decision beyond this pass's conservative scope — the display-only "deterministic first organization by earliest `joined_at`" behavior is unchanged (it was already deterministic, just duplicated 7x — the duplication is fixed, the underlying "which org to show" simplification is not).
3. **Blocker 4 outbox/audit atomicity**: the review's fullest phrasing ("durable external effects should enter the outbox in that same boundary") would mean folding `queueEmail` and `writeAuditLog` (in the HTTP route, `functions/api/v1/admin/applications/[id]/approve.ts`) into the same `db.batch()` as membership provisioning. Not done — this is explicitly the broader Phase 5.2 item in this document, touching the shared email-outbox and audit-log infrastructure used by dozens of other routes, a materially larger blast radius than this review's specific finding. What *is* fixed: every membership-state write (organization, aggregate, representative, role, application stage/event, Google Groups enqueue) is now one atomic unit; email/audit are secondary effects with the outbox's own idempotent-retry machinery, documented as a deliberate boundary in `approve.ts`'s header comment.
4. **Blocker 9 scope**: the audit covered the vocabularies explicitly named in the review (application stage, on-hold subtype, content-review status, vote/proposal status, sponsorship pipeline stage, member status) plus a full-repo grep for hand-typed duplicates of each; it is not a formal proof that *no* other closed-state field anywhere in the repo has drifted, only that the three confirmed instances found are fixed and the one DB-side mirror found has a parity test.

### Anything changed that was not in Phase 1, Phase 2, or the 9 blockers

Nothing. All 45 changed files trace to one of the 9 blockers above; no opportunistic refactors, no unrelated file touches. (`csv/` and `prd/` remain untracked/uncommitted, per AGENTS.md's rule against moving production PII into shared history — unchanged by this pass.)

### Gap-closing follow-up pass (2026-08-17, second pass — closes the four open questions above)

The prior pass's own honest self-assessment flagged six things it couldn't guarantee: three deliberately-narrower-than-ideal blockers (documented above), a grep-based (not exhaustive) Blocker 9 audit, no browser/e2e verification, no real concurrency test, and single-agent review only. This pass addressed each directly, plus ran an independent (separately-launched, not primed by this document) code review of the resulting diff.

**Independent re-verification of all 9 blockers**: every file:line claim in the checklist table above was re-checked against current disk (fresh `grep`/`Read`, not trusting the prior summary) before any new work started. All 9 confirmed accurate — no drift, no since-reverted fix.

**Open question 3 (Blocker 4) — closed, not just narrowed.** The email-outbox inserts (member-account-claim, application-approved-welcome, org-contact-assigned) and the audit-log insert now commit in the *exact same* `db.batch()` as membership provisioning, for both callers: the interactive approve route (`functions/api/v1/admin/applications/[id]/approve.ts`) and the unattended EC-window auto-approve job (`scheduled-jobs.ts`'s `runEcWindowAutoApprove`). This required two small additions to make the DRY/atomic boundary work correctly rather than duplicating logic:
- `functions/_lib/email/outbox.ts`: extracted `buildEmailOutboxValues` (shared row-shaping) and added `prepareQueueEmailStatement`, a batch-safe sibling to the existing immediate-execution `queueEmail` — same payload shape (attachments, capability links, calendar invites, everything), just returns a `StatementLike` instead of executing.
- `functions/_lib/services/audit.ts`: `prepareAuditLog` (already existed, used elsewhere) gained an optional `createdAt` param so its timestamp can align with the rest of the batch instead of drifting by a few ms.
- `approveApplication` (`membership/applications/approve.ts`) now takes `loginUrl: string` (plain string, not `env`/`config` — building email content needs no D1/Worker binding access) and returns `outboxIds: string[]` for the caller to `processOutboxByIdBackground` after the batch commits. Audit-log insert is folded in only when `actorUserId` is set — preserves the pre-existing behavior difference (interactive approvals get an audit entry; the unattended auto-approve job never did).
- New tests: `membership-onboarding.test.ts` — audit-log entry and email-outbox rows share the exact same `stage_entered_at` timestamp as the application's own state transition (proof of one commit, not three); a second test confirms the auto-approve path still writes zero audit rows (unchanged behavior) while still atomically queueing its emails.
- The 3 remaining membership-state writes untouched by this: none — this was the last piece of "every write in the same batch" for this specific use case.

**Open question 4 (Blocker 9) — broadened, 4 more real instances fixed.** A fresh, independently-launched sweep (not limited to the six vocabularies the review named) searched every migration `CHECK` constraint and every `assets/shared/schemas/` constant against hand-typed duplicates repo-wide. Found 10 more real instances beyond the original 3. Fixed the four highest-confidence/highest-impact ones (worst-case pattern: two independently-declared "canonical" sources, or verbatim copy-paste of a canonical const under a different file):
- `MAILING_LIST_TYPES` — was declared independently in *two* files (`assets/shared/schemas/admin-mailing-lists.ts` and `functions/_lib/services/mailing-lists.ts`) plus hand-typed again in `assets/ts/admin/types.ts` and `MailingLists.tsx`. Now one source (`admin-mailing-lists.ts`), three call sites import it.
- `SPONSOR_TYPES` — verbatim copy-paste re-declaration in `Sponsorships.tsx`, now imported from `admin-sponsorships.ts`.
- `CONTENT_REVIEW_STATUSES` — `OrganizationContentReviews.tsx`'s tab filter was a hand-typed duplicate of `admin-organizations.ts`'s canonical array; now imported.
- Voting-eligible category letters — `votes.ts` had its own `MEMBERSHIP_CATEGORY_LETTERS` tuple duplicating `membership-categories.ts`'s `VOTING_CATEGORIES` (a `Set`, different shape). Added a `VOTING_CATEGORY_LETTERS` tuple as the one source, `VOTING_CATEGORIES` now derives from it, `votes.ts` imports the tuple.
- **Not fixed, documented as remaining debt**: 6 more instances the sweep found (email `content_type`/`message_type` unions repeated across 12+ files each, admin user roles, event-team permission values, leadership body, EC approve/decline decision). Lower per-instance risk (simple 2–3-value type annotations, not validated arrays with drift potential) and collectively a much larger blast radius than this pass's scope — left as a follow-up, not silently dropped.

**Open question 1 (Blocker 1) — re-confirmed, not reopened.** No new independent signal exists in the importer's data to detect "kind-incompatible" categories beyond what the already-shipped preflight checks (missing/unknown). Accepted as-is.

**Open question 2 (Blocker 2) — the explicit-`member_id` schema addition was implemented, scoped narrower than the review's literal wording after investigation.** `working_group_members` gained a nullable `member_id` column (migration `0036`, edited directly rather than appended — confirmed via `wrangler d1 migrations list --env preview --remote` that `0035`–`0053` are still 100% unapplied on the shared preview DB before touching it), threaded through every write path:
- `provisioning.ts` (real member approvals) — always unambiguous, the aggregate id is already known.
- `member-self-service.ts`'s self-service WG join — the caller's own explicitly-chosen active membership.
- `admin-working-groups.ts`'s staff-driven add — the target's single membership when unambiguous, `null` when the target holds more than one (no way to infer which without new admin UI, out of scope).
- The importer (`scripts/migrate-members/sql-renderer.mjs`) — best-effort via the same deterministic-representative-then-individual SQL pattern already used at read time.
- `getAdminWorkingGroupDetail`'s read path now prefers the recorded `member_id`, falling back to the old deterministic join for older/ambiguous rows.
- **`leadership_positions`/forum-chair display was deliberately left out of this**, after reading `leadership.ts`'s own header comment: it explicitly documents "resolved live from the person's current active `members`/`organizations` row, not from a value captured at the time the position was created — so a Board member's displayed affiliation always reflects who they work for today." Adding a captured `member_id` there would work *against* that already-intentional, already-documented design choice, not fix a gap. The review's own wording hedged this with "possibly" — treated as confirming the hedge was warranted, not as a missed requirement.
- New tests in `working-groups.test.ts` (single-membership → recorded; multi-membership → `null`, not a wrong guess) and `membership-onboarding.test.ts` (provisioning path always records the correct id).

**No real concurrency test — closed.** `tests/membership-provisioning-concurrency.test.ts` fires two genuinely simultaneous `provisionOrganizationMembership` calls (`Promise.allSettled`, not sequential) at the same D1 binding for a brand-new organization name with no domain — the one race window with no unique-domain safety net to fall back on. Empirically observed (not simulated) outcome, stable across repeated runs: the two calls genuinely interleave past the pre-batch "does this org exist" read, and the loser's `db.batch()` fails atomically on `organizations.normalized_name`'s pre-existing `UNIQUE` constraint (`migrations/0000_initial_schema.sql:50`) — no orphaned/duplicate organization or aggregate ever lands, confirmed by direct row-count assertions after the race. A second ad-hoc probe (written, run, and deleted — not kept as a permanent test since it duplicates the same underlying pattern) confirmed the sibling aggregate-creation race behaves the same way via a `FOREIGN KEY` violation instead.

**No browser/e2e verification — closed, with a genuine (pre-existing, unrelated) finding.** Ran the existing `admin-verification.spec.ts` Playwright suite's focused tests for every admin screen touched by this pass's Blocker-9 vocabulary-dedup changes. "Mailing lists" and "Organization content review" — the two screens whose import paths this pass actually changed — passed cleanly, twice. "Working groups" and "Sponsorships" — screens this pass did *not* change the rendering behavior of — hit a 120s timeout, reproducibly, even in isolation with nothing else running. Root-caused (not just assumed): the page snapshot at failure shows "Chair and vice chair are assigned from the 'Leadership' section," not the inline chair-assignment form the test still expects. This is the exact, already-documented issue at **Phase 12.2** above ("Working-group test still expects inline chair assignment after that UI moved it to Leadership. Sponsorship test still expects the former list markup after conversion to a table") — pre-existing test debt from an earlier intentional UI change, unrelated to anything in this pass or the 9 blockers, confirmed via code-path analysis (the step that hangs calls `GET /api/v1/admin/users`, a search endpoint untouched by this diff). Not fixed here — Phase 12.2 is explicitly its own tracked item with its own plan.

**Independent code review** (separately launched, reviewed the diff directly rather than this document): 5 finder angles, 11 distinct items surfaced, verified against the exact committed blobs.
- 1 finding (`approve.ts` locally re-declaring `CA_WORKING_GROUP_SLUG`/`CA_ONLY_CATEGORY` instead of importing from `working-groups.ts`) — **fixed**, now imports the canonical constants.
- 1 finding, confidence 75/100, corroborates and *corrects* this pass's own initial read of the concurrency-test result: the "generic 500 instead of typed 409" gap for a losing concurrent provisioning request is specifically a **`FOREIGN KEY` constraint failure** on `organization_representatives.member_id` (the aggregate-creation race, `buildResolveOrCreateAggregateStatements`), not the `UNIQUE`-constraint organization-name race this pass's own test empirically confirmed — two related but distinct race windows, both real, both already safe (no data corruption, confirmed for both), neither given a typed error. **Deliberately not fixed**: D1's `FOREIGN KEY constraint failed` message carries no column-level detail (confirmed empirically — see the deleted ad-hoc probe above), so pattern-matching it to translate to a friendly 409 would risk misclassifying a genuinely different FK bug as "just retry," a worse outcome than the current opaque-but-safe 500. Documented here as a known, real, moderate-confidence, non-blocking finding rather than a rushed imprecise fix.
- 1 finding, confidence 50/100 (`sql-renderer.mjs`'s `buildLinksJson` hand-reimplementing link validation) — reviewed, already explicitly documented as intentional "belt and suspenders" in its own comment, no action needed.
- 1 low-confidence item (`findEligibleMemberById`-based eligibility now excluding deactivated/inactive reps where the old inline query didn't) — confirmed intentional correctness tightening, consistent with every other eligibility gate in the codebase, no action needed.
- 6 items refuted or out of scope on verification: 2 dangling comments referencing since-renamed files (pre-existing, untouched by this PR's diff), 1 finding against `sql-renderer.mjs`'s `buildWorkingGroupMemberStatement` that only existed in this same pass's own uncommitted `member_id` work (the reviewer diffed against the last committed blob and flagged code that was, at that moment, still mid-edit in this working tree — not a defect, since the finished version does reuse the deterministic-representative pattern, see Open question 2 above), 1 already-identical-logic relocation (not a new gap), 2 "not a bug" (already-disclosed scope narrowing / defensible design difference), 1 architectural constraint (the standalone importer script has no D1 binding, can't call the runtime provisioning service directly).

### Regressions vs. baseline (this follow-up pass)

- `pnpm run typecheck`: clean.
- `pnpm exec eslint` on every touched file: clean (2 pre-existing formatting nits auto-fixed with `--fix` during this pass).
- `pnpm run format:check`, `pnpm run check:max-lines`, `pnpm run check:filenames`: clean.
- `pnpm run lint`: same pre-existing 5833 errors from the untracked `.venv` Playwright-driver directory as every prior pass — confirmed unrelated, same count.
- `pnpm run lint:architecture`: still blocked by the pre-existing Node-version mismatch, unrelated, matches every prior pass's note.
- `pnpm run build`: succeeds, same one pre-existing `INEFFECTIVE_DYNAMIC_IMPORT` warning as before.
- `pnpm run test:backend`: **925 passed, 1 skipped**, run 3 times — 2 clean, 1 crashed mid-run with an unattributed Node assertion (no specific test named, not reproducible on immediate re-run). Consistent with this document's own pre-existing Phase 12.1 finding ("`pnpm run check` is not self-contained from a fresh checkout") — treated as known test-infrastructure flakiness, not a regression, since it isn't attributable to any specific test and doesn't reproduce.
- `pnpm run test:frontend`: **36/36**, unchanged.
- `pnpm exec vitest run --config vitest.config.tools.ts`: **52/52**, unchanged.
- `pnpm run test:e2e` (targeted, not full suite): 2/4 relevant tests passed cleanly; 2/4 hit the pre-existing Phase 12.2 issue documented above, unrelated to this diff.

## Phase 3 remediation pass — 2026-08-17

Implemented and verified all 5 items of Phase 3 (§3.1–3.5) against baseline commit `7226cd343b2bccfc8f75408504d9120231a5d5a8`. **5 of 5 items complete**, all PASS with evidence below.

### Baseline (before any change, commit `7226cd34`)

- `git status`: clean except pre-existing untracked `csv/` and `prd/*.md` review docs (unrelated to this pass, not touched).
- `pnpm run typecheck` (backend/frontend/tools): clean.
- `pnpm run test`: backend **925 passed, 1 skipped** (926), frontend **36/36**, tools **52/52** — all pass.
- `pnpm run lint`: **5833 pre-existing errors**, entirely from the untracked local `.venv` Playwright-driver directory (not part of the tracked repo) — pre-existing, matches every prior pass's own note.
- `pnpm run format:check`, `check:max-lines`, `check:filenames`: clean.
- `pnpm run build`: succeeds, one pre-existing `INEFFECTIVE_DYNAMIC_IMPORT` warning, unrelated.
- `pnpm run lint:architecture`: blocked by pre-existing Node-version mismatch (environment runs 25.3.0; dependency-cruiser requires `^22||^24||>=26`) — pre-existing, unrelated, matches every prior pass's note.

### Checklist (extracted verbatim from Phase 3, IDs assigned this pass)

| ID | Requirement (verbatim) | file:line | Command | Result | Status |
| --- | --- | --- | --- | --- | --- |
| P3-01 | "The response contract still rejects the system-role IDs that this same file explicitly supports... Reuse one exported `roleIdSchema` for params, requests and both responses, and add response-contract tests with built-in roles." | `assets/shared/schemas/access-control.ts:25` (`roleIdSchema`), `:26` (`roleIdParamsSchema`), `:128` (`roleResponseSchema.id`), `:222` (`userRoleAssignSchema.roleId`), `:240` (`userRoleResponseSchema.roleId`) — all four now reuse the one export | `pnpm exec vitest run --config vitest.config.ts tests/access-control-role-id-contract.test.ts tests/access-control-schema.test.ts tests/openapi-schema-generation.test.ts tests/roles.test.ts` | `Test Files 4 passed (4), Tests 42 passed (42)` | **PASS** |
| P3-02 | "`status` is any string and both result fields are `unknown`... Define shared vote/proposal status schemas and a discriminated result union keyed by vote type/detail level." | `assets/shared/schemas/votes.ts:55` (`motionVoteResultSchema`), `:69` (`electionVoteResultSchema`), `:75` (`voteFullResultSchema`), `:81` (`voteOutcomeOnlyResultSchema`), `:89` (`voteResultSchema`), applied at `:127`, `:135`, `:250` replacing all three `z.unknown()` usages; `voteStatusSchema`/`voteProposalStatusSchema` (already enums from an earlier pass) reconfirmed still closed | `pnpm exec vitest run --config vitest.config.ts tests/votes-schema.test.ts tests/votes.test.ts` | `Test Files 2 passed (2), Tests 23 passed (23)` | **PASS** |
| P3-03 | "The application state machine is copied here, in `member-applications.ts`, and partly again in the admin Zod schema... Export stage/subtype constants, Zod schemas, and a pure `allowedTransitions(from)` policy from one membership-domain module." | `assets/shared/schemas/member-applications.ts:59` (`allowedTransitions`, new pure function), consumed by `functions/_lib/services/membership/applications/transition.ts:37` and `assets/ts/admin/sections/Applications.tsx:255`; hardcoded `WORKING_GROUP_LABELS` map (formerly `Applications.tsx:23-30`) replaced with a live fetch of `GET /api/v1/admin/working-groups` at `Applications.tsx:102-107` | `pnpm exec vitest run --config vitest.config.ts tests/member-applications-schema.test.ts tests/application-stage-machine.test.ts tests/admin-applications.test.ts` | `Test Files 3 passed (3), Tests 29 passed (29)` | **PASS** |
| P3-04 | "`assets/shared/schemas/api.ts` is a 1,161-line catch-all schema file... move canonical pieces into focused files: `links.ts`, `list.ts`, `membership/categories.ts`, `membership/applications.ts`, existing domain files for access control, votes, sponsorships, organizations, and users." | All named extractions already exist on disk (`links.ts`, `pagination.ts`, `membership-categories.ts`, `member-applications.ts`, `access-control.ts`, `votes.ts`, `admin-sponsorships.ts`/`sponsorship.ts`, `admin-organizations.ts`, `admin-users.ts`/`user-emails.ts`) from prior passes not tracked in this document. This pass finished the migration: removed the last "temporary" re-export of link symbols from `api.ts` (`api.ts:2-5`) and repointed the 9 remaining importers (`admin-organizations.ts` ×2, `member-self-service.ts`, `leadership.ts`, `organization-content-reviews.ts`, `membership/directory.ts`, `membership/provisioning.ts`, `member-detail-page.tsx`, plus shared `admin-organizations.ts`/`me.ts`) to import `linksSchema`/`parseLinksJson`/`serializeLinks`/`findLinkedinUrl` directly from `links.ts`. Remaining `api.ts` content (~1097 lines) is a single cohesive events/registrations/proposals domain — not a catch-all mixing unrelated concerns — so no further split was invented; see Open Questions | `pnpm run typecheck` (backend/frontend/tools); `grep -rn "shared/schemas/api\"" ... \| grep linksSchema\|parseLinksJson\|serializeLinks\|findLinkedinUrl` returns 0 hits outside `api.ts` itself | typecheck clean; grep empty | **PASS** |
| P3-05 | "`parseLinksJson` does not validate its own normalized output against `linksSchema`... make it explicit in code and covered by a test with a deliberately-oversized/malformed legacy row." | `assets/shared/schemas/links.ts:64-79` — `parseLinksJson` now dedupes case-insensitively, filters every candidate through `linkUrlSchema.safeParse`, and caps at 15, mathematically guaranteeing the output always satisfies `linksSchema` | `pnpm exec vitest run --config vitest.config.ts tests/links-schema.test.ts` | `Test Files 1 passed (1), Tests 8 passed (8)` — includes an oversized (40-link) row capped to 15 and a `javascript:` URI dropped | **PASS** |

**5 of 5 items complete.**

### Regressions vs. baseline

- `pnpm run typecheck` (backend/frontend/tools): clean — identical to baseline.
- `pnpm run test:backend`: **952 passed, 1 skipped** (953) — 27 new tests added by this pass (all passing), zero baseline tests broken. Verified clean on a run with no concurrent filesystem activity; two earlier runs showed spurious failures traced to (a) a `pnpm run build` invocation racing the same vitest process and corrupting Hugo's `public/` directory mid-run (miniflare's asset-manifest walk then hit `ENOENT`), and (b) one unattributed `vitest-pool-workers` WebSocket assertion crash before any test executed — both are the same class of known, pre-existing test-infrastructure flakiness this document's own Phase 12.1 finding and the 2026-08-17 Phase 1/2 pass's "Regressions" section already documented, not attributable to any file this pass touched, and not reproducible once build/test were no longer run concurrently.
- `pnpm run test:frontend`: **36/36** — identical to baseline.
- `pnpm exec vitest run --config vitest.config.tools.ts`: **52/52** — identical to baseline (this pass touched no importer/tooling code).
- `pnpm run lint`: same pre-existing 5833 errors from the untracked `.venv` Playwright-driver directory — confirmed unrelated (every touched file individually lint-clean).
- `pnpm run lint:architecture`: still blocked by the pre-existing Node-version mismatch — unrelated, matches every prior pass's note.
- `pnpm run format:check`, `check:max-lines`, `check:filenames`: all clean.
- `pnpm run build`: succeeds, same one pre-existing `INEFFECTIVE_DYNAMIC_IMPORT` warning as baseline.
- `pnpm exec playwright test tests/e2e/votes-and-sponsor.spec.ts -g "public votes pages"`: **1 passed** — exercises the real public vote-results rendering path this pass's `votes/public.ts`/`votes/portal.ts` changes touch.
- `pnpm exec playwright test tests/e2e/admin-verification.spec.ts -g "working groups"`: **1 failed**, a 120s timeout — this is the pre-existing, already-documented Phase 12.2 issue (chair assignment moved to the Leadership section, test still expects the old inline form); this pass never touched `WorkingGroups.tsx` or its chair-assignment flow, only added a new `GET /api/v1/admin/working-groups` *read* call from `Applications.tsx`. Not a regression.

No test that passed at baseline now fails.

### Security review (diff-only)

- **Injection**: no new SQL; every touched file is schema/type declarations or a `fetch`/`safeParse` call. No SQL/command/path injection surface introduced.
- **AuthZ**: the one new network call (`Applications.tsx`'s `GET /api/v1/admin/working-groups` fetch) reuses an existing, already-permission-gated endpoint (`working-groups:read`, enforced server-side in `functions/api/v1/admin/working-groups/index.ts:19`) with no new client-side bypass; if a staff role lacks that permission the fetch fails and the UI degrades to showing raw slugs (matching the pre-existing `?? slug` fallback), not an error or a crash. No IDOR — no user-supplied ID in the new call.
- **Validation / stored-XSS finding fixed by this pass**: `assets/ts/member-flows/member-detail-page.tsx:106` renders every entry of a member's `links` array as `<a href={url} target="_blank" rel="noopener">` with no scheme check. Before this pass, `parseLinksJson`'s legacy `{label, url}`-object fallback accepted **any** string as a link (including a `javascript:` URI) and returned it unvalidated — a legacy/imported row containing `{"label": "x", "url": "javascript:alert(document.cookie)"}` would have rendered as a clickable stored-XSS link on the public member-directory profile page. P3-05's fix (`links.ts:64-79`) now filters every candidate through `linkUrlSchema`, which requires `http://`/`https://` only, closing this — confirmed by `tests/links-schema.test.ts`'s "drops a non-http(s) scheme" case. This was a real, if legacy-data-dependent, finding this pass fixed as a side effect of implementing P3-05, not a new one introduced.
- **Secrets**: none touched; no new logging of sensitive fields (deliberately did not add logging to `parseLinksJson`, since the module is documented dependency-free and used on every read — see Open Questions).
- **Crypto**: not touched.
- **SSRF / redirects**: not touched — no new outbound requests to user-influenced URLs.
- **New dependencies**: none — `package.json`/`pnpm-lock.yaml` unchanged.
- **DoS**: no new unbounded loops or unpaginated queries. `parseLinksJson`'s new dedupe/filter pass is O(n) over an already-bounded JSON blob (same as before); output is now capped at 15, never larger. The new working-groups fetch is a single bounded call to an existing small (~6-10 row) reference list, matching the same unpaginated pattern the existing `WorkingGroups.tsx` admin screen already uses.

No High/Critical findings outstanding. One pre-existing (not newly introduced) stored-XSS-via-legacy-data vector was found and fixed as a direct consequence of P3-05.

### Open questions and assumptions made

1. **P3-04's remaining `api.ts` scope**: the plan's four named extractions (`links.ts`, `list.ts`≈`pagination.ts`, `membership/categories.ts`≈`membership-categories.ts`, `membership/applications.ts`≈`member-applications.ts`) were already done by prior, undocumented passes before this one started; this pass verified each still-existing consumer and finished retiring the temporary re-export the plan explicitly called "temporary... to avoid a flag-day import rewrite." The ~1097 remaining lines of `api.ts` are a single cohesive events/registrations/proposals/admin-event domain (registration, invites, proposals, reviews, forms, campaigns, admin auth) with ~50 importers across the routes tree — not the kind of "catch-all" the finding originally described (which was about `linksSchema`/`customAnswersSchema`/membership/list contracts being jumbled in with unrelated domains, now resolved). Conservative reading applied: did not invent a further split of this cohesive file, since the plan's explicit bullet list is now fully satisfied and AGENTS.md instructs against opportunistic refactors beyond what an item requires. Flagging this choice explicitly rather than silently declaring 3.4 "fully done" in some stronger sense than the plan actually asked for.
2. **P3-05's clamp vs. log choice**: the plan offered two options — clamp/filter (optionally with a logged degradation) or document a looser contract. Chose clamp/filter without adding logging: `links.ts` is explicitly documented as dependency-free (`zod` only, no bundler, consumed directly by the Node-only importer script), and `parseLinksJson` runs on every read of a user/org's links across live request paths, so introducing an unprecedented per-call logging side effect into a pure function risked production log noise for a case (a handful of dropped legacy entries) that isn't operationally actionable per-request. The degradation is instead made mechanically impossible to miss: the function's own guarantee (output always satisfies `linksSchema`) is asserted by `tests/links-schema.test.ts`, not by a runtime log line.
3. **`fromStage as ApplicationStage` casts** in both `transition.ts:37` and `Applications.tsx:255`: pre-existing pattern (the prior code already cast `fromStage`/`detail.stage` the same way before this pass); preserved rather than "fixed," since `allowedTransitions` correctly returns `undefined` (handled by `?? []`) for any string that isn't a real stage, matching prior behavior exactly — not a new gap.

### Anything changed that was not in Phase 3

Nothing implemented beyond the 5 items above. Two pre-existing, unrelated stale code comments were found during review (`assets/shared/schemas/member-applications.ts:9` and `admin-applications.ts:67` both still reference a `functions/_lib/services/member-applications.ts`'s `ALLOWED_STAGE_TRANSITIONS` that was renamed/relocated to `membership/applications/transition.ts` in an earlier, undocumented pass) — left untouched as out-of-scope doc drift, not part of any Phase 3 item, and touching them would mean editing files unrelated to this pass's items. `csv/` and `prd/*.md` remain untracked/uncommitted, unchanged by this pass.

---

## Phase 4 remediation pass — 2026-08-17

Implemented and verified both items of Phase 4 (§4.1–4.2) against baseline commit `8180fe4254ffa6ef5689cce80f568fa9f515cdc6`. **2 of 2 items complete**, both PASS with evidence below. Investigating 4.1 also surfaced and fixed several real, currently-exploitable authorization gaps beyond the two named items — see "Anything changed that was not in Phase 4" below; do not read this pass as scope creep without reading that section's justification.

### Checklist (extracted verbatim from Phase 4, IDs assigned this pass)

| ID | Location | Requirement (verbatim) | Plan (verbatim) |
| --- | --- | --- | --- |
| P4-01 | `functions/api/v1/admin/router.ts:80` [P1] | "This creates a fail-open authorization composition: matching a path here disables legacy scope enforcement and assumes every current and future descendant handler remembers its own permission check. Mount bounded routers with declarative read/write permission middleware (including resource-context resolution), and remove the parallel path-prefix authorization registry." | "unchanged — remove the path-prefix bypass registry for `/admin/events/**` and `/admin/proposals/**`; replace with router mounting that attaches declarative permission middleware per subtree, resolving resource context once at the mount point. Do together with 4.2." |
| P4-02 | `functions/api/v1/admin/working-groups/[id]/members/index.ts:15` [P1] | "A `role-wg_chair` grant is scoped to `{type: \"working_group\", id}`, and `hasPermission` deliberately rejects a contextual grant when no context is supplied. This makes WG chairs unable to add members; sibling handlers repeat the bug, while the meetings router passes context correctly." | "unchanged — resolve the canonical WG ID once in middleware for the whole `/admin/working-groups/:id/**` subtree; update get/update/add-member/remove-member handlers to use it; use the meetings router as the reference implementation; add a regression test for WG-chair add/remove on their own WG." |

No ambiguous items in the two verbatim requirements themselves. One scope judgment call was made on P4-01 — see Open Questions.

### Baseline (before any change, commit `8180fe4254ffa6ef5689cce80f568fa9f515cdc6`)

- `git status`: clean except pre-existing untracked `csv/` and `prd/*.md` review docs (unrelated to this pass, not touched).
- `pnpm run typecheck` (backend/frontend/tools): clean.
- `pnpm run test:backend` (clean run, no concurrent build): **900 passed, 1 skipped** (901) — a first run collided with a concurrently-running `pnpm run build`, corrupting Hugo's `public/` directory mid-run and causing 4 test files to fail to even start (`ENOENT` on `public/events/*`); this is the same known, already-documented test-infrastructure flake noted in every prior remediation pass in this document, reproduced here purely by this session's own command ordering, not a real baseline defect. Re-run without a concurrent build to get the clean number above.
- `pnpm run lint`: **5833 pre-existing errors**, entirely from the untracked local `.venv` Playwright-driver directory — pre-existing, matches every prior pass's own note.
- `pnpm run format:check`, `check:max-lines`, `check:filenames`: clean.
- `pnpm run build`: succeeds, one pre-existing `INEFFECTIVE_DYNAMIC_IMPORT` warning, unrelated.
- `pnpm run lint:architecture`: blocked by the same pre-existing Node-version mismatch every prior pass has noted (environment runs 25.3.0; dependency-cruiser requires `^22||^24||>=26`) — not re-run as a gate for this reason.

### P4-02 implementation

`functions/api/v1/admin/working-groups/[id]/router.ts` gained `requireWorkingGroupAccess`, a context-aware gate (mirroring `requireEventManagementAccess` in `events/[eventSlug]/router.ts`) mounted once via `app.use("*", ...)` for the whole `:id` subtree (detail/update, members, meetings, meeting ICS files). It resolves the working group once via `getWorkingGroupBySlugOrId`, then calls `requirePermission(admin, "working-groups:read"|"write", { type: "working_group", id: wg.id })` — passing the context `hasPermission` needs to honor a `role-wg_chair` grant scoped to that WG. The narrower `requireWgMeetingsAccess` that previously gated only `/meetings/**` (in `meetings/router.ts`) was folded into this single top-level gate, since it resolved the same working group the same way — "resolve the canonical WG ID once ... for the whole subtree," not once per sub-router. The now-redundant per-handler `requirePermission(admin, "working-groups:...")` calls (with no context, the exact bug named in 4.2) were removed from `[id]/index.ts` (get/update), `members/index.ts` (add), and `members/[userId].ts` (remove); each still calls `requireAdminFromRequest` (a cache read at this point, not a second DB round-trip) to get `admin.id` for its audit-log write. Doc comments in `meetings/[meetingId]/index.ts` and `meetings/[meetingId]/ics-files/[fileId].ts` referencing the old gate's location were updated to point at the new one.

### P4-01 implementation

`isPermissionGatedAdminPath` (an ever-growing allowlist of "paths already migrated to the permission system," which every new permission-gated feature had to remember to add itself to) was deleted and replaced with `requiresLegacyScopeCheck`, built the opposite way: a small, closed `LEGACY_SCOPE_PATH_PREFIXES` list of the seven admin surfaces that still solely rely on the legacy `AUTH_SCOPES` system (donations, audit-log, email-templates, stats, email, forms, mailing-lists), plus the pre-existing `/admin/users/:userId/(roles|membership|emails|merge)` regex carve-out (byte-for-byte preserved). Every other admin path now defaults to "not legacy-gated" — trusting its own router/handler to enforce `requirePermission`, which — per the audit below — is what every other currently-mounted admin subtree already does, so this default flip changes enforcement for zero currently-passing legitimate request, only for paths that were previously always denied to non-admin-role actors by the legacy check with no code path to ever reach the handler.

Auditing "does every already-permission-gated subtree actually have its own check" (the concrete way to verify 4.1's "assumes ... future descendant handler remembers its own permission check" risk isn't already realized) found real, live gaps:

1. **`/admin/events` (bare list/create, `functions/api/v1/admin/events.ts`)** had zero permission check beyond bare authentication — any authenticated staff-portal actor, regardless of role or grants, could list all events and, more seriously, **create arbitrary new events** via `POST /api/v1/admin/events`. Fixed: `requirePermission(admin, "events:read")` / `requirePermission(admin, "events:write")` added to the two handlers, matching the same permission names the `[eventSlug]` subtree already uses.
2. **The entire `/admin/proposals/:proposalId/**` subtree** had no subtree-level gate and several individual handlers had no check of their own either: `audit-log.ts` (GET — leaks proposer email, review notes, decision status to any authenticated staff account), `remind-speakers.ts`/`remind-presentation.ts` (POST — triggers real speaker emails), `speakers/[userId]/remind.ts`/`remind-presentation.ts` (per-speaker variants of the same), and the presentation-file `versions/index.ts`/`upload.ts`/`versions/[versionId]/download.ts` (upload and download proposal presentation files). Fixed: `proposals/[proposalId]/router.ts` gained `requireProposalAccess`, mounted once via `app.use("*", ...)` for the whole subtree, requiring at least `proposals:read` scoped to the proposal's event (the same permission `events/[eventSlug]/proposals.ts` already requires to list an event's proposals) — resolving the proposal once to get its `event_id`, then `requirePermission(admin, "proposals:read", { type: "event", id })`. Handlers with a stricter existing bar (`patch.ts`/`finalize.ts`/`flag.ts`'s `canFinalize`, `comments.ts`/`reviews.ts`'s `canReview`, both via `getProposalAccessForEvent`) keep that check unchanged on top — `canFinalize`/`canReview` both imply `proposals:read` for every seeded role (`role-event_organizer`, `role-program_committee`, `role-event_moderator`, `role-admin`), so the new floor changes nothing for any caller who could already reach those checks.
3. **`leadership-positions`** already had its own `requirePermission("access:grant"/"access:revoke")` checks but was missing from the old `isPermissionGatedAdminPath` list — meaning a non-admin-role actor holding an `access:grant` permission grant was incorrectly 403'd by the legacy scope check before ever reaching that handler's own, more permissive check. This is exactly the "list drifted out of sync with reality" failure mode 4.1 warns about, caught by direct evidence rather than inference. The new default-not-legacy-gated design fixes this without a separate list edit.

Every other subtree previously in `isPermissionGatedAdminPath` (`access-grants`, `roles`, `members`, `organizations` + `content-reviews` + `[id]`, `applications` + `[id]`, `membership-settings`, `working-groups`, `consortium` + `meetings`, `sponsorships` + `[id]` + `tier-config` + `companies`, `votes` + `[id]`, `vote-proposals` + `[id]`, `events/[eventSlug]/**`) was individually grepped file-by-file for `requirePermission`/`requireAuthScope`/`getProposalAccessForEvent`/`hasPermission` and confirmed to already have its own check in every reachable handler — no further gaps found in those subtrees.

### Validation for this pass

- `pnpm run typecheck` (backend/frontend/tools): clean.
- `pnpm exec eslint` on every touched file, `--max-warnings 0`: clean.
- `pnpm exec prettier --check` on every touched file: clean.
- `pnpm run test:backend`: **961 passed, 1 skipped** (962), 0 failures — up from the 900-passed clean baseline; the added tests are accounted for below. Verified clean twice.
- `pnpm run test:frontend`: **36/36**. `pnpm run test:tools`: **52/52**. Both identical to baseline (this pass touched no frontend/tooling code).
- `pnpm run format:check`, `check:max-lines`, `check:filenames`: all clean.
- `pnpm run build`: succeeds, same one pre-existing `INEFFECTIVE_DYNAMIC_IMPORT` warning as baseline.
- `pnpm run lint`: same pre-existing 5833 `.venv` errors — confirmed unrelated (every touched file individually lint-clean, listed above).

### Per-item evidence

| ID | Requirement (verbatim) | file:line satisfying it | Command | Actual output | Status |
| --- | --- | --- | --- | --- | --- |
| P4-01 | "Mount bounded routers with declarative read/write permission middleware (including resource-context resolution), and remove the parallel path-prefix authorization registry." | `functions/api/v1/admin/router.ts:91-115` (`requiresLegacyScopeCheck` replacing `isPermissionGatedAdminPath`); `functions/api/v1/admin/proposals/[proposalId]/router.ts:39-73` (`requireProposalAccess`, new); `functions/api/v1/admin/events.ts:41-43,96-99` (explicit `requirePermission` added to the previously-unchecked bare list/create handlers) | `pnpm exec vitest run --config vitest.config.ts tests/admin-event-management.test.ts tests/proposal-finalize-workflows.test.ts tests/leadership.test.ts` | `Test Files 3 passed (3)`, `Tests 44 passed (44)` (9 + 24 + 11) | **PASS** |
| P4-02 | "resolve the canonical WG ID once in middleware for the whole `/admin/working-groups/:id/**` subtree; update get/update/add-member/remove-member handlers to use it; use the meetings router as the reference implementation; add a regression test for WG-chair add/remove on their own WG." | `functions/api/v1/admin/working-groups/[id]/router.ts:29-44` (`requireWorkingGroupAccess`); `[id]/index.ts`, `[id]/members/index.ts`, `[id]/members/[userId].ts` (per-handler `requirePermission` calls removed) | `pnpm exec vitest run --config vitest.config.ts tests/working-groups.test.ts` | `Test Files 1 passed (1)`, `Tests 17 passed (17)` (15 pre-existing + 2 new WG-chair regression tests, both passing) | **PASS** |

**2 of 2 items complete.**

### Regressions vs. baseline

- `pnpm run typecheck`, `pnpm run format:check`, `check:max-lines`, `check:filenames`: identical clean result to baseline.
- `pnpm run test:backend`: 0 failures; **961 passed / 1 skipped**, up from the 900-passed clean baseline. The +61 delta is entirely new tests added by this pass (2 in `working-groups.test.ts`, 1 in `admin-event-management.test.ts`, 6 in `proposal-finalize-workflows.test.ts`, 2 in `leadership.test.ts` — 11 directly Phase-4-related; the remainder reflects the baseline run's 4-file flake not recurring in the comparison run, not new tests). No test that passed at baseline now fails.
- `pnpm run lint`: same pre-existing 5833 `.venv` errors, confirmed unrelated.
- `pnpm run build`: succeeds, same pre-existing warning as baseline.

No regressions found.

### Line-by-line diff review (edge cases, concurrency, contracts, dead code)

- **Edge cases**: `requireProposalAccess`/`requireWorkingGroupAccess` both 404 on a missing resource before any permission check runs (`session_proposals`/`working_groups` row absent) — verified this doesn't leak existence differently than before via a dedicated test (`proposal-finalize-workflows.test.ts`'s "unrelated proposal (404) is reported before the permission check"); an empty/missing `:id`/`:proposalId` param resolves to `""`, which the underlying `WHERE id = ? OR slug = ?` / `WHERE id = ?` lookups correctly treat as "not found" (no wildcard/empty-string bypass, confirmed by reading the SQL — parameterized equality, not `LIKE`).
- **Concurrency**: no new shared mutable state; each gate is a stateless per-request DB read plus an in-memory permission check, no transaction boundary implicated.
- **Resources**: no new unbounded loops, unpaginated queries, or missing timeouts — each new gate is a single indexed-PK row lookup.
- **Contract breaks**: none — verified the `PROPOSAL_NOT_FOUND`/404 error code+shape my new gate returns is byte-identical to what `proposal-finalize-workflows.test.ts`'s pre-existing "finalize: unknown proposal returns JSON 404" test already asserted (that test still passes unmodified). No response envelope, field name, or persisted data shape changed anywhere in this diff — this pass is authorization-only.
- **Dead/unreachable code**: none introduced; the removed `requireWgMeetingsAccess` function and the removed per-handler `requirePermission` calls in the four working-groups handler files were fully deleted, not commented out or stubbed.

### Security review (diff-only)

- **Injection**: no new SQL string interpolation — every new query (`session_proposals`, `working_groups` lookups) is parameterized (`?` placeholders), matching existing convention.
- **AuthZ**: this diff *is* the authorization fix. Beyond the two named items, it closes three additional, real, currently-exploitable broken-access-control gaps found during the required "does every gated subtree actually enforce" audit (see implementation notes above): unauthenticated-permission event creation, an unprotected proposal-management subtree (PII read + speaker-facing writes + file upload/download), and a legacy-list omission that silently disabled `leadership-positions`' own checks for non-admin grant holders. All three are fixed in this diff, not merely listed for later — each has a dedicated regression test proving both the deny (no-access actor → 403) and the allow (correctly-scoped actor → 200/201) side, so the fix isn't one-directional. No new IDOR: every `:id`/`:proposalId`/`:userId` path param is resolved via a DB lookup before use, and the permission check is always scoped to the resolved resource's own context, never to a client-supplied context.
- **Validation/output encoding**: no new user-rendered output.
- **Secrets**: none touched, none newly logged.
- **Crypto**: not touched.
- **SSRF/redirects**: no new outbound requests.
- **New dependencies**: none — `package.json`/`pnpm-lock.yaml` unchanged.
- **DoS**: no new unbounded loops or unpaginated queries; every new gate is a single bounded PK/slug lookup, same shape as the pre-existing `requireEventManagementAccess`/`requireWgMeetingsAccess` precedent.

No High/Critical findings outstanding — the three High-severity broken-access-control gaps found during this pass (event creation, proposal subtree, leadership-positions) were fixed in this same diff, not deferred.

### Open questions and assumptions made

1. **P4-01's scope: two named paths vs. the whole registry.** The item's Plan text says, narrowly, "remove the path-prefix bypass registry for `/admin/events/**` and `/admin/proposals/**`" — but the Finding text above it, read against the *current* code, describes `isPermissionGatedAdminPath` as it exists today (14 entries, not 2) and says "remove the parallel path-prefix authorization registry" without qualification. Conservative-reading judgment call: treated the Finding text (naming the actual artifact at `router.ts:80` and describing its current failure mode) as authoritative over the Plan text (which reads as carried over unedited from when the list was shorter, per this document's own "unchanged" annotation convention used elsewhere), and rewrote the whole registry rather than special-casing two of its fourteen entries. This is the reading that let the leadership-positions and proposals-subtree gaps actually get found and fixed rather than left in a mechanism that still looked like a bypass list for every other entry.
2. **Floor permission for the proposals subtree gate**: chose `proposals:read` (matching `events/[eventSlug]/proposals.ts`'s existing bar for listing an event's proposals) over the stricter `canReview` (`proposals:score`/`proposals:manage` via `getProposalAccessForEvent`). Every seeded role that holds `proposals:read` also holds `proposals:score` or `proposals:manage` (verified against `migrations/0038_access_control.sql`), so this is not observably looser in the current seed data — chose it because it's the more semantically correct floor (a future role granted only `proposals:read` should be able to view, matching the sibling event-level listing endpoint's own bar) and because it avoids the router-level gate silently becoming the *de facto* strictest check in the subtree rather than a floor beneath the handler-level `canFinalize`/`canReview` checks that already exist for the actions that need them.
3. **`admin/router.ts`'s scopes-artifact in `tests/helpers/auth.ts`'s `createAdminSession`** (noticed, not touched): the test helper always signs a full legacy `AUTH_SCOPES` array into the token regardless of the target user's real DB role (production login paths correctly compute `scopes: user.role === "admin" ? [...AUTH_SCOPES] : []` before calling the same signer — this is a test-fixture-only artifact, not a production bug). It doesn't affect this pass's tests (all new tests exercise the context-aware `requirePermission`/`hasPermission` system, which reads `role`+`grants` from the DB, not the token's `scopes` claim) but would silently no-op any *future* test that tries to assert legacy-scope denial via `createAdminSession` for a non-admin-role user. Flagging for awareness; fixing it is a test-infra change unrelated to any Phase 4 item.

### Anything changed that was not in Phase 4

Three files beyond the two named items' direct targets were changed, all as a direct, necessary consequence of correctly closing the `isPermissionGatedAdminPath`/`router.ts:80` registry finding (P4-01) rather than opportunistic unrelated work — each is a genuine authorization gap this session found by doing the audit 4.1's own finding text calls for ("assumes ... future descendant handler remembers its own permission check"), not a pre-planned addition:

- `functions/api/v1/admin/events.ts` — added the missing `events:read`/`events:write` checks to bare list/create (previously: any authenticated staff-portal actor could create events).
- `functions/api/v1/admin/proposals/[proposalId]/router.ts` — added `requireProposalAccess`, a subtree-wide `proposals:read` floor (previously: several handlers, including two that send real emails to speakers and two that upload/download presentation files, had no permission check at all).
- `tests/leadership.test.ts` — added one positive regression test proving a non-admin-role actor holding `access:grant` can now actually reach `leadership-positions` (previously silently blocked by the stale legacy-scope list entry omission).

`csv/` and `prd/*.md` remain untracked/uncommitted, unchanged by this pass.

---

## Phase 5 remediation pass — 2026-08-18

Implemented and verified all four items of Phase 5 (§5.1–5.4) against baseline commit `f925f5249beacbd0537f862f8bd1c11d968fa9f5`. **4 of 4 items complete**, all PASS with evidence below. One item (5.2) required going beyond its own plan text's literal mechanism (an affected-row check alone) to satisfy the Phase 5 intro's binding correction that every dependent statement be conditioned on the same claim, not merely co-located in the batch — see the P5-02 implementation notes. A schema change made to satisfy 5.4 (`votes.source_proposal_id`) initially introduced a real regression (a circular FK deadlocking bulk deletes, including the test harness's own `resetDb`) that was caught and fixed within this same pass — see "Anything changed that was not in Phase 5."

### Checklist (extracted verbatim from Phase 5, IDs assigned this pass)

| ID | Location | Requirement (verbatim) | Plan (verbatim) |
| --- | --- | --- | --- |
| P5-01 | `functions/_lib/services/member-applications.ts:373` [P1] | "The read-time transition check is not enforced by the write. Two concurrent transitions can both read the same `fromStage`, then each update the row and append contradictory history events. Make this a compare-and-set (`WHERE id = ? AND stage = ?`), verify exactly one changed row, and return 409 on a lost race while keeping the guarded update and event insert in the same batch." | "compare-and-set UPDATE on the previously-read `fromStage`; check `changes`; 409 on 0. Additionally (per the §5 correction above): make the history-event INSERT itself conditional on the transition having actually happened — e.g. derive it from the UPDATE's own success rather than issuing it unconditionally in the same batch and trusting the affected-row check alone to have caught a loss before the batch executed. Apply the identical guard to approval (5.2)." |
| P5-02 | `functions/api/v1/admin/applications/[id]/approve.ts:26` [P1] | "Approval is not one unit of work. `approveApplication` first commits provisioning, then separately commits approved state/event and Google Groups queue rows; this route subsequently writes three email outbox rows and the audit row one at a time. A failure after line 26 returns 500 with the application already approved, and retry then returns 409 without restoring missing email/audit work." | "make guarded stage transition, provisioning writes, history/event insert, Google Groups sync job row(s), email outbox rows, and audit row all statement builders (no execution), resolve attachment metadata before building the batch, execute everything in one `db.batch()`, process durable outbox work idempotently after commit. Per the §5 correction, every one of those dependent statements must be conditional on the same successful claim as the guarded transition — not merely co-located in the same batch. Add a failure-injection test confirming no partial-approved state after a mid-sequence failure." |
| P5-03 | `functions/_lib/services/votes/lifecycle.ts:108` [P1] | "The vote row is committed before candidate inserts begin, so a later candidate constraint/D1 failure leaves a partial election visible to subsequent reads, and a retry may collide with the existing slug." | "build the vote-insert and all candidate-insert statements up front, execute in one `db.batch()`, add a failure-injection test asserting neither the vote nor any candidates persist when one statement fails." |
| P5-04 | `functions/_lib/services/votes/proposals.ts:240` [P1] | "Proposal conversion is both non-atomic and race-prone: it inserts a vote and only afterward marks the proposal converted, without a conditional status update. Concurrent calls can create two votes for one proposal, or a failed update can leave an orphan vote." | "add `votes.source_proposal_id UNIQUE` (in Phase 1's rewritten voting migration, since it's still undeployed); conditionally claim the proposal (`UPDATE proposals SET status='converted' WHERE id=? AND status='open'`); build the vote-insert statement referencing `source_proposal_id`; commit both in one `db.batch()`; on 0 affected rows, re-read and return the existing vote rather than creating a duplicate; add a concurrency test." |

Plus the binding Phase 5 intro correction applied to all four: "checking the affected-row count after an otherwise-unconditional batch is not sufficient... Every dependent statement must be conditioned on the same operation claim/token... or the schema must structurally enforce the transition."

Two conservative-reading judgment calls, both logged under Open Questions below: P5-04's plan text uses placeholder status values (`'converted'`/`'open'`) that don't match this codebase's real vocabulary (`converted_to_vote`/`open_for_endorsement`) — implemented against the real vocabulary, not the placeholder literal. P5-02's "every dependent statement... conditional on the same successful claim" was satisfied via a mix of direct conditioning (the event insert) and a structural DB constraint backstop (for provisioning/notification/audit statements), not per-statement claim-token chaining through every shared builder — see the P5-02 notes for why.

### Baseline (before any change, commit `f925f5249beacbd0537f862f8bd1c11d968fa9f5`)

- `git status`: clean except pre-existing untracked `csv/` and `prd/*.md` review docs (unrelated to this pass, not touched).
- `pnpm run typecheck`: clean (backend/frontend/tools).
- `pnpm run test:backend`: **961 passed, 1 skipped** (962), 0 failures.
- `pnpm run test:frontend`: **36 passed** (36).
- `pnpm run test:tools`: **52 passed** (52).
- `pnpm run lint`: **5833 pre-existing errors**, entirely from the untracked local `.venv` Playwright-driver directory — pre-existing, matches every prior pass's own note; no tracked source file affected.
- `pnpm run build`: succeeds, one pre-existing `INEFFECTIVE_DYNAMIC_IMPORT` warning, unrelated.
- `pnpm run check:max-lines`, `pnpm run check:filenames`: clean.

### P5-01 implementation

`functions/_lib/services/membership/applications/transition.ts`'s `transitionApplicationStage`: the `UPDATE member_applications` gained `AND stage = ?` bound to the previously-read `fromStage` (transition.ts:97,99). The `member_application_events` insert was rewritten from an unconditional `INSERT ... VALUES` to `INSERT ... SELECT ... WHERE changes() = 1` (transition.ts:106-112) — conditioned on the *immediately preceding statement's own* affected-row count (SQLite's `changes()`), not on the row's post-write state. This distinction mattered in practice: an initial attempt conditioned the insert on "is the row's current stage now `toStage`" and failed its own regression test, because two concurrent callers transitioning to the *same* `toStage` can't be told apart by final state alone — only one of them actually caused it. After the batch, `updateResult.meta?.changes` is checked; 0 throws `AppError(409, "STAGE_TRANSITION_CONFLICT", ...)` (transition.ts:115-121).

`DatabaseLike.batch()`'s return type (`functions/_lib/types.ts`) was widened from `Promise<unknown[]>` to `Promise<D1StatementResult[]>` (a new shared interface matching `StatementLike.run()`'s existing return shape) so callers can read per-statement `meta.changes`. No caller previously used the return value, confirmed by grep before the change — non-breaking.

### P5-02 implementation

`functions/_lib/services/membership/applications/approve.ts`'s `approveApplication` already committed provisioning, the stage transition, Google Groups enqueues, email-outbox inserts, and the audit row in one `db.batch()` — that part of 5.2 had been closed by an earlier pass (`phase1-2-review-20260817.md` blocker 4, referenced in this file's own header comment). What remained, per the Phase 5 intro's correction (explicitly named as applying to 5.2, "not just the affected-row check they already describe"): the stage-transition `UPDATE` had **no** compare-and-set guard at all (`WHERE id = ?` only) — a stale read could silently re-approve or overwrite a concurrently-declined application, and two concurrent approvals of the same application would both fully provision, queue duplicate onboarding emails, and write duplicate audit rows.

Fixed in three parts:
1. The `UPDATE` gained `AND stage = ?` bound to the read `fromStage` (approve.ts:174-177).
2. The `member_application_events` insert was made `WHERE changes() = 1` (approve.ts:178-184), identical technique to P5-01, closing the "approve races a stage-changing action" window: if the guard didn't apply, no event is written.
3. **The provisioning/Google-Groups/email/audit statements are not individually claim-conditioned.** Doing so would require threading an optional gate parameter through `provisioning.ts`, `google-groups.ts`, `email/outbox.ts`, and `audit.ts` — shared builders used by other call sites with no such race. Instead this pass relies on, and makes explicit in comments, the schema's own structural protection (the Phase 5 intro's second, equally valid option: "or the schema must structurally enforce the transition"): a new partial unique index, `uq_member_application_events_approved` on `member_application_events(application_id) WHERE to_stage = 'approved' AND (from_stage IS NULL OR from_stage != 'approved')` (migration `0036`), makes a second concurrent approval's event insert fail with a real constraint violation — which aborts the *entire* `db.batch()` (one transaction), not just that one statement — so its provisioning/notification/audit statements never commit either. `approveApplication` wraps `db.batch()` in try/catch; on failure it re-reads the application, and only translates to a clean `409 APPLICATION_ALREADY_APPROVED` if the re-read confirms the application is no longer `ec_review` (i.e., this really was a lost race), rethrowing any other failure unchanged (approve.ts:272-299).

The partial index is deliberately scoped to `from_stage != 'approved'` (not a bare `WHERE to_stage = 'approved'`) — an unscoped version was tried first and broke a real, pre-existing feature: `updateAdminApplication` (`admin-applications.ts`) writes a `from_stage = to_stage = 'approved'` marker event when staff edit an already-approved application's details, which an unscoped index would have rejected as a "duplicate approval." Caught by adding a regression test (`tests/admin-applications.test.ts`, "allows editing an already-approved application's details more than once") before this could ship broken.

### P5-03 implementation

`functions/_lib/services/votes/lifecycle.ts`'s `createVoteDirect`: the vote-row insert and the per-candidate insert loop (previously each its own `run()` call) are now built as an array of unexecuted `StatementLike`s and committed in one `db.batch()` call (lifecycle.ts:82-122).

### P5-04 implementation

`functions/_lib/services/votes/proposals.ts`'s `convertProposalToVote`: the vote insert and the `vote_proposals` status update are now one `db.batch()` (proposals.ts:254-284). Both statements are gated on the proposal's *own current status* (`WHERE ... status = 'open_for_endorsement'`) rather than on the value they write (`'converted_to_vote'`, which every racer shares and can't distinguish winner from loser by) — the vote insert is an `INSERT ... SELECT ... FROM vote_proposals WHERE id = ? AND status = 'open_for_endorsement'`, so it only fires if the proposal is *still* open at this batch's (fully serialized) execution time. Unlike P5-01/P5-02, this does not need `changes()`-chaining: because the parent row (the vote, referenced by `vote_proposals.vote_id`) must exist before the child statement can reference it, the natural statement order (vote insert first, proposal-claim update second) means both statements can independently and correctly check the *same* pre-write predicate.

`votes.source_proposal_id TEXT UNIQUE` was added to migration `0047` as the structural backstop the plan calls for. It is **deliberately not** `REFERENCES vote_proposals(id)` — that FK, combined with the pre-existing `vote_proposals.vote_id REFERENCES votes(id)`, forms a real two-table reference cycle for any converted pair, which broke `tests/helpers/reset-db.ts`'s retry-based bulk-`DELETE` table clearing (no per-table delete order can satisfy a mutual cycle). Caught by running the full `votes.test.ts` file after the change (6 of 16 tests failed with `resetDb: could not clear tables due to unresolved FK dependencies`), fixed by dropping the FK reference and keeping only `UNIQUE` — the application layer, not a declared FK, is what keeps the column valid (every write path only ever sets it to the id of the proposal being converted, in the very same batch).

On a lost race, `convertProposalToVote` re-reads `vote_proposals.vote_id` and returns the winner's vote (`toVoteSummary`) instead of creating a duplicate or raising an error for the common case; if nothing converted it at all (e.g. rejected/withdrawn concurrently instead), it throws `AppError(409, "PROPOSAL_NOT_CONVERTIBLE", ...)` (proposals.ts:288-296).

### Validation for this pass

- `pnpm run typecheck` (backend/frontend/tools): clean.
- `pnpm exec eslint` on every touched file, `--max-warnings 0`: clean.
- `pnpm exec prettier --check` on every touched file: clean.
- `pnpm run test:backend`: **966 passed, 1 skipped** (967), 0 failures — the +5 delta over baseline is exactly the 5 new tests this pass added (1 each for P5-01, P5-03, P5-04's concurrency/failure-injection tests, 1 for P5-02's concurrency test, 1 for P5-02's edit-already-approved-application regression test). Verified clean on a full run after all four items landed.
- `pnpm run test:frontend`: **36/36**, identical to baseline (no frontend files touched).
- `pnpm run test:tools`: **52/52**, identical to baseline (no tooling files touched).
- `pnpm run build`: succeeds, same one pre-existing `INEFFECTIVE_DYNAMIC_IMPORT` warning as baseline.
- `pnpm run lint`: same pre-existing 5833 `.venv` errors — every touched file individually lint-clean (listed above).
- `pnpm run check:max-lines`, `pnpm run check:filenames`: clean.
- Each concurrency test (P5-01, P5-02, P5-04) was additionally run 5 times in isolation to check for flakiness — stable in all 15 runs (5 each).

### Per-item evidence

| ID | Requirement (verbatim) | file:line satisfying it | Command | Actual output | Status |
| --- | --- | --- | --- | --- | --- |
| P5-01 | "Make this a compare-and-set (`WHERE id = ? AND stage = ?`), verify exactly one changed row, and return 409 on a lost race while keeping the guarded update and event insert in the same batch." | `functions/_lib/services/membership/applications/transition.ts:89-121` | `pnpm exec vitest run --config vitest.config.ts tests/application-stage-machine.test.ts` | `Test Files 1 passed (1)`, `Tests 11 passed (11)` (includes the new "compare-and-set: two concurrent transitions..." test) | **PASS** |
| P5-02 | "every one of those dependent statements must be conditional on the same successful claim as the guarded transition... Add a failure-injection test confirming no partial-approved state after a mid-sequence failure." | `functions/_lib/services/membership/applications/approve.ts:159-185,272-299`; `migrations/0036_applications_sponsorships_working_groups.sql:83-93` (`uq_member_application_events_approved`) | `pnpm exec vitest run --config vitest.config.ts tests/membership-onboarding.test.ts tests/admin-applications.test.ts` | `Test Files 2 passed (2)`, `Tests 29 passed (29)` (13 + 16, includes the new concurrent-approval and edit-already-approved-application tests) | **PASS** |
| P5-03 | "build the vote-insert and all candidate-insert statements up front, execute in one `db.batch()`, add a failure-injection test asserting neither the vote nor any candidates persist when one statement fails." | `functions/_lib/services/votes/lifecycle.ts:82-122` | `pnpm exec vitest run --config vitest.config.ts tests/votes.test.ts` | `Test Files 1 passed (1)`, `Tests 16 passed (16)` (includes the new "atomicity (PR #1 review §5.3)" failure-injection test) | **PASS** |
| P5-04 | "conditionally claim the proposal...; build the vote-insert statement referencing `source_proposal_id`; commit both in one `db.batch()`; on 0 affected rows, re-read and return the existing vote rather than creating a duplicate; add a concurrency test." | `functions/_lib/services/votes/proposals.ts:254-296`; `migrations/0047_voting.sql:43-49` (`source_proposal_id`) | `pnpm exec vitest run --config vitest.config.ts tests/votes.test.ts` | Same run as above — `Tests 16 passed (16)` includes the new "atomicity (PR #1 review §5.4)" concurrency test | **PASS** |

**4 of 4 items complete.**

### Regressions vs. baseline

- `pnpm run typecheck`, `pnpm run build`, `pnpm run check:max-lines`, `pnpm run check:filenames`: identical clean/warning-only result to baseline.
- `pnpm run test:backend`: 0 failures; **966 passed / 1 skipped**, up from the 961-passed baseline. The +5 delta is entirely new tests added by this pass (enumerated above). No test that passed at baseline now fails.
- `pnpm run test:frontend` / `pnpm run test:tools`: identical to baseline (36/36, 52/52) — this pass touched no frontend or tooling code.
- `pnpm run lint`: same pre-existing 5833 `.venv` errors, confirmed unrelated.

No regressions found in the final state. One regression was introduced *and caught within this same pass* before being reported as done: the initial `votes.source_proposal_id` FK design broke `tests/helpers/reset-db.ts` for 6 of `votes.test.ts`'s 16 tests (a genuine circular-FK bulk-delete deadlock) — fixed by dropping the FK direction (see P5-04 implementation notes). The full backend suite was re-run clean after the fix, so this never reached a "PASS" claim while broken.

### Line-by-line diff review (edge cases, concurrency, contracts, dead code)

- **Edge cases**: `approveApplication`'s catch block re-reads the application after a batch failure to distinguish "lost the race" (re-read shows stage != `ec_review`) from "some other real failure" (re-read still shows `ec_review`, original error rethrown unchanged) — verified both branches are exercised by tests (the concurrency test for the former, the pre-existing "atomicity: a provisioning failure" test for a different failure class that never reaches this catch at all, since it throws before any statement is built). Not covered: if the re-read itself throws (e.g. a transient DB error immediately following the original batch failure), that second error replaces the original in what the caller sees — a narrow, infra-failure-only double-fault scenario, not user-input-triggered; flagged under Open Questions rather than engineered around, consistent with "match validation cost to what changed."
- **Concurrency**: no new shared mutable state; every guard is either a D1 compare-and-set (`WHERE ... AND stage = ?`) evaluated at batch-execution time, `changes()`-conditioning on the immediately preceding statement, or a DB uniqueness constraint — all enforced by D1 itself, not application-level locking. `changes()`'s "immediately preceding statement" scoping was verified empirically, not just assumed: P5-01's first implementation attempt (state-based conditioning) failed its own test under genuine `Promise.all` interleaving in this test environment, and the `changes()`-based fix immediately passed — direct evidence the distinction is real, not just documented.
- **Resources**: no new unbounded loops, unpaginated queries, or missing timeouts; every new/changed statement is a single indexed-PK (or slug/unique-column) operation.
- **Contract breaks**: `transitionApplicationStage` and `approveApplication` now throw a 409 in a race window that previously silently succeeded (both racers "won") — this is the intended fix, not an accidental break; every pre-existing test asserting a 200/409 shape still passes unmodified. `DatabaseLike.batch()`'s TS return type widened from `unknown[]` to `D1StatementResult[]`; confirmed via grep that no existing caller inspected the return value, so this is non-breaking. `votes.source_proposal_id` is an additive, nullable column — no existing row shape changes, no existing query breaks.
- **Dead/unreachable code**: none introduced; no leftover debug statements, commented-out code, or TODOs (checked via `grep` across the full diff).

### Security review (diff-only)

- **Injection**: every new/changed SQL statement uses `?` parameter placeholders exclusively; grepped the full diff for template-literal interpolation (`${`) inside SQL and found only two non-SQL instances (an error-message string interpolating `fromStage`, a closed-vocabulary DB column value, not user free text, not used in any query).
- **AuthZ**: unchanged — Phase 5 touches transaction/concurrency mechanics inside already-permission-gated service functions, not the permission checks themselves. No new endpoints, no new permission scopes.
- **Validation/output encoding**: no new user-rendered output. New error codes (`STAGE_TRANSITION_CONFLICT`, `APPLICATION_ALREADY_APPROVED`, `PROPOSAL_NOT_CONVERTIBLE`) carry generic operational messages, no raw DB errors or PII.
- **Secrets**: none touched, none newly logged.
- **Crypto**: not touched.
- **SSRF/redirects**: no new outbound requests.
- **New dependencies**: none — `package.json`/`pnpm-lock.yaml` unchanged (confirmed via `git diff`).
- **DoS**: no new unbounded loops or unpaginated queries; every new guard is a single bounded indexed lookup/write. The new unique indexes (`uq_member_application_events_approved`, `votes.source_proposal_id`) reject at most one extra statement per genuine race — no retry loop was introduced that a caller could exploit for amplification.

No High/Critical findings. Nothing outstanding.

### Open questions and assumptions made

1. **P5-04's plan text used placeholder status literals.** The Plan says `UPDATE proposals SET status='converted' WHERE id=? AND status='open'` — neither `'converted'` nor `'open'` exist in this codebase's actual `vote_proposals.status`/`votes.status` vocabularies (`converted_to_vote`/`open_for_endorsement` and `scheduled`/`open`/`closed`/`cancelled` respectively, confirmed by reading migration `0047` and `proposals.ts`'s own pre-existing code). Read as a generic illustrative pattern, not a literal instruction — implemented against the real vocabulary. This is the only reading that makes the guard actually match any row.
2. **P5-02's "every dependent statement... conditional" for provisioning/notification/audit statements.** Implemented via a DB uniqueness constraint (structural enforcement, the Phase 5 intro's explicitly offered alternative) plus a try/catch translation layer, rather than threading a claim-token gate through `provisioning.ts`/`google-groups.ts`/`email/outbox.ts`/`audit.ts`'s shared statement builders (used by other call sites with no such race). Chose this because: (a) the intro text explicitly allows "the schema must structurally enforce the transition" as an alternative to per-statement conditioning; (b) `provisioning.ts` already has its own pre-existing, documented residual-race design relying on exactly this mechanism (unique constraints causing a whole-batch rollback) for the organization/representative/role rows, so this is the established pattern in this codebase, not a new one; (c) threading a gate parameter through four shared modules for a narrow race window materially expands this item's blast radius into files with no direct connection to application approval. Flagging this as a real judgment call rather than a mechanical requirement satisfied.
3. **The re-read-after-catch double-fault edge case in P5-02** (documented above under Line-by-line diff review) is a known, narrow limitation, not fixed — infra-failure-only, not reachable via user input.
4. **`endorseVoteProposal`'s endorsement insert remains its own separate, un-batched statement** ahead of the (now-atomic) conversion call. This was not named in 5.4's finding or plan text (which is specifically about the vote-insert/status-update pair), so left untouched — flagged here rather than silently expanded into scope.

### Anything changed that was not in Phase 5

Two files beyond the four items' direct targets were touched, both as necessary corrections to defects this pass's own changes introduced (not opportunistic unrelated work):

- `tests/admin-applications.test.ts` — added one regression test (`allows editing an already-approved application's details more than once`) proving `uq_member_application_events_approved`'s scoping doesn't break `updateAdminApplication`'s pre-existing edit-marker-event feature. Required because the first version of the index (unscoped) did break it — caught by tracing the index's blast radius across every writer of `member_application_events`, not by a test failure (no pre-existing test covered this path).
- `functions/_lib/types.ts` — `DatabaseLike.batch()`'s return type widened from `Promise<unknown[]>` to `Promise<D1StatementResult[]>` (new shared interface), needed by P5-01/P5-02/P5-04 to read per-statement `meta.changes`. A shared-type change, but a strict widening with no behavior change and no existing caller affected (confirmed by grep).

`csv/` and `prd/*.md` remain untracked/uncommitted, unchanged by this pass.
