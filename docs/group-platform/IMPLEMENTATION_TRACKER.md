# Group Platform Implementation Tracker

Updated: 2026-08-24

Branch: agent/group-centered-portal-architecture-20260824

Target: codex/pr1-remaining-architecture-security-fixes

This is the authoritative progress ledger for the group-centered portal
implementation. A checked item requires current code or validation evidence,
not intent.

## Status vocabulary

- Pending: no implementation evidence yet.
- In progress: partial implementation exists but the requirement is not proven.
- Complete: current code and the listed validation prove the requirement.
- Deferred: deliberately outside this pull request and documented as an
  extension seam, not required behavior.

## 0. Foundation

- [x] Create a fresh ScanDisk worktree from the verified PR3 head.
  Evidence: branch starts at bb22b0e8; original PR3 worktree remains unchanged.
- [x] Verify PR3 head and target on GitHub.
  Evidence: PR3 head bb22b0e8, target migrate-to-rest-endpoints.
- [x] Verify migration 0035 is pending in preview.
  Evidence: Wrangler migration listing on 2026-08-24.
- [x] Verify migration 0035 is pending in production.
  Evidence: Wrangler migration listing on 2026-08-24.
- [x] Record the accepted architecture and data model.
  Evidence: ARCHITECTURE.md and DATA_MODEL.md.
- [x] Create the stacked pull request and keep its description synchronized.
  Evidence: draft PR pkic/dev-pkic.org#7 targets the verified PR3 branch.

## 1. Canonical schema and contracts

Status: In progress

- [x] Replace unreleased working_groups with generic group_types and groups.
- [x] Replace unreleased working_group_members with group_memberships.
- [x] Require one Member capacity per membership row.
- [x] Permit multiple active Member capacities per user and group.
- [x] Add parent hierarchy and governance inheritance configuration.
- [x] Add category eligibility, automatic-enrollment policy, and opt-outs.
- [x] Update context and permission reference data from working_group to group.
- [x] Add required foreign keys and initial access-pattern indexes for the
      schema implemented so far.
- [x] Keep changeable product vocabularies out of new D1 CHECK constraints;
      retain CHECKs only for structural booleans and identity invariants.
- [x] Compose one canonical shared group entity, list query, page response,
      membership mutation, grant, and error contract.
- [ ] Preserve temporary compatibility exports only while callers migrate.
- [x] Prove empty-database migration application.
  Evidence: all 37 migrations, including 207 statements in 0035, applied to
  a fifth independent local D1 state under ScanDisk after group visibility,
  representative provenance, form identity, and optimistic-edit refinements
  on 2026-08-24.
- [ ] Prove production-shaped upgrade fixture application.
- [ ] Prove importers target only the final schema.

## 2. Group membership and governance

Status: In progress

- [x] Implement group creation and update with parent-cycle prevention.
- [x] Implement explicit join using all eligible organizations by default.
- [x] Permit the user to select a non-empty subset of represented organizations.
- [x] Reject individual capacity whenever organization representation exists.
- [x] Implement leave-one-capacity and leave-all behavior.
- [x] Enforce active parent membership before child join.
- [x] End descendants only after the last active parent capacity ends.
- [x] Do not restore descendants when a parent is rejoined.
- [x] Resolve inherited parent leadership recursively.
- [x] Extend inherited leadership with local roles by default.
- [x] Implement safely authorized local-only governance.
- [x] Make roster, hierarchy, and management queries set-based and paginated.
- [ ] Cover multiple capacities, parent loss, alternative capacity, cycles,
      inherited management, local-only management, and concurrent joins.
  Evidence: group-platform.test.ts covers every listed behavior except direct
  cycle and concurrent-join races; the focused group and representation run is
  15/15 passing.

## 3. Organization representatives

Status: In progress

- [ ] Reuse organization_domain_claims as the sole exact domain owner.
- [ ] Record verification evidence for all email identities used in matching.
- [ ] Automatically associate exact verified custom-domain matches.
- [ ] Never automatically associate free, personal, disposable, unclaimed, or
      ambiguous domains.
- [ ] Show a warning for addresses that cannot establish representation.
- [ ] Permit primary and secondary contacts to associate a representative.
- [ ] Permit primary and secondary contacts to remove a representative.
- [ ] Persist a removal block until an authorized contact restores it.
- [x] End all active group capacities for the removed organization atomically.
- [x] Revoke affected organization roles atomically.
- [x] Preserve historical activity and audit evidence.
- [ ] Verify authorization against current representative state on every action.
- [ ] Cover domain normalization, unverified email, claimed-domain collision,
      explicit association, blocking, restoration, and concurrent reconciliation.

