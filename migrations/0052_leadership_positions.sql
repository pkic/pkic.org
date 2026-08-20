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
  -- The canonical vocabulary is validated by leadershipBodySchema. Keep
  -- this evolvable in application code: D1 cannot alter a CHECK without a
  -- table rebuild when a future consortium body is added.
  body       TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  -- Explicitly records which membership the person represents for this
  -- position. NULL is an intentional "no affiliation" choice; never infer
  -- one from an arbitrary first organization at read time.
  member_id  TEXT,
  title      TEXT NOT NULL,
  starts_at  TEXT NOT NULL,
  ends_at    TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(member_id) REFERENCES members(id)
);

CREATE INDEX idx_leadership_positions_body ON leadership_positions(body, ends_at);
CREATE INDEX idx_leadership_positions_user ON leadership_positions(user_id);
CREATE INDEX idx_leadership_positions_member ON leadership_positions(member_id);
