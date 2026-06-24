-- Track which speaker uploaded the presentation so co-speakers can see who uploaded.
ALTER TABLE session_proposals ADD COLUMN presentation_uploaded_by_user_id TEXT REFERENCES users(id);
