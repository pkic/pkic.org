/** Bounded observations used by the canonical affiliation planner; never an independent policy. */
import { z } from "zod";

const observedDomainClaimSchema = z.object({
  id: z.string(),
  domain: z.string(),
  organizationId: z.string(),
});

export const verifiedAffiliationBasisSchema = z.object({
  domain: z.string(),
  claim: observedDomainClaimSchema.nullable(),
  claims: z.array(observedDomainClaimSchema).max(128),
  facts: z.object({
    claimed: z.array(z.object({ organizationId: z.string() })).max(128),
    derived: z
      .array(
        z.object({
          organizationId: z.string(),
          active: z.boolean(),
          disputed: z.boolean(),
          unknownProvenance: z.boolean(),
        }),
      )
      .max(256),
    /** Claims on a parent domain or a subdomain of the address, open to an explicit choice. */
    related: z.array(observedDomainClaimSchema).max(256),
  }),
  organizations: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        normalized_name: z.string(),
        member_id: z.string().nullable(),
        merged_into_organization_id: z.string().nullable(),
      }),
    )
    .max(256),
  identities: z
    .array(
      z.object({
        id: z.string(),
        organization_id: z.string().nullable(),
        email_id: z.string().nullable(),
        updated_at: z.string(),
        invited_at: z.string(),
        started_at: z.string().nullable(),
        ended_at: z.string().nullable(),
        blocked_at: z.string().nullable(),
        job_title: z.string().nullable(),
      }),
    )
    .max(500),
  emailOwner: z.object({ identity_id: z.string().nullable() }).nullable(),
  takenSlugs: z.array(z.string()).max(1000),
});
export type VerifiedAffiliationBasis = z.infer<typeof verifiedAffiliationBasisSchema>;

export function affiliationIdentityObservations(basis: VerifiedAffiliationBasis, organizationId: string) {
  const held = basis.identities.filter((identity) => identity.organization_id === organizationId);
  const unresolved =
    held
      .filter((identity) => identity.ended_at === null)
      .sort((a, b) => b.invited_at.localeCompare(a.invited_at) || b.id.localeCompare(a.id))[0] ?? null;
  const latest =
    [...held].sort(
      (a, b) => (b.ended_at ?? b.invited_at).localeCompare(a.ended_at ?? a.invited_at) || b.id.localeCompare(a.id),
    )[0] ?? null;
  return { unresolved, latest, emailOwner: basis.emailOwner };
}
