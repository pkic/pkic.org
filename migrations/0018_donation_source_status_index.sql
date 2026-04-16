-- Composite index to efficiently support the promoters query which filters
-- and groups on both `source` and `status = 'completed'` simultaneously.
-- Previously only a single-column index on `source` existed, requiring SQLite
-- to re-scan all matching source rows to apply the status filter.
-- The composite index also supersedes the single-column index, which is dropped.
CREATE INDEX IF NOT EXISTS idx_donations_source_status
  ON donations (source, status);

DROP INDEX IF EXISTS idx_donations_source;
