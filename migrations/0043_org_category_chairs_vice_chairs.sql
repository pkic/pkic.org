-- Migration 0043: WG/forum vice chairs
--
-- Resolves two of the three gaps originally found during hands-on testing
-- (issues-to-resolve.md) — the third (an organization-level membership
-- category column) is superseded by migration 0037's
-- member_category_assignments table, which is the sole source of truth for
-- an aggregate's category from day one; there is no organizations.
-- membership_category column to add or backfill here.
--
-- 1. Working groups had no vice-chair concept — `wg_chair` is a single
--    system role assigned via `user_roles` (context_type='working_group'),
--    with no parallel for a vice chair. `role-wg_vice_chair` is seeded here
--    with the same permission bundle as `role-wg_chair` (a vice chair
--    should be able to fully stand in for the chair), reusing the exact
--    same user_roles mechanism — no new column or context_type needed.
--
-- 2. There was no PKIC-wide (forum-level) chair/vice-chair concept at all.
--    `role-forum_chair` / `role-forum_vice_chair` are seeded as global
--    roles (assigned with context_type/context_id both NULL, same as
--    role-admin/role-member) since there is only ever one forum. Neither
--    grants new permissions — the value of the role is the designation
--    itself (who holds the title), the same way `users.is_ec_member`
--    (migration 0041) is a pure designation with no permission bundle.

INSERT INTO roles (id, name, description, is_system_role, created_at, updated_at) VALUES
  ('role-wg_vice_chair', 'wg_vice_chair', 'WG-scoped (assigned per WG) - stands in for the chair', 1, datetime('now'), datetime('now')),
  ('role-forum_chair', 'forum_chair', 'PKIC forum chair (global designation, no per-instance context)', 1, datetime('now'), datetime('now')),
  ('role-forum_vice_chair', 'forum_vice_chair', 'PKIC forum vice chair (global designation, no per-instance context)', 1, datetime('now'), datetime('now'));

INSERT INTO role_permissions (id, role_id, permission, created_at) VALUES
  (lower(hex(randomblob(16))), 'role-wg_vice_chair', 'working-groups:write', datetime('now')),
  (lower(hex(randomblob(16))), 'role-wg_vice_chair', 'votes:create', datetime('now')),
  (lower(hex(randomblob(16))), 'role-wg_vice_chair', 'votes:manage', datetime('now'));
