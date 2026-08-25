# Group Platform Implementation Tracker

Updated: 2026-08-25

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
      Evidence: all 37 migrations, including 224 statements in 0035, applied to
      a fresh independent local D1 state under ScanDisk after the authenticated
      group-registration guard on 2026-08-25.
- [x] Prove production-shaped upgrade fixture application.
      Evidence: consolidated-migration-upgrade.test.ts preserves realistic
      pre-0035 rows and verifies stable form-field backfill plus historical-key
      fallback without rebuilding members or organizations. Existing
      registrations and proposals remain intact with deliberately unattributed
      NULL placement IDs rather than a guessed backfill.
- [x] Prove importers target only the final schema.
      Evidence: the member importer now composes the canonical active-capacity
      CTE and writes groups/group_memberships only. Every valid represented
      Member capacity is retained; an active organizational capacity suppresses
      individual participation consistently with runtime joins. Bare roster
      users remain visible for reconciliation but receive no unattributed group
      membership. The synthetic fresh-D1 execution and rerun-idempotency suite
      passes all three cases and explicitly rejects generated references to the
      legacy working_groups and working_group_members tables.

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
- [x] Reject stale group configuration and category-rule replacement batches
      before they can overwrite newer state.
- [x] Revalidate group-management authorization inside the same D1 batch as
      group configuration, category-rule, and leadership mutations.
- [x] Cover multiple capacities, parent loss, alternative capacity, cycles,
      inherited management, local-only management, and concurrent joins.
      Evidence: group-platform.test.ts covers each listed behavior. Direct
      self-parenting and recursive cycles fail with the
      canonical GROUP_HIERARCHY_CYCLE response and roll back their audit rows.
      Concurrent join commands retain one active capacity and one group-joined
      audit record: each operation preallocates candidate membership IDs and the
      shared conditional-audit helper records the mutation only when at least
      one of those exact rows committed. No read-before-write race or duplicate
      compatibility table is introduced. Group configuration and category-rule
      replacement share one integer aggregate revision on groups; stale writes
      return GROUP_CHANGED and roll back the attempted state, audit, and derived
      enrollment changes. Mounted routes preserve and enforce the same revision
      contract for both commands. One canonical SQL authorization-evidence
      evaluator now covers global, exact-context, recursively inherited,
      OAuth-scope-restricted, active-user, and trusted service identities for
      both preflight and transient write guards. Group configuration,
      category-rule, and leadership race tests revoke access between preflight
      and batch execution and prove that state and audit rows roll back. Query
      plans use the bounded user-role and direct-grant indexes without table
      scans or temporary B-trees. Detaching a child requires global management,
      and service leadership writes keep the non-user identity out of users(id)
      foreign keys. The focused group-platform suite passes 20 tests.

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
      one exact verified custom-domain claim a strong automatic association
      signal; free, personal, disposable, unclaimed, and ambiguous domains warn
      and remain fail-closed. The mounted API proves contact-authorized explicit
      association, persistent removal blocks, immediate capacity and role
      revocation, restoration, and shared response contracts.

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
      Evidence so far: event-series-platform.test.ts passes 14 focused tests.
      The entry
      path accepts only HTTPS provider destinations, encrypts them at rest,
      never copies them into audit details, exposes them only after an
      intentional POST, derives identity and affiliation from server state,
      and atomically rechecks token, occurrence, canonical subject eligibility,
      current guest policy, and current-term state in the same D1 batch as the
      join record. Coverage includes scanner-safe GET, expiry, token-issuance
      and join revocation races, guest and member identity tampering, membership
      loss, policy changes, terms changes and races, repeated joins, attendance
      counts, and service-issued guest attribution through the canonical audit.
      Forwarding a user-bound capability remains open because public registered
      attendees do not yet share the member-session eligibility model. All
      migrations replay on a fresh local D1 database. ESLint, formatting, SQL projection, dependency
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

Status: Complete

