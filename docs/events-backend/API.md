# Events Backend API (v1)

Base path: `/api/v1`

## Auth

- `POST /auth/request-link`
- `POST /auth/verify-link`
- `GET /auth/session`
- `POST /auth/logout`

## Event resources

- `GET /events`
- `POST /events/imports`
- `GET /events/:eventSlug`
- `PATCH /events/:eventSlug/settings`
- `GET /events/:eventSlug/days`
- `PUT /events/:eventSlug/days`
- `GET /events/:eventSlug/roles`
- `POST /events/:eventSlug/roles`
- `DELETE /events/:eventSlug/roles/:roleAssignmentId`
- `GET /events/:eventSlug/promoters`
- `GET /events/:eventSlug/presentations/archive`
- `GET /events/:eventSlug/analytics`
- `GET /events/:eventSlug/proposals`
- `POST /events/:eventSlug/email/campaigns/previews`
- `POST /events/:eventSlug/email/campaigns`
- Lists and details apply the live event audience in D1. Anonymous and member
  responses contain only audience-safe fields; exact `events:read` permission
  enables the management projection for both the list and the detail. `GET
/events` is the single event collection: visibility is filtered in D1 before
  counting and pagination, and only the projection differs by scope.
- `POST /events/imports` creates or updates an event and its terms from an
  external generator. The generating system is named by the request body
  (`source`), not the route. It requires an attributable user-backed
  `events:write` permission — the shared API key is rejected — and that
  permission, the target event revision, and the owning source are all
  re-evaluated inside the same D1 batch as the event, terms, and audit writes.
  An event owned by a different source cannot be retargeted by a slug
  collision.
- Events are created interactively only under an owning group, through
  `POST /groups/:groupId/events`. There is no ownerless creation endpoint.
- Event visibility is `invitation_only`, `group_members`, `all_members`, or
  `public`. It is separate from registration and meeting-entry policy.
- Event team assignments are role resources, not generic permission records.
  Listing and mutations require the exact live, user-backed event-scoped
  `events:manage` permission; writes recheck that authority in the D1 batch.
- Event promotion activity and referral codes require the exact live,
  user-backed event-scoped `events:read` permission. Search, sorting,
  pagination, and aggregate summaries execute in D1.
- Presentation archives require the exact live, user-backed event-scoped
  `proposals:read` permission. The default archive contains the current file
  for each accepted proposal; `?versions=all` includes retained versions.
- Event analytics require the exact live, user-backed event-scoped
  `events:read` permission. Registration, attendance, waitlist, invitation,
  and RSVP metrics execute as one bounded D1 batch. Proposal totals are omitted
  unless the same user also has event-scoped `proposals:read`.
- The event proposal catalogue requires exact live, user-backed event-scoped
  `proposals:read`. Search, status and recommendation filters, allowlisted
  sorting, counting, and pagination execute in D1. `?archived=true` selects
  archived records instead of mixing them into the active catalogue.
- Event email campaigns use one resource for attendee and speaker audiences.
  Preview creation and campaign creation require exact live, user-backed
  event-scoped `events:write`; the actor-bound preview expires after ten
  minutes. Permission is rechecked in every D1 batch, including the batch that
  atomically queues the durable outbox rows.

## Selected-group event communication

- `POST /groups/:groupId/events/:eventId/email/campaigns/previews`
- `POST /groups/:groupId/events/:eventId/email/campaigns`
- The selected-group adapter calls the same contracts and campaign services as
  the direct event resource. It requires the exact group's live event `manage`
  capability and rechecks group leadership and resource sharing in every D1
  batch. The portal only renders the controls from the server-provided
  management capability.

## Event registration management

- `GET /events/:eventSlug/registrations`
- `GET /events/:eventSlug/registrations/exports`
- `POST /events/:eventSlug/registrations/promotions`
- `GET /events/:eventSlug/registrations/:registrationId`
- `PATCH /events/:eventSlug/registrations/:registrationId`
- `POST /events/:eventSlug/registrations/:registrationId/access`
- `POST /events/:eventSlug/registrations/:registrationId/admissions`
- `GET /events/:eventSlug/registrations/:registrationId/audit`
- `GET`, `PATCH`, and `POST /events/:eventSlug/registrations/:registrationId/badge`
- `POST /events/:eventSlug/registrations/:registrationId/notifications`
- These full attendee-management resources require a live, user-backed
  event-scoped `events:manage` permission. The permission is repeated inside
  every D1 read or mutation batch so a concurrent grant revocation fails the
  request atomically.
