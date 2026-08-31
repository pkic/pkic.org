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

Status: Complete

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
- [x] Preserve temporary compatibility exports only while callers migrate.
      Current evidence: the unreleased working-group collection contracts and
      routes have been removed. Temporary shared contract and service exports
      for the completed form, invitation, speaker, registration, and event
      configuration slices have been removed rather than retained as aliases;
      the duplicate admin registration-detail schema module is also removed.
      No admin event or proposal HTTP consumer remains. Internal
      command services now use the generalized audit-change guard classifier
      directly; its one-row compatibility alias, the redundant form-answer
      schema name, and an unused admin vote-candidate alias are removed. Tests
      now import the canonical proposal and registration read models directly;
      their proposal service/schema, registration-list, and
      registration-statistics compatibility modules are deleted. The remaining
      admin proposal callers now import the canonical detail/edit services,
      both admin and group speaker removal use one manager operation, and admin
      vote routes consume the canonical mutation and raw-ballot contracts
      directly. Event, series, and occurrence reads now call the generic live
      resource-context evaluator without an event-named re-export. A current
      import audit finds no remaining temporary contract or service export;
      storage-level legacy columns and deployed-data readers remain explicit
      compatibility policy rather than parallel application contracts.
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

Status: Complete

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

## 3. Acting identities

Status: Complete

- [x] Reuse organization_domain_claims as the sole exact domain owner.
- [x] Record verification evidence for all email identities used in matching.
- [x] Use exact verified custom-domain matches as evidence for an organization identity.
- [x] Never automatically associate free, personal, disposable, unclaimed, or
      ambiguous domains.
- [x] Show a warning for addresses that cannot establish an organization identity.
- [x] Permit primary and secondary contacts to invite an organization identity.
- [x] Require the exact user to accept an ordinary identity invitation.
- [x] Require `membership:write`, `identities:activate`, an activation reason,
      and same-batch authorization for exceptional immediate activation.
- [x] Permit contacts to end an identity while preserving immutable history.
- [x] Record a later role period as a successor identity rather than restoring history.
- [x] End all active group capacities for the ended identity atomically.
- [x] Revoke affected organization roles atomically.
- [x] Preserve historical activity and audit evidence.
- [x] Verify authorization against the session's exact live identity on every action.
- [x] Cover domain normalization, unverified email, claimed-domain collision,
      invitation, acceptance, lifecycle races, alias removal, and concurrent activation.
      Evidence: the identity invitation, organization identity, multi-identity
      context, session, membership provisioning, group-capacity, and email-alias
      suites cover the shared contracts and D1 guards. Free, personal,
      disposable, unclaimed, and ambiguous domains remain fail-closed. The
      mounted API proves that pending invitations grant no capacity, exact-user
      acceptance activates it, and ending atomically revokes derived capacity
      without erasing history.

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

Status: Complete

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
- [x] Add a multi-level event audience policy and authorization-derived event
      projections.
      Evidence: `events.visibility` is a dedicated indexed D1 column with the
      shared `invitation_only`, `group_members`, `all_members`, and `public`
      vocabulary. It is deliberately independent from registration and
      meeting-entry eligibility. The canonical event list applies one live D1
      predicate before counting and pagination, including active membership,
      owner/shared-group membership, registrations, event participation,
      unexpired invitations, and exact event-read grants. Detail responses use
      the same predicate and omit management settings, retention, invite
      limits, revisions, and virtual URLs unless the caller has exact
      `events:read`; invalid credentials never downgrade to anonymous access.
      Group-context event reads compose the same audience predicate with
      manager authority. Focused backend tests cover every audience level,
      list totals, field projection, immediate policy changes, invalid-token
      handling, and explicit group sharing.
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
- [x] Provide public HTML registration and management shells for portal-created
      events that opt into public, required, or optional registration.
      Evidence: portal creation now persists an immutable platform-derived
      `base_path`; later schedule edits do not invalidate URLs already delivered
      by email. One shared path contract drives registration, confirmation,
      self-management, proposal, speaker, presentation, and invitation-decline
      URLs in both the Worker and browser boot code. Static Hugo-authored pages
      remain first in precedence. When no static page exists, the Worker serves
      the same noindex, data-free Hugo-built shell for every syntactically valid
      flow path, while the canonical API remains responsible for event,
      capability, and eligibility validation. This avoids both a D1 lookup and
      an event-existence oracle in the presentation route. Requests sent to the
      static-assets binding are rebuilt as same-origin path-only requests, so
      capability query strings, cookies, authorization, and route hints cannot
      leak into the asset boundary. Focused service and browser tests cover all
      eight shells, static-page precedence, unknown and hostile paths, HEAD and
      error responses, stable portal URLs, source-mode isolation from legacy
      route overrides, portal event creation/configuration, and the real
      registration, confirmation, and self-management journey. The private
      shell CSP permits only the Stripe script and frame origins required by the
      existing confirmation-page donation component; missing or failed shell
      asset reads return a sanitized no-store 503 with the same security
      headers.
- [x] Add rotatable, expiring guest invitation capabilities that authorize only
      browser-bound mailbox verification, never meeting entry by themselves.
- [x] Make manager-created attendee and speaker invitation validity
      explicitly configurable, defaulting to the event start and never
      extending beyond the event end.
      Evidence: one shared validity contract and effective-expiry SQL expression
      drive creation, resend, bulk replacement, reminder selection, and pending
      counts. Omitted deadlines resolve to the current event start. Legacy null
      or overlong expiries are bounded by the event, and shortening an event
      makes stale invitations logically expired. The unreleased consolidated
      migration also normalizes invitation recipient email, expires elapsed or
      otherwise unsafe active invitations, and retains the newest still-valid
      duplicate with deterministic tie-breaking. Ambiguous raw timestamps are
      preserved for diagnosis but cannot remain active; the migration test
      audits both the authority-bearing rows and the known unresolved values.
      Duplicate classification and the final guarded D1 batch use the same
      predicate, so replacement cannot race with an event schedule or
      invitation change. The selected-group
      portal, resend actions, and peer attendee/speaker nomination route all
      reuse this contract and command boundary. The duplicate admin invitation
      UI and API have been removed rather than kept as a compatibility
      implementation. Focused service, mounted route, query-plan, atomicity,
      and portal-component regressions are included.
- [x] Add the same explicit expiry selection to peer speaker nominations.
      Evidence: the existing peer route extends the shared invite-validity
      schema and delegates to the same event-bounded bulk command; omitted,
      past, concurrent-schedule-change, valid custom, and post-event deadlines
      are covered without adding a second expiry implementation.
- [x] Apply the shared event-bounded validity policy to proposal co-speaker
      invitations without expiring confirmed-speaker self-management.
      Evidence: omitted deadlines resolve to the event start and explicit
      deadlines cannot exceed the event end. Expiry stops delivery and use of
      an unconfirmed invitation, while confirmation preserves the same
      resource-bound speaker capability. Renewing an expired or declined
      invitation rotates its secret and generation instead of reviving the old
      bearer capability.
- [x] Define and implement occurrence/event-bounded validity configuration for
      external meeting-guest invitations without weakening their separate
      mailbox verification and occurrence-entry checks.
      Evidence: the guest request composes the canonical event-invite validity
      schema. Omission resolves to the selected occurrence start, or to the
      materialized parent-event start for an explicit series-wide invitation;
      an explicit deadline cannot exceed the corresponding end. One shared
      effective-expiry SQL expression drives guest listing, pending counts,
      queued capability materialization, browser challenges, verified sessions,
      and the canonical occurrence-eligibility view. The invitation D1 batch
      rechecks the exact schedule, while later schedule changes can shorten but
      never extend an issued deadline. Focused service, mounted route,
      concurrency, migration, component, and Playwright regressions cover
      defaults, bounds, schedule races, queued delivery, established sessions,
      mailbox verification, and intentional occurrence entry.
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
      Current evidence: one canonical
      `/api/v1/meetings/occurrences/:occurrenceId/join` resource resolves the
      authenticated user's live member capacity first and falls back to a
      separately verified guest session only when no eligible member capacity
      exists. Guest JWTs are a distinct token type backed by a one-time
      browser/mailbox challenge, current invitation generation, exact D1
      session, and occurrence scope. POST creates an occurrence-owned
      `/invitations/verifications` resource and PATCH consumes its separately
      delivered mailbox code. Challenge and session cookies are scoped to the
      exact occurrence routes, and a verification created for one occurrence
      cannot mint a session for another. The former `/api/v1/me/meetings` and
      `/api/v1/meeting-guests` actor namespaces are removed.
- [x] Deliver rotatable guest invitations through the durable outbox and move
      the capability out of the request path before any landing data is read.
      Evidence: guest eligibility, audit, invitation rotation, access
      invalidation, and the secret-bound invitation outbox row commit in one D1
      batch. Challenge creation and its verification-code outbox row commit in
      a second atomic batch. Capability materialization fails after reinvitation
      instead of minting current authority from a stale message.
- [x] Cover link scanners, forwarding, expiry, revocation, guest identity,
      membership loss, terms changes, repeated joins, and attendance counts.
      Evidence so far: the focused meeting, OpenAPI, and cache-policy regression
      set passes 58 tests covering exact member and guest sessions,
      browser/code binding, challenge replay, occurrence scope,
      expiry/revocation and policy races, identity precedence and tampering,
      membership loss, terms changes, repeated joins, retired-route absence,
      encrypted
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
      multi-organization identities, explicit identity selection, latest
      ballot replacement, representative removal, concurrent replacement and
      close races, election rounds, and tally correctness.

## 8. Resource ownership and sharing

Status: Complete

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
- [x] Apply the shared evaluator to every form, event, vote, and mailing-list
      read and mutation path as those canonical group APIs replace legacy
      domain endpoints.
  - [x] Apply `attend` to meeting entry in the Worker read and atomic D1 guard.
  - [x] Apply mailing-list view and subscribe grants to member discovery,
        preference mutation, and provider desired-state reconciliation.
  - [x] Apply form placement grants to canonical definition, submission, response,
        response-statistics, and management paths.
        Evidence: response pages, delayed answer enrichment, aggregate
        statistics, field catalogs, and every population lookup now execute
        through one guarded D1 facade that rechecks selected-group leadership
        and the exact `view_responses` grant before each protected batch.
        Deterministic races prove that revoking either the grant or leadership
        after preflight returns no response or aggregate data.
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
          and lost-ownership states. The configuration projection now executes
          every event, placement, term, day, and count read through the same
          live membership/register/event-policy guard used by registration
          submission. Grant and membership revocation after route preflight
          return no configuration, while the public configuration path remains
          unchanged.
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
          the same D1 batch as their live exact-context guard. Selected-group
          preflight and every mutation/read guard now delegate to the generic
          managed-resource evidence builder. Its optional `votes:manage` policy
          is accepted only when the selected group still owns the vote; a
          matching `manage` grant plus management authority remains mandatory
          for a grantee group. Global compatibility routes retain their
          intentionally broader no-group policy and reuse the same domain
          create/update/visibility/ballot schemas without duplicating their
          contracts. Mounted and direct-service tests cover path-owned creation,
          wrong-context denial, explicit manage sharing, member denial,
          owner-permission/grantee separation, permission-revocation rollback,
          and raw-ballot isolation.
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
          The latest evaluator pass moves form-placement discovery, mailing-list
          subscription discovery, mailing-list management, event-series reads,
          and vote discovery onto one live membership/management evidence
          constructor. Shared mailing-list managers can list and mutate only
          resources carrying an effective `manage` grant, and both grant and
          selected-group leadership are rechecked in the protected D1 batch.
          Revocation-before-read and revocation-before-write regressions pass.
          Every canonical group form, event, vote, and mailing-list path now
          uses the shared live resource-context evaluator or its guarded
          command facade. No legacy admin, portal, or system API adapter remains,
          and the mounted route-boundary regression prevents one from returning.

