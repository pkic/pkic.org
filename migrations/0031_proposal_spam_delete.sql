-- Migration 0031: Proposal spam/duplicate flagging and soft-delete
--
-- Adds a deleted_at timestamp to session_proposals for soft-delete support.
-- Spam and duplicate are handled as new values of the existing TEXT status column.

ALTER TABLE session_proposals ADD COLUMN deleted_at TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_proposals_deleted_at ON session_proposals (deleted_at) WHERE deleted_at IS NOT NULL;
