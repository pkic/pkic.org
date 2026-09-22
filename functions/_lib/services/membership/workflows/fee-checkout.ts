import { signCapabilityToken } from "../../../auth/capability-token";
import { prepareAuthorizationGuard } from "../../../db/authorization-guard";
import { all, first, run } from "../../../db/queries";
import { createStripeCheckoutSession } from "../../../integrations/stripe/checkout";
import { createDurableJobLease } from "../../../jobs/lease";
import { AppError } from "../../../errors";
import type { DatabaseLike, Env } from "../../../types";
import { uuid } from "../../../utils/ids";
import { prepareQueueEmailStatement } from "../../../email/outbox";
import { DIRECT_EMAIL_TEMPLATE_KEY, directEmailBodyPayload } from "../../../email/direct-body";
import { formatCurrencyAmount } from "../../../../../assets/shared/format-currency";

interface FeeCheckoutRow {
  id: string;
  application_id: string;
  generation: number;
  category_code: string;
  version_id: string;
  fee_reference: string;
  amount: number;
  currency: string;
  deadline_at: string;
  status: string;
  applicant_email: string;
  manage_token_hash: string;
}
interface CheckoutAttempt {
  request_params: string | null;
  id: string;
  provider_session_id: string | null;
  created_at: string;
  expires_at: string;
}

