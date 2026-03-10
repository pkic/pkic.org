# Events Backend TODO

## Stage 0: Planning Artifacts
- [x] Create and maintain TODO tracking.
- [x] Create decisions log.
- [x] Create API contract draft.
- [x] Create now-vs-later scope split.
- [x] Add forward-looking data model strategy (`DATA_MODEL_STRATEGY.md`).
- [x] Add combined community+events architecture overview (`PLATFORM_DESIGN.md`).

## Stage 1: Foundation
- [x] Add TypeScript backend tooling.
- [x] Add Wrangler config for D1/R2 bindings.
- [x] Add shared validation/error modules.
- [x] Add max 500-line guard script.
- [x] Centralize reusable Zod API schemas in `shared/schemas/api.ts`.

## Stage 2: Data Model + Migrations
- [x] Add v2 D1 migration set.
- [x] Remove legacy registrations data and remove legacy API routes.
- [x] Generalize unsubscribe model (`unsubscribes`) for future channels.
- [x] Generalize identity/session tables (`users`, `sessions`) for future non-admin roles.
- [x] Add future-ready organization and membership tables (`users`, `organizations`, `members`).
- [x] Replace event-specific questions with generic form infrastructure (`forms`, `form_fields`, `form_submissions`, `form_submission_answers`).
- [x] Add sponsorship core model (`sponsors`) and event linkage (`sponsor_events`).
- [x] Add event-level role table (`event_participants`) for attendee/speaker/moderator/panelist modeling.

## Stage 3: Core Workflows
- [x] Registration + double opt-in.
- [x] Invite accept/decline/reminder-ready data model.
- [x] Proposal submit/edit/withdraw.
- [x] Organizer review + finalize.
- [x] Enforce structured invite-decline reasons (`reasonCode` + optional `reasonNote`).
- [x] Enforce proposal session-type enum and required speaker biography rules.

## Stage 4: Email System
- [x] R2 template version storage + D1 metadata.
- [x] SendGrid outbox processing + retry endpoint.
- [x] Add seed utility for default email templates (D1 metadata + private R2 content) to avoid missing-template runtime failures in local/provisioning workflows.

## Stage 5: Referral + Waitlist
- [x] Short code referral links and click tracking.
- [x] Waitlist promotion workflow.

## Stage 6: Calendar Phase 1
- [x] ICS generation in transactional emails.
- [x] Calendar delivery tracked via `email_outbox` provider status (no dedicated calendar-invite table).

## Stage 7: Hardening + Tests
- [x] Add end-to-end workflow integration test (`tests/full-workflow.test.ts`).
- [x] CI workflow for backend checks.
- [x] Add bootstrap seed script for initial admin user (`scripts/seed-initial-admin.mjs`).

## Stage 8: Deferred Design Readiness
- [x] Schema hooks for public hashed-email proposal feedback.
- [x] Schema hooks for RSVP/reconfirmation tracking.
- [x] Add gamification subject ledger table (`engagement_events`) for points/badges/leaderboards.

## Stage 9: Hugo Frontend Integration (TypeScript-only)
- [x] Add TypeScript frontend structure (`assets/ts/event-flows`, `assets/ts/shared`) and strict frontend tsconfig.
- [x] Add frontend test/typecheck scripts and include them in `npm run check`.
- [x] Add event route metadata support in sync schema (`event.frontend.routes`) and backend route resolver.
- [x] Add forms hydration endpoint (`GET /events/:eventSlug/forms`) with required terms in response.
- [x] Add manage token read endpoints (`GET /registrations/manage/:token`, `GET /proposals/manage/:token`).
- [x] Refactor backend-generated event links (invites, referral redirects, manage URLs) to route resolver.
- [x] Add Hugo shortcodes and event-specific pages for registration/proposal/confirm/manage flows.
- [x] Update active 2026 event CTA to canonical event-specific registration page.

## Stage 10: Security Hardening + Marketing Psychology

- [x] Prevent unauthenticated profile overwrite: `findOrCreateUser` now ignores submitted profile fields when the email already exists (`allowProfileUpdate` defaults to `false`). Only new users are created; existing users are returned as-is.
- [x] Confirmation endpoint returns `shareUrl` by looking up the registration's referral code, enabling the confirm page to present the share panel without needing the manage token.
- [x] Post-registration success state: form is replaced by a contextual success panel (pending/registered/waitlisted), each with appropriate messaging and — where applicable — the referral/share panel (Peak-End Rule).
- [x] Post-confirmation success state: "You're in!" panel with share link presented as the completion reward (Goal-Gradient + Reciprocity).
- [x] Shareable referral link panel: copy-to-clipboard + pre-filled LinkedIn and X/Twitter share buttons (Mimetic Desire, Social Proof, zero-friction sharing).
- [x] Registration shortcode UX copy: "Free to attend" badge (Zero-Price Effect), work email field, autocomplete attributes, "Register now →" CTA.
- [x] Confirmation shortcode UX copy: "one click away" framing (Zeigarnik completion).
- [x] Event-flow SCSS: brand-aligned left-border accent on forms; structured success, share, and social button styles.

## Stage 11: Social Graph Image Generation (Planned)

- [ ] On-demand Open Graph image per referral code: when a link from `/r/:code` is shared, scrape or redirect with og:image/twitter:image pointing to a generated image showing the attendee's first name and a CTA.
- [ ] Cloudflare Worker or Pages Function generates/caches per-attendee images in R2 (e.g. Satori/HTML-to-PNG or a hosted service).
- [ ] Update `referral_codes` redirect handler to inject OG meta tags in a thin HTML wrapper for social crawlers, then JS-redirect actual visitors.

