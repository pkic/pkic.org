import {
  ACCOUNT_DELETION_REMOVABLE_PROPOSAL_STATUSES,
  type AccountDeletionBlockerKind,
  type AccountDeletionRemovedKind,
} from "../../../../assets/shared/account-deletion";

/**
 * Every reference to an account, sorted into what is deleted with it and
 * what keeps it. SQL fragments are fixed internal strings; `?1` is always the
 * account's id. A foreign key into `users` or into a deleted table that is
 * not listed here fails the coverage test, so a new table cannot leave an
 * orphan or be deleted by accident.
 */
export type RowPredicate = (alias: string) => string;

export interface AccountDeletionLink {
  /** The column that points at the parent. */
  column: string;
  /** The parent table: `users` unless the row belongs to another deleted row. */
  from?: string;
  /** The parent's key column; `id` unless stated. */
  key?: string;
  where?: RowPredicate;
  /** The column has no declared foreign key. */
  foreignKey?: false;
}

export interface AccountDeletionRemovedTable {
  table: string;
  kind: AccountDeletionRemovedKind;
  links: readonly AccountDeletionLink[];
  /** Statements around the delete, for a table whose trigger only allows a sanctioned erasure. */
  erasure?: { before: string; after: string };
  /**
   * Rows that are part of another listed record, such as a proposal's
   * speakers: deleted with it, but not counted as records of their own.
   */
  counted?: false;
}

export interface AccountDeletionBlockingRule extends AccountDeletionLink {
  table: string;
  kind: AccountDeletionBlockerKind;
}

/**
 * A foreign key whose rows another rule already removes or reports. A
 * restricting key refuses anything else; a cascading or nulling key is listed
 * here only once its rows are known to belong to this account.
 */
export interface AccountDeletionCoveredReference {
  table: string;
  column: string;
  references: string;
}

const removableProposalStatuses = ACCOUNT_DELETION_REMOVABLE_PROPOSAL_STATUSES.map((status) => `'${status}'`).join(",");
const removableProposal: RowPredicate = (a) => `${a}.status IN (${removableProposalStatuses})`;
const ownRemovableProposalIds = `SELECT own_proposal.id FROM session_proposals own_proposal
  WHERE own_proposal.proposer_user_id = ?1 AND own_proposal.status IN (${removableProposalStatuses})`;
const nowSql = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const liveRole: RowPredicate = (a) =>
  `(${a}.revoked_at IS NULL AND (${a}.expires_at IS NULL OR ${a}.expires_at > ${nowSql}))`;
const notThisAccount =
  (column: string): RowPredicate =>
  (a) =>
    `${a}.${column} IS NOT ?1`;

const user = (column: string, where?: RowPredicate): AccountDeletionLink => ({ column, where });
const child = (column: string, from: string, key?: string): AccountDeletionLink => ({ column, from, key });
const part = (entry: AccountDeletionRemovedTable): AccountDeletionRemovedTable => ({ ...entry, counted: false });
/** A render or batch step that holds a live lease may still write a file for the account. */
const leased =
  (status: string): RowPredicate =>
  (a) =>
    `(${a}.status = '${status}' AND ${a}.lease_expires_at > ${nowSql})`;

