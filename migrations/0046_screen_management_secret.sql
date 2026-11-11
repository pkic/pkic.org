-- The SHA-256 of a screen device's management secret, as hex, pinned once
-- from the device so later management requests can be matched to the
-- device that was paired. Null until a screen's device has been pinned; the
-- secret itself is never stored.
ALTER TABLE screens ADD COLUMN management_secret_sha256 TEXT;
