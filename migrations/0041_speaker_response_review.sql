-- Bind a late response to the invitation generation it answered. Rotating or replacing an invitation invalidates the response.
ALTER TABLE proposal_speakers ADD COLUMN response_invite_generation INTEGER;
