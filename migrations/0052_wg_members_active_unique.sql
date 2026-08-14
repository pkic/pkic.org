-- Enforces "at most one active working-group membership per (working_group,
-- user)" as a D1 invariant, not just an application-level check-then-insert
-- (flagged in PR #1 review: "Application checks alone are not a substitute
-- for a database invariant, especially when several services can add
-- memberships"). Partial on `left_at IS NULL` so a user can rejoin after
-- leaving — only concurrently-active memberships are constrained.

-- Defensive cleanup first: if the application-level check-then-insert ever
-- raced and produced duplicate active rows, close all but the
-- earliest-joined one so the new unique index below can actually be
-- created. A no-op on any (working_group_id, user_id) pair with 0 or 1
-- active rows.
UPDATE working_group_members
SET left_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE left_at IS NULL
  AND id IN (
    SELECT id FROM (
      SELECT id,
             ROW_NUMBER() OVER (PARTITION BY working_group_id, user_id ORDER BY joined_at ASC, id ASC) AS rn
      FROM working_group_members
      WHERE left_at IS NULL
    )
    WHERE rn > 1
  );

CREATE UNIQUE INDEX idx_wg_members_active_unique ON working_group_members(working_group_id, user_id) WHERE left_at IS NULL;
