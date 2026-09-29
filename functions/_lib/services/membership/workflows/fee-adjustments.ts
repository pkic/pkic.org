import type { z } from "zod";
import { prepareAuthorizationGuard } from "../../../db/authorization-guard";
import { first } from "../../../db/queries";
import type { DatabaseLike } from "../../../types";
import { nowIso } from "../../../utils/time";
import { prepareAuditLog } from "../../audit";
import {
  membershipPaymentAdjustmentSchema,
  type membershipPaymentEventSchema,
} from "../../../../../assets/shared/schemas/membership-payments";

/** Refunds and disputes require staff handling; they never silently revoke membership. */
export async function recordMembershipFeeAdjustment(
  db: DatabaseLike,
  event: z.infer<typeof membershipPaymentEventSchema>,
) {
  const parsed = membershipPaymentAdjustmentSchema.safeParse(event.data.object);
  if (!parsed.success) return { received: true, ignored: true };
  const row = await first<{ id: string; application_id: string; transition_revision: number }>(
    db,
    `SELECT fee.id, fee.application_id, application.transition_revision
      FROM membership_fee_intents fee JOIN member_applications application ON application.id = fee.application_id
      WHERE fee.payment_intent_id = ? OR (fee.id = ? AND fee.payment_intent_id IS NULL) LIMIT 1`,
    [parsed.data.payment_intent ?? null, parsed.data.metadata?.membershipFeeId ?? null],
  );
  if (!row) return { received: true, ignored: true };
  const now = nowIso();
  try {
    await db.batch([
      prepareAuthorizationGuard(db, {
        sql: "SELECT 1 FROM member_applications WHERE id = ? AND transition_revision = ?",
        bindings: [row.application_id, row.transition_revision],
      }),
      db
        .prepare(
          "INSERT INTO membership_fee_events (provider_event_id, fee_id, event_type, outcome, created_at) VALUES (?, ?, ?, 'adjustment_requires_handling', ?)",
        )
        .bind(event.id, row.id, event.type, now),
      db
        .prepare("UPDATE membership_fee_intents SET handling_required = 1, updated_at = ? WHERE id = ?")
        .bind(now, row.id),
      db
        .prepare(
          "UPDATE member_applications SET transition_revision = transition_revision + 1, updated_at = ? WHERE id = ?",
        )
        .bind(now, row.application_id),
      prepareAuditLog(
        db,
        "system",
        null,
        "membership_fee_adjustment",
        "member_application",
        row.application_id,
        { feeId: row.id, providerEventId: event.id, eventType: event.type, requiresHandling: true },
        now,
      ),
    ]);
  } catch (error) {
    if (error instanceof Error && error.message.includes("membership_fee_events.provider_event_id"))
      return { received: true, duplicate: true };
    throw error;
  }
  return { received: true, requiresHandling: true };
}
