# Group-Centered Platform Architecture

Status: Accepted for implementation

Date: 2026-08-24

Implementation branch: agent/group-centered-portal-architecture-20260824

Stacked on: pkic/dev-pkic.org pull request 3 at bb22b0e8

## Purpose

The portal is a consortium and community platform in which a group is the
primary collaboration boundary. Working groups, task forces, the Board, the
Executive Council, and automatically enrolled coordination groups use the same
domain model. Configured group types provide their labels and defaults; they do
not create separate application architectures.

This decision replaces the current forum-versus-working-group special cases and
the split admin-versus-portal experience with one group-centered model.

## Non-negotiable invariants

1. The installation or consortium is the boundary above all groups. It is not
   represented by a synthetic root group.
2. Only groups form a hierarchy. Organizations do not inherit from or contain
   other organizations through the group tree.
3. A child-group membership is explicit. Joining a parent never automatically
   joins its children.
4. A user must retain at least one active membership capacity in the parent to
   remain eligible for a child. The represented organization need not be the
   same in parent and child.
5. Parent leadership manages descendants by default. Local leadership extends
   inherited leadership unless the child is explicitly configured as
   local-only.
6. Each domain resource has exactly one owning group. Sharing grants explicit,
   resource-specific capabilities and never silently transfers ownership.
7. One canonical contract and one policy implementation exist for each
   responsibility. Frontend and backend code infer from shared Zod contracts.
8. Search, filters, sorting, aggregation, and pagination execute in indexed D1
   queries. The browser never treats a partial fetched collection as complete.
9. State-changing use cases own one atomic D1 command boundary. External effects
   are inserted into the durable outbox in the same command.
10. Identity, authorization, uniqueness, relationships, and queryable state stay
    normalized. JSON is reserved for flexible non-authoritative configuration
    and values.

## Installation and groups

The installation supplies branding, authentication, global configuration, and
consortium-level authority. Groups are ordinary collaboration spaces below it.

Group types are configurable reference data. Initial types include working
group, task force, board, executive council, and coordination group. A type can
provide display labels and controlled defaults, but behavior is expressed
through capabilities and policy rather than type-specific route branches.

An automatically enrolled all-members group is an ordinary top-level group. It
is a communication convenience, not the parent of every working group.
Opting out of it cannot affect eligibility for unrelated groups. Consortium-wide
events, forms, votes, proposals, meetings, and mailing lists use the same group
resources in this group; they do not create a second global collaboration API.

Governance bodies are ordinary groups too. The Board of Directors and the
Executive Council are seeded groups of type board; a seat on either is a dated
group membership, its chair is a capacity-bound leadership assignment, and the
consortium chair and vice chair are the all-members group's leadership. There
is no separate positions table, body vocabulary, or System page for rosters:
the group's Members and Leadership tabs manage them, its "publish leadership"
and "publish roster" switches decide what the public directory serves, and a
task force or committee gets the same history without configuration. Each
group type names its two leadership roles (Chair and Vice Chair, or Lead and
Deputy Lead); each assignment keeps the exact title it was made with.

## Hierarchy and governance

Groups have an optional parent group. The application prevents cycles and uses
the ancestor chain for authorization and eligibility.

Membership and governance inheritance are deliberately separate:

- Child enrollment is always explicit unless a future, concrete automatic
  enrollment policy is configured for that child.
- Parent leadership capabilities apply recursively to descendants by default.
- Local child leaders are additional leaders by default.
- Local-only governance disables inherited management for that child and its
  descendants. It may be enabled only by inherited leadership or a
  consortium-level administrator, and only when valid local leadership exists.
- Role assignments are not copied to children. Effective capabilities are
  derived from active role assignments and the group ancestry.

When the last active parent-group capacity for a user ends, all active
descendant memberships for that user end in the same use case. Rejoining the
parent does not silently reactivate former child memberships.

## Membership and acting identities

A group membership is one row representing one user acting for one canonical
Member in one group:

    group + user + represented Member + active interval

A user acting for two organizations may therefore have two active rows in
the same group. There is no separate personal participation, organizational
participation, and mandate aggregate to synchronize.

The active uniqueness boundary is group, user, and Member. Member is required:
staff permission to manage a group is not group membership.

