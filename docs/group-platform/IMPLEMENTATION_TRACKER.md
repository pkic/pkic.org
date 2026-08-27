# Group Platform Implementation Tracker

Updated: 2026-08-27

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
      Evidence: Wrangler migration listing on 2026-08-26.
- [x] Verify migration 0035 is pending in production.
      Evidence: Wrangler migration listing on 2026-08-26.
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
      Current evidence: the unreleased working-group collection contracts and
      routes have been removed. Narrow compatibility exports remain only where
      an existing admin consumer still uses the canonical mailing-list, vote,
      registration, audit, or organization-content implementation; remove each
      export with that consumer rather than creating a second contract.
- [x] Prove empty-database migration application.
      Evidence: all 37 migrations, including 234 commands in 0035, applied to
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
- [x] Require one valid, immutable owner group for every mailing list, including
      consortium-wide coordination and consultation lists.
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
      pass for this round. The pending consolidated migration now creates
      `mailing_lists.group_id` as a required foreign key in its final form; the
      shared create/read contracts are non-null, ordinary updates cannot transfer
      ownership, and mounted validation plus direct D1 tests reject missing,
      invalid, or null owners. The obsolete contradictory admin-only mailing-list
      schema was removed rather than retained as a second contract.

## 5. Events, meetings, guests, and attendance

Status: In progress

- [x] Add controlled event profiles and per-event settings.
      Evidence: active labels and descriptions come from the D1 profile catalog,
      while the shared profile-key contract controls which profiles are valid
      and which are meeting-series-only. The catalog remains controlled
      reference data in this phase: adding a new profile key still requires a
      reviewed schema/code change rather than an unrestricted administrator
      feature-toggle builder.
- [x] Permit explicitly authorized program-committee corrections to an
      accepted proposal abstract without weakening ordinary proposal locks.
      Evidence: `proposals:edit_accepted_abstract` is an event-scoped,
      field-specific permission. The canonical edit service separately requires
      `proposals:manage` for accepted title changes, requires both permissions
      when both fields change, and rechecks the exact permissions and proposal
      revision in the atomic D1 batch. The group-portal route and shared UI are
      tracked as part of the portal-management cutover below.
- [x] Permit explicitly authorized cancellation of an accepted proposal with a
      required reason and notification to its complete speaker roster.
      Evidence: `proposals:cancel_accepted` is event-scoped. The canonical
      command preserves the accepted decision history, changes the operational
      status to canceled, deactivates proposal capacities, cancels obsolete
      queued messages, queues a dedicated notification for every speaker record
      including inactive or declined records, and commits audit and outbox state
      in the same guarded D1 batch. The group-portal route and shared UI are
      tracked as part of the portal-management cutover below.
- [x] Add one owning group to portal-managed events.
- [x] Replace unreleased meeting_series with shared event_series.
- [x] Add authoritative recurring schedule and event occurrences.
- [x] Generate ICS from series and occurrence state.
- [x] Remove uploaded ICS as the meeting source of truth.
      Evidence: the unused multipart upload utility, queued `r2-ics-file`
      descriptor, R2 delivery branch, and dormant welcome-email option are
      removed. Legacy queued descriptors are ignored and cannot trigger an R2
      calendar fetch. Registration invitations still generate their ICS from
      current event/registration state, and group series calendars still render
      from `event_series` and `event_occurrences`; the focused calendar and
      group-event tests cover both generated paths. The separate Hugo conference
      agenda feed remains a generated public-content view, not an uploaded
      meeting source of truth.
- [x] Implement no-registration, optional opt-in, invitation-only, required,
      and permitted public-registration policies.
- [x] Automatically make ordinary group meetings available only to eligible
      group members.
- [x] Support external guests scoped to one occurrence by default.
- [x] Support explicit series-wide guest exceptions.
- [x] Keep public workshop registration in the shared event-registration flow.
- [x] Add rotatable, expiring guest invitation capabilities that authorize only
      browser-bound mailbox verification, never meeting entry by themselves.
- [x] Make administrator-created attendee and speaker invitation validity
      explicitly configurable, defaulting to the event start and never
      extending beyond the event end.
      Evidence: one shared validity contract and effective-expiry SQL expression
      drive creation, resend, bulk replacement, reminder selection, and pending
      counts. Omitted deadlines resolve to the current event start. Legacy null
      or overlong expiries are bounded by the event, and shortening an event
      makes stale invitations logically expired. Duplicate classification and
      the final guarded D1 batch use the same predicate, so replacement cannot
      race with an event schedule or invitation change. Focused service, mounted
      route, query-plan, atomicity, and portal-component regressions are included.
