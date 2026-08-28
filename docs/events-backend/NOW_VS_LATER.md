# Now vs Later

## Now (implemented)

- `findOrCreateUser` is read-only for existing records in all public (unauthenticated) flows — unauthenticated registrations, invite accepts, and proposal submissions cannot overwrite an existing user's profile data.
- Post-registration and post-confirmation success states show the registrant's unique referral (share) URL, pre-filled LinkedIn and X/Twitter share links, and a copy-to-clipboard button — applying Peak-End Rule and Reciprocity psychology to maximise organic sharing.
- Confirmation endpoint (`POST /events/:eventSlug/registrations/confirm-email`) now returns `shareUrl` by looking up the registration's referral code, enabling the confirmation page to present the share panel without needing the manage token.
- Organizer proposal review with per-review feedback and finalize step.
- Invite and registration core workflows with consent capture.
- Private, versioned email template content and metadata in D1, with atomic
  activation and attributable audit history.
- The shared email shell and partials use the same versioned D1 template
  lifecycle as message templates.
- Participant users support organization naming (not company-only), role subtypes, and links.
- Community-foundation tables are present (`users`, `organizations`, `members`, `event_participants`).
- Generic forms support event registration, proposal submission, applications, and feedback (`forms`, `form_fields`, `form_submissions`, `form_submission_answers`).
- Sponsorship uses `sponsors` (core sponsor identity) + `sponsor_events` (event-specific sponsorship details).
- Short referral links with click/conversion tracking.
- Calendar ICS generation in transactional emails with delivery tracked in `email_outbox`.
- Signed calendar replies are persisted and enforced per event day through bounded D1 work; delivery bounces are communication signals only. RSVP enforcement never cancels the registration-wide aggregate, including when the final selected day has no fallback.
- Event-specific Hugo flow pages are integrated via shortcodes + TypeScript islands (registration, proposal, confirm, manage).
- Backend outbound links now resolve to event-specific frontend routes from `events.settings_json.frontend.routes`.
- Multi-day attendance is modeled as first-class operational data with day-level in-person capacity controls (`event_days`, `registration_day_attendance`).
- Gamification-ready subject ledger exists (`engagement_events`) for points and leaderboard derivation across community and events.

## Later (planned, schema-ready)

- **Social graph image generation** for referral share links: each `/r/:code` redirect response should include custom Open Graph / Twitter Card meta tags with the attendee's first name and a call-to-action image, so shared links render as rich previews on LinkedIn, X, Slack, etc. Cloudflare Workers + R2 can generate or cache per-attendee images. Schema-ready via `referral_codes.owner_id` → `users.first_name`.
- Public/anonymous proposal feedback with unique hashed identity per email.
- Cross-provider RSVP truth reconciliation and reconfirmation workflows. Client behavior differs by mailbox/calendar provider, so any broader truth model must combine authenticated provider signals with explicit attendee actions.
- Vanity referral codes and advanced attribution dashboards.
