import { getFeaturedLink, parseLinksJson, serializeLinks } from "../../../../assets/shared/schemas/links";
import type { DatabaseLike, StatementLike } from "../../types";
import { prepareIndividualJobTitleStatement } from "./individual-job-title";
import { JOB_TITLE_REQUIRED, organizationJobTitleMissing } from "../../../../assets/shared/schemas/identity-job-title";
import { AppError } from "../../errors";
import { publicGroupProfileIdentityPredicate } from "../groups/profile-publication";
import { PUBLIC_PERSON_PROFILE_HOLDER_SOURCE_SQL } from "../people/profile-publication-sql";
import { prepareSitePublicationRequest } from "../site-publication-requests";

export interface IdentityProfileInput {
  emailId?: string | null;
  jobTitle?: string | null;
  biography?: string | null;
  links?: string[];
  showOnOrganizationProfile?: boolean;
}

/** The identity's editable profile as stored, read before an edit so its audit row can name from and to. */
export interface IdentityProfileSnapshot {
  email_id: string | null;
  job_title: string | null;
  biography: string | null;
  links_json: string | null;
  show_on_organization_profile: number;
}

type ProfileChange = { from: unknown; to: unknown };

/**
 * The from/to delta an identity edit records. Every record that names the
 * identity shows the edited values, so the audit trail keeps what it showed
 * before. Unchanged fields are left out.
 */
export function identityProfileChanges(
  current: IdentityProfileSnapshot,
  input: IdentityProfileInput,
): Record<string, ProfileChange> {
  const changes: Record<string, ProfileChange> = {};
  const record = (field: string, from: unknown, to: unknown) => {
    if (JSON.stringify(from) !== JSON.stringify(to)) changes[field] = { from, to };
  };
  if (input.emailId !== undefined) record("emailId", current.email_id, input.emailId);
  if (input.jobTitle !== undefined) record("jobTitle", current.job_title, input.jobTitle);
  if (input.biography !== undefined) record("biography", current.biography, input.biography);
  if (input.links !== undefined) record("links", parseLinksJson(current.links_json), input.links);
  if (input.showOnOrganizationProfile !== undefined)
    record("showOnOrganizationProfile", current.show_on_organization_profile === 1, input.showOnOrganizationProfile);
  return changes;
}

/**
 * Every identity profile edit is written here, so the job-title rule holds for
 * all of them: an organization identity is refused an edit that would leave it
 * without a title, on the request field `jobTitleField` names. An edit that
 * changes none of the profile fields, such as the person's names alone, is not held to it. The guarded
 * `updated_at` pins the title read here.
 */
export function prepareIdentityProfileUpdateStatement(
  db: DatabaseLike,
  identity: { id: string; updated_at: string; organization_id: string | null; job_title: string | null },
  input: IdentityProfileInput,
  at: string,
  jobTitleField = "jobTitle",
) {
  // A names-only edit leaves the profile alone, so it is not held to the title rule.
  const editsProfile = Object.values(input).some((value) => value !== undefined);
  if (
    editsProfile &&
    organizationJobTitleMissing(
      { organization: identity.organization_id !== null, jobTitle: identity.job_title },
      input.jobTitle,
    )
  )
    throw new AppError(400, "VALIDATION_ERROR", JOB_TITLE_REQUIRED, {
      formErrors: [],
      fieldErrors: { [jobTitleField]: [JOB_TITLE_REQUIRED] },
    });
  return db
    .prepare(
      `UPDATE identities
            SET email_id = CASE WHEN ? = 1 THEN ? ELSE email_id END,
                job_title = CASE WHEN ? = 1 THEN ? ELSE job_title END,
                biography = CASE WHEN ? = 1 THEN ? ELSE biography END,
                links_json = CASE WHEN ? = 1 THEN ? ELSE links_json END,
                show_on_organization_profile = CASE WHEN ? = 1 THEN ? ELSE show_on_organization_profile END,
                updated_at = ?
          WHERE id = ? AND ended_at IS NULL AND blocked_at IS NULL AND updated_at = ?`,
    )
    .bind(
      input.emailId !== undefined ? 1 : 0,
      input.emailId ?? null,
      input.jobTitle !== undefined ? 1 : 0,
      input.jobTitle ?? null,
      input.biography !== undefined ? 1 : 0,
      input.biography ?? null,
      input.links !== undefined ? 1 : 0,
      input.links === undefined ? null : serializeLinks(input.links),
      input.showOnOrganizationProfile !== undefined ? 1 : 0,
      input.showOnOrganizationProfile ? 1 : 0,
      at,
      identity.id,
      identity.updated_at,
    );
}

/** An identity as an edit of its profile reads it, with the holder's individual title beside it. */
export interface EditableIdentityProfile extends IdentityProfileSnapshot {
  id: string;
  user_id: string;
  organization_id: string | null;
  updated_at: string;
  individual_job_title: string | null;
}

/**
 * The writes one edit of an identity's profile makes, whoever makes it — the
 * owner or staff — and the from/to delta its audit row records. An
 * organization identity carries its own job title; an individual identity's
 * title is its holder's individual title, so it is written there. The audit
 * row a caller writes checks the change `update` made, so it follows
 * `update` directly and `individualJobTitle` comes after both.
 */