- [ ] Add the same explicit expiry selection to peer co-speaker nominations;
      they currently use the safe event-bounded default but do not expose a
      custom deadline.
- [ ] Define and implement occurrence/event-bounded validity configuration for
      external meeting-guest invitations without weakening their separate
      mailbox verification and occurrence-entry checks.
- [x] Make GET render only; require intentional POST before redirect.
- [x] Display and snapshot name and affiliation.
- [x] Reuse existing event terms and consent acceptance logic through one
      authenticated-user/guest acceptance model.
- [x] Require current-version terms acceptance and reuse it until terms change.
- [x] Record join confirmation for every occurrence.
- [x] Keep join-confirmed separate from provider or manually verified attendance.
- [x] Add provider interfaces without implementing Microsoft Graph or a hosted
      meeting provider.
- [x] Add group-portal management for series settings, recurrence
      materialization, occurrences, encrypted provider destinations, guests,
      join confirmations, and verified attendance.
- [x] Bind member entry to the authenticated portal identity and guest entry to
      a separately verified guest session rather than treating a bearer URL as
      sufficient identity proof.
      Current evidence: member entry is mounted under `/api/v1/me` and derives
      the identity and exact live session server-side. Guest JWTs are a distinct
      token type backed by a one-time browser/mailbox challenge, current
      invitation generation, exact D1 session, and occurrence scope. The
      mounted guest landing and confirmation endpoints reject a valid guest
      session for another occurrence. Public bootstrap and verification routes
      establish that session only after the browser-held secret and separately
      delivered mailbox code match.
- [x] Deliver rotatable guest invitations through the durable outbox and move
      the capability out of the request path before any landing data is read.
      Evidence: guest eligibility, audit, invitation rotation, access
      invalidation, and the secret-bound invitation outbox row commit in one D1
      batch. Challenge creation and its verification-code outbox row commit in
      a second atomic batch. Capability materialization fails after reinvitation
      instead of minting current authority from a stale message.
- [x] Cover link scanners, forwarding, expiry, revocation, guest identity,
      membership loss, terms changes, repeated joins, and attendance counts.
      Evidence so far: meeting-entry-security.test.ts and
      meeting-guest-invitations.test.ts pass 25 focused tests
      covering exact member and guest sessions, browser/code binding, challenge
      replay, occurrence scope, expiry/revocation and policy races, identity
      tampering, membership loss, terms changes, repeated joins, encrypted
      HTTPS-only destinations, and the separation of join confirmation from
      verified attendance. The shared D1 guard rechecks the exact session,
      occurrence, canonical eligibility, current guest policy, and current-term
      state in the confirmation batch. Frontend fragment and authoritative
      identity rendering tests pass. The product-path tests additionally cover
      mocked SendGrid delivery, forwarding without the exact browser cookie,
      wrong codes, replay, stale queued capabilities, fail-closed rate limits,
      invitation-rotation races, pre-verification identity confidentiality,
      and both outbox transaction boundaries. The focused Playwright journey
      passes through the intercepted invitation and code messages in a fresh
      browser context. All 37 migrations replay cleanly in fresh local D1 state,
      and the complete repository gate passes at this checkpoint. Management UI
      integration is implemented, and the dormant uploaded-calendar attachment
      path is retired without removing generated registration or series ICS.

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
  - [x] Apply event grants beyond meeting entry.
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
          disabled registration, and concurrent grant revocation. The selected
          group now also has one schema-validated configuration projection and
          participant form that reuse the canonical attendance-day, dynamic-form,
          and consent components. Group registration resolves only an exact active
          event placement rather than inheriting a global fallback. The protected
          D1 batch rechecks the verified profile snapshot, live membership,
          register grant, portal ownership, exact form revision, and the complete
          active attendee-term snapshot. Adapter-level tests prove complete
          rollback when the grant, membership, ownership, identity, or terms
          change between preflight and commit, and mounted tests cover the
          configuration route's anonymous, inaccessible, view-only, available,
          and lost-ownership states.
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
          consolidated migration upgrade suite passes two tests. Guest and
          attendance list reads now reuse one management-page executor that
          revalidates the exact capability in the same D1 batch as page and
          count queries. Race tests prove revoked grants cannot expose either
          collection, and occurrence/guest EXPLAIN assertions prove indexed
          series-bounded access.
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
- [x] Add nested vote statistics routes.
      Evidence: the manager-only nested statistics resource distinguishes
      people from Member-capacity electorates, computes current eligibility
      and effective-ballot intersections in one guarded D1 batch, and keeps
      historical ballots that no longer have current eligibility explicit
      rather than publishing a misleading turnout percentage. Choice and
      candidate counts remain withheld until close, no identities are returned,
      and the portal loads the aggregate only when a manager requests it.
      Mounted tests cover multi-organization capacities, per-person
      deduplication, historical eligibility changes, motion and election
      aggregates, exact shared-group management, authorization revocation,
      and indexed production queries; focused frontend tests cover lazy loading
      and every aggregate visibility state.