Joining defaults to all organizations for which the user has an active identity. The user
must confirm the list and may select a subset. A later identity
relationship does not silently enroll that organization into existing groups.
A user with any active organization identity cannot join using an
individual-member capacity.

Person-oriented operations use distinct users:

- mailing-list delivery and preferences;
- meeting invitations and attendance;
- leadership assignments;
- engagement statistics.

Member-oriented operations use distinct Members:

- IPR attribution;
- voting eligibility and effective ballots;
- participating-Member statistics.

## Acting identities

An acting identity is the sparse, approved capacity through which a user acts
for one Member. Most users hold one organization identity. Only approved H5,
H6, and H7 individual Members hold an organization-less identity; ordinary
contacts and event attendees do not receive one.

An exact verified email-domain match is evidence that can support an
organization invitation, but it is never an editable self-asserted affiliation.
Free, personal, disposable, unclaimed, and ambiguous domains never authorize an
organization identity. Organization contacts and properly authorized staff may
invite an identity; the exact user must accept before it grants Member or group
capacity. Staff may activate immediately only with both `membership:write` and
`identities:activate`, an explicit reason, audit attribution, and a same-batch
authorization guard.

Ending or blocking an identity immediately closes its active group capacities
and revokes identity-scoped roles while preserving historical actions. It is
not restored in place: a later role period is recorded as a successor identity.
Primary and secondary organization contacts additionally manage organization
content and identity invitations.

One user may hold several identities in the same authenticated account. The
session selects an exact `identity_id`, and every request revalidates that id
against live lifecycle state. Organization-specific email, job title,
biography, and links come from that identity; the email references a verified
user-owned address rather than copying it. Group participation and leadership
bind to the exact identity, so switching identities does not inherit another
capacity's authority. Removing a selected alias falls every affected identity
back to the user's primary address in the same transaction. Membership
application access uses canonical user, identity, and Member identifiers rather
than matching a reusable historical email string.

## Conditional enrollment

Eligibility, automatic enrollment, and opt-out are independent policies:

- eligibility determines who may join;
- automatic enrollment derives initial membership for eligible users;
- opt-out records a user's explicit exclusion from future reconciliation.

The initial controlled eligibility predicate is active membership category.
For example, a CA coordination group may initially permit or automatically
enroll the seeded category A. The actual rule and category metadata remain
D1-configured. These rules are evaluated in a shared backend policy service,
never hardcoded per endpoint or processed in the frontend.

## Resource ownership and sharing

Events, meeting series, votes, form placements, mailing lists, statistics, and
audit views are owned by one group. A reusable form definition is catalogue
content; each placement is the owned response set and sharing boundary.

Sharing grants capabilities rather than a universal shared flag. Examples:

- forms: view definition, submit, view responses, manage;
- events and meetings: view, register, attend, manage attendance, manage;
- votes: view, participate, view results, manage;
- mailing lists: view, subscribe, post, moderate, manage.

Capability implications are declared once per resource domain. A participation
grant implies the visibility necessary to perform that action (for example,
submit implies view definition and subscribe implies view), but management
never implies participation. This keeps staff access separate from the active
membership required to submit, register, attend, vote, subscribe, or post.

The group audit log is a derived management view, not a separately shareable
resource. It contains only rows carrying that exact group scope and requires
effective local or inherited group management. Global, entity-scoped, and
group-scoped audit routes compose one filter/search/sort/page read model; the
group route does not fetch a global result set and filter it in the portal.

The transport grant shape and authorization evaluator are shared. Persistence
must retain real foreign keys to the shared resource and grantee group. A
generic resource-type plus resource-id table without referential integrity is
not acceptable.

## Events and meetings

A meeting is a controlled event profile, not a separate scheduling
architecture. Conferences, workshops, tutorials, board meetings, and ordinary
group meetings share event, series, occurrence, invitation, registration,
calendar, terms, attendance, and audit primitives.

Meeting series and occurrences are the scheduling source of truth. ICS files
are generated views of that state; uploaded ICS files are not authoritative.
The provider boundary remains replaceable for future Microsoft Graph,
Cloudflare meeting, or other integrations.

Registration policy is controlled per event:

- no registration for ordinary eligible group members;
- optional opt-in;
- invitation-only;
- required registration;
- public registration where the profile permits it.