- [x] Replace forum and working-group scope with one owning group.
- [x] Support controlled per-Member and per-person electorates.
- [x] Use canonical member_id rather than raw organization_id for Member ballots.
- [x] Present separate ballots for every eligible represented Member.
- [x] Require one explicit Member per organizational ballot submission.
- [x] Permit every active representative to replace the Member ballot.
- [x] Preserve one effective ballot per vote, Member, and round.
- [x] Record latest actor and choice on the effective ballot.
- [x] Record every replacement in the shared audit log.
- [x] Make the latest authorized pre-close submission effective.
- [x] Preserve history when a representative is removed.
- [x] Cover concurrent replacement, close races, multiple organizations,
      representative removal, round changes, and tally correctness.
      Evidence: the canonical vote model owns every vote through one group and
      stores organizational ballots against Member capacity. The ballot API
      returns and accepts separate capacities, atomically rechecks current
      representation and group participation, upserts one effective ballot per
      vote, round, and Member, and appends every accepted replacement to the
      shared audit log. Per-person electorates use the same command with a
      distinct uniqueness key. Mounted and direct-service voting tests cover
      multi-organization representatives, explicit capacity selection, latest
      ballot replacement, representative removal, concurrent replacement and
      close races, election rounds, and tally correctness.

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
  - [x] Apply form placement grants to canonical definition, submission, response,
        response-statistics, and management paths.
  - [ ] Apply event grants beyond meeting entry.
    - [x] Apply `view` implications to canonical group-scoped event discovery
          and detail reads.
    - [x] Apply the same `view` implications to recurring-series discovery,
          generated calendars, and occurrence discovery.
          Evidence: one shared event-ID CTE now drives both event and series
          pages. Canonical series, calendar, and occurrence reads require an
          authenticated group context and distinguish owner membership,
          participant grants, and management-class grants without letting
          management imply participation. Mounted tests prove shared access,
          anonymous and wrong-context denial, participant/manager separation,
          immediate grant revocation, and generated calendar and occurrence
          behavior. EXPLAIN assertions cover both page and count statements and
          prove use of `idx_events_owner_profile` and
          `idx_event_group_grants_group`.
    - [x] Apply `register` to the authenticated registration workflow.
          Evidence: the group route accepts only participation fields, derives
          identity and profile data from the verified session, and reuses the
          canonical registration, consent, form-answer, capacity, audit, email,
          calendar, and badge workflow. Group authorization is retained through
          a real foreign key and rechecked by D1 in the registration batch, so
          grant revocation or membership loss cannot race a prepared write.
          Public registration remains available only for explicitly public or
          legacy-open policies; no-registration and group-only profiles fail
          closed. group-event-sharing.test.ts covers identity override rejection,
          immediate authenticated registration, public and ungranted rejection,
          disabled registration, and concurrent grant revocation.
    - [x] Apply `manage_attendance` to attendance discovery and verification
          mutations.
          Evidence: the canonical occurrence-attendance routes accept the
          shared bounded list query and run search, verification filtering,
          sorting, counting, and pagination in D1. The shared resource-grant
          evaluator requires effective management of the owner or exact
          grantee group; `manage` implies `manage_attendance` without implying
          member participation. A transient FK-backed D1 guard rechecks the
          active actor, event ownership or grant, and current local/inherited
          leadership in the same batch as verification and scoped audit.
          group-event-sharing.test.ts proves mounted-route access, capability
          implication, revocation, disabled-user rejection, scoped audit, and
          use of idx_event_occurrence_attendance. The adjacent event-series and
          resource-grant selection passes 22 tests.
    - [x] Apply `manage` to canonical meeting-series, occurrence, guest, and
          access-capability management.
          Evidence: all management commands resolve the selected group through
          one shared exact-capability service and prepend one transient D1
          authorization guard to the protected write and group-scoped audit.
          `manage_attendance` cannot mutate event state. Mounted tests prove
          exact grant implication, wrong-context denial, immediate revocation,
          guest/access management, and rollback when either the grant or local
          leadership is revoked between preflight and batch execution.
          Recurrence materialization inserts up to the bounded limit with one
          `json_each` set operation in the same transaction, replacing partial
          50-statement batches. The focused event suites pass 19 tests and the
          consolidated migration upgrade suite passes two tests.
  - [x] Apply vote grants after the atomic generic voting cutover.
    - [x] Apply `view` implications to canonical group-scoped vote discovery.
          Evidence: the nested vote route reuses the canonical vote summary and
          list-query contracts, while one resource-kind-aware indexed CTE now
          drives both event and vote discovery. D1 performs access filtering,
          text search, status/type filtering, sorting, counting, and pagination.
          Mounted participant and manager tests prove owner and explicitly
          shared access without allowing management to imply participation;
          EXPLAIN assertions prove owner and grantee index use for page and
          count statements.
    - [x] Apply `participate` and `view_results` to canonical vote detail,
          ballot, and result routes.
          Evidence: all three routes bind access to the selected group. Ballot
          eligibility and the final UPSERT constrain the same exact group, so
          access revocation cannot fall through to another membership context.
          The shared member predicates are derived from the canonical grant
          definition and no longer treat leadership-only `manage` as member
          view, participation, or result access. Mounted tests prove owner and
          shared-group ballots, result separation, and manager/member isolation;
          list, detail, and result queries now evaluate live membership or
          management evidence in the same D1 statement that reads protected
          vote data. Inactive owner groups no longer confer access through
          retained membership rows. The portal reuses its existing ballot and
          result components against the nested endpoints.
    - [x] Apply `manage` to canonical vote creation, settings, visibility, and
          raw-ballot routes.
          Evidence: selected-group creation derives the owner from the path and
          strips any caller-supplied owner override. Update, visibility, and
          identifiable-ballot routes require management through that exact
          owner or explicitly managed grantee group. The same exact-context
          evidence is rechecked inside each protected D1 mutation batch, so
          unrelated management authority cannot satisfy a stale or mismatched
          route preflight. Identifiable ballot page and count reads execute in
          the same D1 batch as their live exact-context guard. Global
          compatibility routes reuse the same domain
          create/update/visibility/ballot schemas without duplicating their
          contracts. Mounted and direct-service tests cover path-owned creation,
          wrong-context denial, explicit manage sharing, member denial, and
          raw-ballot isolation.
    - [x] Apply `manage` to canonical vote proposal routes.
          Evidence: the selected-group proposal collection, detail,
          endorsement, withdrawal, approval, and rejection routes derive their
          owner from the path and reuse canonical vote-proposal contracts and
          commands. One D1 read model performs live participant/manager
          authorization, search, status filtering, sorting, counting,
          pagination, endorsement aggregation, and capability projection.
          Exact-group authorization is rechecked inside approval, rejection,
          and conversion batches. Members cannot use staff sessions, managers
          cannot satisfy authorization through another group, inactive groups
          retract member visibility, and management never implies
          participation. One shared validator governs direct creation,
          settings windows, submission, and proposal conversion. Election
          proposals remain disabled until their candidate aggregate is
          modeled, preventing conversion into an unusable election. The focused
          mounted and direct-service suite passes 30 voting tests, including
          invalid contracts, wrong-context access, withdrawals, endorsement
          conversion, manager decisions, authorization races, and indexed D1
          query plans.
    - [x] Apply `manage` to canonical vote lifecycle routes and retract stale
          list/detail capabilities when lifecycle state changes.
          Evidence: one explicit transition resource applies scheduled-to-open,
          open-to-close or next-election-round, and scheduled/open-to-cancel
          through the existing tally engine. Exact selected-group management is
          checked before execution and again inside every D1 write phase;
          compare-and-set revisions and expiring close claims prevent ballots,
          scheduled jobs, and managers from racing the tally. A failed manual
          close releases its exact claim so it cannot strand an otherwise open
          vote. Member `participate` and `view_results` capabilities are now
          projected from both live access and current lifecycle/time state,
          while managers receive explicit available transitions. Cancellation
          persists its reason, removes undelivered notification intents, and
          cancels queued notices. The bulk outbox insert also requires the
          immutable intent to still exist, making concurrent cancellation and
          queueing safe in either serialization order. Focused lifecycle,
          scheduled-job, and notification tests pass 48 cases; all migrations
          replay on isolated D1 and the production-shaped consolidated upgrade
          fixture passes both cases.
          Existing evidence: resource-grants.test.ts, group-enrollment-mailing-lists.test.ts,
          and group-form-sharing.test.ts pass 18 focused grant-consumer tests; the
          broader focused form/grant regression selection passes 20 tests. Four
          resource-specific grant tables retain real resource and group foreign
          keys; one shared service provides idempotent audited creation, exact
          revocation, D1-side search/filter/sort/pagination, and participant versus
          effective-leadership evaluation. Mounted group routes use the same exact
          domain contracts. The tests cover capability implication, escalation,
          immediate revocation, inherited and local-only governance, idempotency,
          owner immutability, validation, orphan prevention, context-bound member
          access, atomic Google Groups desired-state removal, placement-owner
          immutability, group-scoped form discovery and mutation, D1-side answer
          search, immediate revocation, and prevention of generic form endpoints
          bypassing registration, proposal, or application workflows.
          Group-event sharing tests additionally prove context-bound discovery,
          shared flexible links, participant/manager separation, revocation,
          indexed owner/grantee and occurrence-attendance query plans, and atomic
          attendance-management reauthorization. Authenticated group registration
          also proves strict identity binding, registration-policy enforcement,
          and the atomic D1 authorization guard.

