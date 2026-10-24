-- Keep current kit progress bounded independently of completed or obsolete render history.
ALTER TABLE event_promotion_renders ADD COLUMN requested_at TEXT;
CREATE INDEX event_promotion_render_requested ON event_promotion_renders(event_id,user_id,occurrence_id,format,requested_at DESC);
