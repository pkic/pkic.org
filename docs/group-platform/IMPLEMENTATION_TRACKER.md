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
      Evidence: all 37 migrations, including 226 statements in 0035, applied to
      a fourteenth independent local D1 state under ScanDisk after the
      reusable-form refinements on 2026-08-24.
- [x] Prove production-shaped upgrade fixture application.
      Evidence: consolidated-migration-upgrade.test.ts preserves realistic
      pre-0035 rows and verifies stable form-field backfill plus historical-key
      fallback without rebuilding members or organizations. Existing
      registrations and proposals remain intact with deliberately unattributed
      NULL placement IDs rather than a guessed backfill.
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

Status: Complete

- [x] Reuse organization_domain_claims as the sole exact domain owner.
- [x] Record verification evidence for all email identities used in matching.
- [x] Automatically associate exact verified custom-domain matches.
- [x] Never automatically associate free, personal, disposable, unclaimed, or
      ambiguous domains.
- [x] Show a warning for addresses that cannot establish representation.
- [x] Permit primary and secondary contacts to associate a representative.
- [x] Permit primary and secondary contacts to remove a representative.
- [x] Persist a removal block until an authorized contact restores it.
- [x] End all active group capacities for the removed organization atomically.
- [x] Revoke affected organization roles atomically.
- [x] Preserve historical activity and audit evidence.
- [x] Verify authorization against current representative state on every action.
- [x] Cover domain normalization, unverified email, claimed-domain collision,
      explicit association, blocking, restoration, and concurrent reconciliation.
      Evidence: organization-representation-platform.test.ts,
      organization-representation-endpoints.test.ts,
      organization-representatives.test.ts, magic-link-purpose.test.ts, and
      registration-email-change.test.ts pass 40 focused tests. D1 uniqueness makes
      one domain claim authoritative; ambiguous lookup remains fail-closed. The
      mounted API proves contact authorization and shared response contracts.

## 4. Conditional enrollment and mailing lists

Status: Complete

- [x] Implement backend-evaluated membership-category eligibility.
- [x] Keep eligibility distinct from automatic enrollment.
- [x] Reconcile derived enrollment without overriding explicit opt-outs.
- [x] Keep automatically enrolled coordination groups top-level and
      non-structural.
- [x] Support multiple mailing lists per group.
- [x] Support one optional primary discussion list.
- [x] Keep group membership and list subscription independent.
- [x] Store durable per-list subscription preferences as user overrides.
- [x] Make Google Groups desired state consume the canonical effective
      subscription projection.
- [x] Cover category changes, eligibility loss, opt-out persistence, re-entry,
      multiple lists, and idempotent sync.
      Evidence: group-enrollment-mailing-lists.test.ts, group-platform.test.ts,
      mailing-lists.test.ts, and organization-representation-platform.test.ts pass
      27 focused tests. Reconciliation is set-based in D1, shares one active
      capacity CTE, preserves explicit opt-outs and preferences, and only queues
      effective provider-state changes. SQL projection, dependency architecture,
      API-contract, duplication, max-lines, filename, ESLint, and formatting gates
      pass for this round.

## 5. Events, meetings, guests, and attendance

Status: In progress

- [x] Add controlled event profiles and per-event settings.
- [x] Add one owning group to portal-managed events.
- [ ] Replace unreleased meeting_series with shared event_series.
- [x] Add authoritative recurring schedule and event occurrences.
- [x] Generate ICS from series and occurrence state.
- [ ] Remove uploaded ICS as the meeting source of truth.
- [x] Implement no-registration, optional opt-in, invitation-only, required,
      and permitted public-registration policies.
- [x] Automatically make ordinary group meetings available only to eligible
      group members.
- [x] Support external guests scoped to one occurrence by default.
- [x] Support explicit series-wide guest exceptions.
- [x] Keep public workshop registration in the shared event-registration flow.
- [x] Add opaque, hashed, expiring, revocable PKIC join capabilities.
- [x] Make GET render only; require intentional POST before redirect.
- [x] Display and snapshot name and affiliation.
- [x] Reuse existing event terms and consent acceptance logic through one
      authenticated-user/guest acceptance model.
- [x] Require current-version terms acceptance and reuse it until terms change.
- [x] Record join confirmation for every occurrence.
- [x] Keep join-confirmed separate from provider or manually verified attendance.
- [x] Add provider interfaces without implementing Microsoft Graph or a hosted
      meeting provider.
- [ ] Cover link scanners, forwarding, expiry, revocation, guest identity,
      membership loss, terms changes, repeated joins, and attendance counts.
      Evidence so far: event-series-platform.test.ts passes 9 focused tests.
      The entry
      path encrypts provider URLs at rest, exposes them only after an intentional
      POST, derives identity and affiliation from server state, and atomically
      rechecks token, occurrence, eligibility, guest, and current-term state in
      the same D1 batch as the join record. Coverage includes scanner-safe GET,
      expiry, revocation races, guest and member identity tampering, membership
      loss, terms changes and races, repeated joins, and attendance counts.
      Forwarding a user-bound capability remains open because public registered
      attendees do not yet share the member-session eligibility model. All 37
      migrations, including 226 statements in migration 0035, replay on a fresh
      local D1 database. ESLint, formatting, SQL projection, dependency
      architecture, duplication, and max-lines gates pass for this round.
      Legacy meeting-calendar retirement and UI integration remain incomplete.

