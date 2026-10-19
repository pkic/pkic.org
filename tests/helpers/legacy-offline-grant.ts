import { env } from "cloudflare:workers";

/** Historical evidence fixture only; scanners no longer issue or enforce admission grants. */
export async function seedLegacyOfflineGrant(input: {
  eventId: string;
  occurrenceId: string;
  operatorId: string;
  deviceId: string;
  roomId?: string;
}) {
  const id = crypto.randomUUID(),
    now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO event_offline_admission_grants(id,event_id,occurrence_id,room_id,day_date,operator_user_id,device_id,quantity,published_revision,issued_at,expires_at,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
  )
    .bind(
      id,
      input.eventId,
      input.occurrenceId,
      input.roomId ?? null,
      now.slice(0, 10),
      input.operatorId,
      input.deviceId,
      1,
      0,
      now,
      new Date(Date.now() + 60000).toISOString(),
      input.operatorId,
    )
    .run();
  return { id };
}
