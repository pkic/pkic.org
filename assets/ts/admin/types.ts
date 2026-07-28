export interface EventSummary {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  starts_at: string | null;
  ends_at: string | null;
  registration_mode: string;
  invite_limit_attendee: number;
  confirmed_registrations: number;
  total_registrations: number;
  pending_invites: number;
}

export interface EventDetail extends EventSummary {
  id: string;
  base_path: string | null;
  user_retention_days: number | null;
  venue: string | null;
  virtual_url: string | null;
  hero_image_url: string | null;
  location: string | null;
  session_types: Array<{ label: string; requiresPresentation: boolean }> | null;
  settings: Record<string, unknown>;
}

export interface AdminEventDay {
  id: string;
  date: string;
  label: string | null;
  startsAt: string | null;
  endsAt: string | null;
  sortOrder: number;
  attendanceOptions: AdminAttendanceOption[];
  attendanceCounts: Record<string, number>;
}

export interface AdminAttendanceOption {
  value: string;
  label: string;
  capacity?: number | null;
}

export interface AdminEventTerm {
  id: string;
  audience_type: string;
  term_key: string;
  version: string;
  required: number;
  content_ref: string | null;
  display_text: string | null;
  help_text: string | null;
}

export interface AdminEventFormSummary {
  id: string;
  key: string;
  scope_type: string;
  scope_ref: string | null;
  event_slug?: string | null;
  event_name?: string | null;
  purpose: string;
  status: string;
  title: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  field_count: number;
  submission_count: number;
}

export interface AdminFormDetailField {
  id: string;
  key: string;
  label: string;
  fieldType: string;
  required: boolean;
  options: unknown;
  validation: unknown;
  sortOrder: number;
}

export type ApiFn = <T = unknown>(
  path: string,
  opts?: RequestInit & { headers?: Record<string, string> },
) => Promise<T>;

export interface RegistrationAttendanceChange {
  changedAt: string;
  transitions: Array<{
    fromType: string;
    toType: string;
    days: Array<{ dayDate: string; label: string | null }>;
  }>;
}

export interface Registration {
  id: string;
  user_id: string;
  user_email?: string;
  display_name?: string;
  status: string;
  attendance_type?: string;
  source_type?: string;
  created_at: string;
  referral_code?: string | null;
  rsvp_events_json?: string | null;
  has_bounced?: boolean;
  dayAttendance?: Array<{ dayDate: string; attendanceType: string; label: string | null }>;
  dayWaitlist?: Array<{ dayDate: string; status: string; priorityLane: string; offerExpiresAt: string | null }>;
  dayWaitlistSummary?: string | null;
  dayWaitlistCount?: number;
  attendanceChangeHistory?: RegistrationAttendanceChange[];
  lastAttendanceChange?: RegistrationAttendanceChange | null;
  sponsor_consent?: boolean;
  dietary_restrictions?: string[] | null;
}

export interface AdminRegistrationDay {
  dayDate: string;
  label: string | null;
}

export interface BadgeRoleInfo {
  admin_override: string | null;
  auto_detected: string;
  effective_role: string;
  available_roles: string[];
}

export interface AdminFormSubmission {
  id: string;
  status: string;
  submittedAt: string;
  contextType: string | null;
  contextRef: string | null;
  submitter: {
    id: string;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
    organization: string | null;
  } | null;
  answers: Record<string, unknown>;
}

export interface EventPermission {
  id: string;
  user_email: string;
  user_id: string | null;
  permission: string;
  granted_by_id: string;
  expires_at: string | null;
  created_at: string;
  granter_email: string | null;
}

// ── Access control (PRD §2.4) ─────────────────────────────────────────────────

export interface Role {
  id: string;
  name: string;
  description: string | null;
  isSystemRole: boolean;
  permissions: string[];
  createdAt: string;
}