## 6. Reusable live-editable forms

Status: Complete

- [x] Add placements with owner group, context, audience, and response set.
- [x] Update existing fields in place using stable IDs.
- [x] Insert new fields without replacing existing fields.
- [x] Archive answered fields and options instead of deleting them.
- [x] Permit labels, descriptions, order, required state, and configuration to
      change after responses exist.
- [x] Reference stable field IDs from new answers.
- [x] Preserve legacy field-key fallback for unmappable historical answers.
- [x] Stop deleting and recreating the complete field collection on updates.
- [x] Reuse one form definition across multiple placements.
- [x] Ensure editing a shared definition affects every placement.
- [x] Keep filtering, pagination, and statistics in D1 by placement.
- [x] Cover add, rename, reorder, type/configuration change, removal, historical
      rendering, placement isolation, and concurrent submission versus edit.
      Evidence: form-placements.test.ts and
      form-domain-revision-guards.test.ts prove placement isolation, indexed D1
      filtering, live shared edits, historical rendering, and atomic rollback
      for stale registration/proposal creates and updates. New domain writes
      persist the exact placement and a canonical stable-field-ID submission in
      the same batch; field renames therefore render correctly. Inferred legacy
      rows remain scoped to their own form. Preview and production each report
      zero duplicate domain response contexts for the new uniqueness invariant.
      The forms-only backend run passes 69 tests; the adjacent
      admin-application suite retains five known leadership/voting seam
      failures. Focused frontend rendering passes 7 tests. SQL projection,
      dependency architecture, API-contract, duplication, max-lines, and
      filename gates, ESLint, and formatting pass.

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

Status: In progress

- [x] Add one owner group to every in-scope group-owned resource.
- [x] Define one shared grant transport contract and evaluator.
- [x] Use FK-backed resource-specific grant tables.
- [x] Define allowed capabilities once per resource domain.
- [x] Define capability implications once per resource domain without allowing
      management to imply participation.
- [x] Define form participation and response-viewing as distinct grants on the
      owned placement rather than the reusable definition.
- [x] Define event view, registration, attendance, attendance-management, and
      management grants.
- [x] Define vote view, participation, result, and management grants.
- [x] Define mailing-list view, subscription, posting, moderation, and
      management grants.
- [x] Prevent owner transfer through an ordinary share mutation.
- [x] Cover grant escalation, revoked grants, inherited leadership, local-only
      governance, and orphan prevention.
- [ ] Apply the shared evaluator to every form, event, vote, and mailing-list
      read and mutation path as those canonical group APIs replace legacy
      domain endpoints.
  - [x] Apply `attend` to meeting entry in the Worker read and atomic D1 guard.
  - [x] Apply mailing-list view and subscribe grants to member discovery,
        preference mutation, and provider desired-state reconciliation.
  - [ ] Apply form placement grants to canonical definition, submission, response,
        response-statistics, and management paths.
  - [ ] Apply event grants beyond meeting entry to generic view, registration,
        and attendance-management paths.
  - [ ] Apply vote grants after the atomic generic voting cutover.
      Evidence: resource-grants.test.ts and
      group-enrollment-mailing-lists.test.ts pass 15 focused tests. Four
      resource-specific grant tables retain real resource and group foreign
      keys; one shared service provides idempotent audited creation, exact
      revocation, D1-side search/filter/sort/pagination, and participant versus
      effective-leadership evaluation. Mounted group routes use the same exact
      domain contracts. The tests cover capability implication, escalation,
      immediate revocation, inherited and local-only governance, idempotency,
      owner immutability, validation, orphan prevention, context-bound member
      access, and atomic Google Groups desired-state removal.

## 9. Group-scoped REST API

Status: In progress

- [x] Add canonical /api/v1/groups routes.
- [x] Add nested members and leadership routes.
- [ ] Add nested forms, votes, stats, and audit routes.
- [x] Add nested mailing-list discovery and preference routes.
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
- [x] Run SQL projection lint and architecture lint after backend boundaries move.
- [x] Run duplication checks and fix new duplication rather than suppress it.
- [ ] Run EXPLAIN QUERY PLAN assertions for all critical list and policy queries.
- [x] Run migration tests against production-shaped databases.
      Evidence: the realistic pre-0035 upgrade scenario passes integrity and
      foreign-key checks without rebuilding members or organizations and
      preserves unattributed historical event-form projections.
- [x] Run migration tests against empty databases.
- [ ] Run representative and group authorization security tests.
- [ ] Run join-token, terms, guest, and attendance security tests.
- [ ] Run voting replacement and race tests.
- [x] Run mutable-form concurrency and historical-integrity tests.
- [ ] Run the complete pnpm run check gate.
      Current evidence: the gate was rerun after the reusable-forms slice and
      stops at the known, deliberately unsynchronized leadership/voting
      type-contract cutover. The complete backend run reaches 1,662 passing,
      261 failing, and one skipped test; the failures use removed legacy group,
      meeting, leadership, and vote schema rather than the completed forms
      paths. Do not mark this complete until that migration is authorized and
      all repository-wide gates pass from the final schema.
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
