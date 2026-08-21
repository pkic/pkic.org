import type { DonationCheckoutInput } from "../../../../assets/shared/schemas/donation";
import { currencyInfo, minDonationSmallestUnits } from "../../../../assets/shared/constants/currencies";
import { createStripeCheckoutSession } from "../../integrations/stripe/checkout";
import type { DatabaseLike } from "../../types";
import { AppError } from "../../errors";
import { run } from "../../db/queries";
import { uuid } from "../../utils/ids";

const DISCLAIMER =
  "This payment is voluntary and is not a ticket, fee, or payment for goods or " +
  "services. Please consult your tax advisor regarding any possible " +
  "business-expense treatment or other tax consequences. " +
  "PKI Consortium is a section 501(c)(6) nonprofit business league. Contributions " +
  "or gifts to PKI Consortium are not deductible as charitable contributions for " +
  "federal income tax purposes in the United States.";

export interface DonationCheckoutResult {
  sessionId: string;
  url?: string;
  clientSecret?: string;
}

export async function createDonationCheckout(
  db: DatabaseLike,
  stripeSecretKey: string,
  appBaseUrl: string,
  input: DonationCheckoutInput,
): Promise<DonationCheckoutResult> {
  const info = currencyInfo(input.currency);
  const minimum = minDonationSmallestUnits(info);
  if (input.amount < minimum) {
    const formattedMinimum = `${info.symbol}${minimum / (info.zeroDecimal ? 1 : 100)}`;
    throw new AppError(
      400,
      "VALIDATION_ERROR",
      `Donation amount is below the minimum for ${input.currency.toUpperCase()} (${formattedMinimum})`,
      { fieldErrors: { amount: [`Must be at least ${formattedMinimum}`] } },
    );
  }

  const params = buildDonationCheckoutParams(appBaseUrl, input);
  const session = await createStripeCheckoutSession(stripeSecretKey, params, {
    idempotencyKey: `donation:${input.checkoutAttemptId}`,
  });
  if (input.embedded && !session.client_secret) {
    throw new AppError(502, "STRIPE_ERROR", "Stripe did not return an embedded checkout client secret");
  }
  if (!input.embedded && !session.url) {
    throw new AppError(502, "STRIPE_ERROR", "Stripe did not return a checkout URL");
  }

  // Retried client requests receive the same Stripe session because of the
  // idempotency key. The database write must therefore be idempotent too.
  await run(
    db,
    `INSERT INTO donations
       (id, checkout_session_id, name, email, organization, currency, gross_amount, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(checkout_session_id) DO NOTHING`,
    [
      uuid(),
      session.id,
      input.name,
      input.email ?? "",
      input.organizationName ?? null,
      input.currency,
      input.amount,
      input.metadata?.source ?? null,
    ],
  );

  return { sessionId: session.id, url: session.url, clientSecret: session.client_secret };
}

function buildDonationCheckoutParams(appBaseUrl: string, input: DonationCheckoutInput): URLSearchParams {
  const params = new URLSearchParams();
  params.set("mode", "payment");
  params.set("submit_type", "donate");
  params.set("line_items[0][price_data][currency]", input.currency);
  params.set("line_items[0][price_data][unit_amount]", String(input.amount));
  params.set("line_items[0][price_data][product_data][name]", "Voluntary Donation to PKI Consortium, Inc.");
  params.set("line_items[0][price_data][product_data][description]", DISCLAIMER);
  params.set("line_items[0][quantity]", "1");
  params.set("payment_intent_data[description]", DISCLAIMER);
  params.set("payment_intent_data[statement_descriptor]", "PKIC DONATION");
  params.set("custom_text[submit][message]", DISCLAIMER);

  if (input.embedded) {
    params.set("ui_mode", "embedded");
    params.set(
      "return_url",
      `${appBaseUrl}${input.successPath ?? "/donate/complete/"}?session_id={CHECKOUT_SESSION_ID}`,
    );
  } else {
    params.set(
      "success_url",
      `${appBaseUrl}${input.successPath ?? "/donate/complete/"}?session_id={CHECKOUT_SESSION_ID}`,
    );
    params.set("cancel_url", `${appBaseUrl}${input.cancelPath ?? "/donate/"}`);
  }

  if (input.email) {
    params.set("customer_email", input.email);
    params.set("payment_intent_data[receipt_email]", input.email);
  }
  params.set("metadata[donor_name]", input.name);
  params.set("payment_intent_data[metadata][donor_name]", input.name);
  if (input.email) params.set("metadata[donor_email]", input.email);
  if (input.email) params.set("payment_intent_data[metadata][donor_email]", input.email);
  if (input.organizationName) params.set("metadata[donor_organization]", input.organizationName);
  if (input.organizationName) {
    params.set("payment_intent_data[metadata][donor_organization]", input.organizationName);
  }
  if (input.metadata?.source) params.set("metadata[source]", input.metadata.source);
  if (input.metadata?.source) params.set("payment_intent_data[metadata][source]", input.metadata.source);
  return params;
}
