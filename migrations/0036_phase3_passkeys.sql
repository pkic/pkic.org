-- Migration 0036: Phase 3 — Passkey Authentication (PRD §3)
--
-- Adds passkey_credentials per §3.3. All columns are TEXT/INTEGER, matching
-- the rest of this schema (no other table in this codebase uses a BLOB
-- column) — public_key stores the raw COSE public key bytes returned by the
-- WebAuthn ceremony as a base64url TEXT string rather than BLOB, avoiding a
-- new binary-binding code path for a single column.
--
-- WebAuthn registration/authentication ceremonies need a server-held
-- challenge between the /begin and /complete calls of each flow; §3
-- describes the flow in prose but (per the same class of gap as Phase 0
-- findings #16/#17) defines no table for it. Rather than add a
-- `passkey_challenges` table — extra schema plus an expiry-cleanup job for
-- state that only needs to survive a couple of minutes — the challenge is
-- carried statelessly in a short-lived signed JWT returned to the client and
-- echoed back at /complete, reusing the existing hand-rolled JWT utility
-- (functions/_lib/utils/jwt.ts) and the same "JWT-native, no DB row needed"
-- reasoning PRD §2.1 already applied to permissions.
--
-- credential_id stores the credential ID as base64url TEXT, in the clear —
-- unlike `sessions.token_hash`/`auth_magic_links.token_hash`, a WebAuthn
-- credential ID is not a bearer secret (security comes from the private key
-- never leaving the authenticator, proven via signature); hashing it would
-- only lose the ability to look it up for `excludeCredentials` at
-- registration time and for authenticate/complete's lookup (a
-- usernameless/discoverable-credential flow, per §3.4's "no auth required"
-- begin endpoint) with no security benefit.

CREATE TABLE passkey_credentials (
  id            TEXT    NOT NULL PRIMARY KEY,
  user_id       TEXT    NOT NULL,
  credential_id TEXT    NOT NULL UNIQUE,
  public_key    TEXT    NOT NULL,
  sign_count    INTEGER NOT NULL DEFAULT 0,
  aaguid        TEXT,
  device_name   TEXT,
  last_used_at  TEXT,
  created_at    TEXT    NOT NULL,
  revoked_at    TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE INDEX idx_passkey_credentials_user ON passkey_credentials(user_id);

PRAGMA foreign_keys = ON;