export const ACCOUNT_DELETION_REMOVED_TABLES: readonly AccountDeletionRemovedTable[] = [
  { table: "user_emails", kind: "email_address", links: [user("user_id")] },
  // Deleting participants and speakers writes these through triggers, so they are listed before both and go last.
  part({ table: "event_participant_source_revisions", kind: "registration", links: [user("user_id")] }),
  part({ table: "event_participant_source_revision_guards", kind: "registration", links: [user("user_id")] }),
  { table: "sessions", kind: "sign_in", links: [user("user_id")] },
  { table: "passkey_credentials", kind: "sign_in", links: [user("user_id")] },
  { table: "identities", kind: "identity", links: [user("user_id")] },
  part({ table: "person_profile_slugs", kind: "identity", links: [user("user_id")] }),
  part({ table: "oauth_authorizations", kind: "sign_in", links: [user("user_id")] }),
  part({
    table: "oauth_authorization_completions",
    kind: "sign_in",
    links: [child("authorization_id", "oauth_authorizations")],
  }),
  part({
    table: "oauth_authorization_permissions",
    kind: "sign_in",
    links: [child("authorization_id", "oauth_authorizations")],
  }),
  part({ table: "session_email_authentication", kind: "sign_in", links: [child("session_id", "sessions")] }),
  { table: "registrations", kind: "registration", links: [user("user_id")] },
  part({
    table: "registration_attendance_history",
    kind: "registration",
    links: [child("registration_id", "registrations")],
  }),
  part({
    table: "registration_day_attendance",
    kind: "registration",
    links: [child("registration_id", "registrations")],
  }),
  part({ table: "calendar_rsvp_events", kind: "registration", links: [child("registration_id", "registrations")] }),
  part({
    table: "registration_badge_role_overrides",
    kind: "registration",
    links: [child("registration_id", "registrations")],
  }),
  part({
    table: "registration_transition_guards",
    kind: "registration",
    links: [child("registration_id", "registrations")],
  }),
  part({
    table: "event_day_capacity_guards",
    kind: "registration",
    links: [child("claim_registration_id", "registrations")],
  }),
  part({
    table: "event_day_waitlist_entries",
    kind: "registration",
    links: [user("user_id"), child("registration_id", "registrations")],
  }),
  part({ table: "registration_tickets", kind: "registration", links: [child("registration_id", "registrations")] }),
  part({
    table: "registration_ticket_checkouts",
    kind: "registration",
    links: [child("ticket_id", "registration_tickets")],
  }),
  part({
    table: "registration_ticket_payment_events",
    kind: "registration",
    links: [child("ticket_id", "registration_tickets")],
  }),
  part({
    table: "registration_ticket_refunds",
    kind: "registration",
    links: [child("ticket_id", "registration_tickets")],
  }),
  part({ table: "event_ticket_selections", kind: "registration", links: [user("user_id")] }),
  part({ table: "unfinished_registrations", kind: "registration", links: [user("user_id")] }),
  part({ table: "event_participants", kind: "registration", links: [user("user_id")] }),
  part({ table: "event_badge_credentials", kind: "registration", links: [user("user_id")] }),
  { table: "event_occurrence_rsvps", kind: "registration", links: [{ column: "user_id", foreignKey: false }] },
  { table: "session_proposals", kind: "proposal", links: [user("proposer_user_id", removableProposal)] },
  // Deleting a speaker bumps the roster revision, so the revisions are listed before the speakers and go after them.
  part({
    table: "proposal_speaker_roster_revisions",
    kind: "proposal",
    links: [child("proposal_id", "session_proposals")],
  }),
  part({
    table: "proposal_speaker_roster_revision_guards",
    kind: "proposal",
    links: [child("proposal_id", "session_proposals")],
  }),
  part({ table: "proposal_speakers", kind: "proposal", links: [child("proposal_id", "session_proposals")] }),
  // Automatic check verdicts name their subject without a foreign key: a removed proposal's, and an identity's bio.
  part({
    table: "content_check_results",
    kind: "proposal",
    links: [
      { column: "subject_id", from: "session_proposals", foreignKey: false, where: (a) => `${a}.kind = 'proposal'` },
      { column: "subject_id", from: "identities", foreignKey: false, where: (a) => `${a}.kind = 'person_profile'` },
    ],
  }),
  part({
    table: "proposal_speaker_independent_disclosures",
    kind: "proposal",
    links: [user("user_id"), child("proposal_speaker_id", "proposal_speakers")],
  }),
  { table: "form_submissions", kind: "form_response", links: [user("submitted_by_user_id")] },
  part({
    table: "form_submission_answers",
    kind: "form_response",
    links: [child("submission_id", "form_submissions")],
  }),
  part({ table: "form_submission_guards", kind: "form_response", links: [child("submission_id", "form_submissions")] }),
  { table: "event_promotion_kits", kind: "promotion", links: [user("user_id")] },
  part({ table: "event_promotion_renders", kind: "promotion", links: [user("user_id")] }),
  part({ table: "event_promotion_batch_recipients", kind: "promotion", links: [user("user_id")] }),
  {
    table: "group_memberships",
    kind: "group_history",
    links: [user("user_id", (a) => `${a}.left_at IS NOT NULL`)],
    // Group history is ended, never deleted, unless an erasure is recorded for the identity for the length of the batch.
    erasure: {
      before: `INSERT INTO group_membership_erasures(identity_id,created_at,preimage_json)
        SELECT DISTINCT seat.identity_id,${nowSql},json_object('accountDeletionUserId',?1)
        FROM group_memberships seat WHERE seat.user_id = ?1
        ON CONFLICT(identity_id) DO NOTHING`,
      after: "DELETE FROM group_membership_erasures WHERE json_extract(preimage_json,'$.accountDeletionUserId') = ?1",
    },
  },
  part({ table: "google_groups_membership_desired_state", kind: "group_history", links: [user("user_id")] }),
  part({ table: "google_groups_observed_membership", kind: "group_history", links: [user("user_id")] }),
  part({ table: "google_groups_sync_queue", kind: "group_history", links: [user("user_id")] }),
  { table: "user_roles", kind: "ended_role", links: [user("user_id", (a) => `NOT ${liveRole(a)}`)] },
  { table: "affiliation_reviews", kind: "affiliation_review", links: [user("user_id")] },
  part({ table: "affiliation_offer_dismissals", kind: "affiliation_review", links: [user("user_id")] }),
  part({ table: "organization_link_notices", kind: "affiliation_review", links: [user("user_id")] }),
  { table: "account_policy_acceptances", kind: "consent", links: [user("user_id")] },
  { table: "consent_acceptances", kind: "consent", links: [user("user_id")] },
  { table: "event_access_term_acceptances", kind: "consent", links: [user("user_id")] },
  { table: "email_outbox", kind: "email", links: [user("recipient_user_id")] },
  part({
    table: "organization_content_review_notification_intents",
    kind: "email",
    links: [user("recipient_user_id")],
  }),
  part({
    table: "google_groups_enrollment_notification_intents",
    kind: "email",
    links: [user("user_id"), child("queue_id", "google_groups_sync_queue")],
  }),
  part({ table: "event_series_calendar_deliveries", kind: "email", links: [user("user_id")] }),
  { table: "referral_codes", kind: "referral_code", links: [user("created_by_user_id")] },
  part({ table: "referral_clicks", kind: "referral_code", links: [child("code", "referral_codes", "code")] }),
  { table: "agenda_calendar_entries", kind: "personal_setting", links: [user("user_id")] },
  { table: "agenda_calendar_preferences", kind: "personal_setting", links: [user("user_id")] },
  { table: "agenda_calendar_subscriptions", kind: "personal_setting", links: [user("user_id")] },
  { table: "agenda_push_devices", kind: "personal_setting", links: [user("user_id")] },
  part({
    table: "agenda_push_event_preferences",
    kind: "personal_setting",
    links: [child("device_id", "agenda_push_devices")],
  }),
  part({
    table: "agenda_push_outbox",
    kind: "personal_setting",
    links: [user("user_id"), child("device_id", "agenda_push_devices")],
  }),
  { table: "agenda_session_reminders", kind: "personal_setting", links: [user("user_id")] },
  { table: "user_availability", kind: "personal_setting", links: [user("user_id")] },
  { table: "user_skills", kind: "personal_setting", links: [user("user_id")] },
  part({ table: "user_skill_vouches", kind: "personal_setting", links: [child("user_skill_id", "user_skills")] }),
  { table: "individual_job_titles", kind: "personal_setting", links: [user("user_id")] },
  { table: "group_automatic_enrollment_opt_outs", kind: "personal_setting", links: [user("user_id")] },
  { table: "mailing_list_subscription_preferences", kind: "personal_setting", links: [user("user_id")] },
  { table: "engagement_events", kind: "activity", links: [user("user_id")] },
];

