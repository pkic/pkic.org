# Events Backend Decisions

## Locked decisions
- Proposal decisions use multi-review plus explicit finalize action.
- Email templates are private (R2 object store) with D1 metadata.
- Referral links use short base62 codes (default length 7).
- Calendar phase 1 sends ICS; delivery status is tracked in `email_outbox` (no dedicated calendar table); RSVP state automation is deferred.
- Admin authentication uses allowlisted email magic links.
- User and session persistence use generic `users`/`sessions` tables (admin auth is a role policy, not a schema fork).
- Global user role is intentionally minimal: `admin|user|guest`; event-specific roles are modeled in `event_participants`.
- User names are stored as `first_name` + `last_name` (+ optional `preferred_name`) for personalization and gamification.
- Unsubscribes use a generic `unsubscribes` table scoped by `channel` and `scope`.
- Invite declines use structured reasons (`decline_reason_code`) with optional note (`decline_reason_note`).
- User record uses `organization_name` (not `company`) to support public/private/education/government contexts.
- Proposal participants support explicit subroles (`speaker`, `co_speaker`, `moderator`, `panelist`, `proposer`).
- Speaker/user links are stored as URL lists (`links_json`) instead of provider-specific columns.
- Event/session source of truth remains Hugo; operational state lives in D1.
- Dynamic data collection uses generic form tables (`forms`, `form_fields`, `form_submissions`, `form_submission_answers`) instead of event-specific question tables.
- Sponsorship is modeled as `sponsors` (who sponsors, including community-level `sponsorship_level`) plus `sponsor_events` (what they sponsor for a specific event).
- Gamification telemetry is append-only in `engagement_events`; it is subject-based (`subject_type` + `subject_ref`) so engagement can target community, organizations, events, proposals, invites, referrals, and more.
- Retention is configurable for PII, while legal consent evidence remains immutable.
- Initial bootstrap admin user is seeded as `admin@pkic.org`.
- Request payload validation is centralized in shared Zod schemas (`shared/schemas/api.ts`) for backend/frontend reuse.
- Future community hooks are established with `users`, `organizations`, `members`, `event_participants`, `forms`, `sponsors`, `sponsor_events`, and `engagement_events`.
- Flexible extension columns use `data_json` naming for consistency; reserved `value_json`-style naming is avoided.

## Trade-offs
- Opaque DB-backed session tokens are used for admin API auth to keep implementation simple and revocable.
- D1 stores template metadata for versioning and audit, while large template content stays in R2.
- Deferred RSVP automation requires extra provider integrations; current model keeps only outbox delivery evidence and explicit reconfirm-link support.
- Public, cacheable responses are limited to explicit anonymous read endpoints; authenticated and tokenized routes are `no-store`.
- Markdown rendering uses `marked` (actively maintained and widely adopted); ICS generation uses `ics`.
- Outbox processing in `waitUntil` uses background-safe wrappers to avoid uncaught worker errors while preserving failure state in `email_outbox`.
