/**
 * Which identity the portal acts as.
 *
 * The session names it (see `assets/shared/session-acting-identity.ts`); this
 * module applies a person's choice to the session and remembers it on this
 * device, so the next sign-in here does not ask again while that identity is
 * still theirs. The remembered choice is a convenience for this viewer only:
 * the server re-verifies every selection against live identities.
 */
import { putValidated } from "../../shared/api-client";
import { myActiveIdentitySwitchSchema } from "../../../shared/schemas/me";
import { userAuthSessionResponseSchema } from "../../../shared/schemas/user-auth";
import { sessionActingIdentityChoiceRequired } from "../../../shared/session-acting-identity";
import type { PortalSession } from "./types";

const ACTIVE_IDENTITY_ENDPOINT = "/api/v1/users/current/identities/active";

function rememberedIdentityKey(userId: string): string {
  return `portal-acting-identity:${userId}`;
}

/** The identity this person last chose on this device, if storage allows reading it. */
export function rememberedActingIdentityId(userId: string): string | null {
  try {
    return localStorage.getItem(rememberedIdentityKey(userId));
  } catch {
    return null;
  }
}

function rememberActingIdentity(userId: string, identityId: string): void {
  try {
    localStorage.setItem(rememberedIdentityKey(userId), identityId);
  } catch {
    /* The choice still applies to this session without device storage. */
  }
}

/** Makes the session act as `identityId`, remembers the choice here, and returns the reissued session. */
export async function selectActingIdentity(session: PortalSession, identityId: string): Promise<PortalSession> {
  const next = await putValidated(
    ACTIVE_IDENTITY_ENDPOINT,
    myActiveIdentitySwitchSchema,
    { identityId },
    userAuthSessionResponseSchema,
  );
  rememberActingIdentity(session.identity.id, identityId);
  return next;
}

/**
 * Applies the choice remembered on this device when the session still needs
 * one and the remembered identity is still active. Otherwise the session is
 * returned as it is, and the portal asks.
 */
export async function applyRememberedActingIdentity(session: PortalSession): Promise<PortalSession> {
  if (!sessionActingIdentityChoiceRequired(session)) return session;
  const remembered = rememberedActingIdentityId(session.identity.id);
  if (!remembered || !session.actingIdentities.some((identity) => identity.id === remembered)) return session;
  try {
    return await selectActingIdentity(session, remembered);
  } catch {
    // The person is asked instead; a failed convenience must not end the sign-in.
    return session;
  }
}