- [x] Define the group-statistics metric contract, including whether activity
      and engagement are occurrence-, person-, capacity-, or Member-based,
      before exposing a misleading aggregate.
      Evidence: `/api/v1/groups/:groupId/stats` explicitly separates distinct
      people from Member-capacity rows, distinguishes current participation
      from historical window overlap, and reports only attributable audited
      actions plus capacity joins/leaves. It does not invent an engagement
      score. UTC window validation is shared by the route and portal, every
      aggregate runs in one D1 batch, service/API-key audit actors are excluded
      from person counts, and exact management authority is rechecked in that
      batch. Mounted tests cover schema validation, role isolation, a
      leadership-revocation race, metric semantics, and indexed query plans.
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
- [x] Add nested group event discovery, detail, profile-catalog, standalone
      create/update, and attendee-list routes.
      Evidence: one live D1 authorization projection drives event list and
      detail capabilities; registration is not advertised for a
      `no_registration` event. Standalone creation derives group ownership from
      the path, uses only active D1 profiles, and is deliberately limited to
      `no_registration` until terms/forms/attendance configuration is moved.
      Settings use optimistic concurrency plus same-batch resource and
      standalone-event guards; meeting profiles and any event attached to a
      series are rejected even when the UI is bypassed. Attendee search,
      filtering, sorting, statistics, counting, and pagination remain in D1
      behind `manage_attendance`.
- [x] Add nested group proposal and speaker-management routes.
      Evidence: proposal discovery/detail, reviews, comments, accepted-abstract
      corrections, cancellation, decisions, audit history, speaker roster,
      profile corrections, removals, reminders, headshots, and Gravatar import
      use the exact owning group/event/proposal tuple. Reads and writes enforce
      their distinct event-scoped permissions, while every write rechecks live
      authority and tuple ownership in the same D1 batch. Neutral contracts and
      reusable proposal/speaker components serve the portal and temporary admin
      adapters. Presentation upload/download remains speaker-capability scoped,
      requires a confirmed speaker on an accepted proposal, and no longer
      returns private R2 storage keys through public presentation contracts.
- [ ] Add canonical group co-speaker invitation/capability management; the
      existing speaker roster management does not yet replace the remaining
      token-based nomination flow.
- [x] Add nested mailing-list discovery, preference, configuration-management,
      and resource-sharing routes.
      Evidence: participant subscription preferences remain a distinct
      projection, while staff-only, local, and inherited managers receive a
      group-owned configuration page and create/update/archive commands.
      Ownership comes from the selected group path and both ownership and live
      management authority are rechecked in the D1 read/write batch. The
      configuration list reuses the canonical D1 search/filter/sort/page
      builder; its actual page and count statements are EXPLAIN-tested.
      The former global admin CRUD route, navigation item, component, sync
      button, and client are removed. A Playwright journey covers a staff-only
      group manager creating, editing, and archiving a list. It asserts
      POST/PATCH/DELETE and management-list GET requests stay under
      `/api/v1/groups/:groupId/mailing-lists` and never call `/api/v1/admin/*`.
      Old bookmarks retain a single redirect to the selected-group portal;
      provider synchronization remains owned by the scheduled service rather
      than an orphaned UI endpoint. A focused frontend test covers that redirect.
      The focused Playwright run passes against the real local Worker, migrated
      D1 state, and intercepted sign-in email.
