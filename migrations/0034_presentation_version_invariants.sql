-- Migration 0033 is already applied in production, so add the current-version
-- invariant in a follow-up migration that all environments will execute.
CREATE UNIQUE INDEX idx_presentation_versions_one_current
  ON presentation_versions(proposal_id)
  WHERE is_current = 1 AND deleted_at IS NULL;
