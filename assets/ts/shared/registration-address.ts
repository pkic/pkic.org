import type { z } from "zod";
import { emailDomainOf, emailDomainResponseSchema, emailDomainUrl } from "../../shared/schemas/email-domains";
import {
  identityAffiliationPreviewSchema,
  identityAffiliationPreviewResponseSchema,
} from "../../shared/schemas/identity-affiliation";
import { getJson, postJson } from "./api-client";

export type AddressAffiliation = z.infer<typeof identityAffiliationPreviewResponseSchema>;

const PREVIEW_ENDPOINT = "/api/v1/users/current/identities/preview";

/** The organizations a verified address of the signed-in person reaches, through the shared affiliation preview. */
export function previewAffiliation(input: z.input<typeof identityAffiliationPreviewSchema>) {
  return postJson(
    PREVIEW_ENDPOINT,
    identityAffiliationPreviewSchema.parse(input),
    identityAffiliationPreviewResponseSchema,
  );
}

/**
 * Whether the signed-in person's address registers for an organization, as
 * the Worker decides it: a work address does, unless the person already said
 * it is personal and no organization claims its domain. `affiliation` is what
 * the address resolves to, for confirming an organization in place.
 */
export async function readRegistrationAddress(
  email: string,
): Promise<{ organizationRequired: boolean; affiliation: AddressAffiliation | null }> {
  const domain = await getJson(emailDomainUrl(emailDomainOf(email)), emailDomainResponseSchema).catch(() => null);
  if (domain?.kind !== "work") return { organizationRequired: false, affiliation: null };
  const affiliation = await previewAffiliation({
    phase: "resolve",
    email,
    emailId: null,
    unaffiliatedAttestation: false,
  }).catch(() => null);
  return { organizationRequired: !affiliation?.personalAddress, affiliation };
}
