import type { RegistrationConfirmOrganization } from "../../../../assets/shared/schemas/registration";
/** A short-lived, signed observation feeds the same affiliation planner used by the portal. */
import { z } from "zod";
import { identityAffiliationPrepareSchema } from "../../../../assets/shared/schemas/identity-affiliation";
import { verifiedAffiliationBasisSchema } from "../identities/verified-affiliation-basis";
import { signJwt, verifyJwt } from "../../utils/jwt";
import { AppError } from "../../errors";
export const registrationAffiliationContextSchema = z.object({
  typ: z.literal("registration-affiliation"),
  eventId: z.string(),
  exp: z.number(),
  input: identityAffiliationPrepareSchema,
  basis: verifiedAffiliationBasisSchema,
});
export type RegistrationAffiliationContext = z.infer<typeof registrationAffiliationContextSchema>;
export function signRegistrationAffiliationContext(
  secret: string,
  context: Omit<RegistrationAffiliationContext, "typ" | "exp">,
) {
  return signJwt(
    secret,
    registrationAffiliationContextSchema.parse({
      ...context,
      typ: "registration-affiliation",
      exp: Math.floor(Date.now() / 1000) + 600,
    }),
  );
}
export async function readRegistrationAffiliationContext(
  secret: string,
  token: string,
  eventId: string,
  email: string,
  selection?: RegistrationConfirmOrganization,
) {
  const verified = await verifyJwt(secret, token);
  const parsed = verified.ok ? registrationAffiliationContextSchema.safeParse(verified.claims) : null;
  if (!parsed?.success || parsed.data.eventId !== eventId || parsed.data.input.email !== email)
    throw new AppError(409, "IDENTITY_CONTEXT_CHANGED", "Confirm your organization details again before registering.");
  if (selection) {
    const chosen = parsed.data.input;
    const name = chosen.organizationId
      ? parsed.data.basis.organizations.find((item) => item.id === chosen.organizationId)?.name
      : chosen.organizationName;
    if (
      selection.name !== name ||
      selection.jobTitle !== chosen.jobTitle ||
      (selection.organizationId !== undefined && selection.organizationId !== chosen.organizationId) ||
      (selection.domain !== undefined && selection.domain !== (chosen.domain ?? parsed.data.basis.domain))
    )
      throw new AppError(
        409,
        "IDENTITY_CONTEXT_CHANGED",
        "Confirm your organization details again before registering.",
      );
  }
  return parsed.data;
}
