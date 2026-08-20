import { SPONSORSHIP_PIPELINE_STAGES, type SponsorshipPipelineStage } from "../../shared/schemas/admin-sponsorships";
import type { MailingList as CanonicalMailingList } from "../../shared/schemas/admin-mailing-lists";
import type { EmailContentType, EmailMessageType } from "../../shared/schemas/admin-email-templates";
import type { EcDecisionValue } from "../../shared/schemas/ec-review";
import type { LeadershipPosition as CanonicalLeadershipPosition } from "../../shared/schemas/leadership";
import type {
  AdminUserListItem as CanonicalAdminUser,
  AdminUserMembership as CanonicalAdminUserMembership,
} from "../../shared/schemas/admin-users";
import type { AccessGrant as CanonicalAccessGrant, Role as CanonicalRole } from "../../shared/schemas/access-control";
import type { AdminApplicationSummary as CanonicalAdminApplicationSummary } from "../../shared/schemas/admin-applications";
import type {
  AdminEventSummary as CanonicalEventSummary,
  AdminEventTeamListItem as CanonicalEventPermission,
} from "../../shared/schemas/api";
import type { AdminOrganizationRepresentative as CanonicalAdminOrganizationRepresentative } from "../../shared/schemas/admin-organizations";
import type {
  AdminEmailOutboxResponse as CanonicalAdminEmailOutboxResponse,
  AdminEmailOutboxRow as CanonicalAdminEmailOutboxRow,
} from "../../shared/schemas/admin-email-outbox";
import type {
  AdminEventProposalSummary as CanonicalAdminEventProposalSummary,
  ProposalAccess as CanonicalProposalAccess,
} from "../../shared/schemas/admin-event-proposals";
import type { FormFieldDefinition as CanonicalFormFieldDefinition } from "../../shared/schemas/forms";
import type {
  AdminWorkingGroupDetail as CanonicalAdminWorkingGroupDetail,
  AdminWorkingGroupMember as CanonicalAdminWorkingGroupMember,
  AdminWorkingGroupSummary as CanonicalAdminWorkingGroupSummary,
} from "../../shared/schemas/working-groups";

export { SPONSORSHIP_PIPELINE_STAGES };
export type { SponsorshipPipelineStage };

export type EventSummary = CanonicalEventSummary;

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

export type AdminFormDetailField = CanonicalFormFieldDefinition;

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

export type EventPermission = CanonicalEventPermission;

// ── Access control ─────────────────────────────────────────────────

export type Role = CanonicalRole;

export type AccessGrant = CanonicalAccessGrant;

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

/** GET/POST/PATCH /api/v1/admin/leadership-positions — Board / Executive Council roster (migration 0049). */
export type LeadershipPosition = CanonicalLeadershipPosition;

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

export type AdminWorkingGroupSummary = CanonicalAdminWorkingGroupSummary;
export type AdminWorkingGroupMember = CanonicalAdminWorkingGroupMember;
export type AdminWorkingGroupDetail = CanonicalAdminWorkingGroupDetail;

export type ProposalSummary = CanonicalAdminEventProposalSummary;

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

export type ProposalAccess = CanonicalProposalAccess;

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

export type AdminEmailOutboxRow = CanonicalAdminEmailOutboxRow;
export type AdminEmailOutboxResponse = CanonicalAdminEmailOutboxResponse;

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
  wgChairDigest: { workingGroupsWithChanges: number; emailsSent: number };
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

// ── Users ─────────────────────────────────────────────────────────────────────

export type AdminUserMembership = CanonicalAdminUserMembership;
export type AdminUser = CanonicalAdminUser;

// ── Email templates ───────────────────────────────────────────────────────────

export interface EmailTemplateVersion {
  id: string;
  template_key: string;
  version: number;
  subject_template: string | null;
  body: string | null;
  content_type: EmailContentType;
  message_type: EmailMessageType;
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
  membershipCategory: string | null;
  memberSince: string;
  memberCount: number;
  primaryContactName: string | null;
  primaryContactEmail: string | null;
  createdAt: string;
  updatedAt: string;
}

export type AdminOrganizationRepresentative = CanonicalAdminOrganizationRepresentative;

export interface AdminOrganizationDetail extends AdminOrganizationSummary {
  contentMarkdown: string | null;
  blogUrl: string | null;
  blogFeedUrl: string | null;
  pressUrl: string | null;
  pressFeedUrl: string | null;
  careersUrl: string | null;
  links: string[];
  primaryContactUserId: string | null;
  secondaryContactUserId: string | null;
  representatives: AdminOrganizationRepresentative[];
}

// Organization content moderation queue
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

// Managed mailing list configuration
export type MailingList = CanonicalMailingList;

export interface Sponsorship {
  id: string;
  sponsorType: "consortium" | "event";
  organizationId: string | null;
  organizationName: string | null;
  nonMemberName: string | null;
  nonMemberWebsite: string | null;
  nonMemberLogoUrl: string | null;
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

// GET /api/v1/admin/sponsorships/companies — grouped/paginated in D1.
export interface SponsorshipCompany {
  key: string;
  label: string;
  website: string | null;
  sponsorshipCount: number;
  /** Comma-separated distinct pipeline stages across this company's sponsorships. */
  stages: string;
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

// Interim Admin Tool — GET/POST /api/v1/admin/members
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

// GET /api/v1/admin/applications
export type AdminApplicationSummary = CanonicalAdminApplicationSummary;

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
  decision: EcDecisionValue;
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

// GET/PATCH /api/v1/admin/membership-settings
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

// Voting system
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

// ── Meeting Calendar ──────────────────────────────────────

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
