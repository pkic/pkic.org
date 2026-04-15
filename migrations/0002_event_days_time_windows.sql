-- Migration 0002: Add per-day start/end timestamps to event_days

ALTER TABLE event_days ADD COLUMN starts_at TEXT;
ALTER TABLE event_days ADD COLUMN ends_at TEXT;