Group managers create attendee and speaker invitations through the canonical
group-event boundary. One shared bulk composer, request/response contract,
validity policy, command service, and text-safe email-variable builder serve
the portal and any temporary compatibility adapter. Invitation validity is
explicitly configurable, defaults to the event start, and can never extend
beyond the event end.

Bulk sending requires a short-lived preview confirmation. Each independently
sendable recipient batch is signed over its ordered recipients, actor, event,
invitation type, and effective expiry. The command recomputes that digest before
any D1 or outbox write, so a preview cannot authorize substituted, reordered,
or appended recipients while still allowing large lists to be committed in
bounded batches.

The authenticated group-registration adapter accepts participation data only.
It derives the attendee identity and profile from the verified session and then
uses the same registration, consent, form-answer, capacity, notification,
calendar, badge, and audit workflow as public registration. The persisted group
context is a foreign key and an atomic D1 guard rechecks active membership,
event ownership or an exact `register` grant, and the event policy in the write
batch. A revoked grant or ended membership therefore cannot race a prepared
registration into the database.

Guests are normally invited to one occurrence. Series-wide guest access is an
explicit exception. Guest validity composes the same shared invitation policy:
an omitted occurrence-scoped deadline resolves to that occurrence's start and
cannot exceed its end, while a series-wide deadline uses the materialized
parent-event window. A schedule change may shorten an issued deadline but never
extend it. Creation rechecks the exact schedule in the invitation D1 batch, and
queued capability delivery, mailbox challenge creation, verified sessions, and
occurrence entry all apply the same live effective deadline. Public workshops
use the public-registration event policy.

Invitation, RSVP, registration, join confirmation, and verified attendance are
separate facts.

## Meeting entry, terms, and attendance

Members open the occurrence entry page through their authenticated portal
session. An invited guest receives a rotatable capability in the URL fragment;
the fragment is removed before any network request and may only start a
browser-bound mailbox-code challenge. No meeting identity, terms, or provider
destination is returned until an exact member session or occurrence-scoped
guest session has been established.

A GET request never records attendance because email security scanners may
follow links. The authenticated page displays the authoritative name and
affiliation, presents applicable terms, and requires an intentional POST before
the provider destination is decrypted and returned.

Every occurrence records the intentional join confirmation. Full terms
acceptance is required only when the person has not accepted the currently
applicable terms version. The consent implementation reuses the existing event
terms and acceptance service.

The record stores the occurrence, actor, name and affiliation snapshot, terms
version, acceptance time, and join-confirmation time. It proves an identified
person intentionally requested entry and accepted the terms. It does not claim
how long they remained in the provider meeting.

Attendance therefore distinguishes:

- join confirmed through PKIC;
- attendance verified by a provider or authorized manual reconciliation.

Attendance discovery and verification use the same resource-grant evaluator
as every other group-owned resource. Effective leadership of the owning group
may manage attendance directly; leadership of another group requires an exact
`manage_attendance` or `manage` event grant. Neither capability creates the
membership needed to register or attend. Search, verification filtering,
sorting, counting, and pagination remain in D1. Verification commits an
atomic authorization guard and a group-scoped audit event with the mutation,
so grant revocation, leadership revocation, group deactivation, or actor
deactivation cannot race a prepared update.

Selected-group registration admission is one nested admission resource, not a
second attendee-management implementation:
`POST /api/v1/groups/:groupId/events/:eventId/registrations/:registrationId/admissions`.
The `capacity_exempt` mode is the ordinary waitlist workflow. It requires the
effective `manage_attendance` capability, explicitly selected event days, and
an active waitlist row for every selected day. The `vip` mode is a deliberate
capacity override. It requires the stronger effective `manage` capability,
explicitly selected event days, and a 3–1000 character reason; it does not
require a waitlist row. The portal receives `manage` from the server-provided
event capabilities before it renders the VIP controls. The service repeats the
same chosen capability and selected-group context in the protected D1 batch,
so losing leadership or a grant cannot race either mode. Both modes reuse the
same admission, audit, and registration-update outbox services.

## Forms

Forms are a live-editable Google Forms or Microsoft Forms alternative.
Administrators may add, remove, reorder, rename, and reconfigure questions
after responses exist. There is no mandatory whole-form publication-version
workflow.

Questions and options retain stable identities. Existing rows are updated in
place. Removed questions or options referenced by answers are archived rather
than deleted. Submitted answers reference the stable question identity and
remain immutable unless the response itself is explicitly edited.

