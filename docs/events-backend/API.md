# Events Backend API (v1)

Base path: `/api/v1`

## Auth

- `POST /auth/request-link`
- `POST /auth/verify-link`
- `GET /auth/session`
- `POST /auth/logout`

## Event resources

- `GET /events`
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
- Lists and details apply the live event audience in D1. Anonymous and member
  responses contain only audience-safe fields; exact `events:read` permission
  enables the management detail projection.
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

## Remaining legacy event integration

- `POST /admin/events/sync-from-hugo`
- `GET /admin/events/:eventSlug/registrations`
- `POST /admin/events/sync-from-hugo` supports optional `event.frontend.routes`:
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

- `GET /admin/proposals/:proposalId/reviews`
- `POST /admin/proposals/:proposalId/reviews`
- `PATCH /admin/proposals/:proposalId/reviews/:reviewId`
- `POST /admin/proposals/:proposalId/finalize`

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
- `GET /operations/due-work`
- `POST /operations/reminders/preview`
- `POST /operations/reminders/run`
- `POST /operations/retention/run`
- `POST /operations/membership-batches/consultation/run`
- `POST /operations/membership-batches/ec-review/run`
- `POST /operations/membership-batches/wg-chair-digest/run`
- Due-work reads and reminder preview require `operations:read`. Runs additionally
  require `operations:run`; retention, consultation, and EC review retain their
  exact `users:anonymize`, `membership:write`, or `membership:approve`
  permission.
- Manual commands require a user-backed staff session. Service API keys cannot
  invoke them.

## Referral and signed internal ingestion

- `GET /r/:code`
- `POST /internal/calendar/rsvp`
- The calendar endpoint uses its bounded, replay-protected request-signature
  boundary. The retired internal email, reminder, job, and retention command
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