- [x] Add /api/v1/groups/:groupId/meetings/series routes.
- [x] Add series occurrence, guest, join, and attendance routes.
      Evidence: the mounted router exposes canonical series, occurrence,
      calendar, materialization, guest, attendance-list, and
      attendance-verification routes. Series, calendar, and occurrence reads
      use the same group-context event-resource policy as ordinary event
      discovery. The bearer-only `/api/v1/meetings/join/:token` endpoints and
      manager-issued access-token route were removed. Member and verified-guest
      landing/confirmation, guest bootstrap, and mailbox-challenge verification
      endpoints are mounted at their identity-scoped API boundaries.
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
- [x] Add mounted Hono/Chanfana tests for validation and middleware.
      Evidence: the canonical group context, creation, configuration,
      category-rule, membership, leadership, event, meeting, form, vote,
      mailing-list, statistics, audit, user-catalog, and resource-grant routes
      are exercised through the mounted router. The tests cover schema
      rejection, authentication, capability middleware, stale revisions, and
      authorization changes between request preflight and the D1 batch rather
      than testing services alone.
- [x] Remove temporary working-group endpoint compatibility before completion.
      Evidence: the unreleased /api/v1/working-groups and
      /api/v1/me/working-groups routes, services, contracts, and route-specific
      tests are removed. Generic /api/v1/groups, /api/v1/me/groups, and the
      privacy-bounded public group directory are the only group collection and
      self-service resources.
      The portal retains only its hash-route redirect for existing bookmarks;
      no production client or upstream API depended on the retired endpoints.

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
      search, sorting, or pagination logic was introduced. The unreleased
      working-group backend endpoints have been removed; the last known former
      caller, the public leadership widget, now uses
      the narrow generic `/api/v1/groups/:groupId/directory` projection.
      That public contract exposes no internal counts or eligibility policy and
      does not disclose the identity of a non-public inherited source group.
      An authenticated local browser run with synthetic data verified Community,
      Working Group, and Committee cards in the same view, Committee parent
      context, and the legacy hash-route redirect; no preview or production data
      was used.
