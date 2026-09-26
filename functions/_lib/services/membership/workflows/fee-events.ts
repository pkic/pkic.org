import { recordMembershipFeeAdjustment } from "./fee-adjustments";
import type { z } from "zod";
import {
  membershipPaymentSessionSchema,
  type membershipPaymentEventSchema,
} from "../../../../../assets/shared/schemas/membership-payments";
import { isApplicationTerminalStage } from "../../../../../assets/shared/schemas/member-applications";
import { prepareAuthorizationGuard } from "../../../db/authorization-guard";
import { first } from "../../../db/queries";
import { AppError } from "../../../errors";
import type { DatabaseLike, StatementLike } from "../../../types";
import { nowIso } from "../../../utils/time";
import { prepareAuditLog } from "../../audit";
import { getMembershipExecution } from "./execution";
import { commitMembershipWorkflow } from "./evaluate";

interface FeeEvidenceRow {
  id: string;
  application_id: string;
  generation: number;
  step_position: number;
  category_code: string;
  version_id: string;
  amount: number;
  currency: string;
  deadline_at: string;
  status: string;
  handling_required: number;
  checkout_id: string;
  request_params: string | null;
  provider_session_id: string | null;
  payment_intent_id: string | null;
}

/** Caller verifies the provider signature over the raw body before entering this use case. */
export async function handleMembershipPaymentEvent(
  db: DatabaseLike,
  event: z.infer<typeof membershipPaymentEventSchema>,
  appBaseUrl: string,
) {
  if (await first(db, "SELECT provider_event_id FROM membership_fee_events WHERE provider_event_id = ?", [event.id]))
    return { received: true, duplicate: true };
  if (["charge.refunded", "charge.dispute.created", "charge.dispute.closed"].includes(event.type))
    return recordMembershipFeeAdjustment(db, event);
  if (
    ![
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
      "checkout.session.async_payment_failed",
      "checkout.session.expired",
    ].includes(event.type)
  )
    return { received: true, ignored: true };
  const parsed = membershipPaymentSessionSchema.safeParse(event.data.object);
  if (!parsed.success) return { received: true, ignored: true };
  const session = parsed.data;
  const metadata = session.metadata;
  const fee = await first<FeeEvidenceRow>(
    db,
    `SELECT fee.id, fee.application_id, fee.generation, fee.step_position, fee.category_code,
    fee.version_id, fee.amount, fee.currency, fee.deadline_at, fee.status, fee.handling_required, fee.payment_intent_id,
    checkout.id AS checkout_id, checkout.provider_session_id, checkout.request_params
    FROM membership_fee_intents fee JOIN membership_fee_checkouts checkout ON checkout.fee_id = fee.id
    WHERE fee.id = ? AND checkout.id = ?`,
    [metadata.membershipFeeId, metadata.membershipCheckoutId],
  );
  if (!fee) return { received: true, ignored: true };
  // Compare the signed category to the exact request sent to Stripe. A catalog
  // rename changes live foreign keys, but cannot change an issued checkout.
  const mappingMatches =
    metadata.applicationId === fee.application_id &&
    metadata.workflowVersionId === fee.version_id &&
    metadata.categoryCode ===
      (fee.request_params === null
        ? fee.category_code
        : new URLSearchParams(fee.request_params).get("metadata[categoryCode]")) &&
    metadata.generation === String(fee.generation) &&
    fee.provider_session_id === session.id;
  // A webhook can arrive while the checkout worker is persisting its response.
  if (!fee.provider_session_id)
    throw new AppError(
      409,
      "MEMBERSHIP_CHECKOUT_PENDING",
      "Checkout association is still being recorded. Retry this event.",
    );
  const paid =
    ["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type) &&
    session.payment_status === "paid";
  const valid =
    mappingMatches &&
    session.amount_total === fee.amount &&
    session.currency === fee.currency &&
    (!paid || Boolean(session.payment_intent));
  const now = nowIso();
  const eventTime = new Date(event.created * 1000).toISOString();
  const execution = await getMembershipExecution(db, fee.application_id);
  const stale =
    execution.generation !== fee.generation ||
    execution.version.id !== fee.version_id ||
    execution.application.membership_category !== fee.category_code;
  const handlingRequired =
    paid &&
    (fee.handling_required === 1 ||
      stale ||
      isApplicationTerminalStage(execution.application.stage) ||
      eventTime > fee.deadline_at);
  const providerTerminalStatus =
    valid && !paid
      ? event.type === "checkout.session.async_payment_failed"
        ? "failed"
        : event.type === "checkout.session.expired"
          ? "expired"
          : null
      : null;
  const outcome = !valid
    ? "rejected_mismatch"
    : paid
      ? handlingRequired
        ? "paid_requires_handling"
        : "paid"
      : (providerTerminalStatus ?? "unconfirmed");
  const statements: StatementLike[] = [
    db
      .prepare(
        `INSERT INTO membership_fee_events (provider_event_id, fee_id, event_type, outcome, created_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(event.id, fee.id, event.type, outcome, now),
    prepareAuditLog(
      db,
      "system",
      null,
      "membership_fee_event",
      "member_application",
      fee.application_id,
      { feeId: fee.id, providerEventId: event.id, outcome, eventType: event.type },
      now,
    ),
  ];
  if (valid && paid && fee.status !== "paid") {
    statements.push(
      db
        .prepare(
          `UPDATE membership_fee_intents SET status = 'paid', paid_at = ?, payment_intent_id = ?, handling_required = ?, updated_at = ?
      WHERE id = ? AND status = ?`,
        )
        .bind(eventTime, session.payment_intent, handlingRequired ? 1 : 0, now, fee.id, fee.status),
    );
  }
  if (valid && paid && fee.status === "paid" && fee.payment_intent_id !== session.payment_intent) {
    statements.push(
      db
        .prepare("UPDATE membership_fee_intents SET handling_required = 1, updated_at = ? WHERE id = ?")
        .bind(now, fee.id),
      db
        .prepare(
          "UPDATE member_applications SET transition_revision = transition_revision + 1, updated_at = ? WHERE id = ?",
        )
        .bind(now, fee.application_id),
    );
  }
  if (providerTerminalStatus && fee.status !== "paid" && fee.status !== providerTerminalStatus) {
    statements.push(
      db
        .prepare("UPDATE membership_fee_intents SET status = ?, updated_at = ? WHERE id = ? AND status = ?")
        .bind(providerTerminalStatus, now, fee.id, fee.status),
    );
  }
  try {
    if (valid && paid && !handlingRequired && fee.status !== "paid") {
      const step = execution.steps[fee.step_position];
      if (step?.fee_id !== fee.id || execution.currentPosition !== fee.step_position)
        throw new AppError(409, "MEMBERSHIP_FEE_NOT_ACTIVE", "This fee does not match the active requirement.");
      step.fee_status = "paid";
      step.fee_paid_at = eventTime;
      step.fee_handling_required = 0;
      await commitMembershipWorkflow(
        db,
        execution,
        appBaseUrl,
        {
          statements,
          actor: null,
          actorUserId: null,
          reason: "The payment provider confirmed the exact required membership fee.",
        },
        now,
      );
    } else {
      await db.batch([
        prepareAuthorizationGuard(db, {
          sql: "SELECT 1 FROM member_applications WHERE id = ? AND stage = ? AND transition_revision = ?",
          bindings: [fee.application_id, execution.application.stage, execution.application.transition_revision],
        }),
        ...statements,
      ]);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("membership_fee_events.provider_event_id"))
      return { received: true, duplicate: true };
    throw error;
  }
  return { received: true, outcome };
}
