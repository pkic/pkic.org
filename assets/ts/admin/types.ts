import { SPONSORSHIP_PIPELINE_STAGES, type SponsorshipPipelineStage } from "../../shared/schemas/admin-sponsorships";
import type {
  AdminSponsorship as CanonicalSponsorship,
  SponsorshipCompany as CanonicalSponsorshipCompany,
  SponsorshipEvent as CanonicalSponsorshipEvent,
} from "../../shared/schemas/admin-sponsorships";
import type { MailingList as CanonicalMailingList } from "../../shared/schemas/mailing-lists";
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
  AdminEventRegistrationSummary as CanonicalRegistration,
  AdminEventSummary as CanonicalEventSummary,
  AdminEventInviteSummary as CanonicalInviteRecord,
  AdminEventRegistrationAttendanceChange as CanonicalRegistrationAttendanceChange,
  AdminEventTeamListItem as CanonicalEventPermission,
  AdminEventDetail as CanonicalAdminEventDetail,
} from "../../shared/schemas/admin-events";
import { eventDaysResponseSchema } from "../../shared/schemas/event-configuration";
import type { badgeRoleInfoSchema } from "../../shared/schemas/route-contracts-admin-registrations";
import type { membershipSettingsSchema } from "../../shared/schemas/membership-settings";
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
  AdminProposalSpeaker as CanonicalAdminProposalSpeaker,
  ProposalAccess as CanonicalProposalAccess,
} from "../../shared/schemas/admin-event-proposals";
import type { FormFieldDefinition as CanonicalFormFieldDefinition } from "../../shared/schemas/forms";
import type {
  AdminFormSubmission as CanonicalAdminFormSubmission,
  AdminFormSummary as CanonicalAdminEventFormSummary,
} from "../../shared/schemas/admin-forms";
import type { AdminMemberSummary as CanonicalAdminMemberSummary } from "../../shared/schemas/admin-members";
import type {
  AdminVoteBallot as CanonicalAdminVoteBallot,
  AdminVoteProposalSummary as CanonicalAdminVoteProposalSummary,
  AdminVoteSummary as CanonicalAdminVoteSummary,
  VoteCandidateSummary as CanonicalVoteCandidateSummary,
} from "../../shared/schemas/votes-admin";
import type {
  AdminEventStatsResponse as CanonicalEventStatsResponse,
  AdminStatsResponse as CanonicalStatsResponse,
  DonationPeriod as CanonicalDonationPeriod,
} from "../../shared/schemas/admin-analytics";
import type {
  AdminJobsRunResponse as CanonicalAdminJobsRunResponse,
  AdminReminderPreviewRow as CanonicalAdminReminderPreviewRow,
} from "../../shared/schemas/admin-jobs";
import type { ProposalReview as CanonicalProposalReview } from "../../shared/schemas/proposal-reviews";
import type { z } from "zod";

export { SPONSORSHIP_PIPELINE_STAGES };
export type { SponsorshipPipelineStage };

export type EventSummary = CanonicalEventSummary;
export type EventDetail = CanonicalAdminEventDetail;

export type AdminEventDay = z.infer<typeof eventDaysResponseSchema>["days"][number];
export type AdminAttendanceOption = AdminEventDay["attendanceOptions"][number];

export type AdminEventFormSummary = CanonicalAdminEventFormSummary;

export type AdminFormDetailField = CanonicalFormFieldDefinition;

export type RegistrationAttendanceChange = CanonicalRegistrationAttendanceChange;
export type Registration = CanonicalRegistration;

export interface AdminRegistrationDay {
  dayDate: string;
  label: string | null;
}

export type BadgeRoleInfo = z.infer<typeof badgeRoleInfoSchema>;

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

export type ProposalSummary = CanonicalAdminEventProposalSummary;

export type ProposalReview = CanonicalProposalReview;

export type ProposalSpeaker = CanonicalAdminProposalSpeaker;

export type ProposalAccess = CanonicalProposalAccess;

export interface AdminInviteEntry {
  email: string;
  firstName?: string;
  lastName?: string;
}

export type InviteRecord = CanonicalInviteRecord;

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
export type AdminMembershipSettings = z.infer<typeof membershipSettingsSchema>;

// Voting system
export type VoteCandidateSummary = CanonicalVoteCandidateSummary;

export type AdminVoteSummary = CanonicalAdminVoteSummary;

export type AdminVoteBallot = CanonicalAdminVoteBallot;

export type AdminVoteProposalSummary = CanonicalAdminVoteProposalSummary;
