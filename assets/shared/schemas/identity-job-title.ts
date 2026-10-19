/**
 * The one rule for an identity's job title: an organization identity always
 * carries one, a personal identity has none to require. Creating an
 * organization identity requires the title in its contract; editing one
 * requires that the identity has a title afterwards, so a row saved before
 * the rule stays readable and its next edit asks for the title.
 */
import { z } from "zod";
import { JOB_TITLE_REQUIRED } from "./api-common";

export { JOB_TITLE_REQUIRED };

/** Shown on an organization identity that has no job title yet. */
export const JOB_TITLE_NEEDED_LABEL = "Job title needed";

/** The job title an organization identity is created with: required, at most 200 characters. */
export const organizationIdentityJobTitleSchema = z
  .string({ error: JOB_TITLE_REQUIRED })
  .trim()
  .min(1, JOB_TITLE_REQUIRED)
  .max(200);

/** What an edit needs to know about the identity it changes. */
export interface IdentityJobTitleContext {
  /** Whether the identity is an organization's; a personal identity has no title to require. */
  organization: boolean;
  /** The title stored now, which an edit that leaves the title alone keeps. */
  jobTitle: string | null;
}

/** Whether an edit would leave an organization identity without a job title. `edited` undefined keeps the stored one. */
export function organizationJobTitleMissing(
  identity: IdentityJobTitleContext,
  edited: string | null | undefined,
): boolean {
  if (!identity.organization) return false;
  const title = edited === undefined ? identity.jobTitle : edited;
  return !title?.trim();
}

/** An identity organization rows read with their title: true while it needs one. */
export function needsOrganizationJobTitle(identity: {
  organizationId: string | null;
  jobTitle: string | null;
}): boolean {
  return organizationJobTitleMissing(
    { organization: identity.organizationId !== null, jobTitle: identity.jobTitle },
    undefined,
  );
}

/**
 * An identity edit contract held to the rule for one identity. The form and
 * the service parse the same thing: the browser builds it from the identity it
 * shows, the server from the identity it loaded.
 */
export function withOrganizationJobTitle<Schema extends z.ZodType<{ jobTitle?: string | null }>>(
  schema: Schema,
  identity: IdentityJobTitleContext,
) {
  return schema.superRefine((value, context) => {
    if (organizationJobTitleMissing(identity, value.jobTitle))
      context.addIssue({ code: "custom", path: ["jobTitle"], message: JOB_TITLE_REQUIRED });
  });
}
