import type { z } from "zod";
import type { offlinePaymentSettlementSchema } from "../../../../assets/shared/schemas/payment-settlements";
import { isApplicationTerminalStage } from "../../../../assets/shared/schemas/member-applications";
import { adminDatabaseUserId } from "../../auth/admin-identity";
import { preparePermissionsAuthorizationGuard } from "../../auth/permissions";
import { isAuthorizationGuardFailure, prepareAuthorizationGuard } from "../../db/authorization-guard";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike, StatementLike } from "../../types";
import { nowIso } from "../../utils/time";
import { prepareAuditLog } from "../audit";
import { commitMembershipWorkflow } from "../membership/workflows/evaluate";
import { getMembershipExecution } from "../membership/workflows/execution";

type OfflineSettlementInput = z.infer<typeof offlinePaymentSettlementSchema>;
type OfflinePaymentPurpose = "membership" | "sponsorship";

export interface OfflineSettlementResult {
  paymentId: string;
  purpose: OfflinePaymentPurpose;
  resourceId: string;
  status: "paid";
  amount: number;
  currency: string;
  method: OfflineSettlementInput["method"];
  settledAt: string;
  duplicate: boolean;
  handlingRequired?: boolean;
  outboxIds: string[];
}

interface ExistingSettlementRow {
  payment_id: string;
  purpose: OfflinePaymentPurpose;
  resource_id: string;
  status: "paid";
  amount: number;
  currency: string;
  payment_method: OfflineSettlementInput["method"];
  paid_at: string;
}

interface MembershipFeeRow {
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
}

interface SponsorshipPaymentRow {
  id: string;
  transition_revision: number;
  price_amount_cents: number | null;
  price_currency: string | null;
}

function externalEventId(idempotencyKey: string): string {
  return `offline:${idempotencyKey}`;
}

function paymentId(idempotencyKey: string): string {
  return `payment:offline:${idempotencyKey}`;
}

function requireSettlementTime(settledAt: string): void {
  if (Date.parse(settledAt) > Date.now() + 300_000) {
    throw new AppError(422, "FUTURE_SETTLEMENT", "The settlement time cannot be in the future");
  }
}

async function existingSettlement(
  db: DatabaseLike,
  idempotencyKey: string,
  purpose: OfflinePaymentPurpose,
  resourceId: string,
): Promise<OfflineSettlementResult | null> {
  const row = await first<ExistingSettlementRow>(
    db,
    `SELECT event.payment_id, payment.purpose, payment.resource_id, payment.status,
      payment.amount, payment.currency, payment.payment_method, payment.paid_at
     FROM payment_ledger_events event
     JOIN payment_ledger_entries payment ON payment.id = event.payment_id
     WHERE event.source = 'staff' AND event.external_event_id = ? LIMIT 1`,
    [externalEventId(idempotencyKey)],
  );
  if (!row) return null;
  if (row.purpose !== purpose || row.resource_id !== resourceId) {
    throw new AppError(409, "SETTLEMENT_KEY_REUSED", "The settlement key was already used for another payment");
  }
  return {
    paymentId: row.payment_id,
    purpose: row.purpose,
    resourceId: row.resource_id,
    status: "paid",
    amount: row.amount,
    currency: row.currency,
    method: row.payment_method,
    settledAt: row.paid_at,
    duplicate: true,
    outboxIds: [],
  };
}

async function requireNoPaidSettlement(
  db: DatabaseLike,
  purpose: OfflinePaymentPurpose,
  resourceType: string,
  resourceId: string,
): Promise<void> {
  const paid = await first<{ id: string }>(
    db,
    `SELECT id FROM payment_ledger_entries
     WHERE purpose = ? AND resource_type = ? AND resource_id = ? AND status = 'paid'
     LIMIT 1`,
    [purpose, resourceType, resourceId],
  );
  if (paid) throw new AppError(409, "PAYMENT_ALREADY_SETTLED", "This payment has already been settled");
}

function requireExactAmount(
  expectedAmount: number | null,
  expectedCurrency: string | null,
  input: OfflineSettlementInput,
): void {
  if (
    (expectedAmount !== null && input.amount !== expectedAmount) ||
    (expectedCurrency !== null && input.currency !== expectedCurrency.toLowerCase())
  ) {
    throw new AppError(
      409,
      "PAYMENT_AMOUNT_MISMATCH",
      "The settlement does not match the recorded amount and currency",
    );
  }
}

