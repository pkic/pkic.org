import type { AuthorizationEvidence } from "../db/authorization-guard";
import { eventParticipantSignInEvidence } from "./event-participation";
import {
  affiliationSignInAuthorizationEvidence,
  memberSignInAuthorizationEvidence,
  pendingIdentitySignInAuthorizationEvidence,
  staffSignInAuthorizationEvidence,
  type IdentityCapacityResolution,
} from "./identity-capacities";
import { sponsorUserSignInAuthorizationEvidence } from "./sponsor-capacity";

/** Every resolved sign-in capacity must remain live when its session is committed. */
export function signInCapacityAuthorizationEvidence(
  resolved: IdentityCapacityResolution,
  normalizedEmail: string,
): AuthorizationEvidence[] {
  const userId = resolved.identity.id;
  return [
    ...(resolved.staff ? [staffSignInAuthorizationEvidence(userId, normalizedEmail)] : []),
    ...(resolved.member ? [memberSignInAuthorizationEvidence(userId, normalizedEmail)] : []),
    ...(resolved.sponsors.length > 0 ? [sponsorUserSignInAuthorizationEvidence(userId, normalizedEmail)] : []),
    ...(resolved.pendingIdentityCount > 0 ? [pendingIdentitySignInAuthorizationEvidence(userId, normalizedEmail)] : []),
    ...(resolved.eventParticipation ? [eventParticipantSignInEvidence(userId, normalizedEmail)] : []),
    ...(resolved.hasActiveAffiliation ? [affiliationSignInAuthorizationEvidence(userId, normalizedEmail)] : []),
  ];
}
