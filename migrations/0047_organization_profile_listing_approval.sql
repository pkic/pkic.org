-- Separate listing authority from the owner's effective visibility preference.
-- NULL: no listing decision yet; 0: explicitly withheld; 1: approved.
ALTER TABLE identities ADD COLUMN organization_profile_listing_approved INTEGER
  CHECK (organization_profile_listing_approved IN (0, 1));

-- Preserve existing visibility conservatively: legacy hidden rows need an explicit approval.
UPDATE identities
SET organization_profile_listing_approved = show_on_organization_profile
WHERE organization_id IS NOT NULL;