- [ ] Move group, leadership, meetings, forms, votes, mailing lists, stats, and
      audit management into the portal.
      Current evidence: the selected-group portal owns group settings,
      capacity-aware participant add/remove, local leadership assign/revoke,
      effective inherited-leadership display, meeting-series and occurrence
      list/create/edit, recurrence materialization, guest and attendance
      management,
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
      Portal membership and leadership selectors no longer cross the global
      admin-user boundary: one group-scoped catalog returns only active users'
      selection fields after required server-side search, enforces an eight-row
      endpoint maximum through the shared pagination contract, and rechecks
      inherited or local group-management authority in the same D1 batch as its
      page and count. The shared picker retains the old admin source only for
      admin workflows that have not migrated, disables browser autofill, and
      uses the common collection URL and latest-request helpers. Mounted and
      frontend tests prove data minimization, alias/name/organization search,
      invalid-query rejection, unrelated and local-only denial, inherited
      leadership, revocation-race closure, deterministic D1 ordering, and that
      portal requests never fall back to `/api/v1/admin/users`.
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
      statistics/list requests; the complete check passes 2,003 backend tests
      (one skipped), 224 frontend tests, and 80 tool tests. Group statistics now
      use a management-only portal view over the explicit people/capacity and
      current/history contract. Mailing-list managers and participants share
      one selected-group section while retaining separate configuration and
      personal-preference projections. One reusable resource-sharing editor
      consumes the shared capability catalogs and canonical grant routes for
      events, form placements, votes, and mailing lists; ownership and manage
      capability determine whether it is rendered, while the API remains the
      authorization authority.
      Standalone event managers now use the same selected-group portal to load
      the active D1 profile catalog, create a no-registration event, edit its
      schedule/location/JSON-backed links and attendee peer-invitation limit,
      inspect attendee data, and manage sharing. The shared event contract
      defines that limit once for portal, admin, and sync consumers; zero
      explicitly disables peer invitations while manager invitations remain a
      separate workflow. Meeting and board-meeting profiles remain series-only
      in both the UI and API. A real Worker/D1 browser journey signs in through
      the portal email capability, creates and edits a workshop, and verifies
      its persisted owner, source mode, registration policy, invite limit, link,
      and location.
      Mailing-list management has equivalent browser coverage for staff-only
      group create/edit/archive, exact group-scoped API paths, no admin API
      fallback. A focused frontend test covers the legacy admin bookmark
      redirect. The old global mailing-list CRUD surface is intentionally
      removed; scheduled Google Groups synchronization remains a backend-owned
      job. The focused Playwright run passes against the real local Worker,
      migrated D1 state, and intercepted sign-in email.
      Eligible participants now register inside that same selected-group event
      detail. The portal derives identity from the verified session, renders an
      exact event form placement with its authored title and instructions,
      attendance-day choices and current required terms, and submits through the
      canonical registration use case. It does not link to or duplicate the
      anonymous public-registration form.
      Event managers now configure attendee, speaker, and presentation terms
      plus optional per-day attendance choices in that selected-group event
      context. One neutral event-configuration schema is shared by the API,
      services, portal, and remaining read-only admin consumers. Every
      replacement rechecks exact event management and standalone-event status
      in the same D1 batch, advances the event revision with compare-and-set,
      records a group-scoped audit entry, and rolls child writes back on a stale
      revision or authorization race. Attendance counts remain D1-aggregated;
      the production query has an indexed no-scan plan. The duplicate admin
      Terms and Days editors, the admin Terms route, and the admin day mutation
      route are removed. A read-only admin day projection remains temporarily
      for registration and form views that have not yet moved. The complete
      repository gate passes 2,020 backend tests (one skipped), 234 frontend
      tests, and 80 tool tests, including the real Worker/D1 browser journey for
      configuring terms and attendance days and then continuing to edit the
      same event revision.
      Identity-bound participant meeting entry is implemented, including an
      explicit shared-group `attend` grant test proving that `view`, `register`,
      and `manage` do not imply entry and that grant revocation fails closed.
      Authorized global managers can now create any active D1-backed group
      type, while local group managers are not shown a misleading global-create
      action. The same selected-group settings view manages category eligibility
      through membership-category labels loaded from D1 and revision-checked
      replacement commands. The selected group and its effective capabilities
      are always rechecked before management routes run; possession of an
      unrelated staff capacity no longer authorizes the selected group.
      Account Settings is now a capacity-aware portal destination for staff,
      members, and dual-capacity users; staff-only users do not call member
      notification APIs. The duplicate admin view and navigation item are gone,
      and the former admin hash route redirects to the portal.
      Event registration setup now also belongs to the selected-group portal.
      A group manager can keep registration disabled, enable registration with
      no custom questions, select an existing group-owned attendee form through
      a server-searched and paginated catalog, or create and edit the exact
      event placement with the shared form-definition editor. Registration can
      be enabled only while at least one active required attendee term exists;
      the same revision-checked D1 batch protects policy, placement, terms, and
      group-scoped audit writes from stale updates and authorization races.
      Group-owned form definitions are reusable without creating an implicit
      group-wide placement. The remaining admin view is read-only for these
      portal-owned registration settings while proposal-form management and
      event reporting remain available. A real Worker/D1 browser journey now
      creates the event, terms, optional registration policy, exact form and
      custom field, and attendance days entirely through the portal, then
      verifies the persisted setup. A focused Codex Security review reproduced
      a stale-placement race between the event and form aggregates; one shared
      snapshot guard now rechecks every mutable placement attribute in the D1
      batch before either deactivation or reactivation. Deterministic tests
      prove both races return a bounded conflict while preserving the moved
      placement, event policy, and audit history. The complete repository gate
      passes 2,026 backend tests (one skipped), 237 frontend tests, and 80 tool
      tests.
      Per-day attendee management now also belongs to the selected-group portal.
      Managers with the exact `manage_attendance` capability can inspect a
      least-privilege attendee projection, change only configured day attendance,
      return accepted in-person days to the day waitlist, and admit explicitly
      selected actively waitlisted days. The live event grant, registration
      revision, capacity state, and each selected waitlist row are rechecked in
      the same D1 batch as attendance, audit, and outbox writes. Cancelled
      registrations cannot be restored through this workflow. The list keeps
      form answers, referral data, raw RSVP payloads, delivery state, and sponsor
      consent outside the group boundary while reusing the shared server-side
      search, sorting, pagination, and statistics reducer. The duplicate admin
      day-attendance panel, service adapter, route, and contract are removed;
      the separate admin-only VIP admission remains until that higher-risk action
      has a deliberate portal design. Focused backend regressions pass 145 tests,
      the focused component suite passes 2 tests, and a real Worker/D1 Playwright
      journey changes one attendee from accepted to waitlisted and back through
      group routes without any admin API request. All static, build, frontend
      (240), tools (80), architecture, formatting, and zero-duplication gates
      pass. The complete backend run passed 2,024 tests with one skipped and one
      unrelated Google Groups batching assertion; its isolated 27-test suite
      passed immediately afterward, documenting the nondeterministic failure
      without misreporting the complete run as green.
      Attendee invitation list, search, resend, and revoke now use the same
      selected-group event context. The canonical D1 query owns invite-type
      scoping, server-side filters, sorting, pagination, and transition actions;
      the group projection excludes inviter internals, decline notes, and
      unsubscribe state. Exact event-management authorization is guarded for
      both reads and same-batch writes. Every invitation producer binds queued
      capabilities to the current secret generation, and delivery fails closed
      when an invite is revoked, expired, accepted, declined, or superseded.
      The unreleased consolidated migration includes the query-plan-verified
      event/type/created index. Transitional admin list/resend/revoke is now
      speaker-only, while attendee and speaker bulk creation remain pending a
      deliberate portal design. A real Worker/D1 browser journey exercises
      attendee list, search, resend, and revoke without an admin API request.
      The complete repository gate passes 2,031 backend tests (one skipped),
      245 frontend tests, and 80 tool tests, with zero changed-code duplication.
      Program-committee proposal management now uses the same selected-group
      event context. Neutral shared contracts and components serve the portal
      and the temporary admin adapter for detail, reviews, comments, accepted
      abstract corrections, accepted-proposal cancellation, decision preview,
      finalization, and proposal-scoped audit history. The group routes bind the
      exact owning group, event, and proposal and enforce distinct event-scoped
      read, score, manage, accepted-abstract-edit, and accepted-cancellation
      permissions. Finalization rechecks live management authority and the exact
      tuple in the same D1 batch as decision history, audit, participant
      capacities, and durable outbox rows. Event statistics neither execute nor
      return proposal aggregation without event-scoped proposal-read authority.
      One content-type-aware email-literal abstraction protects public proposal,
      speaker, attendee, invitation, cancellation, vote, and campaign values in
      Markdown, HTML, text, and subject rendering. One shared campaign-data
      merge also prevents configurable form keys from replacing canonical
      event, identity, route, or management variables. A real Worker/D1 browser
      journey completes the portal proposal workflow without an admin API
      fallback. The complete repository gate now passes 2,114 backend tests
      (one skipped), 256 frontend tests, and 80 tool tests, with zero duplicated
      changed-code blocks.
      This parent item remains open for the other management areas and final
      admin-shell retirement below, not for event registration or proposal
      decision management.