## 9. Group-scoped REST API

Status: Complete

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
      reusable proposal/speaker components serve both canonical event and group
      contexts. Presentation upload/download remains speaker-capability scoped,
      requires a confirmed speaker on an accepted proposal, and no longer
      returns private R2 storage keys through public presentation contracts.
- [x] Add canonical group co-speaker invitation/capability management.
      Evidence: one shared contract, service, portal form, and exact
      group/event/proposal route replace the remaining portal dependency on the
      proposer-only nomination path. Active duplicates are idempotent; expired
      or declined invitations are renewed with a rotated secret and generation.
      Recipient- and secret-bound durable-outbox markers fail closed after
      expiry, decline, replacement, or recipient changes. Exact speaker-state,
      proposal-tuple, permission, event-schedule, and capacity guards run in the
      same D1 batch, including deterministic decline and confirmation race
      coverage. Reminder and recovery selection remains in indexed D1 queries.
      Focused service, route, capability, concurrency, query-plan, component,
      and real Worker/D1 browser tests cover the lifecycle without an admin API
      fallback.
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
      Retired admin bookmarks return 404 rather than retaining a second shell;
      provider synchronization remains owned by the scheduled service rather
      than an orphaned UI endpoint.
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
      landing/confirmation share the occurrence-owned `/meetings` resource;
      mailbox verification is a nested invitation-verification resource rather
      than an actor- or UI-scoped endpoint.
- [x] Keep routes thin and SQL-free.
- [x] Add one generic `/api/v1/users/current/groups` self-participation read model.
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
      mailing-list, statistics, audit, group-user search, and resource-grant routes
      are exercised through the mounted router. The tests cover schema
      rejection, authentication, capability middleware, stale revisions, and
      authorization changes between request preflight and the D1 batch rather
      than testing services alone.
- [x] Remove temporary working-group endpoint compatibility before completion.
      Evidence: the unreleased /api/v1/working-groups and
      /api/v1/me/working-groups routes, services, contracts, and route-specific
      tests are removed. Generic /api/v1/groups, /api/v1/users/current/groups, and the
      privacy-bounded public group directory are the only group collection and
      self-service resources.
      The portal retains only its hash-route redirect for existing bookmarks;
      no production client or upstream API depended on the retired endpoints.

## 10. Unified portal and admin retirement

Status: Complete

- [x] Make human authentication identity-based.
      The neutral `/api/v1/auth/*` flow uses one purpose-bound magic link,
      resolves staff and member eligibility independently, and atomically
      establishes every current capacity in one `pkic_session`. Passkeys follow
      the same model.
- [x] Gate member actions separately from staff management permissions.
      Portal session status exposes live capacities, the shell derives its
      navigation from them, and staff-only identities never probe or receive
      access to member-capacity resources under `/api/v1/users/current/*`.
      Those endpoints continue to require a live member session; loss of membership removes only that capacity rather
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
- [x] Add auth-aware group detail and capability-derived navigation.
      Evidence: canonical `GET /api/v1/groups/:groupId` returns a data-minimized
      projection to public callers and adds the authenticated identity's live
      `view`, `participate`, and `manage` capabilities from
      canonical membership and inherited-governance services. The shared portal
      route filters its sections from that response: participants receive
      collaboration views without settings or governance controls, while a
      staff-only manager can use the same selected-group route without gaining
      participation. Policy and revision configuration is omitted unless the
      identity has the effective `manage` capability. The legacy
      selected-management URL redirects to the
      canonical group URL. Mounted tests cover an inherited leader, participant,
      and unauthorized outsider; focused frontend tests cover read-only,
      participant, manager, and staff-only navigation. The retired technical
      `/context` route is absent. Group-authorized user selection uses the
      natural `/api/v1/groups/:groupId/users` collection, and the retired
      `/user-catalog` route is absent.
- [x] Reuse views across working group, task force, board, executive council,
      and coordination-group labels.
      Evidence: selected-group routing and capability filtering use only the
      generic group contract and configured type labels. No route, component,
      or navigation branch selects behavior from a group type key.
- [x] Move self-service participation onto the generic group and
      group-membership contracts without a working-group-only UI context.
      Evidence: the portal consumes `/api/v1/users/current/groups` without a type filter
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
- [x] Move group, leadership, meetings, forms, votes, mailing lists, stats, and
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
      the retired admin application. Dated Board and Executive Council positions
      remain global records rather than group governance and are managed through
      the portal's permission-derived Leadership destination.
      Group vote discovery now uses that same controller and renders effective
      per-resource capabilities. Its detail view reuses the existing ballot and
      result components while the nested API binds participation to the
      selected group. Managers can create and edit votes, set result visibility,
      inspect identifiable ballots, and apply lifecycle transitions; participants
      and managers can use the same group-scoped proposal list with only the
      actions advertised by the backend. The duplicate admin Votes navigation,
      components, and `/api/v1/admin/votes/**` compatibility API are removed,
      while the retired admin browser URL returns 404. Vote creation,
      settings, visibility, and identifiable-ballot audit now use only the
      selected-group contracts; the unused global vote inventory contract and
      read model are deleted. The unused global
      `/api/v1/admin/vote-proposals` adapter is also removed; its admin-only
      route contracts and unscoped read model no longer remain as a second
      implementation. The duplicate `/api/v1/portal/votes`,
      `/api/v1/portal/vote-proposals`, and `/api/v1/me/votes` adapters and the
      separate top-level member Votes workspace are removed. Authenticated
      discovery, participation, history state, results, proposals, and
      management now use only `/api/v1/groups/:groupId/...`; consortium-wide
      usage is the same implementation in the automatically enrolled All
      Members group. `/api/v1/votes` remains a deliberately minimized public
      cross-group projection and omits private, ballot, and member-state data;
      published cancellations remain visible. Representative notifications link to the owning
      group's Votes view. The group proposal routes compose the neutral
      canonical proposal list and rejection schemas.
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
      group create/edit/archive, exact group-scoped API paths, and no admin API
      fallback. The retired admin bookmark returns 404. The old global
      mailing-list CRUD surface is intentionally
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
      services, selected-group portal, and canonical event consumers. Every
      replacement rechecks exact event management and standalone-event status
      in the same D1 batch, advances the event revision with compare-and-set,
      records a group-scoped audit entry, and rolls child writes back on a stale
      revision or authorization race. Attendance counts remain D1-aggregated;
      the production query has an indexed no-scan plan. The duplicate admin
      Terms and Days editors, the admin Terms route, and the admin day mutation
      route and the final read-only admin day projection are removed. The complete
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
      and the former admin hash route returns 404.
      Event registration setup now also belongs to the selected-group portal.
      A group manager can keep registration disabled, enable registration with
      no custom questions, select an existing group-owned attendee form through
      a server-searched and paginated catalog, or create and edit the exact
      event placement with the shared form-definition editor. Registration can
      be enabled only while at least one active required attendee term exists;
      the same revision-checked D1 batch protects policy, placement, terms, and
      group-scoped audit writes from stale updates and authorization races.
      Group-owned form definitions are reusable without creating an implicit
      group-wide placement. Proposal-form management and event reporting remain
      available through their canonical event and selected-group resources. A
      real Worker/D1 browser journey now
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
      day-attendance panel, service adapter, route, and contract are removed.
      Selected-group admission now uses the RESTful nested resource
      `POST /api/v1/groups/:groupId/events/:eventId/registrations/:registrationId/admissions`.
      `capacity_exempt` retains the exact effective `manage_attendance`
      capability and active-waitlist prerequisite. The higher-risk `vip` mode
      requires effective `manage`, explicitly selected days, and a required
      3–1000 character reason, and may override capacity without a waitlist
      row. The portal renders VIP controls only from the server-provided
      effective `manage` capability. The service repeats the same mode-specific
      capability and selected-group context inside the protected D1 batch;
      deterministic revocation tests prove that stale authority rolls back the
      admission, audit, waitlist, and outbox writes. Both modes reuse the one
      admission service, audit action, and registration-update notification.
      The retired verb path `/admit` has no compatibility alias. The focused
      mounted admission and OpenAPI suites pass 62 tests, the focused portal
      component suite passes 3 tests, and the real selected-group browser
      journey proves a non-waitlisted VIP override succeeds without any admin
      API request. The exact accumulated state passes the complete repository
      gate with 2,393 backend tests (one skipped), 340 frontend tests, and 88
      tooling tests, and the uninterrupted complete browser gate passes 79/79.
      Attendee and speaker invitation create, preview, list, search, resend, and
      revoke now use the same
      selected-group event context. The canonical D1 query owns invite-type
      scoping, server-side filters, sorting, pagination, and transition actions;
      the group projection excludes inviter internals, decline notes, and
      unsubscribe state. Exact event-management authorization is guarded for
      both reads and same-batch writes. One shared composer and neutral schemas
      drive both invitation types in the selected-group event context. Preview
      confirmation signs every independently sendable ordered recipient batch
      over its actor, event, invitation type, effective expiry, and digest; the
      bulk command recomputes the digest before any write, rejecting recipient
      substitution while preserving bounded 500-recipient D1 commits. Every
      invitation producer binds queued
      capabilities to the current secret generation, and delivery fails closed
      when an invite is revoked, expired, accepted, declined, or superseded.
      The unreleased consolidated migration includes the query-plan-verified
      event/type/created index. The obsolete admin-only bulk form, invitation
      list, resend/revoke handlers, route contracts, and event-detail tabs are
      removed. Old attendee and speaker invitation bookmarks return 404;
      canonical management links target the selected-group portal directly. Real
      Worker/D1 browser journeys create, preview, send, search, resend, and
      revoke attendee and speaker invitations without an admin API request.
      Focused tests cover the corresponding speaker lifecycle, large-list
      batching, preview-token substitution attacks, permission boundaries,
      accessible controls, and text-safe recipient rendering.
      Event team assignments now use the canonical
      `/api/v1/events/:eventSlug/roles` resource rather than the generic
      `/api/v1/admin/events/:eventSlug/permissions` namespace. One neutral
      role schema maps the organizer, program committee, moderator, and
      volunteer vocabulary to the persisted RBAC catalogue. Search, sorting,
      counting, and pagination run in D1; assignment and revocation repeat the
      exact live user-backed `events:manage` authority and target state in one
      guarded batch. API-key identities cannot mutate roles, the UI exposes
      the Team tab only with the management capability, and event readers see
      sponsor-tier data without receiving edit actions. Mounted, concurrency,
      OpenAPI, frontend, and real-browser regressions cover canonical requests,
      permission loss, target races, route removal, and absence of the legacy
      admin permissions API.
      Event promotion activity now uses the canonical
      `/api/v1/events/:eventSlug/promoters` resource with a neutral camelCase
      schema. Promoter and referral-code search, per-view sorting, pagination,
      and aggregate summaries remain bounded D1 projections. The route
      requires exact live, user-backed `events:read`; public event visibility
      does not expose promoter identities or referral codes, and the frontend
      hides the tab without that capability. Mounted, OpenAPI, frontend,
      route-retirement, and real Worker/D1 browser regressions cover the
      resource; the former
      `/api/v1/admin/events/:eventSlug/promoters` handler is removed rather
      than retained as an alias.
      Event presentation downloads now use the canonical
      `/api/v1/events/:eventSlug/presentations/archive` resource. The default
      archive contains each accepted proposal's current presentation, while
      the validated `versions=all` query includes retained versions. The
      route requires exact live, user-backed event-scoped `proposals:read`,
      streams a no-store ZIP from R2, and returns no archive when the event has
      no presentations. Proposal-management UI actions are derived from the
      response access capabilities and remain absent without proposal-read
      access. Mounted permission, archive-content, route-retirement, OpenAPI,
      frontend, and browser regressions cover both modes; the verb-oriented
      `/api/v1/admin/events/:eventSlug/presentations/download` handler is
      removed rather than retained as an alias.
      Event analytics now use the canonical
      `/api/v1/events/:eventSlug/analytics` resource. The route requires exact
      live, user-backed event-scoped `events:read`; public event visibility
      never exposes operational metrics, and proposal totals are omitted
      unless the same actor also has event-scoped `proposals:read`. One neutral
      schema and read model replace the admin-prefixed contract and service.
      Registration, attendance, waitlist, invitation, and RSVP projections run
      in one bounded D1 batch while reusing the shared attendance statement
      builders and decoders. The Analytics tab is derived from the event-read
      capability. Mounted contract, permission, batch-count, schema, OpenAPI,
      frontend, route-retirement, and real-browser regressions cover the
      resource; the former `/api/v1/admin/events/:eventSlug/stats` handler is
      removed rather than retained as an alias.
      The event proposal catalogue now shares the natural
      `/api/v1/events/:eventSlug/proposals` resource with public proposal
      creation: authenticated GET requires exact live, user-backed
      event-scoped `proposals:read`, while POST retains its independent public
      submission policy. One neutral list contract owns D1-side search, status
      and recommendation filters, allowlisted sorting, counting, pagination,
      and aggregate summaries for both event and selected-group consumers.
      Archived proposals are an explicit `archived=true` selection and never
      mix into the active catalogue. The response derives its action
      capabilities from the same live event context. The canonical read
      operation retains explicit MCP metadata, and the former
      `/api/v1/admin/events/:eventSlug/proposals` handler is removed rather
      than retained as an alias. Mounted permission, archive-isolation,
      OpenAPI, MCP, pagination, frontend, route-retirement, and browser
      regressions cover the cutover.
      Event communication now uses one neutral attendee/speaker campaign
      service and one shared component. Direct event managers create previews
      and campaigns through
      `/api/v1/events/:eventSlug/email/campaigns[/previews]`; selected-group
      managers use the same resource under
      `/api/v1/groups/:groupId/events/:eventId/email/campaigns[/previews]`.
      Preview capabilities are short-lived and actor-bound. Exact live
      event-write or selected-group management authority is rechecked in every
      D1 batch, including the atomic durable-outbox commit, and the portal only
      renders controls from server-provided capabilities. The former action
      routes under `/api/v1/admin/events/:eventSlug/emails/campaign/*` and their
      duplicate admin-only service/schema names are removed. Mounted scoped
      authorization, revocation-race, bounded-query, OpenAPI, frontend, legacy
      404, and real Worker/D1 browser regressions cover the cutover.
      Program-committee proposal management now uses the same selected-group
      event context. Neutral shared contracts and components serve both
      canonical event and group contexts for detail, reviews, comments, accepted
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
      fallback. The complete repository gate now passes 2,137 backend tests
      (one skipped), 259 frontend tests, and 80 tool tests, with zero duplicated
      changed-code blocks.
      Selected-group VIP admission completes the last named group-management
      parity item without widening the ordinary attendance-manager role.
