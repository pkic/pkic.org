# Data Model Strategy

## Design goals
- Keep current event workflows simple and operational.
- Avoid schema dead-ends for community-platform expansion.
- Normalize core identity concepts now: users, organizations, memberships, roles.

## Current foundation (implemented)
- `users`: canonical human record for auth + participant data (`email`, `first_name`, `last_name`, `organization_name`, `job_title`, `biography`, `links_json`).
- `organizations`: generic organization entity with simple metadata.
- `members`: canonical membership subject that can be either:
- `individual` (references `users`) or `organization` (references `organizations`).
- `forms` + `form_fields` + `form_submissions` + `form_submission_answers`: one dynamic-form system for registrations, proposals, applications, surveys, and feedback.
- `event_participants`: role-based participation per event (`attendee`, `speaker`, `moderator`, `panelist`, ...).
- `session_proposals` + `proposal_speakers`: proposal and participant-role assignment.
- `sponsors` + `sponsor_events`: sponsor identity with default community-level `sponsorship_level`, plus event-specific sponsorship assignments.
- `engagement_events`: append-only activity/points ledger for gamification and leaderboards, scoped by generic `subject_type` + `subject_ref` (not event-only).

## Why this matters for future community management
- One membership abstraction for both individuals and organizations: enabled by `members`.
- Straightforward one-table user model avoids identity duplication and keeps operational workflows simple.
- Global user role is constrained to `admin|user|guest`; event roles/subroles are handled via `event_participants`.
- Multi-role participation: enabled by `event_participants` and proposal speaker roles.
- Event sponsorship categorization is modeled in `sponsor_events` (`sponsorship_level`, `sponsorship_subject`) instead of organization typing.
- Growth-ready gamification is enabled by `referral_codes` plus subject-scoped `engagement_events` without forcing a complex scoring engine up front.

## Explicitly deferred
- Unified auth identity across multiple emails (account-linking UX and policy).
- Organization admin workflows and invitation governance.
- Cross-event reputation and scoring models.