## 9. Group-scoped REST API

Status: In progress

- [x] Add canonical /api/v1/groups routes.
- [x] Add nested members and leadership routes.
      Evidence: group leadership now uses only generic group-scoped lead and
      deputy roles, supports multiple local and inherited leaders, and shares
      one effective-leadership SQL definition across administration, digests,
      and authorization. The administration view selects any group type and
      uses the canonical nested routes without N+1 group reads. Historical
      Board and Executive Council positions remain separate non-authorizing
      records with explicit affiliations and dates. Public consortium chairs
      are sourced from the published All Members group; arbitrary private-group
      leadership is not exposed. The canonical core backend suite passes 44
      tests, the expanded backend selection passes 77, and the focused frontend
      suite passes 5. Coverage includes inherited-source rendering, local
      assignment deletion, compatibility routing, canonical public directory
      reads, and fresh-D1 schema use.
- [x] Add the nested vote discovery route.
- [x] Add nested vote detail, ballot, and result routes.
- [x] Add nested vote creation, settings, visibility, and raw-ballot routes.
      Evidence: request bodies extend canonical domain contracts, ownership is
      path-derived, and every resource mutation binds both preflight and atomic
      authorization to the selected group.
- [x] Add nested vote proposal routes.
      Evidence: `/api/v1/groups/:groupId/vote-proposals` and its detail,
      endorsement, withdrawal, approval, and rejection subresources are mounted
      with shared request/response schemas and thin handlers.
