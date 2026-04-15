# Events Backend API (v1)

Base path: `/api/v1`

## Auth
- `POST /admin/auth/request-link`
- `POST /admin/auth/verify-link`

## Admin event management
- `POST /admin/events/sync-from-hugo`
- `PATCH /admin/events/:eventSlug/settings`
- `POST /admin/events/:eventSlug/invites/attendees/bulk`
- `POST /admin/events/:eventSlug/invites/speakers/bulk`
- `GET /admin/events/:eventSlug/registrations`
- `GET /admin/events/:eventSlug/proposals`
- `POST /admin/events/sync-from-hugo` supports optional `event.frontend.routes`:
- `registration`, `registrationConfirm`, `proposal`, `registrationManage`, `proposalManage`
- Route metadata is stored in `events.settings_json.frontend.routes`.

## Proposal review
- `GET /admin/proposals/:proposalId/reviews`
- `POST /admin/proposals/:proposalId/reviews`
- `PATCH /admin/proposals/:proposalId/reviews/:reviewId`
- `POST /admin/proposals/:proposalId/finalize`

## Email templates
- `GET /admin/email-templates`
- `POST /admin/email-templates/:key/versions`
- `POST /admin/email-templates/:key/activate`

## Registrations and invites
- `POST /events/:eventSlug/registrations`
- `POST /events/:eventSlug/registrations/confirm-email`
- `GET /events/:eventSlug/registrations/confirm-email?token=...`
- `GET /events/:eventSlug/forms?purpose=event_registration|proposal_submission`
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
- `GET /events/:eventSlug/forms?purpose=event_registration|proposal_submission`
- `GET /proposals/manage/:token`
- `PATCH /proposals/manage/:token`
- Proposal participants:
- `proposer` and `speakers[]` share the same user component (`firstName`, `lastName`, `email`, `organizationName`, `jobTitle`, `bio`, `links[]`).
- `speakers[].role` supports `speaker`, `co_speaker`, `moderator`, `panelist` (plus proposer role in system internals).

## Referral and internal jobs
- `GET /r/:code`
- `POST /internal/email/retry`
- `POST /internal/retention/run`

## Legacy removal
- Legacy `/api/events/*` routes are removed.
- Supported backend routes are exclusively under `/api/v1/*` and `/r/:code`.

## Bootstrap
- Seed initial admin user with `npm run seed:admin:local` (or `npm run seed:admin:remote`).
- Seed script upserts `admin@pkic.org` with global role `admin`.
- Seed or update an event from YAML config (includes event metadata, terms, organizers, and forms/questions):
- Local: `npm run seed:event:local`
- Remote: `npm run seed:event:remote`
- Custom config file: `npm run seed:event:local -- --config scripts/seed-event.yaml`
- Default config path: `scripts/seed-event.yaml`
- Terms can include optional `displayText` for exact consent checkbox wording while still storing `termKey` + `version` for audit/compliance.
- Event days can be configured in YAML (`event.days`) with optional per-day in-person capacity.
- Per-day attendance is captured as first-class data (`registration_day_attendance`), not as ad-hoc custom question fields.

## Shared Validation
- Shared request schemas live in `shared/schemas/api.ts` for backend and future frontend reuse.
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
