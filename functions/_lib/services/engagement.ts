import { uuid } from "../utils/ids";
import { nowIso } from "../utils/time";
import type { DatabaseLike, StatementLike } from "../types";

export interface EngagementPayload {
  userId: string;
  eventId?: string | null;
  subjectType?:
    | "community"
    | "event"
    | "organization"
    | "member"
    | "registration"
    | "proposal"
    | "invite"
    | "referral"
    | "sponsorship"
    | "system";
  subjectRef?: string | null;
  actionType: string;
  points?: number;
  sourceType?: string | null;
  sourceRef?: string | null;
  data?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  /** Stable domain-action key. Replays with the same key are ignored. */
  idempotencyKey?: string | null;
}

export function prepareEngagementStatement(db: DatabaseLike, payload: EngagementPayload): StatementLike {
  const subjectType = payload.subjectType ?? (payload.eventId ? "event" : "community");
  const subjectRef = payload.subjectRef ?? (subjectType === "event" ? (payload.eventId ?? null) : null);
  const data = payload.data ?? payload.metadata ?? null;

  return db
    .prepare(
      `INSERT INTO engagement_events (
        id, user_id, event_id, subject_type, subject_ref, action_type, points, source_type, source_ref,
        data_json, created_at, idempotency_key
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
    )
    .bind(
      uuid(),
      payload.userId,
      payload.eventId ?? null,
      subjectType,
      subjectRef,
      payload.actionType,
      payload.points ?? 0,
      payload.sourceType ?? null,
      payload.sourceRef ?? null,
      data ? JSON.stringify(data) : null,
      nowIso(),
      payload.idempotencyKey ?? null,
    );
}

export async function recordEngagement(db: DatabaseLike, payload: EngagementPayload): Promise<void> {
  await db.batch([prepareEngagementStatement(db, payload)]);
}