- [x] Add the nested vote lifecycle transition route.
      Evidence: `POST /api/v1/groups/:groupId/votes/:voteId/transitions`
      accepts the shared discriminated transition contract and returns the
      canonical vote mutation response plus its applied outcome.
- [ ] Add nested vote statistics routes.
- [ ] Define the group-statistics metric contract, including whether activity
      and engagement are occurrence-, person-, capacity-, or Member-based,
      before exposing a misleading aggregate.
- [x] Add the nested group audit-log route.
      Evidence: the route requires effective local or inherited group
      management and reads exact scope_type/group scope_id rows only. Global,
      proposal, registration, and group audit lists now reuse one filter
      shape, search projection, D1 count/page builder, serializer, and sort
      resolver. The mounted 15-test audit selection covers exact filters,
      search, sorting, pagination, scope isolation, anonymous and unrelated
      manager denial, inherited governance, local-only governance, and
      EXPLAIN-confirmed idx_audit_log_scope use for page and count queries.
- [x] Add nested form definition, submission, response, response-statistics,
      and placement-management routes.
- [x] Add nested group event discovery and detail routes.
- [x] Add nested mailing-list discovery and preference routes.
- [x] Add /api/v1/groups/:groupId/meetings/series routes.
- [x] Add series occurrence, guest, join, and attendance routes.
      Evidence: the mounted router exposes canonical series, occurrence,
      calendar, materialization, guest, access-capability, attendance-list,
      and attendance-verification routes. Series, calendar, and occurrence
      reads now use the same group-context event-resource policy as ordinary
      event discovery; scanner-safe join inspection and confirmation remain
      intentionally token-scoped under /api/v1/meetings.
