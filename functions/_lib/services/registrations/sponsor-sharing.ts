import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { isAuthorizationGuardFailure, prepareAuthorizationGuard } from "../../db/authorization-guard";
import { parseCapabilityToken, verifyCapabilityToken } from "../../auth/capability-token";
import { nowIso } from "../../utils/time";
import { prepareAuditLogWhen } from "../audit";
import type { ParticipantAuthority } from "../participant-authority";
import { getRegistrationByManageToken } from "./queries";
import type { RegistrationRecord } from "./types";

/** Withdraw only the attendee's optional sponsor sharing, preserving acceptance and registration history. */
export async function withdrawRegistrationSponsorSharing(
  db: DatabaseLike,
  authority: ParticipantAuthority,
  signingSecret: string,
  expected: RegistrationRecord,
) {
  const registration = await getRegistrationByManageToken(db, authority, signingSecret);
  if (
    registration.id !== expected.id ||
    registration.event_id !== expected.event_id ||
    registration.user_id !== expected.user_id
  )
    throw new AppError(
      403,
      "REGISTRATION_CONSENT_AUTHORITY_REQUIRED",
      "Withdraw sharing only for your own registration.",
    );
  const capability = typeof authority === "string" ? parseCapabilityToken(authority, "registration_manage") : null;
  if (typeof authority === "string" ? !capability : !authority.sessionId)
    throw new AppError(
      403,
      "REGISTRATION_CONSENT_AUTHORITY_REQUIRED",
      "Use your own registration link or live session.",
    );
  if (typeof authority === "string") {
    const verified =
      registration.manage_link_secret &&
      (await verifyCapabilityToken({
        signingSecret,
        linkSecret: registration.manage_link_secret,
        purpose: "registration_manage",
        token: authority,
      }));
    if (!verified || !verified.ok || verified.resourceId !== registration.id)
      throw new AppError(403, "REGISTRATION_CONSENT_AUTHORITY_REQUIRED", "Use your current registration link.");
  }
  const at = nowIso();
  try {
    await db.batch([
      prepareAuthorizationGuard(db, {
        sql: `SELECT 1 FROM registrations r JOIN users u ON u.id=r.user_id
          WHERE r.id=? AND r.event_id=? AND r.user_id=? AND r.transition_revision=? AND u.pii_redacted_at IS NULL
            AND ${
              capability
                ? "r.manage_link_secret IS ? AND ? > unixepoch('now')"
                : "u.active=1 AND EXISTS(SELECT 1 FROM sessions s WHERE s.id=? AND s.user_id=r.user_id AND s.revoked_at IS NULL AND s.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))"
            }`,
        bindings: [
          registration.id,
          registration.event_id,
          registration.user_id,
          expected.transition_revision,
          ...(capability
            ? [registration.manage_link_secret, capability.expiresAt]
            : [typeof authority === "string" ? "" : authority.sessionId]),
        ],
      }),
      db
        .prepare(
          `UPDATE consent_acceptances SET withdrawn_at=?
        WHERE registration_id=? AND event_id=? AND user_id=? AND audience_type='attendee'
          AND term_key='sponsor-data-sharing' AND withdrawn_at IS NULL`,
        )
        .bind(at, registration.id, registration.event_id, registration.user_id),
      prepareAuditLogWhen(db, {
        actorType: "user",
        actorId: registration.user_id,
        action: "sponsor_sharing_withdrawn",
        entityType: "registration",
        entityId: registration.id,
        details: { termKey: "sponsor-data-sharing", withdrawnAt: at },
        conditionSql: "SELECT 1 WHERE changes()>0",
        conditionBindings: [],
        createdAt: at,
        scope: { type: "event", id: registration.event_id },
      }),
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error))
      throw new AppError(
        409,
        "REGISTRATION_CONSENT_AUTHORITY_CHANGED",
        "Registration authorization changed. Open your current registration link and try again.",
      );
    throw error;
  }
  return registration;
}
