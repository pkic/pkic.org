# Events Backend Decisions

## Locked decisions

- Proposal decisions use multi-review plus explicit finalize action.
- Email template content and version metadata are private D1 data. One partial
  unique index enforces a single active version for each template key.
- Referral links use short base62 codes (default length 7).
- Calendar replies received through signed RSVP addresses are recorded per event day. Decline/tentative automation is bounded, day-scoped, and atomic with its audit/outbox effects; delivery bounces never change attendance. A day without a configured fallback is removed without changing or cancelling the registration-wide aggregate, even when it is the final selected day.
- Human authentication uses one allowlisted email magic-link and passkey flow;
  live staff and member capacities are resolved independently for the same
  user identity.
- User and session persistence use generic `users`/`sessions` tables (staff
  authorization is a policy, not a schema fork).
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
- Request payload validation is centralized in focused `assets/shared/schemas/` domain modules for backend/frontend reuse.
- Future community hooks are established with `users`, `organizations`, `members`, `event_participants`, `forms`, `sponsors`, `sponsor_events`, and `engagement_events`.
- Flexible extension columns use `data_json` naming for consistency; reserved `value_json`-style naming is avoided.

## Trade-offs

- Signed JWT session cookies reference revocable D1 session rows for human API
  authentication; machine API keys remain a separate transport.
- D1 stores template content and metadata together so version creation,
  activation, authorization, and audit remain one atomic command boundary.
- Cross-provider RSVP truth reconciliation remains deferred. The current workflow trusts only signed inbound routing context, fails closed for ambiguous legacy replies, and keeps explicit registration management as the attendee override.
- Public, cacheable responses are limited to explicit anonymous read endpoints; authenticated and tokenized routes are `no-store`.
- Markdown rendering uses `marked` (actively maintained and widely adopted); ICS generation uses `ics`.
- Outbox processing in `waitUntil` uses background-safe wrappers to avoid uncaught worker errors while preserving failure state in `email_outbox`.
