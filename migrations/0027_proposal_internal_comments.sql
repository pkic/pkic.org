CREATE TABLE proposal_internal_comments (
  id             TEXT NOT NULL PRIMARY KEY,
  proposal_id    TEXT NOT NULL,
  author_user_id TEXT NOT NULL,
  comment        TEXT NOT NULL CHECK (length(comment) >= 1 AND length(comment) <= 10000),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  FOREIGN KEY(proposal_id) REFERENCES session_proposals(id),
  FOREIGN KEY(author_user_id) REFERENCES users(id)
);

CREATE INDEX idx_proposal_internal_comments_proposal
  ON proposal_internal_comments(proposal_id, created_at);
