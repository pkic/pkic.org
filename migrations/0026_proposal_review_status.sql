ALTER TABLE proposal_reviews ADD COLUMN status TEXT NOT NULL DEFAULT 'submitted';
ALTER TABLE proposal_reviews ADD COLUMN submitted_at TEXT;

UPDATE proposal_reviews
SET submitted_at = COALESCE(updated_at, created_at)
WHERE status = 'submitted';

CREATE INDEX idx_proposal_reviews_proposal_status ON proposal_reviews(proposal_id, status);