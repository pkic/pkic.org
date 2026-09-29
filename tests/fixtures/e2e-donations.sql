-- Synthetic local-only records for the portal Donations browser journey.
INSERT OR IGNORE INTO donations (
  id,
  checkout_session_id,
  payment_intent_id,
  name,
  email,
  organization,
  currency,
  gross_amount,
  net_amount,
  source,
  status,
  payment_method_type,
  settled_amount,
  settled_currency,
  created_at,
  completed_at
) VALUES (
  '70000000-0000-4000-8000-000000000001',
  'cs_test_e2e_portal_donation',
  'pi_test_e2e_portal_donation',
  'E2E Donor',
  'e2e-donor@example.invalid',
  'Example Organization',
  'usd',
  2500,
  2200,
  'e2ePromo',
  'completed',
  'card',
  2200,
  'usd',
  '2026-08-28T09:00:00.000Z',
  '2026-08-28T09:01:00.000Z'
);

INSERT OR IGNORE INTO donation_promoters (
  code,
  donation_id,
  checkout_session_id,
  name,
  clicks,
  created_at
) VALUES (
  'e2ePromo',
  '70000000-0000-4000-8000-000000000001',
  'cs_test_e2e_portal_donation',
  'E2E Promoter',
  4,
  '2026-08-28T09:02:00.000Z'
);
