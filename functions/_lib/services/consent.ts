import { AppError } from "../errors";
import { uuid } from "../utils/ids";
import { nowIso } from "../utils/time";
import { hmacSha256Hex } from "../utils/crypto";
import type { DatabaseLike, StatementLike } from "../types";
import type { EventTermRecord } from "./events";
import { prepareAuthorizationGuard } from "../db/authorization-guard";

export async function validateRequiredConsents(
  requiredTerms: EventTermRecord[],
  accepted: Array<{ termKey: string; version: string }>,
): Promise<void> {
  const activeTerms = new Set(requiredTerms.map((term) => `${term.term_key}:${term.version}`));
  const acceptedSet = new Set(accepted.map((item) => `${item.termKey}:${item.version}`));

  for (const acceptance of accepted) {
    if (!activeTerms.has(`${acceptance.termKey}:${acceptance.version}`)) {
      throw new AppError(
        400,
        "CONSENT_INVALID",
        `Consent for ${acceptance.termKey} v${acceptance.version} is not an active event term`,
      );
    }
  }

  for (const term of requiredTerms) {
    if (term.required !== 1) {
      continue;
    }

    const key = `${term.term_key}:${term.version}`;
    if (!acceptedSet.has(key)) {
      throw new AppError(400, "CONSENT_REQUIRED", `Missing required consent for ${term.term_key} v${term.version}`);
    }
  }
}

export async function persistConsents(
  db: DatabaseLike,
  payload: {
    registrationId?: string;
    proposalId?: string;
    eventId: string;
    userId: string;
    audienceType: "attendee" | "speaker";
    accepted: Array<{ termKey: string; version: string }>;
    ip: string | null;
    userAgent: string | null;
    secret: string;
  },
): Promise<void> {
  await db.batch(await prepareConsentStatements(db, payload));
}

export async function prepareConsentStatements(
  db: DatabaseLike,
  payload: {
    registrationId?: string;
    proposalId?: string;
    eventId: string;
    userId: string;
    audienceType: "attendee" | "speaker";
    accepted: Array<{ termKey: string; version: string }>;
    ip: string | null;
    userAgent: string | null;
    secret: string;
  },
): Promise<StatementLike[]> {
  const ipHash = payload.ip ? await hmacSha256Hex(payload.secret, payload.ip) : null;
  const uaHash = payload.userAgent ? await hmacSha256Hex(payload.secret, payload.userAgent) : null;
  const acceptedAt = nowIso();

  return payload.accepted.map((item) =>
    db
      .prepare(
        `INSERT OR IGNORE INTO consent_acceptances (
        id, registration_id, proposal_id, event_id, user_id, audience_type,
        term_key, term_version, accepted_at, ip_hash, user_agent_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        uuid(),
        payload.registrationId ?? null,
        payload.proposalId ?? null,
        payload.eventId,
        payload.userId,
        payload.audienceType,
        item.termKey,
        item.version,
        acceptedAt,
        ipHash,
        uaHash,
      ),
  );
}

/** D1 trigger failure when consent no longer belongs to the planned aggregate. */
export function isConsentAcceptanceContextConflict(error: unknown): boolean {
  return error instanceof Error && error.message.includes("CONSENT_ACCEPTANCE_CONTEXT_INVALID");
}

/**
 * Rechecks the complete active attendee-terms snapshot in the registration
 * batch. This keeps validation and consent writes from straddling a terms
 * replacement without persisting another revision abstraction.
 */
export function prepareActiveTermsSnapshotGuard(
  db: DatabaseLike,
  eventId: string,
  terms: readonly EventTermRecord[],
): StatementLike {
  return prepareAuthorizationGuard(db, {
    sql: `WITH expected AS (
             SELECT json_extract(snapshot.value, '$.termKey') AS term_key,
                    json_extract(snapshot.value, '$.version') AS version,
                    json_extract(snapshot.value, '$.required') AS required,
                    json_extract(snapshot.value, '$.contentRef') AS content_ref,
                    json_extract(snapshot.value, '$.displayText') AS display_text,
                    json_extract(snapshot.value, '$.helpText') AS help_text
               FROM json_each(?) snapshot
           ), current AS (
             SELECT term_key, version, required, content_ref, display_text, help_text
               FROM event_terms
              WHERE event_id = ? AND audience_type = 'attendee' AND active = 1
           )
           SELECT 1
            WHERE NOT EXISTS (
                    SELECT term_key, version, required, content_ref, display_text, help_text FROM current
                    EXCEPT
                    SELECT term_key, version, required, content_ref, display_text, help_text FROM expected
                  )
              AND NOT EXISTS (
                    SELECT term_key, version, required, content_ref, display_text, help_text FROM expected
                    EXCEPT
                    SELECT term_key, version, required, content_ref, display_text, help_text FROM current
                  )`,
    bindings: [
      JSON.stringify(
        terms.map((term) => ({
          termKey: term.term_key,
          version: term.version,
          required: term.required,
          contentRef: term.content_ref,
          displayText: term.display_text,
          helpText: term.help_text,
        })),
      ),
      eventId,
    ],
  });
}
