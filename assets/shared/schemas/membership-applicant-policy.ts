import { z } from "zod";
import { normalizedEmailSchema } from "./api-common";
import type { MembershipCategoryCatalogEntry } from "./membership-categories";
import { emailDomainOf, isDisposableEmailDomain, isPersonalEmailAddress } from "../constants/email-domains";

export const membershipApplicantDetailsSchema = z
  .object({
    applicantEmail: normalizedEmailSchema,
    organizationName: z.string().trim().min(1).max(200).optional(),
  })
  .superRefine((input, context) => {
    if (isDisposableEmailDomain(emailDomainOf(input.applicantEmail)))
      context.addIssue({
        code: "custom",
        path: ["applicantEmail"],
        message: "Disposable email providers are not accepted",
      });
  });

/** One catalog-driven policy for the public form and the submission use case. */
export function refineMembershipApplicant(
  input: z.infer<typeof membershipApplicantDetailsSchema>,
  category: Pick<MembershipCategoryCatalogEntry, "isIndividual" | "requiresUniversityEmail">,
  context: z.RefinementCtx,
) {
  if (!category.isIndividual && !input.organizationName)
    context.addIssue({
      code: "custom",
      path: ["organizationName"],
      message: "Organization name is required for this membership category",
    });
  if ((!category.isIndividual || category.requiresUniversityEmail) && isPersonalEmailAddress(input.applicantEmail)) {
    context.addIssue({
      code: "custom",
      path: ["applicantEmail"],
      message: category.requiresUniversityEmail
        ? "This category requires a university email address; personal email providers are not accepted"
        : "Use your employer or organization email address for an organization membership application",
    });
  }
}

export function membershipApplicantPolicySchema(
  category: Pick<MembershipCategoryCatalogEntry, "isIndividual" | "requiresUniversityEmail">,
) {
  return membershipApplicantDetailsSchema.superRefine((input, context) =>
    refineMembershipApplicant(input, category, context),
  );
}
