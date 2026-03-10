import { AppError } from "../errors";
import { all, first, run } from "../db/queries";
import { randomBase62, uuid } from "../utils/ids";
import { nowIso } from "../utils/time";
import { hmacSha256Hex } from "../utils/crypto";
import { recordEngagement } from "./engagement";
import type { DatabaseLike } from "../types";

interface ReferralRow {
  code: string;
  event_id: string;
  owner_type: string;
  owner_id: string;
  created_by_user_id: string | null;
  clicks: number;
  conversions: number;
}

export async function createReferralCode(
  db: DatabaseLike,
  payload: {
    eventId: string;
    ownerType: "registration" | "proposal";
    ownerId: string;
    createdByUserId?: string | null;
    channelHint?: string | null;
    length: number;
  },
): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = randomBase62(payload.length);
    const existing = await first<ReferralRow>(db, "SELECT code FROM referral_codes WHERE code = ?", [code]);
    if (existing) {
      continue;
    }

    await run(
      db,
      `INSERT INTO referral_codes (
        code, event_id, owner_type, owner_id, created_by_user_id, channel_hint, clicks, conversions, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)`,
      [
        code,
        payload.eventId,
        payload.ownerType,
        payload.ownerId,
        payload.createdByUserId ?? null,
        payload.channelHint ?? null,
        nowIso(),
      ],
    );

    return code;
  }

  throw new AppError(500, "REFERRAL_CODE_GENERATION_FAILED", "Unable to generate unique referral code");
}

export async function recordReferralClick(
  db: DatabaseLike,
  payload: { code: string; ip: string | null; userAgent: string | null; secret: string },
): Promise<ReferralRow | null> {
  const referral = await first<ReferralRow>(db, "SELECT * FROM referral_codes WHERE code = ?", [payload.code]);
  if (!referral) {
    return null;
  }

  await run(db, "UPDATE referral_codes SET clicks = clicks + 1 WHERE code = ?", [payload.code]);

  const ipHash = payload.ip ? await hmacSha256Hex(payload.secret, payload.ip) : null;
  const uaHash = payload.userAgent ? await hmacSha256Hex(payload.secret, payload.userAgent) : null;

  await run(
    db,
    `INSERT INTO referral_clicks (id, code, event_id, ip_hash, user_agent_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [uuid(), payload.code, referral.event_id, ipHash, uaHash, nowIso()],
  );

  return { ...referral, clicks: referral.clicks + 1 };
}

export async function recordReferralConversion(db: DatabaseLike, code: string): Promise<void> {
  await run(db, "UPDATE referral_codes SET conversions = conversions + 1 WHERE code = ?", [code]);

  const referral = await first<ReferralRow>(
    db,
    "SELECT code, event_id, owner_type, owner_id, created_by_user_id, clicks, conversions FROM referral_codes WHERE code = ?",
    [code],
  );

  if (!referral?.created_by_user_id) {
    return;
  }

  await recordEngagement(db, {
    userId: referral.created_by_user_id,
    eventId: referral.event_id,
    subjectType: "referral",
    subjectRef: code,
    actionType: "referral_conversion",
    points: 4,
    sourceType: "referral",
    sourceRef: code,
    data: { ownerType: referral.owner_type, ownerId: referral.owner_id },
  });
}

export async function getReferralLeaderboard(db: DatabaseLike, eventId: string): Promise<ReferralRow[]> {
  return all<ReferralRow>(
    db,
    `SELECT code, event_id, owner_type, owner_id, clicks, conversions
     FROM referral_codes
     WHERE event_id = ?
     ORDER BY conversions DESC, clicks DESC
     LIMIT 100`,
    [eventId],
  );
}