- [ ] Move remaining global management views into the portal.
- [x] Replace hardcoded admin links in email, OAuth, and due-work paths.
      Evidence: one typed management-link adapter owns the semantic destinations
      used by admin sign-in, MCP OAuth, membership due work, organization content
      review, sponsorship inquiries, checkout processing, and renewal due work.
      Destinations that still require the admin application remain explicit in
      that adapter and can move to portal routes without changing email or job
      business logic. Persisted URLs in already-applied D1 templates are called
      out separately in ARCHITECTURE.md.
- [ ] Add temporary legacy redirects where needed.
- [ ] Remove the admin shell and its separate navigation.
- [ ] Remove duplicate admin and member session assumptions.
- [ ] Remove legacy admin API routes after canonical consumers migrate.
- [ ] Browser-test member, chair, inherited leader, local-only leader, staff,
      guest, and unauthorized navigation.

## 11. Quality, security, and performance

Status: In progress

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
      `idx_event_group_grants_group`; occurrence and guest pages prove
      series-bounded access through `idx_event_occurrences_series_status_start`
      and `idx_event_occurrence_guests_series`; organization-contact authorization proves
      indexed representative and contextual-role lookups without a table scan;
      write-time group-join eligibility proves indexed parent membership and
      category-rule lookups without a table scan or temporary B-tree;
      the canonical group projection now uses indexed per-group capacity,
      participant, and child counts instead of materializing aggregate tables
      for every selected-group detail request, while its page-count statement
      omits those projections entirely; the canonical group and membership
      production builders assert `idx_groups_type_active`,
      `idx_group_memberships_group_active`, and `idx_groups_parent_active` use;
      group statistics assert indexed group-membership windows and exact
      group-scoped audit access without table scans; group-owned mailing-list
      configuration asserts `idx_mailing_lists_group_active` for the actual
      page and count builder; the group user catalog asserts its production
      page builder uses the indexed alternate-email lookup while remaining
      bounded to eight server-filtered identities. The focused group,
      statistics, mailing-list,
      meeting-entry, and grant selection passes 67 tests, followed by 38 tests
      after the read-time authorization guard was added. Event-day management
      now also asserts that its production attendance-count join uses indexed
      registration, day-attendance, and event-day lookups without a table scan.
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
- [x] Run group authorization security tests.
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
      authorization uses the same live evidence in request preflight and the
      protected D1 batch. Voting races are tracked separately below.
