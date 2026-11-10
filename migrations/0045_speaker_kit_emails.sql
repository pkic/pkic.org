-- A render batch can carry the reviewed email that delivers each finished kit.
ALTER TABLE event_promotion_batches ADD COLUMN email_json TEXT CHECK(email_json IS NULL OR json_valid(email_json));
ALTER TABLE event_promotion_batch_recipients ADD COLUMN email_status TEXT;
ALTER TABLE event_promotion_batch_recipients ADD COLUMN email_outbox_id TEXT;
CREATE INDEX event_promotion_batch_email_pending ON event_promotion_batch_recipients(batch_id,occurrence_id,user_id) WHERE email_status='pending';
