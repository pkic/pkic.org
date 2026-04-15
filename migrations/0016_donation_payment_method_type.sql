-- Migration 0016: Store the Stripe payment method type and session expiry on donations
--
-- When checkout.session.completed fires with payment_status='unpaid' (bank
-- transfer, ACH, SEPA, etc.) Stripe tells us which payment method was used via
-- session.payment_method_types[0] and when the payment window closes via
-- session.expires_at (Unix timestamp).  We store both so we can:
--   1. Show an expected settlement window in the admin portal.
--   2. Surface a more specific message on the thank-you page.
--   3. Show the donor a "must be received by" deadline.
--   4. Cap front-end polling to the remaining expiry window.
--
-- Examples: sepa_debit, ach_debit, us_bank_account, bacs_debit, customer_balance,
--           oxxo, boleto, konbini, multibanco.
-- NULL for card/wallet payments (confirmed immediately).

ALTER TABLE donations ADD COLUMN payment_method_type TEXT;
ALTER TABLE donations ADD COLUMN session_expires_at  INTEGER;

