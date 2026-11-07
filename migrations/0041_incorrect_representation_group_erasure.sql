-- Transaction-local evidence for the explicit incorrect-representation removal use case.
-- Successful commands clear their marker; a failed batch rolls it back.
-- There is deliberately no identity FK: the marker survives the identity DELETE
-- just long enough for the guarded audit INSERT to read the pre-erasure snapshot.
CREATE TABLE group_membership_erasures (
  identity_id TEXT NOT NULL PRIMARY KEY,
  created_at TEXT NOT NULL,
  erased_seats_json TEXT NOT NULL
);

DROP TRIGGER trg_group_memberships_prevent_delete;
CREATE TRIGGER trg_group_memberships_prevent_delete
BEFORE DELETE ON group_memberships
WHEN NOT EXISTS (
  SELECT 1 FROM group_membership_erasures erasure WHERE erasure.identity_id = OLD.identity_id
)
BEGIN
  SELECT RAISE(ABORT, 'group memberships must be ended, not deleted');
END;