- Day waitlisting and admission remain per-day state. There is no generic
  registration-level force-status action.
- Selected-group attendance management remains under the group event resource
  and uses its narrower `manage_attendance` capability and reduced attendee
  projection.
- The former `/admin/events/:eventSlug/registrations` and waitlist routes are
  removed rather than retained as aliases.

## Event import frontend routes

- `POST /events/imports` supports optional `event.frontend.routes`:
- `registration`, `registrationConfirm`, `proposal`, `registrationManage`, `proposalManage`
- Route metadata is stored in `events.settings_json.frontend.routes`.

## Group event invitation management

- `GET /groups/:groupId/events/:eventId/invites`
- `POST /groups/:groupId/events/:eventId/invites/attendees/preview`
- `POST /groups/:groupId/events/:eventId/invites/attendees/bulk`
- `GET /groups/:groupId/events/:eventId/invites/speakers`
- `POST /groups/:groupId/events/:eventId/invites/speakers/preview`
- `POST /groups/:groupId/events/:eventId/invites/speakers/bulk`
- `POST /groups/:groupId/events/:eventId/invites/:inviteId/resend`
- `POST /groups/:groupId/events/:eventId/invites/:inviteId/revoke`
- `POST /groups/:groupId/events/:eventId/invites/speakers/:inviteId/resend`
- `POST /groups/:groupId/events/:eventId/invites/speakers/:inviteId/revoke`

## Proposal review

- `GET /proposals/:proposalId/reviews`
- `POST /proposals/:proposalId/reviews`
- `PATCH /proposals/:proposalId/reviews/:reviewId`
- `POST /proposals/:proposalId/finalize`

## Email templates

- `GET /email/templates`
- `GET /email/templates/:key/versions`
- `POST /email/templates/:key/versions`
- `POST /email/templates/:key/activate`
- `POST /email/templates/preview`
- Reads require a user-backed staff session with `email-templates:read`.
- Preview, version creation, and activation require `email-templates:write`.
- The former generic `/admin/email-templates` and `/system/email-templates`
  APIs are removed; the portal is the only management interface.

## Registrations and invites

- `POST /events/:eventSlug/registrations`
- `POST /events/:eventSlug/registrations/confirm-email`
- `GET /events/:eventSlug/registrations/confirm-email?token=...`
- `GET /events/:eventSlug/forms/placements/:purpose`
- `GET /registrations/manage/:token`
- `PATCH /registrations/manage/:token`
- `POST /events/:eventSlug/invites`
- `POST /invites/:token/accept`
- `POST /invites/:token/decline`
- Decline payload uses structured fields:
- `reasonCode` (enum) + optional `reasonNote` (required when `reasonCode=other`) + `unsubscribeFuture`.
- Invite payloads use `firstName` and `lastName` (not `name`).

## Terms and proposals

- `POST /events/:eventSlug/proposals`
- `GET /events/:eventSlug/forms/placements/:purpose`
- `GET /proposals/manage/:token`
- `PATCH /proposals/manage/:token`
- Proposal participants:
- `proposer` and `speakers[]` share the same user component (`firstName`, `lastName`, `email`, `organizationName`, `jobTitle`, `bio`, `links[]`).
- `speakers[].role` supports `speaker`, `co_speaker`, `moderator`, `panelist` (plus proposer role in system internals).

## Email delivery and operations

- `GET /email/outbox`
- `POST /email/outbox/process`
- `POST /email/outbox/reset-failed`
- Outbox reads require `email:read`; bounded processing and explicit selected-row
  reset additionally require `email:manage`.
- `POST /email/reminders/runs`
- Reminder cycles are an email producer: every reminder they resolve is queued
  into the durable outbox. `mode: "preview"` resolves the same batch without
  queueing, and is the canonical way to see which reminders are due — there is
  deliberately no second read model re-deriving that set. Preview requires
  `email:read`; executing additionally requires `email:manage`.

