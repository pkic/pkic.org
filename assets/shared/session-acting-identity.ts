/**
 * Which of a person's identities a user session acts as.
 *
 * A person can hold several active identities at once: their own individual
 * capacity and one or more organization affiliations. The session names the
 * one it acts as, so audit records and organization-scoped screens speak for
 * the right one. The rule is shared by the Worker, which resolves it on every
 * request, and the portal, which asks the person when the Worker cannot.
 */
import { z } from "zod";
import { actingIdentitySchema } from "./schemas/identity";

/** One identity a session may act as: an organization affiliation or the individual capacity. */
export const sessionActingIdentitySchema = actingIdentitySchema.pick({
  id: true,
  organizationId: true,
  organizationName: true,
  jobTitle: true,
});
export type SessionActingIdentity = z.infer<typeof sessionActingIdentitySchema>;

/**
 * The identity a session acts as: the one it selected while that identity is
 * still active, otherwise the person's only active identity. With several
 * active identities and no live selection there is no answer until the person
 * chooses one.
 */
export function resolveSessionActingIdentityId(
  identities: readonly Pick<SessionActingIdentity, "id">[],
  selectedIdentityId: string | null | undefined,
): string | null {
  if (selectedIdentityId && identities.some((identity) => identity.id === selectedIdentityId)) {
    return selectedIdentityId;
  }
  return identities.length === 1 ? identities[0].id : null;
}

/** True when the person must choose an identity before the portal acts for them. */
export function sessionActingIdentityChoiceRequired(session: {
  actingIdentities: readonly unknown[];
  actingIdentityId: string | null;
}): boolean {
  return session.actingIdentityId === null && session.actingIdentities.length > 1;
}
