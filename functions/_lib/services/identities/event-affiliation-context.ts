import type { RegistrationConfirmOrganization } from "../../../../assets/shared/schemas/registration";
/** A short-lived, signed observation feeds the same affiliation planner used by the portal. */
import { z } from "zod";
import { identityAffiliationPrepareSchema } from "../../../../assets/shared/schemas/identity-affiliation";
import { verifiedAffiliationBasisSchema } from "./verified-affiliation-basis";
import { signJwt, verifyJwt } from "../../utils/jwt";
import { AppError } from "../../errors";
const eventAffiliationContextSchema = z.object({
  typ: z.enum(["registration-affiliation", "proposal-affiliation"]),
  eventId: z.string(),
  exp: z.number(),
  input: identityAffiliationPrepareSchema,
  basis: verifiedAffiliationBasisSchema,
});
export type EventAffiliationContext = z.infer<typeof eventAffiliationContextSchema>;
export function signEventAffiliationContext(
  secret: string,
  context: Omit<EventAffiliationContext, "typ" | "exp">,
  purpose: EventAffiliationContext["typ"],
) {
  return signJwt(
    secret,
    eventAffiliationContextSchema.parse({
      ...context,
      typ: purpose,
      exp: Math.floor(Date.now() / 1000) + 600,
    }),
  );
}
export async function readEventAffiliationContext(
  secret: string,
  token: string,
  eventId: string,
  email: string,
  purpose: EventAffiliationContext["typ"],
  selection?: RegistrationConfirmOrganization,
) {
  const verified = await verifyJwt(secret, token);
  const parsed = verified.ok ? eventAffiliationContextSchema.safeParse(verified.claims) : null;
  if (
    !parsed?.success ||
    parsed.data.typ !== purpose ||
    parsed.data.eventId !== eventId ||
    parsed.data.input.email !== email
  )
    throw new AppError(409, "IDENTITY_CONTEXT_CHANGED", "Confirm your organization details again.");
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
      throw new AppError(409, "IDENTITY_CONTEXT_CHANGED", "Confirm your organization details again before continuing.");
  }
  return parsed.data;
}
