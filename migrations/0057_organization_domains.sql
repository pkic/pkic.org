-- Migration 0057: Normalize organization_domains_json into a table
--
-- `organization_domains_json` (migration 0038) was a bare, unindexed TEXT
-- column holding a JSON array, scanned with `json_each()` on every conflict
-- check (member-applications.ts's `hasConflictingOrganizationDomain`).
-- Domains are normalized identity data used for uniqueness and lookup, not
-- flexible display metadata, so they belong in a real indexed relation
-- (PR #1 review).

CREATE TABLE organization_domains (
  id              TEXT NOT NULL PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  domain          TEXT NOT NULL,
  created_at      TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_organization_domains_domain ON organization_domains(domain);
CREATE INDEX idx_organization_domains_org ON organization_domains(organization_id);

-- OR IGNORE: defends the backfill against the unlikely case of two
-- organizations already listing the same domain in the old JSON blob.
INSERT OR IGNORE INTO organization_domains (id, organization_id, domain, created_at)
SELECT lower(hex(randomblob(16))), o.id, je.value, o.created_at
FROM organizations o, json_each(o.organization_domains_json) je
WHERE o.organization_domains_json IS NOT NULL;

ALTER TABLE organizations DROP COLUMN organization_domains_json;