/** The durable fee outbox is the sole owner of checkout retries and session renewal. */
export async function processMembershipFeeCheckouts(
  db: DatabaseLike,
  env: Env,
  appBaseUrl: string,
  limit = 5,
  fetcher?: typeof fetch,
) {
  if (!env.STRIPE_SECRET_KEY || !env.INTERNAL_SIGNING_SECRET) return { processed: 0 };
  const now = new Date().toISOString();
  const due = await all<{ fee_id: string }>(
    db,
    `SELECT fee_id FROM membership_fee_checkout_outbox
    WHERE completed_at IS NULL AND next_attempt_at <= ? AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
    ORDER BY next_attempt_at, fee_id LIMIT ?`,
    [now, now, limit],
  );
  let processed = 0;
  for (const item of due) {
    const lease = createDurableJobLease();
    const claimed = await run(
      db,
      `UPDATE membership_fee_checkout_outbox SET lease_token = ?, lease_expires_at = ?, attempts = attempts + 1
      WHERE fee_id = ? AND completed_at IS NULL AND (lease_expires_at IS NULL OR lease_expires_at <= ?)`,
      [lease.token, lease.expiresAt, item.fee_id, lease.claimedAt],
    );
    if (!claimed.changes) continue;
    try {
      const fee = await first<FeeCheckoutRow>(
        db,
        `SELECT fee.id, fee.application_id, fee.generation, fee.category_code, fee.version_id,
        fee.fee_reference, fee.amount, fee.currency, fee.deadline_at, fee.status, application.applicant_email, application.manage_token_hash
        FROM membership_fee_intents fee JOIN member_applications application ON application.id = fee.application_id
        JOIN membership_application_workflows workflow ON workflow.application_id = fee.application_id AND workflow.generation = fee.generation
        WHERE fee.id = ? AND workflow.superseded_at IS NULL AND application.stage NOT IN ('approved', 'declined', 'withdrawn')`,
        [item.fee_id],
      );
      if (!fee || fee.status !== "pending" || fee.deadline_at <= lease.claimedAt) {
        await run(
          db,
          `UPDATE membership_fee_checkout_outbox SET completed_at = ?, lease_token = NULL, lease_expires_at = NULL
          WHERE fee_id = ? AND lease_token = ?`,
          [lease.claimedAt, item.fee_id, lease.token],
        );
        continue;
      }
      let attempt = await first<CheckoutAttempt>(
        db,
        `SELECT id, provider_session_id, created_at, expires_at, request_params FROM membership_fee_checkouts
        WHERE fee_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`,
        [fee.id],
      );
      if (!attempt || attempt.expires_at <= lease.claimedAt) {
        // Stripe requires a checkout lifetime of at least 30 minutes. Near the
        // policy deadline the applicant needs staff handling instead of a link that outlives it.
        const expiresAt = new Date(
          Math.min(Date.parse(fee.deadline_at), Date.parse(lease.claimedAt) + 23 * 3600_000),
        ).toISOString();
        if (Date.parse(expiresAt) - Date.parse(lease.claimedAt) < 1800_000) {
          await run(
            db,
            `UPDATE membership_fee_checkout_outbox SET next_attempt_at = ?, lease_token = NULL, lease_expires_at = NULL
            WHERE fee_id = ? AND lease_token = ?`,
            [fee.deadline_at, fee.id, lease.token],
          );
          continue;
        }
        attempt = {
          id: uuid(),
          request_params: null,
          provider_session_id: null,
          created_at: lease.claimedAt,
          expires_at: expiresAt,
        };
        await db.batch([
          prepareAuthorizationGuard(db, {
            sql: "SELECT 1 FROM membership_fee_checkout_outbox WHERE fee_id = ? AND lease_token = ?",
            bindings: [fee.id, lease.token],
          }),
          db
            .prepare("INSERT INTO membership_fee_checkouts (id, fee_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
            .bind(attempt.id, fee.id, attempt.created_at, attempt.expires_at),
        ]);
      }
      if (!attempt.provider_session_id) {
        const token = await signCapabilityToken({
          signingSecret: env.INTERNAL_SIGNING_SECRET,
          linkSecret: `${fee.manage_token_hash}\n${fee.applicant_email}`,
          purpose: "application_status",
          resourceId: fee.application_id,
          nowSeconds: Math.floor(Date.parse(attempt.created_at) / 1000),
          ttlSeconds: Math.ceil((Date.parse(fee.deadline_at) - Date.parse(attempt.created_at)) / 1000) + 86400,
        });
        const returnUrl = `${appBaseUrl}/application-status/?id=${encodeURIComponent(fee.application_id)}&token=${encodeURIComponent(token)}`;
        const params = new URLSearchParams({
          mode: "payment",
          success_url: returnUrl,
          cancel_url: returnUrl,
          customer_email: fee.applicant_email,
          expires_at: String(Math.floor(Date.parse(attempt.expires_at) / 1000)),
          "line_items[0][price_data][currency]": fee.currency,
          "line_items[0][price_data][unit_amount]": String(fee.amount),
          "line_items[0][price_data][product_data][name]": `PKI Consortium membership fee: ${fee.fee_reference}`,
          "line_items[0][quantity]": "1",
        });
        for (const [key, value] of Object.entries({
          pkic_payment_type: "membership",
          membershipFeeId: fee.id,
          membershipCheckoutId: attempt.id,
          applicationId: fee.application_id,
          workflowVersionId: fee.version_id,
          categoryCode: fee.category_code,
          generation: String(fee.generation),
        })) {
          params.set(`metadata[${key}]`, value);
          params.set(`payment_intent_data[metadata][${key}]`, value);
        }
        // Persist the exact provider request before sending it: retries keep the same
        // idempotency key and parameters even if applicant details change meanwhile.
        if (attempt.request_params === null) {
          await db.batch([
            prepareAuthorizationGuard(db, {
              sql: "SELECT 1 FROM membership_fee_checkout_outbox WHERE fee_id = ? AND lease_token = ?",
              bindings: [fee.id, lease.token],
            }),
            db
              .prepare("UPDATE membership_fee_checkouts SET request_params = ? WHERE id = ? AND request_params IS NULL")
              .bind(params.toString(), attempt.id),
          ]);
          attempt.request_params = params.toString();
        }
        const session = await createStripeCheckoutSession(
          env.STRIPE_SECRET_KEY,
          new URLSearchParams(attempt.request_params),
          {
            idempotencyKey: `membership-fee:${attempt.id}`,
            fetcher,
            apiBase: env.STRIPE_API_BASE,
          },
        );
        if (!session.url || new URL(session.url).origin !== "https://checkout.stripe.com")
          throw new AppError(
            502,
            "MEMBERSHIP_CHECKOUT_INVALID",
            "The payment provider returned an invalid checkout link",
          );
        await db.batch([
          prepareAuthorizationGuard(db, {
            sql: "SELECT 1 FROM membership_fee_checkout_outbox WHERE fee_id = ? AND lease_token = ?",
            bindings: [fee.id, lease.token],
          }),
          prepareAuthorizationGuard(db, {
            sql: `SELECT 1 FROM membership_fee_intents fee
              JOIN member_applications application ON application.id = fee.application_id
              JOIN membership_application_workflows workflow ON workflow.application_id = fee.application_id
                AND workflow.generation = fee.generation AND workflow.superseded_at IS NULL
              WHERE fee.id = ? AND fee.status = 'pending' AND fee.deadline_at > ?
                AND application.stage NOT IN ('approved', 'declined', 'withdrawn', 'on_hold')`,
            bindings: [fee.id, new Date().toISOString()],
          }),
          db
            .prepare("UPDATE membership_fee_checkouts SET provider_session_id = ?, checkout_url = ? WHERE id = ?")
            .bind(session.id, session.url, attempt.id),
          db
            .prepare(
              "UPDATE membership_fee_intents SET checkout_session_id = ?, checkout_url = ?, updated_at = ? WHERE id = ? AND status = 'pending'",
            )
            .bind(session.id, session.url, lease.claimedAt, fee.id),
          prepareQueueEmailStatement(
            db,
            {
              outboxId: fee.id,
              idempotencyKey: `membership-fee-request:${fee.id}`,
              templateKey: DIRECT_EMAIL_TEMPLATE_KEY,
              recipientEmail: fee.applicant_email,
              messageType: "transactional",
              subject: "Payment required for your membership application",
              data: directEmailBodyPayload(
                [
                  `Your membership application is ready for its required fee of ${formatCurrencyAmount(fee.amount, fee.currency)}.`,
                  "This is a one-time application payment. It does not create a recurring subscription.",
                  `Please pay before ${fee.deadline_at}. Your application cannot proceed without the required payment.`,
                  `[View your application and pay the membership fee](${returnUrl})`,
                  "If the payment deadline passes, contact the membership team before making a payment.",
                ].join("\n\n"),
              ),
            },
            lease.claimedAt,
          ).statement,
        ]);
      }
      await run(
        db,
        `UPDATE membership_fee_checkout_outbox SET next_attempt_at = ?, last_error = NULL, lease_token = NULL, lease_expires_at = NULL
        WHERE fee_id = ? AND lease_token = ?`,
        [attempt.expires_at, fee.id, lease.token],
      );
      processed++;
    } catch {
      // Keep provider/customer data out of logs and the staff-visible error.
      await run(
        db,
        `UPDATE membership_fee_checkout_outbox SET next_attempt_at = ?, last_error = ?, lease_token = NULL, lease_expires_at = NULL
        WHERE fee_id = ? AND lease_token = ?`,
        [
          new Date(Date.now() + 300_000).toISOString(),
          "Checkout could not be prepared; an automatic retry is scheduled.",
          item.fee_id,
          lease.token,
        ],
      );
    }
  }
  return { processed };
}
