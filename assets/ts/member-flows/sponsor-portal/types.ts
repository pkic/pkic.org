/**
 * Sponsor portal client-side types — mirror assets/shared/schemas/sponsor-portal.ts.
 * Small duplication of the server's shapes rather than importing the zod
 * schemas directly, matching this codebase's existing precedent (see
 * member-flows/portal/types.ts's own header comment).
 */

export interface SponsorPortalSession {
  sponsorshipId: string;
  eventId: string;
  eventName: string | null;
  tier: string;
  contactEmail: string;
}

export interface SponsorPortalAttendee {
  registrationId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  organizationName: string | null;
  jobTitle: string | null;
  attendanceType: string | null;
}
