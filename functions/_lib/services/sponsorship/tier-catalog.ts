import { all, first } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import type { SponsorshipType } from "../../../../assets/shared/schemas/sponsorship";

export interface ActiveSponsorshipTier {
  tier: string;
}

export async function isActiveSponsorshipTier(
  db: DatabaseLike,
  sponsorType: SponsorshipType,
  tier: string,
): Promise<boolean> {
  const row = await first<{ active: number }>(
    db,
    `SELECT active
     FROM sponsorship_tier_catalog
     WHERE sponsor_type = ? AND tier = ?
     LIMIT 1`,
    [sponsorType, tier],
  );
  return row?.active === 1;
}

export async function listActiveSponsorshipTierNames(
  db: DatabaseLike,
  sponsorType: SponsorshipType,
): Promise<string[]> {
  const rows = await all<ActiveSponsorshipTier>(
    db,
    `SELECT tier
     FROM sponsorship_tier_catalog
     WHERE sponsor_type = ? AND active = 1
     ORDER BY display_weight ASC, tier ASC`,
    [sponsorType],
  );
  return rows.map((row) => row.tier);
}