const rule = (
  kind: AccountDeletionBlockerKind,
  table: string,
  column: string,
  extra: Omit<AccountDeletionLink, "column"> = {},
): AccountDeletionBlockingRule => ({ kind, table, column, ...extra });
const participation = (table: string, column = "user_id") => rule("event_participation", table, column);
const authored = (table: string, column: string, where?: RowPredicate) =>
  rule("authored_record", table, column, { where });

export const ACCOUNT_DELETION_BLOCKING_RULES: readonly AccountDeletionBlockingRule[] = [
  rule("role", "user_roles", "user_id", { where: liveRole }),
  rule("role", "organization_secondary_contact_nominations", "nominated_user_id"),
  rule("staff_access", "permission_grants", "user_id"),
  rule("member_application", "member_applications", "applicant_user_id"),
  rule("member_application", "member_applications", "form_submission_id", { from: "form_submissions" }),
  rule("member_application", "membership_application_steps", "notice_outbox_id", { from: "email_outbox" }),
  rule("membership", "members", "identity_id", { from: "identities" }),
  rule("proposal", "session_proposals", "proposer_user_id", { where: (a) => `NOT ${removableProposal(a)}` }),
  rule("proposal", "proposal_speakers", "user_id", {
    where: (a) => `${a}.proposal_id NOT IN (${ownRemovableProposalIds})`,
  }),
  rule("proposal", "proposal_speakers", "proposal_id", { from: "session_proposals", where: notThisAccount("user_id") }),
  ...[
    "proposal_reviews",
    "proposal_decisions",
    "proposal_feedback_external",
    "proposal_internal_comments",
    "presentation_versions",
    "proposal_decision_history",
    "proposal_review_history",
    "event_agenda_contents",
  ].map((table) => rule("proposal", table, "proposal_id", { from: "session_proposals" })),
  ...[
    "agenda_session_delegations",
    "agenda_session_holds",
    "agenda_session_invitation_audit",
    "agenda_session_invitations",
    "agenda_session_participations",
    "agenda_session_rsvp_receipts",
    "event_agenda_appearance_override_requests",
    "event_agenda_assignments",
    "event_agenda_occurrence_speakers",
    "event_agenda_operational_days",
    "event_agenda_operational_people",
    "event_agenda_role_members",
    "event_attendance_observations",
    "event_entry_admissions",
    "event_occurrence_guests",
    "event_occurrence_join_confirmations",
    "event_occurrence_join_guards",
    "event_offline_admission_access",
    "event_offline_admission_entitlements",
    "event_offline_admission_spends",
    "event_scan_attempts",
    "event_session_admissions",
    "event_session_room_erasures",
    "event_sponsor_leads",
    "meeting_agenda_speaker_intervals",
  ].map((table) => participation(table)),
  participation("event_session_questions", "author_user_id"),
  participation("event_session_questions", "addressed_to_user_id"),
  participation("event_session_question_answers", "author_user_id"),
  participation("event_participation_blocks"),
  rule("event_participation", "event_scan_attempts", "badge_id", { from: "event_badge_credentials" }),
  // A closed or running evidence capture keeps its badges; the table's trigger refuses the delete.
  rule("event_participation", "event_badge_credentials", "user_id", {
    where: (
      a,
    ) => `EXISTS (SELECT 1 FROM event_evidence_retention_state retention WHERE retention.event_id = ${a}.event_id
      AND (retention.capture_closed_at IS NOT NULL OR retention.active_run_id IS NOT NULL))`,
  }),
  // Keep provider history even after a pending ticket is canceled: an open payment page or an asynchronous
  // payment may still settle. An expired payment page that never reached the provider settles nothing.
  rule("ticket_payment", "registration_tickets", "registration_id", {
    from: "registrations",
    where: (a) => `(${a}.status IN ('pending_payment','paid','refunded') OR ${a}.paid_amount > 0
      OR EXISTS (SELECT 1 FROM registration_ticket_checkouts checkout WHERE checkout.ticket_id = ${a}.id
        AND checkout.expires_at > ${nowSql})
      OR EXISTS (SELECT 1 FROM registration_ticket_payment_events payment WHERE payment.ticket_id = ${a}.id)
      OR EXISTS (SELECT 1 FROM registration_ticket_refunds refund WHERE refund.ticket_id = ${a}.id))`,
  }),
  rule("vote", "ec_decisions", "ec_member_user_id"),
  rule("vote", "vote_ballots", "user_id"),
  rule("vote", "vote_candidates", "user_id"),
  rule("vote", "vote_consultation_responses", "user_id"),
  rule("vote", "vote_consultation_responses", "submission_id", { from: "form_submissions" }),
  rule("vote", "vote_proposal_endorsements", "endorser_user_id"),
  rule("vote", "vote_representative_notification_intents", "representative_user_id"),
  // The file a leased render writes after the delete would have no row left to remove it.
  rule("promotion_render", "event_promotion_renders", "user_id", { where: leased("rendering") }),
  rule("promotion_render", "event_promotion_batch_recipients", "user_id", { where: leased("preparing") }),
  rule("recognition", "user_recognitions", "user_id"),
  rule("recognition", "user_standing_awards", "user_id"),
  rule("mailing_list", "group_memberships", "user_id", { where: (a) => `${a}.left_at IS NULL` }),
  rule("mailing_list", "google_groups_membership_desired_state", "user_id", {
    where: (a) => `${a}.desired_action <> 'remove_from_list'`,
  }),
  rule("mailing_list", "google_groups_sync_queue", "user_id", {
    where: (a) => `${a}.status IN ('pending','processing')`,
  }),
  rule("mailing_list", "google_groups_observed_membership", "user_id", {
    where: (a) =>
      `${a}.last_observed_present_at IS NOT NULL AND (${a}.last_observed_absent_at IS NULL OR ${a}.last_observed_absent_at < ${a}.last_observed_present_at)`,
  }),
  authored("affiliation_reviews", "resolved_by_user_id", notThisAccount("user_id")),
  authored("agenda_session_delegations", "created_by"),
  authored("agenda_session_holds", "created_by"),
  authored("agenda_session_invitation_audit", "actor_id"),
  authored("agenda_session_invitations", "invited_by"),
  authored("application_communications", "actor_user_id"),
  authored("application_concerns", "submitted_by_user_id"),
  authored("content_check_settings", "updated_by_user_id"),
  authored("event_agenda_appearance_override_decisions", "reviewed_by"),
  authored("event_agenda_appearance_override_requests", "requested_by"),
  authored("event_agenda_import_provenance", "imported_by"),
  authored("event_agenda_publications", "created_by"),
  authored("event_agenda_room_outputs", "updated_by_user_id"),
  authored("event_content_check_additions", "updated_by_user_id"),
  authored("event_agenda_room_streams", "updated_by"),
  authored("event_agenda_session_history", "updated_by"),
  authored("event_attendance_corrections", "actor_user_id"),
  authored("event_attendance_import_reviews", "actor_user_id"),
  authored("event_attendance_imports", "actor_user_id"),
  authored("event_attendance_imports", "reviewer_user_id"),
  authored("event_attendance_point_keys", "issued_by_user_id"),
  authored("event_email_campaigns", "actor_id"),
  authored("event_evidence_retention_chunks", "actor_user_id"),
  authored("event_evidence_retention_policies", "updated_by"),
  authored("event_evidence_retention_policy_operations", "actor_user_id"),
  authored("event_evidence_retention_resumptions", "actor_user_id"),
  authored("event_evidence_retention_reviews", "actor_user_id"),
  authored("event_evidence_retention_runs", "actor_user_id"),
  authored("event_group_grants", "created_by_user_id"),
  authored("event_live_overlay_layouts", "updated_by_user_id"),
  authored("event_live_overlay_positions", "updated_by_user_id"),
  authored("event_meeting_agenda_formats", "created_by"),
  authored("event_meeting_occurrence_agendas", "created_by"),
  authored("event_offline_admission_grants", "created_by"),
  authored("event_offline_admission_grants", "operator_user_id"),
  authored("event_participation_blocks", "blocked_by"),
  authored("event_participation_blocks", "lifted_by"),
  authored("event_promotion_batches", "requested_by"),
  authored("event_recording_acquisitions", "requested_by_user_id"),
  authored("event_recording_meetings", "linked_by_user_id"),
  authored("event_recording_sources", "created_by_user_id"),
  authored("event_resource_management_guards", "actor_user_id"),
  authored("event_scan_attempts", "operator_user_id"),
  authored("event_scanner_device_sessions", "operator_user_id"),
  authored("event_ticket_codes", "created_by_user_id"),
  authored("ticket_classifier_decisions", "decided_by_user_id"),
  authored("registration_ticket_refunds", "requested_by_user_id"),
  authored("event_session_polls", "closed_by"),
  authored("event_session_polls", "created_by"),
  authored("event_session_polls", "opened_by"),
  authored("event_session_question_answers", "accepted_by"),
  authored("event_session_question_answers", "hidden_by"),
  authored("event_session_questions", "moderated_by"),
  authored("event_session_questions", "rewritten_by"),
  authored("event_sponsor_leads", "operator_user_id"),
  authored("form_placement_group_grants", "created_by_user_id"),
  authored("group_memberships", "created_by_user_id", notThisAccount("user_id")),
  authored("identities", "blocked_by_user_id", notThisAccount("user_id")),
  authored("invite_inviters", "inviter_user_id"),
  authored("invites", "inviter_user_id"),
  authored("mailing_list_group_grants", "created_by_user_id"),
  authored("mailing_list_subscription_preferences", "updated_by_user_id", notThisAccount("user_id")),
  authored("member_application_events", "actor_user_id"),
  authored("member_applications", "assigned_to_user_id"),
  authored("membership_application_objections", "author_user_id"),
  authored("membership_application_objections", "recorded_by_user_id"),
  authored("membership_application_objections", "resolved_by_user_id"),
  authored("membership_application_steps", "completed_by_user_id"),
  authored("membership_settings", "updated_by_user_id"),
  authored("membership_workflow_archives", "archived_by_user_id"),
  authored("membership_workflow_versions", "published_by_user_id"),
  authored("organization_contact_details", "updated_by_user_id"),
  authored("organization_content_reviews", "reviewer_user_id"),
  authored("organization_content_reviews", "submitted_by_user_id"),
  authored("organization_domain_link_runs", "requested_by_user_id"),
  authored("organization_secondary_contact_nominations", "nominated_by_user_id"),
  authored("payment_ledger_events", "actor_user_id"),
  authored("permission_grants", "granted_by_user_id"),
  authored("presentation_version_reviews", "reviewed_by_user_id"),
  authored("presentation_versions", "uploaded_by_user_id"),
  authored("proposal_decision_history", "decided_by_user_id"),
  authored("proposal_decisions", "decided_by_user_id"),
  authored("proposal_internal_comments", "author_user_id"),
  authored("proposal_review_history", "reviewer_user_id"),
  authored("proposal_reviews", "reviewer_user_id"),
  authored("proposal_speaker_independent_disclosures", "reviewed_by", notThisAccount("user_id")),
  rule("authored_record", "referral_conversions", "code", { from: "referral_codes", key: "code" }),
  authored(
    "registration_badge_role_overrides",
    "set_by_user_id",
    (a) =>
      `${a}.registration_id NOT IN (SELECT own_registration.id FROM registrations own_registration WHERE own_registration.user_id = ?1)`,
  ),
  authored("registrations", "created_identity_user_id", notThisAccount("user_id")),
  authored("scheduled_jobs", "paused_by_user_id"),
  authored("screen_sessions", "approved_by"),
  authored("screens", "assigned_by"),
  authored("screens", "created_by"),
  authored("session_presentation_reviews", "reviewed_by_user_id"),
  authored("session_presentation_versions", "uploaded_by_user_id"),
  authored("session_proposals", "canceled_by_user_id", notThisAccount("proposer_user_id")),
  authored("sponsorship_events", "actor_user_id"),
  authored("sponsorships", "assigned_to_user_id"),
  authored("user_roles", "granted_by_user_id", notThisAccount("user_id")),
  authored(
    "user_skill_vouches",
    "voucher_user_id",
    (a) => `${a}.user_skill_id NOT IN (SELECT own_skill.id FROM user_skills own_skill WHERE own_skill.user_id = ?1)`,
  ),
  authored("vote_candidates", "nominated_by_user_id"),
  authored("vote_group_grants", "created_by_user_id"),
  authored("vote_proposals", "proposed_by_user_id"),
  authored("votes", "created_by_user_id"),
  authored("votes", "proposed_by_user_id"),
  { ...authored("email_template_versions", "created_by_user_id"), foreignKey: false },
  { ...authored("users", "merged_into_user_id", notThisAccount("id")), foreignKey: false },
];