- [x] Move remaining global management views into the portal.
      Current evidence: the global audit log is the first permission-derived
      portal destination. Its schema, service, and API moved rather than being
      copied to a System API namespace: the canonical domain endpoint is
      `/api/v1/audit-log`; the old admin handler and component are removed,
      while the old hash URL returns 404. The
      canonical endpoint recomputes live user-backed staff permissions and
      requires a global `audit:read` grant. The shared collection controller
      keeps search, open-ended exact actor/entity/action filters, allowlisted
      sorting, counting, and pagination in D1. Mounted tests cover global and
      contextual permission separation plus removal of the old API, and a real
      Worker/D1 browser journey proves the portal path makes no
      legacy audit request, including no `/api/v1/system/audit-log` request.
      Organization-content moderation is the second
      permission-derived System destination. One neutral shared schema now owns
      its list, detail, decision, route, and paginated response contracts; the
      portal consumes a canonical
      `/api/v1/organizations/content-reviews` API guarded by the live global
      `organizations:content-review` permission. System is only the portal
      navigation grouping; the former System API route is absent.
      Search, status, sorting, counting, and pagination remain in D1, and the
      existing atomic moderation service records an attributable user-backed
      reviewer. The old admin component, API handlers, route mounts, service
      adapter, and transport aliases are removed. Notification links target the
      portal directly; retired admin bookmarks return 404.
      Mounted backend and frontend tests prove permission boundaries, decision
      behavior, schema validation, D1 filtering, error and empty rendering, and
      absence of admin API requests. A real Worker/D1 browser journey completes
      a review through the portal and verifies the retired admin URL returns 404.
      Membership-application review is the third permission-derived System
      destination. Neutral shared schemas and the canonical membership service
      now drive `/api/v1/members/applications`; the former System API route and old admin route,
      component mount, transport names, and hardcoded category-id editor are
      removed. Read, mutation, and approval actions require their distinct live
      `membership:read`, `membership:write`, and `membership:approve`
      permissions from a live user-backed session. The joined D1 query owns
      category-label search, allowlisted sorting, counting, and pagination, and
      the portal editor consumes the D1-backed category catalog and labels.
      Notification links target the portal directly; retired admin bookmarks
      return 404. Mounted backend
      and frontend tests cover permission separation, API-key rejection,
      category labels, D1 filtering, route removal, capability-derived controls,
      and absence of legacy requests. A real Worker/D1 browser journey verifies
      the public application, email confirmation, staff sign-in, portal review,
      approval, organization provisioning, and welcome notification.
      Membership workflow configuration is the fourth permission-derived
      System destination. System is a portal-navigation grouping: the canonical
      domain APIs are `/api/v1/membership/settings` and the
      `/api/v1/membership/categories` collection and
      `/:categoryCode` mutation contracts; the old
      admin component and API are removed, and the old bookmark returns 404.
      Reads and writes recheck live
      `membership:read` and `membership:write` authority, mutations record the
      user-backed actor, and revision compare-and-swap guards prevent stale
      overwrites. `membership_categories.is_voting` is the single mutable D1
      policy used by ballot eligibility, vote proposals, representative
      notifications, consultation concerns, and voting statistics. Mounted
      race tests prove that permission, revision, and voting-policy changes
      roll back atomically. Structural category codes and individual-category
      classification remain reference/migration invariants; category creation,
      deletion, and merging are deliberately deferred because those operations
      require a separate destructive-data design. A real Worker/D1 browser
      journey changes workflow settings and category metadata through the
      portal, persists both changes, and observes no removed admin request.
      The singleton membership-application form is managed in that portal
      destination but remains a domain API, not a System API:
      `/api/v1/members/applications/form/definition` is the sole staff
      definition endpoint and `/api/v1/members/applications/form` is its public
      projection. System is only the portal navigation grouping. The staff GET
      requires the live `membership:read` permission; PATCH and its visible UI
      controls require `membership:write`, a user-backed identity, revision
      compare-and-swap, and a same-batch permission guard with attributed
      audit. Both projections compose the shared form contracts and singleton
      key. The former Admin Forms catalogue excludes this definition and every
      legacy direct or placement mutation rejects it, so there is no second
      writer. Public reads are uncached because validation immediately uses the
      current D1 definition, require exactly one active installation placement,
      and fail closed rather than creating unattributed answers. Archived fields
      remain historical and cannot be restored by an unrelated editor save or
      a crafted reuse of their former ID or key. The four bylaws,
      code-of-conduct, IPR, and authority acknowledgements are workflow-owned,
      mandatory read-only policy fields; every public and staff application
      consumer fails closed unless they remain active required booleans with
      explicit true acceptance.
      Focused Worker/D1 tests cover permission separation, API-key rejection,
      stale revision and permission races, status/placement synchronization,
      malformed placement state, historical-field integrity, legacy-route
      rejection, and correct legacy-list pagination; focused frontend tests
      cover permission-derived edit controls, protected-field separation, and
      a readable non-editing view. A real Worker/D1 browser regression edits a
      dynamic question, completes email verification, observes the new question
      immediately on the public join form, makes no legacy Admin Forms request,
      and restores the original definition afterward.
      Email-template management is the fifth permission-derived System
      destination. One neutral shared contract, D1-backed service, and portal
      editor now own listing, server-side search/sort/pagination, version
      history, preview, draft creation, and activation under
      `/api/v1/email/templates`. Reads require the live global
      `email-templates:read` permission; preview and mutations require
      `email-templates:write`. Every mutation repeats the user-backed permission
      and state predicates in the same D1 batch as the write and attributed
      audit record. Conditional version creation and a partial unique index
      prevent competing writers from creating the same version or leaving more
      than one active version. Template resolution reads the current active D1
      version instead of relying on process-local cache state, so activation is
      immediately consistent across Worker isolates. The former admin API and
      editor are removed rather than retained as a second consumer; the old
      bookmark returns 404, while the still-temporary event-email
      editor consumes the canonical System catalog. Mounted route, concurrency,
      rollback, contract, permission, frontend, and real Worker/D1 browser
      regressions provide the cutover evidence.
      Access Control is the sixth permission-derived System destination. Its
      screens now consume resource-domain APIs: `/api/v1/permissions/grants`,
      `/api/v1/permissions/subjects`, `/api/v1/permissions/targets`,
      `/api/v1/roles`, and `/api/v1/users/:userId/roles`. The generic
      `/api/v1/system` router and access-control subtree are removed with no
      compatibility alias. One neutral schema owns every list, mutation,
      selector, and pagination contract. Operators with either the
      live global `access:grant` or `access:revoke` permission may inspect the
      destination, while create/assign and revoke/delete operations retain
      their exact permission boundaries and reject API-key identities. User,
      role, event, group, and organization-capacity selectors use bounded
      server-side D1 search rather than loading collections in the browser.
      A partial unique index prevents duplicate active direct grants, including
      concurrent requests. Revoking the global administrator role also retires
      the transitional `users.role='admin'` authority and every active session
      for that user in the same guarded batch; a failed target race rolls the
      demotion and session revocation back. Event-team grants and revocations
      now use the same live authorization and exact-target guards. Mounted
      backend, migration, concurrency, permission, frontend, and browser tests
      cover the canonical routes, revoke-only inspection, role management,
      route removal, and absence of legacy API requests.
      Global Board and Executive Council leadership is the seventh
      permission-derived System destination. The dated roster editor and route
      handlers moved rather than being copied to
      `/api/v1/leadership/positions`; the former System route mount and handler
      sources are removed, and the old bookmark returns 404. One
      neutral schema and service remain the source of truth for
      the System editor and public leadership projection. User-backed staff
      holding either the live global `access:grant` or `access:revoke`
      permission may inspect the bounded, searchable, sortable, and paginated
      roster and affiliation catalogs. Create and update require `access:grant`,
      while delete requires `access:revoke`; API-key identities fail closed.
      The editor reuses the bounded `/api/v1/permissions/subjects` read model
      rather than introducing another user lookup. Mounted backend, OpenAPI,
      permission, frontend, public-roster, and real Worker/D1 browser tests
      cover exact capability separation, route removal, public projection,
      and absence of legacy API requests.
      Analytics appears in the portal's System interface grouping, but System
      is not an API namespace: three neutral, focused contracts and D1
      services serve the overview, registration, and donation projections
      under `/api/v1/analytics`; each selected portal tab executes only its
      bounded query batch instead of the former 13-query all-purpose request.
      Live user-backed `analytics:read` authority is required and API-key
      identities fail closed. Registration and donation time windows are
      bound in SQL, high-frequency plans have explicit index assertions, and
      the email screen reuses the canonical outbox summary instead of issuing
      an unrelated statistics request. The duplicate Dashboard and Stats
      consumers are removed from the admin shell, and their old bookmarks
      return 404. Mounted contract, permission,
      section-isolation, query-plan, frontend, escaping, and real Worker/D1
      browser regressions cover the domain path and the retired
      `/api/v1/system/analytics` namespace. The compatibility
      `/api/v1/admin/stats` route, its separate 13-query read model, and its
      duplicate platform-wide response contract are now removed rather than
      retained as an unused second implementation. Event-specific statistics
      remain a separate event-scoped projection.
      Donation management now appears under the portal's System navigation,
      but System is only the interface grouping: the canonical resource API is
      `/api/v1/donations`, with collection, detail, promoter, and reconciliation
      routes sharing one neutral contract and the existing donation services.
      Reads require live user-backed `donations:read`; reconciliation requires
      live user-backed `donations:sync`, rejects API-key identities, and
      rechecks that permission before every D1 operation after Stripe I/O.
      Reconciliation records an attributed audit summary and queues lifecycle
      notifications through the durable outbox without sending during the
      request. Search, status filtering, allowlisted sorting, counting, and
      pagination remain in D1. The former admin donation UI, API handlers,
      route mount, and admin-prefixed schema are removed rather than retained
      as a second implementation; old bookmarks return 404.
      Mounted permission, revocation-race, contract, frontend, and focused real
      Worker/D1 browser tests cover the canonical paths and prove no legacy
      donation request is made. This closes the donation slice only; complete
      removal of `/api/v1/admin` remains part of the open parent item.
      Sponsor management and sponsor-contact access now share the portal's
      top-level Sponsors workspace and the sole `/api/v1/sponsors` resource
      family. The same family owns public display, inquiries, checkout, tiers,
      company drill-down, pipeline records, history, stage transitions,
      non-member logos, access-link requests, and consenting attendee data;
      the singular, plural, and sponsor-portal API families are removed rather
      than retained as aliases. One neutral management schema and service
      boundary owns the staff operations and D1-backed tier pricing.
      Reads require a live user-backed `sponsorships:read` permission; every
      mutation requires `sponsorships:write` and repeats that authorization in
      the same D1 batch as state, history, audit, projection, capability, and
      outbox changes. The shared storage-pointer workflow compensates an R2
      logo upload when the guarded D1 commit fails. Portal controls fail closed
      without write permission, and tier price, currency, and activation are
      now manageable without a migration. The former admin sponsorship UI,
      API mount and handlers, and admin-prefixed schema/read-model names are
      removed rather than retained as a second implementation; semantic
      notification links lead to `/portal/#/sponsors`; old bookmarks return 404.
      Sponsor access capabilities redeem through `/api/v1/auth/verify-link`
      into the same `pkic_session` used by every portal identity. Live sponsor
      capacities are included by `/api/v1/auth/session` and re-derived from
      the current verified user email, active sponsorship, event, and tier;
      there is no sponsor cookie, sponsor JWT type, or sponsor-session table.
      Focused mounted
      backend and frontend tests cover permission separation, API-key denial,
      revocation-before-commit rollback, neutral contracts, tier management,
      retired-route behavior, and absence of legacy sponsorship requests. The independent
      real Worker/D1 browser journey creates and advances a sponsorship through
      the portal and observes canonical API traffic without a legacy request.
      Event-specific sponsor attendee-data entitlements use the canonical
      `/api/v1/events/:eventSlug/sponsors/tiers` resource path with exact
      event-scoped `events:read` and `events:write` permissions, API-key
      denial, and a same-batch revocation guard. Its editor remains correctly
      scoped to the portal's event workspace; it is not a second sponsorship
      pipeline or the global pricing catalog.
      Email delivery and scheduled operational work now share one
      permission-derived Operations destination in the portal while retaining
      natural domain APIs: `/api/v1/email` owns the durable outbox and reminder
      runs, `/api/v1/retention` owns retention previews and runs,
      `/api/v1/membership/batches` owns named membership batches, and
      `/api/v1/scheduler/jobs` owns the bounded scheduled-job registry and
      manual runs. Reads require the matching live global `email:read`,
      `retention:read`, or `scheduler:read` permission. Outbox processing
      additionally requires `email:manage`; scheduler state changes and manual
      runs require `scheduler:manage`, and every job run also retains its exact
      domain permissions, including `users:anonymize`, `membership:write`, or
      `membership:approve` where applicable. The portal renders each action
      only from server-derived capabilities. The scheduled-job UI is loaded as
      a separate lazy chunk and uses one natural
      `PATCH /api/v1/scheduler/jobs/:jobKey` state resource instead of pause and
      resume action routes. Every manual command requires a user-backed
      staff session, rejects API keys and contextual grants, attributes intent
      and completion to the actor, and rechecks all required permissions in
      each D1 mutation batch. Outbox processing is bounded to 500 due rows or
      100 explicit IDs; failed-message reset requires an explicit 100-row
      selection and processes only rows actually reset, so it cannot become an
      unbounded replay or send unrelated due mail. Reminder runs only queue
      durable mail; delivery remains a separate outbox operation or scheduled
      responsibility. Authorization for an external email side effect is fixed at the
      successful guarded D1 claim: a permission revocation after that atomic
      claim cannot recall a provider request already authorized and sent.
      Claim tokens retain at-most-once processing, and every later D1 batch
      still rechecks the live permissions. The former admin Email and Due Work
      consumers and their
      admin/internal handlers are removed rather than retained as parallel
      implementations; signed calendar RSVP ingestion now belongs to the
      canonical `/api/v1/calendar/rsvp` resource and the generic
      `/api/v1/internal` router is removed. Existing calendar UIDs and signed
      RSVP email addresses remain unchanged, so replies from already-issued
      calendar files continue through the same ingestion service. Old admin
      bookmarks return 404. Mounted
      permission, revocation, audit, reset-isolation, concurrency, schema,
      frontend, cache-policy, and route-removal regressions cover the cutover;
      the focused real Worker/D1 browser journey also verifies canonical
      traffic and retired-route behavior.
      Organization directory and profile management now also appears under
      the portal's System navigation while retaining the canonical domain API
      `/api/v1/organizations`. System is an interface grouping, not an
      authorization boundary. List and detail reads retain
      `organizations:read`; profile, contact, and logo mutations retain
      `organizations:write`; organization creation and staff identity
      invitations retain `membership:write`; immediate activation additionally
      requires `identities:activate`; and primary or secondary organization
      contacts retain their existing organization-scoped identity controls. The portal renders each allowed action from
      the live permission set, including organization creation without a
      directory read. One neutral schema and service boundary own the D1-side
      search, allowlisted sorting, counting, pagination, revision
      compare-and-swap, organization aggregate, flexible links, contacts,
      logo, and identity transitions. Primary and secondary contacts can invite
      coworkers with the minimum identity fields needed for an acting identity;
      the exact user must accept before capacity begins. User-backed staff with
      both `membership:write` and `identities:activate` may activate immediately
      only with a reason. Lifecycle changes and invitations enqueue their notices
      transactionally.
      Every mutation repeats its live permission and exact state predicates in
      the same D1 batch as the write and attributed audit record. The former
      admin Organization components, API handlers, route mount, and
      admin-prefixed schema/service aliases are removed; old bookmarks return 404. Mounted permission, API-key denial,
      revocation-race, revision-race, contract, query-plan, profile-contact,
      and frontend tests cover the cutover. A focused real Worker/D1 browser
      journey creates an organization, invites an identity, then signs in as
      that exact user to accept it. Ending the identity is immutable; a later
      role period creates a successor rather than restoring the old row.
      It also verifies the retired admin URL returns 404 and observes no legacy
      organization request.
      User and membership-capacity management now also appears under the
      portal's System navigation while retaining domain APIs:
      `/api/v1/users` owns account records, email aliases, headshots, access
      state, and anonymization, while `/api/v1/members` owns membership
      capacities. System remains only an interface grouping. Directory and
      detail reads require `users:read`; ordinary profile, alias, and headshot
      mutations require `users:write`; primary-email and transitional role
      changes additionally require `access:grant`; anonymization requires
      `users:anonymize`; and capacity creation, update, and removal require
      `membership:write`. The portal renders each action only when its exact
      permission set is present, and every API independently rechecks the same
      live user-backed authority. One neutral schema family and focused service
      boundary own D1-side search, filters, allowlisted sorting, counting,
      pagination, flexible profile links, capacity aggregation, and mutation
      guards. Email changes preserve the established verification flow and
      revoke affected sessions and capabilities; secondary-email, headshot,
      anonymization, and capacity mutations compare live identity and target
      state in the same D1 batch as the write and audit record. Canonical user
      responses do not expose R2 storage keys. The former admin Users and
      Members components, API handlers, route mounts, and admin-prefixed schema
      and service names are removed; old bookmarks return 404.
      Mounted authorization, API-key denial, lifecycle-race, query-plan,
      storage-compensation, contract, and frontend tests cover the cutover. A
      focused real Worker/D1 browser journey updates a user through the portal,
      verifies persistence, confirms the retired admin URL returns 404, and
      observes no legacy Users or Members request.
      The public current-headshot transport is also nested under its owning
      user resource at `/api/v1/users/:userId/headshots/:file`. The former
      standalone `/api/v1/headshots` router is removed without an alias, while
      existing R2 object keys remain unchanged. The route serves only the
      current D1-referenced object, preserves bounded image validation and
      public cache policy, and therefore immediately revokes replaced or
      removed pointers even when durable R2 cleanup is still pending. The
      current-user read model and absolute URL generator reuse one canonical
      path builder; mounted tests cover valid, malformed, oversized, replaced,
      and retired-route behavior.
      Current-user and organization self-service transport now follows those
      same resource boundaries. `/api/v1/users/current` owns the signed-in
      user's profile, selected active membership, notification preferences,
      headshot, group participation, and membership applications. Explicit
      `/api/v1/organizations/:organizationId` subresources own organization
      profile visibility, content reviews, logo staging, active sponsorship,
      identities, and secondary-contact nomination. The former
      `/api/v1/me` router and its EC-decision action endpoint are removed;
      self EC decisions use the same membership-application decision resource
      as staff overrides. Every self-service mutation repeats the exact live
      session, selected membership, organization capacity, contact role, and
      mutable-state predicates in the same D1 batch as its write and audit.
      Cross-organization requests fail closed, contact-added coworkers cannot
      smuggle staff-only profile fields, and user-facing timestamps remain UTC
      in storage and are localized only at the presentation boundary. Mounted
      Worker/D1, OpenAPI, frontend, and negative legacy-route tests cover the
      cutover without retaining a compatibility alias.
      Reusable form-definition management now uses the canonical Forms
      resource instead of an interface namespace. Global definitions are
      listed, created, edited, archived, placed, and analyzed under
      `/api/v1/forms`; event-owned definitions and response sets use
      `/api/v1/events/:eventSlug/forms`; group-owned definitions remain under
      their owning group routes. Anonymous event flows use the distinct
      `/api/v1/events/:eventSlug/forms/placements/:purpose` projection, so
      public form hydration cannot be confused with a staff catalogue. One
      neutral schema and service family owns definition, placement,
      submission, statistics, search, allowlisted sorting, counting, and
      pagination behavior. Top-level Forms routes expose only global
      definitions, event routes expose only definitions owned by or explicitly
      placed in that event, and group-owned definitions never leak through the
      global API. Global and event mutations repeat live user-backed
      `forms:write` or contextual `events:write` authorization in the same D1
      batch as the write and audit record. The former admin Forms components,
      handlers, route mounts, and admin-prefixed contracts are removed; the
      old bookmark returns 404 without retaining an API alias.
      Mounted ownership, permission, revocation-race, placement, submission,
      statistics, public-contract, OpenAPI, frontend, and route-removal tests
      cover the cutover. A real Worker/D1 browser journey creates and updates a
      global form through canonical requests and observes no admin Forms API
      request. Together with the permission-derived destinations above, this
      completes the global management migration; no admin shell or admin API
      implementation remains.
