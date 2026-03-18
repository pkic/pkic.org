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

import { AppError } from "../../../_lib/errors";
import { json, markSensitive } from "../../../_lib/http";
import type { PagesContext } from "../../../_lib/types";
import { donationCheckoutSchema } from "../../../../shared/schemas/donation";

const DISCLAIMER =
  "The PKI Consortium is a 501(c)(6) non-profit business league registered " +
  "in Utah, USA (#10462204-0140). This is a voluntary donation — no goods " +
  "or services are provided in exchange. Please consult your tax advisor " +
  "regarding deductibility in your jurisdiction.";

const STRIPE_API = "https://api.stripe.com/v1/checkout/sessions";

const ALLOWED_ORIGINS = new Set([
  "https://pkic.org",
  "https://www.pkic.org",
  "http://localhost:8788",
  "http://localhost:1313",
]);

/** Returns true for exact known origins and *.pkic.pages.dev preview deploys. */
function isAllowedOrigin(origin: string): boolean {
  if (ALLOWED_ORIGINS.has(origin)) return true;
  // Allow Cloudflare Pages preview deployments
  try {
    const { hostname, protocol } = new URL(origin);
    return protocol === "https:" && /^[a-z0-9-]+\.pkic\.pages\.dev$/.test(hostname);
  } catch {
    return false;
  }
}

export async function onRequestPost(context: PagesContext): Promise<Response> {
  markSensitive(context);

  const { request, env } = context;

  // ── Origin guard ─────────────────────────────────────────────────────────
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite !== null && secFetchSite !== "same-origin" && secFetchSite !== "none") {
    throw new AppError(403, "FORBIDDEN", "Cross-origin requests are not allowed");
  }
  const origin = request.headers.get("origin");
  if (origin !== null && !isAllowedOrigin(origin)) {
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

  const { amount, currency, name, email, organizationName, successPath, cancelPath, metadata } = parsed.data;

  // ── Build redirect URLs ──────────────────────────────────────────────────
  const baseUrl = (env.APP_BASE_URL || env.CF_PAGES_URL || "https://pkic.org").replace(/\/$/, "");
  // {CHECKOUT_SESSION_ID} is replaced by Stripe with the real session ID —
  // the thank-you page reads it to show the correct badge amount.
  const successUrl = `${baseUrl}${successPath ?? "/donate/thank-you/"}?session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${baseUrl}${cancelPath ?? "/donate/"}`;

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
  params.set("success_url", successUrl);
  params.set("cancel_url", cancelUrl);

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

  const session = (await stripeResponse.json()) as { id: string; url: string };
  if (!session.url || !session.id) {
    throw new AppError(502, "STRIPE_ERROR", "Stripe did not return a checkout URL");
  }

  // ── Insert pending donation record ────────────────────────────────────────
  // This gives us donor identity for tax records before the webhook fires.
  // net_amount and completed_at are filled in by the webhook handler.
  // checkout_session_id is processor-agnostic; for Stripe this is cs_live_…
  const donationId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO donations
       (id, checkout_session_id, donor_name, donor_email, donor_organization,
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

  return json({ url: session.url });
}

