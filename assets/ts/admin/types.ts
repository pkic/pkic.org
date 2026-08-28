import { SPONSORSHIP_PIPELINE_STAGES, type SponsorshipPipelineStage } from "../../shared/schemas/admin-sponsorships";
import type {
  AdminSponsorship as CanonicalSponsorship,
  SponsorshipCompany as CanonicalSponsorshipCompany,
  SponsorshipEvent as CanonicalSponsorshipEvent,
} from "../../shared/schemas/admin-sponsorships";
import type { EmailTemplateVersion as CanonicalEmailTemplateVersion } from "../../shared/schemas/email-templates";
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
  AdminEventSummary as CanonicalEventSummary,
  AdminEventTeamListItem as CanonicalEventPermission,
  AdminEventDetail as CanonicalAdminEventDetail,
} from "../../shared/schemas/admin-events";
import type {
  EventRegistrationAttendanceChange as CanonicalRegistrationAttendanceChange,
  EventRegistrationSummary as CanonicalRegistration,
} from "../../shared/schemas/event-registrations";
import type { EventInviteSummary as CanonicalInviteRecord } from "../../shared/schemas/event-invites";
import { eventDaysResponseSchema } from "../../shared/schemas/event-configuration";
import type { badgeRoleInfoSchema } from "../../shared/schemas/route-contracts-admin-registrations";
import type {
  AdminOrganizationDetail as CanonicalAdminOrganizationDetail,
  AdminOrganizationRepresentative as CanonicalAdminOrganizationRepresentative,
  AdminOrganizationSummary as CanonicalAdminOrganizationSummary,
} from "../../shared/schemas/admin-organizations";
import type {
  AdminEmailOutboxResponse as CanonicalAdminEmailOutboxResponse,
  AdminEmailOutboxRow as CanonicalAdminEmailOutboxRow,
} from "../../shared/schemas/admin-email-outbox";
import type { EventProposalSummary as CanonicalAdminEventProposalSummary } from "../../shared/schemas/event-proposals";
import type { ProposalAccess as CanonicalProposalAccess } from "../../shared/schemas/event-proposals";
import type { ProposalSpeaker as CanonicalAdminProposalSpeaker } from "../../shared/schemas/proposal-speakers";
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

/** GET /api/v1/system/access-control/roles/:id/assignments — reverse lookup: who holds this role. */
export type RoleAssignment = CanonicalRoleAssignment;

export type ProposalSummary = CanonicalAdminEventProposalSummary;

export type ProposalReview = CanonicalProposalReview;

export type ProposalSpeaker = CanonicalAdminProposalSpeaker;

export type ProposalAccess = CanonicalProposalAccess;

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

export type Sponsorship = CanonicalSponsorship;

// GET /api/v1/admin/sponsorships/companies — grouped/paginated in D1.
export type SponsorshipCompany = CanonicalSponsorshipCompany;

export type SponsorshipEvent = CanonicalSponsorshipEvent;

// Interim Admin Tool — GET/POST /api/v1/admin/members
export type AdminMemberSummary = CanonicalAdminMemberSummary;

// Voting system
export type VoteCandidateSummary = CanonicalVoteCandidateSummary;

export type AdminVoteSummary = CanonicalAdminVoteSummary;

export type AdminVoteBallot = CanonicalAdminVoteBallot;

export type AdminVoteProposalSummary = CanonicalAdminVoteProposalSummary;
