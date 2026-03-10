# Community + Events Platform Design (Simple, Scalable)

## Goals
- Use one canonical human entity (`users`) to avoid duplicated identity/profile models.
- Keep event operations fast to build now while keeping community expansion possible.
- Support growth loops (invites/referrals/engagement) without a heavy gamification engine.
- Store only operationally useful data now; defer speculative complexity.

## Design Principles
- One concept, one table.
- Event-scoped concerns stay event-scoped (registrations, sponsorships, participants).
- Reusable primitives for cross-domain features (forms, outbox, audit, engagement ledger).
- Append-only where history matters (`audit_log`, `engagement_events`, `registration_attendance_history`).

## Core Domains
1. Identity and Access
- `users`: canonical person record + minimal global role (`admin|user|guest`).
- `auth_magic_links`, `sessions`: admin authentication and revocable sessions.

2. Community
- `organizations`: reusable organization records.
- `members`: a community member can be either a user or an organization.

3. Events
- `events`, `event_terms`.
- `registrations`, `registration_attendance_history`, `waitlist_entries`.
- `session_proposals`, `proposal_speakers`, `proposal_reviews`, `proposal_decisions`, `proposal_feedback_external`.
- `event_participants`: user roles per event (`attendee`, `speaker`, `moderator`, `panelist`, ...).
- `sponsors` + `sponsor_events`: sponsor identity with community-level `sponsorship_level`, plus event sponsorship per event with level/subject.

4. Forms and Data Collection
- `forms`, `form_fields`, `form_submissions`, `form_submission_answers`.
- Replaces event-specific question tables and prevents future schema sprawl.

5. Communication
- `email_template_versions`, `email_outbox`, `unsubscribes`.
- Calendar handling: ICS in email attachments; delivery tracked in outbox, not a dedicated calendar table.

6. Growth and Gamification
- `referral_codes`, `referral_clicks`: attribution and invite loops.
- `engagement_events`: append-only points/actions ledger using `subject_type` + `subject_ref` (community/event/proposal/invite/referral/etc.) for leaderboard/badges later.

## Required Person Fields
- `first_name`, `last_name`: required for personalization, salutation, and social sharing/gamification.
- `preferred_name`: optional personalization fallback.
- `organization_name`, `job_title`, `biography`, `links_json`: event and community context.

## Why This Is Simpler Than Before
- No `users` vs `profiles` vs `identities` split.
- No event-only question table; one generic forms subsystem.
- No per-invite calendar status table; reuse email outbox delivery state.
- Sponsorship is modeled as a reusable sponsor entity linked to events when applicable.

## Gamification Roadmap (Without Overengineering)
Now:
- Unique share code per registration/proposal owner.
- Click + conversion attribution.
- Engagement ledger table ready for points.

Later:
- Deterministic points rules (e.g., invite accepted, proposal submitted, event attended).
- Leaderboard materialized view/job from `engagement_events`.
- Badge issuance table built from ledger thresholds.

## Deferred (Deliberately)
- Complex RBAC permission matrix.
- Multi-identity account linking UX.
- Automated RSVP truth reconciliation across calendar providers.
- Real-time scoring engine.

## Security and Compliance Notes
- Terms acceptance immutable in `consent_acceptances`.
- PII retention policy is configurable (`retention_policies`) while legal consent evidence is retained.
- Sensitive routes remain `no-store`; public GETs can be selectively cached.
