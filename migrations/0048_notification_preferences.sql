-- Migration 0048: Notification preferences (Member Portal Navigation
-- Structure "Account Settings" row)
--
-- Account Settings nav section lists "notification preferences"
-- alongside passkeys, but no table/column existed anywhere for it.
-- A single JSON column on `users` (rather than a new table) matches
-- this codebase's existing convention for small per-user preference blobs (see
-- `users.links_json`) and avoids the reset-db special-casing a new FK'd
-- table would need (`membership_settings`).
--
-- No CHECK constraint, per this repo's standing convention (migration
-- 0033's header) — the shape is validated at the application
-- layer (assets/shared/schemas/me.ts) on write.

ALTER TABLE users ADD COLUMN notification_preferences_json TEXT;
