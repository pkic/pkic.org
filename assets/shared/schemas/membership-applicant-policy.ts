import { z } from "zod";
import { normalizedEmailSchema } from "./api-common";
import type { MailboxKind } from "./email-domains";
import type { MembershipCategoryCatalogEntry } from "./membership-categories";
import { DISPOSABLE_EMAIL_REFUSED } from "../email-first-copy";

type ApplicantCategory = Pick<MembershipCategoryCatalogEntry, "isIndividual" | "requiresUniversityEmail">;

export const membershipApplicantDetailsSchema = z.object({
  applicantEmail: normalizedEmailSchema,
  organizationName: z.string().trim().min(1).max(200).optional(),
});
type ApplicantDetails = z.infer<typeof membershipApplicantDetailsSchema>;

/** One catalog-driven policy for the public form and the submission use case. */
export function refineMembershipApplicant(
  input: ApplicantDetails,
  category: ApplicantCategory,
  context: z.RefinementCtx,
) {
  if (!category.isIndividual && !input.organizationName)
    context.addIssue({
      code: "custom",
      path: ["organizationName"],
      message: "Organization name is required for this membership category",
    });
}

/**
 * The applicant address's eligibility, given what kind of mailbox it is. The
 * kind comes from the Worker's vendored lists, so the server applies this
 * part; the browser reads its refusal onto the field.
 */
export function refineMembershipApplicantEmail(
  category: ApplicantCategory,
  kind: MailboxKind,
  context: z.RefinementCtx,
) {
  if (kind === "disposable")
    context.addIssue({ code: "custom", path: ["applicantEmail"], message: DISPOSABLE_EMAIL_REFUSED });
  else if (kind === "free" && (!category.isIndividual || category.requiresUniversityEmail))
    context.addIssue({
      code: "custom",
      path: ["applicantEmail"],
      message: category.requiresUniversityEmail
        ? "This category requires a university email address; personal email providers are not accepted"
        : "Use your employer or organization email address for an organization membership application",
    });
}

/** The whole applicant policy for an address of the given kind. */
export function membershipApplicantPolicySchema(category: ApplicantCategory, kind: MailboxKind) {
  return membershipApplicantDetailsSchema.superRefine((input, context) => {
    refineMembershipApplicant(input, category, context);
    refineMembershipApplicantEmail(category, kind, context);
  });
}