- [x] Replace hardcoded admin links in email, OAuth, and due-work paths.
      Evidence: one typed management-link adapter owns the semantic destinations
      used by MCP OAuth, membership due work, organization content review,
      sponsorship inquiries, checkout processing, and renewal due work. Every
      destination now resolves directly to the portal; the adapter contains no
      admin sign-in or admin-shell path. The consolidated migration is
      unapplied and archives the obsolete admin magic-link template.
- [x] Remove temporary legacy redirects rather than retaining them.
      Evidence: the application is unreleased and is its only API/UI consumer,
      so `/admin/` and `/sponsor-portal/` return 404. Canonical notification,
      scheduled-work, sponsor, and OAuth links target `/portal/` directly.
- [x] Remove the admin shell and its separate navigation.
      Evidence: the admin Hugo content, layout, loader entry, redirect bundle,
      navigation, and frontend tests are deleted. One portal application renders
      staff, member, sponsor, and MCP authorization views from live capacities.
- [x] Remove duplicate admin and member session assumptions.
      Evidence: `/api/v1/auth/request-link`, `/verify-link`, `/session`, and
      `/logout` are the only human authentication routes. Magic links and
      passkeys establish one `pkic_session` and one revocable `sessions` row;
      live staff and member capacities are resolved independently on every
      request, so loss of one capacity does not invent or preserve a separate
      identity session. The former `/api/v1/admin/auth/*`,
      `/api/v1/auth/member/*`, and `/api/v1/auth/portal/*` handlers, schemas,
      cookies, JWT types, and services are removed. MCP OAuth approval now uses
      the same portal session and canonical magic-link verification endpoint;
      the resulting scoped MCP access token and explicit service API key remain
      machine transports, not alternate human sessions. One neutral request-scoped D1 middleware
      authenticates staff on primary D1, applies causal read bookmarks, uses
      `first-primary` for writes, and rotates the already verified user or MCP
      token without a redundant replica session lookup. Focused tests cover
      staff-only, member-only, and combined capacities, retired routes,
      rejection of a validly signed legacy human JWT, live revocation and
      expiry, D1 bookmark rotation, passkeys, and email-change invalidation.
