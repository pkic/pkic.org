-- Migration 0035: Phase 2 — Fine-Grained Access Control (PRD §2)
--
-- Adds the roles/user_roles/permission_grants/refresh_tokens model from
-- §2.3, seeds the built-in roles from §2.2, and executes the §0.2 and §0.4
-- backfills (event_permissions → user_roles, users.role='admin' →
-- user_roles), then drops event_permissions per §0.2's resolution.
--
-- Two deviations from the PRD's literal schema, both documented in full in
-- "Phase 2 — Implementation Status" below the Phase 2 section of this
-- document:
--
-- 1. `role_permissions` is a new table, not present anywhere in §2.3. §2.2
--    describes each built-in role's default permission bundle in prose only
--    and says bundles must be admin-customizable ("their permission bundles
--    can be customized by an admin as the portal evolves") — that requires
--    somewhere to actually store and edit the bundle. This is the same
--    class of gap as Phase 0 findings #16/#17 (a workflow described in
--    prose with no backing table).
--
-- 2. `user_roles.user_id` is nullable here (with a parallel `user_email`
--    column), not NOT NULL as shown in §2.3's SQL sketch. §0.2's own
--    resolution text requires the opposite of what §2.3's SQL says: it
--    requires the new model to "preserve this pre-provisioning behavior,
--    since event organizers/PC members are often granted access before
--    their first login" — exactly the nullable-user_id + user_email pattern
--    `event_permissions` already used. A NOT NULL user_id makes that
--    impossible, so the nullable form (matching event_permissions, which
--    this migration backfills from) is what's implemented.
--
-- `permission_grants` and `refresh_tokens` are created exactly as specified
-- in §2.3.

CREATE TABLE roles (
  id             TEXT    NOT NULL PRIMARY KEY,
  name           TEXT    NOT NULL UNIQUE,
  description    TEXT,
  is_system_role INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT    NOT NULL,
  updated_at     TEXT    NOT NULL
);

CREATE TABLE role_permissions (
  id         TEXT NOT NULL PRIMARY KEY,
  role_id    TEXT NOT NULL,
  permission TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(role_id, permission),
  FOREIGN KEY(role_id) REFERENCES roles(id)
);

CREATE TABLE user_roles (
  id                 TEXT NOT NULL PRIMARY KEY,
  user_id            TEXT,
  user_email         TEXT,
  role_id            TEXT NOT NULL,
  context_type       TEXT,
  -- allowed: 'event' | 'working_group' | NULL (global)
  context_id         TEXT,
  granted_by_user_id TEXT,
  expires_at         TEXT,
  revoked_at         TEXT,
  created_at         TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(role_id) REFERENCES roles(id),
  FOREIGN KEY(granted_by_user_id) REFERENCES users(id)
);

CREATE INDEX idx_user_roles_user ON user_roles(user_id);
CREATE INDEX idx_user_roles_email ON user_roles(user_email);
CREATE INDEX idx_user_roles_context ON user_roles(context_type, context_id);
CREATE INDEX idx_user_roles_role ON user_roles(role_id);

CREATE TABLE permission_grants (
  id                 TEXT NOT NULL PRIMARY KEY,
  user_id            TEXT NOT NULL,
  permission         TEXT NOT NULL,
  context_type       TEXT,
  context_id         TEXT,
  granted_by_user_id TEXT,
  expires_at         TEXT,
  revoked_at         TEXT,
  created_at         TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(granted_by_user_id) REFERENCES users(id)
);

CREATE INDEX idx_permission_grants_user ON permission_grants(user_id);
CREATE INDEX idx_permission_grants_context ON permission_grants(context_type, context_id);

