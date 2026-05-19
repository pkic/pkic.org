-- Canonicalize proposal status to kebab-case (needs-work instead of needs_work).
-- Add new columns, backfill, drop old, rename new to old name.

-- Drop index before dropping column
DROP INDEX IF EXISTS idx_proposals_event_status;

-- proposal_decisions
ALTER TABLE proposal_decisions ADD COLUMN final_status_new TEXT;
UPDATE proposal_decisions
SET final_status_new = CASE
  WHEN final_status = 'needs_work' THEN 'needs-work'
  ELSE final_status
END;
ALTER TABLE proposal_decisions DROP COLUMN final_status;
ALTER TABLE proposal_decisions RENAME COLUMN final_status_new TO final_status;

-- session_proposals
ALTER TABLE session_proposals ADD COLUMN status_new TEXT;
UPDATE session_proposals
SET status_new = CASE
  WHEN status = 'needs_work' THEN 'needs-work'
  ELSE status
END;
ALTER TABLE session_proposals DROP COLUMN status;
ALTER TABLE session_proposals RENAME COLUMN status_new TO status;

-- Recreate index on renamed column
CREATE INDEX idx_proposals_event_status ON session_proposals(event_id, status);
