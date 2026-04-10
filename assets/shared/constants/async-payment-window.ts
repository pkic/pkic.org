/**
 * asyncPaymentWindow
 *
 * Maps a Stripe payment method type to a human-readable display label.
 * Used on the thank-you page and in the admin portal.
 *
 * Settlement windows are NOT hardcoded here because Stripe exposes the actual
 * deadline via session.expires_at — that Unix timestamp is stored in
 * donations.session_expires_at and is used as the authoritative deadline.
 *
 * MAINTENANCE NOTES
 * -----------------
 * Add an entry to LABEL_MAP when:
 *   a) A new Stripe payment method type string is introduced AND
 *   b) labelFromKey() would produce wrong casing (e.g. "ideal" → "Ideal" not "iDEAL")
 *      OR the display label differs significantly from the snake_case name.
 *
 * Unknown types fall back to labelFromKey() (e.g. "new_method" → "New Method"),
 * so nothing breaks when Stripe expands their catalogue.
 *
 * SCOPE: only methods that can produce payment_status='unpaid' on a Checkout
 * Session are relevant here.  Bank redirects (iDEAL, Bancontact, EPS, P24,
 * Wero, TWINT, …) confirm synchronously via redirect and will never reach the
 * awaiting_payment path — but they are listed below so their labels are correct
 * if they somehow appear in a future async context.
 */

export interface PaymentMethodInfo {
  /** Short display name, e.g. "SEPA Direct Debit" */
  label: string;
}

const LABEL_MAP: Record<string, string> = {
  // ── Bank debits (always async — settlement 1–5 business days) ─────────────
  sepa_debit:       "SEPA Direct Debit",
  ach_debit:        "ACH Direct Debit",
  us_bank_account:  "ACH Bank Transfer",
  bacs_debit:       "Bacs Direct Debit",
  acss_debit:       "ACSS Direct Debit",
  au_becs_debit:    "AU BECS Direct Debit",
  nz_becs_debit:    "NZ BECS Direct Debit",

  // ── Bank transfers (always async — customer_balance covers all regions) ────
  customer_balance: "Bank Transfer",

  // ── Vouchers (customer pays in-store — async by nature) ───────────────────
  oxxo:             "OXXO",
  boleto:           "Boleto",
  konbini:          "Konbini",
  multibanco:       "Multibanco",

  // ── Bank redirects (synchronous via redirect, but listed for correct labels)
  ideal:            "iDEAL",          // labelFromKey → "Ideal" (wrong casing)
  bancontact:       "Bancontact",
  eps:              "EPS",            // labelFromKey → "Eps"
  p24:              "Przelewy24",     // labelFromKey → "P24" (not the brand name)
  giropay:          "Giropay",
  sofort:           "Sofort",
  fpx:              "FPX",            // labelFromKey → "Fpx"
  blik:             "BLIK",           // labelFromKey → "Blik"
  twint:            "TWINT",          // labelFromKey → "Twint"
  wero:             "Wero",
  upi:              "UPI",            // labelFromKey → "Upi"

  // ── Real-time / wallet (mostly instant, but some regions have async paths) ─
  paynow:           "PayNow",         // labelFromKey → "Paynow"
  promptpay:        "PromptPay",      // labelFromKey → "Promptpay"
  pix:              "Pix",
  payto:            "PayTo",          // labelFromKey → "Payto"
  swish:            "Swish",
  wechat_pay:       "WeChat Pay",     // labelFromKey → "Wechat Pay"
};

/** Converts "some_payment_method" → "Some Payment Method" */
function labelFromKey(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Returns display info for the given Stripe payment method type.
 * Falls back to an auto-formatted label for unknown/future types.
 */
export function asyncPaymentWindow(methodType: string | null | undefined): PaymentMethodInfo {
  if (methodType) {
    return { label: LABEL_MAP[methodType] ?? labelFromKey(methodType) };
  }
  return { label: "Bank / delayed payment" };
}
