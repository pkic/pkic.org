-- Migration 0040: Organization-level membership category + WG/forum vice chairs
--
-- Resolves three gaps found during hands-on testing (issues-to-resolve.md)
-- and reconciled against the PRD:
--
-- 1. Membership category was only ever a per-representative attribute
--    (`members.member_type`, PRD §0.1/migration 0033) — nothing enforced
--    that every representative of the same organization shared a category,
--    even though category is fundamentally an organization-level fact.
--    `organizations.membership_category` is added here as the new source
--    of truth for org-tied categories (A-G, H1-H4, H8). `members.member_type`
--    is left in place and keeps being the source of truth for the org-less
--    individual categories (H5/H6/H7), which have no organization_id to
--    hang a category off.
--
--    Backfill policy (confirmed with the user): each organization's new
--    `membership_category` is set from its `primary_contact_user_id`'s
--    current `members.member_type`; organizations with no primary contact
--    (or whose primary contact has no members row) fall back to the most
--    common `member_type` among their representatives.
--
-- 2. Working groups had no vice-chair concept — `wg_chair` is a single
--    system role assigned via `user_roles` (context_type='working_group'),
--    with no parallel for a vice chair. `role-wg_vice_chair` is seeded here
--    with the same permission bundle as `role-wg_chair` (a vice chair
--    should be able to fully stand in for the chair), reusing the exact
--    same user_roles mechanism — no new column or context_type needed.
--
-- 3. There was no PKIC-wide (forum-level) chair/vice-chair concept at all.
--    `role-forum_chair` / `role-forum_vice_chair` are seeded as global
--    roles (assigned with context_type/context_id both NULL, same as
--    role-admin/role-member) since there is only ever one forum. Neither
--    grants new permissions — the value of the role is the designation
--    itself (who holds the title), the same way `users.is_ec_member`
--    (migration 0038) is a pure designation with no permission bundle.

ALTER TABLE organizations ADD COLUMN membership_category TEXT;

-- Backfill from each org's primary contact, where that contact has a
-- members row.
UPDATE organizations
SET membership_category = (
  SELECT m.member_type
  FROM members m
  WHERE m.user_id = organizations.primary_contact_user_id
)
WHERE primary_contact_user_id IS NOT NULL
  AND membership_category IS NULL
  AND EXISTS (
    SELECT 1 FROM members m WHERE m.user_id = organizations.primary_contact_user_id
  );

-- Fallback: most common member_type among the org's representatives, for
-- any organization still NULL (no primary contact set, or primary contact
-- has no members row).
UPDATE organizations
SET membership_category = (
  SELECT m.member_type
  FROM members m
  WHERE m.organization_id = organizations.id
  GROUP BY m.member_type
  ORDER BY COUNT(*) DESC, m.member_type ASC
  LIMIT 1
)
WHERE membership_category IS NULL
  AND EXISTS (SELECT 1 FROM members m WHERE m.organization_id = organizations.id);

INSERT INTO roles (id, name, description, is_system_role, created_at, updated_at) VALUES
  ('role-wg_vice_chair', 'wg_vice_chair', 'WG-scoped (assigned per WG) - stands in for the chair', 1, datetime('now'), datetime('now')),
  ('role-forum_chair', 'forum_chair', 'PKIC forum chair (global designation, no per-instance context)', 1, datetime('now'), datetime('now')),
  ('role-forum_vice_chair', 'forum_vice_chair', 'PKIC forum vice chair (global designation, no per-instance context)', 1, datetime('now'), datetime('now'));

INSERT INTO role_permissions (id, role_id, permission, created_at) VALUES
  (lower(hex(randomblob(16))), 'role-wg_vice_chair', 'working-groups:write', datetime('now')),
  (lower(hex(randomblob(16))), 'role-wg_vice_chair', 'votes:create', datetime('now')),
  (lower(hex(randomblob(16))), 'role-wg_vice_chair', 'votes:manage', datetime('now'));
