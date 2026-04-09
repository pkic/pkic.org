-- Add indexes to audit_log to make per-entity and per-actor queries fast.
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log (entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log (actor_type, actor_id, created_at DESC);