- [x] Remove legacy admin API routes after canonical consumers migrate.
      Evidence: no tracked `/api/v1/admin` handler or router remains, the root
      router has no admin mount, and the generated OpenAPI document contains no
      admin-prefixed operation. Domain and group APIs are the only mounted
      implementations; retired paths are covered as 404s rather than aliases.
- [x] Browser-test member, chair, inherited leader, local-only leader, staff,
      guest, and unauthorized navigation.
      Evidence: one real Worker/D1 journey provisions an approved member, a
      parent and two child groups, direct and inherited leadership, a
      local-only child with explicit local leadership, and a separate active
      staff identity whose membership has ended. Real mailbox-capability
      sessions prove direct and inherited management, local-only isolation,
      local management by a non-member staff identity, and anonymous API and
      portal denial. The external-guest journey separately proves that a
      verified occurrence-scoped guest session can enter its meeting but
      cannot authenticate to the portal. The six route-mocked persona tests
      remain fast shell/navigation contracts and are not counted as backend
      inheritance evidence.

## 11. Quality, security, and performance

Status: Complete

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
- [x] Run EXPLAIN QUERY PLAN assertions for all critical list and policy queries.
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
      the live voting-capacity predicate asserts primary-key/index lookups for
      the exact user, Member, category assignment, D1 voting policy, and active
      organizational representation without scanning any of those tables or
      creating a temporary B-tree;
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
      bounded to eight server-filtered identities; the canonical global audit
      page asserts that its default production query uses
      `idx_audit_log_created_at` without a full audit-log scan or temporary
      order B-tree. The focused group,
      statistics, mailing-list,
      meeting-entry, and grant selection passes 67 tests, followed by 38 tests
      after the read-time authorization guard was added. Event-day management
      now also asserts that its production attendance-count join uses indexed
      registration, day-attendance, and event-day lookups without a table scan.
      Both full and least-privilege event-registration lists now share one
      allowlisted sort-to-SQL mapping with qualified aliases; every supported
      sort is executed through the production page/count builders and asserts
      the event/status registration index without scanning the registration
      table. System Analytics asserts created-at index use for its bounded
      registration, invitation, and donation time series and the event-first
      registration index for the top-events projection; all-time aggregate
      totals intentionally read their complete tables. Group form discovery
      now exposes the exact production page/count builder to its regression;
      both statements prove indexed owner, grantee-capability, and live member
      access through `idx_form_placements_owner_active`,
      `idx_form_placement_group_grants_group`, and
      `idx_group_memberships_user_active` without scanning those tables.
      Proposal-review search, sorting, and pagination now expose the exact
      production page/count builder; both statements use
      `idx_proposal_reviews_proposal_round` without scanning reviews or users,
      while the bounded post-filter search and score sort may legitimately use
      a temporary B-tree. The global form catalogue now counts fields and
      submissions through indexed correlated projections instead of a
      field-by-submission join, while its lean count statement omits every
      page-only aggregate. The registration and proposal response populations
      expose their complete merged page/count builder to plan assertions; both
      use the form/context backfill index, native response-set index, and
      event/form-placement source indexes without scanning the correlated
      submission, answer, registration, or proposal aliases. Due Work and
      Email Outbox now also expose their exact production SQL
      builders to D1 plan regressions: due candidate discovery uses the partial
      outbox, co-speaker reminder, and event-retention indexes, while the
      due-now outbox page, count, and status aggregate all use the partial
      `idx_email_outbox_due` index. Complete status summaries intentionally
      aggregate the filtered population rather than hiding that work in the
      frontend. The reconciled critical-query inventory is complete; unindexed
      substring search and a
      final bounded merge sort remain documented D1 limitations rather than
      hidden client-side work.
- [x] Run migration tests against production-shaped databases.
      Evidence: the realistic pre-0035 upgrade scenario passes integrity and
      foreign-key checks without rebuilding members or organizations and
      preserves unattributed historical event-form projections.
- [x] Run migration tests against empty databases.
- [x] Run identity authorization security tests.
      Evidence: the canonical identity-management predicate is reused for
      preflight and an atomic D1 write guard. Race tests revoke an organization
      contact role and demote a staff administrator after preflight but before
      commit; both commands return a bounded conflict and roll back the
      identity change, audit record, notification, and enrollment
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
      Current evidence: 58 focused meeting-entry, guest-invitation, OpenAPI, and
      cache-policy tests cover exact member-session binding,
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
      Current evidence: the complete gate passes on the exact architecture and
      browser-evidence state with 2,514 passing backend tests (one skipped),
      512 frontend tests, and 98 tooling tests. Type
      checks, ESLint, SQL projection,
      dependency architecture, API-contract, changed-scope duplication,
      formatting, frontend/Hugo builds, max-lines, and filename gates also pass.
      An earlier combined run exposed a nondeterministic Google Groups boundary
      fixture that ordered same-timestamp groups by random user UUID. The test
      now gives the recipient groups an explicit order; its focused suite and
      the subsequent uninterrupted complete gate both pass. An earlier combined
      run also identified one 607-line test file; the meeting cases were
      separated into a focused file. The email renderer
      now applies shared output, expansion, cumulative-work, depth, and subject
      budgets across body, partial, loop, layout, campaign-custom-text, preview,
      and outbox paths. Focused regressions prove abusive expansion fails closed
      before delivery and is terminal rather than retried.
