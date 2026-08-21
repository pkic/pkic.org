import { SPONSORSHIP_PIPELINE_STAGES, type SponsorshipPipelineStage } from "../../shared/schemas/admin-sponsorships";
import type {
  AdminSponsorship as CanonicalSponsorship,
  SponsorshipCompany as CanonicalSponsorshipCompany,
  SponsorshipEvent as CanonicalSponsorshipEvent,
} from "../../shared/schemas/admin-sponsorships";
import type { MailingList as CanonicalMailingList } from "../../shared/schemas/admin-mailing-lists";
import type { AdminEmailTemplateVersion as CanonicalEmailTemplateVersion } from "../../shared/schemas/admin-email-templates";
import type { LeadershipPosition as CanonicalLeadershipPosition } from "../../shared/schemas/leadership";
import type {
  AdminUserListItem as CanonicalAdminUser,
  AdminUserMembership as CanonicalAdminUserMembership,
} from "../../shared/schemas/admin-users";
import type {
  AccessGrant as CanonicalAccessGrant,
  Role as CanonicalRole,
  RoleAssignment as CanonicalRoleAssignment,
  UserRoleAssignment as CanonicalUserRoleAssignment,
} from "../../shared/schemas/access-control";
import type {
  AdminApplicationCommunication as CanonicalAdminApplicationCommunication,
  AdminApplicationConcern as CanonicalAdminApplicationConcern,
  AdminApplicationDetail as CanonicalAdminApplicationDetail,
  AdminApplicationDocument as CanonicalAdminApplicationDocument,
  AdminApplicationEcDecision as CanonicalAdminApplicationEcDecision,
  AdminApplicationEvent as CanonicalAdminApplicationEvent,
  AdminApplicationSummary as CanonicalAdminApplicationSummary,
} from "../../shared/schemas/admin-applications";
import type {
  AdminEventSummary as CanonicalEventSummary,
  AdminEventTeamListItem as CanonicalEventPermission,
} from "../../shared/schemas/api";
import type {
  AdminOrganizationDetail as CanonicalAdminOrganizationDetail,
  AdminOrganizationRepresentative as CanonicalAdminOrganizationRepresentative,
  AdminOrganizationSummary as CanonicalAdminOrganizationSummary,
  OrganizationContentReviewDetail as CanonicalOrganizationContentReviewDetail,
  OrganizationContentReviewDiffEntry as CanonicalOrganizationContentReviewDiffEntry,
  OrganizationContentReviewSummary as CanonicalOrganizationContentReviewSummary,
} from "../../shared/schemas/admin-organizations";
import type {
  AdminEmailOutboxResponse as CanonicalAdminEmailOutboxResponse,
  AdminEmailOutboxRow as CanonicalAdminEmailOutboxRow,
} from "../../shared/schemas/admin-email-outbox";
import type {
  AdminEventProposalSummary as CanonicalAdminEventProposalSummary,
  ProposalAccess as CanonicalProposalAccess,
} from "../../shared/schemas/admin-event-proposals";
import type { FormFieldDefinition as CanonicalFormFieldDefinition } from "../../shared/schemas/forms";
import type { AdminFormSubmission as CanonicalAdminFormSubmission } from "../../shared/schemas/admin-forms";
import type { AdminMemberSummary as CanonicalAdminMemberSummary } from "../../shared/schemas/admin-members";
import type {
  AdminVoteBallot as CanonicalAdminVoteBallot,
  AdminVoteProposalSummary as CanonicalAdminVoteProposalSummary,
  AdminVoteSummary as CanonicalAdminVoteSummary,
  VoteCandidateSummary as CanonicalVoteCandidateSummary,
} from "../../shared/schemas/votes-admin";
import type {
  AdminIcsFile as CanonicalAdminIcsFile,
  AdminMeetingSeries as CanonicalAdminMeetingSeries,
  MeetingResendResult as CanonicalMeetingResendResult,
} from "../../shared/schemas/meeting-calendar";
import type {
  AdminEventStatsResponse as CanonicalEventStatsResponse,
  AdminStatsResponse as CanonicalStatsResponse,
  DonationPeriod as CanonicalDonationPeriod,
} from "../../shared/schemas/admin-analytics";
import type {
  AdminJobsRunResponse as CanonicalAdminJobsRunResponse,
  AdminReminderPreviewRow as CanonicalAdminReminderPreviewRow,
} from "../../shared/schemas/admin-jobs";
import type {
  AdminWorkingGroupDetail as CanonicalAdminWorkingGroupDetail,
  AdminWorkingGroupMember as CanonicalAdminWorkingGroupMember,
  AdminWorkingGroupSummary as CanonicalAdminWorkingGroupSummary,
} from "../../shared/schemas/working-groups";
import type { ProposalReview as CanonicalProposalReview } from "../../shared/schemas/proposal-reviews";

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