export function prepareIdentityProfileEdit(
  db: DatabaseLike,
  current: EditableIdentityProfile,
  input: Omit<IdentityProfileInput, "jobTitle"> & { jobTitle?: string },
  at: string,
): {
  update: StatementLike;
  individualJobTitle: StatementLike | null;
  publication: StatementLike | null;
  changes: Record<string, ProfileChange>;
} {
  const organization = current.organization_id !== null;
  const jobTitle = input.jobTitle === undefined ? undefined : input.jobTitle || null;
  const identityInput: IdentityProfileInput = { ...input, jobTitle: organization ? jobTitle : undefined };
  const changes = identityProfileChanges(current, identityInput);
  const individual = !organization && jobTitle !== undefined;
  if (individual && jobTitle !== current.individual_job_title)
    changes.jobTitle = { from: current.individual_job_title, to: jobTitle };
  return {
    update: prepareIdentityProfileUpdateStatement(db, current, identityInput, at),
    individualJobTitle: individual ? prepareIndividualJobTitleStatement(db, current.user_id, jobTitle, at) : null,
    publication: prepareIdentityProfilePublication(db, current, input, changes, at),
    changes,
  };
}

/** The canonical changed Member/person/group profile predicate, evaluated before its guarded edit. */
export function identityProfilePublicationCondition(
  current: Pick<EditableIdentityProfile, "id" | "organization_id" | "updated_at">,
  input: IdentityProfileInput,
  changes: Record<string, ProfileChange>,
) {
  // Individual member pages show the membership category as the title.
  const fields =
    current.organization_id === null
      ? ["biography", "links"]
      : ["jobTitle", "biography", "links", "showOnOrganizationProfile"];
  const memberChanged = fields.some((field) => field in changes);
  const personChanged = ["biography", "links", ...(current.organization_id === null ? [] : ["jobTitle"])].some(
    (field) => field in changes,
  );
  // Individual titles belong to the user and also appear on their other personal identities, including past ones.
  const individualTitleChanged = current.organization_id === null && "jobTitle" in changes;
  const linkChange = changes.links;
  const featuredLink = (value: unknown) =>
    getFeaturedLink(
      Array.isArray(value) ? value.filter((link: unknown): link is string => typeof link === "string") : [],
    );
  // Group cards show the featured link; Member/person pages may show the entire list.
  const groupLinkChanged = Boolean(linkChange && featuredLink(linkChange.from) !== featuredLink(linkChange.to));
  const groupChanged = groupLinkChanged || (current.organization_id !== null && "jobTitle" in changes);
  if (!memberChanged && !personChanged && !individualTitleChanged && !groupChanged) return null;
  return {
    sql: `(?=1 AND EXISTS(SELECT 1 FROM identities identity
      JOIN members member ON (member.identity_id=identity.id AND member.organization_id IS NULL)
        OR (member.organization_id=identity.organization_id AND
          (identity.show_on_organization_profile=1 OR ?=1))
      JOIN member_category_assignments assignment ON assignment.member_id=member.id
      JOIN membership_categories category ON category.code=assignment.category_code
      WHERE identity.id=? AND identity.updated_at=? AND member.status='active'
        AND identity.started_at IS NOT NULL AND identity.ended_at IS NULL AND identity.blocked_at IS NULL))
      OR EXISTS(SELECT 1 ${PUBLIC_PERSON_PROFILE_HOLDER_SOURCE_SQL}
        AND EXISTS(SELECT 1 FROM identities edited WHERE edited.user_id=person.id AND edited.id=? AND edited.updated_at=?
          AND ((?=1 AND edited.started_at IS NOT NULL AND edited.blocked_at IS NULL AND edited.hidden_from_public_profile=0)
            OR (?=1 AND EXISTS(SELECT 1 FROM identities shown WHERE shown.user_id=person.id
              AND shown.organization_id IS NULL AND shown.started_at IS NOT NULL
              AND shown.blocked_at IS NULL AND shown.hidden_from_public_profile=0)))))
      OR (?=1 AND EXISTS(SELECT 1 FROM identities edited WHERE edited.id=? AND edited.updated_at=?
        AND ${publicGroupProfileIdentityPredicate("edited")}))`,
    bindings: [
      memberChanged ? 1 : 0,
      input.showOnOrganizationProfile === true ? 1 : 0,
      current.id,
      current.updated_at,
      current.id,
      current.updated_at,
      personChanged ? 1 : 0,
      individualTitleChanged ? 1 : 0,
      groupChanged ? 1 : 0,
      current.id,
      current.updated_at,
    ],
  };
}

/** Capture changed Member/person/group projections before the update, in the same guarded batch as the edit. */
export function prepareIdentityProfilePublication(
  db: DatabaseLike,
  current: Pick<EditableIdentityProfile, "id" | "organization_id" | "updated_at">,
  input: IdentityProfileInput,
  changes: Record<string, ProfileChange>,
  at: string,
): StatementLike | null {
  const condition = identityProfilePublicationCondition(current, input, changes);
  if (!condition) return null;
  return prepareSitePublicationRequest(
    db,
    {
      resourceType: "identity_profile",
      resourceId: current.id,
      revision: Date.parse(at),
      reasonCode: "identity_profile_changed",
      deduplicationKey: `identity-profile:${current.id}:${crypto.randomUUID()}`,
    },
    condition,
  );
}
