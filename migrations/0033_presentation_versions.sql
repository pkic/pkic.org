-- Versioned presentation uploads for proposals.
-- Each upload creates a new version row; the current version is tracked via is_current.
-- Reviews are stored per-version so the programme committee can track approval history.

CREATE TABLE presentation_versions (
  id                   TEXT PRIMARY KEY,
  proposal_id          TEXT NOT NULL REFERENCES session_proposals(id),
  version_number       INTEGER NOT NULL,
  r2_key               TEXT NOT NULL,
  file_name            TEXT,
  file_size            INTEGER,
  mime_type            TEXT,
  uploaded_by_user_id  TEXT REFERENCES users(id),
  uploaded_at          TEXT NOT NULL,
  is_current           INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0, 1)),
  deleted_at           TEXT,
  UNIQUE (proposal_id, version_number)
);

CREATE INDEX idx_presentation_versions_proposal ON presentation_versions(proposal_id);

CREATE TABLE presentation_version_reviews (
  id                   TEXT PRIMARY KEY,
  version_id           TEXT NOT NULL REFERENCES presentation_versions(id),
  reviewed_by_user_id  TEXT NOT NULL REFERENCES users(id),
  reviewed_at          TEXT NOT NULL,
  status               TEXT NOT NULL CHECK (status IN ('approved', 'rejected', 'needs_revision')),
  note                 TEXT
);

CREATE INDEX idx_presentation_version_reviews_version ON presentation_version_reviews(version_id);

-- Migrate existing presentation uploads into the new versioned table.
-- Each proposal that already has a presentation gets version 1 as the current version.
INSERT INTO presentation_versions (id, proposal_id, version_number, r2_key, uploaded_by_user_id, uploaded_at, is_current)
SELECT
  lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
  id,
  1,
  presentation_r2_key,
  presentation_uploaded_by_user_id,
  presentation_uploaded_at,
  1
FROM session_proposals
WHERE presentation_r2_key IS NOT NULL
  AND deleted_at IS NULL;

-- Drop the now-redundant columns from session_proposals.
ALTER TABLE session_proposals DROP COLUMN presentation_r2_key;
ALTER TABLE session_proposals DROP COLUMN presentation_uploaded_at;
ALTER TABLE session_proposals DROP COLUMN presentation_uploaded_by_user_id;