- [x] Keep routes thin and SQL-free.
- [x] Add one generic `/api/v1/me/groups` self-participation read model.
      Evidence: the shared contract composes the canonical group list filters,
      sorting, and offset page schema; the service evaluates visibility,
      catalog/joined state, category capacity, and structural-parent eligibility
      in D1. A bounded page is enriched with two set-based queries for active
      memberships and every eligible Member capacity, holding the complete read
      to four D1 statements regardless of page size. Mounted tests cover
      authentication, backend search/filter/sort/pagination, multi-organization
      capacity, inactive joined groups, person-level parent eligibility, schema
      validation, and indexed membership lookup.
- [x] Reuse shared list query and page response contracts for implemented
      canonical group listings.
- [x] Run filters, search, sort, aggregation, and pagination in D1 for
      implemented canonical group listings.
- [x] Add deterministic tie-break sorting for implemented listings.
- [ ] Add mounted Hono/Chanfana tests for validation and middleware.
- [ ] Remove temporary working-group endpoint compatibility before completion
      unless a documented external consumer requires a timed deprecation.

## 10. Unified portal and admin retirement

Status: In progress

- [x] Make portal authentication identity-based.
      The neutral `/api/v1/auth/portal/*` flow uses one purpose-bound magic
      link, resolves staff and member eligibility independently, and atomically
      establishes every current capacity. Passkeys follow the same model.
      Staff-only and member-only clients retain their existing cookie/token
      contracts during migration; mixed-identity cookies fail closed.
- [x] Gate member actions separately from staff management permissions.
      Portal session status exposes live capacities, the shell derives its
      navigation from them, and staff-only identities never probe or receive
      access to `/api/v1/me/*`. Those endpoints continue to require a live
      member session; loss of membership removes only that capacity rather
      than locking an otherwise eligible staff identity out.
      Evidence: the expanded mounted authentication matrix covers neutral
      portal magic links, passkeys, purpose isolation, live staff/member
      eligibility, cross-identity rejection and recovery, bearer and cookie
      logout, concurrent link consumption, and atomic D1 rollback. The
      capability-derived frontend test covers staff-only, member-only, and
      dual-capacity navigation, capacity-loss route reconciliation, unknown
      routes, and fragment-only magic-link parsing. Real local browser tests
      cover staff-only, member-only, and dual-capacity magic-link login, token
      removal, sign-out, cross-identity fail-closed behavior, live membership
      loss while staff access remains, desktop and 390x844 rendering, drawer
      overlay behavior, backdrop and Escape dismissal, focus restoration, and
      keyboard activation without console errors. The responsive pass found
      and fixed both a horizontal mobile-root layout and a drawer header hidden
      beneath the site navigation. Route policy, navigation chrome, and route
      composition now have separate focused modules, with eight shared-fixture
      frontend regressions. A complete Codex Security diff review covered all
      21 changed production files; its four findings were fixed in the same
      round and retained as regressions.
- [x] Add selected-group context and capability-derived navigation.
      Evidence: `/api/v1/groups/:groupId/context` resolves one portal identity
      and returns its live `view`, `participate`, and `manage` capabilities from
      canonical membership and inherited-governance services. The shared portal
      route filters its sections from that response: participants receive
      collaboration views without settings or governance controls, while a
      staff-only manager can use the same selected-group route without gaining
      participation. The legacy selected-management URL redirects to the
      canonical group URL. Mounted tests cover an inherited leader, participant,
      and unauthorized outsider; focused frontend tests cover read-only,
      participant, manager, and staff-only navigation.
- [x] Reuse views across working group, task force, board, executive council,
      and coordination-group labels.
      Evidence: selected-group routing and capability filtering use only the
      generic group contract and configured type labels. No route, component,
      or navigation branch selects behavior from a group type key.