function prepareOfflineLedgerStatements(
  db: DatabaseLike,
  actor: AuthAdmin,
  purpose: OfflinePaymentPurpose,
  resourceType: string,
  resourceId: string,
  fromStatus: string | null,
  input: OfflineSettlementInput,
  now: string,
): StatementLike[] {
  const id = paymentId(input.idempotencyKey);
  const eventId = externalEventId(input.idempotencyKey);
  return [
    db
      .prepare(
        `INSERT INTO payment_ledger_entries
          (id, purpose, resource_type, resource_id, provider, status, amount, currency,
           payment_method, paid_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'offline', 'paid', ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        purpose,
        resourceType,
        resourceId,
        input.amount,
        input.currency,
        input.method,
        input.settledAt,
        now,
        now,
      ),
    db
      .prepare(
        `INSERT INTO payment_ledger_events
          (id, payment_id, source, external_event_id, event_type, from_status, to_status,
           domain_outcome, actor_user_id, payment_method, amount, currency, reference, note, occurred_at, created_at)
         VALUES (?, ?, 'staff', ?, 'offline.settled', ?, 'paid', 'accepted', ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        `payment-event:staff:${input.idempotencyKey}`,
        id,
        eventId,
        fromStatus,
        adminDatabaseUserId(actor),
        input.method,
        input.amount,
        input.currency,
        input.reference,
        input.note,
        input.settledAt,
        now,
      ),
  ];
}

export async function recordOfflineMembershipFeeSettlement(
  db: DatabaseLike,
  actor: AuthAdmin,
  feeId: string,
  input: OfflineSettlementInput,
  appBaseUrl: string,
): Promise<OfflineSettlementResult> {
  requireSettlementTime(input.settledAt);
  const duplicate = await existingSettlement(db, input.idempotencyKey, "membership", feeId);
  if (duplicate) return duplicate;

  const fee = await first<MembershipFeeRow>(
    db,
    `SELECT id, application_id, generation, step_position, category_code, version_id,
      amount, lower(currency) AS currency, deadline_at, status, handling_required
     FROM membership_fee_intents WHERE id = ? LIMIT 1`,
    [feeId],
  );
  if (!fee) throw new AppError(404, "MEMBERSHIP_FEE_NOT_FOUND", "Membership fee not found");
  requireExactAmount(fee.amount, fee.currency, input);
  await requireNoPaidSettlement(db, "membership", "membership_fee", fee.id);
  if (fee.status === "paid") throw new AppError(409, "PAYMENT_ALREADY_SETTLED", "This fee has already been settled");

  const execution = await getMembershipExecution(db, fee.application_id);
  const activeStep = execution.steps[fee.step_position];
  const stale =
    execution.generation !== fee.generation ||
    execution.version.id !== fee.version_id ||
    execution.application.membership_category !== fee.category_code;
  const handlingRequired =
    fee.handling_required === 1 ||
    stale ||
    isApplicationTerminalStage(execution.application.stage) ||
    input.settledAt > fee.deadline_at ||
    execution.currentPosition !== fee.step_position ||
    activeStep?.fee_id !== fee.id;
  const now = nowIso();
  const statements: StatementLike[] = [
    preparePermissionsAuthorizationGuard(db, actor, [{ permission: "membership:write" }]),
    prepareAuthorizationGuard(db, {
      sql: "SELECT 1 FROM membership_fee_intents WHERE id = ? AND status = ? AND handling_required = ?",
      bindings: [fee.id, fee.status, fee.handling_required],
    }),
    db
      .prepare(
        `UPDATE membership_fee_intents
         SET status = 'paid', paid_at = ?, handling_required = ?, updated_at = ?
         WHERE id = ? AND status = ? AND handling_required = ?`,
      )
      .bind(input.settledAt, handlingRequired ? 1 : 0, now, fee.id, fee.status, fee.handling_required),
    ...prepareOfflineLedgerStatements(db, actor, "membership", "membership_fee", fee.id, fee.status, input, now),
    prepareAuditLog(
      db,
      "admin",
      actor.id,
      "membership_fee_settled_offline",
      "membership_fee",
      fee.id,
      {
        applicationId: fee.application_id,
        amount: input.amount,
        currency: input.currency,
        method: input.method,
        reference: input.reference,
        note: input.note,
        settledAt: input.settledAt,
        handlingRequired,
      },
      now,
      externalEventId(input.idempotencyKey),
    ),
  ];

  let outboxIds: string[] = [];
  try {
    if (!handlingRequired) {
      activeStep.fee_status = "paid";
      activeStep.fee_paid_at = input.settledAt;
      activeStep.fee_handling_required = 0;
      const committed = await commitMembershipWorkflow(
        db,
        execution,
        appBaseUrl,
        {
          statements,
          actor,
          actorUserId: adminDatabaseUserId(actor),
          reason: "Staff recorded the exact required membership fee as settled offline.",
        },
        now,
      );
      outboxIds = committed.outboxIds;
    } else {
      await db.batch(statements);
    }
  } catch (error) {
    const raced = await existingSettlement(db, input.idempotencyKey, "membership", feeId);
    if (raced) return raced;
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(409, "PAYMENT_CHANGED", "The fee or your authorization changed; reload and retry");
    }
    throw error;
  }

  return {
    paymentId: paymentId(input.idempotencyKey),
    purpose: "membership",
    resourceId: fee.id,
    status: "paid",
    amount: input.amount,
    currency: input.currency,
    method: input.method,
    settledAt: input.settledAt,
    duplicate: false,
    handlingRequired,
    outboxIds,
  };
}

