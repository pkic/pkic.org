import { AppError } from "../errors";
import { run } from "../db/queries";
import { uuid } from "../utils/ids";
import { nowIso } from "../utils/time";
import { hmacSha256Hex } from "../utils/crypto";
import type { DatabaseLike } from "../types";
import type { EventTermRecord } from "./events";

export async function validateRequiredConsents(
  requiredTerms: EventTermRecord[],
  accepted: Array<{ termKey: string; version: string }>,
): Promise<void> {
  const acceptedSet = new Set(accepted.map((item) => `${item.termKey}:${item.version}`));

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
  const ipHash = payload.ip ? await hmacSha256Hex(payload.secret, payload.ip) : null;
  const uaHash = payload.userAgent ? await hmacSha256Hex(payload.secret, payload.userAgent) : null;
  const acceptedAt = nowIso();

  for (const item of payload.accepted) {
    await run(
      db,
      `INSERT OR IGNORE INTO consent_acceptances (
        id, registration_id, proposal_id, event_id, user_id, audience_type,
        term_key, term_version, accepted_at, ip_hash, user_agent_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
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
      ],
    );
  }
}
