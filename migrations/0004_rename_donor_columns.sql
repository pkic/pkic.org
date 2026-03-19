-- Migration 0004: Rename donor_* columns in donations table for naming consistency
--
-- The original column names (donor_name, donor_email, donor_organization) used a
-- redundant prefix — the table name already provides that context. All other tables
-- in the system name their columns without entity prefixes (e.g. users.email, not
-- users.user_email). This migration brings donations in line with that convention.
--
-- NOTE: The IRS 7-year retention requirement from migration 0003 applies equally
-- to the renamed columns (name, email, organization).

ALTER TABLE donations RENAME COLUMN donor_name         TO name;
ALTER TABLE donations RENAME COLUMN donor_email        TO email;
ALTER TABLE donations RENAME COLUMN donor_organization TO organization;

-- Recreate the email index with the updated column name.
DROP INDEX IF EXISTS idx_donations_donor_email;
CREATE INDEX IF NOT EXISTS idx_donations_email ON donations (email);