- [x] Run focused Playwright flows while iterating.
      Current evidence: the route-mocked six-persona suite remains a fast portal
      shell contract. Backend governance is now covered separately by a passing
      real Worker/D1 journey with actual email-capability sessions, disposable
      group hierarchy and membership state, direct and inherited leadership,
      local-only isolation, scoped non-member staff management, and anonymous
      denial. The real guest meeting-entry journey also passes after asserting
      that its verified occurrence session does not establish portal identity.
      A separate real Worker/D1
      journey signs in as an event program manager, reads proposals through the
      selected-group API, edits an accepted abstract, previews and records a
      final decision, and reads the resulting audit history without an admin API
      fallback. The global audit-log journey signs in through the neutral
      portal flow, renders D1 audit data through the canonical audit-log API, and
      proves direct portal navigation makes no request to the removed admin
      audit endpoint; retired admin pages now return 404.
      The current seven-test browser checkpoint also covers membership-setting
      and category updates, canonical group vote creation, member proposal
      submission and moderation, waitlist transitions, and both portal and
      compatibility proposal-detail paths. The public-shell round adds focused
      real Worker/D1 journeys that create and configure a standalone portal
      event, load all eight public flow shells, render the registration form,
      and follow an actual waitlist registration through emailed confirmation
      and self-management URLs. The System Leadership round also
      signs in with real user-backed authority, creates and removes a Board
      position through the canonical portal API, verifies the public roster,
      verifies the retired admin URL returns 404, and proves that no removed
      admin endpoint is requested. The proposal-moderation browser journey now uses
      an exact action-bearing row locator so the expanded detail row cannot be
      mistaken for its parent proposal row. In the current browser checkpoint,
      51 of 52 tests passed in one freshly seeded Worker/D1 run; the remaining
      sponsor-portal test exposed one stale test-only request to the removed
      admin event-detail URL and passes after using the canonical event resource.
      A later uninterrupted full gate remains required before final handoff.
      This browser work also exposed four event-management specs sharing one mailbox against
      the production-equivalent three-request email rate limit; each spec now
      uses its own explicitly seeded test identity without weakening the
      production control.
      The affected System Analytics and membership-join browser journeys pass
      together in a focused three-test run, including all three focused
      analytics endpoints.
      A focused real Worker/D1 donation journey signs in through the portal,
      reads the canonical donation list, detail, and promoter views, confirms
      the retired admin URL returns 404, and asserts that no removed admin
      donation API is requested. Stripe remains mocked and SendGrid remains
      intercepted. The focused System Operations journey now also loads the
      scheduled-job registry, pauses and resumes one job through the canonical
      PATCH resource, and proves the removed pause and resume action routes are
      not requested.
- [x] Run the complete pnpm run test:e2e gate because navigation and portal
      workflows change.
      Evidence: the complete 79-test Playwright gate passes uninterrupted in
      15.9 minutes against freshly seeded local Worker, D1, R2, mocked Stripe,
      and intercepted SendGrid environments. The first exact-state run passed
      78/79 and exposed one stale selected-group proposal test that still
      expected the former always-rendered Audit Log and Speakers sections. The
      shared proposal detail now intentionally lazy-loads those resources
      behind accessible tabs. The journey now activates each tab, waits for the
      canonical audit response, and continues to assert that no retired admin
      API is requested; it passes both focused and within the uninterrupted
      79/79 rerun. The gate covers public flows, portal authentication,
      membership and organization policy, selected-group management, every
      permission-derived global destination, sponsor access, narrow and
      keyboard navigation, role/persona boundaries, invitations, proposals,
      registrations, meetings, votes, and checkout behavior.
- [x] Inspect browser rendering for desktop, narrow navigation, keyboard access,
      error, empty, loading, and pagination states.
      Evidence: the identity phase covers real-browser desktop and 390x844
      rendering, accessible drawer and keyboard behavior, staff/member/dual-
      capacity login and logout, cross-identity rejection, and live-capacity-
      loss states. A real portal sign-in plus an isolated audit-log transport
      fixture now exercises the shared server collection through a delayed
      loading state, exact empty state with no pager, first and second bounded
      pages with server offsets and content replacement, and an API failure
      rendered as an assertive error alert. The role/persona matrix is covered
      by the real Worker/D1 evidence above.
- [x] Run a final security diff review and resolve validated findings.
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
      found no remaining path for the original finding.
      Final Codex Security scan `d9ff8252-a67a-423a-a28e-fe94bdfd8b95`
      reviewed all 1,008 source-like changed paths in the exact committed range
      `bb22b0e8..7360f5bb` and reported one low-severity authorization race. A
      group form definition could be authorized by its summary query and then
      return confidential fields after its live grant, membership, or manager
      role was revoked. Commit `16c05e34` now prepends the same canonical live
      resource-capability evidence to every definition-enrichment D1 batch and
      fails closed as `FORM_NOT_FOUND`. The original runtime reproducer now
      returns that 404, deterministic tests cover all three revocation races,
      positive owner/member/shared/manager access remains green, and an
      independent post-fix bypass review found no remaining path. The complete
      gate above passed on the fixed commit.
- [x] Audit every requirement in ARCHITECTURE.md against current evidence.
      Current evidence: the 2026-08-28 requirement-by-requirement audit confirms
      that the installation/group boundary, configurable group types,
      hierarchy and governance inheritance, explicit capacity-aware
      participation, organization representation, conditional enrollment,
      normalized resource ownership, capability implications, meeting and
      attendance model, live-editable forms, Member/person voting, canonical
      group route shapes, D1-side collections, atomic commands, durable outbox,
      additive migration strategy, and no-production-data rule agree with the
      accepted architecture and their focused evidence above. The final whole-
      PR security scan and remediation close the only validated finding in the
      committed range. The shared resource evaluator covers the canonical group
      form, event, vote, and mailing-list paths. Subsequent vertical slices
      removed the remaining admin event, proposal, and global APIs, and the
      single-portal authentication slice removed the last admin and sponsor
      HTML shells without compatibility redirects. Ownerless/global event
      actions remain deliberately excluded in favor of group-owned creation.
      A static route-boundary regression now requires the mounted API roots to
      match the approved resource-domain set exactly. The mixed
      `/api/v1/og` technical bucket is removed: registration badges are served
      by `/api/v1/registrations/referrals/:code/badge`, donation badges by
      `/api/v1/donations/checkouts/:sessionId/badge`, and mounted tests prove
      the retired API URLs return 404. The separate public `/og/*` website
      representation remains available for existing Open Graph card links.
      Registration self-service now uses the nested capability resource
      `/api/v1/registrations/access/:token`; the actor-oriented
      `/api/v1/registrations/manage/:token` family is absent from routing and
      OpenAPI without an alias. Its existing stateless, secret-generation-bound
      authorization model is unchanged. Proposal and proposal-speaker
      self-service now follow the same resource model under
      `/api/v1/proposals/access/:token` and
      `/api/v1/proposals/speakers/access/:token`. Participation, profile,
      headshot, presentation, and reminder preferences are nested resources
      expressed through HTTP methods; the actor-oriented `/manage` and
      singular `/speaker` paths, reminder action path, and presentation
      download action path are absent without aliases. One shared path builder
      serves browser and Worker URL producers, while the existing stateless,
      time-limited, recipient-bound, secret-generation-bound capabilities
      remain unchanged and create no session or cookie.
      Migration 0035 remains consolidated and locally verified. Read-only
      Wrangler checks on 2026-08-30 confirm that it is the sole pending
      migration in both preview and production. The implementation checklist is
      complete; the retained manual local/preview matrix remains the
      authoritative pre-approval evidence still to be executed.

## 12. Pull-request handoff

Status: Complete

- [x] Keep the PR description current after every completed phase.
- [x] Push normal, descriptive commits after every coherent round.
- [x] Do not force-push routine implementation history.
- [x] Include migration status and manual application instructions.
- [x] Include a comprehensive manual-test checklist.
- [x] Separate automated evidence from manual tests still required.
- [x] Do not approve the stacked PR automatically.
- [x] Preserve PR3 and its branch as the rollback/reference point.
      Evidence: the draft PR #7 description was replaced on 2026-08-30 with the
      cumulative PR #1/PR #3/PR #7 architecture, the domain-only API inventory,
      current migration instructions, the exact `pnpm check` and uninterrupted
      79-test Playwright evidence, the documented `manage_attendance` versus
      `manage` admission boundary, and a comprehensive local/preview manual
      matrix. GitHub confirms the published body contains the completed VIP
      design and no longer presents it as an open decision. The implementation
      history consists of normal, descriptive commits and normal pushes. PR #7
      remains a draft and was not approved. PR #3 remains open at its unchanged
      `codex/pr1-remaining-architecture-security-fixes` head `bb22b0e8` as the
      base and rollback/reference point.

## 13. Group-centered portal navigation cutover

Status: In progress (2026-08-30)

- [x] Declare portal navigation once: sections, labels, access rules, capacity
      fallbacks, and the active-section highlight derive from one manifest in
      `assets/ts/member-flows/portal/shell/portal-navigation.ts`; the shell's
      route guards consume the same section predicates.
- [x] Replace the Management entry and managed-group dropdown with a
      group-centered sidebar: joined and managed groups render beneath the
      Groups entry and link straight into `/portal/#/groups/:groupId/:view`.
      The former bare management landing (group creation, managed-group
      catalog, proposal programs) moved onto the Groups page behind the same
      capability checks, and `/portal/#/management` URLs redirect into the
      groups section.
- [x] Rename the selected-group dispatcher to `GroupWorkspace`, drop its
      picker, lazy-load every tab view, and pass the route's `resourceId`
      through so sub-resources are URL-addressed.
- [x] Surface the System interface grouping as one permission-gated
      "Administration" sidebar entry; routes remain `/portal/#/system/...`.
- [x] Move account settings into an accessible user menu (new shared `Menu`
      primitive following the WAI-ARIA menu-button pattern); the `/account`
      route is unchanged.
- [x] Unify the two HTTP client wrappers: `shared/api-client.ts` gained
      unauthorized and error-payload interceptors, the portal registers them at
      bootstrap (session expiry clears auth, records the return path, and
      re-authentication restores it), and `portal/api.ts` was deleted with all
      call sites migrated.
- [x] Close the bundle blind spots: a named `vendor` chunk (Rolldown
      `codeSplitting.groups`), a CSS budget gate wired into `pnpm check`, and
      dev artifacts in `public/js/built` cleaned before every build.
- [x] Update the Playwright suites to the new navigation and re-run the
      affected projects; refresh the persona and system specs that asserted
      the retired Management and System entries.
- [x] Extend group event, meeting, and form detail views to the URL-addressed
      resource pattern already used by votes.
- [x] Show role and permission context in the account view instead of the
      navigation: the sidebar group list carries names only, the user button
      is an avatar (member headshot with initials fallback), and the account
      view summarizes member capacities, staff permissions with scopes, and
      sponsor capacities.
- [x] Dissolve the administrative grouping into domain-first navigation:
      Users, Organizations, Membership applications, and Donations are
      permission-gated sidebar domains at `/users`, `/organizations`,
      `/membership/applications`, and `/donations`; superseded
      `/portal/#/system/...` URLs redirect; the residual grouping is the
      "Settings" entry (analytics, membership settings, content reviews,
      audit log, email templates, operations, access control, leadership
      positions). The membership-application notification link emits the
      canonical domain URL.
- [ ] Organization workspaces for acting identities: authorize organization
      self-service by active representation instead of the acting session
      capacity, add the `/api/v1/users/current/organizations` feed, reach
      each represented organization from the avatar menu at
      `/portal/#/organizations/:organizationId`, and retire the acting-capacity
      "My Organization" special case.
- [ ] Root-level surfaces are projections, canonical homes are groups: the
      portal /events (and any root meeting surface) becomes a cross-group
      overview — upcoming events from the audience feed with the viewer's
      own registration state, linking to public pages and into the owning
      group's event workspace for management — while the group event
      workspace absorbs the global-only tabs (promoters, analytics, team,
      sponsor tiers, full settings editor). The /events/:slug management
      workspace then retires behind an owner-group redirect. Verify that
      event-scoped grant holders without group membership reach the group
      event routes through the resource-grant evaluator before retiring the
      global management surface. This resolves the audit's duplicated-
      surface cluster toward the group context and aligns portal placement
      with the API's ownership model.
