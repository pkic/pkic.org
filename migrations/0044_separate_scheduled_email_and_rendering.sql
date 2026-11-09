-- Dedicated queue entries keep delivery independent of reminder and rendering failures.
INSERT INTO scheduled_jobs (job_key, interval_seconds, next_run_at) VALUES
  ('email_outbox', 60, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ('promotion_rendering', 60, strftime('%Y-%m-%dT%H:%M:%fZ','now'));
