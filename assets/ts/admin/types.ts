import type { EmailTemplateVersion as CanonicalEmailTemplateVersion } from "../../shared/schemas/email-templates";
import type {
  UserListItem as CanonicalUser,
  UserMembership as CanonicalUserMembership,
} from "../../shared/schemas/user-management";
import type {
  AccessGrant as CanonicalAccessGrant,
  Role as CanonicalRole,
  RoleAssignment as CanonicalRoleAssignment,
  UserRoleAssignment as CanonicalUserRoleAssignment,
} from "../../shared/schemas/access-control";
import type { AdminEventSummary as CanonicalEventSummary } from "../../shared/schemas/admin-events";
import type { EventDetail as CanonicalEventDetail } from "../../shared/schemas/event-management";
import type {
  EventRegistrationAttendanceChange as CanonicalRegistrationAttendanceChange,
  EventRegistrationSummary as CanonicalRegistration,
} from "../../shared/schemas/event-registrations";
import type { EventInviteSummary as CanonicalInviteRecord } from "../../shared/schemas/event-invites";
import { eventDaysResponseSchema } from "../../shared/schemas/event-configuration";
import type { badgeRoleInfoSchema } from "../../shared/schemas/route-contracts-admin-registrations";
import type { EventProposalSummary as CanonicalAdminEventProposalSummary } from "../../shared/schemas/event-proposals";
import type { ProposalAccess as CanonicalProposalAccess } from "../../shared/schemas/event-proposals";
import type { ProposalSpeaker as CanonicalAdminProposalSpeaker } from "../../shared/schemas/proposal-speakers";
import type { FormFieldDefinition as CanonicalFormFieldDefinition } from "../../shared/schemas/forms";
import type {
  FormSubmission as CanonicalFormSubmission,
  FormSummary as CanonicalFormSummary,
} from "../../shared/schemas/form-management";
import type { MemberCapacitySummary as CanonicalMemberCapacitySummary } from "../../shared/schemas/membership-management";
import type { EventAnalyticsResponse as CanonicalEventStatsResponse } from "../../shared/schemas/event-analytics";
import type { ProposalReview as CanonicalProposalReview } from "../../shared/schemas/proposal-reviews";
import type { z } from "zod";

export type EventSummary = CanonicalEventSummary;
export type EventDetail = CanonicalEventDetail;

export type AdminEventDay = z.infer<typeof eventDaysResponseSchema>["days"][number];
export type AdminAttendanceOption = AdminEventDay["attendanceOptions"][number];

export type AdminEventFormSummary = CanonicalFormSummary;

export type AdminFormDetailField = CanonicalFormFieldDefinition;

export type RegistrationAttendanceChange = CanonicalRegistrationAttendanceChange;
export type Registration = CanonicalRegistration;

export interface AdminRegistrationDay {
  dayDate: string;
  label: string | null;
}

export type BadgeRoleInfo = z.infer<typeof badgeRoleInfoSchema>;

export type AdminFormSubmission = CanonicalFormSubmission;

// ── Access control ─────────────────────────────────────────────────

export type Role = CanonicalRole;

export type AccessGrant = CanonicalAccessGrant;

export type UserRoleAssignment = CanonicalUserRoleAssignment;

/** GET /api/v1/roles/:id/assignments — reverse lookup: who holds this role. */
export type RoleAssignment = CanonicalRoleAssignment;

export type ProposalSummary = CanonicalAdminEventProposalSummary;

export type ProposalReview = CanonicalProposalReview;

export type ProposalSpeaker = CanonicalAdminProposalSpeaker;

export type ProposalAccess = CanonicalProposalAccess;

export type InviteRecord = CanonicalInviteRecord;

// ── Users ─────────────────────────────────────────────────────────────────────

export type AdminUserMembership = CanonicalUserMembership;
export type AdminUser = CanonicalUser;

// ── Email templates ───────────────────────────────────────────────────────────

export type EmailTemplateVersion = CanonicalEmailTemplateVersion;

// ── Event stats ───────────────────────────────────────────────────────────────

export type EventStatsResponse = CanonicalEventStatsResponse;

// Membership-capacity data consumed by the temporary admin interface.
export type AdminMemberSummary = CanonicalMemberCapacitySummary;
