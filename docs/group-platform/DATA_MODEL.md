# Group Platform Data Model

Status: Accepted design, pending implementation

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

Free, personal, disposable, unclaimed, or ambiguous domain classification is
a warning aid, not an authorization source. The controlled domain policy is
shared by browser and Worker code. Without an exact claimed organization
domain or explicit organization-contact/staff association, no representative
row is created.

## Resource ownership and sharing

Every group-owned shareable resource records owner_group_id. Existing
production tables receive an additive nullable column and write-path
enforcement without rebuilding the table. Installation-owned resources, such
as the consortium membership application form, deliberately keep a null group
owner and use an installation placement; an artificial hidden group is not
created merely to satisfy a foreign key.

Each resource domain owns an FK-backed grant table, for example:

    form_group_grants
      form_id -> forms.id
      group_id -> groups.id
      capability

    event_group_grants
      event_id -> events.id
      group_id -> groups.id
      capability

The column shape, shared Zod grant contract, capability evaluator, list query,
and response projection are common. Separate FK-backed tables are intentional:
they prevent orphan grants that a polymorphic resource_type and resource_id
table could not constrain.

Each resource module declares its allowed capabilities in one shared domain
constant. Unknown capability values fail validation on every write.

## Events, series, and occurrences

### events

The existing events table remains the event aggregate. It gains additive
ownership and profile fields:

    owner_group_id -> groups.id, nullable only for legacy or installation-owned events
    profile_key
    source_mode
    links_json

Controlled profiles include meeting, conference, workshop, tutorial, and
board_meeting. Existing Hugo-backed conferences remain source_mode hugo.
Portal-managed meetings use source_mode portal.

Existing registration_mode and settings are interpreted through the shared
event-profile policy rather than route-local literals.

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
    expires_at
    invited_by_user_id -> users.id
    revoked_at
    created_at

The email is an invitation destination, not proof of an existing user identity.
A verified account may claim an invitation through the existing identity
boundary.

### event_occurrence_access_tokens

Opaque hashed capabilities bind one occurrence to exactly one authenticated
user or invited guest. GET renders the landing page without mutating state.
The intentional POST records first and latest use and may be repeated until the
token expires or is revoked, so a participant who is disconnected can rejoin.

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

Exactly one of user or guest is required. The shared service verifies the
opaque join token, current eligibility, revocation, terms version, and
intentional POST before the row and audit event are committed.

Repeated joins may update the latest confirmation time or append bounded
signals according to the reporting requirement; they never create multiple
attendee counts for one identity and occurrence.

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
    owner_group_id -> groups.id, nullable only for installation placements
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

Existing answers are backfilled through submission form plus field key where
unambiguous. New writes require field_id through an insert trigger and the
shared submission service. The legacy field key remains a historical snapshot
and compatibility fallback.

## Mailing lists

The unreleased mailing_lists table uses nullable group_id -> groups.id and
permits multiple rows per group. A partial unique index permits at most one
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
  evidence exists.
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
