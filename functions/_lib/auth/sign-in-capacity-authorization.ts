import type { AuthorizationEvidence } from "../db/authorization-guard";
import { eventParticipantSignInEvidence } from "./event-participation";
import {
  activeUserSignInAuthorizationEvidence,
  identitySignInAuthorizationEvidence,
  memberSignInAuthorizationEvidence,
  pendingIdentitySignInAuthorizationEvidence,
  staffSignInAuthorizationEvidence,
  type IdentityCapacityResolution,
} from "./identity-capacities";
import { sponsorUserSignInAuthorizationEvidence } from "./sponsor-capacity";

/** The active user and every resolved sign-in capacity must remain live when the session is committed. */
export function signInCapacityAuthorizationEvidence(
  resolved: IdentityCapacityResolution,
  normalizedEmail: string,
): AuthorizationEvidence[] {
  const userId = resolved.identity.id;
  return [
    activeUserSignInAuthorizationEvidence(userId, normalizedEmail),
    ...(resolved.staff ? [staffSignInAuthorizationEvidence(userId, normalizedEmail)] : []),
    ...(resolved.memberships.length > 0 ? [memberSignInAuthorizationEvidence(userId, normalizedEmail)] : []),
    ...(resolved.sponsors.length > 0 ? [sponsorUserSignInAuthorizationEvidence(userId, normalizedEmail)] : []),
    ...(resolved.pendingIdentityCount > 0 ? [pendingIdentitySignInAuthorizationEvidence(userId, normalizedEmail)] : []),
    ...(resolved.eventParticipation ? [eventParticipantSignInEvidence(userId, normalizedEmail)] : []),
    ...(resolved.hasActiveIdentity ? [identitySignInAuthorizationEvidence(userId, normalizedEmail)] : []),
  ];
}