- [ ] Execute the portal UX audit (2026-08-30; ~249 findings across 78
      files, catalogued per house rule with file:line) in four waves:
      Wave 1 landed 2026-08-30: shared `ConfirmDialog` (promise-based,
      consequence list, typed confirmation for irreversible operations —
      user anonymization requires retyping the email, retention redaction
      requires typing REDACT), `RowActions` (status + ⋯ menu cell), and
      `EmptyState`/labeled `Spinner` primitives exist with tests; every
      portal `window.confirm` call and inline destructive row button is
      converted except the events detail surfaces (Team revoke, proposal
      cancel-accepted) and `assets/ts/shared/headshot/controller.ts`, which
      is shared with public event-flows pages that do not mount
      `ConfirmDialogHost` (TODO comment in place; mount a host per
      event-flow root or keep native confirm there). A signed-in visual
      walkthrough of the seeded portal validated the dialogs live and its
      findings (legacy `main h5` uppercase leak — fixed with a portal-scope
      reset; menu focus scrolling the document — fixed with preventScroll;
      row-menu popups clipped by the table overflow wrapper — fixed with
      fixed-position popups; layout/empty-dashboard/machine-vocabulary
      items) are recorded in the audit artifact's walkthrough section.
      Follow-up feedback landed 2026-08-30: the recurrence editor now
      composes a shape with a free interval (every N weeks/months, N <= 26)
      instead of fixed presets, and supports ad-hoc single meetings through
      "Does not repeat", stored as the RFC 5545 sentinel `FREQ=DAILY;COUNT=1`
      so the `event_series.recurrence_rule NOT NULL` column and the
      ICAL.Recur expansion stay untouched (expands to exactly one occurrence;
      covered in tests/event-series-platform.test.ts). The group workspace
      now titles itself by the group's name (generic "Group" heading
      removed), orders tabs by user priority (people and activity before
      administration), and its Overview surfaces upcoming events and open
      votes as links into their owning tabs.
      Live-reported navigation defects fixed 2026-08-30: the group surface
      collapsed onto ONE route (`/groups/:groupId/*` parsed inside the shell)
      so moving between views, event sub-tabs, and groups changes props on
      the same mounted GroupWorkspace instead of unmounting across three
      route patterns (which blanked the screen with no spinner on
      cross-pattern moves such as browser Back into an event). Switching
      groups now treats the previous group's retained data as absent —
      "Loading group…" renders immediately instead of the stale workspace,
      whose still-mounted tab bar previously linked BACK into the group
      being left (fast click on Events after a sidebar switch landed in the
      old group's events). Tab hrefs now derive from the route's groupId,
      never fetched data. Regression tests:
      tests/frontend/portal-group-switching.test.tsx. The duplicated
      workspace screenshot could not be reproduced against a production
      build (scripted browser walkthrough + jsdom harness) and is attributed
      to vite dev HMR remounting after hot edits.
      Create-behind-action landed 2026-08-30: `ApiDataTable` gained an
      optional `createAction` rendered in the same toolbar row as search and
      refresh (the interim placement until the design update), and every
      list's New/Add affordance moved there; default-visible create forms
      (group members, leadership, meeting guests, meeting series, event
      team, coworkers) now render only behind their action with a Cancel.
      Organization and sponsorship logos became SVG-only with sanitize-by-reconstruction:
      uploads are reparsed through resvg's usvg tree (scripts, handlers,
      metadata, comments, DOCTYPEs, and editor cruft cannot survive),
      embedded rasters and entity declarations are rejected outright,
      paint-order-first full-canvas background rects are dropped, the
      viewBox is cropped to the rendered content's bounding box, and root
      width/height are removed for responsive embedding
      (functions/_lib/utils/svg-logo.ts). The pipeline is proven shared
      three ways: one reader used by all three upload routes, a
      parametrized backend matrix demanding byte-identical stored output
      across the organization and sponsorship endpoints
      (tests/svg-logo-uploads.test.ts), and a real-browser Playwright
      spec from file picker to served bytes
      (tests/e2e/svg-logo-upload.spec.ts) — which immediately caught
      that the staff organization uploader had been JSON-stringifying
      the File (the original "upload fails" defect); it now uses the
      shared replaceFile helper.
      The portal page also stopped inheriting public-site chrome (member
      logo wall, edit-on-GitHub) and the login card breathes on mobile;
      passkeys correctly hide on non-secure origins such as LAN http.
      List-hygiene and people-first pass landed 2026-08-30: single-page
      lists show a quiet item count instead of pager chrome; constant
      "Active" badge columns went quiet (state renders only when it
      deviates); duplicate section/card headings removed portal-wide; the
      remaining dead-end empty strings became actionable EmptyStates wired
      to each list's create action. New `PersonCell` renders people
      face-first (headshot/initials, name leading, email as the second
      line) and the Users list adopted it — the monospace email column,
      red lowercase role badges, and the inline role dropdown are gone;
      administrator grant/revoke now lives in the row menu behind
      consequence-stating confirmations. New `DetailsSummary` replaced the
      three raw JSON.stringify audit-detail blocks with humanized
      key/value rendering (deep payloads keep a collapsed raw view), and
      the roles table summarizes large permission sets instead of flooding
      chips.
      Waves 3 and 4 landed 2026-08-30, completing the four-wave audit
      execution. Wave 3: `Tabs` renders real links via `hrefFor` (event
      workspace, event detail/settings/proposals/promoters, donations), the
      group form and meeting-series detail tabs became URL segments through
      the existing `resourceTab` route parsing, and `ApiDataTable` gained
      `urlState` — search, sort, offset, and page size mirror into
      namespaced query parameters carried INSIDE the hash
      (`#/users?users.q=…`, matching the verify flow's URL shape, so list
      state never reaches the server) on thirteen primary lists (users, groups,
      organizations, events, donations, templates, sponsorships, forms,
      applications, roles, grants, audit, outbox), initialized from the URL
      on mount and cleaned up on unmount so links are shareable and the
      back button restores list state (verified live in a browser
      walkthrough). Wave 4: `PersonCell` (landed earlier with the users
      directory) plus `EntityLink` with the permission-aware
      `portalEntityHref` resolver — audit-log actors and entities now link
      to their canonical routes when the viewer may reach them and degrade
      to plain text otherwise. Still local by design: proposal detail
      sub-tabs, occurrence detail tabs, and the communications/campaign
      editors (no route homes yet; queued with the events projection
      consolidation).
      Events projection consolidation, first two slices, landed
      2026-08-31: the root /events list became the audience overview —
      upcoming events with humanized venue-aware dates, relative time, the
      viewer's own registration state (per-day chips), the owning group as
      a link, and an Upcoming/Past toggle; slugs, ISO dates, the Mode
      column, admin count columns, capability chips, and per-row Manage
      buttons are gone (row click opens the event's public page; a row
      menu offers "Open in group workspace" for management-shaped rows).
      The group event workspace absorbed the standalone surface's Team,
      Promoters, and Analytics tabs by reusing the slug-driven detail
      components — Promoters/Analytics gated on manage_attendance rather
      than the bare view floor, since view is the visibility minimum every
      accessible event carries. The last native confirms on the events
      surfaces (team-role revoke, presentation-version delete, proposal
      moderation flags) moved to the shared dialog; "Cancel accepted
      session" turned out to already be a deliberate comment+checkbox form
      and was left as designed. A duplicate-affordance defect from the
      create-behind-action pass was fixed globally: EmptyStates no longer
      repeat the toolbar's create button (one affordance, one place), which
      also restored strict-mode e2e locators. Closing slice landed the same day: the group route parses a fourth
      segment, so registration and proposal details render inside the group
      event workspace (/groups/:g/events/:e/registrations/:rid and
      /proposals/:pid) with URL-addressed selection; every standalone
      /events/:slug management view resolves the owning group and redirects
      into the group workspace (replace navigation), while events without
      an owning group keep the standalone surface as the deliberate
      fallback. Two more Wave-1 e2e misses surfaced and were fixed
      (invitation resend/revoke through the row menu, the two approve
      confirms), a duplicate-affordance defect was corrected globally
      (EmptyStates no longer repeat the toolbar create button), and the
      row menu now repositions on scroll instead of dismissing.
      All four waves are complete. Residuals folded into the events
      projection consolidation:
      (1 residue) events-surface confirms after the projection slice;
      (2) EmptyState + labeled Spinner + DetailsSummary
      close the blank/raw-payload states through the shared table and error
      components; (3) routed Tabs and query-param ApiDataTable state make
      tabs, filters, sorts, and pages shareable URLs; (4) PersonCell +
      EntityLink close the dead-end and faceless-people findings, including
      audit-log actors and entity references. Duplicated surfaces (§10)
      collapse onto the group-context implementations as each is touched.
- [ ] Close the request-contract blind spot: `lint:api-contracts` verifies
      response schemas but request bodies leave the client unparsed, so a
      frontend can emit a contract-violating request with every gate green
      (caught 2026-08-30 when the representative link form sent
      `kind: "user"` instead of `kind: "existing_user"`). Helper landed
      2026-08-31: `postValidated`/`patchValidated`/`putValidated` in
      `assets/ts/shared/api-client.ts` parse the body through the shared
      request schema synchronously before fetch and adoption covered the
      representative roster, group member add, vote create, mailing lists,
      and role forms (the stricter inferred types immediately replaced
      loose `Set<string>`/string fields with the `Permission` union).
      Remaining: migrate the rest of the mutating call sites and extend the
      contract lint to require the validated helpers for any request whose
      shared schema exists; until then, mock-based frontend tests parse
      captured bodies through the shared schemas (rule added to
      tests/AGENTS.md).
      Consistency batch landed 2026-08-31: `Badge` became the canonical
      status registry — `statusLabel`/`statusColor` are exported and every
      ad-hoc `STATUS_*`/`ROLE_*` map, title-casing helper, and duplicated
      stage formatter across the portal was folded onto it (fixing the
      literal "Ec Review" class of label; application stages now match the
      real `ApplicationStage` vocabulary, and waitlist, sponsorship
      pipeline, vote outcome, scheduled-job, and speaker-role statuses are
      registered). `ErrorAlert` now maps transport errors
      (401/403/404/409/429/5xx) to plain-language sentences via
      `friendlyErrorMessage`; raw "HTTP nnn" strings no longer reach users.
      Inner tabs without route homes (form management, campaign editors,
      proposal detail, occurrence detail) moved onto
      `useHashQueryParam` — hash-internal query params
      (`#/path?formTab=edit`) that initialize from the URL, mirror on
      change, and clean up on unmount, making the last local tabs
      shareable and fixing a latent proposal deep-link reset. Date-only
      columns portal-wide render through `formatDate` (no meaningless
      midnight times).
