# Group Platform Data Model

Status: Accepted design; implementation in progress

Database: Cloudflare D1 and SQLite

## Modeling rules

- Tables represent durable business facts, not individual screens.
- A relationship has one authoritative representation.
- Foreign keys prevent orphan records.
- Temporal rows use joined or created timestamps plus an explicit end timestamp.
- Mutable policy vocabularies are shared application schemas or reference data,
  not restrictive table checks.
- JSON may hold flexible form configuration or provider metadata. It does not
  hold authoritative memberships, permissions, ownership, ballots, attendance,
  or indexed eligibility fields.
- Applied production tables evolve additively. Unreleased migration 0035 may be
  corrected in place.

## Generic groups

### group_types

Configurable labels and defaults for groups.

    key, primary key
    singular_label
    plural_label
    description
    default_governance_inheritance_mode
    default_eligibility_mode
    default_automatic_enrollment_mode
    default_allow_automatic_opt_out
    default_visibility
    active
    created_at
    updated_at

The key is stable reference data. Initial records are working_group, board,
committee, chapter, and community. Code does not branch on those values to
create separate domain implementations.

### groups

Replaces the unreleased working_groups table.

    id
    type_key -> group_types.key
    parent_group_id -> groups.id, nullable
    name
    slug
    description
    links_json
    visibility (public, authenticated, participants, or managed)
    governance_inheritance_mode
    eligibility_mode
    automatic_enrollment_mode
    allow_automatic_opt_out
    min_endorsers_for_ballot
    active
    created_at
    updated_at

Required indexes:

- unique slug;
- parent group plus active;
- type plus active;
- visibility plus active;
- active plus name plus id for deterministic lists.

The service rejects self-parenting and cycles before writes. Parent changes
revalidate descendant governance and membership eligibility in the same atomic
use case.

### group_memberships

Replaces the unreleased working_group_members table.

    id
    group_id -> groups.id
    user_id -> users.id
    member_id -> members.id, required
    source
    created_by_user_id -> users.id, nullable
    joined_at
    left_at

One active row means that one user participates in one group for one canonical
Member. A user representing multiple organizations has multiple rows in this
same table.

Required constraints and indexes:

- partial unique active group, user, Member tuple;
- group plus user plus left_at for membership and parent-eligibility checks;
- group plus Member plus left_at for Member counts and voting;
- user plus left_at for portal membership;
- Member plus left_at for representative revocation;
- joined and left reporting windows.

member_id is never null. Management permission without membership is expressed
through RBAC.

The source vocabulary initially includes self_service, organization_contact,
staff, automatic_policy, and migration. It is validated by the shared domain
schema.

### group_membership_category_rules

Controlled category eligibility and automatic-enrollment configuration.

    group_id -> groups.id
    category_code -> membership_categories.code
    permits_join
    automatic_enrollment
    created_at
    updated_at

The group eligibility mode determines whether absence from this table means
eligible or ineligible. The backend policy service owns that interpretation.

### group_automatic_enrollment_opt_outs

The explicit exception to a derived automatic-enrollment policy.

    group_id -> groups.id
    user_id -> users.id
    opted_out_at

The primary key is group and user. A policy reconciler must never recreate an
active membership while an opt-out exists. Removing the opt-out is an explicit
user or authorized-manager action.

This table does not apply to structural parent eligibility and does not affect
unrelated groups.

Automatic-enrollment reconciliation uses the same canonical active-capacity
projection as explicit joins. If a user has any active organization capacity,
the projection excludes their individual capacity for IPR clarity. Every
eligible organization capacity is enrolled; reconciliation closes only stale
automatic-policy rows and never silently recreates a former explicit join.

An automatically enrolled group is constrained to be top-level and cannot be
a structural parent. Its opt-out therefore cannot make unrelated child groups
ineligible.

## Governance and roles

The existing roles, role_permissions, user_roles, and permission_grants tables
remain canonical. Group-scoped assignments use context_type group and
context_id groups.id.

Working-group-specific context literals and role names migrate to generic group
vocabulary with compatibility parsing only during the code transition.

