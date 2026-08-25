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
Opting out of it cannot affect eligibility for unrelated groups.

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

## Membership and representation

A group membership is one row representing one user acting for one canonical
Member in one group:

    group + user + represented Member + active interval

A user representing two organizations may therefore have two active rows in
the same group. There is no separate personal participation, organizational
participation, and mandate aggregate to synchronize.

The active uniqueness boundary is group, user, and Member. Member is required:
staff permission to manage a group is not group membership.

Joining defaults to all organizations the user currently represents. The user
must confirm the list and may select a subset. A later representative
relationship does not silently enroll that organization into existing groups.
A user with any active organization representation cannot join using an
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

## Organization representatives

An exact match between a verified user email domain and a domain claimed by an
active Member organization is sufficient evidence for ordinary representative
status. Free, personal, disposable, and otherwise ambiguous email domains
produce a warning and never establish representation automatically.

Primary or secondary organization contacts may explicitly associate a user
whose email domain does not establish the relationship. They may also remove a
representative. Removal creates a persistent block until an authorized contact
restores the relationship and immediately ends all active group capacities held
for that organization. Historical participation and actions remain intact.

All active representatives have equal ordinary participation and contribution
rights. Primary and secondary contacts additionally manage the organization and
its representative list.

## Conditional enrollment

Eligibility, automatic enrollment, and opt-out are independent policies:

- eligibility determines who may join;
- automatic enrollment derives initial membership for eligible users;
- opt-out records a user's explicit exclusion from future reconciliation.

The initial controlled eligibility predicate is active membership category.
For example, a CA coordination group may permit or automatically enroll only
category A Members. These rules are data-driven and evaluated in a shared
backend policy service, never hardcoded per endpoint or processed in the
frontend.

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

The authenticated group-registration adapter accepts participation data only.
It derives the attendee identity and profile from the verified session and then
uses the same registration, consent, form-answer, capacity, notification,
calendar, badge, and audit workflow as public registration. The persisted group
context is a foreign key and an atomic D1 guard rechecks active membership,
event ownership or an exact `register` grant, and the event policy in the write
batch. A revoked grant or ended membership therefore cannot race a prepared
registration into the database.

Guests are normally invited to one occurrence. Series-wide guest access is an
explicit exception. Public workshops use the public-registration event policy.

Invitation, RSVP, registration, join confirmation, and verified attendance are
separate facts.

## Meeting entry, terms, and attendance

A personalized opaque PKIC join link opens a PKIC landing page. A GET request
does not record attendance because email security scanners may follow links.
The page identifies the authenticated member or invited guest, displays their
name and affiliation, presents applicable terms, and requires an intentional
POST before redirecting to the provider.

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
Every active representative may submit or replace that ballot. A representative
of multiple organizations sees a separate ballot for each organization.

The latest authorized submission before close is effective. The current ballot
row records the latest actor and choice; the shared audit log preserves every
replacement. Removing a representative never deletes history. A primary or
secondary contact may submit a corrective ballot.

Vote configuration controls whether an electorate is per Member or per person.
The policy is shared across all group types.

## API and service boundaries

Canonical group routes use the following shape:

    /api/v1/groups
    /api/v1/groups/:groupId
    /api/v1/groups/:groupId/members
    /api/v1/groups/:groupId/leadership
    /api/v1/groups/:groupId/events
    /api/v1/groups/:groupId/forms
    /api/v1/groups/:groupId/votes
    /api/v1/groups/:groupId/meetings/series
    /api/v1/groups/:groupId/meetings/series/:seriesId/occurrences
    /api/v1/groups/:groupId/mailing-lists
    /api/v1/groups/:groupId/stats
    /api/v1/groups/:groupId/audit-log

Routes validate canonical shared contracts, resolve one authorization context,
call one focused use case, and serialize the shared response. SQL, transitions,
and external-delivery policy do not live in routes.

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

The separate admin application is retired incrementally:

1. add portal routes and group-scoped REST endpoints backed by shared services;
2. move existing management screens to the portal shell;
3. redirect legacy admin URLs while bookmarks and emails migrate;
4. remove the admin shell, route literals, duplicate session assumptions, and
   compatibility endpoints before completion.

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
- Personalized join tokens are random, stored hashed, scoped to one identity
  and occurrence, revocable, expiring, and never placed in analytics payloads.
- Terms and attendance evidence retain only justified identity snapshots and
  follow the configured retention policy.
- No production personal data is copied into preview or tests.

## Migration strategy

Migration 0035 is pending in both preview and production as verified on
2026-08-24. Branch-created group, meeting, and voting structures will therefore
be corrected in that consolidated migration rather than followed by corrective
migrations.

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
