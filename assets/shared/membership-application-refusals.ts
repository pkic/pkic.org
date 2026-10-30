/**
 * Why a membership application is refused before review, as one vocabulary for
 * the submission use case, approval, and the join form.
 *
 * Each refusal is decided by the server from the applicant's account and
 * identities, never from a typed name or address alone. The join form reads the
 * same codes to explain a refusal it can foresee from the signed-in session.
 */

/** The organization already holds an active membership. */
export const ORGANIZATION_ALREADY_MEMBER = "ORGANIZATION_ALREADY_MEMBER";
/** The applicant already holds an active individual membership. */
export const INDIVIDUAL_ALREADY_MEMBER = "INDIVIDUAL_ALREADY_MEMBER";
/** The applicant represents an organization, so an individual membership would blur IPR attribution. */
export const INDIVIDUAL_WHILE_REPRESENTING = "INDIVIDUAL_WHILE_REPRESENTING";
/** An application for the same person or organization is still open. */
export const APPLICATION_ALREADY_PENDING = "APPLICATION_ALREADY_PENDING";
/** The identity an application is made as lacks a detail the application needs. */
export const APPLICANT_PROFILE_INCOMPLETE = "APPLICANT_PROFILE_INCOMPLETE";

export const membershipApplicationRefusalCodes = [
  ORGANIZATION_ALREADY_MEMBER,
  INDIVIDUAL_ALREADY_MEMBER,
  INDIVIDUAL_WHILE_REPRESENTING,
  APPLICATION_ALREADY_PENDING,
] as const;

export function organizationAlreadyMemberMessage(organizationName: string): string {
  return `${organizationName} is already a member of the PKI Consortium. Ask one of its representatives to invite you, or write to us if you meant a different organization.`;
}

export const INDIVIDUAL_ALREADY_MEMBER_MESSAGE =
  "You already hold an individual membership of the PKI Consortium. Manage it in the member portal.";

export function individualWhileRepresentingMessage(organizationName: string): string {
  return `You represent ${organizationName}. For IPR reasons, you cannot apply as an individual while you represent an organization. End the representation first, or apply for the organization instead.`;
}

export const APPLICATION_ALREADY_PENDING_MESSAGE =
  "You already have a membership application in progress. Follow it in the member portal or from the link in your confirmation email.";

export function organizationApplicationPendingMessage(organizationName: string): string {
  return `A membership application for ${organizationName} is already in progress. Ask the person who applied to follow it, or write to us if you meant a different organization.`;
}

export const ORGANIZATION_DOMAIN_APPLICATION_PENDING_MESSAGE =
  "A membership application for an organization with this email domain is already in progress.";

export const APPLICANT_BIO_REQUIRED_MESSAGE =
  "Add a bio to the representation you apply as, then submit again. Edit it under Representation.";
export const APPLICANT_JOB_TITLE_REQUIRED_MESSAGE =
  "Add a job title to the representation you apply as, then submit again. Edit it under Representation.";
export const APPLICANT_NAME_REQUIRED_MESSAGE =
  "Add your first and last name to your profile, then submit again. Edit it under Representation.";