Effective group authorization combines:

1. consortium-level grants;
2. active local group role assignments;
3. active assignments inherited through ancestors when governance inheritance
   permits it;
4. explicit resource sharing grants.

Role assignments are never copied down the tree.

## Organization representation

### organization_domain_claims

The existing canonical exact-domain ownership table remains authoritative.
Only a domain attached to an approved active organization can establish
automatic representation.

### user_emails

The existing multiple-email model is extended with verification evidence where
that evidence is not already represented:

    verified_at
    verification_method

Only verified primary or secondary email addresses participate in domain
matching. A pending email address is never trusted.

### organization_representatives

The existing table remains the authoritative relationship and is finalized as
one row per Member and user pair:

    id
    member_id -> members.id
    user_id -> users.id
    source
    show_on_org_profile
    joined_at
    left_at
    blocked_at
    blocked_by_user_id -> users.id, nullable
    created_at
    updated_at

The unique boundary is Member and user. Restoring a relationship updates its
temporal state instead of creating ambiguous active duplicates.

source initially distinguishes verified_domain, organization_contact, staff,
and migration.

A contact removal sets left_at and blocked_at. Automatic domain reconciliation
cannot clear blocked_at. An authorized organization contact must explicitly
restore it.

Closing a representative relationship atomically:

- closes active group_memberships for that Member and user;
- revokes organization-scoped representative roles held by that user;
- writes audit history;
- inserts any required notification into the outbox.

Past actions remain attributed to the original user and Member.

Association, removal, and restoration enqueue an informational notice in the
same transaction as the relationship mutation. The notice never asks the
recipient to accept the relationship and cannot become the authorization
source.

An exact verified claimed custom-domain match is a strong representation
signal and may establish the relationship automatically. Free, personal,
disposable, unclaimed, or ambiguous domains instead trigger a warning; they
are not an authorization source. The controlled domain policy is shared by
browser and Worker code. Without an exact claimed organization domain or
explicit organization-contact/staff association, no representative row is
created.

## Resource ownership and sharing

Every group-owned shareable resource records owner_group_id (or the existing
mailing_lists.group_id owner). Existing production tables receive an additive
nullable column and write-path enforcement without rebuilding the table. A
reusable form definition is catalogue content rather than an owned response
set: its placements carry owner_group_id and are shared independently.
Installation-owned resources, such as the consortium membership application
form placement, deliberately keep a null group owner; an artificial hidden
group is not created merely to satisfy a foreign key.

Each resource domain owns an FK-backed grant table, for example:

    form_placement_group_grants
      placement_id -> form_placements.id
      group_id -> groups.id
      capability

    event_group_grants
      event_id -> events.id
      group_id -> groups.id
      capability

    vote_group_grants
      vote_id -> votes.id
      group_id -> groups.id
      capability

    mailing_list_group_grants
      mailing_list_id -> mailing_lists.id
      group_id -> groups.id
      capability

The column shape, shared Zod grant contract, capability evaluator, list query,
and response projection are common. Separate FK-backed tables are intentional:
they prevent orphan grants that a polymorphic resource_type and resource_id
table could not constrain.

Each resource module declares its allowed capabilities in one shared domain
constant together with its capability implications. Unknown capability values
fail validation on every write. Implications are evaluated by the shared
authorization service rather than repeated in route-specific conditionals.

Participation capabilities require active membership in the owner or grantee
group. Response, attendance-management, moderation, and management
capabilities require effective local or inherited leadership. Leadership and a
manage grant never manufacture the membership required to submit, register,
attend, vote, subscribe, or post.

Mailing-list subscription eligibility incorporates exact `subscribe` grants in
the D1 projection. Grant creation and revocation reconcile provider desired
state in the same D1 batch, so a revoked grant cannot remain an effective
Google Groups subscription merely because an asynchronous UI path was missed.

## Events, series, and occurrences

### events

The existing events table remains the event aggregate. It gains additive
ownership and profile fields:

    owner_group_id -> groups.id, nullable only for legacy or installation-owned events
    profile_key
    source_mode
    links_json
    visibility (invitation_only, group_members, all_members, or public)

