-- Migration 0005: Add status column to donations table
--
-- Adds an explicit status field so expired/failed Stripe sessions can be
-- distinguished from genuinely pending ones. This avoids having to infer
-- state from the absence of completed_at alone.
--
-- Values:
--   pending   — checkout created, webhook not yet received
--   completed — checkout.session.completed webhook processed
--   expired   — checkout.session.expired webhook processed (no payment)
--
-- Existing rows are set to 'completed' where completed_at IS NOT NULL,
-- otherwise 'pending'.

ALTER TABLE donations ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';

UPDATE donations SET status = 'completed' WHERE completed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_donations_status ON donations (status);