- [x] Move self-service participation onto the generic group and
      group-membership contracts without a working-group-only UI context.
      Evidence: the portal consumes `/api/v1/me/groups` without a type filter
      and uses the canonical join/leave commands. One Groups view and focused
      card support every configured group type, display type and structural
      parent context, select all eligible affiliations by default, accept an
      explicit subset, add another represented organization later, remove one
      capacity, and leave all. The former `/working-groups` portal URL redirects
      to `/groups`; the navigation and component no longer preserve a parallel
      working-group concept. Component tests cover every request shape and
      prove the catalog omits the type filter; no client-side eligibility,
      search, sorting, or pagination logic was introduced. The legacy backend
      endpoint remains mounted temporarily only for unmigrated voting callers.
      An authenticated local browser run with synthetic data verified Community,
      Working Group, and Committee cards in the same view, Committee parent
      context, and the legacy hash-route redirect; no preview or production data
      was used.
- [ ] Move group, leadership, meetings, forms, votes, mailing lists, stats, and
      audit management into the portal.
      Current evidence: the selected-group portal owns group settings,
      capacity-aware participant add/remove, local leadership assign/revoke,
      effective inherited-leadership display, meeting-series list/create,
      capability-filtered event and form discovery, member mailing-list
      preferences, and the group-scoped audit view. These collections share
      the same schema-validated server search, sorting, counting, and pagination
      controller as the existing admin lists; the portal never filters a fetched
      page locally. Per-resource capabilities continue to come from the nested
      API responses rather than frontend policy duplication.
      The unreleased duplicate group-leadership panel has been removed from
      the admin application; dated Board and Executive Council positions remain
      there because they are global records rather than group governance.
      Group vote discovery now uses that same controller and renders effective
      per-resource capabilities. Its detail view reuses the existing ballot and
      result components while the nested API binds participation to the
      selected group. Managers can create and edit votes, set result visibility,
      inspect identifiable ballots, and apply lifecycle transitions; participants
      and managers can use the same group-scoped proposal list with only the
      actions advertised by the backend. The duplicate admin Votes navigation
      and components are removed, while the old URL redirects to the portal.
      Group-owned survey and feedback definitions now use one shared authoring
      schema with the legacy admin API and one atomic, live-authorized create or
      update command. Definition ownership remains with the owning group even
      when placement management is shared. The portal and admin contexts now
      reuse the same definition editor, field configuration controls, response
      statistics, answer rendering, submission table, and custom-field widgets.
      Group managers can author owned surveys and feedback forms, edit mutable
      definitions, manage placement availability, submit responses, and inspect
      D1-aggregated statistics and server-paginated responses. A shared-placement
      manager receives placement controls but cannot edit the owner's definition.
      Statistics are loaded only when selected, avoiding an unnecessary D1
      aggregate on every form detail view. Focused frontend regressions cover
      path-owned creation, shared-definition isolation, and placement-scoped
      statistics/list requests; the complete check passes 1,950 backend tests
      (one skipped), 191 frontend tests, and 79 tool tests. Mailing-list
      management, group statistics, complete meeting lifecycle, and resource
      sharing remain open.
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
- [x] Keep filesystem metadata out of generated site inputs and search indexes.
      Evidence: Git ignores AppleDouble metadata, Hugo module mounts exclude it
      from every source component, environment-specific config discovery is
      disabled because the settings are now expressed through portable CLI and
      environment configuration, and one shared pagefind.yml excludes generated
      metadata HTML from both development and production indexing. Two
      consecutive frontend/Hugo builds and a complete Vite/Cloudflare local
      startup pass without parsing or indexing metadata. No
      workstation path or cleanup script is committed.
- [ ] Run EXPLAIN QUERY PLAN assertions for all critical list and policy queries.
      Current evidence: the self-participation catalog asserts use of
      `idx_group_memberships_user_active` for page and count predicates; the
      event and recurring-series page/count assertions prove indexed owner and
      exact grantee-group access through `idx_events_owner_profile` and
      `idx_event_group_grants_group`; organization-contact authorization proves
      indexed representative and contextual-role lookups without a table scan;
      write-time group-join eligibility proves indexed parent membership and
      category-rule lookups without a table scan or temporary B-tree;
      the canonical group projection now uses indexed per-group capacity,
      participant, and child counts instead of materializing aggregate tables
      for every selected-group detail request, while its page-count statement
      omits those projections entirely;
      the broader group architecture selection passes 43 tests.
