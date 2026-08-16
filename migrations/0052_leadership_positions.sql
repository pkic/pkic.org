-- Board of Directors / Executive Council positions, admin-managed
--
-- Replaces the hand-maintained `content/about/board.md` and
-- `content/about/executive-council.md` static markdown (manual `person-card`
-- shortcode lists) with a D1-backed roster, following the same pattern
-- migration 0040 established for WG/forum chairs: admin-assigned, publicly
-- readable, rendered client-side by a widget instead of requiring a git
-- commit to change.
--
-- Board/EC don't fit the existing `roles`/`user_roles` mechanism used for
-- chairs: that model assumes at most one active holder per (role, context)
-- (see Chairs.tsx / admin-working-groups.ts's ROW_NUMBER() pick), has no
-- "from" date distinct from `created_at`, and has no way to carry a
-- free-text title ("Board Chair", "EC Member", "PKI Consortium Chair" —
-- the exact title used for a person varies per body, not a fixed
-- chair/vice-chair pair). Board/EC need many simultaneous holders, an
-- explicit admin-set start date (frequently backdated to match historical
-- terms), and an arbitrary display title. A dedicated table is simpler than
-- widening `user_roles` for a shape it wasn't designed for.
CREATE TABLE leadership_positions (
  id         TEXT NOT NULL PRIMARY KEY,
  body       TEXT NOT NULL CHECK (body IN ('board', 'executive_council')),
  user_id    TEXT NOT NULL,
  title      TEXT NOT NULL,
  starts_at  TEXT NOT NULL,
  ends_at    TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE INDEX idx_leadership_positions_body ON leadership_positions(body, ends_at);
CREATE INDEX idx_leadership_positions_user ON leadership_positions(user_id);
