/** Recover mailbox proof discarded when legacy accounts gained explicit verification fields. */
import type { AuthorizationEvidence } from "../../db/authorization-guard";
import { prepareAuthorizationGuard } from "../../db/authorization-guard";
import { first } from "../../db/queries";
import type { DatabaseLike, StatementLike } from "../../types";
import { prepareAuditLog } from "../audit";
import { prepareVerifyPrimaryEmailStatement } from "../email-verification";

/** Confirmation status alone is not proof: staff can admit attendees or accept proposals. */
const HISTORICAL_PROOF_SQL = `SELECT registration.id AS registration_id,
    CASE WHEN confirmation.id IS NOT NULL THEN confirmation.created_at ELSE invite.accepted_at END AS verified_at,
    CASE WHEN confirmation.id IS NOT NULL THEN 'registration_email_confirmed' ELSE 'accepted_invitation' END AS evidence_type
  FROM users person JOIN registrations registration ON registration.user_id = person.id
  LEFT JOIN audit_log confirmation ON confirmation.entity_type = 'registration'
    AND confirmation.entity_id = registration.id AND confirmation.actor_id = person.id
    AND confirmation.action = 'registration_email_confirmed'
    AND EXISTS (SELECT 1 FROM email_outbox delivered
      WHERE delivered.recipient_user_id = person.id AND delivered.event_id = registration.event_id
        AND lower(trim(delivered.recipient_email)) = person.normalized_email
        AND delivered.template_key = 'registration_confirm_email'
        AND delivered.created_at <= confirmation.created_at)
  LEFT JOIN invites invite ON invite.id = registration.invite_id AND invite.event_id = registration.event_id
    AND invite.accepted_at IS NOT NULL AND lower(trim(invite.invitee_email)) = person.normalized_email
  WHERE person.id = ? AND person.normalized_email = ? AND person.active = 1
    AND person.email_verified_at IS NULL AND person.pii_redacted_at IS NULL AND person.merged_into_user_id IS NULL
    AND registration.confirmed_at IS NOT NULL AND (confirmation.id IS NOT NULL OR invite.accepted_at IS NOT NULL)`;

export interface HistoricalPrimaryEmailProof {
  userId: string;
  normalizedEmail: string;
  registrationId: string;
  verifiedAt: string;
  evidenceType: string;
  evidence: AuthorizationEvidence;
}

export async function findHistoricalPrimaryEmailProof(
  db: DatabaseLike,
  userId: string,
): Promise<HistoricalPrimaryEmailProof | null> {
  const person = await first<{ normalized_email: string }>(
    db,
    "SELECT normalized_email FROM users WHERE id = ? AND email_verified_at IS NULL AND active = 1",
    [userId],
  );
  if (!person) return null;
  const bindings = [userId, person.normalized_email];
  const proof = await first<{ registration_id: string; verified_at: string; evidence_type: string }>(
    db,
    `${HISTORICAL_PROOF_SQL} ORDER BY verified_at, registration.id LIMIT 1`,
    bindings,
  );
  // Only actual instants can become canonical verification timestamps.
  if (!proof || !Number.isFinite(Date.parse(proof.verified_at)) || Date.parse(proof.verified_at) > Date.now())
    return null;
  const verifiedAt = new Date(proof.verified_at).toISOString();
  return {
    userId,
    normalizedEmail: person.normalized_email,
    registrationId: proof.registration_id,
    verifiedAt,
    evidenceType: proof.evidence_type,
    evidence: {
      sql: `SELECT 1 FROM (${HISTORICAL_PROOF_SQL}) proof WHERE proof.registration_id = ? AND proof.verified_at = ? AND proof.evidence_type = ?`,
      bindings: [...bindings, proof.registration_id, proof.verified_at, proof.evidence_type],
    },
  };
}

/** Prefix to the same guarded batch that creates the affiliation and resolves its reviews. */
export function prepareHistoricalEmailVerification(
  db: DatabaseLike,
  proof: HistoricalPrimaryEmailProof,
  restoredAt: string,
): StatementLike[] {
  return [
    prepareAuthorizationGuard(db, proof.evidence),
    prepareVerifyPrimaryEmailStatement(db, {
      userId: proof.userId,
      normalizedEmail: proof.normalizedEmail,
      method: "migration_evidence",
      verifiedAt: proof.verifiedAt,
      recordedAt: restoredAt,
    }),
    prepareAuditLog(
      db,
      "system",
      null,
      "primary_email_verification_restored",
      "user",
      proof.userId,
      { registrationId: proof.registrationId, evidenceType: proof.evidenceType, verifiedAt: proof.verifiedAt },
      restoredAt,
    ),
  ];
}
