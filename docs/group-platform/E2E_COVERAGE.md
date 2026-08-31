# Browser coverage for the manual test matrix

The pull request carries a manual test matrix. This records which of its items
a browser journey now proves, which are proved only by the mounted Worker/D1
suites, and which are genuinely unproved — so the manual pass can concentrate
on what automation does not reach instead of repeating what it does.

Evidence here is a named spec or test file. An item without one is listed as
unproved rather than assumed.

## Added in this pass

| Matrix item                                                                                | Spec                                              |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| Membership application submission, review, approval, follow-up email                       | `tests/e2e/membership-application-stages.spec.ts` |
| Every review stage, including `on_hold` with a reason and a resumed application            | `tests/e2e/membership-application-stages.spec.ts` |
| A declined application is terminal and cannot be approved                                  | `tests/e2e/membership-application-stages.spec.ts` |
| Employed applicants cannot select an individual path to avoid their employer               | `tests/e2e/member-join-categories.spec.ts`        |
| Personal/free addresses require the explicit unaffiliated attestation                      | `tests/e2e/member-join-categories.spec.ts`        |
| A verified claimed domain continues into organization access with no duplicate application | `tests/e2e/member-join-categories.spec.ts`        |
| Submission in an organization category other than the fixture default                      | `tests/e2e/member-join-categories.spec.ts`        |
| Read-only identity: unauthorized controls and APIs unavailable                             | `tests/e2e/portal-permission-boundaries.spec.ts`  |
| The exact write permission moves stages but cannot approve                                 | `tests/e2e/portal-permission-boundaries.spec.ts`  |
| Member-only identity signs in and acquires no staff capability                             | `tests/e2e/member-portal-access.spec.ts`          |
| Replayed sign-in capability fails closed without creating a session                        | `tests/e2e/portal-identity-security.spec.ts`      |
| Wrong-purpose capability fails closed                                                      | `tests/e2e/portal-identity-security.spec.ts`      |
| Email-auth fragment removed from the URI and not left in history                           | `tests/e2e/portal-identity-security.spec.ts`      |
| Logout revokes the session rather than clearing the view                                   | `tests/e2e/portal-identity-security.spec.ts`      |
| Narrow mobile navigation: toggle, backdrop, Escape, focus restoration                      | `tests/e2e/portal-mobile-navigation.spec.ts`      |
| Narrow and desktop navigation expose the same authorized destinations                      | `tests/e2e/portal-mobile-navigation.spec.ts`      |
| Known sponsorship tier submits and renders both messages                                   | `tests/e2e/sponsor-application.spec.ts`           |
| Organization contact invites an identity; the user accepts it; later lifecycle periods use successors | `tests/e2e/portal-system-organizations.spec.ts`   |

## Member self-service journeys

Real flows a member performs for themselves, added after a review found the
first pass tested a checklist rather than the product.

| Journey                                                                                                           | Spec                                              |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| One person representing two organizations gets a separate ballot for each, and voting one does not mark the other | `tests/e2e/vote-participation.spec.ts`            |
| Changing your mind replaces your ballot instead of adding one                                                     | `tests/e2e/vote-participation.spec.ts`            |
| An election is decided from the candidate list, and a motion answer is refused for it                             | `tests/e2e/vote-participation.spec.ts`            |
| The ballot box is shut before the window opens and after it closes                                                | `tests/e2e/vote-participation.spec.ts`            |
| A member outside the eligible categories is told so and cannot cast                                               | `tests/e2e/vote-participation.spec.ts`            |
| A proposer adds, updates, and removes a co-speaker while the proposal is open                                     | `tests/e2e/proposal-self-service-states.spec.ts`  |
| Title and abstract are editable while open                                                                        | `tests/e2e/proposal-self-service-states.spec.ts`  |
| Acceptance freezes the abstract but keeps the speaker roster editable                                             | `tests/e2e/proposal-self-service-states.spec.ts`  |
| A rejected proposal closes both the content and the roster                                                        | `tests/e2e/proposal-self-service-states.spec.ts`  |
| An organization contact adds a colleague, and can block and restore that access from their own profile            | `tests/e2e/member-colleague-self-service.spec.ts` |
| A member joins an open working group, sets a mailing-list preference, and leaves again                            | `tests/e2e/member-colleague-self-service.spec.ts` |

## Already proved by a browser journey

- Approval runs full onboarding, provisions the user and organization, and
  sends the welcome mail — `tests/e2e/admin-verification.spec.ts`.
- Group personas: direct chair, inherited manager, local-only participant,
  staff-only manager, anonymous denial — `tests/e2e/portal-personas.spec.ts`
  and `portal-personas-real.spec.ts`.
- Email template create, preview, activate, reopen —
  `tests/e2e/portal-email-templates.spec.ts`.
- Custom role and scoped grant lifecycle —
  `tests/e2e/portal-system-access-control.spec.ts`.
- Analytics tabs load only their focused endpoint —
  `tests/e2e/portal-system-analytics.spec.ts`.
- Scheduled-job registry and canonical pause/resume state mutation —
  `tests/e2e/portal-system-operations.spec.ts`.
- External meeting guest: separate mailbox code, wrong browser, replay —
  `tests/e2e/meeting-guest.spec.ts`.
- Registration, invitation acceptance, confirmation, manage updates, decline,
  and day waitlist — `tests/e2e/browser-rendering.spec.ts`.
- Organization content review diff and approval, sponsorship pipeline, event
  team roles, votes and ballots — `tests/e2e/admin-verification.spec.ts`.

## Proved by the mounted suites, not in a browser

These are covered, but only below the UI. A browser journey would add the
rendering and permission-derived-control dimension, not the rule itself.

- Attendee and speaker invitation validity defaults and bounds —
  `tests/invite-validity.test.ts`.
- Forms remaining editable after responses, with stable field and option
  identities — `tests/form-placements.test.ts`, `tests/form-answers.test.ts`,
  `tests/form-domain-revision-guards.test.ts`.
- Recurring series materialization and generated calendars —
  `tests/event-series-platform.test.ts`.
- Meeting entry security and guest invitation invalidation —
  `tests/meeting-entry-security.test.ts`,
  `tests/meeting-guest-invitations.test.ts`.

## Unproved

- Losing a capacity entirely (rather than switching away from it) while the
  other is preserved. Switching is now covered; revocation is not.
- Multi-organization group participation: selecting a subset of capacities and
  removing one without leaving the group. Joining every eligible capacity and
  leaving entirely are covered.
- Concurrent join/leave/configuration/leadership conflict handling in a
  browser. The atomic behavior is covered by the mounted suites; the bounded
  conflict a user actually sees is not.
- YAML member and sponsor import idempotency.
- Applying migration 0035 to a production-shaped database. This is an
  operational rehearsal and is not automatable here.

## Notes for whoever extends this

- Each spec that signs a staff identity in needs its own scope in
  `scripts/e2e-admin-identities.mjs` and the matching `.d.mts`. Reusing another
  spec's scope trips the per-identity sign-in rate limiter, and the resulting
  failure appears in the _other_ spec.
- Sign in once per file via `storageState` when a file has several tests;
  repeated sign-ins for one address hit the same limiter.
- A relative `fetch` inside `page.evaluate` needs an origin — use
  `ensureAppOrigin` from `tests/e2e/helpers/membership.ts` before the first
  call on a fresh page.