## 4. Conditional enrollment and mailing lists

Status: Pending

- [ ] Implement backend-evaluated membership-category eligibility.
- [ ] Keep eligibility distinct from automatic enrollment.
- [ ] Reconcile derived enrollment without overriding explicit opt-outs.
- [ ] Keep automatically enrolled coordination groups top-level and
      non-structural.
- [ ] Support multiple mailing lists per group.
- [ ] Support one optional primary discussion list.
- [ ] Keep group membership and list subscription independent.
- [ ] Reuse the existing preference or unsubscribe model for user overrides.
- [ ] Make Google Groups desired state consume the canonical effective
      subscription projection.
- [ ] Cover category changes, eligibility loss, opt-out persistence, re-entry,
      multiple lists, and idempotent sync.

## 5. Events, meetings, guests, and attendance

Status: Pending

- [ ] Add controlled event profiles and per-event settings.
- [ ] Add one owning group to portal-managed events.
- [ ] Replace unreleased meeting_series with shared event_series.
- [ ] Add authoritative recurring schedule and event occurrences.
- [ ] Generate ICS from series and occurrence state.
- [ ] Remove uploaded ICS as the meeting source of truth.
- [ ] Implement no-registration, optional opt-in, invitation-only, required,
      and permitted public-registration policies.
- [ ] Automatically make ordinary group meetings available only to eligible
      group members.
- [ ] Support external guests scoped to one occurrence by default.
- [ ] Support explicit series-wide guest exceptions.
- [ ] Keep public workshop registration in the shared event-registration flow.
- [ ] Add opaque, hashed, expiring, revocable PKIC join capabilities.
- [ ] Make GET render only; require intentional POST before redirect.
- [ ] Display and snapshot name and affiliation.
- [ ] Reuse existing event terms and consent acceptance logic.
- [ ] Require current-version terms acceptance and reuse it until terms change.
- [ ] Record join confirmation for every occurrence.
- [ ] Keep join-confirmed separate from provider or manually verified attendance.
- [ ] Add provider interfaces without implementing Microsoft Graph or a hosted
      meeting provider.
- [ ] Cover link scanners, forwarding, expiry, revocation, guest identity,
      membership loss, terms changes, repeated joins, and attendance counts.

## 6. Reusable live-editable forms

Status: In progress

- [x] Add placements with owner group, context, audience, and response set.
- [x] Update existing fields in place using stable IDs.
- [x] Insert new fields without replacing existing fields.
- [x] Archive answered fields and options instead of deleting them.
- [ ] Permit labels, descriptions, order, required state, and configuration to
      change after responses exist.
- [x] Reference stable field IDs from new answers.
- [ ] Preserve legacy field-key fallback for unmappable historical answers.
- [x] Stop deleting and recreating the complete field collection on updates.
- [ ] Reuse one form definition across multiple placements.
- [ ] Ensure editing a shared definition affects every placement.
- [ ] Keep filtering, pagination, and statistics in D1 by placement.
- [ ] Cover add, rename, reorder, type/configuration change, removal, historical
      rendering, placement isolation, and concurrent submission versus edit.

## 7. Voting

Status: Pending

- [ ] Replace forum and working-group scope with one owning group.
- [ ] Support controlled per-Member and per-person electorates.
- [ ] Use canonical member_id rather than raw organization_id for Member ballots.
- [ ] Present separate ballots for every eligible represented Member.
- [ ] Require one explicit Member per organizational ballot submission.
- [ ] Permit every active representative to replace the Member ballot.
- [ ] Preserve one effective ballot per vote, Member, and round.
- [ ] Record latest actor and choice on the effective ballot.
- [ ] Record every replacement in the shared audit log.
- [ ] Make the latest authorized pre-close submission effective.
- [ ] Preserve history when a representative is removed.
- [ ] Cover concurrent replacement, close races, multiple organizations,
      representative removal, round changes, and tally correctness.

## 8. Resource ownership and sharing

Status: Pending

- [ ] Add one owner group to every in-scope resource.
- [ ] Define one shared grant transport contract and evaluator.
- [ ] Use FK-backed resource-specific grant tables.
- [ ] Define allowed capabilities once per resource domain.
- [ ] Support form participation and response-viewing as distinct grants.
- [ ] Support event view, registration, attendance, and management grants.
- [ ] Support vote view, participation, result, and management grants.
- [ ] Support mailing-list subscription, posting, moderation, and management.
- [ ] Prevent owner transfer through an ordinary share mutation.
- [ ] Cover grant escalation, revoked grants, inherited leadership, local-only
      governance, and orphan prevention.

