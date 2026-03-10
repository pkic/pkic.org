import { run } from "../db/queries";
import { uuid } from "../utils/ids";
import { nowIso } from "../utils/time";
import type { DatabaseLike } from "../types";

export async function recordEngagement(
  db: DatabaseLike,
  payload: {
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
  },
): Promise<void> {
  const subjectType = payload.subjectType ?? (payload.eventId ? "event" : "community");
  const subjectRef = payload.subjectRef ?? (subjectType === "event" ? payload.eventId ?? null : null);
  const data = payload.data ?? payload.metadata ?? null;

  await run(
    db,
    `INSERT INTO engagement_events (
      id, user_id, event_id, subject_type, subject_ref, action_type, points, source_type, source_ref, data_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
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
    ],
  );
}