One form definition may be placed in multiple contexts. Placements define
audience, ownership, response set, and sharing. Editing a shared form changes
all placements; a divergent questionnaire is created by copying the form.

## Voting

Organizational voting has one effective ballot per Member per vote and round.
Every active identity may submit or replace that ballot. A user with identities
of multiple organizations sees a separate ballot for each organization.

The latest authorized submission before close is effective. The current ballot
row records the latest actor and choice; the shared audit log preserves every
replacement. Ending an identity never deletes history. A primary or
secondary contact may submit a corrective ballot.

Vote configuration controls whether an electorate is per Member or per person.
The policy is shared across all group types. Authenticated discovery,
participation, proposals, results, and management always use the owning group's
routes. `/api/v1/votes` is only a public cross-group read projection of votes
whose publication policy permits it; it does not expose ballot state or private
configuration.

## API and service boundaries

Canonical group routes use the following shape:

    /api/v1/groups
    /api/v1/groups/:groupId
    /api/v1/groups/:groupId/users
    /api/v1/groups/:groupId/memberships
    /api/v1/groups/:groupId/leadership
    /api/v1/groups/:groupId/events
    /api/v1/groups/:groupId/events/:eventId/proposals
    /api/v1/groups/:groupId/events/:eventId/proposals/:proposalId/speakers
    /api/v1/groups/:groupId/forms
    /api/v1/groups/:groupId/votes
    /api/v1/groups/:groupId/votes/:voteId/statistics
    /api/v1/groups/:groupId/meetings/series
    /api/v1/groups/:groupId/meetings/series/:seriesId
    /api/v1/groups/:groupId/meetings/series/:seriesId/occurrences
    /api/v1/groups/:groupId/mailing-lists
    /api/v1/groups/:groupId/stats
    /api/v1/groups/:groupId/audit-log
    /api/v1/audit-log
    /api/v1/meetings/occurrences/:occurrenceId/invitations/verifications
    /api/v1/meetings/occurrences/:occurrenceId/invitations/verifications/:verificationId
    /api/v1/meetings/occurrences/:occurrenceId/join

Routes validate canonical shared contracts, resolve one authorization context,
call one focused use case, and serialize the shared response. SQL, transitions,
and external-delivery policy do not live in routes.

Program-committee proposal and speaker management is event-scoped under the
owning group. The neutral proposal/speaker contracts and UI components serve
the single group portal; there is no second admin implementation. Proposal and
speaker self-service remain separate, resource-bound capability surfaces under
`/api/v1/proposals/access/:token` and
`/api/v1/proposals/speakers/access/:token`. Their signed capabilities do not
create a second human-authentication session or cookie.

Proposal co-speaker invitations use the same event-bounded validity policy as
other event invitations: omission resolves to the event start and an explicit
deadline cannot exceed the event end. Expiry blocks delivery and use while the
speaker remains unconfirmed; confirming the invitation preserves the same
resource-bound speaker capability for later self-management. Renewing an
expired or declined invitation rotates its secret and generation, so the prior
bearer link cannot become valid again.

Invitation creation and renewal recheck the exact group, event, proposal,
speaker snapshot, event schedule, capacity, and live management permission in
the same D1 batch. Queued capability descriptors are bound to both the intended
recipient and current secret generation. Reminder and recovery selection stays
in indexed D1 queries, and concurrent decline or confirmation cannot be
overwritten by a stale invitation request.

Meeting endpoints are a profile-specific projection over the shared event
series service. They do not introduce separate recurrence, pagination,
calendar, or attendance implementations.

Every list endpoint composes the shared search, filter, sort, pagination, and
page-response schemas with deterministic tie-break ordering.

## Portal

Authentication is identity-based. A staff user with delegated management
permission can use the portal without active consortium membership; member-only
actions separately enforce membership.

The portal presents a selected-group context and derives navigation from that
group's capabilities. The same views support differently typed groups.

Navigation is group-centered and declared in one manifest. The sidebar lists
the identity's joined and managed groups directly beneath the Groups entry,
each linking into that group's workspace at `/portal/#/groups/:groupId/:view`;
sub-resources extend the same URL with their identifier so every view is
linkable and reloadable. There is no separate management navigation entry: the
retired `/portal/#/management` URLs redirect into the groups section, and the
former bare management landing (group creation, managed-group catalog, proposal
programs) lives on the Groups page for identities with those capabilities.
Account settings are reached through the user menu rather than a sidebar item,
and authenticated members and staff land on `/portal/#/groups` by default.

