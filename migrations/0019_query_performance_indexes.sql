-- Add indexes to support correlated subqueries that run per-row on the admin registrations list.

-- Supports the has_bounced EXISTS check:
--   EXISTS (SELECT 1 FROM email_outbox eo
--           WHERE eo.recipient_user_id = r.user_id AND eo.event_id = r.event_id AND eo.status = 'bounced')
-- The existing idx_email_outbox_status_send_after index is not useful here.
CREATE INDEX idx_email_outbox_user_event_status
  ON email_outbox(recipient_user_id, event_id, status);

-- Supports the LEFT JOIN for referral codes:
--   LEFT JOIN referral_codes rc ON rc.owner_type = 'registration' AND rc.owner_id = r.id
-- The existing idx_referral_codes_event index is not useful here.
CREATE INDEX idx_referral_codes_owner
  ON referral_codes(owner_type, owner_id);