Controlled profiles include meeting, conference, workshop, tutorial, and
board_meeting. Existing Hugo-backed conferences remain source_mode hugo.
Portal-managed meetings use source_mode portal.

Existing registration_mode and settings are interpreted through the shared
event-profile policy rather than route-local literals.

Event visibility is an independent audience policy. It controls discovery and
the safe detail projection, while registration_mode controls whether and how a
visible person registers and memberEligibility controls meeting entry. Exact
event permissions and explicit group resource grants may expand access without
rewriting the stored policy. Event list filtering, counting, searching,
sorting, and pagination apply the live audience predicate in D1; public/member
responses never contain management settings, retention, invite limits, or
virtual join URLs.

### registrations addition

    registration_group_id -> groups.id, nullable for public, invited, and legacy rows

This records the exact group context that authorized an authenticated
registration; it is not inferred later from mutable `source_ref` text. Insert
and reactivation guards require the user to remain an active member of that
group and the event to remain owned by it or carry an exact `register` grant.
The guard also rejects the no-registration policy. Public and individually
invited registrations remain represented by the existing nullable context and
canonical registration workflow.

### event_series

Replaces the unreleased meeting_series table.

    id
    event_id -> events.id, unique
    starts_at
    recurrence_rule
    timezone
    duration_minutes
    location
    provider_type
    provider_data_json
    active
    created_at
    updated_at

The series start, recurrence, and timezone are authoritative. Recurrence is
expanded as local wall-clock time so meetings remain at the intended local time
across daylight-saving changes. Materialization is bounded and idempotent;
existing occurrences are never silently regenerated. Once occurrences exist,
schedule changes require explicit occurrence edits or a replacement series.
ICS output is generated from this state.

### event_occurrences

    id
    series_id -> event_series.id
    starts_at
    ends_at
    status
    location_override
    provider_join_url_encrypted or protected provider reference
    created_at
    updated_at

Required indexes cover series plus start time, upcoming active occurrences, and
deterministic calendar pagination.

Occurrence generation is idempotent under a unique series and start-time
boundary.

External provider destinations are HTTPS-only capabilities. Their operational
copy is encrypted at rest and audit details record only that configuration
changed, never the destination itself.

### event_occurrence_guests

External identity and invitation state. An invitation is occurrence-scoped by
default; an explicit null occurrence_id makes it series-wide:

    id
    series_id -> event_series.id
    occurrence_id -> event_occurrences.id, nullable only for a series-wide guest
    user_id -> users.id, nullable
    normalized_email
    name
    affiliation
    invitation_secret
    invitation_version
    expires_at
    revoked_at
    created_at
    updated_at

The email is an invitation destination, not proof of an existing user identity.
A verified account may claim an invitation through the existing identity
boundary. The atomic group-scoped audit entry is the canonical inviter
attribution for both user-backed and service identities; the guest row does not
duplicate that polymorphic actor relationship.

Rotating the invitation secret increments the invitation version and invalidates
every pending browser challenge and guest session. A capability-bearing
invitation authorizes only the start of mailbox verification; it is not an
attendee identity and cannot read landing data or reveal the provider URL.

`expires_at` stores the deadline resolved when the invitation is issued. An
omitted deadline resolves to the selected occurrence start, or to the parent
event start for an explicit series-wide invitation. The effective deadline is
the earlier of that stored value and the current occurrence/event end. Moving a
schedule therefore cannot extend an issued capability, and shortening or
invalidating the schedule takes effect without rewriting guest rows. The same
effective projection is used by listing, queued capability materialization,
mailbox challenges, sessions, and canonical occurrence eligibility.

### meeting_guest_browser_challenges

A short-lived challenge binds one invited guest and occurrence to a random
browser-held secret and a separately delivered mailbox code:

    id
    guest_id -> event_occurrence_guests.id
    occurrence_id -> event_occurrences.id
    invitation_version
    authorization_hash
    expires_at
    used_at
    created_at