- [x] Run migration tests against production-shaped databases.
      Evidence: the realistic pre-0035 upgrade scenario passes integrity and
      foreign-key checks without rebuilding members or organizations and
      preserves unattributed historical event-form projections.
- [x] Run migration tests against empty databases.
- [x] Run representative authorization security tests.
      Evidence: the canonical representative-management predicate is reused for
      preflight and an atomic D1 write guard. Race tests revoke an organization
      contact role and demote a staff administrator after preflight but before
      commit; both commands return a bounded conflict and roll back the
      representative change, audit record, notification, and enrollment
      fallout. Association compare-and-set conflicts and an indexed query plan
      are also covered. The focused platform and mounted endpoint selection
      passes 13 tests.
- [ ] Run group authorization security tests.
      Current evidence: group joining reuses the canonical capacity, category,
      parent-membership, and IPR predicates before and inside the D1 batch.
      Race tests deactivate the group and revoke category eligibility after
      preflight; both roll back every selected capacity, audit entry, and
      mailing-list reconciliation. A mounted API-key test also proves service
      identities are not written into user foreign keys. Leave/end commands
      require the exact preflight capacity count at commit time; a stale
      multi-capacity leave rolls back its remaining update, audit, and mailing
      reconciliation with a bounded conflict. Group configuration and
      category-rule replacements reject stale state through the shared
      aggregate revision and compare-and-set audit guard. Group-management,
      leadership, and category-rule authorization races now revoke access
      between preflight and batch execution and prove complete rollback. Voting
      replacement and voting authorization races remain open.
- [x] Run join-token, terms, guest, and attendance security tests.
      Evidence: 14 event-platform tests cover scanner-safe GET, terms reuse and
      replacement, user and guest identity binding, membership loss, expiry,
      guest-policy changes, revocation races at issue and use time, HTTPS-only
      destinations, audit redaction, repeated joins, and verified attendance.
      Both user and guest predicates on the canonical eligibility view have
      explicit D1 query-plan assertions proving indexed subject lookups.
- [ ] Run voting replacement and race tests.
- [x] Run mutable-form concurrency and historical-integrity tests.
- [ ] Run the complete pnpm run check gate.
      Current evidence: the complete gate passes at the current architecture
      checkpoint: 1,926 backend tests pass with one skipped, 183 frontend tests
      pass, and 79 tooling tests pass. Type checks, ESLint, SQL projection,
      dependency architecture, API-contract, zero-duplication, formatting,
      frontend/Hugo builds, max-lines, and filename gates also pass. Keep this
      item open until the final architecture state passes the same complete
      gate.
- [ ] Run focused Playwright flows while iterating.
- [ ] Run the complete pnpm run test:e2e gate because navigation and portal
      workflows change.
- [ ] Inspect browser rendering for desktop, narrow navigation, keyboard access,
      error, empty, loading, and pagination states.
      Current evidence: the identity phase has real-browser desktop rendering,
      390x844 rendering, accessible drawer and keyboard behavior, error-free
      staff/member/dual-capacity login and logout, cross-identity rejection,
      and live-capacity-loss coverage. Empty, loading, pagination, and the
      remaining role/persona matrix are still pending.
- [ ] Run a final security diff review and resolve validated findings.
      Evidence so far: Codex Security scan
      `7f6a9db1-1349-49f6-8ac0-cd9437915ee8` reviewed the complete delegated
      event-management diff and validated three low-severity findings. This
      round fixes plaintext provider URLs in audit details, guest-policy bypass
      on token use, and stale guest-token resurrection; it also enforces the
      policy at invitation time and restricts provider destinations to HTTPS.
      A fresh final diff review remains required after the full architecture is
      implemented.
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