## 9. Group-scoped REST API

Status: In progress

- [x] Add canonical /api/v1/groups routes.
- [x] Add nested members and leadership routes.
- [ ] Add nested forms, votes, mailing lists, stats, and audit routes.
- [ ] Add /api/v1/groups/:groupId/meetings/series routes.
- [ ] Add series occurrence, guest, join, and attendance routes.
- [x] Keep routes thin and SQL-free.
- [x] Reuse shared list query and page response contracts for implemented group
      and membership listings.
- [x] Run filters, search, sort, aggregation, and pagination in D1 for
      implemented group and membership listings.
- [x] Add deterministic tie-break sorting for implemented listings.
- [ ] Add mounted Hono/Chanfana tests for validation and middleware.
- [ ] Remove temporary working-group endpoint compatibility before completion
      unless a documented external consumer requires a timed deprecation.

## 10. Unified portal and admin retirement

Status: Pending

- [ ] Make portal authentication identity-based.
- [ ] Gate member actions separately from staff management permissions.
- [ ] Add selected-group context and capability-derived navigation.
- [ ] Reuse views across working group, task force, board, executive council,
      and coordination-group labels.
- [ ] Move group, leadership, meetings, forms, votes, mailing lists, stats, and
      audit management into the portal.
- [ ] Move remaining global management views into the portal.
- [ ] Replace hardcoded admin links in email, OAuth, and due-work paths.
- [ ] Add temporary legacy redirects where needed.
- [ ] Remove the admin shell and its separate navigation.
- [ ] Remove duplicate admin and member session assumptions.
- [ ] Remove legacy admin API routes after canonical consumers migrate.
- [ ] Browser-test member, chair, inherited leader, local-only leader, staff,
      guest, and unauthorized navigation.

## 11. Quality, security, and performance

Status: Pending

- [x] Run focused tests during every implementation round.
- [ ] Run SQL projection lint and architecture lint after backend boundaries move.
- [ ] Run duplication checks and fix new duplication rather than suppress it.
- [ ] Run EXPLAIN QUERY PLAN assertions for all critical list and policy queries.
- [ ] Run migration tests against production-shaped databases.
- [x] Run migration tests against empty databases.
- [ ] Run representative and group authorization security tests.
- [ ] Run join-token, terms, guest, and attendance security tests.
- [ ] Run voting replacement and race tests.
- [ ] Run mutable-form concurrency and historical-integrity tests.
- [ ] Run the complete pnpm run check gate.
- [ ] Run focused Playwright flows while iterating.
- [ ] Run the complete pnpm run test:e2e gate because navigation and portal
      workflows change.
- [ ] Inspect browser rendering for desktop, narrow navigation, keyboard access,
      error, empty, loading, and pagination states.
- [ ] Run a final security diff review and resolve validated findings.
- [ ] Audit every requirement in ARCHITECTURE.md against current evidence.

## 12. Pull-request handoff

Status: Pending

- [ ] Keep the PR description current after every completed phase.
- [ ] Push normal, descriptive commits after every coherent round.
- [ ] Do not force-push routine implementation history.
- [ ] Include migration status and manual application instructions.
- [ ] Include a comprehensive manual-test checklist.
- [ ] Separate automated evidence from manual tests still required.
- [ ] Do not approve the stacked PR automatically.
- [ ] Preserve PR3 and its branch as the rollback/reference point.

## Manual test checklist

The final PR description must include, at minimum:

- join a top-level group for one and multiple represented organizations;
- join and leave a child while retaining and losing parent eligibility;
- manage a child as inherited leadership and as local-only leadership;
- automatic category enrollment, opt-out, and category change;
- domain-based representative association, contact association, block, restore;
- separate voting ballots for two represented organizations and ballot replace;
- ordinary meeting entry without registration;
- opt-in meeting registration;
- single-occurrence guest invitation;
- public workshop registration;
- meeting entry identity, affiliation, terms, scanner-safe POST, and redirect;
- terms-version change and renewed acceptance;
- join-confirmed versus verified-attendance reporting;
- live-edit a form after responses, including rename, add, remove, and reorder;
- reuse one form across placements with isolated response sets;
- share resources with view, participate, response-view, and management variants;
- verify portal navigation for member, chair, parent leader, staff, and guest;
- verify legacy admin redirects and absence of duplicate admin workflows.
