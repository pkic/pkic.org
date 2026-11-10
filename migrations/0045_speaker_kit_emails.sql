-- A render batch can email each finished kit with the message of the campaign that requested it.
ALTER TABLE event_promotion_batches ADD COLUMN email_campaign_id TEXT REFERENCES event_email_campaigns(id) ON DELETE SET NULL;
ALTER TABLE event_promotion_batches ADD COLUMN email_test INTEGER NOT NULL DEFAULT 0;
-- pending until the kit is rendered, then queued (handed to the outbox) or failed.
ALTER TABLE event_promotion_batch_recipients ADD COLUMN email_status TEXT;
CREATE INDEX event_promotion_batch_email_pending ON event_promotion_batch_recipients(batch_id,occurrence_id,user_id) WHERE email_status='pending';
CREATE INDEX event_promotion_batch_email_queued ON event_promotion_batch_recipients(occurrence_id,user_id) WHERE email_status='queued';
CREATE INDEX event_promotion_batches_email_campaign ON event_promotion_batches(email_campaign_id) WHERE email_campaign_id IS NOT NULL;