Global destinations use the same portal identity but require an exact global
permission independently of group capacity. Administrative domains are
navigated domain-first, never through an admin grouping: Users
(`/portal/#/users`, `users:read`), Organizations (`/portal/#/organizations`,
`organizations:read` or `membership:write`), Membership applications
(`/portal/#/membership/applications`, `membership:read`), and Donations
(`/portal/#/donations`, `donations:read` or `donations:sync`) are sidebar
entries that exist only when the identity holds the matching global
permission. What remains under `/portal/#/system/...` is the platform
residue — configuration and operations with no member-facing counterpart —
surfaced as one permission-gated "Settings" entry. The global audit log is
available at `/portal/#/system/audit-log` only with `audit:read`; System is an
interface grouping, while the canonical domain API is `/api/v1/audit-log`. It recomputes live staff grants and performs search, exact
filters, sorting, counting, and pagination in D1. Entity and actor filters are
open strings rather than a duplicated frontend catalog, so adding a new audited
resource or actor does not require a portal change. The former admin component,
schema, service, and API route are removed. Because this application is
unreleased, the retired admin URL is not retained as a compatibility route.

Membership workflow configuration remains at
`/portal/#/system/membership-settings`, but its APIs are domain-based:
`/api/v1/membership/settings` and `/api/v1/membership/categories`. Both use
the exact live `membership:read` and `membership:write` permissions, require a
user-backed identity for changes, and apply revision compare-and-swap with
attributed audit. The D1-backed category catalog is the single mutable voting
policy source; System is only the portal-navigation grouping and exposes no
membership-settings or membership-categories API aliases.

The portal is the sole human application. There is no admin or sponsor-specific
HTML shell, navigation tree, human session, or authentication cookie. Staff,
members, sponsor contacts, and dual-capacity users authenticate through
`/api/v1/auth` into one `pkic_session`; live capacities determine the portal
views and actions they may use. MCP OAuth approval also renders inside the
portal and uses that same human session. Its resulting MCP access token is a
machine transport, not another browser login.

Notification and scheduled-work producers use the typed management-link
adapter and emit canonical portal URLs directly. The unreleased consolidated
migration archives the obsolete admin sign-in template while preserving its
historical version for exact-version outbox rendering. Retired `/admin/` and
`/sponsor-portal/` page URLs return 404 instead of retaining duplicate shells or
compatibility redirects.

## D1, security, and performance

- Foreign keys and indexed access paths protect every authoritative relation.
- Evolvable policy values are validated by shared schemas rather than frozen in
  restrictive table-level checks.
- Active temporal relationships use partial unique indexes.
- Authorization queries verify both active group capacity and current
  representative authority.
- Recursive group traversal is bounded by cycle prevention and indexed parent
  lookups.
- List and aggregation queries are set-based and explain-plan tested.
- Member entry is bound to the exact live portal session. Guest invitation
  capabilities are rotatable, fragment-transported bootstrap authority only;
  mailbox verification creates a separate expiring, revocable,
  occurrence-scoped session.
- Landing revisions and D1 join guards bind the authoritative identity,
  affiliation, current terms, occurrence, eligibility, and exact session before
  the provider destination is returned.
- Terms and attendance evidence retain only justified identity snapshots and
  follow the configured retention policy.
- No production personal data is copied into preview or tests.

## Migration strategy

Migration 0035 was last verified pending in both preview and production on
2026-08-26 and must be reverified at handoff. Branch-created group, meeting,
and voting structures are therefore corrected in that consolidated migration
rather than followed by corrective migrations.

Existing production tables evolve additively. Rebuilding members,
organizations, forms, events, or consent tables requires a separately approved
exception with rehearsal and recovery evidence.

Local validation applies the complete migration set to an empty D1 database and
to the repository's production-shaped upgrade fixture. Remote application
remains a separate manual operation.

## Completion standard

The implementation is complete only when schema, shared contracts, services,
routes, portal UI, tests, documentation, and the PR checklist all agree with
these invariants. Passing tests without requirement-by-requirement evidence is
not completion.
