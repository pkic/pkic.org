import { z } from "zod";
import { INDEPENDENT_CAPACITY_COPY } from "../email-first-copy";
import { successResponseSchema, trimmedString, utcInstantSchema } from "./api-common";
import { databaseIdSchema } from "./identifiers";
import { emailDomainKindSchema } from "./email-domain-kind";

export { emailDomainKindSchema, type EmailDomainKind } from "./email-domain-kind";

/**
 * The disclosure wording a speaker attests to. A change to that wording in
 * `INDEPENDENT_CAPACITY_COPY` issues a new version; stored records keep the
 * version they answered.
 */
export const INDEPENDENT_CAPACITY_DISCLOSURE_VERSION = "independent-capacity-2026-10";

const copy = INDEPENDENT_CAPACITY_COPY;

/**
 * The independent-capacity disclosure: one answer to the organization
 * question and the attestations that make taking part as an individual
 * acceptable. Answering "yes" is refused with the steer to take part on
 * behalf of that organization, so the independent path stops there.
 */
export const independentCapacityDisclosureSchema = z
  .object({
    version: z.literal(INDEPENDENT_CAPACITY_DISCLOSURE_VERSION),
    organizationConnection: z
      .enum(["yes", "no"], { error: copy.questionRequired })
      .refine((answer): boolean => answer === "no", copy.connectedSteer),
    noRelatedEngagement: z.literal(true, { error: copy.noRelatedEngagementRequired }),
    formerAffiliations: trimmedString(1, 2000, copy.formerAffiliationsRequired),
    currentPosition: trimmedString(2, 200, copy.currentPositionRequired),
    acceptsAccountability: z.literal(true, { error: copy.accountabilityRequired }),
    acknowledgesPolicies: z.literal(true, { error: copy.policyRequired }),
  })
  .strict();

/** The disclosure belongs to, and is required for, taking part as an individual. */
export function requireIndependentCapacity(
  value: { independentCapacity?: unknown },
  individual: boolean,
  context: z.core.$RefinementCtx,
): void {
  if (individual && value.independentCapacity === undefined)
    context.addIssue({
      code: "custom",
      path: ["independentCapacity", "organizationConnection"],
      message: copy.questionRequired,
    });
  if (!individual && value.independentCapacity !== undefined)
    context.addIssue({
      code: "custom",
      path: ["independentCapacity"],
      message: "The independence disclosure applies only when taking part as an individual.",
    });
}

export type IndependentCapacityDisclosure = z.infer<typeof independentCapacityDisclosureSchema>;

/** A reviewer's standing on one disclosure; evolvable vocabulary, enforced here rather than in SQL. */
export const independentCapacityReviewStatusSchema = z.enum(["pending", "verified", "representation_requested"]);
export type IndependentCapacityReviewStatus = z.infer<typeof independentCapacityReviewStatusSchema>;

/** What reviewers read about an independent speaker's current disclosure. */
export const independentCapacityReviewSchema = z.object({
  id: databaseIdSchema,
  version: z.string(),
  formerAffiliations: z.string(),
  currentPosition: z.string(),
  emailDomainKind: emailDomainKindSchema,
  attestedAt: utcInstantSchema,
  status: independentCapacityReviewStatusSchema,
  reviewedAt: utcInstantSchema.nullable(),
  reviewedByName: z.string().nullable(),
});
export type IndependentCapacityReview = z.infer<typeof independentCapacityReviewSchema>;

/** A reviewer's decision: the affiliation is verified, or the speaker must take part through an organization. */
export const independentCapacityDecisionSchema = z
  .object({ decision: z.enum(["verified", "representation_requested"]) })
  .strict();
export const independentCapacityDecisionResponseSchema = successResponseSchema.extend({
  review: independentCapacityReviewSchema,
});

/** The agenda refuses an unacknowledged individual appearance of an unverified independent speaker. */
export const UNVERIFIED_INDEPENDENT_APPEARANCE_CODE = "INDEPENDENT_CAPACITY_UNVERIFIED";
/** Who that refusal names, so the editor can acknowledge exactly those speakers. */
export const unverifiedIndependentAppearanceDetailsSchema = z.object({
  speakers: z
    .array(z.object({ userId: databaseIdSchema, displayName: z.string() }))
    .min(1)
    .max(30),
});
/** The speakers an editor approves as individuals although their independence is not yet verified. */
export const acknowledgedUnverifiedIndependentSchema = z.array(databaseIdSchema).max(30).default([]);
