-- The existing UNIQUE(domain) is a table constraint and cannot be dropped.
-- A separate additive claims table would split one relationship across two
-- stores and require synchronized ownership and promotion logic. Rebuild the
-- existing registry to retain one authoritative row per claimant instead.
-- Apply atomically with a coordinated Worker rollout: old Workers assume a
-- single claimant. If application fails, the transaction must roll back. After
-- success, do not restore UNIQUE(domain) until shared claims are reconciled;
-- restoring a database backup can also discard unrelated subsequent writes.
CREATE TABLE organization_domain_claims_new (
  id TEXT NOT NULL PRIMARY KEY,
  domain TEXT NOT NULL,
  application_id TEXT UNIQUE REFERENCES member_applications(id),
  organization_id TEXT REFERENCES organizations(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO organization_domain_claims_new (id,domain,application_id,organization_id,created_at,updated_at)
SELECT id,domain,application_id,organization_id,created_at,updated_at FROM organization_domain_claims;
DROP TABLE organization_domain_claims;
ALTER TABLE organization_domain_claims_new RENAME TO organization_domain_claims;
CREATE INDEX idx_organization_domain_claims_org ON organization_domain_claims(organization_id);
CREATE UNIQUE INDEX idx_organization_domain_claims_domain_org ON organization_domain_claims(domain,organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX idx_organization_domain_claims_domain ON organization_domain_claims(domain);
CREATE TRIGGER validate_organization_domain_claim_owner_insert BEFORE INSERT ON organization_domain_claims FOR EACH ROW
WHEN (NEW.application_id IS NULL AND NEW.organization_id IS NULL) OR (NEW.application_id IS NOT NULL AND NEW.organization_id IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'DOMAIN_CLAIM_OWNER_INVALID'); END;
CREATE TRIGGER validate_organization_domain_claim_owner_update BEFORE UPDATE OF application_id,organization_id ON organization_domain_claims FOR EACH ROW
WHEN (NEW.application_id IS NULL AND NEW.organization_id IS NULL) OR (NEW.application_id IS NOT NULL AND NEW.organization_id IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'DOMAIN_CLAIM_OWNER_INVALID'); END;

ALTER TABLE member_applications ADD COLUMN organization_id TEXT REFERENCES organizations(id);
