import type { DatabaseLike } from "../types";
import { EMAIL_LAYOUT_TEMPLATE_KEY } from "./partials";
import { resolveTemplateSet } from "./templates";

/**
 * Every template key the platform sends from code. A key missing from the database fails its outbox rows, so the
 * migrations or `scripts/seed-email-templates.mjs` must provide each one; `tests/tools/required-email-templates.test.ts`
 * keeps this list complete against the code and against those sources. Templates an organizer picks for a campaign
 * are content, not requirements, and are not listed.
 */
export const REQUIRED_EMAIL_TEMPLATE_KEYS = [
  EMAIL_LAYOUT_TEMPLATE_KEY,
  "agenda_changed",
  "agenda_session_booking",
  "agenda_session_invitation",
  "agenda_session_reminder",
  "agenda_speaker_declined",
  "application-approved-welcome",
  "application-closed-no-response",
  "application-received",
  "attendee_invite",
  "co_speaker_invite",
  "donation_expired",
  "donation_payment_failed",
  "donation_thank_you",
  "event_proposal_verify",
  "proposal_speaker_declined",
  "mailing-list-enrolled",
  "meeting-guest-invitation",
  "meeting-guest-verification-code",
  "meeting-occurrence-cancelled",
  "meeting-occurrence-updated",
  "meeting-participant-invitation",
  "meeting-series-invitation",
  "member-account-claim",
  "member-vote-representative-notify",
  "membership-participation-warning",
  "membership-workflow-review-digest",
  "membership_join_existing_member",
  "membership_join_verify",
  "org-contact-assigned",
  "org-content-approved",
  "org-content-rejected",
  "org-content-review-digest",
  "org-content-submitted",
  "organization_identity_reinstatement",
  "partial_membership_review_details",
  "partial_membership_review_summary",
  "presentation_upload_request",
  "proposal_canceled",
  "proposal_decision",
  "proposal_manage_link_transferred",
  "proposal_organizational_representation_request",
  "proposal_representation_review",
  "proposal_speaker_confirmed_by_organizer",
  "proposal_submitted",
  "registration_confirm_email",
  "registration_confirmation_reminder",
  "registration_confirmed",
  "registration_email_change",
  "registration_email_change_notice",
  "registration_email_verify",
  "registration_manage_link",
  "registration_unauthorized",
  "registration_updated",
  "registration_waitlist_offer",
  "rsvp_downgraded",
  "rsvp_warning",
  "speaker_invite",
  "speaker_profile_reminder",
  "speaker_profile_request",
  "sponsor-portal-access",
  "sponsorship-active-confirmation",
  "sponsorship-brochure",
  "sponsorship-lapsed-staff",
  "sponsorship-new-inquiry",
  "user_email_verification",
  "user_magic_link",
  "vote-proposal-rejected",
  "wg-chair-membership-digest",
] as const;

/** Required templates that cannot send: no active version, or an active version without a body. One D1 read. */
export async function readUnavailableRequiredEmailTemplates(db: DatabaseLike) {
  const resolutions = await resolveTemplateSet(db, REQUIRED_EMAIL_TEMPLATE_KEYS);
  return REQUIRED_EMAIL_TEMPLATE_KEYS.flatMap((templateKey) => {
    const resolution = resolutions.get(templateKey);
    return resolution && !resolution.ok ? [{ templateKey, code: resolution.code }] : [];
  });
}