## Scheduler

- `GET /scheduler/jobs`
- `POST /scheduler/jobs/:jobKey/runs`
- `POST /scheduler/jobs/:jobKey/pause`
- `POST /scheduler/jobs/:jobKey/resume`
- The scheduler is the mechanism; a scheduled job is the resource it manages,
  so jobs are nested under it. Cadence is a row value, not a cron expression:
  one dispatcher trigger serves every job.
- Reads require `scheduler:read`. A run, pause, or resume additionally requires
  `scheduler:manage` **and** every grant the job's own domain requires, so
  triggering through the scheduler cannot do what the caller could not do
  directly — running retention still requires `users:anonymize`.
- A manual run takes the same lease and D1 query budget as a scheduled pass, so
  it cannot run concurrently with the dispatcher or exceed the bounds the
  schedule respects.
- `lastSuccessAt` is reported separately from `lastRunAt`, and
  `consecutiveAbandoned` separately from `consecutiveFailures`: a job that runs
  often but rarely succeeds, and a job that dies mid-run rather than raising,
  are different failures and would otherwise be indistinguishable.
- Pausing loses no work. Due work is derived from domain state on every pass
  rather than queued, so a resumed job finds it again.

## Retention

- `GET /retention/due`
- `POST /retention/runs`
- Data retention is its own governance domain: `retention_policies` decides how
  long identifying registration and user data is kept. Reads require
  `retention:read`; a run additionally requires `retention:run` and
  `users:anonymize`, both re-evaluated inside the same D1 batch as the
  redaction and its audit record.

## Membership batches

- `POST /membership/batches/:batchKey/runs`
- One parameterised route serves every batch, so adding a batch does not add a
  route family. `consultation` requires `membership:write` and `ec-review`
  requires `membership:approve`, re-evaluated inside the batch's own write
  batch.
- There is no cross-domain due-work endpoint. Each domain serves its own pending
  list, so counts are exact rather than a merge of independently capped windows.
- Manual runs require a user-backed staff session; service API keys cannot
  invoke them, and each run reuses the scheduled D1 query budget.

## Referral and signed calendar ingestion

- `GET /r/:code`
- `POST /calendar/rsvp`
- The calendar endpoint uses its bounded, replay-protected request-signature
  boundary. Existing calendar UIDs and signed RSVP email addresses remain
  valid because the transport URL is not embedded in issued ICS files. The
  retired internal email, reminder, job, and retention command
  routes return 404.

## Legacy removal

- Legacy `/api/events/*` routes are removed.
- Supported backend routes are exclusively under `/api/v1/*` and `/r/:code`.

## Bootstrap

- Seed initial admin user with `pnpm run seed:admin:local` (or `pnpm run seed:admin:remote`).
- Seed script upserts `admin@pkic.org` with global role `admin`.
- Seed or update an event from YAML config (includes event metadata, terms, organizers, and forms/questions):
- Local: `pnpm run seed:event:local`
- Remote: `pnpm run seed:event:remote`
- Custom config file: `pnpm run seed:event:local -- --config scripts/seed-event.yaml`
- Default config path: `scripts/seed-event.yaml`
- Terms can include optional `displayText` for exact consent checkbox wording while still storing `termKey` + `version` for audit/compliance.
- Event days can be configured in YAML (`event.days`) with optional per-day in-person capacity.
- Per-day attendance is captured as first-class data (`registration_day_attendance`), not as ad-hoc custom question fields.

## Shared Validation

- Shared request schemas live in focused `assets/shared/schemas/` domain modules for backend and frontend reuse.
- Canonical attendee user field is `organizationName` (not `company`).
- Name fields are split: `firstName`, `lastName` (and optional `preferred_name` in storage).
- Event retention setting field is `userRetentionDays`.

## Link generation behavior

- Invite, referral, confirmation, and manage links resolve through event frontend route metadata.
- If route metadata is missing, backend falls back to defaults:
- `/events/:slug/register/`
- `/events/:slug/register/confirm/`
- `/events/:slug/propose/`
- `/events/:slug/register/manage/`
- `/events/:slug/propose/manage/`