Only the hash of the challenge ID, browser secret, and code is stored. The D1
insert trigger rechecks the current invitation generation and canonical guest
eligibility for the exact occurrence. A second trigger limits concurrent code
issuance for one invitation generation.

### meeting_guest_sessions

The one-time challenge exchange creates a distinct guest session:

    id
    guest_id -> event_occurrence_guests.id
    challenge_id -> meeting_guest_browser_challenges.id
    authorization_hash
    expires_at
    revoked_at
    created_at

The signed browser token carries the session ID and authorization hash; the
database therefore does not persist a second, unrelated token hash. The insert
atomically validates and consumes the challenge. Runtime
authentication checks the exact session, invitation generation, occurrence,
expiry, revocation, and authorization hash. A series-wide invitation may start
a new occurrence-scoped session for another occurrence; one verified session
does not silently gain access to every occurrence.

The `current_event_occurrence_subject_eligibility` D1 view is the canonical
write-time and use-time policy projection for both authenticated users and
guests. It combines occurrence state, registration or group eligibility,
resource grants, guest scope, current guest policy, revocation, and expiry.
Both challenge insertion and intentional join guards query this same view, so a
policy change or revocation takes effect on the next use and a stale challenge
cannot revive when a guest is reinvited.

### event_occurrence_join_confirmations

One intentional PKIC join action:

    id
    occurrence_id -> event_occurrences.id
    user_id -> users.id, nullable for guest
    guest_id -> event_occurrence_guests.id, nullable
    name_snapshot
    affiliation_snapshot
    join_count
    confirmed_at
    attendance_verified_at
    attendance_verification_source

Exactly one of user or guest is required. The shared service verifies the exact
member or occurrence-scoped guest session, current eligibility, revocation,
landing revision, current terms, and intentional POST before the row and audit
event are committed. Client-supplied identity or affiliation is never accepted.

Repeated joins may update the latest confirmation time or append bounded
signals according to the reporting requirement; they never create multiple
attendee counts for one identity and occurrence.

### event_resource_management_guards

A transient authorization boundary used only inside the D1 batch that records
an event-management mutation:

    id
    event_id -> events.id
    group_id -> groups.id
    required_capability
    actor_user_id -> users.id, nullable for a trusted service identity
    trusted_service
    created_at

An insert trigger accepts the row only while the target group and user remain
active, the event remains owned by that group or has the exact required grant,
and the actor retains effective local or inherited group management. `manage`
is required for series, occurrence, and guest commands;
`manage_attendance` also accepts the broader `manage` grant. A release trigger
deletes the guard immediately; it is not durable business state. D1 batches
are transactional, so the guard, protected write, and group-scoped audit either
all commit or all roll back. This keeps application preflight and write-time
race protection separate from business state without duplicating a long-lived
authorization cache.

## Terms and consent

The existing event_terms table remains the canonical versioned terms source.
Meeting series are backed by an event, so the current event and terms
relationship applies. The additive event_access_term_acceptances table uses one
contract for authenticated users and invited guests without making either
identity type artificial or rebuilding the deployed consent table.

Acceptance uniqueness is event, user or guest identity, and exact term version.
Join confirmation is per occurrence and may reuse all existing acceptances for
the event's current term set. Publishing another term version therefore requires
acceptance of that new version before the next redirect.

## Forms and placements

The existing forms and form_fields tables remain live and mutable.

### form_fields additions

    updated_at
    archived_at

Field IDs are stable. Form updates match and update existing IDs, insert new
ones, and archive removed fields that have responses. The service no longer
deletes and recreates every field.

Options remain flexible configuration but receive stable identifiers and an
active flag. Historical selected values retain enough evidence to render after
an option is retired.

### form_placements

    id
    form_id -> forms.id
    owner_group_id -> groups.id; installation and transitional event placements
                     may remain null until event ownership migration completes
    context_type
    context_ref
    audience
    active
    opens_at
    closes_at
    created_at
    updated_at

A placement defines one response set and use context for a reusable form.
The same definition may have many placements.