- [x] Run meeting-entry, terms, guest, and attendance security tests.
      Current evidence: 26 focused meeting-entry and event-sharing tests cover
      exact member-session binding,
      browser/mailbox guest verification primitives, challenge replay,
      occurrence scope, terms reuse and replacement, membership loss, expiry,
      guest-policy changes, revocation races, HTTPS-only destinations, audit
      redaction, repeated joins, and verified attendance. Both subject
      predicates on the canonical eligibility view have indexed query-plan
      assertions. Invitation and code delivery use mocked/intercepted SendGrid;
      mounted route, atomic outbox, rate-limit, forwarding, revocation, cookie,
      and one-time-code behavior pass in both Worker integration tests and the
      focused Playwright journey.
- [x] Run voting replacement and race tests.
      Evidence: the existing mounted and service tests cover concurrent Member
      ballot replacement, vote close races, representative revocation, round
      changes, and tally correctness. Proposal and endorsement withdrawal now
      recheck live group voter eligibility inside the same D1 batch, guard the
      exact mutation count before audit insertion, and return a bounded conflict
      if eligibility changes. Deterministic mounted-route races prove the
      endorsement/proposal state, audit log, and email outbox all roll back.
- [x] Run mutable-form concurrency and historical-integrity tests.
- [x] Run the complete pnpm run check gate.
      Current evidence: the complete gate passes at the current architecture
      checkpoint: 2,114 backend tests pass with one skipped, 256 frontend tests
      pass, and 80 tooling tests pass. Type checks, ESLint, SQL projection,
      dependency architecture, API-contract, zero-duplication, formatting,
      frontend/Hugo builds, max-lines, and filename gates also pass. An earlier
      combined run identified one 607-line test file; the meeting cases
      were separated into a focused file. The complete composite gate was then
      rerun successfully after the selected-group authorization, account
      cutover, centralized management destinations, group creation, and category
      rule regressions were added. The final architecture state must pass the
      same complete gate again before handoff.
- [x] Run focused Playwright flows while iterating.
      Current evidence: the real Worker/D1 portal event journey and six
      selected-group persona journeys pass together in one isolated seven-test
      Playwright run. They cover actual email-capability sign-in, standalone
      event create/edit persistence, member, direct chair, inherited manager,
      local-only child participant, staff-only manager, and unauthorized
      presentation contracts. The earlier guest meeting-entry browser journey
      remains green as separate focused evidence. A separate real Worker/D1
      journey signs in as an event program manager, reads proposals through the
      selected-group API, edits an accepted abstract, previews and records a
      final decision, and reads the resulting audit history without an admin API
      fallback.
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
      Codex Security scan `cb0bbaeb-9453-4521-a1d1-af7defa1b360` then reviewed
      all 49 production files in the exact proposal-management implementation
      snapshot after resolving attendee campaign Markdown/HTML injection and
      canonical-URL shadowing found during independent review. It completed with
      full coverage and no remaining findings. A fresh final diff review remains
      required after the rest of the architecture is implemented.
      Codex Security scan `262643f3-295d-4569-a8c0-089140250b09` reviewed the
      proposal-speaker management diff and validated one low-severity stale
      mailbox capability path. The shared outbox boundary now binds every
      queued `speaker_manage` marker to the normalized recipient; delivery
      rechecks that address in the same query that loads the speaker secret and
      cancels legacy unbound rows. Every canonical email-change/anonymization
      batch also rotates all speaker secrets and invitation generations.
      Token-authenticated profile, decline, headshot, reminder-preference,
      confirmation, and presentation writes compare that generation at commit,
      closing both delivered-token and in-flight request races. Focused tests
      cover old-address reuse, fresh delivery to the new address, all canonical
      email-mutation paths, normal and bulk scheduling boundaries, and each
      stale in-flight speaker mutation. An independent post-fix bypass review
      found no remaining path for the original finding. This is round evidence;
      a final whole-PR security diff review remains required.
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