/**
 * Same-person references through an identity. The row is removed or reported
 * by its rule on the account's own column; if it ever is not, the foreign key
 * refuses the delete and staff see that the account is in use.
 */
export const ACCOUNT_DELETION_COVERED_REFERENCES: readonly AccountDeletionCoveredReference[] = [
  { table: "proposal_speakers", column: "acting_identity_id", references: "identities" },
  { table: "group_memberships", column: "identity_id", references: "identities" },
  { table: "identities", column: "predecessor_identity_id", references: "identities" },
  { table: "user_roles", column: "identity_id", references: "identities" },
  { table: "vote_consultation_responses", column: "identity_id", references: "identities" },
  { table: "vote_ballots", column: "identity_id", references: "identities" },
  { table: "vote_representative_notification_intents", column: "identity_id", references: "identities" },
  { table: "affiliation_reviews", column: "resolved_identity_id", references: "identities" },
  { table: "organization_link_notices", column: "identity_id", references: "identities" },
  { table: "identities", column: "email_id", references: "user_emails" },
  { table: "user_emails", column: "identity_id", references: "identities" },
  { table: "registrations", column: "registration_identity_id", references: "identities" },
  { table: "oauth_authorizations", column: "identity_id", references: "identities" },
  { table: "oauth_authorizations", column: "session_id", references: "sessions" },
  { table: "session_email_authentication", column: "email_id", references: "user_emails" },
];

/** Account references without a foreign key that stay after the delete, on purpose. */
export const ACCOUNT_DELETION_KEPT_REFERENCES: readonly { table: string; column: string }[] = [
  // The audit trail keeps who acted and on which account; the account id no longer resolves.
  { table: "audit_log", column: "actor_id" },
  // A resumable scan position, not a reference to the person.
  { table: "organization_domain_link_runs", column: "cursor_user_id" },
];