export interface AccessGrant {
  id: string;
  userId: string;
  permission: string;
  contextType: string | null;
  contextId: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface UserRoleAssignment {
  id: string;
  userId: string;
  roleId: string;
  roleName: string;
  contextType: string | null;
  contextId: string | null;
  expiresAt: string | null;
  createdAt: string;
}

/** GET /api/v1/admin/roles/:id/assignments — reverse lookup: who holds this role. */
export interface RoleAssignment {
  userRoleId: string;
  userId: string;
  name: string;
  email: string;
  contextType: string | null;
  contextId: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface WorkingGroupSummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  active: boolean;
}

export interface WorkingGroupDetail extends WorkingGroupSummary {
  mailingListEmail: string | null;
  members: Array<{ name: string; organizationName: string | null }>;
}

// ── Admin working-group CRUD (unfiltered by active, full roster w/ user ids) ──

export interface ChairInfo {
  userRoleId: string;
  userId: string;
  name: string;
  email: string;
}

export interface AdminWorkingGroupSummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  mailingListEmail: string | null;
  minEndorsersForBallot: number;
  active: boolean;
  /** @deprecated Never written after row creation — see chair/viceChair. */
  chairUserId: string | null;
  chair: ChairInfo | null;
  viceChair: ChairInfo | null;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminWorkingGroupMember {
  userId: string;
  name: string;
  email: string;
  organizationName: string | null;
  joinedAt: string;
}

export interface AdminWorkingGroupDetail extends AdminWorkingGroupSummary {
  members: AdminWorkingGroupMember[];
}

// ── Passkeys (PRD §3.5) ────────────────────────────────────────────────────────

export interface Passkey {
  id: string;
  deviceName: string | null;
  aaguid: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface ProposalSummary {
  id: string;
  event_id: string;
  proposer_user_id: string;
  status: string;
  proposal_type: string;
  title: string;
  abstract: string;
  submitted_at: string;
  updated_at: string;
  proposer_email: string;
  proposer_first_name: string | null;
  proposer_last_name: string | null;
  review_count: number;
  average_review_score: number | null;
  recommendation_accept_count: number;
  recommendation_needs_work_count: number;
  recommendation_reject_count: number;
  decision_status: string | null;
  decision_note: string | null;
  decision_decided_at: string | null;
}

export interface ProposalReview {
  id: string;
  reviewer_user_id: string;
  recommendation: "accept" | "reject" | "needs-work";
  score: number | null;
  reviewer_comment: string | null;
  applicant_note: string | null;
  updated_at: string;
  reviewer_email?: string;
  reviewer_first_name?: string | null;
  reviewer_last_name?: string | null;
}

export interface ProposalSpeaker {
  userId: string;
  role: string;
  status: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  organizationName: string | null;
  jobTitle: string | null;
  biography: string | null;
  links?: Array<string | { label?: string | null; url?: string | null }>;
  headshotUrl: string | null;
  confirmedAt: string | null;
  declinedAt: string | null;
  declineReason: string | null;
  hasHeadshot: boolean;
  hasBio: boolean;
}

export interface ProposalAccess {
  eventPermissions: string[];
  canReview: boolean;
  canFinalize: boolean;
}

export interface AdminInviteEntry {
  email: string;
  firstName?: string;
  lastName?: string;
}

export interface InviteRecord {
  id: string;
  invitee_email: string;
  invitee_first_name: string | null;
  invitee_last_name: string | null;
  invite_type: string;
  status: string;
  decline_reason_code: string | null;
  decline_reason_note: string | null;
  unsubscribe_future: number;
  source_type: string;
  created_at: string;
  accepted_at: string | null;
  declined_at: string | null;
  inviter_user_id: string | null;
  inviter_email: string | null;
  inviter_first_name: string | null;
  inviter_last_name: string | null;
}

export interface AdminEmailOutboxRow {
  id: string;
  eventSlug: string | null;
  eventName: string | null;
  templateKey: string;
  templateVersion: number | null;
  recipientEmail: string;
  recipientName: string | null;
  subject: string;
  messageType: "transactional" | "promotional";
  provider: string;
  providerMessageId: string | null;
  status: "queued" | "sending" | "sent" | "failed" | "retrying";
  attempts: number;
  sendAfter: string;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
  bccRecipientCount: number;
  hasCalendarInvite: boolean;
  hasBadgeAttachment: boolean;
  usesDirectBody: boolean;
  hasCustomText: boolean;
}

export interface AdminEmailOutboxResponse {
  outbox: AdminEmailOutboxRow[];
  summary: {
    total: number;
    byStatus: Record<string, number>;
    byMessageType: Record<string, number>;
    topTemplates: Array<{ template_key: string; count: number }>;
    dueNow: number;
    dueByStatus: Record<string, number>;
    nextSendAfter: string | null;
  };
  page: { limit: number; offset: number; total: number; hasMore: boolean };
}

export interface AdminJobsRunResponse {
  dryRun: boolean;
  reminders: {
    processed: number;
    inviteRemindersQueued: number;
    speakerInviteRemindersQueued: number;
    presentationRemindersQueued: number;
    confirmationRemindersQueued: number;
    preview: {
      attendeeInvites: Array<{
        category: "attendee_invite";
        templateKey: string;
        eventName: string;
        eventSlug: string;
        recipientEmail: string;
        recipientName: string | null;
        proposalTitle: string | null;
        reminderNumber: number;
        dueAt: string | null;
        subject: string;
      }>;
      speakerInvites: Array<{
        category: "speaker_invite";
        templateKey: string;
        eventName: string;
        eventSlug: string;
        recipientEmail: string;
        recipientName: string | null;
        proposalTitle: string | null;
        reminderNumber: number;
        dueAt: string | null;
        subject: string;
      }>;
      coSpeakerInvites: Array<{
        category: "co_speaker_invite";
        templateKey: string;
        eventName: string;
        eventSlug: string;
        recipientEmail: string;
        recipientName: string | null;
        proposalTitle: string | null;
        reminderNumber: number;
        dueAt: string | null;
        subject: string;
      }>;
      presentationUploads: Array<{
        category: "presentation_upload_request";
        templateKey: string;
        eventName: string;
        eventSlug: string;
        recipientEmail: string;
        recipientName: string | null;
        proposalTitle: string | null;
        reminderNumber: number;
        dueAt: string | null;
        subject: string;
      }>;
      registrationConfirmations: Array<{
        category: "registration_confirmation";
        templateKey: string;
        eventName: string;
        eventSlug: string;
        recipientEmail: string;
        recipientName: string | null;
        proposalTitle: string | null;
        reminderNumber: number;
        dueAt: string | null;
        subject: string;
      }>;
    };
  };
  shouldRunRetention: boolean;
  retention: {
    redactedRegistrations: number;
    redactedUsers: number;
    affectedEvents: number;
    preview: {
      dueEvents: Array<{
        eventId: string;
        eventName: string;
        eventSlug: string;
        endsAt: string | null;
        retentionDays: number;
        eligibleRegistrations: number;
        eligibleUsers: number;
      }>;
      totalEvents: number;
      totalRegistrations: number;
      totalUsers: number;
    };
  };
  outbox: {
    processed: number;
    failed: number;
    dueNow: number;
    dueByStatus: Record<string, number>;
    nextSendAfter: string | null;
  };
  consultationBatch: { applicationsNotified: number };
  ecReviewBatch: { transitioned: number };
}

export type AdminReminderPreviewRow = {
  category:
    | "attendee_invite"
    | "speaker_invite"
    | "co_speaker_invite"
    | "presentation_upload_request"
    | "registration_confirmation";
  templateKey: string;
  eventName: string;
  eventSlug: string;
  recipientEmail: string;
  recipientName: string | null;
  proposalTitle: string | null;
  reminderNumber: number;
  dueAt: string | null;
  subject: string;
};

export type AdminDueWorkTab = "all" | "outbox" | "reminders" | "cleanup";

export interface AdminDueWorkRow {
  bucket: Exclude<AdminDueWorkTab, "all">;
  typeLabel: string;
  title: string;
  subtitle: string | null;
  context: string;
  detail: string | null;
  dueAt: string | null;
  statusKey: string;
  statusLabel: string;
}

// ── Users ─────────────────────────────────────────────────────────────────────

export interface AdminUserMembership {
  memberId: string;
  membershipCategory: string;
  status: string;
  organizationId: string | null;
  organizationName: string | null;
}

export interface AdminUser {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  organization_name: string | null;
  role: string;
  active: number;
  created_at: string;
  links: Array<string | { label?: string | null; url?: string | null }>;
  membership: AdminUserMembership | null;
}

// ── Email templates ───────────────────────────────────────────────────────────

export interface EmailTemplateVersion {
  id: string;
  template_key: string;
  version: number;
  subject_template: string | null;
  body: string | null;
  content_type: string;
  message_type: "transactional" | "promotional";
  r2_object_key: string | null;
  checksum_sha256: string;
  status: "draft" | "active";
  created_by_user_id: string | null;
  created_at: string;
}

// ── Reports / Stats ───────────────────────────────────────────────────────────

export interface DonationPeriod {
  count: number;
  completed: number;
  pending: number;
  failed: number;
  expired: number;
  gross: number;
  gross_usd: number;
  net_usd: number;
}

export interface StatsResponse {
  registrations: {
    byStatus: Record<string, number>;
    byAttendanceType: Record<string, number>;
    total: number;
    weekly: Array<{ week: string; count: number }>;
    monthly: Array<{ month: string; count: number }>;
  };
  invites: { byStatus: Record<string, number>; total: number };
  email: { outboxByStatus: Record<string, number>; totalQueued: number; totalFailed: number };
  topEvents: Array<{ slug: string; name: string; confirmed: number; total: number }>;
  recentActivity: Array<{ date: string; registrations: number; invites: number }>;
  donations: {
    byStatus: Record<string, number>;
    byCurrency: Array<{
      status: string;
      currency: string;
      count: number;
      total_gross: number;
      avg_gross: number;
      total_net: number | null;
      total_gross_usd: number | null;
    }>;
    totals: { gross_usd: number; net_usd: number };
    daily: Array<{ date: string } & DonationPeriod>;
    weekly: Array<{ week: string } & DonationPeriod>;
    monthly: Array<{ month: string } & DonationPeriod>;
  };
}

// ── Event stats ───────────────────────────────────────────────────────────────

export interface EventStatsResponse {
  event: { id: string; slug: string; name: string };
  registrations: {
    byStatus: Record<string, number>;
    byAttendanceType: Record<string, number>;
    attendanceStatusByType: Record<string, { accepted: number; waitlisted: number }>;
    byStatusAndType: Array<{ status: string; attendance_type: string; count: number }>;
    sponsorConsent: { granted: number; notGranted: number };
    total: number;
    growthByDay: Array<{ date: string; attendance_type: string; count: number }>;
  };
  waitlistByEventDay: Array<{
    day_date: string;
    label: string | null;
    sort_order: number;
    status: string;
    priority_lane: string;
    count: number;
  }>;
  waitlistTotals: {
    total: number;
    byStatus: Record<string, number>;
    byPriorityLane: Record<string, number>;
  };
  attendanceChanges: {
    /** @deprecated Use dayChanges. */
    totalChanges: number;
    /** @deprecated Use changedAttendees. */
    changedRegistrations: number;
    dayChanges: number;
    changedAttendees: number;
    leftInPersonAttendees: number;
    leftInPersonDayChanges: number;
    joinedInPersonAttendees: number;
    joinedInPersonDayChanges: number;
    byTransition: Array<{
      from_type: string;
      to_type: string;
      attendees: number;
      day_changes: number;
    }>;
    byDay: Array<{
      day_date: string;
      label: string | null;
      sort_order: number;
      changed_attendees: number;
      day_changes: number;
      left_in_person_attendees: number;
      joined_in_person_attendees: number;
    }>;
    recent: Array<{
      registration_id: string;
      changed_at: string;
      from_type: string;
      to_type: string;
      user_email: string | null;
      display_name: string | null;
      days: Array<{ day_date: string; label: string | null }>;
    }>;
  };
  registrationsByEventDay: Array<{
    day_date: string;
    label: string | null;
    sort_order: number;
    attendance_type: string;
    attendance_status: "accepted" | "waitlisted" | "pending";
    count: number;
  }>;
  invites: {
    attendee: {
      byStatus: Record<string, number>;
      total: number;
      declineReasons: Array<{ reason_code: string | null; count: number; unsubscribed: number }>;
    };
    speaker: {
      byStatus: Record<string, number>;
      total: number;
      declineReasons: Array<{ reason_code: string | null; count: number; unsubscribed: number }>;
    };
  };
  proposals: { byStatus: Record<string, number>; total: number };
  rsvp: {
    total: number;
    byStatus: Record<string, number>;
    byProvider: Record<string, number>;
    actionsTaken: Record<string, number>;
  };
}

// Admin Organizations — GET /api/v1/admin/organizations[/:id]
export interface AdminOrganizationSummary {
  id: string;
  name: string;
  website: string | null;
  description: string | null;
  slogan: string | null;
  logoUrl: string | null;
  memberCount: number;
  primaryContactName: string | null;
  primaryContactEmail: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminOrganizationRepresentative {
  memberId: string;
  userId: string;
  name: string;
  email: string;
  jobTitle: string | null;
  status: string;
  showOnOrgProfile: boolean;
  isPrimaryContact: boolean;
  isSecondaryContact: boolean;
  createdAt: string;
}

export interface AdminOrganizationDetail extends AdminOrganizationSummary {
  membershipCategory: string | null;
  contentMarkdown: string | null;
  blogUrl: string | null;
  blogFeedUrl: string | null;
  pressUrl: string | null;
  pressFeedUrl: string | null;
  careersUrl: string | null;
  socialX: string | null;
  socialLinkedin: string | null;
  socialFacebook: string | null;
  socialInstagram: string | null;
  socialYoutube: string | null;
  primaryContactUserId: string | null;
  secondaryContactUserId: string | null;
  representatives: AdminOrganizationRepresentative[];
}

// PRD §4.11 (Phase 4C) — organization content moderation queue
export interface OrganizationContentReviewSummary {
  id: string;
  organizationId: string;
  submittedByUserId: string;
  proposedChanges: Record<string, unknown>;
  hasLogoChange: boolean;
  status: string;
  reviewerUserId: string | null;
  reviewerNote: string | null;
  submittedAt: string;
  reviewedAt: string | null;
  organizationName: string;
  submitterName: string;
  submitterEmail: string;
}

export interface OrganizationContentReviewDiffEntry {
  field: string;
  current: unknown;
  proposed: unknown;
}

export interface OrganizationContentReviewDetail extends OrganizationContentReviewSummary {
  diff: OrganizationContentReviewDiffEntry[];
  logoStagingR2Key: string | null;
  currentLogoR2Key: string | null;
}

// PRD §4.14 (Phase 4C) — managed mailing list configuration
export interface MailingList {
  id: string;
  email: string;
  label: string;
  listType: "all_members" | "consultation" | "ec" | "working_group" | "custom";
  workingGroupId: string | null;
  autoSyncCategories: string[] | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

// PRD §4.13 (Phase 4E) — sponsorship sales pipeline
export const SPONSORSHIP_PIPELINE_STAGES = [
  "new_inquiry",
  "contacted",
  "proposal_sent",
  "negotiating",
  "payment_pending",
  "active",
  "lapsed",
] as const;
export type SponsorshipPipelineStage = (typeof SPONSORSHIP_PIPELINE_STAGES)[number];

export interface Sponsorship {
  id: string;
  sponsorType: "consortium" | "event";
  organizationId: string | null;
  organizationName: string | null;
  nonMemberName: string | null;
  nonMemberWebsite: string | null;
  contactName: string | null;
  contactEmail: string | null;
  eventId: string | null;
  eventName: string | null;
  tier: string | null;
  pipelineStage: SponsorshipPipelineStage;
  startDate: string | null;
  renewalDate: string | null;
  assignedToUserId: string | null;
  assignedToName: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SponsorshipEvent {
  id: string;
  fromStage: string | null;
  toStage: string;
  actorUserId: string | null;
  actorName: string | null;
  note: string | null;
  createdAt: string;
}

// PRD §6 Interim Admin Tool — GET/POST /api/v1/admin/members
export interface AdminMemberSummary {
  id: string;
  userId: string;
  organizationId: string | null;
  organizationName: string | null;
  name: string;
  email: string;
  membershipCategory: string;
  status: string;
  showOnOrgProfile: boolean;
  createdAt: string;
}

// PRD §4.2 — GET /api/v1/admin/applications
export interface AdminApplicationSummary {
  id: string;
  applicantEmail: string;
  applicantName: string;
  organizationName: string | null;
  membershipCategory: string;
  status: string;
  stage: string;
  onHoldSubtype: string | null;
  assignedToUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminApplicationEvent {
  fromStage: string | null;
  toStage: string;
  actorUserId: string | null;
  note: string | null;
  createdAt: string;
}

export interface AdminApplicationCommunication {
  id: string;
  application_id: string;
  kind: "communication" | "note";
  actor_user_id: string;
  subject: string | null;
  body: string;
  template_key: string | null;
  email_outbox_id: string | null;
  created_at: string;
}

export interface AdminApplicationConcern {
  id: string;
  application_id: string;
  submitted_by_user_id: string;
  concern_text: string;
  created_at: string;
}

export interface AdminApplicationEcDecision {
  id: string;
  application_id: string;
  ec_member_user_id: string;
  decision: "approve" | "decline";
  reason: string | null;
  created_at: string;
}

export interface AdminApplicationDocument {
  id: string;
  filename: string;
  mimeType: string;
  fileSizeBytes: number;
  uploadedAt: string;
  uploadedByEmail: string;
}

export interface AdminApplicationDetail extends AdminApplicationSummary {
  stageEnteredAt: string;
  answers: Record<string, unknown>;
  events: AdminApplicationEvent[];
  communications: AdminApplicationCommunication[];
  concerns: AdminApplicationConcern[];
  ecDecisions: AdminApplicationEcDecision[];
  documents: AdminApplicationDocument[];
}

// PRD §4.3 — GET/PATCH /api/v1/admin/membership-settings
export interface AdminMembershipSettings {
  consultationWindowDays: number;
  ecReviewWindowDays: number;
  onHoldResponseDeadlineDays: number;
  consultationEmailRecipients: string;
  ecEmailRecipients: string;
  ccApplicantEmails: string;
  autoReminderOnHolds: boolean;
  forumVoteMinEndorsers: number;
  updatedAt: string;
}

// PRD §4.8 (Phase 4B) — voting system
export interface VoteCandidateSummary {
  id: string;
  userId: string | null;
  candidateName: string;
  candidateBio: string | null;
  sortOrder: number;
  eliminatedRound: number | null;
}

export interface AdminVoteSummary {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  voteType: "election" | "motion" | "consultation";
  scopeType: "forum" | "working_group";
  scopeId: string | null;
  thresholdType: "simple_majority" | "supermajority" | "successive_elimination";
  eligibleCategories: string[] | null;
  opensAt: string;
  closesAt: string;
  currentRound: number;
  status: string;
  visibility: "private" | "public";
  publicDetailLevel: "outcome_only" | "aggregate" | "full_breakdown";
  createdAt: string;
  updatedAt: string;
  candidates: VoteCandidateSummary[] | null;
}

export interface AdminVoteBallot {
  id: string;
  userId: string;
  organizationId: string | null;
  choice: string;
  round: number;
  submittedAt: string;
}

export interface AdminVoteProposalSummary {
  id: string;
  title: string;
  description: string;
  voteType: "election" | "motion" | "consultation";
  scopeType: "forum" | "working_group";
  scopeId: string | null;
  proposedByUserId: string;
  status: string;
  voteId: string | null;
  rejectionReason: string | null;
  endorsementCount: number;
  minEndorsersRequired: number;
  createdAt: string;
}

// ── Meeting Calendar (PRD §4.12, UI-5) ──────────────────────────────────────

export interface AdminIcsFile {
  id: string;
  label: string;
  year: number;
  r2Key: string;
  active: boolean;
  uploadedByUserId: string | null;
  createdAt: string;
}

export interface AdminMeetingSeries {
  id: string;
  name: string;
  scopeType: "consortium" | "working_group";
  workingGroupId: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  icsFiles: AdminIcsFile[];
}

export interface MeetingResendResult {
  success: boolean;
  seriesName: string;
  queuedRecipients: number;
}
