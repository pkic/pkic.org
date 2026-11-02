/**
 * A signed-in person applies for membership as one of the identities they
 * hold. Nothing about who they are is typed: the name, address, organization,
 * title, bio and first link come from the user and that identity, and are
 * copied into the application's answers at submission as the historic record
 * of what was applied with. Later profile edits never change that record.
 */
import { first } from "../../../db/queries";
import { AppError } from "../../../errors";
import { parseLinksJson } from "../../../../../assets/shared/schemas/links";
import {
  APPLICANT_BIO_REQUIRED_MESSAGE,
  APPLICANT_JOB_TITLE_REQUIRED_MESSAGE,
  APPLICANT_NAME_REQUIRED_MESSAGE,
  APPLICANT_PROFILE_INCOMPLETE,
} from "../../../../../assets/shared/membership-application-refusals";
import { identityJobTitleSql } from "../../identities/affiliation-projection";
import type { DatabaseLike } from "../../../types";
import { createMemberApplication, type CreateMemberApplicationResult } from "./create";

interface ApplicantIdentityRow {
  organization_id: string | null;
  organization_name: string | null;
  job_title: string | null;
  biography: string | null;
  links_json: string | null;
  first_name: string | null;
  last_name: string | null;
  normalized_email: string;
}

function incomplete(message: string): never {
  throw new AppError(422, APPLICANT_PROFILE_INCOMPLETE, message, { formErrors: [message], fieldErrors: {} });
}

export async function createMemberApplicationAsIdentity(
  db: DatabaseLike,
  input: {
    userId: string;
    identityId: string;
    membershipCategory: string;
    answers?: Record<string, unknown>;
    appBaseUrl: string;
  },
): Promise<CreateMemberApplicationResult> {
  // An organization identity applies from the verified address it is linked to, else the account's primary one.
  const identity = await first<ApplicantIdentityRow>(
    db,
    `SELECT identity.organization_id, organization.name AS organization_name,
            ${identityJobTitleSql("identity.id")} AS job_title, identity.biography, identity.links_json,
            u.first_name, u.last_name, COALESCE(address.normalized_email, u.normalized_email) AS normalized_email
       FROM identities identity
       JOIN users u ON u.id = identity.user_id
       LEFT JOIN organizations organization ON organization.id = identity.organization_id
       LEFT JOIN user_emails address
         ON address.id = identity.email_id AND address.user_id = identity.user_id AND address.verified_at IS NOT NULL
      WHERE identity.id = ? AND identity.user_id = ?
        AND identity.started_at IS NOT NULL AND identity.ended_at IS NULL AND identity.blocked_at IS NULL`,
    [input.identityId, input.userId],
  );
  if (!identity) throw new AppError(403, "NOT_ACTIVE_IDENTITY", "You do not actively hold this identity");
  const firstName = identity.first_name?.trim();
  const lastName = identity.last_name?.trim();
  const biography = identity.biography?.trim();
  const jobTitle = identity.job_title?.trim();
  const isOrganization = identity.organization_id !== null;
  if (!firstName || !lastName) incomplete(APPLICANT_NAME_REQUIRED_MESSAGE);
  if (isOrganization && !jobTitle) incomplete(APPLICANT_JOB_TITLE_REQUIRED_MESSAGE);
  if (!biography) incomplete(APPLICANT_BIO_REQUIRED_MESSAGE);
  const [link] = parseLinksJson(identity.links_json);

  return createMemberApplication(db, {
    applicantEmail: identity.normalized_email,
    applicantName: `${firstName} ${lastName}`,
    membershipCategory: input.membershipCategory,
    organizationName: identity.organization_name,
    organizationId: identity.organization_id,
    answers: input.answers,
    identityAnswers: {
      about_yourself: biography,
      ...(jobTitle && isOrganization ? { job_title: jobTitle } : {}),
      ...(link ? { linkedin: link } : {}),
    },
    appBaseUrl: input.appBaseUrl,
    joinCapabilityId: null,
    applicantKind: isOrganization ? "organization" : "individual",
    applicantUserId: input.userId,
    applicantIdentityId: input.identityId,
  });
}
