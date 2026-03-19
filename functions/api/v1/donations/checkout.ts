/**
 * POST /api/v1/donations/checkout
 *
 * Creates a Stripe Checkout Session for a voluntary donation and returns the
 * session URL for client-side redirect. Uses the Stripe REST API directly
 * (no SDK) to keep the bundle lightweight — only one API call is needed.
 *
 * The session is configured with `submit_type=donate` so the Stripe-hosted
 * page shows "Donate $X" instead of "Pay $X". The line item description and
 * custom text both carry the required non-profit disclaimer.
 *
 * A pending donation record is inserted into D1 immediately so we have donor
 * identity for tax purposes even if the webhook fires before the redirect.
 * The webhook (checkout.session.completed) fills in net_amount + completed_at.
 */

import { resolveAppBaseUrl } from "../../../_lib/config";
import { AppError } from "../../../_lib/errors";
import { json, markSensitive } from "../../../_lib/http";
import { logError } from "../../../_lib/logging";
import type { PagesContext } from "../../../_lib/types";
import { donationCheckoutSchema } from "../../../../assets/shared/schemas/donation";

const DISCLAIMER =
  "This payment is voluntary and is not a ticket, fee, or payment for goods or " +
  "services. Please consult your tax advisor regarding any possible " +
  "business-expense treatment or other tax consequences. " +
  "PKI Consortium is a section 501(c)(6) nonprofit business league. Contributions " +
  "or gifts to PKI Consortium are not deductible as charitable contributions for " +
  "federal income tax purposes in the United States.";

const STRIPE_API = "https://api.stripe.com/v1/checkout/sessions";

/**
 * Returns true when the request origin matches the configured app base URL.
 * resolveAppBaseUrl covers production (APP_BASE_URL), Cloudflare Pages preview
 * deploys (CF_PAGES_URL → *.pkic.pages.dev), and local dev (localhost:8788).
 */
function isAllowedOrigin(origin: string, appBaseUrl: string): boolean {
  return origin === appBaseUrl;
}

export async function onRequestPost(context: PagesContext): Promise<Response> {
  markSensitive(context);

  const { request, env } = context;
  const appBaseUrl = resolveAppBaseUrl(env);

  // ── Origin guard ─────────────────────────────────────────────────────────
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite !== null && secFetchSite !== "same-origin" && secFetchSite !== "none") {
    logError("DONATION_CHECKOUT_CROSS_ORIGIN_BLOCKED", {
      reason: "sec-fetch-site",
      secFetchSite,
      origin: request.headers.get("origin"),
      appBaseUrl,
    });
    throw new AppError(403, "FORBIDDEN", "Cross-origin requests are not allowed");
  }
  const origin = request.headers.get("origin");
  if (origin !== null && !isAllowedOrigin(origin, appBaseUrl)) {
    logError("DONATION_CHECKOUT_CROSS_ORIGIN_BLOCKED", {
      reason: "origin",
      secFetchSite,
      origin,
      appBaseUrl,
    });
    throw new AppError(403, "FORBIDDEN", "Cross-origin requests are not allowed");
  }

  // ── Verify Stripe is configured ──────────────────────────────────────────
  if (!env.STRIPE_SECRET_KEY) {
    throw new AppError(503, "SERVICE_UNAVAILABLE", "Donation processing is not configured");
  }

  // ── Parse & validate ─────────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new AppError(400, "INVALID_JSON", "Request body must be valid JSON");
  }

  const parsed = donationCheckoutSchema.safeParse(body);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join(".");
      if (!fieldErrors[key]) fieldErrors[key] = [];
      fieldErrors[key].push(issue.message);
    }
    throw new AppError(400, "VALIDATION_ERROR", "Invalid donation parameters", { fieldErrors });
  }

  const { amount, currency, name, email, organizationName, successPath, cancelPath, metadata, embedded } = parsed.data;

  // ── Build redirect URLs ──────────────────────────────────────────────────
  const baseUrl = appBaseUrl;
  // {CHECKOUT_SESSION_ID} is replaced by Stripe with the real session ID —
  // the thank-you page reads it to show the correct badge amount.

  // ── Build Stripe Checkout Session params ──────────────────────────────────
  const params = new URLSearchParams();
  params.set("mode", "payment");
  params.set("submit_type", "donate");
  params.set("line_items[0][price_data][currency]", currency);
  params.set("line_items[0][price_data][unit_amount]", String(amount));
  params.set("line_items[0][price_data][product_data][name]", "Voluntary Donation to PKI Consortium, Inc.");
  params.set("line_items[0][price_data][product_data][description]", DISCLAIMER);
  params.set("line_items[0][quantity]", "1");
  params.set("payment_intent_data[description]", DISCLAIMER);
  params.set("payment_intent_data[statement_descriptor]", "PKIC DONATION");
  params.set("custom_text[submit][message]", DISCLAIMER);

  if (embedded) {
    // Embedded Checkout: single return_url, no separate cancel URL.
    const returnUrl = `${baseUrl}${successPath ?? "/donate/complete/"}?session_id={CHECKOUT_SESSION_ID}`;
    params.set("ui_mode", "embedded");
    params.set("return_url", returnUrl);
  } else {
    const successUrl = `${baseUrl}${successPath ?? "/donate/complete/"}?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${baseUrl}${cancelPath ?? "/donate/"}`;
    params.set("success_url", successUrl);
    params.set("cancel_url", cancelUrl);
  }

  if (email) {
    params.set("customer_email", email);
    params.set("payment_intent_data[receipt_email]", email);
  }

  // Store donor identity and attribution in Stripe metadata for reconciliation
  params.set("metadata[donor_name]", name);
  if (email) params.set("metadata[donor_email]", email);
  if (organizationName) params.set("metadata[donor_organization]", organizationName);
  if (metadata?.source) params.set("metadata[source]", metadata.source);

  // ── Call Stripe API ──────────────────────────────────────────────────────
  const stripeResponse = await fetch(STRIPE_API, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!stripeResponse.ok) {
    const errBody = await stripeResponse.text();
    console.error("Stripe API error:", stripeResponse.status, errBody);
    throw new AppError(502, "STRIPE_ERROR", "Failed to create donation session");
  }

  const session = (await stripeResponse.json()) as { id: string; url?: string; client_secret?: string };

  if (embedded) {
    if (!session.client_secret || !session.id) {
      throw new AppError(502, "STRIPE_ERROR", "Stripe did not return an embedded checkout client secret");
    }
  } else {
    if (!session.url || !session.id) {
      throw new AppError(502, "STRIPE_ERROR", "Stripe did not return a checkout URL");
    }
  }

  // ── Insert pending donation record ────────────────────────────────────────
  // This gives us donor identity for tax records before the webhook fires.
  // net_amount and completed_at are filled in by the webhook handler.
  // checkout_session_id is processor-agnostic; for Stripe this is cs_live_…
  const donationId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO donations
       (id, checkout_session_id, name, email, organization,
        currency, gross_amount, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      donationId,
      session.id,
      name,
      email ?? null,
      organizationName ?? null,
      currency,
      amount,
      metadata?.source ?? null,
    )
    .run();

  if (embedded) {
    return json({ clientSecret: session.client_secret, publishableKey: env.STRIPE_PUBLISHABLE_KEY ?? "" });
  }
  return json({ url: session.url });
}