### form_submissions additions

    placement_id -> form_placements.id, nullable only for legacy rows

### form_submission_answers additions

    field_id -> form_fields.id, nullable only for legacy rows

### Existing event-domain answer projections

    registrations.form_placement_id -> form_placements.id, nullable for legacy rows
    session_proposals.form_placement_id -> form_placements.id, nullable for legacy rows

Existing answers are backfilled through submission form plus field key where
unambiguous. New writes require field_id through an insert trigger and the
shared submission service. The legacy field key remains a historical snapshot
and compatibility fallback.

New registration, proposal, and membership writes atomically maintain one
normalized form submission per form and domain aggregate. Their existing JSON
columns remain compatibility projections, not a second form engine. A partial
unique index enforces the one-response invariant for domain contexts. The
shared replacement command updates answers by stable field ID, preserves
archived-field history, and lets current labels and keys change without losing
historical values.

Historical normalized submissions, registrations, and proposals are not
assigned to a guessed placement. A null placement therefore means legacy
attribution is unknown, not that the first current placement owns the response.
Explicit placement queries exclude those rows; the sole-placement compatibility
view may include them read-only until a source-backed attribution is available.

Every placement-backed write validates the form ID, placement, availability,
status, and exact form and placement revisions inside the same atomic D1 batch
as the durable command. Registration and proposal JSON projections and their
normalized submissions reuse this command rather than implementing a second
concurrency policy. Legacy definitions without a placement keep a deliberate
compatibility path without fabricated attribution.

## Mailing lists

The unreleased mailing_lists table requires group_id -> groups.id and permits
multiple rows per group. A partial unique index permits at most one
active, unarchived primary discussion list for a group. Lists are archived
rather than deleted so provider sync and audit history remain attributable.

Membership and subscription are separate:

- a group policy determines the default subscription;
- mailing_list_subscription_preferences stores a durable per-user, per-list
  subscribed or unsubscribed override;
- each list has independent purpose, posting, moderation, and default rules.

The effective subscription projection combines active capacity, current group
membership, list eligibility, list default, and the durable user preference.
The same SQL builders drive reads and reconciliation. Reconciliation is
set-based in D1 and writes the Google Groups sync queue only when the desired
provider state changes. Desired state and the sync queue never become a second
membership source.

## Voting

The unreleased votes table uses owner_group_id -> groups.id rather than forum
and working-group scope pairs.

Vote policy controls per_member or per_person electorate.

The unreleased vote_ballots table is finalized with:

    member_id -> members.id, nullable for per-person votes
    user_id -> users.id
    choice
    round
    submitted_at
    updated_at

For per-Member votes, one active row exists per vote, Member, and round. Any
currently authorized representative may replace it. The row records the latest
actor and choice; the existing audit log records the before and after state for
every replacement.

For per-person votes, the existing vote, user, and round uniqueness applies.

The API requires an explicit memberId when the caller has more than one eligible
organizational ballot. One submission never changes two organizations.

## Deletion and retention

- Historical memberships, representatives, ballots, consent, attendance, and
  audit rows are ended or redacted, not casually deleted.
- Group deletion is normally archival. A group with owned resources or children
  cannot be physically removed.
- Deleting a dependent draft resource cascades only where no legal or historical
  evidence exists. Form deletion rechecks normalized submissions plus event
  registration and proposal answer projections inside the same D1 batch; any
  response evidence converts the operation to archival.
- User anonymization preserves legally required attribution through the existing
  retention boundary.
- Every new foreign key has a deliberate restrict, cascade, or set-null policy
  and a matching index.

## Required query-plan evidence

Tests must execute representative access patterns with EXPLAIN QUERY PLAN:

- visible groups for a user with inherited management;
- active memberships for a group and paginated roster;
- parent eligibility and descendant revocation;
- automatic-enrollment reconciliation by category;
- effective organization representatives by verified email domain;
- group-owned upcoming meeting occurrences;
- one attendee row per occurrence identity;
- effective ballots per Member;
- form submission pages and option statistics by placement.

Plans must use intended indexes and avoid correlated per-row D1 queries.
