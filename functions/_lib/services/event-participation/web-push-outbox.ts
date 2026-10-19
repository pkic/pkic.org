import { all, first } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { sha256Hex } from "../../utils/crypto";
import { webPushNotificationSchema } from "../../../../assets/shared/schemas/event-web-push";
import { webPushConfiguration, type WebPushEnvironment } from "./web-push-configuration";
import { webPushDeliverableSql } from "./web-push-delivery-policy";
import { decryptWebPushSubscription } from "./web-push-subscriptions";
import { deliverWebPush, type WebPushTransportResult } from "./web-push-transport";
interface PushDelivery {
  id: string;
  device_id: string;
  user_id: string;
  kind: string;
  destination: string;
  expires_at: string;
  attempts: number;
  subscription_ciphertext: string;
  vapid_key_hash: string;
}
/** One bounded scheduler owns transport retry; email delivery remains independent. */
export async function processAgendaPushOutbox(
  db: DatabaseLike,
  env: WebPushEnvironment,
  limit = 20,
  fetcher: typeof fetch = fetch,
) {
  const configuration = await webPushConfiguration(env);
  if (!configuration) return { configured: false, inspected: 0, accepted: 0 };
  const config = configuration;
  const now = nowIso(),
    bounded = Math.min(Math.max(Math.floor(limit), 1), 100);
  await db.batch([
    db
      .prepare(
        `UPDATE agenda_push_outbox SET status='queued',updated_at=? WHERE id IN(SELECT outbox.id FROM agenda_push_outbox outbox WHERE outbox.status='waiting' AND outbox.expires_at>? AND ${webPushDeliverableSql()} ORDER BY outbox.next_attempt_at,outbox.id LIMIT 100)`,
      )
      .bind(now, now, now, now),
    db
      .prepare(
        "UPDATE agenda_push_outbox SET status='expired',updated_at=? WHERE id IN(SELECT id FROM agenda_push_outbox WHERE status IN('queued','retry','sending','waiting') AND expires_at<=? ORDER BY next_attempt_at,id LIMIT 500)",
      )
      .bind(now, now),
    db
      .prepare(
        "UPDATE agenda_push_outbox SET status=CASE WHEN attempts>=5 THEN 'failed' ELSE 'retry' END,last_error_code='transport_uncertain',lease_token=NULL,lease_until=NULL,updated_at=? WHERE id IN(SELECT id FROM agenda_push_outbox WHERE status='sending' AND lease_until<=? AND expires_at>? ORDER BY next_attempt_at,id LIMIT 100)",
      )
      .bind(now, now, now),
    db
      .prepare(
        `UPDATE agenda_push_outbox SET status='canceled',updated_at=? WHERE id IN(SELECT outbox.id FROM agenda_push_outbox outbox WHERE outbox.status IN('queued','retry') AND NOT ${webPushDeliverableSql()} ORDER BY outbox.next_attempt_at,outbox.id LIMIT 100)`,
      )
      .bind(now, now, now),
  ]);
  const candidates = await all<{ id: string }>(
    db,
    `SELECT outbox.id FROM agenda_push_outbox outbox WHERE outbox.status IN('queued','retry') AND outbox.next_attempt_at<=? AND outbox.expires_at>? AND outbox.attempts<5 AND ${webPushDeliverableSql()} ORDER BY outbox.next_attempt_at,outbox.id LIMIT ?`,
    [now, now, now, now, bounded],
  );
  let accepted = 0;
  async function processCandidate(candidate: { id: string }) {
    const token = crypto.randomUUID(),
      leaseUntil = new Date(Date.now() + 60000).toISOString();
    const claim = await db
      .prepare(
        `UPDATE agenda_push_outbox AS outbox SET status='sending',lease_token=?,lease_until=?,attempts=attempts+1,updated_at=? WHERE id=? AND status IN('queued','retry') AND next_attempt_at<=? AND expires_at>? AND attempts<5 AND ${webPushDeliverableSql()}`,
      )
      .bind(token, leaseUntil, now, candidate.id, now, now, now, now)
      .run();
    if (!claim.meta?.changes) return;
    const delivery = await first<PushDelivery>(
      db,
      `SELECT outbox.id,outbox.device_id,outbox.user_id,outbox.kind,outbox.destination,outbox.expires_at,outbox.attempts,device.subscription_ciphertext,device.vapid_key_hash
   FROM agenda_push_outbox outbox JOIN agenda_push_devices device ON device.id=outbox.device_id
   WHERE outbox.id=? AND outbox.status='sending' AND outbox.lease_token=? AND ${webPushDeliverableSql()}`,
      [candidate.id, token, nowIso(), nowIso()],
    );
    if (!delivery) {
      await db
        .prepare(
          "UPDATE agenda_push_outbox SET status='canceled',lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND lease_token=?",
        )
        .bind(nowIso(), candidate.id, token)
        .run();
      return;
    }
    let result: WebPushTransportResult;
    try {
      if (delivery.vapid_key_hash !== (await sha256Hex(config.publicKey)))
        result = { status: "gone", code: "application_key_changed" };
      else {
        const subscription = await decryptWebPushSubscription(
          delivery.subscription_ciphertext,
          config.encryptionKey,
          delivery.device_id,
          delivery.user_id,
        );
        const ttl = Math.max(0, Math.min(86400, Math.floor((Date.parse(delivery.expires_at) - Date.now()) / 1000)));
        result = await deliverWebPush(
          subscription,
          webPushNotificationSchema.parse({
            notificationId: delivery.id,
            kind: delivery.kind,
            destination: delivery.destination,
          }),
          config,
          ttl,
          fetcher,
          async () =>
            !!(await first(
              db,
              `SELECT outbox.id FROM agenda_push_outbox outbox WHERE outbox.id=? AND outbox.lease_token=? AND outbox.status='sending' AND outbox.expires_at>? AND ${webPushDeliverableSql()}`,
              [delivery.id, token, nowIso(), nowIso(), nowIso()],
            )),
        );
      }
    } catch {
      result = { status: "failed", code: "subscription_unreadable" };
    }
    const completed = nowIso();
    const next = new Date(
      Date.now() + (result.retryAfterMs ?? Math.min(3600000, 1000 * 2 ** delivery.attempts)),
    ).toISOString();
    const state =
      result.code === "consent_changed"
        ? "canceled"
        : result.status === "accepted"
          ? "accepted"
          : result.status === "retry" && delivery.attempts < 5
            ? "retry"
            : "failed";
    const completion = await db.batch([
      db
        .prepare(
          "UPDATE agenda_push_outbox SET status=?,next_attempt_at=?,accepted_at=?,last_error_code=?,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=? AND status='sending' AND lease_token=?",
        )
        .bind(state, next, result.status === "accepted" ? completed : null, result.code, completed, delivery.id, token),
      ...(result.status === "gone"
        ? [
            db
              .prepare(
                "UPDATE agenda_push_devices SET revoked_at=?,subscription_ciphertext='',updated_at=? WHERE id=? AND user_id=? AND subscription_ciphertext=?",
              )
              .bind(completed, completed, delivery.device_id, delivery.user_id, delivery.subscription_ciphertext),
          ]
        : []),
    ]);
    if (result.status === "accepted" && completion[0]?.meta?.changes) accepted++;
  }
  for (let offset = 0; offset < candidates.length; offset += 5)
    await Promise.all(candidates.slice(offset, offset + 5).map(processCandidate));
  return { configured: true, inspected: candidates.length, accepted };
}
