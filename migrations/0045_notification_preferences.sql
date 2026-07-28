-- Migration 0045: Notification preferences (PRD §7 Member Portal Navigation
-- Structure "Account Settings" row, §11 UI-1)
--
-- §7's Account Settings nav section lists "notification preferences"
-- alongside passkeys, but no table/column existed anywhere for it —
-- flagged as a known gap in §11.1's UI-1 gap inventory. A single JSON
-- column on `users` (rather than a new table) matches this codebase's
-- existing convention for small per-user preference blobs (see
-- `users.links_json`) and avoids the reset-db special-casing a new FK'd
-- table would need (see prd.md Phase 4A decision 12 re: `membership_settings`).
--
-- No CHECK constraint, per this repo's standing convention (migration
-- 0033's header, §2.3's note) — the shape is validated at the application
-- layer (assets/shared/schemas/me.ts) on write.

ALTER TABLE users ADD COLUMN notification_preferences_json TEXT;