export type AdminFormSubmission = CanonicalAdminFormSubmission;

export type EventPermission = CanonicalEventPermission;

// ── Access control ─────────────────────────────────────────────────

export type Role = CanonicalRole;

export type AccessGrant = CanonicalAccessGrant;

export type UserRoleAssignment = CanonicalUserRoleAssignment;

/** GET /api/v1/admin/roles/:id/assignments — reverse lookup: who holds this role. */
export type RoleAssignment = CanonicalRoleAssignment;

/** GET/POST/PATCH /api/v1/admin/leadership-positions — Board / Executive Council roster (consolidated migration 0035). */
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

export type ProposalReview = CanonicalProposalReview;

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

export type AdminJobsRunResponse = CanonicalAdminJobsRunResponse;
export type AdminReminderPreviewRow = CanonicalAdminReminderPreviewRow;

// ── Users ─────────────────────────────────────────────────────────────────────

export type AdminUserMembership = CanonicalAdminUserMembership;
export type AdminUser = CanonicalAdminUser;

// ── Email templates ───────────────────────────────────────────────────────────

export type EmailTemplateVersion = CanonicalEmailTemplateVersion;

// ── Reports / Stats ───────────────────────────────────────────────────────────

export type DonationPeriod = CanonicalDonationPeriod;
export type StatsResponse = CanonicalStatsResponse;

// ── Event stats ───────────────────────────────────────────────────────────────

export type EventStatsResponse = CanonicalEventStatsResponse;

// Admin Organizations — GET /api/v1/admin/organizations[/:id]
export type AdminOrganizationSummary = CanonicalAdminOrganizationSummary;

export type AdminOrganizationRepresentative = CanonicalAdminOrganizationRepresentative;

export type AdminOrganizationDetail = CanonicalAdminOrganizationDetail;

// Organization content moderation queue
export type OrganizationContentReviewSummary = CanonicalOrganizationContentReviewSummary;

export type OrganizationContentReviewDiffEntry = CanonicalOrganizationContentReviewDiffEntry;

export type OrganizationContentReviewDetail = CanonicalOrganizationContentReviewDetail;

// Managed mailing list configuration
export type MailingList = CanonicalMailingList;

export type Sponsorship = CanonicalSponsorship;

// GET /api/v1/admin/sponsorships/companies — grouped/paginated in D1.
export type SponsorshipCompany = CanonicalSponsorshipCompany;

export type SponsorshipEvent = CanonicalSponsorshipEvent;

// Interim Admin Tool — GET/POST /api/v1/admin/members
export type AdminMemberSummary = CanonicalAdminMemberSummary;

// GET /api/v1/admin/applications
export type AdminApplicationSummary = CanonicalAdminApplicationSummary;

export type AdminApplicationEvent = CanonicalAdminApplicationEvent;
export type AdminApplicationCommunication = CanonicalAdminApplicationCommunication;
export type AdminApplicationConcern = CanonicalAdminApplicationConcern;
export type AdminApplicationEcDecision = CanonicalAdminApplicationEcDecision;
export type AdminApplicationDocument = CanonicalAdminApplicationDocument;
export type AdminApplicationDetail = CanonicalAdminApplicationDetail;

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
export type VoteCandidateSummary = CanonicalVoteCandidateSummary;

export type AdminVoteSummary = CanonicalAdminVoteSummary;

export type AdminVoteBallot = CanonicalAdminVoteBallot;

export type AdminVoteProposalSummary = CanonicalAdminVoteProposalSummary;

// ── Meeting Calendar ──────────────────────────────────────

export type AdminIcsFile = CanonicalAdminIcsFile;

export type AdminMeetingSeries = CanonicalAdminMeetingSeries;

export type MeetingResendResult = CanonicalMeetingResendResult;
