-- Migration 0047: Voting System
--
-- Adds the five tables Database Schema Additions calls for (votes,
-- vote_proposals, vote_proposal_endorsements, vote_candidates,
-- vote_ballots), matching the column lists with a small number of
-- necessary additions, flagged here the same way as sponsorships
-- pull-forward flagged its own two extra columns (see migration 0034's
-- header):
--
--   * votes.threshold_type — there are three threshold
--     types (simple_majority / supermajority / successive_elimination) but
--     the schema block never gives `votes` a column to record which one
--     applies to a given vote. Added here; validated in the application
--     layer like every other enum-shaped column in this schema.
--   * votes.current_round / vote_ballots.round — successive-elimination
--     elections ("Round 1: all candidates... after each round the
--     candidate with fewest votes is eliminated... continues until one
--     candidate holds >50%") are described as a live, multi-round process,
--     but nothing in the schema block gives a ballot a round number or a
--     vote a "which round is open now" pointer. Both are added so each
--     round's ballots are independently countable and re-votable. See
--     votes.ts's own header for how round advancement is automated.
--   * vote_candidates.eliminated_round — records which round (if any)
--     eliminated a candidate, purely for result-display purposes.
--
-- No CHECK constraints, per this repo's standing convention — allowed
-- values are documented in `-- allowed:` comments and validated at the
-- application layer (Zod) instead.

CREATE TABLE votes (
  id                    TEXT NOT NULL PRIMARY KEY,
  slug                  TEXT NOT NULL UNIQUE,
  title                 TEXT NOT NULL,
  description           TEXT,
  vote_type             TEXT NOT NULL,
  -- allowed: election | motion | consultation
  scope_type            TEXT NOT NULL,
  -- allowed: forum | working_group
  scope_id              TEXT REFERENCES working_groups(id),
  -- NULL for forum scope; working_groups.id for working_group scope
  created_by_user_id    TEXT REFERENCES users(id),
  proposed_by_user_id   TEXT REFERENCES users(id),
  -- set when converted from an endorsed member proposal; NULL for direct
  -- staff/chair creation
  source_proposal_id    TEXT UNIQUE,
  -- set by convertProposalToVote (proposals.ts) alongside proposed_by_user_id.
  -- UNIQUE structurally enforces "a proposal converts to at most one vote,
  -- ever" — the compare-and-set on vote_proposals.status guards the normal
  -- path, this is the backstop for a lost race (PR #1 review §5.4).
  -- Deliberately no REFERENCES vote_proposals(id): that would form a real
  -- FK cycle with vote_proposals.vote_id -> votes.id (a converted pair
  -- points at each other), which no bulk per-table DELETE order can
  -- satisfy — every write path only ever sets this to the id of the
  -- proposal row being converted in the very same db.batch(), so the
  -- application layer, not a declared FK, is what keeps it valid.
  eligible_categories   TEXT,
  -- JSON array of membership category letters entitled to a ballot beyond
  -- the standing A-G/WG-membership rules; NULL means "all A-G per the
  -- standing rules, no further restriction"
  threshold_type        TEXT NOT NULL,
  -- allowed: simple_majority | supermajority | successive_elimination
  opens_at              TEXT NOT NULL,
  closes_at             TEXT NOT NULL,
  current_round         INTEGER NOT NULL DEFAULT 1,
  status                TEXT NOT NULL,
  -- allowed: scheduled | open | closed | cancelled
  result_json           TEXT,
  visibility             TEXT NOT NULL DEFAULT 'private',
  -- allowed: private | public
  public_detail_level   TEXT NOT NULL DEFAULT 'aggregate',
  -- allowed: outcome_only | aggregate | full_breakdown
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

CREATE INDEX idx_votes_scope ON votes(scope_type, scope_id);
CREATE INDEX idx_votes_status_closes_at ON votes(status, closes_at);
CREATE INDEX idx_votes_visibility ON votes(visibility, closes_at);

CREATE TABLE vote_candidates (
  id                   TEXT NOT NULL PRIMARY KEY,
  vote_id              TEXT NOT NULL REFERENCES votes(id),
  user_id              TEXT REFERENCES users(id),
  -- NULL for external/non-portal candidates
  candidate_name       TEXT NOT NULL,
  candidate_bio        TEXT,
  nominated_by_user_id TEXT REFERENCES users(id),
  sort_order           INTEGER NOT NULL DEFAULT 0,
  eliminated_round     INTEGER,
  -- set by successive-elimination tallying; NULL while still standing
  created_at           TEXT NOT NULL
);

CREATE INDEX idx_vote_candidates_vote ON vote_candidates(vote_id);

CREATE TABLE vote_ballots (
  id              TEXT NOT NULL PRIMARY KEY,
  vote_id         TEXT NOT NULL REFERENCES votes(id),
  user_id         TEXT NOT NULL REFERENCES users(id),
  organization_id TEXT REFERENCES organizations(id),
  -- forum-level: set (the org whose delegate cast this ballot); NULL for
  -- working_group-level ballots
  choice          TEXT NOT NULL,
  -- motion/consultation: in_favor | opposed | abstain
  -- election: a vote_candidates.id
  round           INTEGER NOT NULL DEFAULT 1,
  submitted_at    TEXT NOT NULL,
  ip_hash         TEXT
);

CREATE INDEX idx_vote_ballots_vote_round ON vote_ballots(vote_id, round);
-- Forum-level: one ballot per organization per round.
CREATE UNIQUE INDEX idx_vote_ballots_org_round ON vote_ballots(vote_id, organization_id, round)
  WHERE organization_id IS NOT NULL;
-- Working-group-level: one ballot per person per round.
CREATE UNIQUE INDEX idx_vote_ballots_user_round ON vote_ballots(vote_id, user_id, round)
  WHERE organization_id IS NULL;

CREATE TABLE vote_proposals (
  id                  TEXT PRIMARY KEY,
  title               TEXT NOT NULL,
  description         TEXT NOT NULL,
  vote_type           TEXT NOT NULL,
  -- allowed: election | motion | consultation
  scope_type          TEXT NOT NULL,
  -- allowed: forum | working_group
  scope_id            TEXT REFERENCES working_groups(id),
  proposed_by_user_id TEXT NOT NULL REFERENCES users(id),
  eligible_categories TEXT,
  proposed_opens_at   TEXT,
  proposed_closes_at  TEXT,
  status              TEXT NOT NULL,
  -- allowed: open_for_endorsement | endorsed | rejected | withdrawn | converted_to_vote
  vote_id             TEXT REFERENCES votes(id),
  rejection_reason    TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE INDEX idx_vote_proposals_scope_status ON vote_proposals(scope_type, scope_id, status);

-- Supports both the bounded portal list (status + scope, ordered by
-- created_at) and the bounded admin list (status alone, ordered by
-- created_at) via a shared leading (status) column.
CREATE INDEX idx_vote_proposals_status_scope_created_at
  ON vote_proposals(status, scope_type, scope_id, created_at);

CREATE TABLE vote_proposal_endorsements (
  id               TEXT PRIMARY KEY,
  proposal_id      TEXT NOT NULL REFERENCES vote_proposals(id),
  endorser_user_id TEXT NOT NULL REFERENCES users(id),
  endorsed_at      TEXT NOT NULL,
  UNIQUE(proposal_id, endorser_user_id)
);

CREATE INDEX idx_vote_proposal_endorsements_proposal ON vote_proposal_endorsements(proposal_id);

-- ── New email templates ────────────────────────────────────────────

INSERT OR IGNORE INTO email_template_versions
  (id, template_key, version, subject_template, body, content_type, r2_object_key, checksum_sha256, status, created_by_user_id, created_at, message_type)
VALUES
  (
    lower(hex(randomblob(16))), 'forum-vote-delegate-notify', 1,
    'Forum vote open: {{voteTitle}}',
    'Hi {{delegateName}},

A forum-level vote is now open and, as {{organizationName}}''s voting delegate, you are the one who casts its ballot: "{{voteTitle}}".

Voting closes {{closesAt}}. Cast your organization''s ballot in the portal at {{voteUrl}}.',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'vote-proposal-rejected', 1,
    'Your vote proposal was not approved: {{proposalTitle}}',
    'Hi {{proposerName}},

Your proposed vote "{{proposalTitle}}" was not approved.

Reason: {{rejectionReason}}

You may submit a revised proposal at any time.',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  );
