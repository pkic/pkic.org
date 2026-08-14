/**
 * Managed pricing for self-service Stripe checkout,
 * stored in `sponsorship_tier_config` (migration 0053) instead of a code
 * constant — a price change is a data update, not a deployment, and
 * code/UI/payment configuration can't diverge. No definition for
 * tier pricing — consortium tiers (Titanium/Diamond/Platinum/Gold/Silver)
 * are typically negotiated annual contracts — and this
 * config — is scoped to event sponsorship tiers only. Seeded figures are
 * still placeholders pending finance confirmation.
 */
import { first, all, run } from "../../db/queries";
import { nowIso } from "../../utils/time";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";

export interface SponsorshipTierConfig {
  id: string;
  sponsorType: string;
  tier: string;
  currency: string;
  amountCents: number;
  active: boolean;
}

interface SponsorshipTierConfigRow {
  id: string;
  sponsor_type: string;
  tier: string;
  currency: string;
  amount_cents: number;
  active: number;
}

function toTierConfig(row: SponsorshipTierConfigRow): SponsorshipTierConfig {
  return {
    id: row.id,
    sponsorType: row.sponsor_type,
    tier: row.tier,
    currency: row.currency,
    amountCents: row.amount_cents,
    active: row.active === 1,
  };
}

/** Active pricing for one sponsor_type+tier, or null if unconfigured/inactive — checkout must reject the request in that case, not fall back to a default price. */
export async function getActiveTierConfig(
  db: DatabaseLike,
  sponsorType: string,
  tier: string,
): Promise<SponsorshipTierConfig | null> {
  const row = await first<SponsorshipTierConfigRow>(
    db,
    `SELECT * FROM sponsorship_tier_config WHERE sponsor_type = ? AND tier = ? AND active = 1`,
    [sponsorType, tier],
  );
  return row ? toTierConfig(row) : null;
}

export async function listTierConfig(db: DatabaseLike, sponsorType?: string): Promise<SponsorshipTierConfig[]> {
  const rows = sponsorType
    ? await all<SponsorshipTierConfigRow>(
        db,
        `SELECT * FROM sponsorship_tier_config WHERE sponsor_type = ? ORDER BY amount_cents ASC`,
        [sponsorType],
      )
    : await all<SponsorshipTierConfigRow>(
        db,
        `SELECT * FROM sponsorship_tier_config ORDER BY sponsor_type, amount_cents ASC`,
      );
  return rows.map(toTierConfig);
}

export async function updateTierConfig(
  db: DatabaseLike,
  id: string,
  input: { amountCents?: number; currency?: string; active?: boolean },
): Promise<SponsorshipTierConfig> {
  const existing = await first<SponsorshipTierConfigRow>(db, `SELECT * FROM sponsorship_tier_config WHERE id = ?`, [
    id,
  ]);
  if (!existing) {
    throw new AppError(404, "NOT_FOUND", "Sponsorship tier config not found");
  }

  await run(
    db,
    `UPDATE sponsorship_tier_config SET amount_cents = ?, currency = ?, active = ?, updated_at = ? WHERE id = ?`,
    [
      input.amountCents ?? existing.amount_cents,
      input.currency ?? existing.currency,
      input.active === undefined ? existing.active : input.active ? 1 : 0,
      nowIso(),
      id,
    ],
  );

  return toTierConfig(
    (await first<SponsorshipTierConfigRow>(db, `SELECT * FROM sponsorship_tier_config WHERE id = ?`, [
      id,
    ])) as SponsorshipTierConfigRow,
  );
}