- [x] Member-visible group roster (2026-08-31): participants can now see
      who is in their group. `GET /api/v1/groups/:groupId/memberships`
      branches on the caller's live capabilities — `manage` keeps the full
      membership rows; `participate` receives a reduced projection
      (`userId`, `name`, `headshotUrl`, `organizationName`) whose SQL never
      selects email, category, source, or timestamps; anyone else gets 403.
      The Members tab shows for participants as a read-only, searchable
      PersonCell roster (organization as the second line, never email) with
      no management affordances. Authorization tests prove the participant
      payload carries no email in the raw JSON and the query-plan test
      confirms the roster query stays on
      `idx_group_memberships_group_active`.
- [ ] Add an index for `session_proposals.proposer_user_id` in the
      consolidated branch migration: the new `/users/current/proposals`
      submitter branch currently scans the table (flagged by its
      explain-plan check; the speaker branch uses the existing unique
      index).
- [x] Keep one canonical user while making organization profiles and authority
      identity-scoped. `identities` owns the selected verified `user_emails`
      address, job title, biography, and links; organization-less identities are
      limited to approved H5/H6/H7 Members and cannot self-assert an affiliation
      or job title. Verified aliases sign into the same user and are rechecked in
      the redemption batch; removing a selected alias atomically falls affected
      identities back to the primary address. Membership-application history
      binds to the canonical user before approval and the resulting identity and
      Member afterward, never to a reusable email string. Group participation,
      leadership, and session authority require an exact active identity and
      are revoked when it ends. Current-user, organization management, public
      directory/leadership, digest, importer, frontend, authorization-race,
      application-ownership, alias-lifecycle, and multi-identity regressions
      cover the boundary.
- [ ] Retire or repurpose the dormant `users.role` value `guest`: only
      `admin` has behavior (full-access short-circuit); `user` is the
      default; `guest` has zero behavioral references. Either it becomes the
      role of identity-first auto-provisioned participants or it leaves the
      vocabulary. Move role editing out of the users table's inline dropdown
      into the user detail access panel with confirmation — changing
      admin-ness is a high-impact act, not a row-level toggle.
- [ ] Identity-first participation: participation flows (event registration,
      proposals, guest invitations, donations) auto-provision a user record
      for the participant; sign-in eligibility becomes "a user record
      exists", with no stored credential by default — the enumeration-safe
      magic link to the verified address activates a session, and passkeys
      stay optional. A capacity-less guest session sees only its own
      participation records and the account view; capability links remain
      the no-account fallback and never become sessions. New
      participation-record feeds under `/api/v1/users/current` gate on the
      authenticated user, not member capacity, so guests inherit them, and
      the guest dashboard carries the become-a-member invitation.
- [ ] Participation records: a "My participation" view reached from the
      avatar menu over self feeds (applications, donations, registrations,
      proposals as a read-only projection with resend-capability-link
      actions, ballot history); the sidebar drops the always-visible My
      Application entry while the Home dashboard keeps surfacing active
      items.
- [ ] Sign-in dashboard ("your consortium this week"): self-scoped
      participation feeds for votes, upcoming meetings, and open forms under
      `/api/v1/users/current/...`, composed with groups, events, applications,
      and pending organization reviews into the default landing view.

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
- read membership workflow settings with `membership:read`, change them with
  `membership:write`, and confirm a read-only user cannot save;
- edit a category label, description, display order, and voting policy, then
  confirm the change is visible after reload;
- submit stale membership-setting and category revisions and confirm both are
  rejected without overwriting the newer values;
- enable and disable voting for a seeded non-voting category and confirm ballot,
  proposal, notification, concern, and statistics eligibility changes
  immediately;
- verify the retired `/api/v1/admin/membership-settings` and
  `/api/v1/system/membership-settings` routes and the old admin bookmark return
  404;
- inspect the complete membership-application definition with
  `membership:read`, edit its title and dynamic questions with
  `membership:write`, and confirm the public join form reflects the change
  immediately without an Admin Forms request;
- deactivate and reactivate the membership-application definition, confirm
  public collection closes and reopens coherently, and confirm archived
  questions remain historical after later edits;
- verify `/api/v1/admin/forms` and its nested paths return 404, while
  `membership-application` remains available only through the membership
  application definition API;
- create, edit, archive, and reuse a global form through `/portal/#/forms`,
  confirm event and group definitions remain visible only in their owning
  contexts, and confirm the browser makes no admin Forms request;
- list and search email templates with `email-templates:read`, then confirm a
  read-only staff user can inspect content and history but cannot preview,
  create, save, or activate a version;
- create a draft email-template version with `email-templates:write`, render its
  HTML and text previews, activate it, reload the portal, and confirm the active
  version is used immediately;
- submit competing template-version creation and activation requests and
  confirm one coherent version wins, only one version is active, and failed
  writes leave neither partial state nor an audit record;
- verify `/api/v1/admin/email-templates` and its nested paths return 404 and the
  old `/admin/#/email/templates` bookmark also returns 404;
- inspect Access Control with separate `access:grant`-only and
  `access:revoke`-only staff identities, confirming each mutation control is
  shown only for its exact permission;
- create and remove a custom role, assign and revoke a role for a staff user,
  and create and revoke an event-, group-, and organization-scoped direct
  permission through `/portal/#/system/access-control`;
- revoke a global administrator role and confirm the target's existing session
  stops working immediately, while an intentionally raced failed revocation
  leaves the target's authority and session unchanged;
- verify `/api/v1/admin/access-grants`, `/api/v1/admin/roles`, and nested admin
  user-role paths return 404 for an authenticated operator, and the old
  `/admin/#/access-control` bookmark also returns 404;
- inspect the global leadership roster with separate `access:grant`-only and
  `access:revoke`-only staff identities, confirming add/edit and remove controls
  appear only for their exact permission;
- create, update, and remove current and past Board and Executive Council
  positions, with and without an organization affiliation, and confirm the
  public roster displays the same current and historical state;
- verify `/api/v1/system/leadership-positions`, `/api/v1/admin/leadership-positions`,
  and their nested paths return 404, and the old `/admin/#/leadership`
  bookmark also returns 404;
- inspect the System Analytics overview with an `analytics:read` staff user and
  confirm an unrelated global permission, API key, and unauthenticated request
  cannot read it;
- open Overview, Registrations, and Donations independently, confirm each tab
  calls only its matching `/api/v1/analytics` endpoint, and verify the
  displayed totals, trends, top events, and donation periods against seeded D1
  data;
- verify `/admin/`, `/admin/#/dashboard`, and `/admin/#/stats` return 404 and
  direct `/portal/#/system/analytics` navigation makes no request to
  `/api/v1/admin/stats`;
- inspect Donations with a `donations:read` staff user and confirm an unrelated
  permission, API key, and unauthenticated request cannot read the resource;
- search, filter, sort, and paginate donations and promoters through
  `/api/v1/donations`, open a donation detail, and reconcile a bounded set with
  `donations:sync` while Stripe is mocked and delivery is intercepted;
- revoke `donations:sync` after Stripe returns but before the next D1 operation
  and confirm the reconciliation fails without persisting the raced update or
  its audit result;
- verify `/api/v1/admin/donations` and nested paths return 404 and the old
  donation and promoter bookmarks also return 404;
- inspect Sponsorships with a `sponsorships:read` staff user and confirm an
  unrelated permission, API key, and unauthenticated request cannot read the
  pipeline or tier-pricing catalog;
- search, filter, sort, and paginate sponsor companies and sponsorships through
  `/api/v1/sponsors`, create and edit a record, advance its stage, inspect
  its event history, and upload and remove a non-member logo with
  `sponsorships:write`;
- edit sponsorship tier amount, currency, and active state in the portal,
  reload it, and confirm public checkout immediately uses the D1-backed value;
- revoke `sponsorships:write` after route authentication but before the D1
  mutation and confirm state, history, audit, outbox, and any newly uploaded R2
  object are not retained;
- verify `/api/v1/sponsorship`, `/api/v1/sponsorships`,
  `/api/v1/sponsor-portal`, and `/api/v1/auth/sponsor-portal` return 404; old
  list and detail bookmarks also return 404; and inquiry,
  checkout, renewal, and activation emails contain portal management links;
- redeem a sponsor access link through `/api/v1/auth/verify-link`, confirm only
  `pkic_session` is set, verify `/api/v1/auth/session` lists every active
  sponsor capacity for that identity, and confirm changing the contact email,
  tier entitlement, or sponsorship stage removes access immediately;
- inspect Operations with separate `email:read`, `retention:read`, and
  `scheduler:read` staff users, confirming each sees only its readable tab and
  no command controls;
- add `email:manage` and confirm the outbox exposes only bounded processing and
  explicit selected-row reset, then verify a selected failed-row reset neither
  resets nor sends an unrelated due message;
- add `scheduler:manage` and each selected job's required domain permissions,
  confirm its Run now control appears, and verify jobs missing any required
  permission remain non-runnable; pause and resume one job through the canonical
  scheduled-job state resource;
- revoke a scheduler or job-domain permission between request authorization and
  its first D1 batch and confirm the state update or lease claim and its audit
  row roll back;
- verify `/api/v1/admin/email/outbox`, `/api/v1/admin/due-work`, and the retired
  internal email/job/reminder/retention routes return 404, while the old Email
  and Due Work bookmarks also return 404;
- inspect Organizations with separate `organizations:read`,
  `organizations:write`, and `membership:write` staff identities, confirming
  list/detail, profile/logo/contact, and create/identity actions appear
  only with their exact permissions;
- create an organization with multiple identities, identity-scoped job titles, flexible
  profile links, and a membership category; then edit its profile and contacts,
  invite and accept an identity, end it, create a successor for a later role period, and confirm stale
  revisions and permission revocation cannot leave partial state or audit records;
- confirm a primary or secondary organization contact can manage allowed
  identity visibility and ending from My Profile without
  gaining the global organization directory or staff-only direct-email provisioning;
- verify `/api/v1/admin/organizations` and nested paths return 404 and the old
  Organizations bookmark also returns 404;
- inspect Users with separate `users:read`, `users:write`, `access:grant`,
  `users:anonymize`, and `membership:write` staff identities, confirming the
  directory and every profile, email, role, anonymization, and membership
  control appears only with its exact permission set;
- search, filter, sort, and paginate `/api/v1/users`, then edit a user's profile
  and flexible links, add and remove a secondary email, upload and remove a
  headshot, and confirm the canonical responses never expose R2 storage keys;
- change a primary email through the established verified-email workflow and
  confirm the old address cannot authenticate, while an authorized staff
  correction retains its intended behavior and revokes affected sessions and
  capabilities;
- create, update, and end individual and organization identities
  capacities through `/api/v1/members`, then race identity deactivation,
  anonymization, or permission revocation and confirm no partial capacity or
  audit state is retained;
- verify `/api/v1/admin/users`, `/api/v1/admin/members`, and nested paths return
  404 and the old Users bookmark also returns 404;
- create, preview, send, search, resend, and revoke attendee and speaker
  invitations from the selected-group event view;
- verify the retired admin event-invitation APIs and old attendee and speaker
  invitation bookmarks return 404;
- verify the admin and sponsor-specific HTML shells are absent and no duplicate
  authentication or management workflow remains.
