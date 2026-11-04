-- A proposer's unsubmitted changes to a proposal the program committee sent back.
-- Kept apart from the reviewed columns so reviewers never read a draft; a resubmission
-- moves it into those columns and clears it.
ALTER TABLE session_proposals ADD COLUMN revision_draft_json TEXT
 CHECK(revision_draft_json IS NULL OR json_valid(revision_draft_json));