CREATE TABLE refresh_tokens (
  id           TEXT NOT NULL PRIMARY KEY,
  user_id      TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  issued_at    TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  revoked_at   TEXT,
  last_used_at TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- ── Built-in system roles (§2.2) ────────────────────────────────────────────
--
-- Fixed, human-readable primary keys (not randomblob) so this migration can
-- reference them across statements — plain SQL has no scripting/variables.
--
-- Two roles beyond §2.2's table are seeded here: `event_moderator` and
-- `event_volunteer`. They exist solely so the event_permissions backfill
-- below is lossless — the old `moderator` and `volunteer` event_permissions
-- values have no equivalent in §2.2's built-in role list, and silently
-- dropping them during migration would be a data-loss regression the same
-- way Phase 0 finding #13 (sponsors/sponsor_events) called out. `moderator`
-- functionally granted proposal review (not finalize) under the old
-- REVIEW_PERMISSIONS set in proposal-access.ts; `volunteer` granted no
-- functional capability in the old code at all, so it is preserved as a
-- record with an empty permission bundle.

INSERT INTO roles (id, name, description, is_system_role, created_at, updated_at) VALUES
  ('role-admin', 'admin', 'Full access', 1, datetime('now'), datetime('now')),
  ('role-membership_processor', 'membership_processor', 'Membership workflow only', 1, datetime('now'), datetime('now')),
  ('role-wg_chair', 'wg_chair', 'WG-scoped (assigned per WG)', 1, datetime('now'), datetime('now')),
  ('role-event_organizer', 'event_organizer', 'Full management of a specific event', 1, datetime('now'), datetime('now')),
  ('role-program_committee', 'program_committee', 'Proposal review and agenda setting for a specific event', 1, datetime('now'), datetime('now')),
  ('role-member', 'member', 'Authenticated PKIC member (A-G)', 1, datetime('now'), datetime('now')),
  ('role-interested_parties', 'interested_parties', 'Authenticated PKIC member (H) - no voting rights', 1, datetime('now'), datetime('now')),
  ('role-event_moderator', 'event_moderator', 'Event-scoped proposal review, no finalize (backfilled from event_permissions.moderator)', 1, datetime('now'), datetime('now')),
  ('role-event_volunteer', 'event_volunteer', 'Historical placeholder, no permissions (backfilled from event_permissions.volunteer)', 1, datetime('now'), datetime('now'));

-- ── Default permission bundles ──────────────────────────────────────────────
--
-- `admin` gets every permission string in the system, including the
-- `admin:read` / `admin:write` fallback pair used for admin routes that
-- don't yet belong to one of §2.1's named modules (stats, portal-managed
-- forms config, bulk email campaigns) — see Phase 2 Implementation Status.
--
-- `event_organizer`'s bundle extends beyond §2.2's literal
-- events:write/events:manage to also include proposals:read,
-- proposals:manage, agenda:read, agenda:write — justified by P7's own
-- persona description ("manage capacity, send communications, manage
-- registrations, and view all attendee and proposal data for that event"),
-- and needed so an organizer's event access isn't missing proposal/agenda
-- management that the old event_permissions 'organizer' value already
-- granted via canFinalize.

INSERT INTO role_permissions (id, role_id, permission, created_at) VALUES
  (lower(hex(randomblob(16))), 'role-admin', 'membership:read', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'membership:write', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'membership:approve', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'events:read', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'events:write', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'events:manage', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'working-groups:read', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'working-groups:write', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'email-templates:read', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'email-templates:write', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'donations:read', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'donations:sync', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'users:read', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'users:write', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'users:anonymize', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'audit:read', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'access:grant', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'access:revoke', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'organizations:read', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'organizations:write', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'organizations:content-review', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'sponsorships:read', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'sponsorships:write', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'votes:create', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'votes:manage', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'proposals:read', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'proposals:score', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'proposals:manage', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'agenda:read', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'agenda:write', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'sponsor-portal:attendee-data', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'admin:read', datetime('now')),
  (lower(hex(randomblob(16))), 'role-admin', 'admin:write', datetime('now')),

  (lower(hex(randomblob(16))), 'role-membership_processor', 'membership:read', datetime('now')),
  (lower(hex(randomblob(16))), 'role-membership_processor', 'membership:write', datetime('now')),
  (lower(hex(randomblob(16))), 'role-membership_processor', 'membership:approve', datetime('now')),

  (lower(hex(randomblob(16))), 'role-wg_chair', 'working-groups:write', datetime('now')),
  (lower(hex(randomblob(16))), 'role-wg_chair', 'votes:create', datetime('now')),
  (lower(hex(randomblob(16))), 'role-wg_chair', 'votes:manage', datetime('now')),

  (lower(hex(randomblob(16))), 'role-event_organizer', 'events:read', datetime('now')),
  (lower(hex(randomblob(16))), 'role-event_organizer', 'events:write', datetime('now')),
  (lower(hex(randomblob(16))), 'role-event_organizer', 'events:manage', datetime('now')),
  (lower(hex(randomblob(16))), 'role-event_organizer', 'proposals:read', datetime('now')),
  (lower(hex(randomblob(16))), 'role-event_organizer', 'proposals:manage', datetime('now')),
  (lower(hex(randomblob(16))), 'role-event_organizer', 'agenda:read', datetime('now')),
  (lower(hex(randomblob(16))), 'role-event_organizer', 'agenda:write', datetime('now')),

  (lower(hex(randomblob(16))), 'role-program_committee', 'proposals:read', datetime('now')),
  (lower(hex(randomblob(16))), 'role-program_committee', 'proposals:score', datetime('now')),
  (lower(hex(randomblob(16))), 'role-program_committee', 'proposals:manage', datetime('now')),
  (lower(hex(randomblob(16))), 'role-program_committee', 'agenda:read', datetime('now')),
  (lower(hex(randomblob(16))), 'role-program_committee', 'agenda:write', datetime('now')),

  (lower(hex(randomblob(16))), 'role-event_moderator', 'proposals:read', datetime('now')),
  (lower(hex(randomblob(16))), 'role-event_moderator', 'proposals:score', datetime('now')),
  (lower(hex(randomblob(16))), 'role-event_moderator', 'agenda:read', datetime('now'));

-- ── Backfill (§0.4): users.role='admin' → user_roles ────────────────────────

INSERT INTO user_roles (id, user_id, user_email, role_id, context_type, context_id, granted_by_user_id, expires_at, revoked_at, created_at)
SELECT lower(hex(randomblob(16))), u.id, NULL, 'role-admin', NULL, NULL, NULL, NULL, NULL, datetime('now')
FROM users u
WHERE u.role = 'admin';

-- ── Backfill (§0.2): event_permissions → user_roles ─────────────────────────

INSERT INTO user_roles (id, user_id, user_email, role_id, context_type, context_id, granted_by_user_id, expires_at, revoked_at, created_at)
SELECT
  lower(hex(randomblob(16))),
  ep.user_id,
  ep.user_email,
  CASE ep.permission
    WHEN 'organizer' THEN 'role-event_organizer'
    WHEN 'program_committee' THEN 'role-program_committee'
    WHEN 'moderator' THEN 'role-event_moderator'
    WHEN 'volunteer' THEN 'role-event_volunteer'
  END,
  'event',
  ep.event_id,
  ep.granted_by_id,
  NULL,
  NULL,
  ep.created_at
FROM event_permissions ep;

DROP TABLE event_permissions;

PRAGMA foreign_keys = ON;
