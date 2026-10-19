import type { z } from "zod";
import {
  stripePaymentAdjustmentEventSchema,
  type stripeEventEnvelopeSchema,
} from "../../../../assets/shared/schemas/stripe";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { prepareStripePaymentEvent } from "../payments/ledger";
import { getSponsorship } from "./read-model";
import { prepareSponsorshipStageTransition } from "./stage-transition";

/** Verified financial evidence ends authority and display in the same command as the payment ledger. */
export async function applySponsorshipPaymentAdjustment(
  db: DatabaseLike,
  event: z.infer<typeof stripeEventEnvelopeSchema>,
) {
  const parsed = stripePaymentAdjustmentEventSchema.safeParse(event);
  if (!parsed.success)
    throw new AppError(400, "INVALID_STRIPE_EVENT", "Invalid sponsorship payment adjustment", {
      issues: parsed.error.issues,
    });
  const ledger = await first<{ resource_id: string }>(
    db,
    `SELECT resource_id FROM payment_ledger_entries
    WHERE purpose='sponsorship' AND resource_type='sponsorship' AND provider='stripe'
      AND provider_payment_intent_id=? AND resource_id IS NOT NULL LIMIT 1`,
    [parsed.data.data.object.payment_intent],
  );
  const evidence = await prepareStripePaymentEvent(db, "sponsorship", event);
  const subject = ledger ? await getSponsorship(db, ledger.resource_id) : null;
  if (!subject) {
    // Historical ledger evidence remains valid when no live agreement is linked.
    if (evidence.length) await db.batch(evidence);
    return { received: true };
  }
  const reason = event.type === "charge.refunded" ? "refund" : "dispute";
  if (subject.ended_reason === reason && subject.pipeline_stage === "lapsed") {
    if (evidence.length) await db.batch(evidence);
    return { received: true, duplicate: true };
  }
  const transition = prepareSponsorshipStageTransition(db, subject, {
    toStage: "lapsed",
    endReason: reason,
    actor: null,
    note: `Stripe ${reason}: ${event.id}`,
    auditAction: "sponsorship_payment_withdrawn",
    now: nowIso(),
  });
  await db.batch([...transition.statements, ...evidence]);
  return { received: true };
}