export async function recordOfflineSponsorshipSettlement(
  db: DatabaseLike,
  actor: AuthAdmin,
  sponsorshipId: string,
  input: OfflineSettlementInput,
): Promise<OfflineSettlementResult> {
  requireSettlementTime(input.settledAt);
  const duplicate = await existingSettlement(db, input.idempotencyKey, "sponsorship", sponsorshipId);
  if (duplicate) return duplicate;

  const sponsorship = await first<SponsorshipPaymentRow>(
    db,
    `SELECT id, transition_revision, price_amount_cents, lower(price_currency) AS price_currency
     FROM sponsorships WHERE id = ? LIMIT 1`,
    [sponsorshipId],
  );
  if (!sponsorship) throw new AppError(404, "SPONSORSHIP_NOT_FOUND", "Sponsorship not found");
  requireExactAmount(sponsorship.price_amount_cents, sponsorship.price_currency, input);
  await requireNoPaidSettlement(db, "sponsorship", "sponsorship", sponsorship.id);
  const now = nowIso();

  try {
    await db.batch([
      preparePermissionsAuthorizationGuard(db, actor, [{ permission: "sponsorships:write" }]),
      prepareAuthorizationGuard(db, {
        sql: `SELECT 1 FROM sponsorships sponsorship
          WHERE sponsorship.id = ? AND sponsorship.transition_revision = ?
            AND NOT EXISTS (
              SELECT 1 FROM payment_ledger_entries payment
              WHERE payment.purpose = 'sponsorship' AND payment.resource_type = 'sponsorship'
                AND payment.resource_id = sponsorship.id AND payment.status = 'paid'
            )`,
        bindings: [sponsorship.id, sponsorship.transition_revision],
      }),
      db
        .prepare(
          `UPDATE sponsorships SET price_amount_cents = COALESCE(price_amount_cents, ?),
            price_currency = COALESCE(price_currency, ?), transition_revision = transition_revision + 1, updated_at = ?
           WHERE id = ? AND transition_revision = ?`,
        )
        .bind(input.amount, input.currency, now, sponsorship.id, sponsorship.transition_revision),
      ...prepareOfflineLedgerStatements(db, actor, "sponsorship", "sponsorship", sponsorship.id, null, input, now),
      prepareAuditLog(
        db,
        "admin",
        actor.id,
        "sponsorship_settled_offline",
        "sponsorship",
        sponsorship.id,
        {
          amount: input.amount,
          currency: input.currency,
          method: input.method,
          reference: input.reference,
          note: input.note,
          settledAt: input.settledAt,
        },
        now,
        externalEventId(input.idempotencyKey),
      ),
    ]);
  } catch (error) {
    const raced = await existingSettlement(db, input.idempotencyKey, "sponsorship", sponsorshipId);
    if (raced) return raced;
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(
        409,
        "PAYMENT_CHANGED",
        "The sponsorship payment or your authorization changed; reload and retry",
      );
    }
    throw error;
  }

  return {
    paymentId: paymentId(input.idempotencyKey),
    purpose: "sponsorship",
    resourceId: sponsorship.id,
    status: "paid",
    amount: input.amount,
    currency: input.currency,
    method: input.method,
    settledAt: input.settledAt,
    duplicate: false,
    outboxIds: [],
  };
}
